import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../types'

const TOOL_LABELS: Record<string, string> = {
  search_knowledge: '🔍 检索知识库',
  get_resume: '📄 查询简历',
  fetch_url: '🌐 抓取网页',
}

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `🛠 ${name}`
}

export function MessageBubble({ message, streaming }: { message: ChatMessage; streaming?: boolean }) {
  const isUser = message.role === 'user'
  return (
    <div className={`bubble ${isUser ? 'user' : 'assistant'} ${streaming ? 'streaming' : ''}`}>
      {isUser ? (
        <div className="bubble-text">{message.content}</div>
      ) : (
        <div className="bubble-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content || ''}
          </ReactMarkdown>
          {streaming && !message.content && <span className="thinking-dots"><i /><i /><i /></span>}
          {message.error && <div className="bubble-error">⚠️ {message.error}</div>}
        </div>
      )}
    </div>
  )
}
