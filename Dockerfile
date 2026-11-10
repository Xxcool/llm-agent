# 多阶段构建：前端构建 → 后端运行时（单容器同时服务 API 与页面）
FROM node:22-alpine AS fe
WORKDIR /app/frontend
# 可选：构建期注入访问令牌（会进入前端产物，仅作受控部署的访问门槛）
ARG VITE_API_TOKEN=""
ENV VITE_API_TOKEN=$VITE_API_TOKEN
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app/backend
# fastembed 依赖 ONNX 运行时，安装系统级依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
# 前端构建产物放进镜像，由 FastAPI 托管（单端口部署）
COPY --from=fe /app/frontend/dist /app/frontend/dist

ENV LLM_PROVIDER=openai
EXPOSE 8000
# 知识库与数据目录通过 volume 挂载持久化
VOLUME ["/app/backend/knowledge", "/app/backend/data"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
