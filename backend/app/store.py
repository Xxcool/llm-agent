"""会话与消息持久化（SQLite，与向量库分文件）。"""
import sqlite3
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from . import config


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class ChatStore:
    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = Path(db_path or (Path(config.DB_PATH).parent / "chat.sqlite3"))
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._lock = threading.Lock()
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
              id TEXT PRIMARY KEY,
              title TEXT,
              created_at TEXT,
              updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT,
              role TEXT,
              content TEXT,
              steps TEXT DEFAULT '[]',
              created_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
            """
        )
        self.conn.commit()

    def create_session(self, title: str = "新会话") -> dict:
        sid = uuid.uuid4().hex[:12]
        now = _now()
        with self._lock:
            self.conn.execute(
                "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?,?,?,?)",
                (sid, title, now, now),
            )
            self.conn.commit()
        return {"id": sid, "title": title, "created_at": now, "updated_at": now}

    def list_sessions(self) -> List[dict]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT id, title, updated_at FROM sessions ORDER BY updated_at DESC"
            ).fetchall()
        return [{"id": r[0], "title": r[1], "updated_at": r[2]} for r in rows]

    def delete_session(self, sid: str) -> None:
        with self._lock:
            self.conn.execute("DELETE FROM messages WHERE session_id=?", (sid,))
            self.conn.execute("DELETE FROM sessions WHERE id=?", (sid,))
            self.conn.commit()

    def get_messages(self, sid: str) -> List[dict]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT id, role, content, steps FROM messages WHERE session_id=? ORDER BY id",
                (sid,),
            ).fetchall()
        import json

        return [
            {"id": r[0], "role": r[1], "content": r[2], "steps": json.loads(r[3] or "[]")}
            for r in rows
        ]

    def add_message(self, sid: str, role: str, content: str, steps: Optional[list] = None) -> None:
        import json

        now = _now()
        with self._lock:
            self.conn.execute(
                "INSERT INTO messages (session_id, role, content, steps, created_at) VALUES (?,?,?,?,?)",
                (sid, role, content, json.dumps(steps or [], ensure_ascii=False), now),
            )
            # 首条用户消息作为会话标题
            if role == "user":
                title = self.conn.execute(
                    "SELECT title FROM sessions WHERE id=?", (sid,)
                ).fetchone()
                if title and title[0] == "新会话":
                    self.conn.execute(
                        "UPDATE sessions SET title=? WHERE id=?", (content[:24], sid)
                    )
            self.conn.execute(
                "UPDATE sessions SET updated_at=? WHERE id=?", (now, sid)
            )
            self.conn.commit()

    def history(self, sid: str, limit: int = 12) -> List[dict]:
        """取最近 N 条消息（按时间正序返回），供多轮上下文使用。"""
        with self._lock:
            rows = self.conn.execute(
                "SELECT role, content FROM messages WHERE session_id=? AND role IN ('user','assistant') "
                "ORDER BY id DESC LIMIT ?",
                (sid, limit),
            ).fetchall()
        return [{"role": r[0], "content": r[1]} for r in reversed(rows)]
