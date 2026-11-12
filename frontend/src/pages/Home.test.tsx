import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Home } from './Home'

function props() {
  return {
    health: null, isDemo: false, creating: false, healthState: 'down',
    onAsk: vi.fn(), onOpenChat: vi.fn(), onOpenSettings: vi.fn(),
    onOpenKnowledge: vi.fn(), onScrollChange: vi.fn(),
  }
}

describe('首页开始引导', () => {
  it('未确认模型状态时提供接入入口，不显示已经接入', () => {
    render(<Home {...props()} />)
    expect(screen.queryByText('模型已接入')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '接入模型服务' })).toBeInTheDocument()
  })

  it('能力卡只做说明，三个使用步骤分别打开对应功能', () => {
    const handlers = props()
    render(<Home {...handlers} />)
    const steps = within(screen.getByRole('list', { name: '开始使用步骤' }))
    fireEvent.click(steps.getByRole('button', { name: /接入模型/ }))
    fireEvent.click(steps.getByRole('button', { name: /添加资料/ }))
    fireEvent.click(steps.getByRole('button', { name: /开始对话/ }))
    expect(screen.getByRole('article', { name: '把想法整理成方案' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /把想法整理成方案/ })).not.toBeInTheDocument()
    expect(handlers.onOpenSettings).toHaveBeenCalledOnce()
    expect(handlers.onOpenKnowledge).toHaveBeenCalledOnce()
    expect(handlers.onOpenChat).toHaveBeenCalledOnce()
  })
})
