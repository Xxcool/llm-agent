import { useState } from 'react'
import type { Plan, PlanStatus } from '../types'
import { updatePlanStatus } from '../api'
import { IconCheck, IconCopy } from './icons'

const STATUS_LABEL: Record<PlanStatus, string> = {
  draft: '待确认',
  confirmed: '已确认',
  rejected: '已驳回',
}

/** 方案卡片（P2 规划层）：有依据、可确认；多方案时提供「选择此方案」 */
export function PlanCard({
  plan,
  dbId,
  multi = false,
  onChange,
}: {
  plan: Plan
  /** 数据库消息 id：无 dbId 说明消息还在生成中，暂不能确认 */
  dbId?: number
  /** 多方案对比场景：按钮文案改为「选择此方案」 */
  multi?: boolean
  onChange?: (plans: Plan[]) => void
}) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  // 多方案对比时默认折叠详情，避免多张长卡片堆叠
  const [expanded, setExpanded] = useState(!multi)
  const [error, setError] = useState('')

  const update = async (status: PlanStatus) => {
    if (!dbId || busy) return
    setBusy(true)
    setError('')
    try {
      const next = await updatePlanStatus(dbId, status, plan.id)
      onChange?.(next)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggleStep = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  const copyPlan = async () => {
    const lines: string[] = [`# ${plan.title}`, '']
    if (plan.approach) lines.push(`**思路**：${plan.approach}`, '')
    if (plan.goal) lines.push(`**目标**：${plan.goal}`, '')
    if (plan.background) lines.push(`**背景**：${plan.background}`, '')
    const tradeoff = [
      plan.cost && `成本 ${plan.cost}`,
      plan.duration && `周期 ${plan.duration}`,
      plan.risk_level && `风险 ${plan.risk_level}`,
    ].filter(Boolean)
    if (tradeoff.length) lines.push(`**权衡**：${tradeoff.join(' · ')}`, '')
    lines.push('## 实施步骤')
    plan.steps.forEach((s, i) => lines.push(`${i + 1}. **${s.title}**${s.detail ? `：${s.detail}` : ''}`))
    if (plan.evidence.length) {
      lines.push('', '## 方案依据')
      plan.evidence.forEach((e) => lines.push(`- [${e.source}] ${e.quote}`))
    }
    if (plan.risks.length) {
      lines.push('', '## 风险与应对')
      plan.risks.forEach((r) => lines.push(`- ${r.risk}${r.mitigation ? ` → ${r.mitigation}` : ''}`))
    }
    await navigator.clipboard.writeText(lines.join('\n')).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const hasTradeoff = Boolean(plan.cost || plan.duration || plan.risk_level)
  const dimmed = plan.status === 'rejected'

  return (
    <div className={`plan-card ${plan.status}`}>
      <div className="plan-head">
        <span className="plan-badge">方案</span>
        <h3 className="plan-title">{plan.title}</h3>
        {plan.recommended && <span className="plan-recommend">推荐</span>}
        <span className={`plan-status ${plan.status}`}>{STATUS_LABEL[plan.status]}</span>
      </div>

      {hasTradeoff && (
        <div className="plan-tradeoff">
          {plan.cost && <span className="plan-tradeoff-item">成本 <b>{plan.cost}</b></span>}
          {plan.duration && <span className="plan-tradeoff-item">周期 <b>{plan.duration}</b></span>}
          {plan.risk_level && (
            <span className={`plan-tradeoff-item risk-${plan.risk_level}`}>风险 <b>{plan.risk_level}</b></span>
          )}
          {multi && (
            <button type="button" className="plan-expand" onClick={() => setExpanded((v) => !v)}>
              {expanded ? '收起详情' : '展开详情'}
            </button>
          )}
        </div>
      )}

      {expanded && (
        <>
          {(plan.approach || plan.goal || plan.background) && (
            <div className="plan-section">
              {plan.approach && <p className="plan-approach">思路：{plan.approach}</p>}
              <p className="plan-label-inline">目标与背景</p>
              {plan.goal && <p className="plan-goal">{plan.goal}</p>}
              {plan.background && <p className="plan-text">{plan.background}</p>}
            </div>
          )}

      <div className="plan-section">
        <p className="plan-label">
          实施步骤 <span className="plan-count">{plan.steps.length}</span>
        </p>
        <ol className="plan-steps">
          {plan.steps.map((s, i) => (
            <li key={i} className={checked.has(i) ? 'done' : ''}>
              <button
                type="button"
                className={`plan-check ${checked.has(i) ? 'on' : ''}`}
                onClick={() => toggleStep(i)}
                aria-label="标记步骤完成"
              >
                {checked.has(i) && <IconCheck size={11} />}
              </button>
              <div className="plan-step-body">
                <p className="plan-step-title">{s.title}</p>
                {s.detail && <p className="plan-step-detail">{s.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {plan.evidence.length > 0 && (
        <div className="plan-section">
          <p className="plan-label">
            方案依据 <span className="plan-count">{plan.evidence.length}</span>
          </p>
          <div className="plan-evidence">
            {plan.evidence.map((e, i) => (
              <div key={i} className="plan-ev-item">
                {e.source && <span className="plan-src" title={e.source}>{e.source}</span>}
                {e.quote && <p className="plan-quote">{e.quote}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {plan.risks.length > 0 && (
        <div className="plan-section">
          <p className="plan-label">风险与应对</p>
          <ul className="plan-risks">
            {plan.risks.map((r, i) => (
              <li key={i}>
                <span className="plan-risk">{r.risk}</span>
                {r.mitigation && <span className="plan-mitigation">→ {r.mitigation}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.systems.length > 0 && (
        <div className="plan-systems">
          {plan.systems.map((s) => (
            <span key={s} className="plan-chip">{s}</span>
          ))}
        </div>
      )}
        </>
      )}

      {error && <p className="plan-error">{error}</p>}

      <div className="plan-actions">
        {plan.status === 'draft' && (
          <>
            <button
              className="btn primary small"
              disabled={busy || !dbId}
              onClick={() => update('confirmed')}
              title={dbId ? (multi ? '选择此方案，其余候选自动驳回' : '确认后方案锁定，作为执行依据') : '消息保存后可确认'}
            >
              <IconCheck size={13} />
              {dbId ? (busy ? '处理中…' : multi ? '选择此方案' : '确认方案') : '生成完成后可确认'}
            </button>
            <button className="btn ghost small" disabled={busy || !dbId} onClick={() => update('rejected')}>
              驳回
            </button>
          </>
        )}
        {plan.status === 'confirmed' && (
          <span className="plan-hint">已确认。可在下方任务清单中拆解为任务并逐项执行。</span>
        )}
        {dimmed && (
          <button className="btn ghost small" disabled={busy || !dbId} onClick={() => update('draft')}>
            恢复为候选
          </button>
        )}
        <button className="btn ghost small" onClick={copyPlan}>
          <IconCopy size={13} /> {copied ? '已复制' : '复制方案'}
        </button>
      </div>
    </div>
  )
}
