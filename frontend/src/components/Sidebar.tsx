import { useEffect, useMemo, useState } from 'react'
import { createSession, deleteSession, listSessions } from '../api'
import type { SessionInfo } from '../api'
import { IconApi, IconBolt, IconBook, IconX } from './icons'

/** 按 今天/昨天/更早 分组 */
function groupSessions(list: SessionInfo[]) {
  const groups: { label: string; items: SessionInfo[] }[] = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '更早', items: [] },
  ]
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  for (const s of list) {
    const d = new Date(s.updated_at)
    if (sameDay(d, today)) groups[0].items.push(s)
    else if (sameDay(d, yesterday)) groups[1].items.push(s)
    else groups[2].items.push(s)
  }
  return groups.filter((g) => g.items.length > 0)
}

export function Sidebar({
  activeId,
  onSelect,
  onNew,
  refreshSignal,
  onCollapse,
  onOpenSettings,
  onOpenKnowledge,
  isDemo,
}: {
  activeId: string | null
  onSelect: (id: string) => void
  onNew: (id: string) => void
  refreshSignal: number
  onCollapse: () => void
  onOpenSettings: () => void
  onOpenKnowledge: () => void
  isDemo: boolean
}) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [creating, setCreating] = useState(false)

  const refresh = () => {
    listSessions().then(setSessions).catch(() => setSessions([]))
  }

  useEffect(refresh, [refreshSignal])

  const groups = useMemo(() => groupSessions(sessions), [sessions])

  const handleNew = async () => {
    if (creating) return
    setCreating(true)
    try {
      const s = await createSession()
      onNew(s.id)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await deleteSession(id).catch(() => undefined)
    refresh()
  }

  return (
    <aside className="sidebar">
      <div className="sb-top">
        <button className="sb-brand" onClick={() => (window.location.pathname = '/')} title="返回首页">
          <IconBolt size={15} />
          LLM Agent
        </button>
        <button className="icon-btn sb-collapse" onClick={onCollapse} title="收起侧边栏">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
            <rect x="2" y="2.6" width="12" height="10.8" rx="2.2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6.2 2.8v10.4" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      </div>

      <button className="new-chat" onClick={handleNew} disabled={creating}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {creating ? '创建中…' : '开启新对话'}
      </button>

      <div className="sess-list">
        {sessions.length === 0 && <p className="sess-empty">暂无会话记录</p>}
        {groups.map((g) => (
          <div key={g.label}>
            <p className="sess-group-label">{g.label}</p>
            {g.items.map((s) => (
              <div
                key={s.id}
                className={`sess-item ${s.id === activeId ? 'active' : ''}`}
                onClick={() => onSelect(s.id)}
                title={s.title}
              >
                <span className="sess-title">{s.title}</span>
                <button className="sess-del" onClick={(e) => handleDelete(s.id, e)} aria-label="删除会话">
                  <IconX size={11} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="sb-bottom">
        <span className="sb-status">
          <span className={`dot ${isDemo ? 'mock' : ''}`} />
          {isDemo ? '演示模式（未接入 Key）' : '模型服务已接入'}
        </span>
        <div className="sb-bottom-actions">
          <button className="icon-btn" onClick={onOpenKnowledge}>
            <IconBook size={14} /> 知识库
          </button>
          <button className="icon-btn" onClick={onOpenSettings}>
            <IconApi size={14} /> 模型服务
          </button>
        </div>
      </div>
    </aside>
  )
}
