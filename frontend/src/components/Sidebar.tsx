import { useEffect, useState } from 'react'
import { createSession, deleteSession, listSessions } from '../api'
import type { SessionInfo } from '../api'
import { IconBolt, IconX } from './icons'

export function Sidebar({
  activeId,
  onSelect,
  onNew,
  refreshSignal,
}: {
  activeId: string | null
  onSelect: (id: string) => void
  onNew: (id: string) => void
  refreshSignal: number
}) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [creating, setCreating] = useState(false)

  const refresh = () => {
    listSessions().then(setSessions).catch(() => setSessions([]))
  }

  useEffect(refresh, [refreshSignal])

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
      <button className="new-chat" onClick={handleNew} disabled={creating}>
        <IconBolt size={14} />
        {creating ? '创建中…' : '新会话'}
      </button>
      <div className="sess-list">
        {sessions.length === 0 && <p className="sess-empty">暂无会话记录</p>}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`sess-item ${s.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(s.id)}
            title={s.title}
          >
            <span className="sess-title">{s.title}</span>
            <button
              className="sess-del"
              onClick={(e) => handleDelete(s.id, e)}
              aria-label="删除会话"
            >
              <IconX size={11} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
