import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { listSessions } from '../api'

vi.mock('../api', () => ({ listSessions: vi.fn(), deleteSession: vi.fn(), updateSession: vi.fn() }))

function props() {
  return {
    activeId: null, refreshSignal: 0, isDemo: true,
    onSelect: vi.fn(), onNew: vi.fn(), onCollapse: vi.fn(),
    onOpenSettings: vi.fn(), onOpenKnowledge: vi.fn(), onActiveDeleted: vi.fn(),
  }
}

describe('侧栏空状态', () => {
  beforeEach(() => vi.mocked(listSessions).mockResolvedValue([]))

  it('未接入模型时引导配置，不创建空会话', async () => {
    const handlers = props()
    render(<Sidebar {...handlers} />)
    await waitFor(() => expect(listSessions).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '先接入模型服务' }))
    expect(handlers.onOpenSettings).toHaveBeenCalledOnce()
    expect(handlers.onNew).not.toHaveBeenCalled()
  })

  it('接入模型后引导开始对话', async () => {
    const handlers = props()
    render(<Sidebar {...handlers} isDemo={false} />)
    await waitFor(() => expect(listSessions).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '开始第一段对话' }))
    expect(handlers.onNew).toHaveBeenCalledOnce()
  })

  it('已有会话时显示历史，移除首次使用引导', async () => {
    vi.mocked(listSessions).mockResolvedValue([{ id: 'session-a', title: '测试会话', pinned: false, updated_at: new Date().toISOString() }])
    const handlers = props()
    render(<Sidebar {...handlers} />)
    fireEvent.click(await screen.findByText('测试会话'))
    expect(screen.queryByLabelText('暂无会话记录')).not.toBeInTheDocument()
    expect(handlers.onSelect).toHaveBeenCalledWith('session-a')
  })
})
