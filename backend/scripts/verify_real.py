#!/usr/bin/env python3
"""真实链路端到端验证：真实模型 + Key + 真实 RAG 检索（非 mock）。

验证内容：
  1. 后端存活 + 模型服务真实可用（/api/health 探测 + /api/config/test）
  2. 注入带唯一标记的临时知识文档 → 提问 → 检索命中标记 → 模型基于检索内容生成回答
  3. 回答持久化、会话闭环、临时数据清理

用法：
  cd backend
  .venv/bin/python scripts/verify_real.py                 # 默认 http://127.0.0.1:8000
  .venv/bin/python scripts/verify_real.py --base-url http://x:8000

前置条件：已在「接入模型服务」面板配置可用 Key（或 data/runtime_config.json / 环境变量）。
"""
import argparse
import json
import sys
import uuid

import httpx

MARKER = f"TX-{uuid.uuid4().hex[:6].upper()}"  # 唯一标记，验证检索确实来自我们注入的文档
DOC_NAME = f"验证文档-{MARKER}"


def parse_sse(text: str) -> list:
    events = []
    for line in text.splitlines():
        if line.startswith("data:"):
            data = line[5:].strip()
            if data and data != "[DONE]":
                events.append(json.loads(data))
    return events


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    c = httpx.Client(base_url=base, timeout=120)

    results: list[tuple[bool, str]] = []
    created_session: str | None = None

    def step(ok: bool, msg: str) -> None:
        results.append((ok, msg))
        print(f"  {'✅' if ok else '❌'} {msg}")

    try:
        # ---- 1. 后端存活 ----
        print("\n[1/4] 后端与服务状态")
        try:
            c.get("/api/health").raise_for_status()
            health = c.get("/api/status").json()
            step(health.get("status") == "ok", f"后端存活，provider={health.get('provider')}，知识块={health.get('chunks')}")
        except Exception as e:
            step(False, f"后端不可达：{e}")
            raise SystemExit(1)

        if health.get("provider") == "mock":
            step(False, "当前为演示模式（未配置 Key）——本脚本只验证真实链路，请先在设置面板接入模型")
            raise SystemExit(1)

        # ---- 2. 模型真实可用 ----
        # 用当前生效配置做真实调用（读取 config 再 test）
        cfg = c.get("/api/config").json()
        t = c.post("/api/config/test", json={"base_url": cfg["base_url"], "model": cfg["model"]}).json()
        if t.get("ok"):
            step(True, f"模型真实可用：{cfg['model']} @ {cfg['base_url']}，回复「{t.get('reply')}」")
        else:
            step(False, f"模型调用失败：{t.get('error')}")
            raise SystemExit(1)

        # ---- 3. 真实 RAG：注入标记文档 → 提问 → 检索命中 → 模型生成 ----
        print("\n[2/4] 知识注入与检索增强生成（真实模型）")
        r = c.post("/api/knowledge/text", json={
            "name": DOC_NAME,
            "text": f"# 专用报销通道制度（验证专用）\n\n"
                    f"公司差旅报销专用通道编号为 {MARKER}。"
                    f"所有员工提交差旅报销时必须在系统内填写该编号，否则财务不予受理。"
                    f"该通道每月 1 日 0 点重置配额。",
        })
        step(r.status_code == 200, f"临时知识文档已入库（{DOC_NAME}.md，标记 {MARKER}）")

        created_session = c.post("/api/sessions").json()["id"]
        question = "公司差旅报销的专用通道编号是什么？"
        print(f"  → 提问：{question}")
        r = c.post("/api/chat", json={
            "message": question,
            "session_id": created_session,
            "force_retrieval": True,
            "allow_fetch": False,
        })
        events = parse_sse(r.text)
        types = [e["type"] for e in events]
        step("tool_call" in types and "tool_result" in types, "Agent 完成知识库检索（工具调用）")

        tool_result = next((e["content"] for e in events if e["type"] == "tool_result"), "")
        step(MARKER in tool_result, "检索命中注入文档（标记出现在检索结果中）")

        answer = "".join(e["content"] for e in events if e["type"] == "token")
        errors = [e for e in events if e["type"] == "error"]
        if errors:
            step(False, f"生成失败：{errors[0]['message']}")
            raise SystemExit(1)
        step(MARKER in answer, f"模型回答基于检索内容生成（包含标记 {MARKER}）——真实 RAG 增强生效")

        # ---- 4. 持久化与闭环 ----
        print("\n[3/4] 会话持久化")
        msgs = c.get(f"/api/sessions/{created_session}/messages").json()["messages"]
        step([m["role"] for m in msgs] == ["user", "assistant"], "用户/助手消息均已落库")
        step(bool(msgs[1]["steps"]), "工具步骤随消息持久化（刷新可回看检索过程）")
        title = c.get(f"/api/sessions/{created_session}").json()["title"]
        step(title != "新会话", f"会话标题自动生成：「{title}」")

    finally:
        # ---- 清理 ----
        print("\n[4/4] 清理验证数据")
        try:
            c.delete(f"/api/knowledge?source=uploads/{DOC_NAME}.md")
            step(True, "临时知识文档已删除")
        except Exception as e:
            step(False, f"清理知识文档失败：{e}")
        if created_session:
            try:
                c.delete(f"/api/sessions/{created_session}")
                step(True, "验证会话已删除")
            except Exception as e:
                step(False, f"清理会话失败：{e}")

    ok = all(r for r, _ in results)
    print(f"\n{'=' * 46}\n{'🎉 全部通过：真实链路（模型 + Key + RAG）端到端可用' if ok else '💥 存在失败项，见上方 ❌'}\n{'=' * 46}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
