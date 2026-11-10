"""LLM 适配层：OpenAI 兼容 Provider + 离线 Mock Provider，接口一致可切换。"""
import json
from typing import Generator, Optional

import httpx

from . import config


class ChatResponse:
    """统一的一轮回复：要么文本增量，要么工具调用列表。"""

    def __init__(self, content: str = "", tool_calls: Optional[list] = None, reasoning: str = ""):
        self.content = content
        self.tool_calls = tool_calls or []  # [{"id","name","arguments":dict}]
        # 思考型模型（DeepSeek reasoner/flash 等）的思考过程；
        # DeepSeek 要求工具调用轮次之间原样回传，否则 400
        self.reasoning = reasoning


class BaseProvider:
    name = "base"

    def chat(self, messages: list, tools: Optional[list] = None) -> ChatResponse:
        raise NotImplementedError


class OpenAICompatProvider(BaseProvider):
    """OpenAI 兼容 /chat/completions（GLM、DeepSeek、Moonshot 等）。"""

    name = "openai"

    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model

    def chat(self, messages: list, tools: Optional[list] = None) -> ChatResponse:
        payload = {"model": self.model, "messages": messages, "temperature": 0.3}
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        resp = httpx.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json=payload,
            timeout=60,
        )
        resp.raise_for_status()
        msg = resp.json()["choices"][0]["message"]
        tool_calls = [
            {
                "id": tc["id"],
                "name": tc["function"]["name"],
                "arguments": json.loads(tc["function"]["arguments"] or "{}"),
            }
            for tc in msg.get("tool_calls") or []
        ]
        return ChatResponse(
            content=msg.get("content") or "",
            tool_calls=tool_calls,
            reasoning=msg.get("reasoning_content") or "",
        )


class MockProvider(BaseProvider):
    """离线演示用：首轮以用户原问题检索知识库，次轮基于真实检索结果生成摘录式回答。

    不编造内容、不包含任何固定人名/个人信息——回复完全由检索到的片段驱动，
    保证演示模式下的行为与真实 RAG 链路一致（只是少了大模型的润色组织）。
    """

    name = "mock"

    @staticmethod
    def _last_user_message(messages: list) -> str:
        for m in reversed(messages):
            if m.get("role") == "user":
                return (m.get("content") or "").strip()
        return ""

    def chat(self, messages: list, tools: Optional[list] = None) -> ChatResponse:
        has_tool_result = any(m.get("role") == "tool" for m in messages)
        if not has_tool_result and tools:
            # 用用户真实问题作为检索词（截断防超长）
            query = self._last_user_message(messages)[:50] or "知识库"
            return ChatResponse(tool_calls=[{
                "id": "call_1",
                "name": "search_knowledge",
                "arguments": {"query": query},
            }])
        # 次轮：基于最后一次工具结果组织回答
        question = self._last_user_message(messages)
        tool_contents = [m.get("content", "") for m in messages if m.get("role") == "tool"]
        result = tool_contents[-1] if tool_contents else ""
        return ChatResponse(content=self._demo_answer(question, result))

    @staticmethod
    def _demo_answer(question: str, result: str) -> str:
        header = "（演示模式：未接入真实大模型，以下为检索结果摘录）\n\n"
        if not result:
            return header + "未获得检索结果，请重试或在「模型服务」中接入真实 Key。"
        # 工具/抓取失败
        if result.startswith(("抓取失败", "工具执行失败", "检索失败")):
            return header + f"本次工具调用出现问题：{result[:120]}"
        # 知识库无覆盖（与真实模型行为对齐：如实说明）
        if "知识库中没有相关内容" in result:
            topic = question[:30] or "该问题"
            return header + f"知识库中暂无与「{topic}」相关的记录。\n\n建议先在「知识库管理」中上传相关文档，再重新提问。"
        # 网页抓取结果（无 [来源] 前缀的纯文本）
        if not result.startswith("["):
            return header + f"已抓取网页正文并完成解析，关键内容摘录：\n\n> {result[:150]}…"
        # 知识库检索结果：逐条列出来源与摘要
        parts = [p for p in result.split("\n---\n") if p.strip()]
        topic = question[:30] or "该问题"
        lines = [header + f"针对「{topic}」，从知识库中检索到 {len(parts)} 个相关片段：", ""]
        for p in parts[:3]:
            src, _, text = p.partition("]")
            src = src.lstrip("[").strip() or "未知来源"
            snippet = (text.strip() or p.strip())[:80] + ("…" if len(text.strip()) > 80 else "")
            lines.append(f"- **{src}**：{snippet}")
        lines.append("")
        lines.append("接入真实模型服务后（右上角「模型服务」填入 API Key），将基于以上片段生成完整、结构化的回答。")
        return "\n".join(lines)


def get_provider() -> BaseProvider:
    if config.LLM_PROVIDER == "mock":
        return MockProvider()
    if not config.LLM_API_KEY:
        raise RuntimeError("LLM_API_KEY 未配置：请在 .env 或环境变量中设置，或用 LLM_PROVIDER=mock 离线运行")
    return OpenAICompatProvider(config.LLM_BASE_URL, config.LLM_API_KEY, config.LLM_MODEL)
