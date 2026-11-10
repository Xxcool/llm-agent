/** 与后端 agent.py 产出的 SSE 事件一一对应 */
export interface ToolCallEvent {
  type: 'tool_call'
  name: string
  arguments: Record<string, unknown>
}
export interface ToolResultEvent {
  type: 'tool_result'
  name: string
  content: string
}
export interface TokenEvent {
  type: 'token'
  content: string
}
export interface DoneEvent {
  type: 'done'
}
export interface ErrorEvent {
  type: 'error'
  message: string
}
export type AgentEvent = ToolCallEvent | ToolResultEvent | TokenEvent | DoneEvent | ErrorEvent

export interface ToolStep {
  name: string
  arguments: Record<string, unknown>
  result?: string
}

/** 消息反馈（点赞/点踩，持久化到数据库） */
export interface MessageFeedback {
  type: 'up' | 'down'
  reason?: string
  comment?: string
  created_at?: string
}

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  /** assistant 消息附带的工具调用过程（可视化时间线） */
  steps: ToolStep[]
  error?: string
  /** 数据库中的真实消息 id（持久化反馈用），本地新消息暂无 */
  dbId?: number
  created_at?: string
  feedback?: MessageFeedback
}

export interface HealthInfo {
  status: string
  provider: string
  chunks: number
  model?: string
  /** 当前接入的 API 地址（非敏感，前端据此识别服务商品牌） */
  base_url?: string
  /** 模型服务真实探测结果（openai provider 才探测） */
  ok?: boolean
  error?: string
}
