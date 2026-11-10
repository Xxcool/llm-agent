"""任务（Task）：把已确认的方案拆解为可执行任务，并驱动逐步执行。

P3 行动层的最小闭环（M3）：
- 拆解：已确认方案 → 3-6 个任务（标题 / 做法 / 预期产出）
- 看板：待执行 / 执行中 / 已完成
- 执行：单任务产出 Markdown 交付文档（M4 再扩展代码写入、diff 审批与沙箱）
"""
import json
import re
from typing import Any, Dict, List

TASK_STATUSES = ("pending", "running", "done", "failed")


def _s(value: Any, limit: int = 600) -> str:
    if value is None:
        return ""
    return str(value).strip()[:limit]


def parse_json_array(text: str) -> List[Any]:
    """从模型输出里抠出 JSON 数组（容忍 ```json 代码块与前后说明文字）。"""
    if not text:
        return []
    cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE)
    start, end = cleaned.find("["), cleaned.rfind("]")
    if start < 0 or end <= start:
        return []
    try:
        data = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def normalize_tasks(raw: List[Any], plan_id: str) -> List[Dict[str, Any]]:
    """规范化任务列表：至少 1 个任务，标题必填，状态从 pending 开始。"""
    tasks: List[Dict[str, Any]] = []
    for item in raw:
        if isinstance(item, dict):
            title = _s(item.get("title"), 120)
            detail = _s(item.get("detail"), 800)
            output = _s(item.get("output") or item.get("deliverable"), 200)
        else:
            title, detail, output = _s(item, 120), "", ""
        if not title:
            continue
        tasks.append({
            "plan_id": plan_id,
            "title": title,
            "detail": detail,
            "output": output,
            "status": "pending",
            "artifact": None,
        })
    if not tasks:
        raise ValueError("未能拆解出任务（模型未返回有效 JSON 数组）")
    return tasks[:8]  # 单方案最多 8 个任务，避免失控


def breakdown_prompt(plan: Dict[str, Any]) -> str:
    steps = "\n".join(
        f"{i + 1}. {s.get('title', '')}：{s.get('detail', '')}"
        for i, s in enumerate(plan.get("steps", []))
    )
    return (
        "你是企业项目的项目经理。请把下面这份已确认的实施方案拆解为 3-6 个可独立执行的任务。\n"
        "要求：\n"
        "1) 任务粒度可交付：每个任务能在一次执行中产出明确成果；\n"
        "2) 任务之间尽量有先后依赖，按执行顺序排列；\n"
        "3) detail 写清具体做法（涉及系统/角色/输入）；output 写预期产出物；\n"
        "4) 只输出 JSON 数组，不要任何解释或代码块标记，格式：\n"
        '[{"title":"任务标题","detail":"具体做法","output":"预期产出"}]\n\n'
        f"方案标题：{plan.get('title', '')}\n"
        f"目标：{plan.get('goal', '')}\n"
        f"实施步骤：\n{steps}\n"
        f"涉及系统：{'、'.join(plan.get('systems', []))}\n"
    )


def run_prompt(plan: Dict[str, Any], task: Dict[str, Any], context: str) -> str:
    steps = "\n".join(f"{i + 1}. {s.get('title', '')}" for i, s in enumerate(plan.get("steps", [])))
    ctx = context.strip() or "（知识库中未检索到直接相关资料）"
    return (
        "你是方案执行者，需要完成方案中的一个任务，并产出可直接交付的 Markdown 文档。\n"
        "要求：\n"
        "1) 结构包含：任务目标、输入材料、具体做法、产出物、验收要点、注意事项；\n"
        "2) 严格基于提供的方案与参考资料，不得编造制度条款或数据；\n"
        "3) 只输出 Markdown 正文，不要额外解释；\n"
        "4) 正文控制在 800 字以内，聚焦可执行要点（表格/清单优先，不要空泛套话）。\n\n"
        f"方案：{plan.get('title', '')}\n实施步骤：\n{steps}\n"
        f"当前任务：{task.get('title', '')}\n做法：{task.get('detail', '')}\n预期产出：{task.get('output', '')}\n\n"
        f"参考资料（知识库检索片段）：\n{ctx[:2400]}\n"
    )


def apply_status(task: Dict[str, Any], status: str, artifact: str | None = None) -> Dict[str, Any]:
    if status not in TASK_STATUSES:
        raise ValueError(f"非法任务状态：{status}")
    out = dict(task)
    out["status"] = status
    if artifact is not None:
        out["artifact"] = artifact
    return out
