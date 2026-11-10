"""Agent 循环：意图判断 → 工具执行 → 结果回填 → 继续生成，产出 SSE 事件流。"""
import json
from typing import Generator

from . import config
from .llm import BaseProvider
from .tools import TOOLS_SCHEMA, ToolExecutor

SYSTEM_PROMPT = (
    "你是用户（平台研发组）的个人技术助手，回答问题时优先使用工具获取事实：\n"
    "- 涉及个人经历、项目、技能的问题用 get_resume 或 search_knowledge；\n"
    "- 用户给出链接时用 fetch_url 抓取正文；\n"
    "- 回答基于工具返回的事实，并在引用知识库内容时注明来源文件；工具无法覆盖时如实说明。"
)

TOOL_EVENTS = {"type": "tool_call", "name": "", "arguments": {}}


def run_agent(provider: BaseProvider, executor: ToolExecutor, user_message: str) -> Generator[dict, None, None]:
    """执行完整 Agent 循环，逐个 yield 事件：
    {"type":"tool_call","name","arguments"} / {"type":"tool_result","name","content"}
    / {"type":"token","content"} / {"type":"done"} / {"type":"error","message"}
    """
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
    ]
    try:
        for _ in range(config.MAX_TOOL_ROUNDS):
            resp = provider.chat(messages, tools=TOOLS_SCHEMA)

            if resp.tool_calls:
                messages.append({
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {"id": tc["id"], "type": "function",
                         "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"], ensure_ascii=False)}}
                        for tc in resp.tool_calls
                    ],
                })
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
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "message": f"{e.__class__.__name__}: {e}"}
