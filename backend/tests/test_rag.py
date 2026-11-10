"""RAG 向量库测试：入库、删除、脏块清理（已删除文件的残留块）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.embedder import HashEmbedder  # noqa: E402
from app.rag import RagStore  # noqa: E402


def make_rag(tmp_path):
    rag = RagStore(tmp_path / "rag.sqlite3")
    rag.embedder = HashEmbedder()
    return rag


def test_ingest_and_search(tmp_path):
    rag = make_rag(tmp_path)
    kb = tmp_path / "kb"
    kb.mkdir()
    (kb / "doc.md").write_text("# 制度\n\n报销需在 7 日内提交发票与行程单。", encoding="utf-8")
    n = rag.ingest_dir(kb)
    assert n > 0
    hits = rag.search("报销 发票")
    assert hits and any("发票" in t for _, t, _ in hits)
    assert rag.sources() == [("doc.md", n)]


def test_ingest_is_incremental(tmp_path):
    """mtime 未变时跳过重建。"""
    rag = make_rag(tmp_path)
    kb = tmp_path / "kb"
    kb.mkdir()
    f = kb / "doc.md"
    f.write_text("内容 A", encoding="utf-8")
    rag.ingest_dir(kb)
    assert rag.ingest_dir(kb) == 0  # 第二次不重复入库


def test_prune_stale_chunks_of_deleted_files(tmp_path):
    """文件被删除后，残留块必须清掉（回归：曾导致个人文档块永久污染检索）。"""
    rag = make_rag(tmp_path)
    kb = tmp_path / "kb"
    kb.mkdir()
    secret = kb / "secret.md"
    secret.write_text("机密内容 ZZZ-9999 用于验证清理", encoding="utf-8")
    rag.ingest_dir(kb)
    assert rag.sources()
    secret.unlink()
    rag.ingest_dir(kb)
    assert rag.sources() == []
    assert not rag.search("机密内容 ZZZ-9999")


def test_delete_source(tmp_path):
    rag = make_rag(tmp_path)
    kb = tmp_path / "kb"
    kb.mkdir()
    (kb / "a.md").write_text("文档 A 内容", encoding="utf-8")
    (kb / "b.md").write_text("文档 B 内容", encoding="utf-8")
    rag.ingest_dir(kb)
    removed = rag.delete_source("a.md")
    assert removed > 0
    assert [s for s, _ in rag.sources()] == ["b.md"]


def test_delete_source_escapes_like_wildcards(tmp_path):
    """文件名中的 % / _ 不能被 SQLite LIKE 当成通配符误删其他文档。"""
    rag = make_rag(tmp_path)
    kb = tmp_path / "kb"
    kb.mkdir()
    (kb / "a_b.md").write_text("下划线文档内容", encoding="utf-8")
    (kb / "axb.md").write_text("普通文档内容", encoding="utf-8")
    rag.ingest_dir(kb)
    assert rag.delete_source("%") == 0
    assert len(rag.sources()) == 2
    assert rag.delete_source("a_b.md") > 0
    assert [s for s, _ in rag.sources()] == ["axb.md"]
