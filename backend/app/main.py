"""FastAPI 入口：SSE 对话 + 运行时 LLM 配置 + 知识库管理。"""
import hashlib
import hmac
import io
import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from . import config
from .agent import run_agent
from .llm import BaseProvider, MockProvider, OpenAICompatProvider
from .rag import RagStore
from .store import ChatStore
from .tools import ToolExecutor, fetch_text

app = FastAPI(title="LLM Agent 智能对话平台", version="0.2.0")


@app.middleware("http")
async def require_api_token(request, call_next):
    """可选 API Token：设置 API_TOKEN 后保护 /api/*（健康检查除外）。

    默认不启用，保持本地单机开箱即用；公网部署务必设置。
    """
    if (
        config.API_TOKEN
        and request.url.path.startswith("/api/")
        and request.url.path != "/api/health"
        and request.method != "OPTIONS"
    ):
        token = request.headers.get("x-api-token", "")
        if not hmac.compare_digest(token, config.API_TOKEN):
            return JSONResponse({"detail": "未授权：缺少或错误的 API Token"}, status_code=401)
    return await call_next(request)


# 注意：CORS 在 Token 中间件之后添加，确保 401 响应也带 CORS 头
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

KNOWLEDGE_ROOT = Path(config.KNOWLEDGE_DIR)
UPLOAD_DIR = KNOWLEDGE_ROOT / "uploads"
RUNTIME_FILE = Path(config.DB_PATH).parent / "runtime_config.json"

_rag: Optional[RagStore] = None
_executor: Optional[ToolExecutor] = None
_provider: Optional[BaseProvider] = None
_store: Optional[ChatStore] = None


