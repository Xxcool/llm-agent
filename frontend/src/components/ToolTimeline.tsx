import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ToolStep } from '../types'
import { IconChevron, IconGlobe, IconSearch, IconWrench } from './icons'

const TOOL_META: Record<string, { icon: ReactNode; label: string }> = {
  search_knowledge: { icon: <IconSearch size={13} />, label: '检索知识库' },
  fetch_url: { icon: <IconGlobe size={13} />, label: '抓取网页' },
}

/** 工具入参 → 人类可读摘要（不再甩 JSON 给用户） */
function stepSummary(step: ToolStep): string {
  const args = (step.arguments ?? {}) as Record<string, unknown>
  if (step.name === 'search_knowledge') return `「${String(args.query ?? '')}」`
  if (step.name === 'fetch_url') return String(args.url ?? '')
  const parts = Object.entries(args).map(([k, v]) => `${k}: ${String(v)}`)
  return parts.join('，')
}

/** 工具调用过程：可折叠步骤条，动作摘要人类可读，结果按需展开 */
export function ToolTimeline({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  if (steps.length === 0) return null

  const running = steps.some((s) => s.result === undefined)
  const isOpen = open || running // 执行中自动展开，结束后默认收起

  const toggleStep = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div className={`tool-steps ${running ? 'running' : ''}`}>
      <button className="steps-toggle" onClick={() => setOpen((v) => !v)}>
        <span className={`steps-chevron ${isOpen ? 'down' : ''}`}>
          <IconChevron size={12} />
        </span>
        {running ? '正在检索资料…' : `已完成 ${steps.length} 次资料检索`}
      </button>

      {isOpen && (
        <div className="step-list">
          {steps.map((step, i) => {
            const meta = TOOL_META[step.name] ?? { icon: <IconWrench size={13} />, label: step.name }
            const isStepRunning = step.result === undefined
            const showResult = expanded.has(i)
            return (
              <div key={i} className="step-row">
                <button className="step-head" onClick={() => toggleStep(i)}>
                  <span className="step-icon">{meta.icon}</span>
                  <span className="step-label">{meta.label}</span>
                  <span className="step-summary">{stepSummary(step)}</span>
                  <span className={`step-state ${isStepRunning ? 'running' : ''}`}>
                    {isStepRunning ? '执行中' : '完成'}
                  </span>
                  <span className={`steps-chevron small ${showResult ? 'down' : ''}`}>
                    <IconChevron size={11} />
                  </span>
                </button>
                {showResult && step.result !== undefined && (
                  <pre className="step-result">{step.result}</pre>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
