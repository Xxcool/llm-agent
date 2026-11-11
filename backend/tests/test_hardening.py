"""接手盘点问题的回归：隔离、审批、持久化、消息分支与故障恢复。"""
import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main as m
from app.embedder import HashEmbedder
from app.llm import BaseProvider, ChatResponse
from app.agent import run_agent
from app.persistence import SnapshotManager
from app.plans import apply_selection
from app.rag import RagStore
from app.store import ChatStore
from app.tasks import FileValidationError, apply_files, build_diffs
from app.tools import ToolExecutor


def test_health_does_not_create_workspaces(tmp_path, monkeypatch):
    monkeypatch.setattr(m.config, "CLIENTS_DIR", tmp_path / "clients")
    monkeypatch.setattr(m.config, "DB_PATH", tmp_path / "rag.sqlite3")
    m._workspaces.clear()
    for _ in range(3):
        response = TestClient(m.app).get("/api/health")
        assert response.status_code == 200
        assert "set-cookie" not in response.headers
    assert not m._workspaces and not list(tmp_path.iterdir())


def test_runtime_key_encrypted_and_not_reused_for_new_endpoint(tmp_app):
    c = TestClient(m.app)
    key = "sk-private-key-for-regression"
    assert c.post("/api/config", json={"api_key": key}).status_code == 200
    saved = json.loads(tmp_app.RUNTIME_FILE.read_text())
    assert key not in tmp_app.RUNTIME_FILE.read_text()
    assert "api_key" not in saved and saved["api_key_encrypted"]
    assert tmp_app._load_runtime()["api_key"] == key
    # 没有显式输入新密钥时，切换端点不能携带旧密钥做探测。
    result = c.post("/api/config/test", json={"base_url": "https://other.example/v1", "model": "m"})
    assert result.json() == {"ok": False, "error": "未填写 API Key"}
    c.post("/api/config", json={"base_url": "https://other.example/v1"})
    assert c.get("/api/config").json()["has_key"] is False


def test_markdown_extension_is_indexed(tmp_app):
    c = TestClient(m.app)
    response = c.post("/api/knowledge/upload", files={"file": ("notes.markdown", "# 标题\n\n知识正文".encode())})
    assert response.status_code == 200
    assert c.get("/api/knowledge").json()["docs"] == [{"source": "uploads/notes.markdown", "chunks": 1}]


def test_plan_reselection_keeps_only_one_confirmed():
    plans = [{"id": "a", "status": "draft"}, {"id": "b", "status": "draft"}]
    for pid, status in (("a", "confirmed"), ("b", "draft"), ("b", "confirmed")):
        plans = apply_selection(plans, pid, status)
    assert [p["id"] for p in plans if p["status"] == "confirmed"] == ["b"]


def test_switching_plan_does_not_reuse_other_plans_tasks(tmp_app):
    from test_tasks import TaskProvider
    tmp_app._provider = TaskProvider()
    store = tmp_app._store
    sid = store.create_session()["id"]
    store.add_message(sid, "assistant", "候选", plan=[
        {"id": "a", "status": "confirmed"}, {"id": "b", "status": "draft"},
    ])
    mid = store.get_messages(sid)[0]["id"]
    old = store.add_tasks(sid, mid, [{"title": "A 的任务", "plan_id": "a"}])[0]
    c = TestClient(m.app)
    c.patch(f"/api/messages/{mid}/plan", json={"plan_id": "b", "status": "confirmed"})
    response = c.post(f"/api/messages/{mid}/tasks", json={"plan_id": "b"})
    assert response.status_code == 200 and response.json()["cached"] is False
    assert all(t["plan_id"] == "b" for t in response.json()["tasks"])
    assert store.get_task(old["id"]) is not None


def _review_task(app, root: Path):
    sid = app._store.create_session()["id"]
    app._store.add_message(sid, "assistant", "方案", plan=[{"id": "p", "status": "confirmed"}])
    mid = app._store.get_messages(sid)[0]["id"]
    task = app._store.add_tasks(sid, mid, [{"plan_id": "p", "title": "交付", "kind": "code"}])[0]
    diffs = build_diffs(root / sid, [{"path": "rules.json", "content": '{"valid":true}'}])
    app._store.update_task(task["id"], "review", files=diffs)
    return sid, mid, task["id"]


