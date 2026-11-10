"""离线测试：RAG 检索 + Agent 循环 + 工具执行，全程 Mock Provider / Hash Embedder。"""
import sys
from pathlib import Path

import pytest  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config  # noqa: E402
from app.agent import run_agent  # noqa: E402
from app.llm import BaseProvider, ChatResponse, MockProvider  # noqa: E402
from app.rag import RagStore  # noqa: E402
from app.tools import ToolExecutor, fetch_text, validate_public_url  # noqa: E402


def make_store(tmp_path):
    cfg = type("C", (), {**vars(config),
                         "DB_PATH": tmp_path / "test.sqlite3",
                         "KNOWLEDGE_DIR": tmp_path / "kb",
                         "TOP_K": 3,
                         "SCORE_THRESHOLD": 0.0})()
    kb = tmp_path / "kb"
    kb.mkdir(parents=True)
    (kb / "team-intro.md").write_text(
        "# 平台研发团队\n\n团队负责企业内部平台建设，核心项目：统一身份认证平台（Java + Spring Cloud），"
        "运维监控中心（Go + Prometheus），以及开发中的 LLM Agent 智能对话平台。\n",
        encoding="utf-8",
    )
    (kb / "notes.md").write_text(
        "# 技术笔记\n\nSSE 流式接口需要注意 EventSource 不支持 POST，需用 fetch 流式读取或 polyfill。\n",
        encoding="utf-8",
    )
    store = RagStore(cfg.DB_PATH)
    store.embedder = __import__("app.embedder", fromlist=["HashEmbedder"]).HashEmbedder()
    store.ingest_dir(kb)
    return store, cfg


def test_rag_search(tmp_path):
    store, _ = make_store(tmp_path)
    hits = store.search("运维监控")
    assert hits, "检索应有结果"
    assert any("Prometheus" in t for _, t, _ in hits)


def test_agent_loop_with_tools(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SCORE_THRESHOLD", 0.0)  # 关闭阈值，专注验证工具循环
    store, _ = make_store(tmp_path)
    executor = ToolExecutor(store)
    events = list(run_agent(MockProvider(), executor, "研发团队做过哪些项目？"))
    types = [e["type"] for e in events]
    assert "tool_call" in types and "tool_result" in types, types
    assert types[-1] == "done"
    answer = "".join(e["content"] for e in events if e["type"] == "token")
    assert "Prometheus" in answer


def test_search_threshold_rejects_unrelated(tmp_path, monkeypatch):
    """相似度低于阈值时如实返回「没有相关内容」，而不是硬凑不相关片段。"""
    monkeypatch.setattr(config, "SCORE_THRESHOLD", 0.99)  # 高阈值必然触发拒绝分支
    store, _ = make_store(tmp_path)
    executor = ToolExecutor(store)
    result = executor.run("search_knowledge", {"query": "研发团队做过哪些项目"})
    assert result == "知识库中没有相关内容。"


def test_tool_unknown(tmp_path):
    store, _ = make_store(tmp_path)
    executor = ToolExecutor(store)
    assert "未知工具" in executor.run("nope", {})


def test_fetch_url_rejects_non_http(tmp_path):
    store, _ = make_store(tmp_path)
    executor = ToolExecutor(store)
    assert "仅支持" in executor.run("fetch_url", {"url": "file:///etc/passwd"})


def test_validate_public_url_blocks_internal_targets():
    """SSRF 防护：内网、回环、链路本地、保留地址与 file:// 全部拒绝。"""
    for url in (
        "file:///etc/passwd",
        "http://127.0.0.1/",
        "http://10.0.0.1/",
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]/",
        "http://localhost/",
        "http://user:pass@127.0.0.1/",
    ):
        with pytest.raises(ValueError):
            validate_public_url(url)


def test_validate_public_url_allows_public_ip():
    validate_public_url("http://93.184.216.34/")


def test_fetch_text_rejects_redirect_to_private(monkeypatch):
    """首跳公网、302 跳到内网时必须拦截，不能跟随。"""
    calls = []

    class FakeResponse:
        is_redirect = True
        headers = {"location": "http://127.0.0.1/secret"}

        def close(self):
            return None

    def fake_get(url, **kwargs):
        calls.append(url)
        return FakeResponse()

    monkeypatch.setattr("app.tools.httpx.get", fake_get)
    with pytest.raises(ValueError, match="内网"):
        fetch_text("http://93.184.216.34/")
    assert calls == ["http://93.184.216.34/"]


def test_plan_evidence_source_must_come_from_retrieval(tmp_path, monkeypatch):
    """检索命中后，方案依据必须引用本轮真实来源，不能编造文件名。"""
    from app.rag import RagStore
    from app.embedder import HashEmbedder

    monkeypatch.setattr(config, "SCORE_THRESHOLD", 0.0)
    kb = tmp_path / "kb"
    kb.mkdir()
    (kb / "team.md").write_text("研发团队负责统一身份认证平台。", encoding="utf-8")
    rag = RagStore(tmp_path / "rag.sqlite3")
    rag.embedder = HashEmbedder()
    rag.ingest_dir(kb)
    executor = ToolExecutor(rag)

    class BadEvidenceProvider(BaseProvider):
        name = "bad-evidence"

        def __init__(self):
            self.round = 0

        def chat(self, messages, tools=None):
            self.round += 1
            if self.round == 1:
                return ChatResponse(tool_calls=[{
                    "id": "s1", "name": "search_knowledge",
                    "arguments": {"query": "研发团队"},
                }])
            if self.round == 2:
                return ChatResponse(tool_calls=[{
                    "id": "p1", "name": "draft_plan",
                    "arguments": {
                        "title": "团队建设方案",
                        "steps": [{"title": "梳理职责"}],
                        "evidence": [{"source": "不存在.md", "quote": "编造"}],
                    },
                }])
            return ChatResponse(content="已修正。")

    events = list(run_agent(BadEvidenceProvider(), executor, "研发团队方案", allow_fetch=False))
    assert not [e for e in events if e["type"] == "plan"]
    assert any("依据来源不在本轮检索结果中" in (e.get("content") or "")
               for e in events if e["type"] == "tool_result")
    assert events[-1]["type"] == "done"
