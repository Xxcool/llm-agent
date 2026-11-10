"""全局配置：全部来自环境变量，LLM 供应商无关（OpenAI 兼容协议）。"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

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
DB_PATH = Path(os.getenv("RAG_DB_PATH", ROOT / "data" / "rag.sqlite3"))
# 任务执行的工作区（沙箱根目录）：代码类交付只允许写在这里
WORKSPACE_DIR = Path(os.getenv("WORKSPACE_DIR", ROOT / "data" / "workspace"))

# Agent
MAX_TOOL_ROUNDS = int(os.getenv("MAX_TOOL_ROUNDS", "6"))
TOP_K = int(os.getenv("RAG_TOP_K", "4"))
# 检索相似度阈值：最高分低于该值视为「知识库未覆盖」，避免硬凑无关内容（实测相关 0.6+，无关 <0.52）
SCORE_THRESHOLD = float(os.getenv("RAG_SCORE_THRESHOLD", "0.58"))
FETCH_URL_TIMEOUT = float(os.getenv("FETCH_URL_TIMEOUT", "10"))
