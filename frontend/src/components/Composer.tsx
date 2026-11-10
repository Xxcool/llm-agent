import { useRef, useState } from 'react'
import { useEffect } from 'react'

export function Composer({
  disabled,
  onSend,
  onStop,
  hero = false,
  autoFocusInput = false,
  knowledgeOn,
  webOn,
  planMode = false,
  onToggleKnowledge,
  onToggleWeb,
  onTogglePlan,
}: {
  disabled: boolean
  onSend: (text: string) => void
  onStop: () => void
  hero?: boolean
  autoFocusInput?: boolean
  knowledgeOn: boolean
  webOn: boolean
  /** 方案模式：强制输出结构化方案（依据 + 步骤 + 风险） */
  planMode?: boolean
  onToggleKnowledge: () => void
  onToggleWeb: () => void
  onTogglePlan?: () => void
}) {
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  // 自适应高度
  useEffect(() => {
    const ta = taRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
    }
  }, [text])

  useEffect(() => {
    if (autoFocusInput) taRef.current?.focus()
  }, [autoFocusInput])

  const submit = () => {
    if (!text.trim() || disabled) return
    onSend(text)
    setText('')
  }

  return (
    <footer className={`composer ${hero ? 'hero-composer-inner' : ''}`}>
      <div className="composer-box">
        <textarea
          ref={taRef}
          value={text}
          placeholder={disabled ? 'Agent 思考中…' : '问点什么，一起探索'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={hero ? 2 : 1}
        />
        <div className="composer-bar">
          <div className="composer-chips">
            {onTogglePlan && (
              <button
                type="button"
                className={`chip plan-chip-toggle ${planMode ? 'active' : ''}`}
                onClick={onTogglePlan}
                title={planMode ? '已开启：基于知识库证据生成结构化方案（含步骤与风险）' : '已关闭：普通问答模式'}
              >
                <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3 2.6h10v10.8H3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  <path d="M5.4 6h5.2M5.4 8.4h5.2M5.4 10.8h3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                方案模式
              </button>
            )}
            <button
              type="button"
              className={`chip ${knowledgeOn ? 'active' : ''}`}
              onClick={onToggleKnowledge}
              title={knowledgeOn ? '已开启：回答前强制检索知识库' : '已关闭：由 Agent 自行判断是否检索'}
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
                <path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              知识检索
            </button>
            <button
              type="button"
              className={`chip ${webOn ? 'active' : ''}`}
              onClick={onToggleWeb}
              title={webOn ? '已开启：允许 Agent 抓取网页正文' : '已关闭：不向 Agent 提供网页抓取能力'}
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.4" />
                <path d="M1.7 8h12.6M8 1.7c1.9 1.8 2.9 4 2.9 6.3S9.9 12.5 8 14.3C6.1 12.5 5.1 10.3 5.1 8S6.1 3.5 8 1.7z" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              网页抓取
            </button>
          </div>
          {disabled ? (
            <button className="send stop" onClick={onStop} title="停止生成">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <rect x="1.6" y="1.6" width="8.8" height="8.8" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button className="send" onClick={submit} disabled={!text.trim()} title="发送">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8.3125 0.980206C8.66767 1.05312 8.97902 1.2042 9.2627 1.43235C9.48724 1.613 9.73029 1.85795 9.97949 2.10716L14.707 6.8347L13.293 8.24876L9 3.95579V15.0417H7V3.95579L2.70703 8.24876L1.29297 6.8347L6.02051 2.10716C6.26971 1.85795 6.51277 1.613 6.7373 1.43235C6.97662 1.23988 7.28445 1.04404 7.6875 0.980206C7.8973 0.947029 8.1031 0.955183 8.3125 0.980206Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
      {!hero && <p className="composer-hint">回答基于 RAG 检索与工具调用结果生成，请注意甄别</p>}
    </footer>
  )
}
