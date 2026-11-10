"""FastAPI 入口：SSE 对话 + 运行时 LLM 配置 + 知识库管理。"""
import hashlib
import json
import re
import shutil
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from . import config
from .agent import run_agent
from .llm import BaseProvider, MockProvider, OpenAICompatProvider
from .rag import RagStore
from .tools import ToolExecutor, fetch_text

app = FastAPI(title="LLM Agent 智能对话平台", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 演示用；生产请改为前端域名
    allow_methods=["*"],
    allow_headers=["*"],
)

KNOWLEDGE_ROOT = Path(config.KNOWLEDGE_DIR)
UPLOAD_DIR = KNOWLEDGE_ROOT / "uploads"
RUNTIME_FILE = Path(config.DB_PATH).parent / "runtime_config.json"

_rag: Optional[RagStore] = None
_executor: Optional[ToolExecutor] = None
_provider: Optional[BaseProvider] = None


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
    force_retrieval: bool = False  # 前端「知识检索」开关
    allow_fetch: bool = True  # 前端「网页抓取」开关


class ConfigIn(BaseModel):
    base_url: Optional[str] = None
    api_key: Optional[str] = None  # 传空字符串表示清除
    model: Optional[str] = None


@app.get("/api/health")
def health():
    _ensure_state()
    chunks = _rag.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    rt = _load_runtime()
    return {
        "status": "ok",
        "provider": _provider.name,
        "model": rt.get("model") or config.LLM_MODEL,
        "chunks": chunks,
    }


# ---------- LLM 运行时配置 ----------

@app.get("/api/config")
def get_config():
    rt = _load_runtime()
    _ensure_state()
    return {
        "provider": _provider.name,
        "base_url": rt.get("base_url") or config.LLM_BASE_URL,
        "model": rt.get("model") or config.LLM_MODEL,
        "has_key": bool(rt.get("api_key") or config.LLM_API_KEY),
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
    return {"status": "ok", "provider": _provider.name}


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
    """批量导入网页（如掘金文章链接）为知识库文档：抓正文 → 落盘 md → 入库。"""
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
    target = (KNOWLEDGE_ROOT / source).resolve()
    if not str(target).startswith(str(KNOWLEDGE_ROOT.resolve())):
        raise HTTPException(400, "非法路径")
    removed = _rag.delete_source(source)
    if target.is_file():
        target.unlink()
    return {"status": "ok", "removed_chunks": removed}


# ---------- 对话 ----------

@app.post("/api/chat")
def chat(body: ChatIn):
    _ensure_state()

    def gen():
        for event in run_agent(
            _provider, _executor, body.message,
            force_retrieval=body.force_retrieval,
            allow_fetch=body.allow_fetch,
        ):
            yield {"event": "message", "data": json.dumps(event, ensure_ascii=False)}

    return EventSourceResponse(gen())
