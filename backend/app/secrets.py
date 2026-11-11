"""运行时 API Key 加密；主密钥随数据目录备份，不进入代码仓库。"""
import os
import threading
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from . import config

_key_lock = threading.Lock()


def _cipher() -> Fernet:
    key = os.getenv("CONFIG_ENCRYPTION_KEY", "").strip()
    if not key:
        path = Path(config.DB_PATH).parent / "config_encryption.key"
        path.parent.mkdir(parents=True, exist_ok=True)
        with _key_lock:
            try:
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                pass
            else:
                with os.fdopen(fd, "wb") as f:
                    f.write(Fernet.generate_key())
            key = path.read_bytes()
    return Fernet(key)


def protect(cfg: dict) -> dict:
    stored = {k: v for k, v in cfg.items() if k not in ("api_key", "api_key_encrypted")}
    if cfg.get("api_key"):
        stored["api_key_encrypted"] = _cipher().encrypt(cfg["api_key"].encode()).decode()
    return stored


def reveal(stored: dict) -> dict:
    cfg = dict(stored)
    encrypted = cfg.pop("api_key_encrypted", None)
    if encrypted:
        try:
            cfg["api_key"] = _cipher().decrypt(encrypted.encode()).decode()
        except InvalidToken as e:
            raise RuntimeError("模型配置无法解密，请恢复原加密密钥或重新配置") from e
    return cfg
