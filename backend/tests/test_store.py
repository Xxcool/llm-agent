"""会话与消息持久化测试：增删改查、置顶排序、标题自动生成、反馈落库、空会话过滤。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.store import ChatStore  # noqa: E402


def make_store(tmp_path):
    return ChatStore(tmp_path / "chat.sqlite3")


def test_create_and_get_session(tmp_path):
    store = make_store(tmp_path)
    s = store.create_session()
    assert s["id"] and s["title"] == "新会话"
    got = store.get_session(s["id"])
    assert got["id"] == s["id"]


def test_first_user_message_sets_title(tmp_path):
    store = make_store(tmp_path)
    sid = store.create_session()["id"]
    store.add_message(sid, "user", "差旅报销的流程是什么？谁能审批？")
    assert store.get_session(sid)["title"] == "差旅报销的流程是什么？谁能审批？"[:24]


def test_empty_sessions_hidden_in_list(tmp_path):
    """点开新对话但没聊的会话不进历史列表。"""
    store = make_store(tmp_path)
    empty = store.create_session()
    used = store.create_session()
    store.add_message(used["id"], "user", "你好")
    ids = [s["id"] for s in store.list_sessions()]
    assert used["id"] in ids
    assert empty["id"] not in ids


def test_pinned_sessions_sort_first(tmp_path):
    store = make_store(tmp_path)
    a = store.create_session()
    b = store.create_session()
    c = store.create_session()
    for sid in (a["id"], b["id"], c["id"]):
        store.add_message(sid, "user", "问题 " + sid)
    # c 置顶后应排在最前（即使它更新时间不是最新）
    store.update_session(c["id"], pinned=True)
    first = store.list_sessions()[0]
    assert first["id"] == c["id"]
    assert first["pinned"] is True
    # 取消置顶恢复按时间排序
    store.update_session(c["id"], pinned=False)
    assert store.list_sessions()[0]["id"] != c["id"] or len(store.list_sessions()) == 1


def test_rename_session(tmp_path):
    store = make_store(tmp_path)
    sid = store.create_session()["id"]
    store.update_session(sid, title="新名字")
    assert store.get_session(sid)["title"] == "新名字"
    # 空白标题回退为默认
    store.update_session(sid, title="   ")
    assert store.get_session(sid)["title"] == "新会话"
    # 不存在的会话返回 None
    assert store.update_session("nope", title="x") is None


def test_feedback_roundtrip(tmp_path):
    store = make_store(tmp_path)
    sid = store.create_session()["id"]
    store.add_message(sid, "user", "问题")
    mid = store.add_message(sid, "assistant", "回答") or store.get_messages(sid)[-1]["id"]
    # 写入点踩反馈
    ok = store.update_feedback(mid, {"type": "down", "reason": "信息虚假", "comment": "来源不对"})
    assert ok is True
    fb = store.get_messages(sid)[-1]["feedback"]
    assert fb["type"] == "down" and fb["reason"] == "信息虚假"
    # 清除
    store.update_feedback(mid, None)
    assert store.get_messages(sid)[-1]["feedback"] is None


def test_history_returns_recent_in_order(tmp_path):
    store = make_store(tmp_path)
    sid = store.create_session()["id"]
    for i in range(5):
        store.add_message(sid, "user", f"问题{i}")
        store.add_message(sid, "assistant", f"回答{i}")
    history = store.history(sid, limit=4)
    assert [m["content"] for m in history] == ["问题3", "回答3", "问题4", "回答4"]
    assert all(m["role"] in ("user", "assistant") for m in history)


def test_delete_session_cascades_messages(tmp_path):
    store = make_store(tmp_path)
    sid = store.create_session()["id"]
    store.add_message(sid, "user", "问题")
    store.delete_session(sid)
    assert store.get_messages(sid) == []
    assert store.get_session(sid) is None
