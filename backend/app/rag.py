"""RAG：文档分块入库（SQLite）+ 向量相似度检索。"""
import sqlite3
import threading
from pathlib import Path
from typing import List, Tuple

from . import config
from .embedder import get_embedder

CHUNK_SIZE = 500  # 字符
CHUNK_OVERLAP = 50


def _escape_like(value: str) -> str:
    """转义 SQLite LIKE 通配符，避免文件名中的 % / _ 误删其他文档分块。"""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _chunks(text: str) -> List[str]:
    paras = [p.strip() for p in text.replace("\r\n", "\n").split("\n") if p.strip()]
    merged, buf = [], ""
    for p in paras:
        if len(buf) + len(p) + 1 <= CHUNK_SIZE:
            buf = f"{buf}\n{p}".strip()
        else:
            if buf:
                merged.append(buf)
            while len(p) > CHUNK_SIZE:  # 超长段落硬切
                merged.append(p[:CHUNK_SIZE])
                p = p[CHUNK_SIZE - CHUNK_OVERLAP:]
            buf = p
    if buf:
        merged.append(buf)
    return merged


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
                if f.is_file() and f.suffix.lower() in (".md", ".txt")
            }
            stale = [
                r[0] for r in self.conn.execute("SELECT DISTINCT source FROM chunks").fetchall()
                if r[0].rsplit(":", 1)[0] not in live
            ]
            for sig in stale:
                self.conn.execute("DELETE FROM chunks WHERE source=?", (sig,))
            if stale:
                self.conn.commit()

            for f in sorted(root.rglob("*")):
                if not f.is_file() or f.suffix.lower() not in (".md", ".txt"):
                    continue
                rel = f.relative_to(root)
                sig = f"{rel}:{f.stat().st_mtime_ns}"
                row = self.conn.execute(
                    "SELECT COUNT(*) FROM chunks WHERE source=?", (sig,)
                ).fetchone()[0]
                if row:
                    continue
                self.conn.execute(
                    "DELETE FROM chunks WHERE source LIKE ? ESCAPE '\\'",
                    (f"{_escape_like(str(rel))}:%",),
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
        return [(s.rsplit(":", 1)[0], int(c)) for s, c in rows]

    def delete_source(self, rel: str) -> int:
        """删除某文档的全部分块，返回删除数。"""
        with self._lock:
            cur = self.conn.execute(
                "DELETE FROM chunks WHERE source LIKE ? ESCAPE '\\'",
                (f"{_escape_like(rel)}:%",),
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
            rel = source.rsplit(":", 1)[0]
            score = sum(a * b for a, b in zip(qv, v)) + boosts.get(rel, 0.0)
            best.append((rel, text, score))
        best.sort(key=lambda x: -x[2])
        return [(rel, t, round(sc, 4)) for rel, t, sc in best[:top_k]]