def test_apply_rechecks_plan_confirmation(tmp_app):
    sid, mid, tid = _review_task(tmp_app, tmp_app.config.WORKSPACE_DIR)
    c = TestClient(m.app)
    c.patch(f"/api/messages/{mid}/plan", json={"status": "rejected"})
    assert c.post(f"/api/tasks/{tid}/apply").status_code == 400
    assert not (tmp_app.config.WORKSPACE_DIR / sid).exists()


def test_invalid_file_does_not_replace_any_file(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "old.json").write_text('{"old":true}')
    files = build_diffs(root, [{"path": "new.md", "content": "new"}, {"path": "old.json", "content": "INVALID"}])
    with pytest.raises(FileValidationError):
        apply_files(root, files)
    assert (root / "old.json").read_text() == '{"old":true}'
    assert not (root / "new.md").exists()


def test_write_failure_restores_previous_files(tmp_path, monkeypatch):
    import app.tasks as tasks
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "a.md").write_text("original")
    files = build_diffs(root, [{"path": "a.md", "content": "changed"}, {"path": "b.md", "content": "new"}])
    replace = tasks.os.replace
    count = 0

    def failing_replace(src, dst):
        nonlocal count
        count += 1
        if count == 2:
            raise OSError("simulated write failure")
        replace(src, dst)

    monkeypatch.setattr(tasks.os, "replace", failing_replace)
    with pytest.raises(OSError):
        apply_files(root, files)
    assert (root / "a.md").read_text() == "original"
    assert not (root / "b.md").exists()


def test_stale_diff_and_symlink_are_rejected(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "a.md").write_text("original")
    files = build_diffs(root, [{"path": "a.md", "content": "changed"}])
    (root / "a.md").write_text("another task")
    with pytest.raises(ValueError, match="文件已变更"):
        apply_files(root, files)
    (root / "link").symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(ValueError, match="路径越界"):
        build_diffs(root, [{"path": "link/private.md", "content": "x"}])


@pytest.mark.parametrize("knowledge,quote", [("", "虚构摘录"), ("真实摘录", "虚构摘录")])
def test_plan_rejects_empty_retrieval_and_fabricated_quotes(tmp_path, knowledge, quote, monkeypatch):
    monkeypatch.setattr(m.config, "SCORE_THRESHOLD", 0.0)
    kb = tmp_path / "knowledge"
    kb.mkdir()
    if knowledge:
        (kb / "doc.md").write_text(knowledge)
    rag = RagStore(tmp_path / "rag.sqlite3", embedder=HashEmbedder())
    rag.ingest_dir(kb)

    class Provider(BaseProvider):
        def chat(self, messages, tools=None):
            if any(x.get("role") == "tool" and "方案生成失败" in x.get("content", "") for x in messages):
                return ChatResponse(content="请补充资料。")
            return ChatResponse(tool_calls=[{"id": "p", "name": "draft_plan", "arguments": {
                "title": "方案", "steps": [{"title": "步骤"}], "evidence": [{"source": "doc.md", "quote": quote}],
            }}])

    events = list(run_agent(Provider(), ToolExecutor(rag), "需求", plan_mode=True))
    assert not any(e["type"] == "plan" for e in events)


def test_edit_and_regenerate_replace_persisted_branch(tmp_app):
    c = TestClient(m.app)
    sid = c.post("/api/sessions").json()["id"]
    for text in ("第一问", "第二问"):
        c.post("/api/chat", json={"session_id": sid, "message": text, "allow_fetch": False})
    original = c.get(f"/api/sessions/{sid}/messages").json()["messages"]
    response = c.post("/api/chat", json={"session_id": sid, "message": "修改后的第一问", "replace_from_id": original[0]["id"]})
    assert response.status_code == 200
    edited = c.get(f"/api/sessions/{sid}/messages").json()["messages"]
    assert len(edited) == 2 and edited[0]["content"] == "修改后的第一问"
    c.post("/api/chat", json={"session_id": sid, "message": edited[0]["content"], "replace_from_id": edited[1]["id"]})
    assert len(c.get(f"/api/sessions/{sid}/messages").json()["messages"]) == 2
    assert c.post("/api/chat", json={"session_id": "foreign", "message": "x"}).status_code == 404
    assert c.post("/api/chat", json={"session_id": sid, "message": "x", "replace_from_id": 999999}).status_code == 404


def test_restart_recovers_running_tasks(tmp_path):
    path = tmp_path / "chat.sqlite3"
    store = ChatStore(path)
    sid = store.create_session()["id"]
    task = store.add_tasks(sid, 1, [{"plan_id": "p", "title": "task"}])[0]
    store.update_task(task["id"], "running")
    store.conn.close()
    reopened = ChatStore(path)
    assert reopened.get_task(task["id"])["status"] == "failed"


