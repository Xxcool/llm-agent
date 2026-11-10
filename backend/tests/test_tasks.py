"""任务层测试（P3/M3）：方案拆解、闸门、执行产出、幂等与清理。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.llm import ChatResponse  # noqa: E402
from app.main import app  # noqa: E402
from app.tasks import normalize_tasks, parse_json_array  # noqa: E402

client = TestClient(app)

PLAN_RAW = {
    "title": "差旅报销线上化落地方案",
    "approach": "在现有系统上配置化改造",
    "cost": "低",
    "duration": "4 周",
    "risk_level": "低",
    "goal": "报销全流程线上化",
    "steps": [{"title": "梳理流程", "detail": "输出流程图"}, {"title": "配置系统", "detail": "配置审批流"}],
    "evidence": [{"source": "samples/员工差旅与费用报销制度.md", "quote": "P1-P4 一线城市 450 元/晚"}],
    "systems": ["OA", "费用系统"],
}

TASKS_JSON = """```json
[
  {"title": "输出差旅报销流程图", "detail": "梳理申请-审批-报销-打款节点", "output": "流程图与节点说明"},
  {"title": "配置差旅标准与预警", "detail": "按职级配置住宿标准", "output": "系统配置清单"}
]
```"""

ARTIFACT_MD = "# 差旅报销流程图说明\n\n## 任务目标\n梳理全流程节点。\n\n## 产出物\n流程图与节点说明。"


class TaskProvider:
    """首轮产出方案；拆解任务时返回 JSON；执行任务时返回 Markdown 文档。"""

    name = "openai"

    def __init__(self):
        self.calls = 0

    def chat(self, messages, tools=None):
        self.calls += 1
        prompt = messages[-1]["content"]
        if "拆解为" in prompt:
            return ChatResponse(content=TASKS_JSON)
        if "方案执行者" in prompt:
            return ChatResponse(content=ARTIFACT_MD)
        if tools is not None:
            return ChatResponse(tool_calls=[{"id": "c1", "name": "draft_plan", "arguments": PLAN_RAW}])
        return ChatResponse(content="方案已生成。")


def _chat_with_plan(tmp_app):
    tmp_app._provider = TaskProvider()
    sid = client.post("/api/sessions").json()["id"]
    r = client.post("/api/chat", json={"message": "给个报销线上化的方案", "session_id": sid, "plan_mode": True})
    assert r.status_code == 200
    msgs = client.get(f"/api/sessions/{sid}/messages").json()["messages"]
    assistant = msgs[-1]
    return sid, assistant["id"], assistant["plans"][0]["id"]


def test_parse_and_normalize_tasks():
    tasks = normalize_tasks(parse_json_array(TASKS_JSON), "p1")
    assert len(tasks) == 2
    assert tasks[0]["title"].startswith("输出差旅")
    assert tasks[0]["status"] == "pending"
    assert tasks[0]["plan_id"] == "p1"
    assert parse_json_array("没有 JSON") == []


def test_breakdown_requires_confirmed_plan(tmp_app):
    sid, mid, pid = _chat_with_plan(tmp_app)
    # 未确认 → 400（人工确认闸门）
    r = client.post(f"/api/messages/{mid}/tasks", json={"plan_id": pid})
    assert r.status_code == 400
    client.delete(f"/api/sessions/{sid}")


def test_breakdown_then_run_task(tmp_app):
    sid, mid, pid = _chat_with_plan(tmp_app)
    assert client.patch(f"/api/messages/{mid}/plan", json={"status": "confirmed", "plan_id": pid}).status_code == 200

    r = client.post(f"/api/messages/{mid}/tasks", json={"plan_id": pid})
    assert r.status_code == 200
    tasks = r.json()["tasks"]
    assert len(tasks) == 2 and r.json()["cached"] is False
    assert tasks[0]["status"] == "pending"

    # 幂等：再次拆解返回已有任务
    r2 = client.post(f"/api/messages/{mid}/tasks", json={"plan_id": pid})
    assert r2.json()["cached"] is True and len(r2.json()["tasks"]) == 2

    # 看板列表
    assert len(client.get(f"/api/sessions/{sid}/tasks").json()["tasks"]) == 2

    # 执行任务 → 产出 Markdown 交付物
    tid = tasks[0]["id"]
    r3 = client.post(f"/api/tasks/{tid}/run")
    assert r3.status_code == 200
    task = r3.json()["task"]
    assert task["status"] == "done"
    assert "任务目标" in (task["artifact"] or "")

    # 删除会话级联清理任务
    client.delete(f"/api/sessions/{sid}")
    assert client.get(f"/api/sessions/{sid}/tasks").json()["tasks"] == []


def test_run_task_without_plan_returns_404(tmp_app):
    tmp_app._provider = TaskProvider()
    assert client.post("/api/tasks/99999/run").status_code == 404
