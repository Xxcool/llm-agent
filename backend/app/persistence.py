"""面向对象存储挂载的完整快照：SQLite 在线备份、校验发布、启动恢复。"""
import hashlib
import json
import shutil
import sqlite3
import tarfile
import tempfile
import threading
import time
import uuid
from pathlib import Path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class SnapshotManager:
    def __init__(self, data_dir: Path, snapshot_dir: Path):
        self.data_dir = data_dir.resolve()
        self.snapshot_dir = snapshot_dir.resolve()
        if self.data_dir == self.snapshot_dir or self.data_dir in self.snapshot_dir.parents:
            raise ValueError("快照目录必须位于运行数据目录之外")
        self._lock = threading.Lock()
        self._revision = 0
        self._saved_revision = -1
        self.last_error: str | None = None

    def mark_dirty(self) -> None:
        self._revision += 1

    def restore(self) -> None:
        # 本地已有数据时保留现状，不用远端副本覆盖正在使用的数据。
        if self.data_dir.exists() and any(self.data_dir.iterdir()):
            return
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)
        manifests = sorted(self.snapshot_dir.glob("snapshot-*.json"), reverse=True)
        for manifest in manifests:
            try:
                metadata = json.loads(manifest.read_text())
                name = metadata["archive"]
                if Path(name).name != name or not name.startswith("snapshot-"):
                    continue
                archive = self.snapshot_dir / name
                if _sha256(archive) != metadata["sha256"]:
                    continue
                with tempfile.TemporaryDirectory(prefix="llm-restore-") as tmp:
                    stage = Path(tmp).resolve()
                    with tarfile.open(archive, "r:gz") as tar:
                        for member in tar:
                            dest = (stage / member.name).resolve()
                            if stage not in dest.parents or not member.isfile():
                                raise ValueError("快照含非法路径或非普通文件")
                            dest.parent.mkdir(parents=True, exist_ok=True)
                            with tar.extractfile(member) as src, dest.open("wb") as out:
                                shutil.copyfileobj(src, out)
                    for db in stage.rglob("*.sqlite3"):
                        conn = sqlite3.connect(db)
                        try:
                            if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                                raise ValueError("快照数据库校验失败")
                        finally:
                            conn.close()
                    shutil.copytree(stage, self.data_dir, dirs_exist_ok=True)
                    for secret in self.data_dir.rglob("*.key"):
                        secret.chmod(0o600)
                return
            except (OSError, ValueError, KeyError, sqlite3.DatabaseError, tarfile.TarError):
                continue
        if manifests:
            raise RuntimeError("所有持久快照均不可恢复，已停止启动以保护数据")

    def checkpoint(self, force: bool = False) -> None:
        with self._lock:
            revision = self._revision
            if not force and revision == self._saved_revision:
                return
            self.data_dir.mkdir(parents=True, exist_ok=True)
            self.snapshot_dir.mkdir(parents=True, exist_ok=True)
            name = f"snapshot-{time.time_ns()}-{uuid.uuid4().hex[:8]}"
            try:
                with tempfile.TemporaryDirectory(prefix="llm-snapshot-") as tmp:
                    payload = Path(tmp) / "data"
                    payload.mkdir()
                    for src in self.data_dir.rglob("*"):
                        if not src.is_file() or src.is_symlink() or src.name.endswith((".tmp", "-journal", "-wal", "-shm")):
                            continue
                        dest = payload / src.relative_to(self.data_dir)
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        if src.suffix == ".sqlite3":
                            # 不直接复制运行中的 SQLite 文件，避免生成不一致备份。
                            source = sqlite3.connect(src)
                            target = sqlite3.connect(dest)
                            try:
                                source.backup(target)
                            finally:
                                target.close()
                                source.close()
                        else:
                            shutil.copyfile(src, dest)
                    archive = Path(tmp) / f"{name}.tar.gz"
                    with tarfile.open(archive, "w:gz") as tar:
                        for src in payload.rglob("*"):
                            if src.is_file():
                                tar.add(src, arcname=str(src.relative_to(payload)), recursive=False)
                    digest = _sha256(archive)
                    shutil.copyfile(archive, self.snapshot_dir / archive.name)
                    # 清单最后写入；缺失清单或哈希不符的半成品不会用于恢复。
                    metadata = {"archive": archive.name, "sha256": digest}
                    (self.snapshot_dir / f"{name}.json").write_text(json.dumps(metadata))
                self._saved_revision = revision
                self.last_error = None
                # 只清理本模块生成的旧快照，保留三个可恢复版本。
                for old in sorted(self.snapshot_dir.glob("snapshot-*.json"), reverse=True)[3:]:
                    metadata = json.loads(old.read_text())
                    archive_name = metadata.get("archive", "")
                    if Path(archive_name).name == archive_name and archive_name.startswith("snapshot-"):
                        (self.snapshot_dir / archive_name).unlink(missing_ok=True)
                        old.unlink()
            except Exception as e:
                self.last_error = type(e).__name__
                raise
