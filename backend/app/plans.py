"""方案（Plan）：模型输出的结构化方案——规范化、校验、状态流转。

方案的定位：不是一段聊天文本，而是「有依据、可确认、可执行」的交付物。
- 每条依据（evidence）必须能溯源到知识库来源文件；
- 人工确认（confirmed）之前不允许进入执行阶段（P3）；
- 结构固定，前端按卡片渲染，不依赖模型自由排版；
- 多方案对比（M2）：同一诉求可产出 2-3 个候选，带成本/周期/风险权衡，
  确认其中一个时其余自动驳回。
"""
import uuid
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
        # ID 由服务端产生，避免模型复用 ID 破坏候选互斥和任务归属。
        "id": uuid.uuid4().hex[:12],
        "title": _s(raw.get("title"), 80) or "解决方案",
        "approach": _s(raw.get("approach"), 160),
        "background": _s(raw.get("background"), 600),
        "goal": _s(raw.get("goal"), 400),
        "steps": steps,
        "evidence": evidence,
        "risks": risks,
        "systems": systems,
        # 对比维度（M2 多方案权衡）
        "cost": _s(raw.get("cost"), 60),
        "duration": _s(raw.get("duration"), 60),
        "risk_level": _s(raw.get("risk_level"), 20),
        "recommended": bool(raw.get("recommended")),
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


def normalize_plan_list(value: Any) -> List[Dict[str, Any]]:
    """把库里的方案字段归一为列表：兼容早期的单个方案对象（M1 存量数据）。"""
    if value is None:
        return []
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        return [p for p in value if isinstance(p, dict)]
    return []


def apply_selection(plans: List[Dict[str, Any]], plan_id: str, status: str) -> List[Dict[str, Any]]:
    """更新指定方案状态；确认其中一个时，其余自动驳回（多方案互斥）。"""
    if status not in PLAN_STATUSES:
        raise ValueError(f"非法状态：{status}")
    if not any(p.get("id") == plan_id for p in plans):
        raise ValueError("方案不存在")
    out: List[Dict[str, Any]] = []
    for p in plans:
        if p.get("id") == plan_id:
            out.append({**p, "status": status})
        elif status == "confirmed":
            # 选定一个方案后，其他候选自动驳回，避免多处「待确认」
            out.append({**p, "status": "rejected"})
        else:
            out.append(dict(p))
    return out
