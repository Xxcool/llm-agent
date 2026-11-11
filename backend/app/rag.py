"""RAG：文档分块入库（SQLite）+ 向量相似度检索。"""
import re
import sqlite3
import threading
from pathlib import Path
from typing import List, Tuple

from . import config
from .embedder import FastembedEmbedder, get_embedder

CHUNK_SIZE = 500  # 字符
CHUNK_OVERLAP = 50
# 分块算法版本：变更切分策略时递增，旧分块签名不匹配会被自动淘汰重建
CHUNK_VERSION = "s3"
# 分块签名 = 相对路径|mtime_ns|版本，用 | 分隔（相对路径不含该字符）
SIG_SEP = "|"
_HEADING_RE = re.compile(r"^#{1,3}\s")


def _escape_like(value: str) -> str:
    """转义 SQLite LIKE 通配符，避免文件名中的 % / _ 误删其他文档分块。"""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _hard_split(block: str) -> List[str]:
    """超长小节：按段落合并到 CHUNK_SIZE，单段仍超长则硬切。"""
    out, buf = [], ""
    for p in [x.strip() for x in block.split("\n") if x.strip()]:
        if len(buf) + len(p) + 1 <= CHUNK_SIZE:
            buf = f"{buf}\n{p}".strip()
        else:
            if buf:
                out.append(buf)
            while len(p) > CHUNK_SIZE:
                out.append(p[:CHUNK_SIZE])
                p = p[CHUNK_SIZE - CHUNK_OVERLAP:]
            buf = p
    if buf:
        out.append(buf)
    return out


def _chunks(text: str) -> List[str]:
    """按 Markdown 标题切小节，每节尽量独立成块。

    500 字整篇切块会让「差旅标准」「报销流程」挤在同一块里，检索命中后
    不管问什么都返回文档开头。按标题切分后，问住宿标准命中「差旅标准」，
    问流程命中「报销流程」，摘录才能真正贴合提问。
    """
    sections: List[List[str]] = []
    cur: List[str] = []
    for line in text.replace("\r\n", "\n").split("\n"):
        heading = bool(_HEADING_RE.match(line))
        # 只有当前小节已经带上正文才切分；否则新标题并入当前小节，
        # 避免「# 文档标题」这种只有一行标题的块单独成为一条检索结果
        has_body = any(x.strip() and not _HEADING_RE.match(x) for x in cur)
        if heading and has_body:
            sections.append(cur)
            cur = [line]
        else:
            cur.append(line)
    if any(x.strip() for x in cur):
        sections.append(cur)

    out: List[str] = []
    for sec in sections:
        block = "\n".join(sec).strip()
        if not block:
            continue
        if len(block) <= CHUNK_SIZE:
            out.append(block)
        else:
            out.extend(_hard_split(block))
    return out


