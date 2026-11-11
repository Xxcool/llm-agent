"""pytest 公共夹具：注入隔离状态（临时库 + Hash Embedder + Mock Provider）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from app import main as app_main  # noqa: E402
from app.embedder import HashEmbedder  # noqa: E402
from app.llm import MockProvider  # noqa: E402
from app.rag import RagStore  # noqa: E402
from app.store import ChatStore  # noqa: E402
from app.tools import ToolExecutor  # noqa: E402


@pytest.fixture
def tmp_app(tmp_path, monkeypatch):
    """给 app.main 注入完全隔离的临时状态，测试互不污染、不碰真实数据。"""
    kb = tmp_path / "kb"
    kb.mkdir()
    rag = RagStore(tmp_path / "rag.sqlite3")
    rag.embedder = HashEmbedder()  # 离线向量，测试不下载模型
    monkeypatch.setattr(app_main, "_rag", rag)
    monkeypatch.setattr(app_main, "_executor", ToolExecutor(rag))
    monkeypatch.setattr(app_main, "_provider", MockProvider())
    monkeypatch.setattr(app_main, "_store", ChatStore(tmp_path / "chat.sqlite3"))
    monkeypatch.setattr(app_main, "RUNTIME_FILE", tmp_path / "runtime.json")
    monkeypatch.setattr(app_main, "KNOWLEDGE_ROOT", kb)
    monkeypatch.setattr(app_main, "UPLOAD_DIR", kb / "uploads")
    # 任务执行沙箱：指向临时工作区，避免测试污染真实 data/workspace
    monkeypatch.setattr(app_main.config, "WORKSPACE_DIR", tmp_path / "workspace")
    monkeypatch.setattr(app_main.config, "SCORE_THRESHOLD", 0.0)  # Hash 向量分数量级不同，测试关闭阈值
    monkeypatch.setattr(app_main.config, "CLIENT_COOKIE_SECRET", "test-cookie-secret")
    monkeypatch.setattr(app_main.config, "DB_PATH", tmp_path / "rag.sqlite3")
    app_main._health_cache.clear()
    app_main._workspaces.clear()
    yield app_main
