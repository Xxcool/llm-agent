import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, MessageFeedback } from '../types'
import { apiFetch, saveMessageFeedback } from '../api'
import { IconAlert, IconCheck, IconCopy, IconPencil, IconRefresh, IconSpeaker, IconThumbDown, IconThumbUp, IconX } from './icons'
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

/** 把朗读文本切成句片：按句末标点断句后合并到 ~40 字，便于边合成边播 */
function splitSpeech(text: string, maxLen = 40): string[] {
  const parts = text.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g) ?? [text]
  const out: string[] = []
  let buf = ''
  for (const raw of parts) {
    const s = raw.trim()
    if (!s) continue
    if ((buf + s).length <= maxLen) {
      buf += s
      continue
    }
    if (buf) out.push(buf)
    let rest = s
    while (rest.length > maxLen) {
      out.push(rest.slice(0, maxLen))
      rest = rest.slice(maxLen)
    }
    buf = rest
  }
  if (buf) out.push(buf)
  return out
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

/** TTS 音频缓存：文本 → MP3 ArrayBuffer。合成一次要十几秒，缓存后重复朗读秒开 */
const ttsCache = new Map<string, ArrayBuffer>()
const ttsInflight = new Map<string, Promise<ArrayBuffer>>()

function fetchTts(text: string): Promise<ArrayBuffer> {
  const hit = ttsCache.get(text)
  if (hit) return Promise.resolve(hit)
  const pending = ttsInflight.get(text)
  if (pending) return pending
  const p = apiFetch(`/api/tts?text=${encodeURIComponent(text)}`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.arrayBuffer()
    })
    .then((buf) => {
      ttsCache.set(text, buf)
      ttsInflight.delete(text)
      return buf
    })
    .catch((e: unknown) => {
      ttsInflight.delete(text)
      throw e
    })
  ttsInflight.set(text, p)
  return p
}

/**
 * 共享 AudioContext：在用户点击手势内 resume() 一次后，后续 decode/播放
 * 不再受自动播放策略限制。之前用 <audio> 时，等合成十几秒早已超出浏览器
 * 的手势有效期，play() 被静默拒绝，表现为「点了没声音」。
 */
let sharedCtx: AudioContext | null = null
function getAudioCtx(): AudioContext {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!sharedCtx) sharedCtx = new AC()
  return sharedCtx
}

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

