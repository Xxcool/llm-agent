"""RAG：文档分块入库（SQLite）+ 向量相似度检索。"""
import sqlite3
from pathlib import Path
from typing import List, Tuple

from . import config
from .embedder import get_embedder

CHUNK_SIZE = 500  # 字符
CHUNK_OVERLAP = 50


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
    def __init__(self, db_path: Path = None):
        self.db_path = Path(db_path or config.DB_PATH)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path)
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS chunks ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, seq INTEGER, text TEXT, vec TEXT)"
        )
        self.embedder = get_embedder()

    def ingest_dir(self, docs_dir: Path) -> int:
        """目录（含子目录）下所有 .md/.txt 入库（按相对路径+mtime 增量跳过未变更文件）。"""
        n = 0
        root = Path(docs_dir)
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
            self.conn.execute("DELETE FROM chunks WHERE source LIKE ?", (f"{rel}:%",))
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

    def search(self, query: str, top_k: int = None) -> List[Tuple[str, str, float]]:
        top_k = top_k or config.TOP_K
        qv = self.embedder.embed([query])[0]
        best: List[Tuple[str, str, float]] = []
        for source, text, vec in self.conn.execute("SELECT source, text, vec FROM chunks"):
            v = [float(x) for x in vec.split(",")]
            score = sum(a * b for a, b in zip(qv, v))
            best.append((source, text, score))
        best.sort(key=lambda x: -x[2])
        return [(s.split(":")[0], t, round(sc, 4)) for s, t, sc in best[:top_k]]
