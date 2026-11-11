"""全局配置：全部来自环境变量，LLM 供应商无关（OpenAI 兼容协议）。"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))
# 创空间只把完整快照放到持久目录，SQLite 始终运行在本地文件系统。
SNAPSHOT_DIR = os.getenv("SNAPSHOT_DIR", "").strip()
REQUIRE_USER_API_KEY = os.getenv("REQUIRE_USER_API_KEY", "0").lower() in ("1", "true", "yes")

# LLM（OpenAI 兼容：GLM / DeepSeek / Moonshot / Cloudflare AI Gateway 等均可）
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://open.bigmodel.cn/api/paas/v4")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "glm-4-flash")
# provider = openai（OpenAI 兼容）| mock（离线测试）
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai")
# 单次模型调用超时（秒）：方案/任务交付物等长文本生成需要更宽裕的时间
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "180"))

# 安全：可选 API Token（为空则不启用）；CORS 默认只放行本地开发地址
# 生产部署请设置 API_TOKEN，并同时用 VITE_API_TOKEN 构建前端
API_TOKEN = os.getenv("API_TOKEN", "").strip()
CORS_ORIGINS = [
    item.strip()
    for item in os.getenv(
        "CORS_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173,http://[::1]:5173",
    ).split(",")
    if item.strip()
]

# Embedding：auto = 优先 fastembed 本地模型，失败降级 hash 向量（零依赖可跑）
EMBED_BACKEND = os.getenv("EMBED_BACKEND", "auto")
EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-small-zh-v1.5")

# 知识库文档目录与向量库文件
KNOWLEDGE_DIR = Path(os.getenv("KNOWLEDGE_DIR", ROOT / "knowledge"))
DB_PATH = Path(os.getenv("RAG_DB_PATH", DATA_DIR / "rag.sqlite3"))
# 匿名工作区根目录：每个浏览器一个独立子目录（chat/rag/knowledge/workspace/config）
CLIENTS_DIR = Path(os.getenv("CLIENTS_DIR", DB_PATH.parent / "clients"))
# 部署形态开关：1=多租户（每浏览器独立工作区，默认）；0=单租户（演示/单实例部署，
# 知识库与数据直接落在 KNOWLEDGE_DIR 同级，不做 Cookie 隔离）
MULTI_TENANT = os.getenv("MULTI_TENANT", "1").strip().lower() not in ("0", "false", "no")
# 前端产物目录：开发默认仓库内 frontend/dist；部署包设为 static（相对当前工作目录）
STATIC_DIR = os.getenv("STATIC_DIR", str(ROOT.parent / "frontend" / "dist"))
# 任务执行的工作区（测试/兼容用；生产按匿名工作区隔离）
WORKSPACE_DIR = Path(os.getenv("WORKSPACE_DIR", ROOT / "data" / "workspace"))
# 匿名 Cookie 签名密钥；为空时自动生成并持久化到 DB_PATH 同目录
CLIENT_COOKIE_SECRET = os.getenv("CLIENT_COOKIE_SECRET", "").strip()
CLIENT_COOKIE_NAME = "wa_client"
# 是否给 Cookie 加 Secure（HTTPS 部署建议 true）
CLIENT_COOKIE_SECURE = os.getenv("CLIENT_COOKIE_SECURE", "false").lower() == "true"
MAX_OPEN_WORKSPACES = int(os.getenv("MAX_OPEN_WORKSPACES", "128"))

# Agent
MAX_TOOL_ROUNDS = int(os.getenv("MAX_TOOL_ROUNDS", "6"))
TOP_K = int(os.getenv("RAG_TOP_K", "4"))
# 检索相似度阈值：最高分低于该值视为「知识库未覆盖」，避免硬凑无关内容（实测相关 0.6+，无关 <0.52）
SCORE_THRESHOLD = float(os.getenv("RAG_SCORE_THRESHOLD", "0.58"))
FETCH_URL_TIMEOUT = float(os.getenv("FETCH_URL_TIMEOUT", "10"))
# 知识健康度：文档超过多少天视为陈旧
KNOWLEDGE_STALE_DAYS = int(os.getenv("KNOWLEDGE_STALE_DAYS", "90"))
