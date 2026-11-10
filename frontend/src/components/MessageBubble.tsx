import { useState } from 'react'
import type { ChatMessage, MessageFeedback } from '../types'
import { saveMessageFeedback } from '../api'
import { IconAlert, IconCheck, IconCopy, IconRefresh, IconSpeaker, IconThumbDown, IconThumbUp, IconX } from './icons'
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

/** 时间戳：当天只显示时分，跨天带日期（DeepSeek 式「星期日 00:58」） */
function formatTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return hm
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}

const DOWN_REASONS = [
  '不感兴趣', '有害/不安全', '信息虚假', '没有帮助',
  '隐私相关', '遗忘上下文/失忆', '记忆使用不当/错误', '其他',
]

/** 持久化一条反馈到数据库 */
async function persist(dbId: number | undefined, fb: MessageFeedback | null): Promise<boolean> {
  if (!dbId) return false
  try {
    await saveMessageFeedback(dbId, fb ? { type: fb.type, reason: fb.reason, comment: fb.comment } : { type: 'none' })
    return true
  } catch {
    return false
  }
}

export function MessageBubble({ message, streaming, onRegenerate }: {
  message: ChatMessage
  streaming?: boolean
  onRegenerate?: () => void
}) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [feedback, setFeedback] = useState<MessageFeedback | null>(message.feedback ?? null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [saved, setSaved] = useState(false)

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

  const thumbUp = async () => {
    if (!message.dbId) return
    const next = feedback?.type === 'up' ? null : { type: 'up' as const }
    setFeedback(next)
    setPanelOpen(false)
    if (await persist(message.dbId, next)) {
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1500)
    }
  }

  const thumbDown = () => {
    if (!message.dbId) return
    if (feedback?.type === 'down') {
      // 已点踩再点一次 = 取消
      setFeedback(null)
      setPanelOpen(false)
      void persist(message.dbId, null)
      return
    }
    setPanelOpen((v) => !v)
  }

  const submitDown = async () => {
    if (!reason || !message.dbId) return
    const fb: MessageFeedback = { type: 'down', reason, comment: comment.trim() || undefined }
    setFeedback(fb)
    setPanelOpen(false)
    setComment('')
    setReason('')
    await persist(message.dbId, fb)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1500)
  }

  const time = formatTime(message.created_at)

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
                className={`msg-act ${feedback?.type === 'up' ? 'active' : ''}`}
                onClick={thumbUp}
                title={message.dbId ? '有用' : '（新消息刷新后可反馈）'}
              >
                <IconThumbUp size={14} />
              </button>
              <button
                className={`msg-act ${feedback?.type === 'down' ? 'active' : ''}`}
                onClick={thumbDown}
                title="需改进"
              >
                <IconThumbDown size={14} />
              </button>
              {time && <span className="msg-time">{time}</span>}
              {saved && <span className="msg-saved">已记录</span>}
            </div>
          )}
          {panelOpen && (
            <div className="fb-panel">
              <div className="fb-head">
                <span>你觉得什么让你不满意？</span>
                <button className="icon-btn" onClick={() => setPanelOpen(false)} title="关闭">
                  <IconX size={12} />
                </button>
              </div>
              <div className="fb-chips">
                {DOWN_REASONS.map((r) => (
                  <button
                    key={r}
                    className={`fb-chip ${reason === r ? 'active' : ''}`}
                    onClick={() => setReason(reason === r ? '' : r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <div className="fb-foot">
                <input
                  className="fb-input"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="(可选) 告诉我们更多关于你的使用体验"
                  onKeyDown={(e) => e.key === 'Enter' && submitDown()}
                />
                <button className="fb-submit" onClick={submitDown} disabled={!reason}>
                  提交
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
