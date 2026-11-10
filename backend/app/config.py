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

# Embedding：auto = 优先 fastembed 本地模型，失败降级 hash 向量（零依赖可跑）
EMBED_BACKEND = os.getenv("EMBED_BACKEND", "auto")
EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-small-zh-v1.5")

# 知识库文档目录与向量库文件
KNOWLEDGE_DIR = Path(os.getenv("KNOWLEDGE_DIR", ROOT / "knowledge"))
DB_PATH = Path(os.getenv("RAG_DB_PATH", ROOT / "data" / "rag.sqlite3"))

# Agent
MAX_TOOL_ROUNDS = int(os.getenv("MAX_TOOL_ROUNDS", "6"))
TOP_K = int(os.getenv("RAG_TOP_K", "4"))
FETCH_URL_TIMEOUT = float(os.getenv("FETCH_URL_TIMEOUT", "10"))