def test_snapshot_recovers_database_keys_and_files(tmp_path):
    local, persistent = tmp_path / "local", tmp_path / "persistent"
    store = ChatStore(local / "clients/a/chat.sqlite3")
    sid = store.create_session()["id"]
    store.add_message(sid, "user", "私有消息")
    (local / "config_encryption.key").write_text("test-key")
    docs = local / "clients/a/knowledge"
    docs.mkdir()
    (docs / "doc.md").write_text("知识正文")
    manager = SnapshotManager(local, persistent)
    manager.checkpoint()
    # 最新半成品不能覆盖上一个完整快照。
    (persistent / "snapshot-999999999999999999999.json").write_text('{"archive":"missing.tar.gz","sha256":"bad"}')
    restored = tmp_path / "restored"
    SnapshotManager(restored, persistent).restore()
    with sqlite3.connect(restored / "clients/a/chat.sqlite3") as conn:
        assert conn.execute("SELECT content FROM messages").fetchone()[0] == "私有消息"
    assert (restored / "config_encryption.key").read_text() == "test-key"
    assert (restored / "clients/a/knowledge/doc.md").read_text() == "知识正文"


def test_corrupt_snapshot_fails_closed(tmp_path):
    persistent = tmp_path / "persistent"
    persistent.mkdir()
    (persistent / "snapshot-bad.json").write_text("{}")
    with pytest.raises(RuntimeError, match="不可恢复"):
        SnapshotManager(tmp_path / "local", persistent).restore()


def test_public_mode_requires_personal_key_and_ignores_shared_key(tmp_app, monkeypatch):
    monkeypatch.setattr(m.config, "LLM_API_KEY", "platform-key-must-not-be-used")
    monkeypatch.setattr(m.config, "LLM_PROVIDER", "openai")
    monkeypatch.setattr(m.config, "REQUIRE_USER_API_KEY", True)
    monkeypatch.setattr(m.config, "MULTI_TENANT", True)
    c = TestClient(m.app)
    assert c.get("/api/config").json()["has_key"] is False
    assert c.post("/api/chat", json={"message": "测试"}).status_code == 400


def test_workspace_bootstrap_confirms_cookie(tmp_app):
    c = TestClient(m.app)
    assert c.post("/api/workspace").json()["cookie_ready"] is False
    assert c.get("/api/workspace").json()["cookie_ready"] is True


def test_folder_upload_rejects_absolute_paths(tmp_app):
    c = TestClient(m.app)
    for path in ("/etc/private.md", "C:/private.md"):
        response = c.post("/api/knowledge/upload-dir", files=[("files", ("private.md", b"test")), ("paths", (None, path))])
        assert response.status_code == 200
        assert response.json()["saved"] == [] and response.json()["skipped"] == [path]


def test_anonymous_data_survives_cold_restart(tmp_path, monkeypatch):
    for attr in ("_store", "_rag", "_executor", "_provider"):
        monkeypatch.setattr(m, attr, None)
    local = tmp_path / "data"
    monkeypatch.setattr(m.config, "DB_PATH", local / "rag.sqlite3")
    monkeypatch.setattr(m.config, "CLIENTS_DIR", local / "clients")
    monkeypatch.setattr(m.config, "SNAPSHOT_DIR", str(tmp_path / "snapshots"))
    monkeypatch.setattr(m.config, "CLIENT_COOKIE_SECRET", "")
    monkeypatch.setattr(m.config, "LLM_PROVIDER", "mock")
    monkeypatch.setattr(m.config, "EMBED_BACKEND", "hash")
    m._workspaces.clear()
    with TestClient(m.app) as c:
        sid = c.post("/api/sessions").json()["id"]
        c.post("/api/chat", json={"session_id": sid, "message": "重启前的消息"})
        c.post("/api/config", json={"api_key": "sk-local-test"})
        cookies = dict(c.cookies)
    local.rename(tmp_path / "previous-data")
    with TestClient(m.app) as c:
        c.cookies.update(cookies)
        assert c.get(f"/api/sessions/{sid}").status_code == 200
        assert c.get(f"/api/sessions/{sid}/messages").json()["messages"][0]["content"] == "重启前的消息"
        assert c.get("/api/config").json()["has_key"] is True
