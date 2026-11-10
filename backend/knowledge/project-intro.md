# LLM Agent 智能对话平台 · 项目介绍

本项目是一个最小可用的 LLM Agent 平台演示，核心链路：

1. **RAG 知识库检索**：backend/knowledge 目录下的 Markdown 文档按段落合并分块（500 字符、50 重叠），
   经本地 Embedding 模型（BAAI/bge-small-zh-v1.5，ONNX 运行时）向量化后存入 SQLite，
   检索时按余弦相似度取 Top-4。文档更新基于 mtime 签名自动增量重建索引。
2. **Function Calling 工具循环**：Agent 收到问题后先判断是否需要调用工具，
   内置三个工具——search_knowledge（检索知识库）、get_resume（查询简历）、fetch_url（抓取网页正文）；
   工具结果回填上下文后继续生成，最多循环 6 轮。
3. **SSE 流式输出**：POST /api/chat 返回事件流，事件类型包括
   tool_call / tool_result / token / done / error，前端用 fetch + ReadableStream 逐块解析，
   工具调用过程以可折叠时间线实时可视化。

技术栈：FastAPI + uvicorn + httpx + sse-starlette + fastembed（后端），
React 18 + TypeScript + Vite + react-markdown（前端）。
