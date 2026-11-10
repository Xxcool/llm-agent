import type { ChatMessage } from '../types'
import { IconAlert } from './icons'
import { MarkdownView } from './MarkdownView'

export function MessageBubble({ message, streaming }: { message: ChatMessage; streaming?: boolean }) {
  const isUser = message.role === 'user'
  return (
    <div className={`bubble ${isUser ? 'user' : 'assistant'} ${streaming ? 'streaming' : ''}`}>
      {isUser ? (
        <div className="bubble-text">{message.content}</div>
      ) : (
        <>
          <MarkdownView content={message.content || ''} />
          {streaming && !message.content && <span className="thinking-dots"><i /><i /><i /></span>}
          {message.error && (
            <div className="bubble-error">
              <IconAlert size={13} /> {message.error}
            </div>
          )}
        </>
      )}
    </div>
  )
}
