"""Agent 循环：意图判断 → 工具执行 → 结果回填 → 继续生成，产出 SSE 事件流。"""
import json
from typing import Generator, List, Optional

import httpx

from . import config
from .llm import BaseProvider
from .tools import TOOLS_SCHEMA, ToolExecutor

# 模型服务 HTTP 错误 → 用户能看懂的提示
_PROVIDER_ERROR_HINTS = {
    401: "API Key 无效或未授权",
    402: "账户余额不足，请充值或更换模型服务",
    403: "无访问权限（Key 被禁用或模型未开通）",
    404: "模型不存在，请检查模型名",
    429: "请求过于频繁，稍后重试",
}


def _provider_error_message(e: Exception) -> str:
    if isinstance(e, httpx.HTTPStatusError):
        code = e.response.status_code
        hint = _PROVIDER_ERROR_HINTS.get(code, f"HTTP {code}")
        return f"模型服务调用失败：{hint}"
    return f"{e.__class__.__name__}: {e}"

SYSTEM_PROMPT = (
    "你是企业知识库智能助手，服务于公司内部的制度查询、产品资料检索与业务问答：\n"
    "- 涉及公司制度、产品、流程、技术资料的问题，优先用 search_knowledge 检索知识库，"
    "基于检索结果作答并注明来源文件；\n"
    "- 用户给出外部链接时用 fetch_url 抓取正文再总结；\n"
    "- 严格基于工具返回的事实回答，不得编造；知识库未覆盖时如实说明「知识库中暂无相关记录」，"
    "并建议用户补充文档；\n"
    "- 回答保持简洁、结构化，涉及流程/步骤时用有序列表呈现。"
)


def _tools_schema(allow_fetch: bool) -> list:
    if allow_fetch:
        return TOOLS_SCHEMA
    return [t for t in TOOLS_SCHEMA if t["function"]["name"] != "fetch_url"]


def run_agent(
    provider: BaseProvider,
    executor: ToolExecutor,
    user_message: str,
    history: Optional[List[dict]] = None,
    force_retrieval: bool = False,
    allow_fetch: bool = True,
) -> Generator[dict, None, None]:
    """执行完整 Agent 循环，逐个 yield 事件：
    {"type":"tool_call","name","arguments"} / {"type":"tool_result","name","content"}
    / {"type":"token","content"} / {"type":"done"} / {"type":"error","message"}

    history: 历史多轮消息 [{"role","content"}]，支持会话内多轮上下文
    force_retrieval: 前端「知识检索」开关，开启后强制先检索一次知识库再回答
    allow_fetch: 前端「网页抓取」开关，关闭时不向模型暴露 fetch_url 工具
    """
    messages: List[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history or [])
    messages.append({"role": "user", "content": user_message})
    tools = _tools_schema(allow_fetch)

    try:
        if force_retrieval:
            yield {"type": "tool_call", "name": "search_knowledge", "arguments": {"query": user_message}}
            try:
                result = executor.run("search_knowledge", {"query": user_message})
            except Exception as e:  # noqa: BLE001
                result = f"检索失败：{e.__class__.__name__}: {e}"
            yield {"type": "tool_result", "name": "search_knowledge", "content": result}
            # 以标准 assistant(tool_calls)+tool 消息形式回填，兼容 OpenAI 协议；
            # 思考型模型（DeepSeek flash/reasoner）要求该字段存在，空串即可
            call_id = "forced_search_1"
            messages.append({
                "role": "assistant",
                "content": None,
                "reasoning_content": "",
                "tool_calls": [{
                    "id": call_id, "type": "function",
                    "function": {"name": "search_knowledge",
                                 "arguments": json.dumps({"query": user_message}, ensure_ascii=False)},
                }],
            })
            messages.append({"role": "tool", "tool_call_id": call_id, "content": result})

        for _ in range(config.MAX_TOOL_ROUNDS):
            resp = provider.chat(messages, tools=tools)

            if resp.tool_calls:
                assistant_msg = {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {"id": tc["id"], "type": "function",
                         "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"], ensure_ascii=False)}}
                        for tc in resp.tool_calls
                    ],
                }
                # 思考型模型（DeepSeek reasoner/flash）要求工具调用轮次间回传思考过程
                if getattr(resp, "reasoning", ""):
                    assistant_msg["reasoning_content"] = resp.reasoning
                messages.append(assistant_msg)
                for tc in resp.tool_calls:
                    yield {"type": "tool_call", "name": tc["name"], "arguments": tc["arguments"]}
                    try:
                        result = executor.run(tc["name"], tc["arguments"])
                    except Exception as e:  # noqa: BLE001 工具失败不中断对话
                        result = f"工具执行失败：{e.__class__.__name__}: {e}"
                    yield {"type": "tool_result", "name": tc["name"], "content": result}
                    messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result})
                continue  # 工具结果回填后继续生成

            if resp.content:
                yield {"type": "token", "content": resp.content}
            yield {"type": "done"}
            return

        yield {"type": "error", "message": f"超过最大工具轮数（{config.MAX_TOOL_ROUNDS}），已停止。"}
    except httpx.HTTPStatusError as e:
        yield {"type": "error", "message": _provider_error_message(e)}
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "message": _provider_error_message(e)}
