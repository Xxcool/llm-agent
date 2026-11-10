import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlanGroup } from './PlanGroup'
import { makePlan } from '../test/fixtures'

vi.mock('../api', () => ({
  updatePlanStatus: vi.fn(async () => []),
}))

describe('PlanGroup 多方案对比', () => {
  it('单方案时直接渲染方案卡片，不出现对比表', () => {
    render(<PlanGroup plans={[makePlan()]} onChange={() => undefined} />)
    expect(screen.getByText('差旅报销线上化落地方案')).toBeInTheDocument()
    expect(document.querySelector('.plan-compare')).toBeNull()
    // 权衡信息（成本/周期/风险）要展示
    expect(screen.getByText('约 2 人月')).toBeInTheDocument()
    expect(screen.getByText('2 周')).toBeInTheDocument()
    expect(screen.getByText('低')).toBeInTheDocument()
  })

  it('多方案时渲染对比表，标注推荐与已选', () => {
    const plans = [
      makePlan({ id: 'plan-a', title: '方案A 配置化改造', cost: '低', duration: '4 周', risk_level: '低', recommended: true }),
      makePlan({ id: 'plan-b', title: '方案B 采购SaaS', cost: '中', duration: '3 个月', risk_level: '中', recommended: false, status: 'rejected' }),
      makePlan({ id: 'plan-c', title: '方案C 自建中台', cost: '高', duration: '8 个月', risk_level: '高', status: 'confirmed' }),
    ]
    render(<PlanGroup plans={plans} onChange={() => undefined} />)

    expect(screen.getByText('方案对比')).toBeInTheDocument()
    expect(screen.getByText('3 个候选')).toBeInTheDocument()
    const rows = document.querySelectorAll('.plan-compare tbody tr')
    expect(rows).toHaveLength(3)
    // 表头维度齐全（直接读表头单元格，避免与卡片里的权衡标签重名）
    const heads = [...document.querySelectorAll('.plan-compare thead th')].map((th) => th.textContent?.trim())
    expect(heads).toEqual(['方案', '思路', '成本', '周期', '风险'])
    // 推荐 / 已选 标记
    expect(screen.getAllByText('推荐').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已选').length).toBeGreaterThan(0)
    expect(document.querySelector('.plan-compare tr.chosen')).not.toBeNull()
    expect(document.querySelector('.plan-compare tr.dim')).not.toBeNull()
  })
})
