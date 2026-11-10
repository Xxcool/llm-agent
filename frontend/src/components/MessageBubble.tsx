import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../types'
import { IconAlert } from './icons'

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
          {message.error && (
            <div className="bubble-error">
              <IconAlert size={13} /> {message.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
