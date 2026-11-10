import type { AgentEvent, HealthInfo } from './types'
import type { ToolStep } from './types'

/**
 * 解析 SSE 文本缓冲区，按 "data: {...}" 行切分事件。
 * 参考开源 chat UI（chatgpt-web / LobeChat）的 fetch 流式解析模式，
 * 不用 EventSource —— 因为本接口是 POST，且需要自定义请求头。
 */
function parseSSEBuffer(buffer: string, onLine: (data: string) => void): string {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? '' // 最后一段可能不完整，留给下一轮
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('data:')) onLine(trimmed.slice(5).trim())
  }
  return rest
}

/**
 * 发送对话请求并流式消费 Agent 事件。
 * onEvent 回调按事件类型分发；返回 abort 函数用于中途取消。
 */
export interface ChatOptions {
  /** 强制先检索知识库（前端「知识检索」开关） */
  force_retrieval: boolean
  /** 允许 Agent 抓取网页（前端「网页抓取」开关） */
  allow_fetch: boolean
}

export async function streamChat(
  message: string,
  sessionId: string | null,
  options: ChatOptions,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId, ...options }),
    signal,
  })
  if (!resp.ok || !resp.body) {
    throw new Error(`请求失败：HTTP ${resp.status}`)
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  // ReadableStream 逐块读取 → SSE 行解析 → JSON 反序列化
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    buffer = parseSSEBuffer(buffer, (data) => {
      if (!data || data === '[DONE]') return
      try {
        onEvent(JSON.parse(data) as AgentEvent)
      } catch {
        // 忽略无法解析的行（如 SSE 注释/心跳）
      }
    })
  }
}

export async function fetchHealth(): Promise<HealthInfo> {
  const resp = await fetch('/api/health')
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return (await resp.json()) as HealthInfo
}

// ---------- 平台配置（接入 LLM 服务商） ----------

export interface PlatformConfig {
  provider: string
  base_url: string
  model: string
  has_key: boolean
}

export async function fetchConfig(): Promise<PlatformConfig> {
  const resp = await fetch('/api/config')
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return (await resp.json()) as PlatformConfig
}

export async function saveConfig(cfg: {
  base_url?: string
  api_key?: string
  model?: string
}): Promise<{ status: string; provider: string }> {
  const resp = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return (await resp.json()) as { status: string; provider: string }
}

// ---------- 知识库管理 ----------

export interface KnowledgeDoc {
  source: string
  chunks: number
}

export async function listKnowledge(): Promise<KnowledgeDoc[]> {
  const resp = await fetch('/api/knowledge')
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = (await resp.json()) as { docs: KnowledgeDoc[] }
  return data.docs
}

export async function addKnowledgeText(name: string, text: string): Promise<void> {
  const resp = await fetch('/api/knowledge/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, text }),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
}

export async function uploadKnowledgeFile(file: File): Promise<void> {
  const form = new FormData()
  form.append('file', file)
  const resp = await fetch('/api/knowledge/upload', { method: 'POST', body: form })
  if (!resp.ok) {
    const detail = await resp.json().catch(() => null) as { detail?: string } | null
    throw new Error(detail?.detail ?? `HTTP ${resp.status}`)
  }
}

export async function deleteKnowledge(source: string): Promise<void> {
  const resp = await fetch(`/api/knowledge?source=${encodeURIComponent(source)}`, {
    method: 'DELETE',
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
}

export interface ImportResult {
  saved: string[]
  failed: { url?: string; id?: string; title?: string; error: string }[]
  total_chunks: number
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const detail = (await resp.json().catch(() => null)) as { detail?: string } | null
    throw new Error(detail?.detail ?? `HTTP ${resp.status}`)
  }
  return (await resp.json()) as T
}

/** 批量导入网页链接（如外部文档、规章制度页面） */
export async function importUrls(urls: string[]): Promise<ImportResult> {
  return postJson<ImportResult>('/api/knowledge/url', { urls })
}

// ---------- 会话管理 ----------

export interface SessionInfo {
  id: string
  title: string
  updated_at: string
}

export interface StoredMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  steps: ToolStep[]
}

export async function createSession(): Promise<SessionInfo> {
  const resp = await fetch('/api/sessions', { method: 'POST' })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return (await resp.json()) as SessionInfo
}

export async function listSessions(): Promise<SessionInfo[]> {
  const resp = await fetch('/api/sessions')
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = (await resp.json()) as { sessions: SessionInfo[] }
  return data.sessions
}

export async function deleteSession(id: string): Promise<void> {
  const resp = await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
}

export async function getSessionMessages(id: string): Promise<StoredMessage[]> {
  const resp = await fetch(`/api/sessions/${id}/messages`)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = (await resp.json()) as { messages: StoredMessage[] }
  return data.messages
}
