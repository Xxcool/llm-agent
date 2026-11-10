import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteSession, listSessions, updateSession } from '../api'
import type { SessionInfo } from '../api'
import { IconApi, IconBolt, IconBook, IconX } from './icons'

/** DeepSeek 式圆环加号（开启新对话） */
export function IconNewChat({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M8 0.599609C3.91309 0.599609 0.599609 3.91309 0.599609 8C0.599609 9.13376 0.855461 10.2098 1.3125 11.1719L1.5918 11.7588L2.76562 11.2012L2.48633 10.6143C2.11034 9.82278 1.90039 8.93675 1.90039 8C1.90039 4.63106 4.63106 1.90039 8 1.90039C11.3689 1.90039 14.0996 4.63106 14.0996 8C14.0996 11.3689 11.3689 14.0996 8 14.0996C7.31041 14.0996 6.80528 14.0514 6.35742 13.9277C5.91623 13.8059 5.49768 13.6021 4.99707 13.2529C4.26492 12.7422 3.21611 12.5616 2.35156 13.1074L2.33789 13.1162L2.32422 13.126L1.58789 13.6436L2.01953 14.9297L3.0459 14.207C3.36351 14.0065 3.83838 14.0294 4.25293 14.3184C4.84547 14.7317 5.39743 15.011 6.01172 15.1807C6.61947 15.3485 7.25549 15.4004 8 15.4004C12.0869 15.4004 15.4004 12.0869 15.4004 8C15.4004 3.91309 12.0869 0.599609 8 0.599609ZM7.34473 4.93945V7.34961H4.93945V8.65039H7.34473V11.0605H8.64551V8.65039H11.0605V7.34961H8.64551V4.93945H7.34473Z" />
    </svg>
  )
}

/** 按 置顶 / 今天 / 昨天 / 更早 分组 */
function groupSessions(list: SessionInfo[]) {
  const pinned = list.filter((s) => s.pinned)
  const rest = list.filter((s) => !s.pinned)
  const groups: { label: string; items: SessionInfo[] }[] = []
  if (pinned.length > 0) groups.push({ label: '置顶', items: pinned })

  const buckets: { label: string; items: SessionInfo[] }[] = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '更早', items: [] },
  ]
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  for (const s of rest) {
    const d = new Date(s.updated_at)
    if (sameDay(d, today)) buckets[0].items.push(s)
    else if (sameDay(d, yesterday)) buckets[1].items.push(s)
    else buckets[2].items.push(s)
  }
  groups.push(...buckets.filter((g) => g.items.length > 0))
  return groups
}

