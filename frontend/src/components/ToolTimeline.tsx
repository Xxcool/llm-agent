import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ToolStep } from '../types'
import { IconChevron, IconFile, IconGlobe, IconSearch, IconWrench } from './icons'

const TOOL_META: Record<string, { icon: ReactNode; label: string }> = {
  search_knowledge: { icon: <IconSearch size={13} />, label: '检索知识库' },
  get_resume: { icon: <IconFile size={13} />, label: '查询简历' },
  fetch_url: { icon: <IconGlobe size={13} />, label: '抓取网页' },
}

/** 工具调用过程可视化：可折叠时间线，每步展示工具名、入参与返回摘要 */
export function ToolTimeline({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(true)
  if (steps.length === 0) return null

  return (
    <div className="tool-timeline">
      <button className="timeline-toggle" onClick={() => setOpen((v) => !v)}>
        <span className={`arrow ${open ? 'down' : 'right'}`}><IconChevron size={12} /></span>
        Agent 执行过程（{steps.length} 次工具调用）
      </button>
      {open && (
        <ol className="timeline-list">
          {steps.map((step, i) => {
            const meta = TOOL_META[step.name] ?? { icon: <IconWrench size={13} />, label: step.name }
            return (
              <li key={i} className="timeline-item">
                <span className="timeline-dot" />
                <div className="timeline-card">
                  <div className="timeline-head">
                    <span className="tool-name">
                      {meta.icon}
                      {meta.label}
                    </span>
                    <code className="tool-args">
                      {JSON.stringify(step.arguments, null, 0).slice(0, 120)}
                    </code>
                  </div>
                  {step.result !== undefined && (
                    <pre className="tool-result">{step.result}</pre>
                  )}
                  {step.result === undefined && <div className="tool-running">执行中…</div>}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
