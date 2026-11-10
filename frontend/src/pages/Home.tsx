import { useState } from 'react'
import { IconAlert, IconApi, IconBook, IconCheck, IconDatabase, IconSparkle, IconWrench } from '../components/icons'

const FEATURES = [
  { icon: <IconDatabase size={20} />, title: 'RAG 检索增强', desc: '企业文档自动分块向量化，回答前检索最相关片段并标注来源文件，内容可追溯' },
  { icon: <IconWrench size={20} />, title: 'Function Calling', desc: '智能体按需调用知识检索与网页抓取工具，多轮闭环完成跨文档问答' },
  { icon: <IconSparkle size={20} />, title: 'SSE 流式输出', desc: 'Fetch Stream 逐字呈现回答，工具调用过程以时间线实时可视化' },
]

export function Home({
  health,
  isDemo,
  creating,
  onAsk,
  onOpenSettings,
  onOpenKnowledge,
  onScrollChange,
  healthState,
  healthError,
}: {
  health: { chunks: number } | null
  isDemo: boolean
  creating: boolean
  onAsk: (text: string) => void
  onOpenSettings: () => void
  onOpenKnowledge: () => void
  onScrollChange: (scrolled: boolean) => void
  healthState?: string
  healthError?: string | null
}) {
  const [ask, setAsk] = useState('')

  return (
    <main
      className="hero"
      onScroll={(e) => onScrollChange((e.target as HTMLElement).scrollTop > 12)}
    >
      <h1 className="hero-title rise" style={{ animationDelay: '0.08s' }}>让企业知识可对话</h1>
      <p className="hero-sub rise" style={{ animationDelay: '0.12s' }}>
        接入制度规范、产品文档与业务资料，智能体自动检索、标注来源、流式作答
      </p>
      <div className="hero-composer rise" style={{ animationDelay: '0.18s' }}>
        <div className="composer-box ask-box">
          <textarea
            value={ask}
            placeholder="向企业知识库提问…"
            rows={2}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (ask.trim() && !creating) {
                  onAsk(ask.trim())
                  setAsk('')
                }
              }
            }}
          />
          <div className="composer-bar">
            <div className="composer-chips">
              <span className="chip">
                <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                  <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                知识检索
              </span>
              <span className="chip">
                <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                  <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M1.7 8h12.6M8 1.7c1.9 1.8 2.9 4 2.9 6.3S9.9 12.5 8 14.3C6.1 12.5 5.1 10.3 5.1 8S6.1 3.5 8 1.7z" stroke="currentColor" strokeWidth="1.2" />
                </svg>
                网页抓取
              </span>
            </div>
            <button className="send" onClick={() => { if (ask.trim() && !creating) { onAsk(ask.trim()); setAsk('') } }} disabled={!ask.trim() || creating} title="开始会话">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8.3125 0.980206C8.66767 1.05312 8.97902 1.2042 9.2627 1.43235C9.48724 1.613 9.73029 1.85795 9.97949 2.10716L14.707 6.8347L13.293 8.24876L9 3.95579V15.0417H7V3.95579L2.70703 8.24876L1.29297 6.8347L6.02051 2.10716C6.26971 1.85795 6.51277 1.613 6.7373 1.43235C6.97662 1.23988 7.28445 1.04404 7.6875 0.980206C7.8973 0.947029 8.1031 0.955183 8.3125 0.980206Z" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div className="hero-quick rise" style={{ animationDelay: '0.24s' }}>
        <button
          className={`quick-chip ${healthState === 'error' ? 'quick-chip-error' : ''}`}
          onClick={onOpenSettings}
          title={healthState === 'error' ? healthError ?? undefined : undefined}
        >
          {healthState === 'error' ? <IconAlert size={14} /> : isDemo ? <IconApi size={14} /> : <IconCheck size={14} />}
          {healthState === 'error' ? '模型服务异常' : isDemo ? '接入模型服务' : '模型已接入'}
        </button>
        <button className="quick-chip" onClick={onOpenKnowledge}>
          <IconBook size={14} />
          管理知识库{health ? `（${health.chunks} 块）` : ''}
        </button>
      </div>

      <section className="hero-features">
        {FEATURES.map((f) => (
          <div className="feature-card" key={f.title}>
            <div className="feature-icon">{f.icon}</div>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </div>
        ))}
      </section>
    </main>
  )
}
