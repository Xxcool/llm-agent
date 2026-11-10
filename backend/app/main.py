"""FastAPI 入口：POST /api/chat（SSE 流式）+ GET /api/health。"""
import json
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from . import config
from .agent import run_agent
from .llm import get_provider
from .rag import RagStore
from .tools import ToolExecutor

app = FastAPI(title="LLM Agent 智能对话平台", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 演示用；生产请改为前端域名
    allow_methods=["*"],
    allow_headers=["*"],
)

_rag: Optional[RagStore] = None
_executor: Optional[ToolExecutor] = None
_provider = None


def _ensure_index() -> RagStore:
    global _rag, _executor, _provider
    if _rag is None:
        _rag = RagStore()
        n = _rag.ingest_dir(Path(config.KNOWLEDGE_DIR))
        print(f"[rag] 知识库索引就绪，共 {n} 个分块")
        _executor = ToolExecutor(_rag)
        _provider = get_provider()
    return _rag


class ChatIn(BaseModel):
    message: str


@app.get("/api/health")
def health():
    _ensure_index()
    chunks = _rag.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    return {"status": "ok", "provider": _provider.name, "chunks": chunks}


@app.post("/api/chat")
def chat(body: ChatIn):
    _ensure_index()

    def gen():
        for event in run_agent(_provider, _executor, body.message):
            yield {"event": "message", "data": json.dumps(event, ensure_ascii=False)}

    return EventSourceResponse(gen())
