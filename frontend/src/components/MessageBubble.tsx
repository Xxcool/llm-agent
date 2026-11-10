import { useState } from 'react'
import type { ChatMessage } from '../types'
import { IconAlert, IconCopy, IconCheck, IconRefresh, IconSpeaker, IconThumbDown, IconThumbUp } from './icons'
import { MarkdownView } from './MarkdownView'

/** 去掉代码块与图片语法的纯文本（供 TTS 朗读） */
function toSpeakableText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '，代码块略，')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*>`|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function MessageBubble({ message, streaming, onRegenerate }: {
  message: ChatMessage
  streaming?: boolean
  onRegenerate?: () => void
}) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)

  const copyAll = async () => {
    await navigator.clipboard.writeText(message.content).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const toggleSpeak = () => {
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    const text = toSpeakableText(message.content)
    if (!text) return
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'zh-CN'
    utter.onend = () => setSpeaking(false)
    utter.onerror = () => setSpeaking(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utter)
    setSpeaking(true)
  }

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
          {!streaming && message.content && (
            <div className="msg-actions">
              <button className="msg-act" onClick={copyAll} title={copied ? '已复制' : '复制全文'}>
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </button>
              {onRegenerate && (
                <button className="msg-act" onClick={onRegenerate} title="重新生成">
                  <IconRefresh size={14} />
                </button>
              )}
              <button
                className={`msg-act ${speaking ? 'active' : ''}`}
                onClick={toggleSpeak}
                title={speaking ? '停止朗读' : '朗读回复'}
              >
                <IconSpeaker size={14} />
              </button>
              <button
                className={`msg-act ${feedback === 'up' ? 'active' : ''}`}
                onClick={() => setFeedback(feedback === 'up' ? null : 'up')}
                title="有用"
              >
                <IconThumbUp size={14} />
              </button>
              <button
                className={`msg-act ${feedback === 'down' ? 'active' : ''}`}
                onClick={() => setFeedback(feedback === 'down' ? null : 'down')}
                title="需改进"
              >
                <IconThumbDown size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
