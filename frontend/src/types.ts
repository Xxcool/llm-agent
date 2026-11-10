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
/** 结构化方案事件：模型调用 draft_plan 后产出 */
export interface PlanEvent {
  type: 'plan'
  plan: Plan
}
export type AgentEvent = ToolCallEvent | ToolResultEvent | TokenEvent | DoneEvent | ErrorEvent | PlanEvent

export interface ToolStep {
  name: string
  arguments: Record<string, unknown>
  result?: string
}

/** 结构化方案（P2 规划层）：有依据、可确认、可执行 */
export type PlanStatus = 'draft' | 'confirmed' | 'rejected'

export interface PlanStep {
  title: string
  detail: string
}

export interface PlanEvidence {
  /** 来源文件（知识库相对路径） */
  source: string
  /** 原文关键句摘录 */
  quote: string
}

export interface PlanRisk {
  risk: string
  mitigation: string
}

export interface Plan {
  title: string
  background: string
  goal: string
  steps: PlanStep[]
  evidence: PlanEvidence[]
  risks: PlanRisk[]
  systems: string[]
  status: PlanStatus
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
  /** 数据库中的真实消息 id（持久化反馈/方案状态用），本地新消息暂无 */
  dbId?: number
  created_at?: string
  feedback?: MessageFeedback
  /** 结构化方案（模型调用 draft_plan 时附带） */
  plan?: Plan
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
