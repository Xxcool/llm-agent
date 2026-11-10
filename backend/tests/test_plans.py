"""方案层测试（P2/M2）：方案规范化、多候选、持久化、SSE plan 事件、选择互斥闸门。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.llm import ChatResponse  # noqa: E402
from app.main import app  # noqa: E402
from app.plans import apply_selection, normalize_plan, normalize_plan_list, set_status  # noqa: E402

client = TestClient(app)

VALID_RAW = {
    "title": "差旅报销线上化落地方案",
    "approach": "一次性替换线下流程",
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
    "cost": "约 2 人月",
    "duration": "2 周",
    "risk_level": "中",
    "recommended": True,
}

ALT_RAW = {
    **VALID_RAW,
    "id": "plan-b",
    "title": "差旅报销分阶段灰度方案",
    "approach": "先试点一个部门再全量",
    "cost": "约 1 人月",
    "duration": "4 周",
    "risk_level": "低",
    "recommended": False,
}


def _parse_sse(text: str) -> list:
    events = []
    for line in text.splitlines():
        if line.startswith("data:"):
            data = line[5:].strip()
            if data and data != "[DONE]":
                events.append(json.loads(data))
    return events


class TwoPlanProvider:
    """一次生成两个候选方案，再输出对比总结。"""

    name = "openai"

    def __init__(self):
        self.calls = 0

    def chat(self, messages, tools=None):
        self.calls += 1
        if self.calls == 1:
            return ChatResponse(tool_calls=[
                {"id": "c1", "name": "draft_plan", "arguments": VALID_RAW},
                {"id": "c2", "name": "draft_plan", "arguments": ALT_RAW},
            ])
        return ChatResponse(content="两个方案各有取舍，推荐 A（周期短）。")


def test_normalize_plan_builds_structured_plan():
    plan = normalize_plan(VALID_RAW)
    assert plan["status"] == "draft"
    assert plan["id"], "方案必须有唯一 id"
    assert len(plan["steps"]) == 2
    assert plan["evidence"][0]["source"].endswith("员工差旅与费用报销制度.md")
    assert plan["cost"] == "约 2 人月" and plan["duration"] == "2 周"
    assert plan["risk_level"] == "中" and plan["recommended"] is True


def test_normalize_plan_requires_steps():
    with pytest.raises(ValueError):
        normalize_plan({"title": "空方案", "steps": []})


def test_set_status_and_legacy_normalization():
    plan = normalize_plan(VALID_RAW)
    assert set_status(plan, "confirmed")["status"] == "confirmed"
    with pytest.raises(ValueError):
        set_status(plan, "done")
    # 兼容 M1 存量：单个对象 → 列表
    assert len(normalize_plan_list(plan)) == 1
    assert normalize_plan_list(None) == []


def test_apply_selection_rejects_other_candidates():
    a = normalize_plan(VALID_RAW)
    b = normalize_plan(ALT_RAW)
    updated = apply_selection([a, b], b["id"], "confirmed")
    by_id = {p["id"]: p for p in updated}
    assert by_id[b["id"]]["status"] == "confirmed"
    assert by_id[a["id"]]["status"] == "rejected", "选定一个后其余候选自动驳回"
    with pytest.raises(ValueError):
        apply_selection([a, b], "nope", "confirmed")


def test_chat_emits_multiple_plans_and_selection(tmp_app):
    """SSE 产出多个 plan 事件 → 列表持久化 → 选择其一时其余自动驳回。"""
    tmp_app._provider = TwoPlanProvider()
    sid = client.post("/api/sessions").json()["id"]
    r = client.post("/api/chat", json={"message": "给出差旅报销线上化方案", "session_id": sid, "plan_mode": True})
    assert r.status_code == 200
    events = _parse_sse(r.text)
    plans = [e["plan"] for e in events if e["type"] == "plan"]
    assert len(plans) == 2, "方案模式应产出多个候选"
    assert plans[0]["status"] == "draft" and plans[0]["id"] != plans[1]["id"]

    msgs = client.get(f"/api/sessions/{sid}/messages").json()["messages"]
    assistant = msgs[-1]
    assert len(assistant["plans"]) == 2
    mid = assistant["id"]
    chosen = assistant["plans"][1]["id"]

    # 多方案未指定 plan_id → 422
    assert client.patch(f"/api/messages/{mid}/plan", json={"status": "confirmed"}).status_code == 422

    r2 = client.patch(f"/api/messages/{mid}/plan", json={"status": "confirmed", "plan_id": chosen})
    assert r2.status_code == 200
    statuses = {p["id"]: p["status"] for p in r2.json()["plans"]}
    assert statuses[chosen] == "confirmed"
    assert list(statuses.values()).count("rejected") == 1
    # 持久化生效
    saved = {p["id"]: p["status"] for p in client.get(f"/api/sessions/{sid}/messages").json()["messages"][-1]["plans"]}
    assert saved[chosen] == "confirmed"

    # 非法状态与不存在的 plan_id
    assert client.patch(f"/api/messages/{mid}/plan", json={"status": "done", "plan_id": chosen}).status_code == 422
    assert client.patch(f"/api/messages/{mid}/plan", json={"status": "confirmed", "plan_id": "nope"}).status_code == 404
    assert client.patch("/api/messages/99999/plan", json={"status": "confirmed"}).status_code == 404
    client.delete(f"/api/sessions/{sid}")


def test_single_plan_can_confirm_without_plan_id(tmp_app):
    """单方案（普通对话触发 draft_plan）不带 plan_id 也能确认。"""

    class OnePlanProvider:
        name = "openai"

        def __init__(self):
            self.calls = 0

        def chat(self, messages, tools=None):
            self.calls += 1
            if self.calls == 1:
                return ChatResponse(tool_calls=[{"id": "c", "name": "draft_plan", "arguments": VALID_RAW}])
            return ChatResponse(content="已生成方案。")

    tmp_app._provider = OnePlanProvider()
    sid = client.post("/api/sessions").json()["id"]
    client.post("/api/chat", json={"message": "给个方案", "session_id": sid})
    mid = client.get(f"/api/sessions/{sid}/messages").json()["messages"][-1]["id"]
    r = client.patch(f"/api/messages/{mid}/plan", json={"status": "confirmed"})
    assert r.status_code == 200
    assert r.json()["plans"][0]["status"] == "confirmed"
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
    assert client.get(f"/api/sessions/{sid}/messages").json()["messages"][-1]["plans"] == []
    client.delete(f"/api/sessions/{sid}")
