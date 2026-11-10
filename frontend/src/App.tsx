import { useCallback, useEffect, useState } from 'react'
import { createSession, fetchHealth } from './api'
import type { HealthInfo } from './types'
import { GridBackdrop } from './components/GridBackdrop'
import { SettingsModal } from './components/SettingsModal'
import { KnowledgePanel } from './components/KnowledgePanel'
import { Sidebar } from './components/Sidebar'
import { Home } from './pages/Home'
import { ChatPage } from './pages/Chat'
import { IconApi, IconBolt, IconBook } from './components/icons'

export default function App() {
  const [path, setPath] = useState(window.location.pathname)
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showKnowledge, setShowKnowledge] = useState(false)
  const [heroScrolled, setHeroScrolled] = useState(false)
  const [creating, setCreating] = useState(false)
  const [sessionRefresh, setSessionRefresh] = useState(0)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((to: string, state?: unknown) => {
    window.history.pushState(state ?? {}, '', to)
    setPath(to)
    setHeroScrolled(false)
  }, [])

  const refreshHealth = useCallback(() => {
    fetchHealth().then(setHealth).catch(() => setHealth(null))
  }, [])

  useEffect(refreshHealth, [])

  const isSession = path.startsWith('/c/')
  const sessionId = isSession ? path.slice(3) : null
  const glass = Boolean(sessionId) || heroScrolled

  const isDemo = health?.provider === 'mock'

  // 首页提问：创建会话 → 跳转会话页并携带首条消息
  const askOnHome = useCallback(
    async (text: string) => {
      if (creating) return
      setCreating(true)
      try {
        const s = await createSession()
        navigate(`/c/${s.id}`, { pending: text })
      } finally {
        setCreating(false)
      }
    },
    [creating, navigate],
  )

  return (
    <div className="app">
      <GridBackdrop />

      <header className="header">
        <div className={`nav-pill ${glass ? 'glass' : ''}`}>
          <button className="header-title" onClick={() => navigate('/')}>
            <span className="logo"><IconBolt size={15} /></span>
            <h1>LLM Agent 智能对话平台</h1>
          </button>
          <div className="header-actions">
            <span className={`status-chip ${isDemo ? 'demo' : 'ok'}`}>
              <span className="dot" />
              {health ? (isDemo ? '演示模式' : '已接入') : '未连接'}
            </span>
            <button className="icon-btn" title="知识库管理" onClick={() => setShowKnowledge(true)}>
              <IconBook size={15} />
            </button>
            <button className="icon-btn" title="接入模型服务" onClick={() => setShowSettings(true)}>
              <IconApi size={15} />
            </button>
          </div>
        </div>
      </header>

      {isSession && sessionId ? (
        <div className="shell">
          <Sidebar
            activeId={sessionId}
            onSelect={(id) => navigate(`/c/${id}`)}
            onNew={(id) => navigate(`/c/${id}`)}
            refreshSignal={sessionRefresh}
          />
          <div className="chat-page">
            <ChatPage
              key={sessionId}
              sessionId={sessionId}
              refreshSessions={() => setSessionRefresh((n) => n + 1)}
            />
          </div>
        </div>
      ) : (
        <Home
          health={health}
          isDemo={Boolean(isDemo)}
          creating={creating}
          onAsk={askOnHome}
          onOpenSettings={() => setShowSettings(true)}
          onOpenKnowledge={() => setShowKnowledge(true)}
          onScrollChange={setHeroScrolled}
        />
      )}

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} onSaved={refreshHealth} />
      )}
      {showKnowledge && (
        <KnowledgePanel onClose={() => setShowKnowledge(false)} onChanged={refreshHealth} />
      )}
    </div>
  )
}
