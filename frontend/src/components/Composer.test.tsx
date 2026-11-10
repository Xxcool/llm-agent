import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from './Composer'

describe('Composer 输入区', () => {
  const base = {
    disabled: false,
    onSend: () => undefined,
    onStop: () => undefined,
    knowledgeOn: true,
    webOn: true,
    onToggleKnowledge: () => undefined,
    onToggleWeb: () => undefined,
  }

  it('回车发送输入内容，发送后清空', async () => {
    const onSend = vi.fn()
    render(<Composer {...base} onSend={onSend} />)
    const ta = screen.getByRole('textbox')
    await userEvent.type(ta, '差旅标准是多少{Enter}')
    expect(onSend).toHaveBeenCalledWith('差旅标准是多少')
    expect((ta as HTMLTextAreaElement).value).toBe('')
  })

  it('方案模式开关可点击并反映激活态', async () => {
    const onTogglePlan = vi.fn()
    const { rerender } = render(<Composer {...base} planMode={false} onTogglePlan={onTogglePlan} />)
    const chip = screen.getByRole('button', { name: /方案模式/ })
    expect(chip).not.toHaveClass('active')
    await userEvent.click(chip)
    expect(onTogglePlan).toHaveBeenCalled()

    rerender(<Composer {...base} planMode onTogglePlan={onTogglePlan} />)
    expect(screen.getByRole('button', { name: /方案模式/ })).toHaveClass('active')
  })

  it('禁用时按钮显示停止，输入仍可编辑但不触发发送', async () => {
    const onSend = vi.fn()
    render(<Composer {...base} disabled onSend={onSend} />)
    const ta = screen.getByRole('textbox')
    await userEvent.type(ta, '测试{Enter}')
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByTitle('停止生成')).toBeInTheDocument()
  })
})
