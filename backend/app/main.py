"""FastAPI 入口：SSE 对话 + 运行时 LLM 配置 + 知识库管理。"""
import hashlib
import asyncio
import hmac
import io
import json
import re
import secrets
import shutil
import time
import threading
import uuid
from contextvars import ContextVar
from contextlib import asynccontextmanager, suppress
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from . import config
from .agent import run_agent
from .embedder import get_embedder
from .llm import BaseProvider, MockProvider, OpenAICompatProvider
from .rag import RagStore
from .store import ChatStore
from .tools import ToolExecutor, fetch_text
from .secrets import protect, reveal
from .persistence import SnapshotManager

_snapshots: Optional[SnapshotManager] = None


def _checkpoint_data() -> None:
    if _snapshots is not None:
        _snapshots.mark_dirty()
        try:
            _snapshots.checkpoint()
        except Exception as e:
            print(f"[backup] snapshot failed: {type(e).__name__}")


@asynccontextmanager
async def lifespan(_app):
    global _snapshots
    if config.SNAPSHOT_DIR:
        _snapshots = SnapshotManager(Path(config.DB_PATH).parent, Path(config.SNAPSHOT_DIR))
        await asyncio.to_thread(_snapshots.restore)

    async def retry_backups():
        while True:
            await asyncio.sleep(30)
            if _snapshots is not None:
                with suppress(Exception):
                    await asyncio.to_thread(_snapshots.checkpoint)

    worker = asyncio.create_task(retry_backups())
    try:
        yield
    finally:
        worker.cancel()
        with suppress(asyncio.CancelledError):
            await worker
        await asyncio.to_thread(_checkpoint_data)
        for workspace in _workspaces.values():
            workspace.store.conn.close()
            workspace.rag.conn.close()
        _workspaces.clear()
        _snapshots = None


app = FastAPI(title="LLM Agent 智能对话平台", version="0.3.0", lifespan=lifespan)


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
    allow_credentials=True,
)

KNOWLEDGE_ROOT = Path(config.KNOWLEDGE_DIR)
UPLOAD_DIR = KNOWLEDGE_ROOT / "uploads"
RUNTIME_FILE = Path(config.DB_PATH).parent / "runtime_config.json"

# 测试/兼容用的全局覆盖；生产环境保持 None，按匿名 client 创建独立工作区
_rag: Optional[RagStore] = None
_executor: Optional[ToolExecutor] = None
_provider: Optional[BaseProvider] = None
_store: Optional[ChatStore] = None

_CLIENT_CTX: ContextVar[Optional[str]] = ContextVar("client_id", default=None)
_workspaces: dict[str, "Workspace"] = {}
_health_cache: dict[str, dict] = {}
_shared_embedder = None
_workspace_lock = threading.RLock()
_HEALTH_TTL = 60.0  # 秒：模型探测有真实开销，结果缓存 1 分钟


def _current_client() -> str:
    if not config.MULTI_TENANT:
        return "default"  # 单租户：所有请求共用一个工作区
    return _CLIENT_CTX.get() or "anonymous"


def _client_root(client_id: Optional[str] = None) -> Path:
    if not config.MULTI_TENANT:
        # 单租户：knowledge/ workspace/ *.sqlite3 直接落在 KNOWLEDGE_DIR 的父目录
        return Path(config.KNOWLEDGE_DIR).parent
    return Path(config.CLIENTS_DIR) / (client_id or _current_client())


def _cookie_secret() -> bytes:
    if config.CLIENT_COOKIE_SECRET:
        return config.CLIENT_COOKIE_SECRET.encode("utf-8")
    path = Path(config.DB_PATH).parent / "client_cookie_secret"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_hex(32), encoding="utf-8")
        try:
            path.chmod(0o600)
        except OSError:
            pass
    return path.read_text(encoding="utf-8").strip().encode("utf-8")


