# 企业知识智能体 · 项目介绍

企业知识智能体是面向公司内部知识资产的 RAG 问答平台，解决制度、产品文档、技术资料分散在多个系统、
检索成本高的问题，把非结构化文档转化为可检索、可溯源、可审计的问答能力。

核心链路：

1. **知识库构建**：支持上传文件、文本录入、链接抓取三种方式。文档按段落合并分块（500 字符、50 重叠），
   经本地 Embedding 模型向量化后存入 SQLite，按「相对路径 + mtime」签名做增量重建。
2. **检索增强生成**：回答前按余弦相似度检索 Top-4 片段，回答中标注来源文件，用户可回溯原文核对。
3. **工具调用**：智能体可调用 search_knowledge（知识库检索）与 fetch_url（网页正文抓取），
   多轮工具回填后生成答案，最多循环 6 轮。
4. **流式输出**：POST /api/chat 以 SSE 返回 tool_call / tool_result / token / done / error 事件，
   前端用 fetch + ReadableStream 逐块解析，工具调用过程可视化。

技术栈：FastAPI + uvicorn + httpx + sse-starlette + fastembed（后端），
React 18 + TypeScript + Vite + react-markdown（前端）。
