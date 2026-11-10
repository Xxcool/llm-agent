import { useEffect, useRef, useState } from 'react'
import { createSession, getSession, getSessionMessages, streamChat } from '../api'
import type { ChatMessage, ToolStep } from '../types'
import { MessageBubble } from '../components/MessageBubble'
import { Composer } from '../components/Composer'
import { ToolTimeline } from '../components/ToolTimeline'
import { PlanCard } from '../components/PlanCard'
import { IconBolt } from '../components/icons'

let nextId = 1

const TYPE_INTERVAL = 18
const TYPE_CHARS = 3

export function ChatPage({
  sessionId,
  refreshSessions,
  onSessionCreated,
}: {
  /** null = 草稿新对话（不落库），首条消息发送时才创建会话 */
  sessionId: string | null
  refreshSessions: () => void
  /** 草稿页创建会话成功后回调（用于侧栏高亮，不影响路由与渲染） */
  onSessionCreated?: (id: string) => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [title, setTitle] = useState('')
  const [thinking, setThinking] = useState(false)
  const [typingId, setTypingId] = useState<number | null>(null)
  const [knowledgeOn, setKnowledgeOn] = useState(true)
  const [webOn, setWebOn] = useState(true)
  const [planMode, setPlanMode] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // 草稿模式创建会话后记录在这里（不触发重渲染，避免流式过程被打断）
  const activeSessionRef = useRef<string | null>(sessionId)

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
  const loadMessages = () => {
    const sid = activeSessionRef.current
    if (!sid) return Promise.resolve()
    return getSessionMessages(sid)
      .then((rows) => {
        setMessages(rows.map((r) => ({ ...r, id: nextId++, dbId: r.id })))
      })
      .catch(() => setMessages([]))
  }

  const sendRef = useRef<(text: string) => void>(() => undefined)

  useEffect(() => {
    let cancelled = false
    activeSessionRef.current = sessionId
    setMessages([])
    setTitle('')

    // 首页提问：?ask= 参数（新页签）或 history.state.pending（同页兜底）
    // 注意：先只读取不清理——StrictMode 下 effect 会执行两次，提前清理会让第二次拿不到参数
    const params = new URLSearchParams(window.location.search)
    const ask = sessionId ? params.get('ask') : null
    const st = window.history.state as { pending?: string } | null
    const pending = st?.pending ?? null

    if (sessionId) {
      // 先加载历史，加载完再自动发问，避免重载把流式消息冲掉
      getSessionMessages(sessionId)
        .then((rows) => {
          if (!cancelled) setMessages(rows.map((r) => ({ ...r, id: nextId++, dbId: r.id })))
        })
        .catch(() => {
          if (!cancelled) setMessages([])
        })
        .finally(() => {
          const text = ask || pending
          if (!cancelled && text) {
            window.setTimeout(() => {
              // 发送时才清理 URL/状态，避免 StrictMode 双执行吞掉参数
              if (ask) window.history.replaceState({}, '', `/c/${sessionId}`)
              if (pending) window.history.replaceState({ ...window.history.state, pending: null }, '')
              sendRef.current(text)
            }, 100)
          }
        })

      getSession(sessionId)
        .then((s) => {
          if (!cancelled) setTitle(s.title)
        })
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const refreshTitle = () => {
    const sid = activeSessionRef.current
    if (!sid) return
    getSession(sid).then((s) => setTitle(s.title)).catch(() => undefined)
  }

  // 切换会话/加载历史后瞬时定位到底部（不播滚动动画）；后续新消息才平滑滚动
  const jumpOnLoadRef = useRef(true)
  const chatRef = useRef<HTMLElement>(null)

  useEffect(() => {
    // 会话切换：下次 messages 就绪时直接跳底
    jumpOnLoadRef.current = true
  }, [sessionId])

  // 滚动时显示滚动条，停止 1 秒后隐藏（配合 .chat.scrolling 样式）
  useEffect(() => {
    const c = chatRef.current
    if (!c) return
    let timer: number | undefined
    const onScroll = () => {
      c.classList.add('scrolling')
      window.clearTimeout(timer)
      timer = window.setTimeout(() => c.classList.remove('scrolling'), 1000)
    }
    c.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      c.removeEventListener('scroll', onScroll)
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (messages.length === 0) return
    if (jumpOnLoadRef.current) {
      jumpOnLoadRef.current = false
      // 瞬时贴底（scrollTo instant，不受任何样式影响）；图片/代码高亮/公式
      // 会异步撑高内容，持续校正直到距底 ≤2px，保证「直接到最底部」
      let tries = 0
      const settle = () => {
        const c = chatRef.current
        if (!c) return
        const dist = c.scrollHeight - c.scrollTop - c.clientHeight
        if (dist > 2) c.scrollTo({ top: c.scrollHeight, behavior: 'instant' })
        if (++tries < 12) window.setTimeout(settle, 120)
      }
      settle()
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const runStream = (text: string, withUserBubble: boolean) => {
    const assistantMsg: ChatMessage = { id: nextId++, role: 'assistant', content: '', steps: [] }
    if (withUserBubble) {
      const userMsg: ChatMessage = { id: nextId++, role: 'user', content: text, steps: [] }
      setMessages((m) => [...m, userMsg, assistantMsg])
    } else {
      setMessages((m) => [...m, assistantMsg]) // 重新生成：复用原问题，不加新气泡
    }
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
      text,
      activeSessionRef.current,
      { force_retrieval: knowledgeOn, allow_fetch: webOn, plan_mode: planMode },
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
          case 'plan':
            patch((msg) => ({ ...msg, plan: event.plan }))
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
        // 静默重载：让新回复拿到数据库 id（反馈用）、落库时间戳与反馈状态
        void loadMessages()
      })
  }

  const send = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || thinkingRef.current) return
    if (activeSessionRef.current) {
      runStream(trimmed, true)
      return
    }
    // 草稿新对话：首条消息发送时才创建会话（空会话不落库）
    createSession()
      .then((s) => {
        activeSessionRef.current = s.id
        // 静默更新地址栏（replaceState 不触发重渲染，流式过程不受影响）
        window.history.replaceState(null, '', `/c/${s.id}`)
        onSessionCreated?.(s.id)
        runStream(trimmed, true)
      })
      .catch(() => {
        setMessages((m) => [
          ...m,
          { id: nextId++, role: 'assistant', content: '', steps: [], error: '创建会话失败，请重试' },
        ])
      })
  }

  /** 重新生成：删除该助手消息及之后内容，用其前最近的用户问题重发 */
  const regenerate = (assistantMsgId: number) => {
    if (thinkingRef.current) return
    const idx = messages.findIndex((m) => m.id === assistantMsgId)
    if (idx < 0) return
    const userText = [...messages.slice(0, idx)]
      .reverse()
      .find((m) => m.role === 'user')
      ?.content
    if (!userText) return
    setMessages((m) => m.slice(0, idx))
    runStream(userText, false)
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
      </div>
      <main className="chat" ref={chatRef}>
        {messages.length === 0 && !thinking && (
          <div className="chat-empty">
            <span className="logo"><IconBolt size={24} /></span>
            <p>有什么可以帮你的？</p>
            <span className="chat-empty-sub">基于企业知识库检索增强，支持流式输出与工具调用可视化</span>
          </div>
        )}
        {(() => {
          const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id
          return messages.map((msg) => (
            <div key={msg.id} className={`turn ${msg.role}`}>
              {msg.role === 'assistant' && (
                <div className="assistant-body">
                  {msg.steps.length > 0 && <ToolTimeline steps={msg.steps} />}
                  {msg.plan && (
                    <PlanCard
                      plan={msg.plan}
                      dbId={msg.dbId}
                      onChange={(p) =>
                        setMessages((m) => m.map((x) => (x.id === msg.id ? { ...x, plan: p } : x)))
                      }
                    />
                  )}
                  <MessageBubble
                    message={msg}
                    streaming={msg.id === typingId}
                    onRegenerate={msg.id === lastAssistantId ? () => regenerate(msg.id) : undefined}
                  />
                </div>
              )}
              {msg.role === 'user' && <MessageBubble message={msg} streaming={false} />}
            </div>
          ))
        })()}
        <div ref={bottomRef} />
      </main>
      <Composer
        disabled={thinking}
        onSend={send}
        onStop={stop}
        knowledgeOn={knowledgeOn}
        webOn={webOn}
        planMode={planMode}
        onToggleKnowledge={() => setKnowledgeOn((v) => !v)}
        onToggleWeb={() => setWebOn((v) => !v)}
        onTogglePlan={() => setPlanMode((v) => !v)}
      />
    </>
  )
}