/* ---------- 菜单小图标（16 线性，stroke currentColor） ---------- */
const MenuIcon = {
  rename: (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden>
      <path d="M11.3 2.1a1.6 1.6 0 0 1 2.3 2.3L5.4 12.6l-3 .9.9-3 8-8.4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden>
      <path d="M9.5 1.8 14.2 6.5l-2.4.6-2.5 2.5-.4 3-5.7-5.7 3-.4L8.9 4 9.5 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M3 13 6.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  multi: (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden>
      <circle cx="3" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="3" cy="12" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 4h7M7 12h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden>
      <path d="M2.5 4h11M6.5 4V2.8A.8.8 0 0 1 7.3 2h1.4a.8.8 0 0 1 .8.8V4M3.5 4l.7 9.2a1 1 0 0 0 1 .8h5.6a1 1 0 0 0 1-.8L12.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.3 7v4.5M9.7 7v4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="m10.4 10.4 3.2 3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
}

/** 搜索弹窗（DeepSeek / 豆包式：顶部居中面板，按标题过滤会话） */
function SearchModal({
  sessions,
  onClose,
  onSelect,
}: {
  sessions: SessionInfo[]
  onClose: () => void
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions.slice(0, 12) // 默认展示最近对话
    return sessions.filter((s) => s.title.toLowerCase().includes(q))
  }, [sessions, query])

  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-panel" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          {MenuIcon.search}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索对话…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results.length > 0) onSelect(results[0].id)
            }}
          />
          <button className="icon-btn" onClick={onClose} title="关闭">
            <IconX size={14} />
          </button>
        </div>
        <div className="search-results">
          <p className="search-label">{query.trim() ? '搜索结果' : '最近对话'}</p>
          {results.length === 0 && <p className="sess-empty">没有匹配的对话</p>}
          {results.map((s) => (
            <button
              key={s.id}
              className="search-item"
              onClick={() => onSelect(s.id)}
              title={s.title}
            >
              {s.pinned ? <span className="search-pin">{MenuIcon.pin}</span> : <span className="search-bubble" />}
              <span className="search-item-title">{s.title}</span>
              <span className="search-item-date">{fmtDate(s.updated_at)}</span>
            </button>
          ))}
        </div>
        <div className="search-footer">
          <span><kbd>Esc</kbd> 退出搜索</span>
          <span><kbd>↵</kbd> 打开首个结果</span>
        </div>
      </div>
    </div>
  )
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
  /** 开启新对话：不落库，回首页入口，首条消息发送时才创建会话 */
  onNew: () => void
  refreshSignal: number
  onCollapse: () => void
  onOpenSettings: () => void
  onOpenKnowledge: () => void
  isDemo: boolean
}) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const renameInputRef = useRef<HTMLInputElement>(null)

  const refresh = () => {
    listSessions().then(setSessions).catch(() => setSessions([]))
  }

  useEffect(refresh, [refreshSignal])

  // 点击其他区域关闭「…」菜单
  useEffect(() => {
    if (!menuFor) return
    const close = () => setMenuFor(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuFor])

  const filtered = sessions

  const groups = useMemo(() => groupSessions(filtered), [filtered])

  const handleNew = () => onNew()

  const handleDelete = async (id: string) => {
    await deleteSession(id).catch(() => undefined)
    refresh()
  }

  const handleRename = async (id: string) => {
    const title = renameValue.trim()
    setRenamingId(null)
    if (!title) return
    await updateSession(id, { title }).catch(() => undefined)
    refresh()
  }

  const handlePin = async (s: SessionInfo) => {
    await updateSession(s.id, { pinned: !s.pinned }).catch(() => undefined)
    refresh()
  }

  const startRename = (s: SessionInfo) => {
    setRenamingId(s.id)
    setRenameValue(s.title)
    setMenuFor(null)
    setTimeout(() => renameInputRef.current?.select(), 0)
  }

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exitSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  const batchPin = async () => {
    await Promise.all(
      [...selected].map((id) =>
        updateSession(id, { pinned: true }).catch(() => undefined),
      ),
    )
    exitSelecting()
    refresh()
  }

  const batchDelete = async () => {
    await Promise.all([...selected].map((id) => deleteSession(id).catch(() => undefined)))
    exitSelecting()
    refresh()
  }

  return (
    <aside className="sidebar">
      <div className="sb-top">
        <button className="sb-brand" onClick={() => (window.location.pathname = '/')} title="返回首页">
          <span className="logo"><IconBolt size={14} /></span>
          <span className="sb-brand-name">LLM Agent</span>
        </button>
        <div className="sb-top-actions">
          <button className="icon-btn" onClick={() => setShowSearch(true)} title="搜索对话">
            {MenuIcon.search}
          </button>
          <button className="icon-btn sb-collapse" onClick={onCollapse} title="收起侧边栏">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
              <rect x="2" y="2.6" width="12" height="10.8" rx="2.2" stroke="currentColor" strokeWidth="1.3" />
              <path d="M6.2 2.8v10.4" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
        </div>
      </div>

      <button className="new-chat" onClick={handleNew}>
        <IconNewChat />
        开启新对话
      </button>

      {selecting && (
        <div className="sb-selecting-bar">
          <span>已选择 {selected.size} 个对话</span>
          <button className="icon-btn" onClick={exitSelecting} title="退出多选">
            <IconX size={13} />
          </button>
        </div>
      )}

      <div className="sess-list">
        {groups.length === 0 && (
          <p className="sess-empty">暂无会话记录</p>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <p className="sess-group-label">{g.label}</p>
            {g.items.map((s) => (
              <div
                key={s.id}
                className={`sess-item ${s.id === activeId && renamingId !== s.id ? 'active' : ''} ${selected.has(s.id) ? 'checked' : ''} ${renamingId === s.id ? 'renaming' : ''}`}
                onClick={() => (selecting ? toggleSelected(s.id) : onSelect(s.id))}
                title={s.title}
              >
                {selecting ? (
                  <span className={`sess-check ${selected.has(s.id) ? 'on' : ''}`}>
                    {selected.has(s.id) && (
                      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden>
                        <path d="m3 8.5 3.2 3L13 4.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                ) : null}
                {renamingId === s.id ? (
                  <input
                    ref={renameInputRef}
                    className="sess-rename"
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => handleRename(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(s.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                ) : (
                  <span className="sess-title">{s.title}</span>
                )}
                {!selecting && renamingId !== s.id && (
                  <button
                    className="sess-more"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuFor(menuFor === s.id ? null : s.id)
                    }}
                    aria-label="更多操作"
                  >
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden>
                      <circle cx="3.2" cy="8" r="1.4" />
                      <circle cx="8" cy="8" r="1.4" />
                      <circle cx="12.8" cy="8" r="1.4" />
                    </svg>
                  </button>
                )}
                {menuFor === s.id && (
                  <div className="sess-menu" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => startRename(s)}>
                      {MenuIcon.rename} 重命名
                    </button>
                    <button onClick={() => { setMenuFor(null); handlePin(s) }}>
                      {MenuIcon.pin} {s.pinned ? '取消置顶' : '置顶'}
                    </button>
                    <button onClick={() => { setMenuFor(null); setSelecting(true); setSelected(new Set([s.id])) }}>
                      {MenuIcon.multi} 多选
                    </button>
                    <button className="danger" onClick={() => { setMenuFor(null); handleDelete(s.id) }}>
                      {MenuIcon.trash} 删除
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {selecting ? (
        <div className="sb-batch-bar">
          <button className="batch-btn" onClick={batchPin} disabled={selected.size === 0}>
            {MenuIcon.pin} 置顶
          </button>
          <span className="batch-divider" />
          <button className="batch-btn danger" onClick={batchDelete} disabled={selected.size === 0}>
            {MenuIcon.trash} 删除
          </button>
        </div>
      ) : (
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
      )}

      {showSearch && (
        <SearchModal
          sessions={sessions}
          onClose={() => setShowSearch(false)}
          onSelect={(id) => {
            setShowSearch(false)
            onSelect(id)
          }}
        />
      )}
    </aside>
  )
}