def _load_runtime() -> dict:
    if RUNTIME_FILE.exists():
        try:
            return json.loads(RUNTIME_FILE.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 配置文件损坏时按未配置处理
            return {}
    return {}


def _save_runtime(cfg: dict) -> None:
    RUNTIME_FILE.parent.mkdir(parents=True, exist_ok=True)
    RUNTIME_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def _make_provider() -> BaseProvider:
    """优先用运行时配置（前端设置面板），否则按环境变量；无 Key 时降级 Mock 演示模式。"""
    # LLM_PROVIDER=mock 时强制离线，避免环境里残留的 Key 让演示模式意外发起真实调用
    if config.LLM_PROVIDER == "mock":
        return MockProvider()
    rt = _load_runtime()
    base_url = rt.get("base_url") or config.LLM_BASE_URL
    api_key = rt.get("api_key") or config.LLM_API_KEY
    model = rt.get("model") or config.LLM_MODEL
    if api_key:
        return OpenAICompatProvider(base_url, api_key, model)
    return MockProvider()


def _ensure_state() -> RagStore:
    global _rag, _executor, _provider
    if _rag is None:
        _rag = RagStore()
        n = _rag.ingest_dir(KNOWLEDGE_ROOT)
        print(f"[rag] 知识库索引就绪，共 {n} 个分块")
        _executor = ToolExecutor(_rag)
        _provider = _make_provider()
    return _rag


class ChatIn(BaseModel):
    message: str
    session_id: Optional[str] = None  # 提供则持久化并携带多轮上下文
    force_retrieval: bool = False  # 前端「知识检索」开关
    allow_fetch: bool = True  # 前端「网页抓取」开关
    plan_mode: bool = False  # 前端「方案模式」开关：强制走结构化方案链路


class ConfigIn(BaseModel):
    base_url: Optional[str] = None
    api_key: Optional[str] = None  # 传空字符串表示清除
    model: Optional[str] = None


_health_cache: dict = {"ts": 0.0, "data": None}
_HEALTH_TTL = 60.0  # 秒：模型探测有真实开销，结果缓存 1 分钟


@app.get("/api/health")
def health():
    _ensure_state()
    import time

    now = time.time()
    if _health_cache["data"] and now - _health_cache["ts"] < _HEALTH_TTL:
        return _health_cache["data"]

    chunks = _rag.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    rt = _load_runtime()
    data = {
        "status": "ok",
        "provider": _provider.name,
        "model": rt.get("model") or config.LLM_MODEL,
        "chunks": chunks,
        # API 地址非敏感（不含 Key），前端据此识别服务商品牌并展示
        "base_url": rt.get("base_url") or config.LLM_BASE_URL,
    }
    if _provider.name == "openai":
        # 真实探测：只看「模型服务现在能不能用」，欠费/无效 Key 都会在这里暴露
        try:
            _provider.chat([{"role": "user", "content": "ping"}])
            data["ok"] = True
        except Exception as e:  # noqa: BLE001
            from .agent import _provider_error_message

            data["ok"] = False
            data["error"] = _provider_error_message(e)
    else:
        data["ok"] = True
    _health_cache["ts"] = now
    _health_cache["data"] = data
    return data


# ---------- TTS 朗读（Edge 神经语音，比浏览器 SpeechSynthesis 自然得多） ----------

_TTS_DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"  # 晓晓：自然亲切的女声
_TTS_TEXT_LIMIT = 3000
_tts_cache: dict[str, bytes] = {}
_TTS_CACHE_MAX = 50


async def _tts_synth(text: str, voice: str) -> bytes:
    """调用 Edge TTS 合成 MP3（独立函数便于测试替换）。"""
    import edge_tts  # 延迟导入：未安装/离线时端点报错而不是启动失败

    communicate = edge_tts.Communicate(text, voice)
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    data = buf.getvalue()
    if not data:
        raise RuntimeError("TTS 服务未返回音频")
    return data


@app.get("/api/tts")
async def tts(text: str, voice: Optional[str] = None):
    """文本转语音（MP3）。前端 fetch 失败时自动降级浏览器本地 TTS。"""
    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text 不能为空")
    text = text[:_TTS_TEXT_LIMIT]
    v = (voice or _TTS_DEFAULT_VOICE).strip() or _TTS_DEFAULT_VOICE

    key = f"{v}:{text}"
    data = _tts_cache.get(key)
    if data is None:
        try:
            data = await _tts_synth(text, v)
        except Exception as e:  # noqa: BLE001 网络/服务异常统一 502，由前端降级
            raise HTTPException(status_code=502, detail=f"语音合成失败：{e}") from e
        if len(_tts_cache) >= _TTS_CACHE_MAX:
            _tts_cache.pop(next(iter(_tts_cache)))  # FIFO 淘汰
        _tts_cache[key] = data
    return Response(content=data, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


# ---------- LLM 运行时配置 ----------

@app.get("/api/config")
def get_config():
    rt = _load_runtime()
    _ensure_state()
    key = rt.get("api_key") or config.LLM_API_KEY
    # 只回传掩码，不回传明文 Key
    if key and len(key) > 8:
        masked = f"{key[:4]}••••{key[-4:]}"
    elif key:
        masked = "••••"
    else:
        masked = None
    return {
        "provider": _provider.name,
        "base_url": rt.get("base_url") or config.LLM_BASE_URL,
        "model": rt.get("model") or config.LLM_MODEL,
        "has_key": bool(key),
        "key_masked": masked,
    }


@app.post("/api/config")
def set_config(body: ConfigIn):
    rt = _load_runtime()
    if body.base_url is not None:
        rt["base_url"] = body.base_url.strip()
    if body.model is not None:
        rt["model"] = body.model.strip()
    if body.api_key is not None:
        rt["api_key"] = body.api_key.strip()
    _save_runtime(rt)
    global _provider
    _provider = _make_provider()
    _health_cache["ts"] = 0.0  # 配置变更后立即重新探测
    return {"status": "ok", "provider": _provider.name}


class ConfigTestIn(BaseModel):
    base_url: str
    model: str
    api_key: Optional[str] = None


@app.post("/api/config/test")
def test_config(body: ConfigTestIn):
    """真实调用一次模型验证接入可用性（不落盘），返回可读的成功/失败结果。"""
    rt = _load_runtime()
    key = (body.api_key or "").strip() or rt.get("api_key") or config.LLM_API_KEY
    if not key:
        return {"ok": False, "error": "未填写 API Key"}
    provider = OpenAICompatProvider(body.base_url, key, body.model)
    try:
        resp = provider.chat([{"role": "user", "content": "请只回复两个字：正常"}])
        reply = (resp.content or "").strip()[:30]
        return {"ok": True, "reply": reply or "（空回复）"}
    except Exception as e:  # noqa: BLE001 把真实失败原因返回给前端
        from .agent import _provider_error_message

        return {"ok": False, "error": _provider_error_message(e)}


# ---------- 知识库管理 ----------

@app.get("/api/knowledge")
def list_knowledge():
    _ensure_state()
    docs = [{"source": src, "chunks": n} for src, n in _rag.sources()]
    return {"docs": docs}


class TextDocIn(BaseModel):
    name: str
    text: str


@app.post("/api/knowledge/upload")
async def upload_knowledge(file: UploadFile = File(...)):
    """上传 md/txt/markdown 文件。"""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    if not file.filename.lower().endswith((".md", ".txt", ".markdown")):
        raise HTTPException(400, "仅支持 .md / .txt / .markdown 文件")
    safe = re.sub(r"[^\w.\-\u4e00-\u9fff]", "_", file.filename)
    target = UPLOAD_DIR / safe
    with target.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    rag = _ensure_state()
    rag.ingest_dir(KNOWLEDGE_ROOT)
    total = rag.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    return {"status": "ok", "saved": str(target.relative_to(KNOWLEDGE_ROOT)), "total_chunks": total}


@app.post("/api/knowledge/upload-dir")
async def upload_knowledge_dir(
    files: List[UploadFile] = File(...),
    paths: List[str] = Form(...),
):
    """批量上传文件夹：按浏览器提供的相对路径保留目录结构入库。

    规则：仅收 .md/.txt/.markdown（其余记入 skipped 跳过）；路径清洗拒绝
    绝对路径与「..」穿越，落盘后必须仍位于 uploads/ 内；最后统一增量入库。
    """
    if len(files) != len(paths):
        raise HTTPException(400, "files 与 paths 数量不一致")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    upload_root = UPLOAD_DIR.resolve()
    saved: List[str] = []
    skipped: List[str] = []
    for f, rel in zip(files, paths):
        rel = (rel or f.filename or "").replace("\\", "/").lstrip("/")
        if not rel:
            continue
        if ".." in rel.split("/") or not rel.lower().endswith((".md", ".txt", ".markdown")):
            skipped.append(rel)
            continue
        target = (UPLOAD_DIR / rel).resolve()
        if upload_root != target and upload_root not in target.parents:
            skipped.append(rel)  # 越界路径防护
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("wb") as fp:
            shutil.copyfileobj(f.file, fp)
        saved.append(str(target.relative_to(KNOWLEDGE_ROOT)))
    rag = _ensure_state()
    rag.ingest_dir(KNOWLEDGE_ROOT)
    total = rag.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    return {"status": "ok", "saved": saved, "skipped": skipped, "total_chunks": total}


@app.post("/api/knowledge/text")
async def add_knowledge_text(body: TextDocIn):
    """直接粘贴文本建文档。"""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^\w.\-\u4e00-\u9fff]", "_", body.name)
    if not safe.endswith((".md", ".txt")):
        safe += ".md"
    target = UPLOAD_DIR / safe
    target.write_text(body.text, encoding="utf-8")
    rag = _ensure_state()
    rag.ingest_dir(KNOWLEDGE_ROOT)
    total = rag.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    return {"status": "ok", "saved": str(target.relative_to(KNOWLEDGE_ROOT)), "total_chunks": total}


class UrlImportIn(BaseModel):
    urls: list[str]


@app.post("/api/knowledge/url")
def import_urls(body: UrlImportIn):
    """批量导入网页（如外部文档/制度页面链接）为知识库文档：抓正文 → 落盘 md → 入库。"""
    urls = [u.strip() for u in body.urls if u.strip()]
    if not urls:
        raise HTTPException(400, "至少提供一个链接")
    if len(urls) > 10:
        raise HTTPException(400, "单次最多导入 10 个链接")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    rag = _ensure_state()
    saved: list = []
    failed: list = []
    for url in urls:
        try:
            text = fetch_text(url, limit=20000)
            if len(text) < 60:
                raise ValueError("正文过短（可能被反爬拦截或需登录）")
            m = re.search(r"/(?:post|article|p)/([\w-]+)", url) or re.search(r"/([\w-]+)/?$", url)
            slug = m.group(1) if m else hashlib.md5(url.encode()).hexdigest()[:8]
            host = re.sub(r"^www\.", "", url.split("/")[2])
            filename = re.sub(r"[^\w.\-]", "_", f"{host}_{slug}.md")
            target = UPLOAD_DIR / filename
            target.write_text(f"# 来源：{url}\n\n{text}", encoding="utf-8")
            saved.append(str(target.relative_to(KNOWLEDGE_ROOT)))
        except Exception as e:  # noqa: BLE001 单条失败不影响其他
            failed.append({"url": url, "error": f"{e.__class__.__name__}: {e}"})
    rag.ingest_dir(KNOWLEDGE_ROOT)
    total = rag.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    return {"status": "ok", "saved": saved, "failed": failed, "total_chunks": total}


@app.delete("/api/knowledge")
def delete_knowledge(source: str):
    """按相对路径删除文档（同时删文件与已入库分块）。"""
    _ensure_state()
    root = KNOWLEDGE_ROOT.resolve()
    target = (KNOWLEDGE_ROOT / source).resolve()
    # 必须用路径语义判断，不能用 startswith：knowledge_evil/ 会绕过前缀检查
    if not source.strip() or not target.is_relative_to(root):
        raise HTTPException(400, "非法路径")
    if target == root or target.is_dir():
        raise HTTPException(400, "只能删除知识库中的文件")
    removed = _rag.delete_source(source)
    if target.is_file():
        target.unlink()
    return {"status": "ok", "removed_chunks": removed}


# ---------- 会话管理 ----------

def _ensure_store() -> ChatStore:
    global _store
    if _store is None:
        _store = ChatStore()
    return _store


@app.post("/api/sessions")
def create_session():
    return _ensure_store().create_session()


@app.get("/api/sessions")
def list_sessions():
    return {"sessions": _ensure_store().list_sessions()}


@app.get("/api/sessions/{sid}")
def get_session(sid: str):
    s = _ensure_store().get_session(sid)
    if s is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return s


@app.get("/api/sessions/{sid}/messages")
def get_session_messages(sid: str):
    return {"messages": _ensure_store().get_messages(sid)}


class SessionUpdateIn(BaseModel):
    title: Optional[str] = None
    pinned: Optional[bool] = None


@app.patch("/api/sessions/{sid}")
def update_session(sid: str, body: SessionUpdateIn):
    result = _ensure_store().update_session(sid, title=body.title, pinned=body.pinned)
    if result is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return result


class MessageFeedbackIn(BaseModel):
    type: str  # up / down / none（清除）
    reason: Optional[str] = None
    comment: Optional[str] = None


@app.post("/api/messages/{mid}/feedback")
def message_feedback(mid: int, body: MessageFeedbackIn):
    if body.type not in ("up", "down", "none"):
        raise HTTPException(status_code=422, detail="type 仅支持 up/down/none")
    feedback = None
    if body.type != "none":
        feedback = {
            "type": body.type,
            "reason": body.reason,
            "comment": body.comment,
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
    if not _ensure_store().update_feedback(mid, feedback):
        raise HTTPException(status_code=404, detail="消息不存在")
    return {"status": "ok"}


class PlanStatusIn(BaseModel):
    """方案状态流转：draft（待确认）/ confirmed（已确认）/ rejected（已驳回）"""

    status: str
    # 多方案时必须指定选择哪一个；单方案可省略
    plan_id: Optional[str] = None


@app.patch("/api/messages/{mid}/plan")
def update_message_plan(mid: int, body: PlanStatusIn):
    """更新方案状态（人工确认闸门）。确认一个方案时，其余候选自动驳回。"""
    from .plans import PLAN_STATUSES, apply_selection

    if body.status not in PLAN_STATUSES:
        raise HTTPException(status_code=422, detail=f"status 仅支持 {'/'.join(PLAN_STATUSES)}")
    store = _ensure_store()
    msg = store.get_message(mid)
    if not msg:
        raise HTTPException(status_code=404, detail="消息不存在")
    plans = msg.get("plans") or []
    if not plans:
        raise HTTPException(status_code=404, detail="该消息没有方案")
    plan_id = body.plan_id
    if not plan_id:
        if len(plans) > 1:
            raise HTTPException(status_code=422, detail="多方案需指定 plan_id")
        plan_id = plans[0].get("id")
    try:
        updated = apply_selection(plans, plan_id or "", body.status)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    store.update_plans(mid, updated)
    return {"status": "ok", "plans": updated}


@app.delete("/api/sessions/{sid}")
def delete_session(sid: str):
    _ensure_store().delete_session(sid)
    return {"status": "ok"}


# ---------- 任务（P3 行动层 M3：拆解 / 看板 / 执行） ----------

class TaskBreakdownIn(BaseModel):
    plan_id: Optional[str] = None


def _confirmed_plan(msg: dict, plan_id: Optional[str]) -> dict:
    """取该消息里「已确认」的方案；未确认不允许拆解任务（人工确认闸门）。"""
    plans = msg.get("plans") or []
    target = None
    if plan_id:
        target = next((p for p in plans if p.get("id") == plan_id), None)
    else:
        target = next((p for p in plans if p.get("status") == "confirmed"), None)
    if not target:
        raise HTTPException(status_code=404, detail="未找到方案")
    if target.get("status") != "confirmed":
        raise HTTPException(status_code=400, detail="方案尚未确认，不能拆解任务")
    return target


@app.get("/api/sessions/{sid}/tasks")
def list_tasks(sid: str):
    return {"tasks": _ensure_store().list_tasks(sid)}


@app.post("/api/messages/{mid}/tasks")
def breakdown_tasks(mid: int, body: TaskBreakdownIn):
    """把已确认方案拆解为任务（幂等：已有未完成任务时直接返回）。"""
    from .tasks import breakdown_prompt, normalize_tasks, parse_json_array

    _ensure_state()  # 直接调 API（未经 /api/health）时也要先初始化 provider
    store = _ensure_store()
    msg = store.get_message(mid)
    if not msg:
        raise HTTPException(status_code=404, detail="消息不存在")
    plan = _confirmed_plan(msg, body.plan_id)
    existing = [t for t in store.list_tasks(msg["session_id"]) if t["message_id"] == mid]
    if existing:
        return {"tasks": existing, "cached": True}

    try:
        resp = _provider.chat([{"role": "user", "content": breakdown_prompt(plan)}])
        tasks = normalize_tasks(parse_json_array(resp.content), plan["id"])
    except Exception as e:  # noqa: BLE001 拆解失败以人话返回
        from .agent import _provider_error_message

        raise HTTPException(status_code=502, detail=f"任务拆解失败：{_provider_error_message(e)}") from e

    saved = store.add_tasks(msg["session_id"], mid, tasks)
    return {"tasks": saved, "cached": False}


@app.post("/api/tasks/{tid}/run")
def run_task(tid: int):
    """执行单个任务：文档类产出 Markdown；代码类产出文件 diff（待审批后落盘）。"""
    from .agent import _provider_error_message
    from .tasks import build_diffs, code_run_prompt, parse_code_files, run_prompt

    store = _ensure_store()
    task = store.get_task(tid)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    msg = store.get_message(task["message_id"])
    if not msg:
        raise HTTPException(status_code=404, detail="所属消息不存在")
    plan = next((p for p in (msg.get("plans") or []) if p.get("id") == task["plan_id"]), None)
    if not plan:
        raise HTTPException(status_code=404, detail="方案不存在")
    if plan.get("status") != "confirmed":
        raise HTTPException(status_code=400, detail="方案未确认，不能执行任务")

    # 检索任务相关依据，避免执行产出脱离知识库
    context = ""
    try:
        hits = _ensure_state().search(task["title"] + " " + (task.get("detail") or ""))
        hits = [h for h in hits if h[2] >= config.SCORE_THRESHOLD]
        context = "\n---\n".join(f"[{s}] {t}" for s, t, _ in hits)
    except Exception:  # noqa: BLE001 检索失败不阻塞执行
        context = ""

    store.update_task(tid, "running")
    try:
        if task.get("kind") == "code":
            # 代码类：产出文件 → diff → 等人工批准（不自动落盘）
            resp = _provider.chat([{"role": "user", "content": code_run_prompt(plan, task, context)}])
            parsed = parse_code_files(resp.content or "")
            root = Path(config.WORKSPACE_DIR) / task["session_id"]
            diffs = build_diffs(root, parsed["files"])
            # 待审批的文件内容暂存在 files 字段（含 diff 与全文），批准后才写盘
            updated = store.update_task(
                tid, "review", artifact=parsed["summary"], files=diffs
            )
            return {"status": "ok", "task": updated}

        resp = _provider.chat([{"role": "user", "content": run_prompt(plan, task, context)}])
        artifact = (resp.content or "").strip()
        if not artifact:
            raise RuntimeError("模型未返回交付内容")
        updated = store.update_task(tid, "done", artifact=artifact)
        return {"status": "ok", "task": updated}
    except Exception as e:  # noqa: BLE001
        store.update_task(tid, "failed")
        raise HTTPException(status_code=502, detail=f"任务执行失败：{_provider_error_message(e)}") from e


@app.post("/api/tasks/{tid}/apply")
def apply_task_files(tid: int):
    """批准代码类交付：把待审批文件写入工作区沙箱，并做确定性校验。"""
    from .tasks import apply_files, verify_file

    store = _ensure_store()
    task = store.get_task(tid)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.get("status") != "review":
        raise HTTPException(status_code=400, detail="任务不在待审批状态，不能批准落盘")
    files = task.get("files") or []
    if not files:
        raise HTTPException(status_code=400, detail="该任务没有待落盘文件")
    root = Path(config.WORKSPACE_DIR) / task["session_id"]
    try:
        written = apply_files(root, files)
    except Exception as e:  # noqa: BLE001 路径越界等安全问题
        raise HTTPException(status_code=400, detail=f"落盘失败：{e}") from e
    checks = [verify_file(root / rel) for rel in written]
    ok = all(c["ok"] for c in checks)
    updated = store.update_task(tid, "done" if ok else "failed", checks=checks)
    return {"status": "ok", "written": written, "checks": checks, "task": updated}


@app.post("/api/tasks/{tid}/archive")
def archive_task(tid: int):
    """把已完成任务的交付物归档回知识库，形成可检索的组织记忆（P4/M5）。"""
    from .tasks import archive_markdown, archive_relpath

    store = _ensure_store()
    task = store.get_task(tid)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.get("status") != "done":
        raise HTTPException(status_code=400, detail="只有已完成任务可以归档")

    existing = task.get("archive_path")
    if existing and (KNOWLEDGE_ROOT / existing).is_file():
        return {"status": "ok", "cached": True, "source": existing, "task": task}

    msg = store.get_message(task["message_id"])
    plan = None
    if msg:
        plan = next((p for p in (msg.get("plans") or []) if p.get("id") == task["plan_id"]), None)
    rel = archive_relpath(task)
    target = KNOWLEDGE_ROOT / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(archive_markdown(task, plan), encoding="utf-8")
    _ensure_state().ingest_dir(KNOWLEDGE_ROOT)
    updated = store.update_task(tid, "done", archive_path=rel)
    return {"status": "ok", "cached": False, "source": rel, "task": updated}


@app.post("/api/tasks/{tid}/discard")
def discard_task_files(tid: int):
    """丢弃待审批的代码交付（不落盘）。"""
    store = _ensure_store()
    task = store.get_task(tid)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.get("status") != "review":
        raise HTTPException(status_code=400, detail="任务不在待审批状态，不能丢弃")
    updated = store.update_task(tid, "pending", files=[])
    return {"status": "ok", "task": updated}


# ---------- 对话 ----------

@app.post("/api/chat")
def chat(body: ChatIn):
    _ensure_state()
    store = _ensure_store()
    history: list = []

    if body.session_id:
        # 先取历史（不含本轮），再落库本轮用户消息；否则同一句话会进入
        # history 后又被 run_agent 追加一次，导致模型上下文重复。
        history = store.history(body.session_id)
        store.add_message(body.session_id, "user", body.message)

    def gen():
        content_parts: list = []
        steps: list = []
        plans: list = []
        error_text: str | None = None
        for event in run_agent(
            _provider, _executor, body.message,
            history=history,
            force_retrieval=body.force_retrieval,
            allow_fetch=body.allow_fetch,
            plan_mode=body.plan_mode,
        ):
            if event["type"] == "token":
                content_parts.append(event["content"])
            elif event["type"] == "plan":
                plans.append(event["plan"])
            elif event["type"] == "tool_call":
                steps.append({"name": event["name"], "arguments": event["arguments"]})
            elif event["type"] == "tool_result" and steps:
                for s in reversed(steps):
                    if s["name"] == event["name"] and "result" not in s:
                        s["result"] = event["content"]
                        break
            elif event["type"] == "error":
                error_text = event["message"]
            yield {"event": "message", "data": json.dumps(event, ensure_ascii=False)}
        if body.session_id:
            text = "".join(content_parts)
            # 生成失败时把错误持久化为消息内容，刷新后依然可见（而不是空白）
            if error_text:
                text = f"{text}\n\n⚠️ {error_text}".strip()
            store.add_message(body.session_id, "assistant", text, steps, plan=plans or None)

    return EventSourceResponse(gen())


# ---------- 生产部署：托管前端构建产物（frontend/dist），单端口同时服务 API 与页面 ----------

_FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _FRONTEND_DIST.is_dir():
    from fastapi.responses import FileResponse

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        """SPA 回退：命中真实文件返回文件，其余路径回 index.html（/api 路由注册在前，优先匹配）。"""
        candidate = (_FRONTEND_DIST / full_path).resolve()
        if (
            full_path
            and candidate.is_file()
            and _FRONTEND_DIST.resolve() in candidate.parents
        ):
            return FileResponse(candidate)
        return FileResponse(_FRONTEND_DIST / "index.html")
