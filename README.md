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
LLM_MODEL=deepseek-flash
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
| `RAG_SCORE_THRESHOLD` | `0.58` | 检索相似度阈值，低于阈值不硬凑无关内容 |

## 部署

后端是 Python FastAPI（本地 ONNX embedding + SQLite 文件库 + 磁盘知识目录），
**不适合** Cloudflare Workers（无法跑 Python/ONNX/文件系统）或 Supabase（仅是数据库 BaaS，非应用运行时）。
推荐以下两种方式：

### 方式一：Docker 单容器（推荐）

```bash
docker build -t llm-agent .
docker run -d -p 8000:8000 \
  -e LLM_BASE_URL=https://api.deepseek.com \
  -e LLM_API_KEY=你的Key \
  -e LLM_MODEL=deepseek-flash \
  -v ./knowledge:/app/backend/knowledge \
  -v ./data:/app/backend/data \
  llm-agent
```

多阶段构建：前端 `npm run build` 产物由 FastAPI 托管（SPA 回退已内置），
**单端口同时服务 API 与页面**；知识库与数据通过 volume 持久化。
适配 Render / Railway / Fly.io 等支持 Docker 的托管平台，或任意 VPS。

### 方式二：手动部署

```bash
npm --prefix frontend install && npm --prefix frontend run build  # 构建前端
cd backend && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000  # 自动托管 frontend/dist
```

前后端分离托管也可：前端 `dist/` 丢 Vercel / Cloudflare Pages，后端单独部署并配置 CORS。

## 知识库

知识库用于沉淀企业制度、产品文档、技术资料与业务流程，支持四种录入方式（均在前端「知识库管理」面板）：

1. **上传文件夹**：批量选择整个文件夹，保留目录结构入库（适合「项目知识库 / 产品文档 / 方案设计」等资产目录）
2. **上传文件**：`.md / .txt / .markdown`（单文件）
3. **文本录入**：粘贴内容并命名，适合短文档与 FAQ
4. **链接导入**：批量抓取外部文档页正文（单次最多 10 条）

文档自动分块（500 字符 / 50 重叠）→ 向量化 → SQLite 入库，按 `相对路径:mtime` 增量重建；
回答时标注来源文件，可追溯到原文。

`backend/knowledge/personal/`（个人/敏感资料）与 `backend/data/`（向量库、运行时密钥）
均默认被 `.gitignore` 排除，不会进入代码仓库。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 服务状态、当前模型与知识库分块数 |
| GET | `/api/tts` | 文本转语音（Edge 神经语音 MP3，默认晓晓；前端朗读失败自动降级浏览器 TTS） |
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

两层验证：**离线单测**（不需要模型 Key）与**真实链路端到端验证**（需要可用 Key）。

### 1. 单元测试（33 个用例，离线可跑）

```bash
cd backend && .venv/bin/python -m pytest tests -q
```

| 模块 | 用例数 | 覆盖点 |
|---|---|---|
| `test_store.py` | 8 | 会话增删改查、置顶排序、标题自动生成、空会话过滤、反馈持久化、历史顺序 |
| `test_llm.py` | 10 | MockProvider 检索驱动行为回归、401/402/403/404/429 错误码映射、思考模型 `reasoning_content` 回传 |
| `test_rag.py` | 4 | 入库增量、已删文件脏块清理回归、delete_source |
| `test_api.py` | 5 | TestClient 集成：健康检查、配置 Key 掩码、会话生命周期、SSE 全链路、错误持久化 |

测试通过 `conftest.py` 的 `tmp_app` 夹具完全隔离：临时数据库/知识库目录 + HashEmbedder + MockProvider，
不依赖任何外部服务与网络。

### 2. 真实链路端到端验证（需要可用 Key）

```bash
cd backend && .venv/bin/python scripts/verify_real.py
```

脚本自动执行：服务健康检查 → 配置连通性测试 → 注入带唯一标记（TX-XXXX）的测试文档 →
SSE 提问 → 验证「检索命中标记文档 + 模型回答包含标记 + 消息持久化」→ 清理测试数据。
全绿即证明：模型接入、Key 配置、RAG 检索、Agent 循环、SSE 流式、持久化整条链路真实可用。
