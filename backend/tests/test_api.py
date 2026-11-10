"""API 集成测试（FastAPI TestClient）：健康探测、配置掩码、会话生命周期、SSE 对话、反馈。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def _parse_sse(text: str) -> list:
    events = []
    for line in text.splitlines():
        if line.startswith("data:"):
            data = line[5:].strip()
            if data and data != "[DONE]":
                events.append(json.loads(data))
    return events


def test_health_reports_mock_ok(tmp_app):
    r = client.get("/api/health")
    assert r.status_code == 200
    d = r.json()
    assert d["provider"] == "mock"
    assert d["ok"] is True


def test_config_masks_api_key(tmp_app):
    # 先写入一个运行时 Key
    r = client.post("/api/config", json={"base_url": "https://api.x.com", "model": "m", "api_key": "sk-1234567890abcdef"})
    assert r.status_code == 200
    d = client.get("/api/config").json()
    assert d["has_key"] is True
    assert "abcdef" not in json.dumps(d)  # 明文绝不出现
    assert "••••" in (d.get("key_masked") or "")


def test_session_lifecycle(tmp_app):
    # 创建 → 空会话不出现在列表
    sid = client.post("/api/sessions").json()["id"]
    assert [s["id"] for s in client.get("/api/sessions").json()["sessions"]] == []
    # 单查
    assert client.get(f"/api/sessions/{sid}").json()["id"] == sid
    assert client.get("/api/sessions/nope").status_code == 404
    # 重命名 + 置顶
    client.patch(f"/api/sessions/{sid}", json={"title": "测试会话", "pinned": True})
    d = client.get(f"/api/sessions/{sid}").json()
    assert d["title"] == "测试会话" and d["pinned"] is True
    # 删除
    client.delete(f"/api/sessions/{sid}")
    assert client.get(f"/api/sessions/{sid}").status_code == 404


def test_chat_sse_full_pipeline(tmp_app):
    """完整对话链路：知识入库 → SSE 流（工具调用+生成）→ 消息持久化 → 反馈落库。"""
    # 1) 注入知识文档
    marker = "TX-8899"
    r = client.post("/api/knowledge/text", json={
        "name": "验证文档",
        "text": f"公司专用报销通道编号为 {marker}，所有差旅报销必须走该通道提交。",
    })
    assert r.status_code == 200

    # 2) SSE 对话（force_retrieval = 前端知识检索开关）
    sid = client.post("/api/sessions").json()["id"]
    r = client.post("/api/chat", json={
        "message": "公司报销通道编号是多少？",
        "session_id": sid,
        "force_retrieval": True,
        "allow_fetch": True,
    })
    assert r.status_code == 200
    events = _parse_sse(r.text)
    types = [e["type"] for e in events]
    assert "tool_call" in types and "tool_result" in types
    assert types[-1] == "done"
    # 检索结果命中验证文档
    tool_result = next(e["content"] for e in events if e["type"] == "tool_result")
    assert marker in tool_result
    # 回答包含检索到的来源与内容（Mock 摘录式回答）
    answer = "".join(e["content"] for e in events if e["type"] == "token")
    assert marker in answer and "验证文档" in answer

    # 3) 消息持久化：user + assistant 各一条，标题自动生成
    msgs = client.get(f"/api/sessions/{sid}/messages").json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[1]["steps"], "assistant 消息应带工具步骤"
    assert client.get(f"/api/sessions/{sid}").json()["title"] != "新会话"

    # 4) 反馈落库
    mid = msgs[1]["id"]
    r = client.post(f"/api/messages/{mid}/feedback",
                    json={"type": "down", "reason": "信息虚假", "comment": "测试反馈"})
    assert r.status_code == 200
    fb = client.get(f"/api/sessions/{sid}/messages").json()["messages"][1]["feedback"]
    assert fb["type"] == "down" and fb["reason"] == "信息虚假"
    # 非法 type 被拒
    assert client.post(f"/api/messages/{mid}/feedback", json={"type": "bad"}).status_code == 422
    # 清理
    client.delete(f"/api/knowledge?source=uploads/验证文档.md")
    client.delete(f"/api/sessions/{sid}")


def test_chat_error_persisted_as_content(tmp_app):
    """模型异常时错误写入消息内容，刷新后不空白。"""
    class Broken:
        name = "broken"

    tmp_app._provider = Broken()  # 无 chat 方法 → 触发异常分支
    sid = client.post("/api/sessions").json()["id"]
    r = client.post("/api/chat", json={"message": "你好", "session_id": sid})
    events = _parse_sse(r.text)
    assert any(e["type"] == "error" for e in events)
    msgs = client.get(f"/api/sessions/{sid}/messages").json()["messages"]
    assert "⚠️" in msgs[-1]["content"]
    client.delete(f"/api/sessions/{sid}")


def test_knowledge_upload_rejects_bad_type(tmp_app):
    r = client.post("/api/knowledge/upload", files={"file": ("x.exe", b"bin", "application/octet-stream")})
    assert r.status_code == 400


def test_tts_synthesizes_and_caches(tmp_app, monkeypatch):
    """/api/tts：合成成功返回 MP3 + 缓存命中，失败 502，前端据此降级本地 TTS。"""
    import app.main as m

    calls = []

    async def fake_synth(text: str, voice: str) -> bytes:
        calls.append((text, voice))
        return b"FAKE_MP3_" + text.encode("utf-8")

    monkeypatch.setattr(m, "_tts_synth", fake_synth)
    r = client.get("/api/tts", params={"text": "你好世界"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/mpeg")
    assert r.content == b"FAKE_MP3_" + "你好世界".encode("utf-8")
    # 相同文本 + 音色 → 缓存命中，不再调用合成
    r2 = client.get("/api/tts", params={"text": "你好世界"})
    assert r2.content == r.content
    assert len(calls) == 1
    # 不同音色 → 重新合成
    client.get("/api/tts", params={"text": "你好世界", "voice": "zh-CN-YunxiNeural"})
    assert any(v == "zh-CN-YunxiNeural" for _, v in calls)


def test_tts_failure_returns_502(tmp_app, monkeypatch):
    """合成服务异常 → 502（前端降级浏览器 TTS），空文本 → 400。"""
    import app.main as m

    async def broken(text: str, voice: str) -> bytes:
        raise RuntimeError("网络不可达")

    monkeypatch.setattr(m, "_tts_synth", broken)
    r = client.get("/api/tts", params={"text": "测试失败降级"})
    assert r.status_code == 502
    assert client.get("/api/tts", params={"text": "   "}).status_code == 400
