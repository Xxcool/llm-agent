"""任务层测试（P3/M3）：方案拆解、闸门、执行产出、幂等与清理。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.llm import ChatResponse  # noqa: E402
from app.main import app  # noqa: E402
from app.tasks import normalize_tasks, parse_code_files, parse_json_array  # noqa: E402

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
  {"title": "输出差旅报销流程图", "detail": "梳理申请-审批-报销-打款节点", "output": "流程图与节点说明", "kind": "doc"},
  {"title": "编写差旅标准校验脚本", "detail": "实现标准与超标判定", "output": "可运行脚本", "kind": "code"}
]
```"""

ARTIFACT_MD = "# 差旅报销流程图说明\n\n## 任务目标\n梳理全流程节点。\n\n## 产出物\n流程图与节点说明。"

CODE_JSON = json.dumps({
    "summary": "交付差旅标准校验脚本，读取职级与城市判定是否超标。",
    "files": [
        {"path": "scripts/check_rules.py", "content": "def check(level, city, price):\n    return price <= 450\n"},
        {"path": "config/rules.json", "content": "{\"P1-P4\": {\"tier1\": 450}}"},
    ],
}, ensure_ascii=False)


class TaskProvider:
    """首轮产出方案；拆解任务返回 JSON；文档任务返回 Markdown；代码任务返回文件 JSON。"""

    name = "openai"

    def __init__(self):
        self.calls = 0

    def chat(self, messages, tools=None):
        self.calls += 1
        prompt = messages[-1]["content"]
        if "拆解为" in prompt:
            return ChatResponse(content=TASKS_JSON)
        if "开发类任务" in prompt:
            return ChatResponse(content=CODE_JSON)
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
    assert tasks[0]["kind"] == "doc" and tasks[1]["kind"] == "code"
    assert parse_json_array("没有 JSON") == []


def test_code_files_path_safety():
    """代码交付的文件路径必须白名单化：拒绝穿越、绝对路径与危险扩展名。"""
    good = parse_code_files(CODE_JSON)
    assert [f["path"] for f in good["files"]] == ["scripts/check_rules.py", "config/rules.json"]

    for bad_path in ("../evil.py", "/etc/passwd", "/etc/passwd.md", "C:/tmp/evil.md", "C:evil.md", "run.sh", "a.exe"):
        bad = json.dumps({"summary": "x", "files": [{"path": bad_path, "content": "x"}]}, ensure_ascii=False)
        with pytest.raises(ValueError):
            parse_code_files(bad)


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

    # P4/M5：已完成任务归档回知识库，可检索且幂等
    r4 = client.post(f"/api/tasks/{tid}/archive")
    assert r4.status_code == 200
    archived = r4.json()
    assert archived["cached"] is False
    source = archived["source"]
    assert source.startswith("沉淀/")
    target = tmp_app.KNOWLEDGE_ROOT / source
    assert target.is_file()
    text = target.read_text(encoding="utf-8")
    assert "差旅报销" in text and "trace" not in text.lower()
    assert task["title"] in text
    assert "## 自动复盘" in text
    assert client.post(f"/api/tasks/{tid}/archive").json()["cached"] is True
    assert source in [d["source"] for d in client.get("/api/knowledge").json()["docs"]]
    health = client.get("/api/knowledge/health").json()
    assert health["archived"] >= 1 and health["chunks"] >= 1
    reuse = client.get("/api/knowledge/reuse", params={"q": "差旅报销"}).json()
    assert any(item["source"] == source for item in reuse["items"])
    assert client.get("/api/knowledge/reuse", params={"q": " "}).status_code == 400

    # 删除会话级联清理任务
    client.delete(f"/api/sessions/{sid}")
    assert client.get(f"/api/sessions/{sid}/tasks").json()["tasks"] == []


def test_run_task_without_plan_returns_404(tmp_app):
    tmp_app._provider = TaskProvider()
    assert client.post("/api/tasks/99999/run").status_code == 404


def test_code_task_diff_review_then_apply(tmp_app):
    """代码类任务：产出文件 diff → 待审批 → 批准后落盘沙箱 + 语法校验；丢弃不落盘。"""
    sid, mid, pid = _chat_with_plan(tmp_app)
    client.patch(f"/api/messages/{mid}/plan", json={"status": "confirmed", "plan_id": pid})
    tasks = client.post(f"/api/messages/{mid}/tasks", json={"plan_id": pid}).json()["tasks"]
    code_task = next(t for t in tasks if t["kind"] == "code")

    # 未进入 review 前，apply / discard / archive 都必须被状态守卫拒绝
    assert client.post(f"/api/tasks/{code_task['id']}/apply").status_code == 400
    assert client.post(f"/api/tasks/{code_task['id']}/discard").status_code == 400
    assert client.post(f"/api/tasks/{code_task['id']}/archive").status_code == 400

    # 执行 → 进入 review，带 diff，但文件尚未落盘
    r = client.post(f"/api/tasks/{code_task['id']}/run")
    assert r.status_code == 200
    task = r.json()["task"]
    assert task["status"] == "review"
    assert {f["path"] for f in task["files"]} == {"scripts/check_rules.py", "config/rules.json"}
    assert all(f["exists"] is False for f in task["files"])
    assert task["files"][0]["diff"].startswith("--- /dev/null")
    workspace = tmp_app.config.WORKSPACE_DIR / sid
    assert not (workspace / "scripts/check_rules.py").exists()

    # 批准 → 落盘 + py_compile / json 校验
    r2 = client.post(f"/api/tasks/{code_task['id']}/apply")
    assert r2.status_code == 200
    assert set(r2.json()["written"]) == {"scripts/check_rules.py", "config/rules.json"}
    assert all(c["ok"] for c in r2.json()["checks"])
    assert (workspace / "scripts/check_rules.py").is_file()
    assert r2.json()["task"]["status"] == "done"
    # 已落盘后不能重复 apply，也不能用 discard 把 done 重置回 pending
    assert client.post(f"/api/tasks/{code_task['id']}/apply").status_code == 400
    assert client.post(f"/api/tasks/{code_task['id']}/discard").status_code == 400

    # 再次执行同一任务 → diff 显示为修改（exists=True）
    r3 = client.post(f"/api/tasks/{code_task['id']}/run")
    assert r3.json()["task"]["files"][0]["exists"] is True
    # 丢弃 → 回到 pending，不落盘
    r4 = client.post(f"/api/tasks/{code_task['id']}/discard")
    assert r4.json()["task"]["status"] == "pending"
    assert r4.json()["task"]["files"] == []
    client.delete(f"/api/sessions/{sid}")


def test_code_files_max_six_matches_docs(tmp_path):
    """文档/提示词承诺单任务最多 6 个文件，后端必须同样限制。"""
    files = [{"path": f"f{i}.md", "content": "x"} for i in range(6)]
    assert len(parse_code_files(json.dumps({"files": files}, ensure_ascii=False))["files"]) == 6
    files.append({"path": "f6.md", "content": "x"})
    with pytest.raises(ValueError, match="文件数量超过上限"):
        parse_code_files(json.dumps({"files": files}, ensure_ascii=False))
