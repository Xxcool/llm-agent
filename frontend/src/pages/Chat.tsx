import { useEffect, useRef, useState } from 'react'
import { getSession, getSessionMessages, streamChat } from '../api'
import type { ChatMessage, ToolStep } from '../types'
import { MessageBubble } from '../components/MessageBubble'
import { Composer } from '../components/Composer'
import { ToolTimeline } from '../components/ToolTimeline'
import { IconLink } from '../components/icons'

let nextId = 1

const TYPE_INTERVAL = 18
const TYPE_CHARS = 3

export function ChatPage({
  sessionId,
  refreshSessions,
}: {
  sessionId: string
  refreshSessions: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [title, setTitle] = useState('')
  const [thinking, setThinking] = useState(false)
  const [typingId, setTypingId] = useState<number | null>(null)
  const [knowledgeOn, setKnowledgeOn] = useState(true)
  const [webOn, setWebOn] = useState(true)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const typeQueueRef = useRef('')
  const typeTargetRef = useRef<number | null>(null)
  const typeTimerRef = useRef<number | null>(null)
  const thinkingRef = useRef(false)

  const flushTypeBuffer = () => {
    if (typeTimerRef.current !== null) return
    typeTimerRef.current = window.setInterval(() => {
      if (!typeQueueRef.current) {
        if (!thinkingRef.current) {
          window.clearInterval(typeTimerRef.current!)
          typeTimerRef.current = null
          setTypingId(null)
        }
        return
      }
      const take = typeQueueRef.current.slice(0, TYPE_CHARS)
      typeQueueRef.current = typeQueueRef.current.slice(TYPE_CHARS)
      const id = typeTargetRef.current
      if (id !== null) {
        setMessages((m) =>
          m.map((msg) => (msg.id === id ? { ...msg, content: msg.content + take } : msg)),
        )
      }
    }, TYPE_INTERVAL)
  }

  useEffect(() => () => {
    if (typeTimerRef.current !== null) window.clearInterval(typeTimerRef.current)
  }, [])

  // 加载会话历史与标题；若携带首条消息（首页跳转而来）自动发送
  useEffect(() => {
    let cancelled = false
    setMessages([])
    setTitle('')
    getSessionMessages(sessionId)
      .then((rows) => {
        if (!cancelled) setMessages(rows.map((r) => ({ ...r, id: nextId++ })))
      })
      .catch(() => setMessages([]))
    getSession(sessionId)
      .then((s) => {
        if (!cancelled) setTitle(s.title)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const refreshTitle = () => {
    getSession(sessionId).then((s) => setTitle(s.title)).catch(() => undefined)
  }

  const sendRef = useRef<(text: string) => void>(() => undefined)

  useEffect(() => {
    const st = window.history.state as { pending?: string } | null
    if (st?.pending) {
      const text = st.pending
      window.history.replaceState({ ...st, pending: null }, '')
      const t = window.setTimeout(() => sendRef.current(text), 120)
      return () => window.clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || thinkingRef.current) return

    const userMsg: ChatMessage = { id: nextId++, role: 'user', content: trimmed, steps: [] }
    const assistantMsg: ChatMessage = { id: nextId++, role: 'assistant', content: '', steps: [] }
    setMessages((m) => [...m, userMsg, assistantMsg])
    setThinking(true)
    thinkingRef.current = true
    setTypingId(assistantMsg.id)
    typeTargetRef.current = assistantMsg.id
    typeQueueRef.current = ''
    flushTypeBuffer()

    const controller = new AbortController()
    abortRef.current = controller

    const patch = (fn: (m: ChatMessage) => ChatMessage) => {
      setMessages((m) => m.map((msg) => (msg.id === assistantMsg.id ? fn(msg) : msg)))
    }

    streamChat(
      trimmed,
      sessionId,
      { force_retrieval: knowledgeOn, allow_fetch: webOn },
      (event) => {
        switch (event.type) {
          case 'tool_call': {
            const step: ToolStep = { name: event.name, arguments: event.arguments }
            patch((msg) => ({ ...msg, steps: [...msg.steps, step] }))
            break
          }
          case 'tool_result': {
            patch((msg) => {
              const steps = [...msg.steps]
              for (let i = steps.length - 1; i >= 0; i--) {
                if (steps[i].name === event.name && steps[i].result === undefined) {
                  steps[i] = { ...steps[i], result: event.content }
                  break
                }
              }
              return { ...msg, steps }
            })
            break
          }
          case 'token':
            typeQueueRef.current += event.content
            break
          case 'error':
            patch((msg) => ({ ...msg, error: event.message }))
            break
          case 'done':
            break
        }
      },
      controller.signal,
    )
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') {
          patch((msg) => ({ ...msg, error: `请求异常：${(e as Error).message}` }))
        }
      })
      .finally(() => {
        thinkingRef.current = false
        setThinking(false)
        abortRef.current = null
        refreshSessions()
        refreshTitle()
      })
  }

  sendRef.current = send

  const stop = () => {
    abortRef.current?.abort()
    typeQueueRef.current = ''
  }

  return (
    <>
      <div className="chat-header">
        <span className="chat-header-title" title={title}>{title || '新会话'}</span>
        <button
          className="icon-btn"
          title="复制会话链接"
          onClick={() => navigator.clipboard.writeText(window.location.href).catch(() => undefined)}
        >
          <IconLink size={14} />
        </button>
      </div>
      <main className="chat">
        {messages.map((msg) => (
          <div key={msg.id} className={`turn ${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="assistant-body">
                {msg.steps.length > 0 && <ToolTimeline steps={msg.steps} />}
                <MessageBubble message={msg} streaming={msg.id === typingId} />
              </div>
            )}
            {msg.role === 'user' && <MessageBubble message={msg} streaming={false} />}
          </div>
        ))}
        <div ref={bottomRef} />
      </main>
      <Composer
        disabled={thinking}
        onSend={send}
        onStop={stop}
        knowledgeOn={knowledgeOn}
        webOn={webOn}
        onToggleKnowledge={() => setKnowledgeOn((v) => !v)}
        onToggleWeb={() => setWebOn((v) => !v)}
      />
    </>
  )
}
