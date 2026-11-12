import { useState } from 'react'
import type { ReactNode } from 'react'
import { IconAlert, IconApi, IconBolt, IconBook, IconChat, IconCheck, IconChevron, IconDatabase, IconPlan, IconSparkle, IconWrench } from '../components/icons'

const FEATURES: { icon: ReactNode; title: string; desc: string }[] = [
  {
    icon: <IconDatabase size={20} />,
    title: '让回答有据可循',
    desc: '从制度、文档与业务资料中寻找答案，标注来源，让每个结论都能回到原文。',
  },
  {
    icon: <IconPlan size={20} />,
    title: '把想法整理成方案',
    desc: '理清目标、步骤与风险，对比不同做法。由你确认，再逐项推进任务。',
  },
  {
    icon: <IconWrench size={20} />,
    title: '连接资料与更多线索',
    desc: '结合知识检索与网页抓取补充信息，工具步骤清晰可见，复杂问题也能逐步拆解。',
  },
  {
    icon: <IconSparkle size={20} />,
    title: '让思路自然展开',
    desc: '回答逐步呈现，支持继续追问、重新生成与复制，让一次提问延伸成持续的交流。',
  },
]

export function Home({
  health,
  isDemo,
  creating,
  onAsk,
  onOpenChat,
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
  /** 不提问直接进入新对话页 */
  onOpenChat: () => void
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
        接入制度规范、产品文档与业务资料，智能体自动检索、标注来源、流式作答，并给出可确认的实施方案
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
        <button className="quick-chip quick-chip-primary" onClick={onOpenChat} title="不提问，直接进入对话">
          <IconChat size={14} />
          开始对话
        </button>
        <button
          className={`quick-chip ${healthState === 'error' ? 'quick-chip-error' : ''}`}
          onClick={onOpenSettings}
          title={healthState === 'error' ? healthError ?? undefined : undefined}
        >
          {healthState === 'error' ? <IconAlert size={14} /> : healthState === 'ok' && !isDemo ? <IconCheck size={14} /> : <IconApi size={14} />}
          {healthState === 'error' ? '模型服务异常' : healthState === 'ok' && !isDemo ? '模型已接入' : '接入模型服务'}
        </button>
        <button className="quick-chip" onClick={onOpenKnowledge}>
          <IconBook size={14} />
          管理知识库{health ? `（${health.chunks} 块）` : ''}
        </button>
      </div>

      <section className="home-overview" aria-labelledby="home-overview-title">
        <div className="home-section-heading">
          <div>
            <span className="home-eyebrow"><span />从知识到行动</span>
            <h2 id="home-overview-title">不止于回答，更进一步</h2>
            <p>找到依据，理清思路，让分散的知识成为下一步的起点。</p>
          </div>
          <span className="home-section-aside">你来提问，也由你掌握方向</span>
        </div>
        <div className="hero-features">
          {FEATURES.map((f, i) => (
            <article className="feature-card" key={f.title} aria-labelledby={`home-feature-${i}`}>
              <span className="feature-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="feature-icon">{f.icon}</span>
              <h3 id={`home-feature-${i}`}>{f.title}</h3>
              <p>{f.desc}</p>
            </article>
          ))}
        </div>
        <div className="home-get-started">
          <div className="home-get-started-title">
            <span className="home-start-mark"><IconSparkle size={21} /></span>
            <div>
              <h3>简单三步，开启你的工作区</h3>
              <p>用自己的模型，连接自己的知识。</p>
            </div>
          </div>
          <ol className="home-start-steps" aria-label="开始使用步骤">
            <li><button type="button" onClick={onOpenSettings}><span>01</span>接入模型<IconChevron size={12} /></button></li>
            <li><button type="button" onClick={onOpenKnowledge}><span>02</span>添加资料<IconChevron size={12} /></button></li>
            <li><button type="button" onClick={onOpenChat}><span>03</span>开始对话<IconChevron size={12} /></button></li>
          </ol>
        </div>
        <footer className="home-footer">
          <span className="home-footer-brand"><IconBolt size={15} />LLM Agent<span>企业知识智能体</span></span>
          <p>AI 生成的内容仅供参考，请核对重要信息。</p>
        </footer>
      </section>
    </main>
  )
}
