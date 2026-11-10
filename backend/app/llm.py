"""LLM 适配层：OpenAI 兼容 Provider + 离线 Mock Provider，接口一致可切换。"""
import json
from typing import Generator, Optional

import httpx

from . import config


class ChatResponse:
    """统一的一轮回复：要么文本增量，要么工具调用列表。"""

    def __init__(self, content: str = "", tool_calls: Optional[list] = None):
        self.content = content
        self.tool_calls = tool_calls or []  # [{"id","name","arguments":dict}]


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
        return ChatResponse(content=msg.get("content") or "", tool_calls=tool_calls)


class MockProvider(BaseProvider):
    """离线测试用：首轮触发工具调用，次轮基于工具结果生成回答。"""

    name = "mock"

    def chat(self, messages: list, tools: Optional[list] = None) -> ChatResponse:
        has_tool_result = any(m.get("role") == "tool" for m in messages)
        if not has_tool_result and tools:
            return ChatResponse(tool_calls=[{
                "id": "call_1",
                "name": "search_knowledge",
                "arguments": {"query": "项目经历"},
            }])
        results = [m.get("content", "") for m in messages if m.get("role") == "tool"]
        snippet = (results[-1][:60] + "…") if results and results[-1] else ""
        return ChatResponse(content=f"根据知识库检索结果（{snippet}）：平台研发组的核心项目包括生鲜供应链数字化平台、智慧仓储工业数字孪生大屏与正在开发的 LLM Agent 智能对话平台。")


def get_provider() -> BaseProvider:
    if config.LLM_PROVIDER == "mock":
        return MockProvider()
    if not config.LLM_API_KEY:
        raise RuntimeError("LLM_API_KEY 未配置：请在 .env 或环境变量中设置，或用 LLM_PROVIDER=mock 离线运行")
    return OpenAICompatProvider(config.LLM_BASE_URL, config.LLM_API_KEY, config.LLM_MODEL)