class RagStore:
    def __init__(self, db_path: Path = None, embedder=None):
        self.db_path = Path(db_path or config.DB_PATH)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        # FastAPI 同步/异步端点可能在不同线程访问，check_same_thread=False + 写锁
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._lock = threading.Lock()
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS chunks ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, seq INTEGER, text TEXT, vec TEXT)"
        )
        self.embedder = embedder or get_embedder()
        # 语义模型是否可用：降级为 hash 向量时余弦分数天然偏低，需启用字面兜底
        self.is_semantic = isinstance(self.embedder, FastembedEmbedder)

    def ingest_dir(self, docs_dir: Path) -> int:
        """目录（含子目录）下所有 .md/.txt 入库（按相对路径+mtime 增量跳过未变更文件）。

        入库前先清理「文件已删除但块仍残留」的脏数据，避免已移除的文档继续污染检索结果。
        """
        n = 0
        root = Path(docs_dir)
        with self._lock:
            live = {
                str(f.relative_to(root))
                for f in root.rglob("*")
                if f.is_file() and f.suffix.lower() in (".md", ".txt", ".markdown")
            }
            stale = [
                r[0] for r in self.conn.execute("SELECT DISTINCT source FROM chunks").fetchall()
                if r[0].split(SIG_SEP, 1)[0] not in live
            ]
            for sig in stale:
                self.conn.execute("DELETE FROM chunks WHERE source=?", (sig,))
            if stale:
                self.conn.commit()

            for f in sorted(root.rglob("*")):
                if not f.is_file() or f.suffix.lower() not in (".md", ".txt", ".markdown"):
                    continue
                rel = f.relative_to(root)
                model = config.EMBED_MODEL if self.is_semantic else str(self.embedder.dim)
                sig = f"{rel}{SIG_SEP}{f.stat().st_mtime_ns}{SIG_SEP}{CHUNK_VERSION}:{type(self.embedder).__name__}:{model}"
                row = self.conn.execute(
                    "SELECT COUNT(*) FROM chunks WHERE source=?", (sig,)
                ).fetchone()[0]
                if row:
                    continue
                self.conn.execute(
                    "DELETE FROM chunks WHERE source LIKE ? ESCAPE '\\'",
                    (f"{_escape_like(str(rel))}{SIG_SEP}%",),
                )
                text = f.read_text(encoding="utf-8")
                chunks = _chunks(text)
                vecs = self.embedder.embed(chunks)
                for i, (c, v) in enumerate(zip(chunks, vecs)):
                    self.conn.execute(
                        "INSERT INTO chunks (source, seq, text, vec) VALUES (?,?,?,?)",
                        (sig, i, c, ",".join(f"{x:.6f}" for x in v)),
                    )
                n += len(chunks)
            self.conn.commit()
        return n

    def sources(self) -> List[Tuple[str, int]]:
        """已入库文档列表：[(相对路径, 分块数)]。"""
        rows = self.conn.execute(
            "SELECT source, COUNT(*) FROM chunks GROUP BY source ORDER BY source"
        ).fetchall()
        return [(s.split(SIG_SEP, 1)[0], int(c)) for s, c in rows]

    def delete_source(self, rel: str) -> int:
        """删除某文档的全部分块，返回删除数。"""
        with self._lock:
            cur = self.conn.execute(
                "DELETE FROM chunks WHERE source LIKE ? ESCAPE '\\'",
                (f"{_escape_like(rel)}{SIG_SEP}%",),
            )
            self.conn.commit()
        return cur.rowcount

    def search(
        self,
        query: str,
        top_k: int = None,
        boosts: dict[str, float] | None = None,
    ) -> List[Tuple[str, str, float]]:
        top_k = top_k or config.TOP_K
        qv = self.embedder.embed([query])[0]
        boosts = boosts or {}
        best: List[Tuple[str, str, float]] = []
        for source, text, vec in self.conn.execute("SELECT source, text, vec FROM chunks"):
            v = [float(x) for x in vec.split(",")]
            rel = source.split(SIG_SEP, 1)[0]
            score = sum(a * b for a, b in zip(qv, v)) + boosts.get(rel, 0.0)
            best.append((rel, text, score))
        best.sort(key=lambda x: -x[2])
        return [(rel, t, round(sc, 4)) for rel, t, sc in best[:top_k]]

    def search_keyword(self, query: str, top_k: int = None) -> List[Tuple[str, str, float]]:
        """字面 2-gram 覆盖率兜底召回。

        fastembed 模型不可用时向量降级为字符哈希，余弦分数会被长文档稀释，
        固定语义阈值（0.58）会把全部结果过滤掉。此时改用「查询片段有多少
        出现在文档里」来召回，分数与文档长度无关，保证离线/演示模式仍可
        完整走通「检索 → 引用来源 → 生成摘录」链路。仅在非语义模型下启用。
        """
        top_k = top_k or config.TOP_K
        q = re.sub(r"\s+", "", query)
        grams = {q[i:i + 2] for i in range(len(q) - 1)} or {q}
        if not q or not grams:
            return []
        scored: List[Tuple[str, str, float]] = []
        for source, text in self.conn.execute("SELECT source, text FROM chunks"):
            t = re.sub(r"\s+", "", text)
            coverage = sum(1 for g in grams if g in t) / len(grams)
            if coverage >= 0.2:
                scored.append((source.split(SIG_SEP, 1)[0], text, round(coverage, 4)))
        scored.sort(key=lambda x: -x[2])
        return scored[:top_k]
