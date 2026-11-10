import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlanCard } from './PlanCard'
import { updatePlanStatus } from '../api'
import { makePlan } from '../test/fixtures'

vi.mock('../api', () => ({
  updatePlanStatus: vi.fn(),
}))

const mockedUpdate = vi.mocked(updatePlanStatus)

describe('PlanCard 方案卡片', () => {
  it('单方案展示「确认方案」，点击后按 plan.id 提交确认并回调新列表', async () => {
    const plan = makePlan()
    const next = [{ ...plan, status: 'confirmed' as const }]
    mockedUpdate.mockResolvedValueOnce(next)
    const onChange = vi.fn()

    render(<PlanCard plan={plan} dbId={42} onChange={onChange} />)
    expect(screen.getByText('待确认')).toBeInTheDocument()
    // 依据可溯源：来源文件与原文摘录都渲染
    expect(screen.getByText('samples/员工差旅与费用报销制度.md')).toBeInTheDocument()
    expect(screen.getByText(/P1-P4 一线城市 450 元\/晚/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /确认方案/ }))

    expect(mockedUpdate).toHaveBeenCalledWith(42, 'confirmed', 'plan-a')
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(next))
  })

  it('无 dbId（消息未落库）时确认按钮禁用', () => {
    render(<PlanCard plan={makePlan()} onChange={() => undefined} />)
    expect(screen.getByRole('button', { name: /生成完成后可确认/ })).toBeDisabled()
  })

  it('多方案场景按钮为「选择此方案」', () => {
    render(<PlanCard plan={makePlan()} dbId={1} multi onChange={() => undefined} />)
    expect(screen.getByRole('button', { name: /选择此方案/ })).toBeInTheDocument()
    // 多方案默认折叠详情，可展开
    expect(screen.queryByText('实施步骤')).toBeNull()
    expect(screen.getByRole('button', { name: '展开详情' })).toBeInTheDocument()
  })

  it('已驳回方案可恢复为候选', async () => {
    const plan = makePlan({ status: 'rejected' })
    mockedUpdate.mockResolvedValueOnce([{ ...plan, status: 'draft' }])
    render(<PlanCard plan={plan} dbId={7} onChange={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: /恢复为候选/ }))
    expect(mockedUpdate).toHaveBeenCalledWith(7, 'draft', 'plan-a')
  })
})
