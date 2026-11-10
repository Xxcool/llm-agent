import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchHealth, streamChat } from './api'
import type { ChatMessage, HealthInfo, ToolStep } from './types'
import { MessageBubble } from './components/MessageBubble'
import { Composer } from './components/Composer'
import { ToolTimeline } from './components/ToolTimeline'
import { SettingsModal } from './components/SettingsModal'
import { KnowledgePanel } from './components/KnowledgePanel'

let nextId = 1

const TYPE_INTERVAL = 18
const TYPE_CHARS = 3

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [thinking, setThinking] = useState(false)
  const [typingId, setTypingId] = useState<number | null>(null)
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showKnowledge, setShowKnowledge] = useState(false)
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

  const refreshHealth = useCallback(() => {
    fetchHealth().then(setHealth).catch(() => setHealth(null))
  }, [])

  useEffect(refreshHealth, [])

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

  const isDemo = health?.provider === 'mock'
  const hasChat = messages.length > 0

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <span className="logo">⚡</span>
          <h1>LLM Agent 智能对话平台</h1>
        </div>
        <div className="header-actions">
          <span className={`status-chip ${isDemo ? 'demo' : 'ok'}`}>
            <span className="dot" />
            {health ? (isDemo ? '演示模式' : '已接入') : '未连接'}
          </span>
          <button className="icon-btn" title="知识库管理" onClick={() => setShowKnowledge(true)}>
            📚
          </button>
          <button className="icon-btn" title="接入模型服务" onClick={() => setShowSettings(true)}>
            ⚙️
          </button>
        </div>
      </header>

      {hasChat ? (
        <>
          <main className="chat">
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
        </>
      ) : (
        <main className="hero">
          <div className="hero-mark">⚡</div>
          <h1 className="hero-title">让知识可对话</h1>
          <p className="hero-sub">
            上传文档构建专属知识库，Agent 自动检索、抓取网页、调用工具，流式生成回答
          </p>
          <div className="hero-composer">
            <Composer disabled={thinking} onSend={send} onStop={stop} hero autoFocusInput />
          </div>
          <div className="hero-quick">
            <button className="quick-chip" onClick={() => setShowSettings(true)}>
              {isDemo ? '⚙️ 接入模型服务' : '✅ 模型已接入'}
            </button>
            <button className="quick-chip" onClick={() => setShowKnowledge(true)}>
              📚 管理知识库{health ? `（${health.chunks} 块）` : ''}
            </button>
          </div>
        </main>
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={refreshHealth}
        />
      )}
      {showKnowledge && (
        <KnowledgePanel
          onClose={() => setShowKnowledge(false)}
          onChanged={refreshHealth}
        />
      )}
    </div>
  )
}
