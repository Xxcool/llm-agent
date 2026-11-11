"""Agent 循环：意图判断 → 工具执行 → 结果回填 → 继续生成，产出 SSE 事件流。"""
import json
import re
from typing import Generator, List, Optional

import httpx

from . import config
from .llm import BaseProvider
from .plans import normalize_plan
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
    "- 回答保持简洁、结构化，涉及流程/步骤时用有序列表呈现。\n"
    "方案规则（重要）：当用户索取方案、建议、实施路径、落地步骤，或询问「怎么做 / 如何推进 / 怎么优化」时，"
    "**必须调用 draft_plan 输出结构化方案**，而不是直接写一段文字：\n"
    "1) 先调用 search_knowledge 收集依据；\n"
    "2) 再调用 draft_plan，steps 给出可执行的有序步骤（每步含 title 与 detail 产出物）；\n"
    "3) evidence 至少 2 条，source 必须取自检索结果的文件名，quote 摘录原文关键句，严禁编造；\n"
    "4) risks 给出 1-3 条风险与应对；systems 标注涉及的系统/部门；\n"
    "5) 方案生成后只用一两句话总结核心结论，并提示用户确认后再执行，不要重复方案全文。"
)

# 强制方案模式时追加的指令（前端「方案模式」开关）
PLAN_MODE_HINT = (
    "本轮用户开启了「方案模式」：无论问题形式如何，都要按方案规则处理——\n"
    "先检索依据，再产出 **2-3 个候选方案**（分别调用一次 draft_plan，每次一个候选），"
    "候选之间要有明显不同的思路与权衡：\n"
    "- 每个候选必须填 approach（一句话思路）、cost（成本量级，如「低」「约 2 人月」）、"
    "duration（周期，如「2 周」）、risk_level（低/中/高）；\n"
    "- 其中一个候选标 recommended=true；\n"
    "- 每个候选都要有自己的 steps 与 evidence（依据必须来自检索结果）；\n"
    "- 全部方案生成后，用 2-3 句话对比它们的成本、周期与风险，说明推荐理由，"
    "并提示用户在对比表中选择一个方案确认，不要重复方案全文。"
)


def _tools_schema(allow_fetch: bool) -> list:
    if allow_fetch:
        return TOOLS_SCHEMA
    return [t for t in TOOLS_SCHEMA if t["function"]["name"] != "fetch_url"]




_SEARCH_SOURCE_RE = re.compile(r"^\[([^\]]+)\]", re.MULTILINE)


def _sources_from_search_result(result: str) -> set[str]:
    """从 search_knowledge 的格式化结果中提取来源，用于校验方案依据。"""
    return set(_SEARCH_SOURCE_RE.findall(result or ""))


def _stream_chat(provider: BaseProvider, messages: list, tools: list):
    """统一流式入口：Provider 未实现 chat_stream 时降级为一次性 chat。"""
    stream = getattr(provider, "chat_stream", None)
    if callable(stream):
        yield from stream(messages, tools=tools)
        return
    resp = provider.chat(messages, tools=tools)
    if resp.content:
        yield {"type": "token", "content": resp.content}
    yield {
        "type": "done",
        "content": resp.content,
        "tool_calls": resp.tool_calls,
        "reasoning": resp.reasoning,
    }


