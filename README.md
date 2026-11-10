# LLM Agent 智能对话平台

最小可用的 LLM Agent 平台：**RAG 知识库检索 + Function Calling 工具循环 + SSE 流式输出**，
前端将 Agent 的工具调用过程实时可视化。

## 架构

```
frontend (React 18 + TS + Vite)
   │  fetch + ReadableStream 解析 SSE
   ▼
POST /api/chat (FastAPI + sse-starlette)
   │  事件流: tool_call / tool_result / token / done / error
   ▼
Agent 循环 (最多 6 轮)
   ├─ search_knowledge  RAG 余弦 Top-4 检索
   ├─ get_resume        查询简历
   └─ fetch_url         抓取网页正文
   ▼
LLM Provider (OpenAI 兼容协议: GLM / DeepSeek / Moonshot 等)
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

接入真实 LLM 时设置环境变量：

```bash
LLM_PROVIDER=openai \
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4 \
LLM_API_KEY=你的Key \
LLM_MODEL=glm-4-flash
```

## 配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `LLM_PROVIDER` | `openai` | `openai`（OpenAI 兼容）/ `mock`（离线测试） |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | GLM | OpenAI 兼容端点配置 |
| `EMBED_BACKEND` | `auto` | 优先 fastembed 本地模型，失败降级 hash 向量 |
| `KNOWLEDGE_DIR` | `backend/knowledge` | 知识库文档目录（.md/.txt，含子目录） |
| `RAG_TOP_K` | `4` | 检索返回条数 |
| `MAX_TOOL_ROUNDS` | `6` | Agent 工具循环上限 |

## 知识库

把 Markdown/文本放入 `backend/knowledge/` 即自动分块（500 字符 / 50 重叠）、
向量化入库；文件更新按 mtime 签名增量重建。`knowledge/personal/` 默认被
`.gitignore` 排除，可放个人资料而不入库。

## 测试

```bash
cd backend && .venv/bin/python -m pytest tests -q
```
