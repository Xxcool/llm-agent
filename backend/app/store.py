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
            CREATE TABLE IF NOT EXISTS tasks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT,
              message_id INTEGER,
              plan_id TEXT,
              title TEXT,
              detail TEXT,
              output TEXT,
              kind TEXT DEFAULT 'doc',
              status TEXT DEFAULT 'pending',
              artifact TEXT,
              files TEXT,
              checks TEXT,
              archive_path TEXT,
              created_at TEXT,
              updated_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
            """
        )
        self.conn.commit()
        # 旧库迁移：sessions 补 pinned 列
        cols = [r[1] for r in self.conn.execute("PRAGMA table_info(sessions)").fetchall()]
        if "pinned" not in cols:
            with self._lock:
                self.conn.execute("ALTER TABLE sessions ADD COLUMN pinned INTEGER DEFAULT 0")
                self.conn.commit()
        # 旧库迁移：messages 补 feedback 列（点赞/点踩持久化）
        mcols = [r[1] for r in self.conn.execute("PRAGMA table_info(messages)").fetchall()]
        if "feedback" not in mcols:
            with self._lock:
                self.conn.execute("ALTER TABLE messages ADD COLUMN feedback TEXT")
                self.conn.commit()
        # 旧库迁移：messages 补 plan 列（结构化方案 JSON，含确认状态）
        if "plan" not in mcols:
            with self._lock:
                self.conn.execute("ALTER TABLE messages ADD COLUMN plan TEXT")
                self.conn.commit()
        # 旧库迁移：tasks 补 kind / files / checks（P3/M4 代码类交付）
        tcols = [r[1] for r in self.conn.execute("PRAGMA table_info(tasks)").fetchall()]
        for col, ddl in (
            ("kind", "ALTER TABLE tasks ADD COLUMN kind TEXT DEFAULT 'doc'"),
            ("files", "ALTER TABLE tasks ADD COLUMN files TEXT"),
            ("checks", "ALTER TABLE tasks ADD COLUMN checks TEXT"),
            ("archive_path", "ALTER TABLE tasks ADD COLUMN archive_path TEXT"),
        ):
            if col not in tcols:
                with self._lock:
                    self.conn.execute(ddl)
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
        return {"id": sid, "title": title, "pinned": False, "created_at": now, "updated_at": now}

    def list_sessions(self) -> List[dict]:
        """只返回已有消息的会话——空会话（点开新对话但没聊）不进历史列表。"""
        with self._lock:
            rows = self.conn.execute(
                "SELECT id, title, pinned, updated_at FROM sessions "
                "WHERE EXISTS (SELECT 1 FROM messages m WHERE m.session_id = sessions.id) "
                "ORDER BY pinned DESC, updated_at DESC"
            ).fetchall()
        return [{"id": r[0], "title": r[1], "pinned": bool(r[2]), "updated_at": r[3]} for r in rows]

    def update_session(self, sid: str, title: Optional[str] = None, pinned: Optional[bool] = None) -> Optional[dict]:
        sets, args = [], []
        if title is not None:
            sets.append("title=?")
            args.append(title.strip() or "新会话")
        if pinned is not None:
            sets.append("pinned=?")
            args.append(1 if pinned else 0)
        if not sets:
            return None
        args.append(sid)
        with self._lock:
            cur = self.conn.execute(f"UPDATE sessions SET {', '.join(sets)} WHERE id=?", args)
            self.conn.commit()
            if cur.rowcount == 0:
                return None
            row = self.conn.execute(
                "SELECT id, title, pinned, updated_at FROM sessions WHERE id=?", (sid,)
            ).fetchone()
        return {"id": row[0], "title": row[1], "pinned": bool(row[2]), "updated_at": row[3]}

    def get_session(self, sid: str) -> Optional[dict]:
        with self._lock:
            row = self.conn.execute(
                "SELECT id, title, pinned, updated_at FROM sessions WHERE id=?", (sid,)
            ).fetchone()
        if not row:
            return None
        return {"id": row[0], "title": row[1], "pinned": bool(row[2]), "updated_at": row[3]}

    def delete_session(self, sid: str) -> None:
        with self._lock:
            self.conn.execute("DELETE FROM messages WHERE session_id=?", (sid,))
            self.conn.execute("DELETE FROM tasks WHERE session_id=?", (sid,))
            self.conn.execute("DELETE FROM sessions WHERE id=?", (sid,))
            self.conn.commit()

    def get_messages(self, sid: str) -> List[dict]:
        from .plans import normalize_plan_list

        with self._lock:
            rows = self.conn.execute(
                "SELECT id, role, content, steps, feedback, plan, created_at "
                "FROM messages WHERE session_id=? ORDER BY id",
                (sid,),
            ).fetchall()
        import json

        return [
            {
                "id": r[0],
                "role": r[1],
                "content": r[2],
                "steps": json.loads(r[3] or "[]"),
                "feedback": json.loads(r[4]) if r[4] else None,
                # 方案统一以列表返回（兼容 M1 存量的单个对象）
                "plans": normalize_plan_list(json.loads(r[5]) if r[5] else None),
                "created_at": r[6],
            }
            for r in rows
        ]

    def update_feedback(self, mid: int, feedback: Optional[dict]) -> bool:
        """写入/清除某条消息的反馈；feedback 为 None 表示清除。"""
        import json

        with self._lock:
            cur = self.conn.execute(
                "UPDATE messages SET feedback=? WHERE id=?",
                (json.dumps(feedback, ensure_ascii=False) if feedback else None, mid),
            )
            self.conn.commit()
        return cur.rowcount > 0

    def get_message(self, mid: int) -> Optional[dict]:
        """单条消息（含方案列表），用于方案状态更新的入参校验。"""
        import json

        from .plans import normalize_plan_list

        with self._lock:
            row = self.conn.execute(
                "SELECT id, role, content, steps, feedback, plan, created_at, session_id "
                "FROM messages WHERE id=?",
                (mid,),
            ).fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "role": row[1],
            "content": row[2],
            "steps": json.loads(row[3] or "[]"),
            "feedback": json.loads(row[4]) if row[4] else None,
            "plans": normalize_plan_list(json.loads(row[5]) if row[5] else None),
            "created_at": row[6],
            "session_id": row[7],
        }

    def update_plans(self, mid: int, plans: list) -> Optional[list]:
        """覆盖某条消息的方案列表（确认 / 驳回 / 多方案选择）。返回最新列表。"""
        import json

        with self._lock:
            cur = self.conn.execute(
                "UPDATE messages SET plan=? WHERE id=?",
                (json.dumps(plans, ensure_ascii=False), mid),
            )
            self.conn.commit()
        if cur.rowcount == 0:
            return None
        return plans

    def add_message(
        self,
        sid: str,
        role: str,
        content: str,
        steps: Optional[list] = None,
        plan: Optional[object] = None,
    ) -> None:
        """steps: 工具调用步骤；plan: 方案列表（M2 起为数组，兼容单个对象）。"""
        import json

        now = _now()
        with self._lock:
            self.conn.execute(
                "INSERT INTO messages (session_id, role, content, steps, plan, created_at) "
                "VALUES (?,?,?,?,?,?)",
                (
                    sid,
                    role,
                    content,
                    json.dumps(steps or [], ensure_ascii=False),
                    json.dumps(plan, ensure_ascii=False) if plan else None,
                    now,
                ),
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

    # ---------- 任务（P3 行动层） ----------

    _TASK_COLS = (
        "id, session_id, message_id, plan_id, title, detail, output, kind, status, "
        "artifact, files, checks, archive_path, created_at, updated_at"
    )

    @staticmethod
    def _task_row(r) -> dict:
        import json

        return {
            "id": r[0],
            "session_id": r[1],
            "message_id": r[2],
            "plan_id": r[3],
            "title": r[4],
            "detail": r[5],
            "output": r[6],
            "kind": r[7] or "doc",
            "status": r[8],
            "artifact": r[9],
            "files": json.loads(r[10]) if r[10] else None,
            "checks": json.loads(r[11]) if r[11] else None,
            "archive_path": r[12],
            "created_at": r[13],
            "updated_at": r[14],
        }

    def add_tasks(self, sid: str, message_id: int, tasks: List[dict]) -> List[dict]:
        """批量写入方案拆解出的任务（同一消息重新拆解时先清理未完成任务）。"""
        now = _now()
        with self._lock:
            self.conn.execute(
                "DELETE FROM tasks WHERE message_id=? AND status NOT IN ('done')", (message_id,)
            )
            ids = []
            for t in tasks:
                cur = self.conn.execute(
                    "INSERT INTO tasks (session_id, message_id, plan_id, title, detail, output, kind, status, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (
                        sid, message_id, t["plan_id"], t["title"], t.get("detail", ""),
                        t.get("output", ""), t.get("kind", "doc"), t.get("status", "pending"), now, now,
                    ),
                )
                ids.append(cur.lastrowid)
            self.conn.commit()
            rows = [
                self.conn.execute(
                    f"SELECT {self._TASK_COLS} FROM tasks WHERE id=?", (i,)
                ).fetchone()
                for i in ids
            ]
        return [self._task_row(r) for r in rows if r]

    def list_tasks(self, sid: str) -> List[dict]:
        with self._lock:
            rows = self.conn.execute(
                f"SELECT {self._TASK_COLS} FROM tasks WHERE session_id=? ORDER BY id", (sid,)
            ).fetchall()
        return [self._task_row(r) for r in rows]

    def get_task(self, tid: int) -> Optional[dict]:
        with self._lock:
            row = self.conn.execute(
                f"SELECT {self._TASK_COLS} FROM tasks WHERE id=?", (tid,)
            ).fetchone()
        return self._task_row(row) if row else None

    def update_task(
        self,
        tid: int,
        status: str,
        artifact: Optional[str] = None,
        files: Optional[list] = None,
        checks: Optional[list] = None,
        archive_path: Optional[str] = None,
    ) -> Optional[dict]:
        now = _now()
        sets, args = ["status=?", "updated_at=?"], [status, now]
        if artifact is not None:
            sets.append("artifact=?")
            args.append(artifact)
        if files is not None:
            import json

            sets.append("files=?")
            args.append(json.dumps(files, ensure_ascii=False))
        if checks is not None:
            import json

            sets.append("checks=?")
            args.append(json.dumps(checks, ensure_ascii=False))
        if archive_path is not None:
            sets.append("archive_path=?")
            args.append(archive_path)
        args.append(tid)
        with self._lock:
            cur = self.conn.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id=?", args)
            self.conn.commit()
        if cur.rowcount == 0:
            return None
        return self.get_task(tid)

    def delete_tasks_of_message(self, message_id: int) -> None:
        with self._lock:
            self.conn.execute("DELETE FROM tasks WHERE message_id=?", (message_id,))
            self.conn.commit()
