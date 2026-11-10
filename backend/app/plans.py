"""方案（Plan）：模型输出的结构化方案——规范化、校验、状态流转。

方案的定位：不是一段聊天文本，而是「有依据、可确认、可执行」的交付物。
- 每条依据（evidence）必须能溯源到知识库来源文件；
- 人工确认（confirmed）之前不允许进入执行阶段（P3）；
- 结构固定，前端按卡片渲染，不依赖模型自由排版。
"""
from typing import Any, Dict, List

PLAN_STATUSES = ("draft", "confirmed", "rejected")


def _s(value: Any, limit: int = 400) -> str:
    """转字符串并截断，避免模型输出超长字段污染存储与渲染。"""
    if value is None:
        return ""
    return str(value).strip()[:limit]


def _list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    return []


def normalize_plan(raw: Dict[str, Any]) -> Dict[str, Any]:
    """把 draft_plan 工具参数规范化为前端可直接渲染的方案结构。

    校验失败抛 ValueError（由 Agent 转成工具错误回给模型重试）。
    """
    if not isinstance(raw, dict):
        raise ValueError("方案参数必须是对象")

    steps: List[Dict[str, str]] = []
    for item in _list(raw.get("steps")):
        if isinstance(item, dict):
            title = _s(item.get("title"), 120)
            detail = _s(item.get("detail"), 800)
        else:
            title, detail = _s(item, 120), ""
        if title or detail:
            steps.append({"title": title or detail[:40], "detail": detail})

    evidence: List[Dict[str, str]] = []
    for item in _list(raw.get("evidence")):
        if not isinstance(item, dict):
            continue
        source = _s(item.get("source"), 200)
        quote = _s(item.get("quote") or item.get("snippet"), 400)
        if source or quote:
            evidence.append({"source": source, "quote": quote})

    risks: List[Dict[str, str]] = []
    for item in _list(raw.get("risks")):
        if isinstance(item, dict):
            risk = _s(item.get("risk"), 300)
            mitigation = _s(item.get("mitigation"), 300)
        else:
            risk, mitigation = _s(item, 300), ""
        if risk or mitigation:
            risks.append({"risk": risk, "mitigation": mitigation})

    systems = [_s(x, 60) for x in _list(raw.get("systems")) if _s(x, 60)]

    plan: Dict[str, Any] = {
        "title": _s(raw.get("title"), 80) or "解决方案",
        "background": _s(raw.get("background"), 600),
        "goal": _s(raw.get("goal"), 400),
        "steps": steps,
        "evidence": evidence,
        "risks": risks,
        "systems": systems,
        "status": "draft",
    }
    if not plan["steps"]:
        raise ValueError("方案至少需要一个实施步骤（steps 不能为空）")
    return plan


def set_status(plan: Dict[str, Any], status: str) -> Dict[str, Any]:
    if status not in PLAN_STATUSES:
        raise ValueError(f"非法状态：{status}")
    out = dict(plan)
    out["status"] = status
    return out
