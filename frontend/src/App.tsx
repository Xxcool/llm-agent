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
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const isDemo = health?.provider === 'mock'
  // 状态：未连接 / 演示模式 / 连接异常（真实探测失败）/ 已接入
  const healthState = !health ? 'down' : isDemo ? 'demo' : health.ok === false ? 'error' : 'ok'

  // 首页提问：新页签打开会话页（首页保留），问题通过 URL 参数带走
  const askOnHome = useCallback(
    async (text: string) => {
      if (creating) return
      setCreating(true)
      // 同步先开空白页签，避免 await 之后被浏览器当弹窗拦截
      const win = window.open('', '_blank')
      try {
        const s = await createSession()
        const url = `/c/${s.id}?ask=${encodeURIComponent(text)}`
        if (win) {
          win.location.href = url
        } else {
          // 弹窗被拦截时降级为当前页跳转
          navigate(url.replace('?ask=' + encodeURIComponent(text), ''), { pending: text })
        }
      } catch {
        win?.close()
      } finally {
        setCreating(false)
      }
    },
    [creating, navigate],
  )

  return (
    <div className="app">
      <GridBackdrop />

      {isSession && sessionId ? (
        <div className="shell">
          {sidebarOpen && (
            <Sidebar
              activeId={sessionId}
              onSelect={(id) => navigate(`/c/${id}`)}
              onNew={() => navigate('/')}
              refreshSignal={sessionRefresh}
              onCollapse={() => setSidebarOpen(false)}
              onOpenSettings={() => setShowSettings(true)}
              onOpenKnowledge={() => setShowKnowledge(true)}
              isDemo={Boolean(isDemo)}
              healthState={healthState}
              healthError={health?.ok === false ? health.error : null}
            />
          )}
          {!sidebarOpen && (
            <div className="sb-float">
              <button className="logo" onClick={() => navigate('/')} title="返回首页">
                <IconBolt size={15} />
              </button>
              <button className="icon-btn" title="展开侧边栏" onClick={() => setSidebarOpen(true)}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
                  <rect x="2" y="2.6" width="12" height="10.8" rx="2.2" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M6.2 2.8v10.4" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </button>
              <button className="icon-btn" title="新会话" onClick={() => navigate('/')}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}
          <div className={`chat-page ${sidebarOpen ? '' : 'no-sidebar'}`}>
            <ChatPage
              key={sessionId}
              sessionId={sessionId}
              refreshSessions={() => setSessionRefresh((n) => n + 1)}
            />
          </div>
        </div>
      ) : (
        <>
          <header className="header">
            <div className={`nav-pill ${heroScrolled ? 'glass' : ''}`}>
              <button className="header-title" onClick={() => navigate('/')}>
                <span className="logo"><IconBolt size={15} /></span>
                <h1>LLM Agent 智能对话平台</h1>
              </button>
              <div className="header-actions">
                <span className={`status-chip ${healthState}`} title={health?.ok === false ? health.error : undefined}>
                  <span className="dot" />
                  {healthState === 'down' ? '未连接'
                    : healthState === 'demo' ? '演示模式'
                    : healthState === 'error' ? '模型服务异常'
                    : '已接入'}
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
          <Home
            health={health}
            isDemo={Boolean(isDemo)}
            creating={creating}
            onAsk={askOnHome}
            onOpenSettings={() => setShowSettings(true)}
            onOpenKnowledge={() => setShowKnowledge(true)}
            onScrollChange={setHeroScrolled}
            healthState={healthState}
            healthError={health?.ok === false ? health.error : null}
          />
        </>
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
