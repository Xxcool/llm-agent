"""方案层测试（P2）：方案规范化、持久化、SSE plan 事件、人工确认闸门。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.llm import ChatResponse  # noqa: E402
from app.main import app  # noqa: E402
from app.plans import normalize_plan, set_status  # noqa: E402

client = TestClient(app)

VALID_RAW = {
    "title": "差旅报销线上化落地方案",
    "background": "现有报销为线下提交，周期长、易丢单。",
    "goal": "将差旅报销全流程线上化，审批周期缩短到 3 个工作日。",
    "steps": [
        {"title": "梳理现行制度", "detail": "确认差标与审批链，输出流程图。"},
        {"title": "配置费用系统", "detail": "按职级配置住宿标准与预警。"},
    ],
    "evidence": [
        {"source": "samples/员工差旅与费用报销制度.md", "quote": "P1-P4 一线城市 450 元/晚"},
    ],
    "risks": [{"risk": "旧单积压", "mitigation": "设一个月并行过渡期"}],
    "systems": ["费用系统", "OA"],
}


def _parse_sse(text: str) -> list:
    events = []
    for line in text.splitlines():
        if line.startswith("data:"):
            data = line[5:].strip()
            if data and data != "[DONE]":
                events.append(json.loads(data))
    return events


class PlanProvider:
    """第一轮调用 draft_plan，第二轮输出总结文本。"""

    name = "openai"

    def __init__(self):
        self.calls = 0

    def chat(self, messages, tools=None):
        self.calls += 1
        if self.calls == 1:
            return ChatResponse(tool_calls=[{"id": "call_plan", "name": "draft_plan", "arguments": VALID_RAW}])
        return ChatResponse(content="方案已生成，请确认后再进入执行。")


def test_normalize_plan_builds_structured_plan():
    plan = normalize_plan(VALID_RAW)
    assert plan["status"] == "draft"
    assert len(plan["steps"]) == 2
    assert plan["evidence"][0]["source"].endswith("员工差旅与费用报销制度.md")
    assert plan["risks"][0]["mitigation"] == "设一个月并行过渡期"
    assert plan["systems"] == ["费用系统", "OA"]


def test_normalize_plan_requires_steps():
    with pytest.raises(ValueError):
        normalize_plan({"title": "空方案", "steps": []})


def test_set_status_rejects_unknown_status():
    plan = normalize_plan(VALID_RAW)
    assert set_status(plan, "confirmed")["status"] == "confirmed"
    with pytest.raises(ValueError):
        set_status(plan, "done")


def test_chat_emits_plan_and_persists(tmp_app):
    """SSE 产出 plan 事件 → 方案随消息持久化 → 确认闸门状态流转。"""
    tmp_app._provider = PlanProvider()
    sid = client.post("/api/sessions").json()["id"]
    r = client.post("/api/chat", json={"message": "给出差旅报销线上化方案", "session_id": sid, "plan_mode": True})
    assert r.status_code == 200
    events = _parse_sse(r.text)
    plans = [e for e in events if e["type"] == "plan"]
    assert plans, "应产出 plan 事件"
    assert plans[0]["plan"]["status"] == "draft"
    assert events[-1]["type"] == "done"

    msgs = client.get(f"/api/sessions/{sid}/messages").json()["messages"]
    assistant = msgs[-1]
    assert assistant["plan"]["title"] == VALID_RAW["title"]
    assert assistant["plan"]["status"] == "draft"

    # 确认闸门：draft → confirmed
    mid = assistant["id"]
    r2 = client.patch(f"/api/messages/{mid}/plan", json={"status": "confirmed"})
    assert r2.status_code == 200
    assert r2.json()["plan"]["status"] == "confirmed"
    assert client.get(f"/api/sessions/{sid}/messages").json()["messages"][-1]["plan"]["status"] == "confirmed"

    # 非法状态拒绝；无方案的消息 404
    assert client.patch(f"/api/messages/{mid}/plan", json={"status": "done"}).status_code == 422
    assert client.patch("/api/messages/99999/plan", json={"status": "confirmed"}).status_code == 404
    client.delete(f"/api/sessions/{sid}")


def test_invalid_plan_args_return_tool_error(tmp_app):
    """模型给了空 steps：不产出 plan 事件，而是把错误回给模型修正。"""

    class BadPlanProvider:
        name = "openai"

        def __init__(self):
            self.calls = 0

        def chat(self, messages, tools=None):
            self.calls += 1
            if self.calls == 1:
                return ChatResponse(tool_calls=[{"id": "c", "name": "draft_plan", "arguments": {"title": "x", "steps": []}}])
            return ChatResponse(content="参数有误，已修正。")

    tmp_app._provider = BadPlanProvider()
    sid = client.post("/api/sessions").json()["id"]
    r = client.post("/api/chat", json={"message": "给方案", "session_id": sid})
    events = _parse_sse(r.text)
    assert not [e for e in events if e["type"] == "plan"]
    tool_result = next(e["content"] for e in events if e["type"] == "tool_result")
    assert "方案生成失败" in tool_result
    assert client.get(f"/api/sessions/{sid}/messages").json()["messages"][-1]["plan"] is None
    client.delete(f"/api/sessions/{sid}")
