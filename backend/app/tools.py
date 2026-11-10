"""工具集：Function Calling 的 schema 与实现。"""
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlsplit

import httpx

from . import config
from .rag import RagStore

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": "在企业知识库（制度规范、产品文档、技术资料、运营手册等）中做语义检索，返回最相关的片段。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "检索关键词或问题"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": "抓取一个网页的正文文本（自动去 HTML 标签），用于回答链接相关问题。",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "要抓取的 http/https 链接"},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "draft_plan",
            "description": (
                "生成结构化解决方案。当用户需要方案、建议、实施路径、落地步骤、"
                "「怎么做/如何推进」时调用此工具，而不是直接输出一段文字。"
                "调用前必须先用 search_knowledge 检索依据；evidence 中的每条都必须来自检索结果，"
                "source 填来源文件名，quote 摘录原文关键句，禁止编造来源。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "方案标题（简短，体现目标）"},
                    "approach": {"type": "string", "description": "一句话说明本方案的核心思路（多候选之间必须不同）"},
                    "cost": {"type": "string", "description": "成本量级估计，如「低」「约 2 人月」「预算 5 万」"},
                    "duration": {"type": "string", "description": "实施周期估计，如「2 周」「1 个月」"},
                    "risk_level": {"type": "string", "enum": ["低", "中", "高"], "description": "整体风险等级"},
                    "background": {"type": "string", "description": "背景与现状，说明为什么需要这个方案"},
                    "goal": {"type": "string", "description": "目标与预期结果（可衡量更好）"},
                    "steps": {
                        "type": "array",
                        "description": "实施步骤（有序）",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string", "description": "步骤标题"},
                                "detail": {"type": "string", "description": "具体做法与产出"},
                            },
                            "required": ["title"],
                        },
                    },
                    "evidence": {
                        "type": "array",
                        "description": "方案依据（来自知识库检索结果）",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source": {"type": "string", "description": "来源文件名/相对路径"},
                                "quote": {"type": "string", "description": "原文关键句摘录"},
                            },
                            "required": ["source"],
                        },
                    },
                    "risks": {
                        "type": "array",
                        "description": "风险与应对",
                        "items": {
                            "type": "object",
                            "properties": {
                                "risk": {"type": "string", "description": "风险点"},
                                "mitigation": {"type": "string", "description": "应对措施"},
                            },
                            "required": ["risk"],
                        },
                    },
                    "systems": {
                        "type": "array",
                        "description": "涉及的系统、部门或角色",
                        "items": {"type": "string"},
                    },
                },
                "required": ["title", "approach", "cost", "duration", "risk_level", "steps"],
            },
        },
    },
]


class ToolExecutor:
    def __init__(self, rag: RagStore, boost_fn=None):
        self.rag = rag
        self.boost_fn = boost_fn

    def run(self, name: str, args: dict) -> str:
        if name == "search_knowledge":
            boosts = self.boost_fn() if self.boost_fn else None
            hits = self.rag.search(args["query"], boosts=boosts)
            # 相似度阈值：最高分都达不到阈值说明知识库没覆盖该主题，
            # 宁可如实说没有也不要硬凑不相关内容污染回答
            hits = [h for h in hits if h[2] >= config.SCORE_THRESHOLD]
            if not hits and not self.rag.is_semantic:
                # 语义模型不可用（hash 降级向量）时分数天然偏低，字面兜底避免演示模式检索恒为空
                hits = self.rag.search_keyword(args["query"])
            if not hits:
                return "知识库中没有相关内容。"
            return "\n---\n".join(f"[{src}] {text}" for src, text, _ in hits)
        if name == "fetch_url":
            try:
                return fetch_text(args["url"])
            except Exception as e:  # noqa: BLE001 抓取失败以文本回给模型
                return f"抓取失败：{e.__class__.__name__}: {e}"
        return f"未知工具：{name}"


MAX_REDIRECTS = 5


def _resolve_public_ips(url: str):
    """解析 URL 并校验所有地址都是公网地址，返回 (parsed, ip 字符串列表)。

    这里返回解析结果，后续请求会直接连接这些 IP（并保留 Host/SNI），
    避免「校验时公网、实际连接时 DNS 重新绑定到内网」的问题。
    """
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("仅支持 http/https 链接")
    if parsed.username or parsed.password:
        raise ValueError("链接不能包含用户名或密码")
    host = parsed.hostname
    if not host:
        raise ValueError("链接缺少域名")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as e:
        raise ValueError("链接端口非法") from e

    try:
        addrs = [ipaddress.ip_address(host)]
    except ValueError:
        try:
            infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except socket.gaierror as e:
            raise ValueError(f"域名无法解析：{host}") from e
        addrs = []
        for info in infos:
            try:
                addrs.append(ipaddress.ip_address(info[4][0]))
            except ValueError:
                continue
    if not addrs:
        raise ValueError("域名没有可用地址")

    public_ips: list[str] = []
    for ip in addrs:
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
            or not ip.is_global
        ):
            raise ValueError("不允许访问内网或保留地址")
        public_ips.append(str(ip))
    return parsed, public_ips


def validate_public_url(url: str) -> None:
    """校验抓取目标：仅 http/https，且域名解析出的地址必须是公网地址。"""
    _resolve_public_ips(url)


def _host_header(parsed) -> str:
    host = parsed.hostname or ""
    if ":" in host:
        host = f"[{host}]"
    default_port = 443 if parsed.scheme == "https" else 80
    port = parsed.port or default_port
    return host if port == default_port else f"{host}:{port}"


def _ip_url(parsed, ip: str) -> str:
    host = f"[{ip}]" if ":" in ip else ip
    default_port = 443 if parsed.scheme == "https" else 80
    port = parsed.port or default_port
    authority = host if port == default_port else f"{host}:{port}"
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    return f"{parsed.scheme}://{authority}{path}"


def _get_with_safe_redirects(url: str) -> httpx.Response:
    """手动跟随重定向；每跳重新解析并直接连接已校验的 IP。

    Host 头保留原始域名，HTTPS 通过 sni_hostname 扩展保留 SNI，
    因此既能通过证书校验，也不会被 DNS rebinding 绕过。
    """
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        parsed, ips = _resolve_public_ips(current)
        headers = {
            "Host": _host_header(parsed),
            "User-Agent": "Mozilla/5.0 (compatible; llm-agent-platform/0.1)",
            "Accept": "text/html,application/xhtml+xml,text/plain,*/*",
            "Accept-Encoding": "identity",
        }
        extensions = {"sni_hostname": parsed.hostname} if parsed.scheme == "https" else {}
        resp = None
        last_error = None
        for ip in ips:
            request = httpx.Request(
                "GET", _ip_url(parsed, ip), headers=headers, extensions=extensions
            )
            try:
                with httpx.Client(
                    timeout=config.FETCH_URL_TIMEOUT,
                    follow_redirects=False,
                    trust_env=False,
                ) as client:
                    resp = client.send(request)
                break
            except httpx.TransportError as e:
                last_error = e
                continue
        if resp is None:
            raise last_error or ValueError("无法连接目标地址")

        if resp.is_redirect:
            location = resp.headers.get("location")
            resp.close()
            if not location:
                raise ValueError("重定向缺少 Location")
            current = urljoin(current, location)
            continue
        resp.raise_for_status()
        return resp
    raise ValueError("重定向次数过多")


def fetch_text(url: str, limit: int = 4000) -> str:
    """抓取网页并转纯文本（去 script/style/标签），供工具与链接导入共用。"""
    resp = _get_with_safe_redirects(url)
    text = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", resp.text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]
