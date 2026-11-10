# LLM Agent 智能对话平台

**企业知识驱动的 AI 智能体**：从知识库检索增强，到基于证据的**多方案对比与人工确认**，
再到方案拆解为任务、逐项执行产出交付物——让企业知识从「问答」走向「交付」。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](backend/requirements.txt)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](frontend/package.json)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?logo=fastapi&logoColor=white)](backend/requirements.txt)
[![Tests](https://img.shields.io/badge/tests-81%20passed-3fb950)](.github/workflows/ci.yml)

一句话：把分散在制度、产品文档、技术资料里的企业知识，变成**可检索、可溯源、可确认、可交付**的生产力。

**能力主线**：感知（检索）→ 规划（多方案）→ 行动（任务执行）→ 记忆（沉淀）

## 界面预览

| 首页 · 提问入口 | 对话 · 检索引用 + 工具步骤 |
|---|---|
| ![首页](docs/screenshots/home.png) | ![对话](docs/screenshots/chat.png) |

| 知识库管理 · 文件/文件夹/文本/链接 | 模型接入 · 多服务商在线配置 |
|---|---|
| ![知识库](docs/screenshots/knowledge.png) | ![模型接入](docs/screenshots/settings.png) |

| 方案模式 · 结构化方案卡片（P2 规划层） | 多方案对比 · 成本/周期/风险权衡（M2） |
|---|---|
| ![方案卡片](docs/screenshots/plan.png) | ![多方案对比](docs/screenshots/plan-compare.png) |

| 任务看板 · 方案拆解与执行交付（P3 行动层） | 代码交付 · diff 预览与批准落盘（M4） |
|---|---|
| ![任务看板](docs/screenshots/tasks.png) | ![代码 diff](docs/screenshots/code-diff.png) |

## 功能特性

| 能力 | 说明 |
|---|---|
| **RAG 检索增强** | 段落感知分块（500 字符分块，超长段落 50 字重叠）→ 本地 bge-small-zh 向量化 → 余弦 Top-4 检索，相似度阈值 0.58 防硬凑；回答标注来源文件，可回溯原文 |
| **方案模式（P2）** | 基于检索证据生成结构化方案卡片：目标 / 实施步骤 / **可溯源依据** / 风险与应对；方案需**人工确认**后才锁定，未确认不触发任何执行 |
| **多方案对比（M2）** | 同一诉求产出 2-3 个候选方案，按**成本 / 周期 / 风险**对比，模型标注推荐项；选定一个后其余候选自动驳回 |
| **任务拆解与执行（P3）** | 已确认方案一键拆解为 3-6 个可执行任务（含类型/做法/预期产出），逐任务执行生成 **Markdown 交付物**并在看板中预览 |
| **代码交付与 diff 审批（M4）** | 代码类任务产出**文件 diff 预览**，人工批准后写入工作区沙箱，自动做 Python 语法 / JSON 解析校验；路径白名单防穿越，命令执行默认关闭 |
| **Function Calling** | 智能体按需调用 `search_knowledge`（知识库检索）与 `fetch_url`（网页正文抓取），工具结果回填后继续推理，最多 6 轮闭环 |
| **SSE 流式输出** | 前端用 `fetch + ReadableStream` 自行解析 SSE（POST 场景，不用 EventSource）；最终回答逐 token 推送，工具调用与方案 JSON 仍整轮缓冲，保证可靠性 |
| **思考型模型兼容** | 适配 DeepSeek 等思考模型：工具调用轮回传 `reasoning_content`，避免 400 |
| **多服务商接入** | 在线配置 API 地址 / Key / 模型，内置 DeepSeek、智谱、通义千问、Moonshot、硅基流动、Mistral、Gemini、Claude、Ollama 预设；保存前真实调用验证 |
| **知识库四种录入** | 上传文件夹（保留目录结构）/ 上传文件 / 文本录入 / 链接批量抓取 |
| **富文本渲染** | 代码块（高亮/复制/下载）、表格（复制 CSV）、mermaid 流程图、LaTeX 公式、图片/音视频/文件卡片 |
| **消息操作** | 复制 / 重新生成 / 朗读（Edge 神经语音 + 播放声波动画）/ 点赞点踩（原因面板，持久化） |
| **会话管理** | 搜索、置顶、重命名、多选批量操作、空会话不进入历史列表（前端首条消息时才创建） |
| **测试体系** | 64 个 pytest 用例（store / llm / rag / agent / plans / tasks / api 七层）+ 17 个前端用例 + 真实链路端到端验证脚本 |

## 架构

```mermaid
flowchart LR
    subgraph FE["前端 · React 18 + TS + Vite"]
        UI["对话 / 会话 / 知识库 / 接入面板"]
        SSE["fetch + ReadableStream<br/>SSE 事件解析"]
        UI --> SSE
    end

    subgraph BE["后端 · FastAPI + sse-starlette"]
        API["POST /api/chat"]
        AG["Agent 循环 · 最多 6 轮"]
        T1["search_knowledge"]
        T2["fetch_url"]
        API --> AG
        AG --> T1
        AG --> T2
    end

    subgraph DATA["数据层"]
        RAG[("SQLite 向量库<br/>增量索引")]
        KB["知识库目录<br/>.md / .txt"]
        CHAT[("SQLite 会话库")]
    end

    P["LLM Provider<br/>OpenAI 兼容协议"]
    DS[("DeepSeek / GLM / Claude ...")]

    SSE <-->|"SSE 事件流<br/>tool_call / token / done"| API
    T1 --> RAG
    KB --> RAG
    AG --> P
    P --> DS
    AG --> CHAT
```

一次提问的完整链路：

```mermaid
sequenceDiagram
    autonumber
    participant U as 用户
    participant F as 前端
    participant B as FastAPI
    participant A as Agent 循环
    participant L as LLM Provider
    participant R as 向量库

    U->>F: 输入问题（可开关知识检索/网页抓取）
    F->>B: POST /api/chat（携带 session_id）
    B->>A: run_agent(message, history)
    A->>L: messages + tools 定义
    L-->>A: tool_call: search_knowledge
    A->>R: 余弦检索 Top-4（阈值 0.58）
    R-->>A: 片段 + 来源文件
    A->>L: 回填 tool_result（含 reasoning_content）
    L-->>A: 流式 token（工具/方案参数缓冲）
    A-->>B: token / tool_result 事件
    B-->>F: SSE 逐事件推送
    F-->>U: 逐 token 渲染 + 工具时间线 + 来源标注
    B->>B: 消息与工具步骤持久化
```

> 说明：最终自然语言回答通过 OpenAI 兼容流式接口逐 token 推送；工具调用参数与 `draft_plan` JSON 仍需完整到达后再执行/校验，因此这两类事件是整轮缓冲的。前端收到 token 后直接追加，不再使用固定速度的打字机队列。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 · TypeScript · Vite · react-markdown（KaTeX / highlight / mermaid 按需加载） |
| 后端 | FastAPI · uvicorn · httpx · sse-starlette |
| LLM | 任意 OpenAI 兼容协议（DeepSeek / GLM / 千问 / Kimi / Claude / Gemini / Ollama…） |
| Embedding | fastembed · BAAI/bge-small-zh-v1.5（本地 ONNX，零 Key 可跑，失败降级 hash 向量） |
| 存储 | SQLite（会话库 + 向量库） · 知识库为磁盘目录 |
| 测试 | pytest · FastAPI TestClient（monkeypatch 注入隔离状态，离线可跑） |

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

接入真实 LLM：前端「接入模型服务」面板在线配置（保存到 `backend/data/runtime_config.json`，不入仓库），
也可用环境变量：

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
| `RAG_SCORE_THRESHOLD` | `0.58` | 检索相似度阈值，低于阈值不硬凑无关内容 |
| `MAX_TOOL_ROUNDS` | `6` | Agent 工具循环上限 |

## 知识库

知识库用于沉淀企业制度、产品文档、技术资料与业务流程，支持四种录入方式（均在前端「知识库管理」面板）：

| 方式 | 适用场景 | 落盘位置 |
|---|---|---|
| 上传文件夹 | 「项目知识库 / 产品文档 / 方案设计」等成体系的资产目录 | `uploads/<相对路径>`（结构保留） |
| 上传文件 | 单篇 `.md / .txt / .markdown` | `uploads/<文件名>` |
| 文本录入 | 短文档、FAQ、临时说明 | `uploads/<命名>.md` |
| 链接导入 | 外部文档页、制度页面（单次最多 10 条） | `uploads/网页抓取/<标题>.md` |

解析与检索规则：文档按段落合并分块（500 字符分块，超长段落 50 字重叠）→ 向量化 → SQLite 入库，
按 `相对路径:mtime` 做增量重建（改动的文件重入库、删除的文件清理残留块）；
**来源即相对路径**（如 `samples/员工差旅与费用报销制度.md`），回答引用可直接回溯到目录与原文。

> `backend/knowledge/personal/`（本地私有资料）与 `backend/data/`（向量库、运行时密钥）
> 默认被 `.gitignore` 排除，不会进入代码仓库。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 服务状态、当前模型与知识库分块数（真实探测模型可用性，缓存 60s） |
| POST | `/api/chat` | SSE 对话（`message` / `session_id` / `force_retrieval` / `allow_fetch`） |
| GET | `/api/tts` | 文本转语音（Edge 神经语音 MP3，默认晓晓；失败自动降级浏览器 TTS） |
| POST | `/api/sessions` | 创建会话 |
| GET | `/api/sessions` | 会话列表（只返回有消息的会话，按置顶 + 最近更新排序） |
| GET | `/api/sessions/{id}` | 单个会话信息 |
| PATCH | `/api/sessions/{id}` | 重命名 / 置顶 |
| GET | `/api/sessions/{id}/messages` | 会话消息（含工具调用步骤与反馈） |
| DELETE | `/api/sessions/{id}` | 删除会话 |
| POST | `/api/messages/{id}/feedback` | 消息反馈（点赞 / 点踩 + 原因） |
| PATCH | `/api/messages/{id}/plan` | 方案状态流转（`draft` / `confirmed` / `rejected`），人工确认闸门 |
| POST | `/api/messages/{id}/tasks` | 已确认方案拆解为任务（幂等；未确认返回 400） |
| GET | `/api/sessions/{id}/tasks` | 会话内任务列表（看板数据） |
| POST | `/api/tasks/{id}/run` | 执行单个任务：文档类产出 Markdown；代码类产出文件 diff（进入待审批） |
| POST | `/api/tasks/{id}/apply` | 批准代码交付：写入工作区沙箱 + 语法/JSON 校验 |
| POST | `/api/tasks/{id}/discard` | 丢弃待审批的代码文件（不落盘） |
| GET/POST | `/api/config` | 读取 / 更新模型服务配置（Key 掩码回显，永不返回明文） |
| POST | `/api/config/test` | 真实调用一次模型验证配置（不落盘） |
| GET | `/api/knowledge` | 文档列表（含分块数） |
| POST | `/api/knowledge/upload` | 上传单个文件 |
| POST | `/api/knowledge/upload-dir` | 批量上传文件夹（保留相对目录结构） |
| POST | `/api/knowledge/text` | 文本录入 |
| POST | `/api/knowledge/url` | 链接批量导入 |
| DELETE | `/api/knowledge?source=` | 删除文档（文件 + 向量） |

## 测试

三层验证：**后端单测**、**前端单测**、**真实链路端到端验证**（需要可用 Key）。
GitHub Actions 已配置 CI：每次 push / PR 自动跑后端 pytest 与前端 vitest + 构建。

```bash
cd backend && .venv/bin/python -m pytest tests -q   # 后端 64 用例
cd frontend && npm test                             # 前端 17 用例
```

前端用例（Vitest + Testing Library，jsdom）：

| 文件 | 用例数 | 覆盖点 |
|---|---|---|
| `api.test.ts` | 4 | 方案状态 PATCH 参数（status + plan_id）、任务拆解错误文案透出、执行/落盘响应解析 |
| `PlanGroup.test.tsx` | 2 | 单方案直出卡片、多方案对比表（表头维度、推荐/已选/驳回行） |
| `PlanCard.test.tsx` | 4 | 依据溯源渲染、确认按钮按 plan.id 提交、未落库禁用、多方案折叠与「恢复为候选」 |
| `TaskBoard.test.tsx` | 4 | 拆解入口、执行后展示交付物、代码任务 diff + 批准落盘回传校验、丢弃 |
| `Composer.test.tsx` | 3 | 回车发送与清空、方案模式开关态、禁用时停止按钮 |

| 模块 | 用例数 | 覆盖点 |
|---|---|---|
| `test_store.py` | 8 | 会话增删改查、置顶排序、标题自动生成、空会话过滤、反馈持久化、历史顺序 |
| `test_llm.py` | 15 | MockProvider 行为、错误码映射、思考模型 `reasoning_content`、流式 token/tool_calls 分片/reasoning/非法 JSON、Agent 增量 token |
| `test_rag.py` | 5 | 入库增量、已删文件脏块清理、delete_source、LIKE 通配符转义 |
| `test_agent.py` | 8 | RAG 检索、工具循环、阈值拒绝、未知工具、fetch_url 协议校验、SSRF 内网/重定向拦截 |
| `test_plans.py` | 7 | 方案规范化与校验、多候选 SSE、选择互斥、单方案兼容、非法参数容错 |
| `test_tasks.py` | 7 | 任务拆解与幂等、未确认方案拦截、文档交付、代码 diff 审批与落盘校验、绝对路径/穿越防护、任务状态守卫、文件数上限 |
| `test_api.py` | 14 | TestClient 集成：健康检查、Key 掩码、会话生命周期、SSE 全链路/多 token 事件、反馈、TTS、文件夹上传、删除路径防护、多轮上下文去重、mock 模式 |

真实链路（服务健康 → 配置连通 → 注入标记文档 → SSE 提问 → 断言检索命中 + 回答含标记 + 持久化 → 清理）：

```bash
cd backend && .venv/bin/python scripts/verify_real.py
```

## 部署

后端是 Python FastAPI（本地 ONNX embedding + SQLite 文件库 + 磁盘知识目录），
**不适合** Cloudflare Workers（无法跑 Python/ONNX/文件系统）或 Supabase（仅是数据库 BaaS，非应用运行时）。

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
npm --prefix frontend install && npm --prefix frontend run build
cd backend && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

前后端分离托管也可：前端 `dist/` 部署到 Vercel / Cloudflare Pages，后端单独部署并配置 CORS。

## 项目结构

```
llm-agent
├── backend/
│   ├── app/
│   │   ├── main.py        # FastAPI 入口：SSE 对话 / 知识库 / 配置 / TTS / 静态托管
│   │   ├── agent.py       # Agent 工具循环（最多 6 轮）+ 错误码人话映射
│   │   ├── llm.py         # OpenAI 兼容 Provider + MockProvider（思考模型 reasoning 支持）
│   │   ├── rag.py         # 分块 / 向量入库 / 余弦检索 / 增量索引
│   │   ├── embedder.py    # fastembed 本地 ONNX，失败降级 hash
│   │   ├── store.py       # SQLite 会话与消息持久化
│   │   ├── plans.py       # 结构化方案：规范化校验、多方案选择
│   │   ├── tasks.py       # 任务：拆解、执行、diff 生成与工作区落盘
│   │   ├── tools.py       # search_knowledge / fetch_url / draft_plan
│   │   └── config.py      # 环境变量与阈值
│   ├── knowledge/         # 知识库目录（samples/ 为示例文档）
│   ├── scripts/verify_real.py
│   └── tests/             # 50 个用例，离线可跑
├── frontend/
│   └── src/
│       ├── pages/         # Home / Chat
│       └── components/    # Sidebar / MessageBubble / MarkdownView / PlanCard / TaskBoard ...
├── docs/screenshots/      # README 演示截图
├── Dockerfile
└── LICENSE
```

---

## 👨‍💻 作者 (Author)

- **Xxcool** - [GitHub (@Xxcool)](https://github.com/Xxcool) · [掘金技术主页](https://juejin.cn/user/4265760845468296/posts)

## 📄 开源许可 (License)

本项目遵循 [MIT License](LICENSE) 开源协议。
