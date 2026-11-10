import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchHealth, streamChat } from './api'
import type { ChatMessage, HealthInfo, ToolStep } from './types'
import { MessageBubble } from './components/MessageBubble'
import { Composer } from './components/Composer'
import { ToolTimeline } from './components/ToolTimeline'
import { SettingsModal } from './components/SettingsModal'
import { KnowledgePanel } from './components/KnowledgePanel'
import { GridBackdrop } from './components/GridBackdrop'
import {
  IconBolt,
  IconBook,
  IconCheck,
  IconDatabase,
  IconSettings,
  IconSparkle,
  IconWrench,
} from './components/icons'

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
  const [knowledgeOn, setKnowledgeOn] = useState(true) // 强制检索知识库
  const [webOn, setWebOn] = useState(true) // 允许抓取网页
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
      })
  }, [thinking, flushTypeBuffer, knowledgeOn, webOn])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    typeQueueRef.current = ''
  }, [])

  const isDemo = health?.provider === 'mock'
  const hasChat = messages.length > 0
  const [heroScrolled, setHeroScrolled] = useState(false)
  const glass = hasChat || heroScrolled // 会话态常驻毛玻璃；首页滚动后出现

  return (
    <div className="app">
      <GridBackdrop />

      <header className="header">
        <div className={`nav-pill ${glass ? 'glass' : ''}`}>
          <div className="header-title">
            <span className="logo"><IconBolt size={15} /></span>
            <h1>企业知识智能体</h1>
          </div>
          <div className="header-actions">
            <span className={`status-chip ${isDemo ? 'demo' : 'ok'}`}>
              <span className="dot" />
              {health ? (isDemo ? '演示模式' : '已接入') : '未连接'}
            </span>
            <button className="icon-btn" title="知识库管理" onClick={() => setShowKnowledge(true)}>
              <IconBook size={15} />
            </button>
            <button className="icon-btn" title="接入模型服务" onClick={() => setShowSettings(true)}>
              <IconSettings size={15} />
            </button>
          </div>
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
      ) : (
        <main
          className="hero"
          onScroll={(e) => setHeroScrolled((e.target as HTMLElement).scrollTop > 12)}
        >
          <h1 className="hero-title rise" style={{ animationDelay: '0.08s' }}>让企业知识可对话</h1>
          <p className="hero-sub rise" style={{ animationDelay: '0.12s' }}>
            接入制度规范、产品文档与业务资料，智能体自动检索、标注来源、流式作答
          </p>
          <div className="hero-composer rise" style={{ animationDelay: '0.18s' }}>
            <Composer
              disabled={thinking}
              onSend={send}
              onStop={stop}
              hero
              autoFocusInput
              knowledgeOn={knowledgeOn}
              webOn={webOn}
              onToggleKnowledge={() => setKnowledgeOn((v) => !v)}
              onToggleWeb={() => setWebOn((v) => !v)}
            />
          </div>
          <div className="hero-quick rise" style={{ animationDelay: '0.24s' }}>
            <button className="quick-chip" onClick={() => setShowSettings(true)}>
              {isDemo ? <IconSettings size={14} /> : <IconCheck size={14} />}
              {isDemo ? '接入模型服务' : '模型已接入'}
            </button>
            <button className="quick-chip" onClick={() => setShowKnowledge(true)}>
              <IconBook size={14} />
              管理知识库{health ? `（${health.chunks} 块）` : ''}
            </button>
          </div>

          <section className="hero-features">
            <div className="feature-card">
              <div className="feature-icon"><IconDatabase size={20} /></div>
              <h3>RAG 检索增强</h3>
              <p>企业文档自动分块向量化，回答前检索最相关片段并标注来源文件，内容可追溯</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon"><IconWrench size={20} /></div>
              <h3>Function Calling</h3>
              <p>智能体按需调用知识检索与网页抓取工具，多轮闭环完成跨文档问答</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon"><IconSparkle size={20} /></div>
              <h3>SSE 流式输出</h3>
              <p>Fetch Stream 逐字呈现回答，工具调用过程以时间线实时可视化</p>
            </div>
          </section>
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
