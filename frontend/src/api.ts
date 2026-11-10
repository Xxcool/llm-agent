import type { AgentEvent, HealthInfo, MessageFeedback, Plan, PlanStatus, Task } from './types'
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
  /** 方案模式：强制走 draft_plan 结构化方案链路（前端「方案模式」开关） */
  plan_mode?: boolean
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
  /** 已保存 Key 的掩码（如 sk-1••••abcd），不回传明文 */
  key_masked?: string | null
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

/** 真实调用一次模型验证接入配置（不落盘） */
export async function testConfig(cfg: {
  base_url: string
  model: string
  api_key?: string
}): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const resp = await fetch('/api/config/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return (await resp.json()) as { ok: boolean; reply?: string; error?: string }
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

/** 批量上传文件夹：items 为文件 + 其在文件夹内的相对路径（保留目录结构） */
export interface FolderUploadResult {
  saved: string[]
  skipped: string[]
  total_chunks: number
}

export async function uploadKnowledgeDir(
  items: { file: File; relPath: string }[],
): Promise<FolderUploadResult> {
  const form = new FormData()
  for (const it of items) {
    form.append('files', it.file)
    form.append('paths', it.relPath)
  }
  const resp = await fetch('/api/knowledge/upload-dir', { method: 'POST', body: form })
  if (!resp.ok) {
    const detail = await resp.json().catch(() => null) as { detail?: string } | null
    throw new Error(detail?.detail ?? `HTTP ${resp.status}`)
  }
  return (await resp.json()) as FolderUploadResult
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
  pinned: boolean
  updated_at: string
}

export interface StoredMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  steps: ToolStep[]
  created_at?: string
  feedback?: MessageFeedback
  /** 结构化方案列表（含确认状态） */
  plans?: Plan[]
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

/** 更新会话（重命名 / 置顶） */
export async function updateSession(
  id: string,
  patch: { title?: string; pinned?: boolean },
): Promise<SessionInfo> {
  const resp = await fetch(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return (await resp.json()) as SessionInfo
}

export async function getSessionMessages(id: string): Promise<StoredMessage[]> {
  const resp = await fetch(`/api/sessions/${id}/messages`)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = (await resp.json()) as { messages: StoredMessage[] }
  return data.messages
}

/** 获取单个会话信息（标题等） */
export async function getSession(id: string): Promise<SessionInfo> {
  const resp = await fetch(`/api/sessions/${id}`)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return (await resp.json()) as SessionInfo
}

/** 保存消息反馈（点赞/点踩，type=none 表示清除） */
export async function saveMessageFeedback(
  messageId: number,
  fb: { type: 'up' | 'down' | 'none'; reason?: string; comment?: string },
): Promise<void> {
  const resp = await fetch(`/api/messages/${messageId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fb),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
}

/** 更新方案状态（人工确认闸门）：确认一个方案时其余候选自动驳回 */
export async function updatePlanStatus(
  messageId: number,
  status: PlanStatus,
  planId?: string,
): Promise<Plan[]> {
  const resp = await fetch(`/api/messages/${messageId}/plan`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, plan_id: planId }),
  })
  if (!resp.ok) {
    const detail = (await resp.json().catch(() => null)) as { detail?: string } | null
    throw new Error(detail?.detail ?? `HTTP ${resp.status}`)
  }
  const data = (await resp.json()) as { plans: Plan[] }
  return data.plans
}

// ---------- 任务（P3 行动层） ----------

/** 把已确认方案拆解为任务（幂等） */
export async function breakdownTasks(messageId: number, planId?: string): Promise<Task[]> {
  const resp = await fetch(`/api/messages/${messageId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan_id: planId }),
  })
  if (!resp.ok) {
    const detail = (await resp.json().catch(() => null)) as { detail?: string } | null
    throw new Error(detail?.detail ?? `HTTP ${resp.status}`)
  }
  const data = (await resp.json()) as { tasks: Task[] }
  return data.tasks
}

export async function listTasks(sessionId: string): Promise<Task[]> {
  const resp = await fetch(`/api/sessions/${sessionId}/tasks`)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = (await resp.json()) as { tasks: Task[] }
  return data.tasks
}

/** 执行单个任务，产出 Markdown 交付物 */
export async function runTask(taskId: number): Promise<Task> {
  const resp = await fetch(`/api/tasks/${taskId}/run`, { method: 'POST' })
  if (!resp.ok) {
    const detail = (await resp.json().catch(() => null)) as { detail?: string } | null
    throw new Error(detail?.detail ?? `HTTP ${resp.status}`)
  }
  const data = (await resp.json()) as { task: Task }
  return data.task
}
