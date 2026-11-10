"""工具集：Function Calling 的 schema 与实现。"""
import re

import httpx

from . import config
from .rag import RagStore

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": "在企业知识库（制度规范、产品文档、技术资料、运营手册等）中做语义检索，返回最相关的片段。",
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
    {
        "type": "function",
        "function": {
            "name": "draft_plan",
            "description": (
                "生成结构化解决方案。当用户需要方案、建议、实施路径、落地步骤、"
                "「怎么做/如何推进」时调用此工具，而不是直接输出一段文字。"
                "调用前必须先用 search_knowledge 检索依据；evidence 中的每条都必须来自检索结果，"
                "source 填来源文件名，quote 摘录原文关键句，禁止编造来源。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "方案标题（简短，体现目标）"},
                    "approach": {"type": "string", "description": "一句话说明本方案的核心思路（多候选之间必须不同）"},
                    "cost": {"type": "string", "description": "成本量级估计，如「低」「约 2 人月」「预算 5 万」"},
                    "duration": {"type": "string", "description": "实施周期估计，如「2 周」「1 个月」"},
                    "risk_level": {"type": "string", "enum": ["低", "中", "高"], "description": "整体风险等级"},
                    "background": {"type": "string", "description": "背景与现状，说明为什么需要这个方案"},
                    "goal": {"type": "string", "description": "目标与预期结果（可衡量更好）"},
                    "steps": {
                        "type": "array",
                        "description": "实施步骤（有序）",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string", "description": "步骤标题"},
                                "detail": {"type": "string", "description": "具体做法与产出"},
                            },
                            "required": ["title"],
                        },
                    },
                    "evidence": {
                        "type": "array",
                        "description": "方案依据（来自知识库检索结果）",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source": {"type": "string", "description": "来源文件名/相对路径"},
                                "quote": {"type": "string", "description": "原文关键句摘录"},
                            },
                            "required": ["source"],
                        },
                    },
                    "risks": {
                        "type": "array",
                        "description": "风险与应对",
                        "items": {
                            "type": "object",
                            "properties": {
                                "risk": {"type": "string", "description": "风险点"},
                                "mitigation": {"type": "string", "description": "应对措施"},
                            },
                            "required": ["risk"],
                        },
                    },
                    "systems": {
                        "type": "array",
                        "description": "涉及的系统、部门或角色",
                        "items": {"type": "string"},
                    },
                },
                "required": ["title", "approach", "cost", "duration", "risk_level", "steps"],
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
            # 相似度阈值：最高分都达不到阈值说明知识库没覆盖该主题，
            # 宁可如实说没有也不要硬凑不相关内容污染回答
            hits = [h for h in hits if h[2] >= config.SCORE_THRESHOLD]
            if not hits:
                return "知识库中没有相关内容。"
            return "\n---\n".join(f"[{src}] {text}" for src, text, _ in hits)
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
