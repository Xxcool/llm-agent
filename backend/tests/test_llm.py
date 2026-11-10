"""LLM 适配层测试：MockProvider 行为 + 模型服务错误码映射。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from app.agent import _provider_error_message, run_agent  # noqa: E402
from app.llm import BaseProvider, ChatResponse, MockProvider  # noqa: E402


def _messages(user_msg: str, tool_result: str | None = None) -> list:
    msgs = [{"role": "user", "content": user_msg}]
    if tool_result is not None:
        msgs.append({"role": "assistant", "content": None,
                     "tool_calls": [{"id": "c1", "type": "function",
                                     "function": {"name": "search_knowledge", "arguments": "{}"}}]})
        msgs.append({"role": "tool", "tool_call_id": "c1", "content": tool_result})
    return msgs


def test_mock_first_round_uses_user_question_as_query():
    """首轮工具调用的检索词 = 用户原问题（回归：曾硬编码「项目经历」）。"""
    resp = MockProvider().chat(_messages("差旅报销标准是多少？"), tools=[{"type": "function", "function": {}}])
    assert resp.tool_calls[0]["arguments"]["query"] == "差旅报销标准是多少？"


def test_mock_answer_lists_sources():
    resp = MockProvider().chat(_messages("报销流程", "[制度/差旅.md] 报销需在出差结束后 7 日内提交单据"))
    assert "制度/差旅.md" in resp.content
    assert "报销需在出差结束后" in resp.content


def test_mock_answer_honest_when_no_hits():
    resp = MockProvider().chat(_messages("火锅", "知识库中没有相关内容。"))
    assert "暂无" in resp.content


def test_mock_answer_handles_fetch_failure():
    resp = MockProvider().chat(_messages("抓个链接", "抓取失败：ConnectError"))
    assert "工具调用出现问题" in resp.content or "出现问题" in resp.content


def test_mock_answer_handles_webpage_text():
    resp = MockProvider().chat(_messages("总结这个链接", "这是一段网页正文内容 ABCDEF"))
    assert "网页正文" in resp.content


def test_error_hint_402_balance():
    req = httpx.Request("POST", "https://api.x.com/chat/completions")
    resp = httpx.Response(402, request=req)
    err = httpx.HTTPStatusError("402", request=req, response=resp)
    assert "余额不足" in _provider_error_message(err)


def test_error_hint_401_key():
    req = httpx.Request("POST", "https://api.x.com/chat/completions")
    resp = httpx.Response(401, request=req)
    err = httpx.HTTPStatusError("401", request=req, response=resp)
    assert "API Key" in _provider_error_message(err)


class _BrokenProvider(BaseProvider):
    name = "broken"

    def chat(self, messages, tools=None):
        raise httpx.HTTPStatusError(
            "402",
            request=httpx.Request("POST", "https://api.x.com/chat/completions"),
            response=httpx.Response(402),
        )


def test_agent_yields_readable_error_when_provider_fails(tmp_path, monkeypatch):
    """模型服务欠费时，Agent 产出人话错误事件而不是裸异常。"""
    import app.config as config
    from app.rag import RagStore
    from app.embedder import HashEmbedder
    from app.tools import ToolExecutor

    monkeypatch.setattr(config, "SCORE_THRESHOLD", 0.0)
    kb = tmp_path / "kb"
    kb.mkdir()
    rag = RagStore(tmp_path / "t.sqlite3")
    rag.embedder = HashEmbedder()
    (kb / "a.md").write_text("内容", encoding="utf-8")
    rag.ingest_dir(kb)

    events = list(run_agent(_BrokenProvider(), ToolExecutor(rag), "任何问题", force_retrieval=True))
    errors = [e for e in events if e["type"] == "error"]
    assert errors and "余额不足" in errors[0]["message"]


class _ThinkingProvider(BaseProvider):
    """模拟思考型模型：工具调用轮返回 reasoning_content。"""
    name = "thinking"
    calls: list = []

    def __init__(self):
        self.round = 0

    def chat(self, messages, tools=None):
        _ThinkingProvider.calls.append(messages)
        self.round += 1
        if self.round == 1:
            return ChatResponse(tool_calls=[{"id": "t1", "name": "search_knowledge", "arguments": {"query": "x"}}], reasoning="思考过程 ABC")
        return ChatResponse(content="最终回答")


def test_thinking_model_reasoning_passed_back(tmp_path, monkeypatch):
    """DeepSeek 思考型模型：工具轮的 reasoning_content 必须回传（回归：曾 400）。"""
    import app.config as config
    from app.rag import RagStore
    from app.embedder import HashEmbedder
    from app.tools import ToolExecutor

    monkeypatch.setattr(config, "SCORE_THRESHOLD", 0.0)
    kb = tmp_path / "kb"
    kb.mkdir()
    rag = RagStore(tmp_path / "t.sqlite3")
    rag.embedder = HashEmbedder()
    (kb / "a.md").write_text("内容", encoding="utf-8")
    rag.ingest_dir(kb)

    provider = _ThinkingProvider()
    events = list(run_agent(provider, ToolExecutor(rag), "问题"))
    assert events[-1]["type"] == "done"
    # 第二轮请求里应包含第一轮的思考内容
    second_round = provider.calls[1]
    assistant_msgs = [m for m in second_round if m.get("role") == "assistant"]
    assert any(m.get("reasoning_content") == "思考过程 ABC" for m in assistant_msgs)


def test_forced_retrieval_message_has_reasoning_field(tmp_path, monkeypatch):
    """强制检索合成的 assistant 消息必须带 reasoning_content（空串），思考模型才不 400。"""
    import app.config as config
    from app.rag import RagStore
    from app.embedder import HashEmbedder
    from app.tools import ToolExecutor

    monkeypatch.setattr(config, "SCORE_THRESHOLD", 0.0)
    kb = tmp_path / "kb"
    kb.mkdir()
    rag = RagStore(tmp_path / "t.sqlite3")
    rag.embedder = HashEmbedder()
    (kb / "a.md").write_text("内容", encoding="utf-8")
    rag.ingest_dir(kb)

    provider = _ThinkingProvider()
    list(run_agent(provider, ToolExecutor(rag), "问题", force_retrieval=True))
    first_round = provider.calls[0]
    forced = [m for m in first_round if m.get("role") == "assistant" and m.get("tool_calls")]
    assert forced and "reasoning_content" in forced[0]
