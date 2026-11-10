import type { Plan } from '../types'
import { PlanCard } from './PlanCard'

/** 方案组：单方案直接渲染卡片；多方案先给对比表，再展开详情 */
export function PlanGroup({
  plans,
  dbId,
  onChange,
}: {
  plans: Plan[]
  dbId?: number
  onChange: (plans: Plan[]) => void
}) {
  if (plans.length === 0) return null
  if (plans.length === 1) {
    return <PlanCard plan={plans[0]} dbId={dbId} onChange={onChange} />
  }

  const confirmed = plans.find((p) => p.status === 'confirmed')

  return (
    <div className="plan-group">
      <div className="plan-group-head">
        <span className="plan-group-title">
          方案对比 <span className="plan-count">{plans.length} 个候选</span>
        </span>
        <span className="plan-group-sub">
          {confirmed ? '已选定方案，其余候选已驳回' : '按成本、周期与风险权衡，选择一个方案确认'}
        </span>
      </div>

      <div className="plan-compare-wrap">
        <table className="plan-compare">
          <thead>
            <tr>
              <th>方案</th>
              <th>思路</th>
              <th>成本</th>
              <th>周期</th>
              <th>风险</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className={p.status === 'confirmed' ? 'chosen' : p.status === 'rejected' ? 'dim' : ''}>
                <td className="plan-compare-name">
                  {p.title}
                  {p.recommended && <span className="plan-recommend">推荐</span>}
                  {p.status === 'confirmed' && <span className="plan-chosen">已选</span>}
                </td>
                <td>{p.approach || '—'}</td>
                <td>{p.cost || '—'}</td>
                <td>{p.duration || '—'}</td>
                <td className={`risk-${p.risk_level}`}>{p.risk_level || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="plan-group-list">
        {plans.map((p) => (
          <PlanCard key={p.id} plan={p} dbId={dbId} multi onChange={onChange} />
        ))}
      </div>
    </div>
  )
}
