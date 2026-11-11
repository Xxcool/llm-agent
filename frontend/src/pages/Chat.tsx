import { useEffect, useRef, useState } from 'react'
import { createSession, getSession, getSessionMessages, listTasks, streamChat } from '../api'
import type { ChatMessage, Task, ToolStep } from '../types'
import { MessageBubble } from '../components/MessageBubble'
import { Composer } from '../components/Composer'
import { ToolTimeline } from '../components/ToolTimeline'
import { PlanGroup } from '../components/PlanGroup'
import { TaskBoard } from '../components/TaskBoard'
import { IconBolt } from '../components/icons'

let nextId = 1

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
  const [requestError, setRequestError] = useState('')
  const [typingId, setTypingId] = useState<number | null>(null)
  const [knowledgeOn, setKnowledgeOn] = useState(true)
  const [webOn, setWebOn] = useState(true)
  const [planMode, setPlanMode] = useState(false)
  // 任务按消息 id 分组（P3 行动层）
  const [tasksByMsg, setTasksByMsg] = useState<Record<number, Task[]>>({})
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // 草稿模式创建会话后记录在这里（不触发重渲染，避免流式过程被打断）
  const activeSessionRef = useRef<string | null>(sessionId)

  const thinkingRef = useRef(false)

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

  /** 加载会话内任务并按消息分组（任务看板数据） */
  const loadTasks = (sid: string) => {
    listTasks(sid)
      .then((tasks) => {
        const grouped: Record<number, Task[]> = {}
        for (const t of tasks) {
          grouped[t.message_id] = [...(grouped[t.message_id] ?? []), t]
        }
        setTasksByMsg(grouped)
      })
      .catch(() => setTasksByMsg({}))
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

    // 首页「结构化方案」卡片入口：?plan=1 直接开启方案模式
    if (params.get('plan') === '1') {
      setPlanMode(true)
      window.history.replaceState(null, '', window.location.pathname)
    }

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

      // 任务看板数据（按消息分组）
      loadTasks(sessionId)
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

  const runStream = (text: string, withUserBubble: boolean, replaceFromId?: number) => {
    setRequestError('')
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

    const controller = new AbortController()
    abortRef.current = controller

    const patch = (fn: (m: ChatMessage) => ChatMessage) => {
      setMessages((m) => m.map((msg) => (msg.id === assistantMsg.id ? fn(msg) : msg)))
    }

    streamChat(
      text,
      activeSessionRef.current,
      { force_retrieval: knowledgeOn, allow_fetch: webOn, plan_mode: planMode, replace_from_id: replaceFromId },
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
            // 真流式：收到增量立即追加，不再走固定速度的打字机队列
            patch((msg) => ({ ...msg, content: msg.content + event.content }))
            break
          case 'plan':
            // 多方案：同一轮可能产出多个候选，按 id 追加（同 id 覆盖）
            patch((msg) => {
              const existing = msg.plans ?? []
              const idx = existing.findIndex((p) => p.id === event.plan.id)
              const next = idx >= 0
                ? existing.map((p, i) => (i === idx ? event.plan : p))
                : [...existing, event.plan]
              return { ...msg, plans: next }
            })
            break
          case 'error':
            setRequestError(event.message)
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
          setRequestError((e as Error).message)
          patch((msg) => ({ ...msg, error: `请求异常：${(e as Error).message}` }))
        }
      })
      .finally(async () => {
        // 先取回数据库 ID，再允许下一次发送，避免旧历史请求覆盖新一轮流式消息。
        await loadMessages()
        thinkingRef.current = false
        setThinking(false)
        setTypingId(null)
        abortRef.current = null
        refreshSessions()
        refreshTitle()
        // 静默重载：让新回复拿到数据库 id（反馈用）、落库时间戳与反馈状态
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
    thinkingRef.current = true
    setThinking(true)
    createSession()
      .then((s) => {
        activeSessionRef.current = s.id
        // 静默更新地址栏（replaceState 不触发重渲染，流式过程不受影响）
        window.history.replaceState(null, '', `/c/${s.id}`)
        onSessionCreated?.(s.id)
        runStream(trimmed, true)
      })
      .catch((error: unknown) => {
        thinkingRef.current = false
        setThinking(false)
        setRequestError((error as Error).message)
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
    const dbId = messages[idx].dbId
    if (!userText || !dbId) return
    setMessages((m) => m.slice(0, idx))
    runStream(userText, false, dbId)
  }

  /** 编辑用户提问：替换内容并丢弃其后的所有消息，再用新内容重新生成回答 */
  const editUserMessage = (msgId: number, newText: string) => {
    if (thinkingRef.current) return
    const idx = messages.findIndex((m) => m.id === msgId)
    if (idx < 0) return
    const dbId = messages[idx].dbId
    if (!dbId) return
    setMessages((m) =>
      m.slice(0, idx + 1).map((x) => (x.id === msgId ? { ...x, content: newText } : x)),
    )
    runStream(newText, false, dbId)
  }

  sendRef.current = send

  const stop = () => {
    abortRef.current?.abort()
  }

  return (
    <>
      <div className="chat-header">
        <span className="chat-header-title" title={title}>{title || '新会话'}</span>
      </div>
      {requestError && <div className="chat-error" role="alert">{requestError}</div>}
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
                  {msg.plans && msg.plans.length > 0 && (
                    <PlanGroup
                      plans={msg.plans}
                      dbId={msg.dbId}
                      onChange={(plans) =>
                        setMessages((m) => m.map((x) => (x.id === msg.id ? { ...x, plans } : x)))
                      }
                    />
                  )}
                  {msg.dbId && (() => {
                    const confirmedPlan = msg.plans?.find((p) => p.status === 'confirmed')
                    if (!confirmedPlan) return null
                    const tasks = (tasksByMsg[msg.dbId!] ?? []).filter((t) => t.plan_id === confirmedPlan.id)
                    const mid = msg.dbId!
                    return (
                      <TaskBoard
                        key={`${mid}:${confirmedPlan.id}`}
                        messageId={mid}
                        planId={confirmedPlan.id}
                        tasks={tasks}
                        onTasks={(list) => setTasksByMsg((prev) => ({
                          ...prev,
                          [mid]: [...(prev[mid] ?? []).filter((t) => t.plan_id !== confirmedPlan.id), ...list],
                        }))}
                      />
                    )
                  })()}
                  <MessageBubble
                    message={msg}
                    streaming={msg.id === typingId}
                    isLatest={msg.id === lastAssistantId}
                    onRegenerate={msg.id === lastAssistantId ? () => regenerate(msg.id) : undefined}
                  />
                </div>
              )}
              {msg.role === 'user' && (
                <MessageBubble
                  message={msg}
                  streaming={false}
                  onEdit={thinking ? undefined : (text) => editUserMessage(msg.id, text)}
                />
              )}
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
