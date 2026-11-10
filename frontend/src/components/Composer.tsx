import { useRef, useState } from 'react'
import { useEffect } from 'react'

export function Composer({
  disabled,
  onSend,
  onStop,
}: {
  disabled: boolean
  onSend: (text: string) => void
  onStop: () => void
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

  const submit = () => {
    if (!text.trim() || disabled) return
    onSend(text)
    setText('')
  }

  return (
    <footer className="composer">
      <div className="composer-box">
        <textarea
          ref={taRef}
          value={text}
          placeholder={disabled ? 'Agent 思考中…' : '输入问题，Enter 发送 / Shift+Enter 换行'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
        />
        {disabled ? (
          <button className="send stop" onClick={onStop} title="停止生成">
            ■
          </button>
        ) : (
          <button className="send" onClick={submit} disabled={!text.trim()}>
            ➤
          </button>
        )}
      </div>
      <p className="composer-hint">回答基于 RAG 检索与工具调用结果生成，请注意甄别</p>
    </footer>
  )
}
