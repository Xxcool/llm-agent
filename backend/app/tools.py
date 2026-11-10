"""工具集：Function Calling 的 schema 与实现。"""
import re
from pathlib import Path

import httpx

from . import config
from .rag import RagStore

RESUME_FILE = "team-intro.md"  # 知识库目录中的简历文件，整篇返回

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": "在用户的个人知识库（技术文章、笔记、项目资料）中做语义检索，返回最相关的片段。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "检索关键词或问题"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_resume",
            "description": "获取用户完整简历内容，用于回答个人经历、项目、技能相关问题。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": "抓取一个网页的正文文本（自动去 HTML 标签），用于回答链接相关问题。",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "要抓取的 http/https 链接"},
                },
                "required": ["url"],
            },
        },
    },
]


class ToolExecutor:
    def __init__(self, rag: RagStore):
        self.rag = rag

    def run(self, name: str, args: dict) -> str:
        if name == "search_knowledge":
            hits = self.rag.search(args["query"])
            if not hits:
                return "知识库中没有相关内容。"
            return "\n---\n".join(f"[{src}] {text}" for src, text, _ in hits)
        if name == "get_resume":
            f = Path(config.KNOWLEDGE_DIR) / RESUME_FILE
            if not f.exists():
                return "简历文件不存在。"
            return f.read_text(encoding="utf-8")
        if name == "fetch_url":
            try:
                return fetch_text(args["url"])
            except Exception as e:  # noqa: BLE001 抓取失败以文本回给模型
                return f"抓取失败：{e.__class__.__name__}: {e}"
        return f"未知工具：{name}"


def fetch_text(url: str, limit: int = 4000) -> str:
    """抓取网页并转纯文本（去 script/style/标签），供工具与链接导入共用。"""
    if not url.startswith(("http://", "https://")):
        raise ValueError("仅支持 http/https 链接")
    resp = httpx.get(url, timeout=config.FETCH_URL_TIMEOUT,
                     headers={"User-Agent": "Mozilla/5.0 (compatible; llm-agent-platform/0.1)"},
                     follow_redirects=True)
    resp.raise_for_status()
    text = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", resp.text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]
