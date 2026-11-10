import { useEffect, useRef, useState } from 'react'
import { getSession, getSessionMessages, streamChat } from '../api'
import type { ChatMessage, ToolStep } from '../types'
import { MessageBubble } from '../components/MessageBubble'
import { Composer } from '../components/Composer'
import { ToolTimeline } from '../components/ToolTimeline'

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
  const loadMessages = () => {
    return getSessionMessages(sessionId)
      .then((rows) => {
        setMessages(rows.map((r) => ({ ...r, id: nextId++, dbId: r.id })))
      })
      .catch(() => setMessages([]))
  }

  const sendRef = useRef<(text: string) => void>(() => undefined)

  useEffect(() => {
    let cancelled = false
    setMessages([])
    setTitle('')

    // 首页提问：?ask= 参数（新页签）或 history.state.pending（同页兜底）
    // 注意：先只读取不清理——StrictMode 下 effect 会执行两次，提前清理会让第二次拿不到参数
    const params = new URLSearchParams(window.location.search)
    const ask = params.get('ask')
    const st = window.history.state as { pending?: string } | null
    const pending = st?.pending ?? null

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
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const refreshTitle = () => {
    getSession(sessionId).then((s) => setTitle(s.title)).catch(() => undefined)
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
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
        // 静默重载：让新回复拿到数据库 id（反馈用）、落库时间戳与反馈状态
        void loadMessages()
      })
  }

  const send = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || thinkingRef.current) return
    runStream(trimmed, true)
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
      <main className="chat">
        {(() => {
          const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id
          return messages.map((msg) => (
            <div key={msg.id} className={`turn ${msg.role}`}>
              {msg.role === 'assistant' && (
                <div className="assistant-body">
                  {msg.steps.length > 0 && <ToolTimeline steps={msg.steps} />}
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
        onToggleKnowledge={() => setKnowledgeOn((v) => !v)}
        onToggleWeb={() => setWebOn((v) => !v)}
      />
    </>
  )
}
