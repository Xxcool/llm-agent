"""离线测试：RAG 检索 + Agent 循环 + 工具执行，全程 Mock Provider / Hash Embedder。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config  # noqa: E402
from app.agent import run_agent  # noqa: E402
from app.llm import MockProvider  # noqa: E402
from app.rag import RagStore  # noqa: E402
from app.tools import ToolExecutor  # noqa: E402


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
