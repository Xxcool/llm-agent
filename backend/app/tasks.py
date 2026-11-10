"""任务（Task）：把已确认的方案拆解为可执行任务，并驱动逐步执行。

P3 行动层：
- M3：拆解 → 看板 → 文档类交付（Markdown）
- M4：代码类交付（文件产出）→ diff 预览 → 人工批准后落盘沙箱 → 语法校验
  命令执行默认不做（安全边界；只做 py_compile / json 解析这类确定性校验）
"""
import difflib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

TASK_STATUSES = ("pending", "running", "review", "done", "failed")
TASK_KINDS = ("doc", "code")
# 允许落盘的文件类型（白名单，防止写入可执行脚本/敏感文件）
ALLOWED_EXT = {
    ".md", ".txt", ".json", ".yml", ".yaml", ".csv",
    ".py", ".js", ".ts", ".tsx", ".jsx", ".css", ".html", ".sql",
}
MAX_FILE_BYTES = 200_000
MAX_FILES = 6  # 与产品文档、模型提示词保持一致


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
            kind = _s(item.get("kind"), 10).lower()
        else:
            title, detail, output, kind = _s(item, 120), "", "", ""
        if not title:
            continue
        tasks.append({
            "plan_id": plan_id,
            "title": title,
            "detail": detail,
            "output": output,
            # doc = 文档类交付（Markdown）；code = 代码/文件类交付（diff 审批后落盘）
            "kind": kind if kind in TASK_KINDS else "doc",
            "status": "pending",
            "artifact": None,
            "files": None,
            "checks": None,
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
        "4) kind 标注任务类型：doc（制度/流程/方案说明等文档交付）或 code"
        "（需要产出代码、配置、SQL、页面等技术文件的开发类任务）；\n"
        "5) 只输出 JSON 数组，不要任何解释或代码块标记，格式：\n"
        '[{"title":"任务标题","detail":"具体做法","output":"预期产出","kind":"doc"}]\n\n'
        f"方案标题：{plan.get('title', '')}\n"
        f"目标：{plan.get('goal', '')}\n"
        f"实施步骤：\n{steps}\n"
        f"涉及系统：{'、'.join(plan.get('systems', []))}\n"
    )


def run_prompt(plan: Dict[str, Any], task: Dict[str, Any], context: str) -> str:
    """文档类任务：直接产出 Markdown 交付物。"""
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


def code_run_prompt(plan: Dict[str, Any], task: Dict[str, Any], context: str) -> str:
    """代码类任务：产出结构化文件（path + content），前端看 diff 后批准落盘。"""
    steps = "\n".join(f"{i + 1}. {s.get('title', '')}" for i, s in enumerate(plan.get("steps", [])))
    ctx = context.strip() or "（知识库中未检索到直接相关资料）"
    return (
        "你是方案执行者，需要完成方案中的一个开发类任务，产出可落盘的文件。\n"
        "要求：\n"
        "1) 只输出 JSON 对象，不要代码块标记与额外解释；\n"
        "2) path 用相对路径（如 scripts/check_rules.py、config/rules.json），"
        "禁止绝对路径与 ..，扩展名限 .py/.js/.ts/.tsx/.css/.html/.sql/.json/.yml/.yaml/.md/.txt；\n"
        "3) 每个文件给出完整内容（不要省略号占位）；单文件不超过 200KB；最多 6 个文件；\n"
        "4) content 必须是可直接运行/解析的成品，Python 需能被 py_compile 通过；\n"
        "5) summary 用 2-3 句话说明交付内容与使用方式。\n"
        '格式：{"summary":"交付说明","files":[{"path":"相对路径","content":"文件内容"}]}\n\n'
        f"方案：{plan.get('title', '')}\n实施步骤：\n{steps}\n"
        f"当前任务：{task.get('title', '')}\n做法：{task.get('detail', '')}\n预期产出：{task.get('output', '')}\n\n"
        f"参考资料（知识库检索片段）：\n{ctx[:1800]}\n"
    )


# ---------- 文件产出：路径安全、diff、落盘与校验 ----------

def safe_relpath(rel: str) -> Path:
    """校验相对路径：禁止绝对路径/上级穿越/非法扩展名，返回规范化的相对路径。"""
    raw = (rel or "").replace("\\", "/").strip()
    # 绝对路径必须拒绝（包括 Windows 盘符），不能先 lstrip("/") 静默改成相对路径
    if not raw or raw.startswith("/") or re.match(r"^[A-Za-z]:", raw) or ".." in raw.split("/"):
        raise ValueError(f"非法文件路径：{rel}")
    p = Path(raw)
    if p.is_absolute() or p.suffix.lower() not in ALLOWED_EXT:
        raise ValueError(f"不支持的文件类型：{rel}")
    return p


def parse_code_files(text: str) -> Dict[str, Any]:
    """解析代码类执行结果：{"summary","files":[{path, content}]}。"""
    if not text:
        raise ValueError("模型未返回内容")
    cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("模型未返回 JSON 对象")
    try:
        data = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 解析失败：{e}") from e
    files_in = data.get("files") or []
    if not isinstance(files_in, list) or not files_in:
        raise ValueError("未产出任何文件")
    if len(files_in) > MAX_FILES:
        raise ValueError(f"文件数量超过上限（{MAX_FILES}）")
    files: List[Dict[str, str]] = []
    for f in files_in:
        if not isinstance(f, dict):
            continue
        rel = safe_relpath(str(f.get("path") or ""))
        content = f.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError(f"文件内容为空：{rel}")
        if len(content.encode("utf-8")) > MAX_FILE_BYTES:
            raise ValueError(f"文件过大（>200KB）：{rel}")
        files.append({"path": str(rel), "content": content})
    if not files:
        raise ValueError("未产出有效文件")
    return {"summary": _s(data.get("summary"), 600), "files": files}


def build_diffs(root: Path, files: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    """对比工作区现有内容，生成统一 diff（新文件按全新增处理）。"""
    out: List[Dict[str, Any]] = []
    for f in files:
        target = root / f["path"]
        exists = target.is_file()
        old = target.read_text(encoding="utf-8", errors="replace") if exists else ""
        diff = list(difflib.unified_diff(
            old.splitlines(),
            f["content"].splitlines(),
            fromfile=f"a/{f['path']}" if exists else "/dev/null",
            tofile=f"b/{f['path']}",
            lineterm="",
            n=3,
        ))
        out.append({
            "path": f["path"],
            "exists": exists,
            "added": sum(1 for line in diff if line.startswith("+") and not line.startswith("+++")),
            "removed": sum(1 for line in diff if line.startswith("-") and not line.startswith("---")),
            "diff": "\n".join(diff)[:12000],
            "content": f["content"],
        })
    return out


def apply_files(root: Path, files: List[Dict[str, str]]) -> List[str]:
    """把文件写入沙箱根目录（调用方已完成路径白名单校验）。"""
    root = root.resolve()
    written: List[str] = []
    for f in files:
        target = (root / f["path"]).resolve()
        if root != target and root not in target.parents:
            raise ValueError(f"路径越界：{f['path']}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f["content"], encoding="utf-8")
        written.append(f["path"])
    return written


def verify_file(path: Path) -> Dict[str, Any]:
    """落盘后的确定性校验：Python 语法编译、JSON 可解析，其余标记为跳过。"""
    suffix = path.suffix.lower()
    try:
        if suffix == ".py":
            import py_compile

            py_compile.compile(str(path), doraise=True, cfile=str(path) + ".pyc")
            Path(str(path) + ".pyc").unlink(missing_ok=True)
            return {"path": str(path.name), "ok": True, "detail": "Python 语法校验通过"}
        if suffix == ".json":
            json.loads(path.read_text(encoding="utf-8"))
            return {"path": str(path.name), "ok": True, "detail": "JSON 解析通过"}
        return {"path": str(path.name), "ok": True, "detail": "已写入（该类型无自动校验）"}
    except Exception as e:  # noqa: BLE001 语法错误作为校验结果返回，不抛异常
        return {"path": str(path.name), "ok": False, "detail": f"{e.__class__.__name__}: {e}"}


def apply_status(task: Dict[str, Any], status: str, artifact: str | None = None) -> Dict[str, Any]:
    if status not in TASK_STATUSES:
        raise ValueError(f"非法任务状态：{status}")
    out = dict(task)
    out["status"] = status
    if artifact is not None:
        out["artifact"] = artifact
    return out


def archive_relpath(task: Dict[str, Any], now: datetime | None = None) -> str:
    """知识库归档相对路径：沉淀/<年月>/<标题 slug>-<任务 id>.md。"""
    now = now or datetime.now()
    slug = re.sub(r"[^\w\u4e00-\u9fff-]+", "-", task.get("title") or "").strip("-")[:40]
    return f"沉淀/{now:%Y-%m}/{slug or 'task'}-{task['id']}.md"


def archive_markdown(task: Dict[str, Any], plan: Dict[str, Any] | None = None,
                     now: datetime | None = None) -> str:
    """把任务交付物整理成可回写知识库的 Markdown，保留方案→任务追溯链。"""
    now = now or datetime.now()
    plan = plan or {}
    lines = [
        f"# {task.get('title') or '任务交付归档'}",
        "",
        f"> 方案：{plan.get('title') or '未关联方案'}",
        f"> 任务：#{task['id']} · 类型：{task.get('kind') or 'doc'}",
        f"> 归档时间：{now:%Y-%m-%d %H:%M}",
        "",
    ]
    if task.get("artifact"):
        lines += ["## 交付说明", "", task["artifact"].strip(), ""]
    files = task.get("files") or []
    if files:
        lines += ["## 交付文件", ""]
        lines += [f"- `{f.get('path', '')}`" for f in files if f.get("path")]
        lines.append("")
    checks = task.get("checks") or []
    if checks:
        lines += ["## 校验结果", ""]
        lines += [
            f"- `{c.get('path', '')}`：{'通过' if c.get('ok') else '未通过'} — {c.get('detail', '')}"
            for c in checks
        ]
        lines.append("")
    lines += [
        "## 自动复盘",
        "",
        f"- 做了什么：{task.get('title') or '任务执行'}",
        f"- 方案依据：{len(plan.get('evidence') or [])} 条来源",
        f"- 交付结果：{len(files)} 个文件" if files else "- 交付结果：Markdown 文档",
        f"- 质量校验：{sum(1 for c in checks if c.get('ok'))}/{len(checks)} 通过" if checks else "- 质量校验：无自动校验项",
        "- 结论：交付物已归档，可在后续相似诉求中检索复用。",
        "",
        "## 追溯",
        "",
        f"- session_id：`{task.get('session_id', '')}`",
        f"- message_id：`{task.get('message_id', '')}`",
        f"- plan_id：`{task.get('plan_id', '')}`",
        f"- task_id：`{task.get('id', '')}`",
        "",
    ]
    return "\n".join(lines)
