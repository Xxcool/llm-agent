import { useRef, useState } from 'react'
import { useEffect } from 'react'

export function Composer({
  disabled,
  onSend,
  onStop,
  hero = false,
  autoFocusInput = false,
}: {
  disabled: boolean
  onSend: (text: string) => void
  onStop: () => void
  hero?: boolean
  autoFocusInput?: boolean
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
          {disabled ? (
            <button className="send stop" onClick={onStop} title="停止生成">
              ■
            </button>
          ) : (
            <button className="send" onClick={submit} disabled={!text.trim()} title="发送">
              ↑
            </button>
          )}
        </div>
      </div>
      {!hero && <p className="composer-hint">回答基于 RAG 检索与工具调用结果生成，请注意甄别</p>}
    </footer>
  )
}
