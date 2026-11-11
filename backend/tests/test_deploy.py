"""部署工具不得同步私有资料、删除运行数据或覆盖未知目录。"""
import importlib.util
from pathlib import Path

import pytest


def _tool(tmp_path):
    path = Path(__file__).resolve().parents[2] / "scripts/prepare_deploy.py"
    spec = importlib.util.spec_from_file_location("prepare_deploy", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    root = tmp_path / "repo"
    for rel, text in {
        "backend/app/main.py": "# application",
        "backend/requirements.lock": "pytest==9.2.0",
        "backend/requirements.txt": "pytest>=8",
        "backend/knowledge/samples/public.md": "public sample",
        "backend/knowledge/personal/private.md": "private fixture",
        "backend/knowledge/沉淀/archive.md": "archive fixture",
        "backend/knowledge/uploads/upload.md": "uploaded fixture",
        "backend/data/runtime_config.json": "sensitive fixture",
        "frontend/dist/index.html": "<html></html>",
        "Dockerfile.modelscope": "FROM python:3.12-slim",
    }.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    module.ROOT = root
    return module


def test_deployment_uses_public_allowlist(tmp_path):
    tool = _tool(tmp_path)
    target = tmp_path / "package"
    tool.prepare(target, "modelscope")
    tool.prepare(target, "modelscope")
    assert (target / "backend/app/main.py").is_file()
    assert (target / "backend/knowledge/samples/public.md").is_file()
    assert not any(p.name in ("private.md", "archive.md", "upload.md", "runtime_config.json") for p in target.rglob("*"))


def test_existing_runtime_data_are_preserved_on_refusal(tmp_path):
    tool = _tool(tmp_path)
    target = tmp_path / "existing"
    target.mkdir()
    data = target / "chat.sqlite3"
    data.write_text("existing data")
    with pytest.raises(ValueError, match="已有数据不会被修改"):
        tool.prepare(target, "workbuddy")
    assert data.read_text() == "existing data"
    assert list(target.iterdir()) == [data]
