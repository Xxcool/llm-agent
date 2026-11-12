"""部署工具不得同步私有资料、删除运行数据或覆盖未知目录。"""
import importlib.util
import tarfile
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


@pytest.mark.parametrize("target_name", ["modelscope", "workbuddy"])
def test_deployment_uses_public_allowlist(tmp_path, target_name):
    tool = _tool(tmp_path)
    target = tmp_path / "package"
    tool.prepare(target, target_name)
    tool.prepare(target, target_name)
    if target_name == "modelscope":
        with tarfile.open(target / "application.tar.gz") as tar:
            names = tar.getnames()
        assert "backend/app/main.py" in names
        assert "backend/knowledge/samples/public.md" in names
    else:
        names = [str(p.relative_to(target)) for p in target.rglob("*") if p.is_file()]
        assert "app/main.py" in names
        assert "knowledge/samples/public.md" in names
    assert not any(Path(name).name in ("private.md", "archive.md", "upload.md", "runtime_config.json") for name in names)


def test_workbuddy_launcher_overrides_unsafe_shared_mode(tmp_path):
    import os
    import subprocess

    tool = _tool(tmp_path)
    target = tmp_path / "package"
    tool.prepare(target, "workbuddy")
    binary = tmp_path / "bin"
    binary.mkdir()
    uvicorn = binary / "uvicorn"
    uvicorn.write_text('#!/bin/sh\nprintf "%s\\n" "$MULTI_TENANT" "$REQUIRE_USER_API_KEY" "$CLIENT_COOKIE_SECURE" "$STATIC_DIR" "$DATA_DIR" "$@"\n')
    uvicorn.chmod(0o755)
    result = subprocess.run(
        ["sh", "start.sh"], cwd=target, text=True, capture_output=True, check=True,
        env={**os.environ, "PATH": f"{binary}:{os.environ['PATH']}", "MULTI_TENANT": "0", "REQUIRE_USER_API_KEY": "0"},
    )
    assert result.stdout.splitlines() == [
        "1", "1", "true", "static", "data", "app.main:app", "--host", "0.0.0.0", "--port", "3000", "--workers", "1",
    ]


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
