import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('匿名工作区初始化', () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals() })

  it('并行请求共享一次 Cookie 建立过程', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ cookie_ready: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { apiFetch } = await import('./api')
    await Promise.all([apiFetch('/api/config'), apiFetch('/api/sessions')])
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/workspace')).toHaveLength(2)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
  })

  it('Cookie 被拦截时不继续创建会话或读取业务数据', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ cookie_ready: false }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { apiFetch } = await import('./api')
    await expect(apiFetch('/api/sessions')).rejects.toThrow('独立窗口')
    expect(fetchMock.mock.calls.every(([url]) => url === '/api/workspace')).toBe(true)
  })
})
