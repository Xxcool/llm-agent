# LLM Agent 智能对话平台

面向企业知识资产的 RAG 智能体：**知识库检索增强 + Function Calling 工具循环 + SSE 流式输出**，
前端将 Agent 的工具调用过程与引用来源实时可视化。

## 架构

```
frontend (React 18 + TS + Vite)
   │  fetch + ReadableStream 解析 SSE
   ▼
POST /api/chat (FastAPI + sse-starlette)
   │  事件流: tool_call / tool_result / token / done / error
   ▼
Agent 循环 (最多 6 轮)
   ├─ search_knowledge  企业知识库语义检索（余弦 Top-4）
   └─ fetch_url         抓取外部文档正文
   ▼
LLM Provider (OpenAI 兼容协议: DeepSeek / GLM / Moonshot 等)
        + Embedding (BAAI/bge-small-zh-v1.5 本地 ONNX，零 Key 可跑)
        + SQLite 向量库 (mtime 签名增量索引)
```

## 快速开始

```bash
# 后端
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
LLM_PROVIDER=mock .venv/bin/python -m uvicorn app.main:app --port 8000

# 前端（另开终端）
cd frontend
npm install && npm run dev   # http://localhost:5173，已代理 /api 到 8000
```

接入真实 LLM：可在前端「接入模型服务」面板在线配置（保存到 `backend/data/runtime_config.json`，
不入仓库），也可用环境变量：

```bash
LLM_PROVIDER=openai \
LLM_BASE_URL=https://api.deepseek.com \
LLM_API_KEY=你的Key \
LLM_MODEL=deepseek-chat
```

## 配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `LLM_PROVIDER` | `openai` | `openai`（OpenAI 兼容）/ `mock`（离线演示） |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | GLM | OpenAI 兼容端点配置 |
| `EMBED_BACKEND` | `auto` | 优先 fastembed 本地模型，失败降级 hash 向量 |
| `KNOWLEDGE_DIR` | `backend/knowledge` | 知识库文档目录（.md/.txt，含子目录） |
| `RAG_TOP_K` | `4` | 检索返回条数 |
| `MAX_TOOL_ROUNDS` | `6` | Agent 工具循环上限 |

## 知识库

知识库用于沉淀企业制度、产品文档、技术资料与业务流程，支持三种录入方式（均在前端「知识库管理」面板）：

1. **上传文件**：`.md / .txt / .markdown`（单文件）
2. **文本录入**：粘贴内容并命名，适合短文档与 FAQ
3. **链接导入**：批量抓取外部文档页正文（单次最多 10 条）

文档自动分块（500 字符 / 50 重叠）→ 向量化 → SQLite 入库，按 `相对路径:mtime` 增量重建；
回答时标注来源文件，可追溯到原文。

`backend/knowledge/personal/`（个人/敏感资料）与 `backend/data/`（向量库、运行时密钥）
均默认被 `.gitignore` 排除，不会进入代码仓库。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 服务状态、当前模型与知识库分块数 |
| POST | `/api/chat` | SSE 对话（`message` / `session_id` / `force_retrieval` / `allow_fetch`），携带 `session_id` 时自动持久化 |
| POST | `/api/sessions` | 创建会话 |
| GET | `/api/sessions` | 会话列表（按最近更新排序） |
| GET | `/api/sessions/{id}/messages` | 会话消息（含工具调用步骤） |
| DELETE | `/api/sessions/{id}` | 删除会话 |
| GET/POST | `/api/config` | 读取 / 更新模型服务配置 |
| GET | `/api/knowledge` | 文档列表（含分块数） |
| POST | `/api/knowledge/upload` | 上传文件 |
| POST | `/api/knowledge/text` | 文本录入 |
| POST | `/api/knowledge/url` | 链接批量导入 |
| DELETE | `/api/knowledge?source=` | 删除文档（文件 + 向量） |

## 测试

```bash
cd backend && .venv/bin/python -m pytest tests -q
```