def _encode_client_cookie(client_id: str) -> str:
    sig = hmac.new(_cookie_secret(), client_id.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{client_id}.{sig}"


def _decode_client_cookie(value: Optional[str]) -> Optional[str]:
    if not value or "." not in value:
        return None
    client_id, sig = value.rsplit(".", 1)
    if not re.fullmatch(r"[a-f0-9]{32}", client_id):
        return None
    expected = hmac.new(_cookie_secret(), client_id.encode("utf-8"), hashlib.sha256).hexdigest()
    return client_id if hmac.compare_digest(sig, expected) else None


def _runtime_file(client_id: Optional[str] = None) -> Path:
    # 测试 fixture 注入全局 _store 时仍使用原来的单文件路径
    if _store is not None:
        return RUNTIME_FILE
    return _client_root(client_id) / "runtime_config.json"


def _load_runtime(client_id: Optional[str] = None) -> dict:
    path = _runtime_file(client_id)
    if path.exists():
        try:
            return reveal(json.loads(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise RuntimeError("模型配置文件损坏，请从备份恢复") from e
    return {}


def _save_runtime(cfg: dict, client_id: Optional[str] = None) -> None:
    path = _runtime_file(client_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(protect(cfg), ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.chmod(0o600)
    tmp.replace(path)
    try:
        path.chmod(0o600)  # API Key 至少不落成全局可读
    except OSError:
        pass


def _make_provider(client_id: Optional[str] = None) -> BaseProvider:
    """优先用当前匿名工作区的运行时配置，否则按环境变量；无 Key 时 Mock。"""
    if config.LLM_PROVIDER == "mock":
        return MockProvider()
    rt = _load_runtime(client_id)
    base_url = rt.get("base_url") or config.LLM_BASE_URL
    api_key = rt.get("api_key") or (config.LLM_API_KEY if not config.MULTI_TENANT else "")
    model = rt.get("model") or config.LLM_MODEL
    if api_key:
        return OpenAICompatProvider(base_url, api_key, model)
    return MockProvider()


class Workspace:
    """一个匿名浏览器的独立数据空间。"""

    def __init__(self, client_id: str):
        self.client_id = client_id
        self.last_used = time.monotonic()
        self.root = _client_root(client_id)
        self.knowledge_root = self.root / "knowledge"
        self.upload_dir = self.knowledge_root / "uploads"
        self.workspace_dir = self.root / "workspace"
        for path in (self.knowledge_root, self.workspace_dir):
            path.mkdir(parents=True, exist_ok=True)
        self.store = ChatStore(self.root / "chat.sqlite3")
        global _shared_embedder
        if _shared_embedder is None:
            _shared_embedder = get_embedder()
        self.rag = RagStore(self.root / "rag.sqlite3", embedder=_shared_embedder)
        n = self.rag.ingest_dir(self.knowledge_root)
        if n:
            print(f"[rag:{client_id[:8]}] 知识库索引就绪，共 {n} 个分块")
        self.executor = ToolExecutor(self.rag, boost_fn=lambda: self.store.source_boosts())
        self.provider = _make_provider(client_id)


def _workspace(client_id: Optional[str] = None) -> Workspace:
    cid = client_id or _current_client()
    with _workspace_lock:
        if cid not in _workspaces:
            # 只释放长时间闲置的连接；数据仍留在磁盘，活跃生成和任务不受影响。
            expiry = max(900, config.LLM_TIMEOUT + 60)
            for old_id, old in list(_workspaces.items()):
                if time.monotonic() - old.last_used > expiry and not old.store.active_sessions:
                    with old.store._lock:
                        if any(t[0] == "running" for t in old.store.conn.execute("SELECT status FROM tasks")):
                            continue
                        old.store.conn.close()
                        old.rag.conn.close()
                    del _workspaces[old_id]
                    _health_cache.pop(old_id, None)
            if len(_workspaces) >= config.MAX_OPEN_WORKSPACES:
                raise HTTPException(503, "当前访问人数较多，请稍后重试")
            _workspaces[cid] = Workspace(cid)
        _workspaces[cid].last_used = time.monotonic()
        return _workspaces[cid]


def _ensure_store() -> ChatStore:
    if _store is not None:  # 测试 fixture 注入
        return _store
    return _workspace().store


def _ensure_state() -> RagStore:
    if _rag is not None:  # 测试 fixture 注入
        return _rag
    return _workspace().rag


def _get_provider() -> BaseProvider:
    if _provider is not None:  # 测试 fixture 注入
        return _provider
    return _workspace().provider


def _get_executor() -> ToolExecutor:
    if _executor is not None:  # 测试 fixture 注入
        return _executor
    return _workspace().executor


def _knowledge_root() -> Path:
    if _rag is not None:  # 测试 fixture 注入
        return KNOWLEDGE_ROOT
    return _workspace().knowledge_root


def _upload_dir() -> Path:
    if _rag is not None:  # 测试 fixture 注入
        return UPLOAD_DIR
    return _workspace().upload_dir


def _workspace_dir(session_id: str) -> Path:
    if _rag is not None:  # 测试 fixture 注入
        return Path(config.WORKSPACE_DIR) / session_id
    return _workspace().workspace_dir / session_id


@app.middleware("http")
async def anonymous_workspace(request, call_next):
    """给每个浏览器分配签名 client_id，所有 API 数据按该工作区隔离。

    MULTI_TENANT=0 时跳过分配，所有请求共用同一工作区（演示/单实例部署）。
    """
    if not config.MULTI_TENANT or not request.url.path.startswith("/api/") or request.url.path == "/api/health":
        return await call_next(request)
    raw = request.cookies.get(config.CLIENT_COOKIE_NAME)
    client_id = _decode_client_cookie(raw)
    new_client = client_id is None
    if new_client:
        client_id = uuid.uuid4().hex
    request.state.cookie_ready = not new_client
    token = _CLIENT_CTX.set(client_id)
    try:
        response = await call_next(request)
    finally:
        _CLIENT_CTX.reset(token)
    if new_client:
        response.set_cookie(
            config.CLIENT_COOKIE_NAME,
            _encode_client_cookie(client_id),
            max_age=365 * 24 * 3600,
            httponly=True,
            samesite="lax",
            secure=config.CLIENT_COOKIE_SECURE,
        )
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.url.path != "/api/workspace":
        await asyncio.to_thread(_checkpoint_data)
    return response


class ChatIn(BaseModel):
    message: str
    session_id: Optional[str] = None  # 提供则持久化并携带多轮上下文
    force_retrieval: bool = False  # 前端「知识检索」开关
    allow_fetch: bool = True  # 前端「网页抓取」开关
    plan_mode: bool = False  # 前端「方案模式」开关：强制走结构化方案链路
    replace_from_id: Optional[int] = None


class ConfigIn(BaseModel):
    base_url: Optional[str] = None
    api_key: Optional[str] = None  # 传空字符串表示清除
    model: Optional[str] = None


@app.get("/api/health")
def health():
    """无副作用的存活探针：监控不创建匿名工作区，也不调用付费模型。"""
    return {"status": "ok", "storage_ok": _snapshots is None or _snapshots.last_error is None}


@app.post("/api/workspace")
@app.get("/api/workspace")
def init_workspace(request: Request):
    """浏览器先建立 Cookie，再并行请求配置、历史等接口。"""
    return {"status": "ok", "cookie_ready": not config.MULTI_TENANT or getattr(request.state, "cookie_ready", False)}


@app.get("/api/status")
def model_status():
    state = _ensure_state()
    provider = _get_provider()
    cache = _health_cache.setdefault(_current_client(), {"ts": 0.0, "data": None})

    now = time.time()
    if cache["data"] and now - cache["ts"] < _HEALTH_TTL:
        return cache["data"]

    chunks = state.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    rt = _load_runtime()
    data = {
        "status": "ok",
        "provider": provider.name,
        "model": rt.get("model") or config.LLM_MODEL,
        "chunks": chunks,
        # API 地址非敏感（不含 Key），前端据此识别服务商品牌并展示
        "base_url": rt.get("base_url") or config.LLM_BASE_URL,
        "requires_key": config.REQUIRE_USER_API_KEY,
    }
    if provider.name == "openai":
        # 真实探测：只看「模型服务现在能不能用」，欠费/无效 Key 都会在这里暴露
        try:
            provider.chat([{"role": "user", "content": "ping"}])
            data["ok"] = True
        except Exception as e:  # noqa: BLE001
            from .agent import _provider_error_message

            data["ok"] = False
            data["error"] = _provider_error_message(e)
    else:
        data["ok"] = True
    cache["ts"] = now
    cache["data"] = data
    if _snapshots is not None and _snapshots.last_error:
        data = {**data, "ok": False, "error": "数据备份失败，请暂缓写入并联系维护者"}
    return data


# ---------- TTS 朗读（Edge 神经语音，比浏览器 SpeechSynthesis 自然得多） ----------

_TTS_DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"  # 晓晓：自然亲切的女声
_TTS_TEXT_LIMIT = 8000
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
    provider = _get_provider()
    key = rt.get("api_key") or (config.LLM_API_KEY if not config.MULTI_TENANT else "")
    # 只回传掩码，不回传明文 Key
    if key and len(key) > 8:
        masked = f"{key[:4]}••••{key[-4:]}"
    elif key:
        masked = "••••"
    else:
        masked = None
    return {
        "provider": provider.name,
        "base_url": rt.get("base_url") or config.LLM_BASE_URL,
        "model": rt.get("model") or config.LLM_MODEL,
        "has_key": bool(key),
        "key_masked": masked,
    }


@app.post("/api/config")
def set_config(body: ConfigIn):
    rt = _load_runtime()
    if body.base_url is not None and body.base_url.rstrip("/") != (rt.get("base_url") or config.LLM_BASE_URL).rstrip("/"):
        # 防止切换服务地址时把原服务商的密钥发送到另一台服务器。
        rt.pop("api_key", None)
    if body.base_url is not None:
        rt["base_url"] = body.base_url.strip()
    if body.model is not None:
        rt["model"] = body.model.strip()
    if body.api_key is not None:
        rt["api_key"] = body.api_key.strip()
    _save_runtime(rt)
    global _provider
    if _provider is not None:  # 测试 fixture 注入
        _provider = _make_provider()
    else:
        workspace = _workspace()
        workspace.provider = _make_provider()
    cache = _health_cache.setdefault(_current_client(), {"ts": 0.0, "data": None})
    cache["ts"] = 0.0  # 配置变更后立即重新探测
    cache["data"] = None
    return {"status": "ok", "provider": _get_provider().name}


class ConfigTestIn(BaseModel):
    base_url: str
    model: str
    api_key: Optional[str] = None


@app.post("/api/config/test")
def test_config(body: ConfigTestIn):
    """真实调用一次模型验证接入可用性（不落盘），返回可读的成功/失败结果。"""
    rt = _load_runtime()
    same_endpoint = body.base_url.rstrip("/") == (rt.get("base_url") or config.LLM_BASE_URL).rstrip("/")
    key = (body.api_key or "").strip() or (rt.get("api_key") if same_endpoint else "")
    if not config.MULTI_TENANT and same_endpoint:
        key = key or config.LLM_API_KEY
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
    rag = _ensure_state()
    docs = [{"source": src, "chunks": n} for src, n in rag.sources()]
    return {"docs": docs}


@app.get("/api/knowledge/health")
def knowledge_health():
    """知识健康度：文档/分块/归档数量、陈旧文档、缺失文件。"""
    rag = _ensure_state()
    root = _knowledge_root()
    now = time.time()
    stale = []
    missing = []
    sources = rag.sources()
    for source, _chunks in sources:
        path = root / source
        if not path.is_file():
            missing.append(source)
            continue
        age_days = int((now - path.stat().st_mtime) // 86400)
        if age_days > config.KNOWLEDGE_STALE_DAYS:
            stale.append({"source": source, "age_days": age_days})
    stale.sort(key=lambda x: -x["age_days"])
    return {
        "docs": len(sources),
        "chunks": sum(n for _, n in sources),
        "archived": sum(1 for src, _ in sources if src.startswith("沉淀/")),
        "stale_count": len(stale),
        "stale_docs": stale[:20],
        "missing_docs": missing[:20],
    }


@app.get("/api/knowledge/reuse")
def knowledge_reuse(q: str, limit: int = 3):
    """复用推荐：从历史归档（沉淀/）中检索相似交付物。"""
    rag = _ensure_state()
    if not q.strip():
        raise HTTPException(400, "查询不能为空")
    limit = max(1, min(limit, 10))
    hits = rag.search(q, top_k=30, boosts=_ensure_store().source_boosts())
    items = [
        {"source": src, "quote": text[:300], "score": score}
        for src, text, score in hits
        if src.startswith("沉淀/")
    ]
    return {"items": items[:limit]}


class TextDocIn(BaseModel):
    name: str
    text: str


@app.post("/api/knowledge/upload")
async def upload_knowledge(file: UploadFile = File(...)):
    """上传 md/txt/markdown 文件。"""
    root = _knowledge_root()
    upload = _upload_dir()
    upload.mkdir(parents=True, exist_ok=True)
    if not file.filename.lower().endswith((".md", ".txt", ".markdown")):
        raise HTTPException(400, "仅支持 .md / .txt / .markdown 文件")
    safe = re.sub(r"[^\w.\-\u4e00-\u9fff]", "_", file.filename)
    target = upload / safe
    with target.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    rag = _ensure_state()
    rag.ingest_dir(root)
    total = rag.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    return {"status": "ok", "saved": str(target.relative_to(root)), "total_chunks": total}


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
    root = _knowledge_root()
    upload = _upload_dir()
    upload.mkdir(parents=True, exist_ok=True)
    upload_root = upload.resolve()
    saved: List[str] = []
    skipped: List[str] = []
    for f, rel in zip(files, paths):
        rel = (rel or f.filename or "").replace("\\", "/")
        if not rel:
            continue
        if rel.startswith("/") or re.match(r"^[A-Za-z]:", rel) or ".." in rel.split("/") or not rel.lower().endswith((".md", ".txt", ".markdown")):
            skipped.append(rel)
            continue
        target = (upload / rel).resolve()
        if upload_root != target and upload_root not in target.parents:
            skipped.append(rel)  # 越界路径防护
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("wb") as fp:
            shutil.copyfileobj(f.file, fp)
        saved.append(str(target.relative_to(root)))
    rag = _ensure_state()
    rag.ingest_dir(root)
    total = rag.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    return {"status": "ok", "saved": saved, "skipped": skipped, "total_chunks": total}


@app.post("/api/knowledge/text")
async def add_knowledge_text(body: TextDocIn):
    """直接粘贴文本建文档。"""
    root = _knowledge_root()
    upload = _upload_dir()
    upload.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^\w.\-\u4e00-\u9fff]", "_", body.name)
    if not safe.endswith((".md", ".txt")):
        safe += ".md"
    target = upload / safe
    target.write_text(body.text, encoding="utf-8")
    rag = _ensure_state()
    rag.ingest_dir(root)
    total = rag.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    return {"status": "ok", "saved": str(target.relative_to(root)), "total_chunks": total}


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
    root = _knowledge_root()
    upload = _upload_dir()
    upload.mkdir(parents=True, exist_ok=True)
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
            target = upload / filename
            target.write_text(f"# 来源：{url}\n\n{text}", encoding="utf-8")
            saved.append(str(target.relative_to(root)))
        except Exception as e:  # noqa: BLE001 单条失败不影响其他
            failed.append({"url": url, "error": f"{e.__class__.__name__}: {e}"})
    rag.ingest_dir(root)
    total = rag.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    return {"status": "ok", "saved": saved, "failed": failed, "total_chunks": total}


@app.delete("/api/knowledge")
def delete_knowledge(source: str):
    """按相对路径删除文档（同时删文件与已入库分块）。"""
    rag = _ensure_state()
    root = _knowledge_root().resolve()
    target = (root / source).resolve()
    # 必须用路径语义判断，不能用 startswith：knowledge_evil/ 会绕过前缀检查
    if not source.strip() or not target.is_relative_to(root):
        raise HTTPException(400, "非法路径")
    if target == root or target.is_dir():
        raise HTTPException(400, "只能删除知识库中的文件")
    removed = rag.delete_source(source)
    if target.is_file():
        target.unlink()
    return {"status": "ok", "removed_chunks": removed}


# ---------- 会话管理 ----------

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
    with store._lock:
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
    try:
        _ensure_store().delete_session(sid)
    except RuntimeError as e:
        raise HTTPException(409, str(e)) from e
    return {"status": "ok"}


# ---------- 任务（P3 行动层 M3：拆解 / 看板 / 执行） ----------

class TaskBreakdownIn(BaseModel):
    plan_id: Optional[str] = None


def _confirmed_plan(msg: dict, plan_id: Optional[str], action: str = "拆解任务") -> dict:
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
        raise HTTPException(status_code=400, detail=f"方案尚未确认，不能{action}")
    return target


@app.get("/api/sessions/{sid}/tasks")
def list_tasks(sid: str):
    return {"tasks": _ensure_store().list_tasks(sid)}


@app.post("/api/messages/{mid}/tasks")
def breakdown_tasks(mid: int, body: TaskBreakdownIn):
    """把已确认方案拆解为任务（幂等：已有未完成任务时直接返回）。"""
    from .tasks import breakdown_prompt, normalize_tasks, parse_json_array

    _ensure_state()  # 直接调 API（未经 /api/health）时也要先初始化 provider
    provider = _get_provider()
    store = _ensure_store()
    msg = store.get_message(mid)
    if not msg:
        raise HTTPException(status_code=404, detail="消息不存在")
    plan = _confirmed_plan(msg, body.plan_id)
    existing = [t for t in store.list_tasks(msg["session_id"]) if t["message_id"] == mid and t["plan_id"] == plan["id"]]
    if existing:
        return {"tasks": existing, "cached": True}

    try:
        resp = provider.chat([{"role": "user", "content": breakdown_prompt(plan)}])
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

    provider = _get_provider()
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
        hits = _ensure_state().search(
            task["title"] + " " + (task.get("detail") or ""),
            boosts=_ensure_store().source_boosts(),
        )
        hits = [h for h in hits if h[2] >= config.SCORE_THRESHOLD]
        context = "\n---\n".join(f"[{s}] {t}" for s, t, _ in hits)
    except Exception:  # noqa: BLE001 检索失败不阻塞执行
        context = ""

    with store._lock:
        if store.get_task(tid)["status"] in ("running", "review"):
            raise HTTPException(409, "任务正在执行或等待审批，请先完成当前操作")
        store.update_task(tid, "running", artifact="", files=[], checks=[], archive_path="")
    try:
        if task.get("kind") == "code":
            # 代码类：产出文件 → diff → 等人工批准（不自动落盘）
            resp = provider.chat([{"role": "user", "content": code_run_prompt(plan, task, context)}])
            parsed = parse_code_files(resp.content or "")
            root = _workspace_dir(task["session_id"])
            diffs = build_diffs(root, parsed["files"])
            # 待审批的文件内容暂存在 files 字段（含 diff 与全文），批准后才写盘
            updated = store.update_task(
                tid, "review", artifact=parsed["summary"], files=diffs
            )
            return {"status": "ok", "task": updated}

        resp = provider.chat([{"role": "user", "content": run_prompt(plan, task, context)}])
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
    from .tasks import FileValidationError, apply_files

    store = _ensure_store()
    with store._lock:
        return _apply_task_locked(store, tid, apply_files, FileValidationError)


def _apply_task_locked(store, tid, apply_files, validation_error):
    task = store.get_task(tid)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.get("status") != "review":
        raise HTTPException(status_code=400, detail="任务不在待审批状态，不能批准落盘")
    msg = store.get_message(task["message_id"])
    if not msg:
        raise HTTPException(404, "所属消息不存在")
    _confirmed_plan(msg, task["plan_id"], "批准落盘")
    files = task.get("files") or []
    if not files:
        raise HTTPException(status_code=400, detail="该任务没有待落盘文件")
    root = _workspace_dir(task["session_id"])
    try:
        written, checks = apply_files(root, files)
    except validation_error as e:
        updated = store.update_task(tid, "failed", checks=e.checks)
        return {"status": "ok", "written": [], "checks": e.checks, "task": updated}
    except Exception as e:  # noqa: BLE001 路径越界等安全问题
        raise HTTPException(status_code=400, detail=f"落盘失败：{e}") from e
    updated = store.update_task(tid, "done", checks=checks)
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

    root = _knowledge_root()
    existing = task.get("archive_path")
    if existing and (root / existing).is_file():
        return {"status": "ok", "cached": True, "source": existing, "task": task}

    msg = store.get_message(task["message_id"])
    plan = None
    if msg:
        plan = next((p for p in (msg.get("plans") or []) if p.get("id") == task["plan_id"]), None)
    rel = archive_relpath(task)
    target = root / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(archive_markdown(task, plan), encoding="utf-8")
    _ensure_state().ingest_dir(root)
    updated = store.update_task(tid, "done", archive_path=rel)
    return {"status": "ok", "cached": False, "source": rel, "task": updated}


@app.post("/api/tasks/{tid}/discard")
def discard_task_files(tid: int):
    """丢弃待审批的代码交付（不落盘）。"""
    store = _ensure_store()
    with store._lock:
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
    if not body.message.strip():
        raise HTTPException(400, "消息不能为空")
    _ensure_state()
    provider = _get_provider()
    if config.REQUIRE_USER_API_KEY and provider.name == "mock":
        raise HTTPException(400, "请先在接入模型服务中配置你自己的 API Key")
    executor = _get_executor()
    store = _ensure_store()
    history: list = []

    if body.session_id:
        # 先取历史（不含本轮），再落库本轮用户消息；否则同一句话会进入
        # history 后又被 run_agent 追加一次，导致模型上下文重复。
        try:
            history = store.begin_turn(body.session_id, body.message, body.replace_from_id)
        except LookupError as e:
            raise HTTPException(404, str(e)) from e
        except (RuntimeError, ValueError) as e:
            raise HTTPException(409, str(e)) from e

    def gen():
        content_parts: list = []
        steps: list = []
        plans: list = []
        error_text: str | None = None
        completed = False
        try:
            for event in run_agent(
                provider, executor, body.message,
                history=history,
                force_retrieval=body.force_retrieval,
                allow_fetch=body.allow_fetch,
                plan_mode=body.plan_mode,
            ):
                if event["type"] == "done":
                    completed = True
                    continue
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
        finally:
            if body.session_id:
                try:
                    text = "".join(content_parts)
                    if error_text:
                        text = f"{text}\n\n⚠️ {error_text}".strip()
                    elif not completed:
                        text = f"{text}\n\n（生成已停止）".strip()
                    store.add_message(body.session_id, "assistant", text, steps, plan=plans or None)
                finally:
                    store.end_turn(body.session_id)
            _checkpoint_data()
        # done 代表消息已经持久化，前端此时读取历史不会丢掉刚生成的回答。
        if completed:
            yield {"event": "message", "data": json.dumps({"type": "done"})}

    return EventSourceResponse(gen())


# ---------- 生产部署：托管前端构建产物（frontend/dist），单端口同时服务 API 与页面 ----------

_FRONTEND_DIST = Path(config.STATIC_DIR).resolve()
if _FRONTEND_DIST.is_dir():
    from fastapi.responses import FileResponse

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        """SPA 回退：命中真实文件返回文件，其余路径回 index.html（/api 路由注册在前，优先匹配）。"""
        if full_path.startswith("api/"):
            raise HTTPException(404, "接口不存在")
        candidate = (_FRONTEND_DIST / full_path).resolve()
        if (
            full_path
            and candidate.is_file()
            and _FRONTEND_DIST.resolve() in candidate.parents
        ):
            return FileResponse(candidate)
        return FileResponse(_FRONTEND_DIST / "index.html")
