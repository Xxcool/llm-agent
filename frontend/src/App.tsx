import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchHealth, streamChat } from './api'
import type { ChatMessage, HealthInfo, ToolStep } from './types'
import { MessageBubble } from './components/MessageBubble'
import { Composer } from './components/Composer'
import { ToolTimeline } from './components/ToolTimeline'

let nextId = 1

const SUGGESTIONS = [
  { icon: '🧊', text: '平台研发组有哪些 3D 可视化项目经验？' },
  { icon: '🛒', text: '介绍一下生鲜供应链项目的技术难点' },
  { icon: '⭐', text: '用一句话总结简历里的个人优势' },
  { icon: '🌐', text: '帮我抓取 https://github.com/Xxcool 的主页并总结' },
]

const TYPE_INTERVAL = 18 // 打字机步进间隔 ms
const TYPE_CHARS = 3 // 每步渲染字符数

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [thinking, setThinking] = useState(false)
  const [typingId, setTypingId] = useState<number | null>(null)
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // —— 打字机缓冲：token 事件先入队，定时器逐字渲染 ——
  const typeQueueRef = useRef('')
  const typeTargetRef = useRef<number | null>(null)
  const typeTimerRef = useRef<number | null>(null)
  const thinkingRef = useRef(false)

  const flushTypeBuffer = useCallback(() => {
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
  }, [])

  useEffect(() => () => {
    if (typeTimerRef.current !== null) window.clearInterval(typeTimerRef.current)
  }, [])

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => setHealth(null))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed || thinking) return

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
      })
  }, [thinking, flushTypeBuffer])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    typeQueueRef.current = ''
  }, [])

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <span className="logo">⚡</span>
          <h1>LLM Agent 智能对话平台</h1>
        </div>
        <div className="header-status">
          {health ? (
            <span className="status-chip ok" title={health.provider === 'mock' ? '离线演示模式' : `Provider: ${health.provider}`}>
              <span className="dot" />
              {health.provider === 'mock' ? '演示模式' : '在线'} · 知识库 {health.chunks} 块
            </span>
          ) : (
            <span className="status-chip err">
              <span className="dot" />
              后端未连接
            </span>
          )}
        </div>
      </header>

      <main className="chat">
        {messages.length === 0 && (
          <div className="empty">
            <div className="empty-logo">⚡</div>
            <p className="empty-title">基于 RAG + Function Calling 的流式 Agent</p>
            <p className="empty-sub">工具调用过程实时可视化 · 支持查简历 / 搜知识库 / 抓网页</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s.text} className="suggestion" onClick={() => send(s.text)} disabled={thinking}>
                  <span className="suggestion-icon">{s.icon}</span>
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`turn ${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="assistant-row">
                <div className="avatar">AI</div>
                <div className="assistant-body">
                  {msg.steps.length > 0 && <ToolTimeline steps={msg.steps} />}
                  <MessageBubble message={msg} streaming={msg.id === typingId} />
                </div>
              </div>
            )}
            {msg.role === 'user' && <MessageBubble message={msg} streaming={false} />}
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      <Composer disabled={thinking} onSend={send} onStop={stop} />
    </div>
  )
}