export function MessageBubble({ message, streaming, onRegenerate, onEdit, isLatest }: {
  message: ChatMessage
  streaming?: boolean
  onRegenerate?: () => void
  /** 用户消息编辑：提交修改后的文本（由父组件截断后续消息并重新生成） */
  onEdit?: (text: string) => void
  /** 是否为最后一条助手消息：是则生成完成后后台预取语音，点朗读秒开 */
  isLatest?: boolean
}) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const [feedback, setFeedback] = useState<MessageFeedback | null>(message.feedback ?? null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')

  const copyAll = async () => {
    await navigator.clipboard.writeText(message.content).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const startEdit = () => {
    setDraft(message.content)
    setEditing(true)
  }

  const submitEdit = () => {
    const text = draft.trim()
    if (!text) return
    setEditing(false)
    onEdit?.(text)
  }

  const nodeRef = useRef<AudioBufferSourceNode | null>(null)
  // 朗读会话序号：每次停止/重开递增，异步回调据此判断是否已被用户停止
  const speakSeqRef = useRef(0)

  // 组件卸载时停止朗读，避免声音残留
  useEffect(() => () => {
    window.speechSynthesis?.cancel()
    try {
      nodeRef.current?.stop()
    } catch {
      /* 未在播放 */
    }
  }, [])

  const stopSpeak = () => {
    speakSeqRef.current++
    try {
      nodeRef.current?.stop()
    } catch {
      /* 未在播放 */
    }
    nodeRef.current = null
    window.speechSynthesis?.cancel()
    setSpeaking(false)
  }

  /** 降级：浏览器本地语音。优先挑系统里最自然的中文人声 */
  const speakWithLocalTTS = (text: string) => {
    const synth = window.speechSynthesis
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'zh-CN'
    const zhVoices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('zh'))
    const better =
      zhVoices.find((v) => /premium|enhanced/i.test(v.name)) ??
      zhVoices.find((v) => /xiaoxiao|yunxi|yunyang|xiaoyi|tingting|ting[- ]?ting|meijia|sinji|sin-ji/i.test(v.name)) ??
      zhVoices[0]
    if (better) utter.voice = better
    utter.rate = 1.05
    utter.onend = () => setSpeaking(false)
    utter.onerror = () => setSpeaking(false)
    synth.cancel()
    synth.speak(utter)
  }

  const toggleSpeak = async () => {
    if (speaking) {
      stopSpeak()
      return
    }
    const text = toSpeakableText(message.content)
    if (!text) return
    const chunks = splitSpeech(text)
    if (!chunks.length) return
    const seq = ++speakSeqRef.current
    setSpeaking(true)
    try {
      // 关键：在点击手势内先解锁 AudioContext。合成可能很慢，等回来再 play()
      // 早已超出浏览器手势有效期，会被静默拒绝（表现为点了没声音）
      const ctx = getAudioCtx()
      if (ctx.state === 'suspended') await ctx.resume()

      // 分句流水线：第 1 片合成完就播，播放期间并行合成下一片
      let pending: Promise<ArrayBuffer | null> | null = fetchTts(chunks[0])
      for (let i = 0; i < chunks.length; i++) {
        if (seq !== speakSeqRef.current || !pending) break
        const data = await pending
        if (seq !== speakSeqRef.current) return // 期间被停止
        if (!data) break // 某片合成失败：已有声音，直接收尾而不是重读全文
        pending = i + 1 < chunks.length ? fetchTts(chunks[i + 1]).catch(() => null) : null
        const decoded = await ctx.decodeAudioData(data.slice(0))
        if (seq !== speakSeqRef.current) return
        const node = ctx.createBufferSource()
        node.buffer = decoded
        node.connect(ctx.destination)
        nodeRef.current = node
        await new Promise<void>((resolve) => {
          node.onended = () => resolve()
          node.start()
        })
      }
      if (seq === speakSeqRef.current) setSpeaking(false)
    } catch {
      if (seq !== speakSeqRef.current) return // 期间被停止
      speakWithLocalTTS(text)
    }
  }

  // 最新一条助手消息生成完成后，后台静默预取第一句：点朗读时首响更快
  useEffect(() => {
    if (isUser || streaming || !isLatest) return
    const first = splitSpeech(toSpeakableText(message.content))[0]
    if (first && !ttsCache.has(first)) fetchTts(first).catch(() => undefined)
  }, [isUser, streaming, isLatest, message.content])

  const thumbUp = async () => {
    if (!message.dbId) return
    const next = feedback?.type === 'up' ? null : { type: 'up' as const }
    setFeedback(next)
    setPanelOpen(false)
    await persist(message.dbId, next)
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
  }

  const time = formatTime(message.created_at)

  return (
    <div className={`bubble ${isUser ? 'user' : 'assistant'} ${streaming ? 'streaming' : ''} ${editing ? 'editing' : ''}`}>
      {isUser ? (
        editing ? (
          <div className="bubble-edit">
            <textarea
              className="bubble-edit-input"
              value={draft}
              autoFocus
              rows={Math.min(8, Math.max(1, draft.split('\n').length))}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => {
                // 进入编辑态时光标默认停在行首，改到末尾便于继续补充
                const el = e.currentTarget
                el.setSelectionRange(el.value.length, el.value.length)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false)
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitEdit()
              }}
            />
            <div className="bubble-edit-actions">
              <button className="bubble-edit-btn" onClick={() => setEditing(false)}>取消</button>
              <button className="bubble-edit-btn primary" disabled={!draft.trim()} onClick={submitEdit}>发送</button>
            </div>
          </div>
        ) : (
          <>
            <div className="bubble-text">{message.content}</div>
            <div className="msg-actions user-actions">
              <button
                className="msg-act"
                onClick={copyAll}
                data-tip={copied ? '已复制' : '复制'}
                aria-label={copied ? '已复制' : '复制'}
              >
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </button>
              {onEdit && (
                <button className="msg-act" onClick={startEdit} data-tip="编辑" aria-label="编辑这条提问">
                  <IconPencil size={14} />
                </button>
              )}
              {time && <span className="msg-time">{time}</span>}
            </div>
          </>
        )
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
              <button className="msg-act" onClick={copyAll} data-tip={copied ? '已复制' : '复制'} aria-label={copied ? '已复制' : '复制全文'}>
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </button>
              {onRegenerate && (
                <button className="msg-act" onClick={onRegenerate} data-tip="重新生成" aria-label="重新生成">
                  <IconRefresh size={14} />
                </button>
              )}
              <button
                className={`msg-act ${speaking ? 'active speaking-wave' : ''}`}
                onClick={toggleSpeak}
                data-tip={speaking ? '停止朗读' : '朗读'}
                aria-label={speaking ? '停止朗读' : '朗读回复'}
              >
                {speaking ? (
                  <span className="wave-bars" aria-hidden>
                    <i /><i /><i /><i />
                  </span>
                ) : (
                  <IconSpeaker size={14} />
                )}
              </button>
              <button
                className={`msg-act ${feedback?.type === 'up' ? 'active' : ''}`}
                onClick={thumbUp}
                data-tip="喜欢"
                aria-label="有用"
              >
                <IconThumbUp size={14} />
              </button>
              <button
                className={`msg-act ${feedback?.type === 'down' ? 'active' : ''}`}
                onClick={thumbDown}
                data-tip="不喜欢"
                aria-label="需改进"
              >
                <IconThumbDown size={14} />
              </button>
              {time && <span className="msg-time">{time}</span>}
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
                {reason === '其他' && (
                  <input
                    className="fb-input"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="请说明具体原因"
                    onKeyDown={(e) => e.key === 'Enter' && submitDown()}
                  />
                )}
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
