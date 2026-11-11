import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MarkdownContent from './MarkdownContent'

vi.mock('mermaid', () => ({ default: {
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script><text>安全图示</text></svg>' })),
} }))

describe('不可信富文本', () => {
  it('移除活动 HTML 和事件属性，同时保留图片、表格和安全媒体', () => {
    const { container } = render(<MarkdownContent content={'<script>bad()</script><iframe src="https://evil.example"></iframe><img src="/safe.png" onerror="bad()" /><audio src="/safe.mp3" controls></audio>\n\n| A | B |\n|---|---|\n| 1 | 2 |'} />)
    expect(container.querySelector('script, iframe, [onerror]')).toBeNull()
    expect(container.querySelector('audio')).toHaveAttribute('src', '/safe.mp3')
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('保留白名单内的应用动作链接，拦截脚本链接', () => {
    const { container } = render(<MarkdownContent content={'[模型配置](app://settings) [危险](javascript:alert%281%29)'} />)
    expect(screen.getByRole('link', { name: '模型配置' })).toHaveAttribute('href', '#')
    expect(container.querySelector('[href^="javascript:"]')).toBeNull()
  })

  it('图表按严格模式渲染，生成的 SVG 再次净化', async () => {
    const { container } = render(<MarkdownContent content={'```mermaid\ngraph TD\nA-->B\n```'} />)
    await waitFor(() => expect(screen.getByText('安全图示')).toBeInTheDocument())
    expect(container.querySelector('script')).toBeNull()
    const mermaid = (await import('mermaid')).default
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict', htmlLabels: false }))
  })
})