def run_agent(
    provider: BaseProvider,
    executor: ToolExecutor,
    user_message: str,
    history: Optional[List[dict]] = None,
    force_retrieval: bool = False,
    allow_fetch: bool = True,
    plan_mode: bool = False,
) -> Generator[dict, None, None]:
    """执行完整 Agent 循环，逐个 yield 事件：
    {"type":"tool_call","name","arguments"} / {"type":"tool_result","name","content"}
    / {"type":"token","content"} / {"type":"plan","plan"} / {"type":"done"} / {"type":"error","message"}

    history: 历史多轮消息 [{"role","content"}]，支持会话内多轮上下文
    force_retrieval: 前端「知识检索」开关，开启后强制先检索一次知识库再回答
    allow_fetch: 前端「网页抓取」开关，关闭时不向模型暴露 fetch_url 工具
    plan_mode: 前端「方案模式」开关，强制走 draft_plan 结构化方案链路
    """
    system_prompt = SYSTEM_PROMPT + ("\n" + PLAN_MODE_HINT if plan_mode else "")
    messages: List[dict] = [{"role": "system", "content": system_prompt}]
    messages.extend(history or [])
    messages.append({"role": "user", "content": user_message})
    tools = _tools_schema(allow_fetch)
    retrieved: dict[str, str] = {}

    def remember_evidence(result: str) -> None:
        for entry in result.split("\n---\n"):
            match = re.match(r"^\[([^\]]+)\] (.*)", entry, re.DOTALL)
            if match:
                source, text = match.groups()
                retrieved[source] = retrieved.get(source, "") + "\n" + text

    try:
        if force_retrieval or plan_mode:
            yield {"type": "tool_call", "name": "search_knowledge", "arguments": {"query": user_message}}
            try:
                result = executor.run("search_knowledge", {"query": user_message})
            except Exception as e:  # noqa: BLE001
                result = f"检索失败：{e.__class__.__name__}: {e}"
            yield {"type": "tool_result", "name": "search_knowledge", "content": result}
            remember_evidence(result)
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
            content_parts: list[str] = []
            reasoning_parts: list[str] = []
            tool_calls: list = []
            stream_done = False

            # 正文边生成边推送；tool_calls / draft_plan 的 JSON 参数仍等流结束再处理
            for chunk in _stream_chat(provider, messages, tools):
                if chunk.get("type") == "token":
                    text = chunk.get("content") or ""
                    if text:
                        content_parts.append(text)
                        yield {"type": "token", "content": text}
                elif chunk.get("type") == "done":
                    stream_done = True
                    # 兼容不逐 token 的 Provider：整段内容在 done 里一次给出
                    done_content = chunk.get("content") or ""
                    if done_content and not content_parts:
                        content_parts.append(done_content)
                        yield {"type": "token", "content": done_content}
                    if chunk.get("reasoning"):
                        reasoning_parts.append(chunk["reasoning"])
                    tool_calls = chunk.get("tool_calls") or []

            if not stream_done:
                raise RuntimeError("模型流异常结束，未收到 done 事件")

            content = "".join(content_parts)
            reasoning = "".join(reasoning_parts)

            if tool_calls:
                assistant_msg = {
                    "role": "assistant",
                    "content": content or None,
                    "tool_calls": [
                        {"id": tc["id"], "type": "function",
                         "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"], ensure_ascii=False)}}
                        for tc in tool_calls
                    ],
                }
                # 思考型模型（DeepSeek reasoner/flash）要求工具调用轮次间回传思考过程
                if reasoning:
                    assistant_msg["reasoning_content"] = reasoning
                messages.append(assistant_msg)
                for tc in tool_calls:
                    yield {"type": "tool_call", "name": tc["name"], "arguments": tc["arguments"]}
                    if tc["name"] == "draft_plan":
                        # 方案工具不落盘执行，只做规范化校验并抛出 plan 事件，
                        # 由上层持久化到消息上、前端渲染为可确认的方案卡片
                        try:
                            plan = normalize_plan(tc["arguments"])
                            if not retrieved or not plan["evidence"]:
                                raise ValueError("没有可核验的知识库依据，请先补充资料或继续检索")
                            for evidence in plan["evidence"]:
                                source, quote = evidence["source"], evidence["quote"]
                                if source not in retrieved:
                                    raise ValueError("依据来源不在本轮检索结果中：" + source)
                                if not quote or re.sub(r"\s+", "", quote) not in re.sub(r"\s+", "", retrieved[source]):
                                    raise ValueError("依据摘录不在本轮检索原文中：" + source)
                            yield {"type": "plan", "plan": plan}
                            result = (
                                f"方案已生成并展示给用户：{plan['title']}"
                                f"（{len(plan['steps'])} 个步骤，{len(plan['evidence'])} 条依据）。"
                                "已进入待确认状态，请用一两句话总结核心结论，并提示用户确认后再执行。"
                            )
                        except Exception as e:  # noqa: BLE001 方案参数不合法 → 让模型修正重试
                            result = f"方案生成失败：{e}。请修正依据和步骤；没有资料时说明缺口，不得编造方案。"
                    else:
                        try:
                            result = executor.run(tc["name"], tc["arguments"])
                        except Exception as e:  # noqa: BLE001 工具失败不中断对话
                            result = f"工具执行失败：{e.__class__.__name__}: {e}"
                        if tc["name"] == "search_knowledge":
                            remember_evidence(result)
                    yield {"type": "tool_result", "name": tc["name"], "content": result}
                    messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result})
                continue  # 工具结果回填后继续生成

            yield {"type": "done"}
            return

        yield {"type": "error", "message": f"超过最大工具轮数（{config.MAX_TOOL_ROUNDS}），已停止。"}
    except httpx.HTTPStatusError as e:
        yield {"type": "error", "message": _provider_error_message(e)}
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "message": _provider_error_message(e)}
