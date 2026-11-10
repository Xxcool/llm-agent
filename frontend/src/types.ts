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

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  /** assistant 消息附带的工具调用过程（可视化时间线） */
  steps: ToolStep[]
  error?: string
}

export interface HealthInfo {
  status: string
  provider: string
  chunks: number
}
