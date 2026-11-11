import { describe, expect, it, vi, beforeEach } from 'vitest'
import { applyTask, breakdownTasks, runTask, streamChat, updatePlanStatus } from './api'

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn((url: string, init?: RequestInit) => url === '/api/workspace' ? Promise.resolve(json({ status: 'ok', cookie_ready: true })) : impl(url, init))
  vi.stubGlobal('fetch', fn)
  return fn
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('api 方案与任务接口', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('updatePlanStatus 以 PATCH 提交 status 与 plan_id，返回方案列表', async () => {
    const fetchMock = mockFetch(async () => json({ plans: [{ id: 'p1', status: 'confirmed' }] }))
    const plans = await updatePlanStatus(42, 'confirmed', 'p1')

    const [url, init] = fetchMock.mock.calls.find((call) => call[0] === '/api/messages/42/plan')!
    expect(url).toBe('/api/messages/42/plan')
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'confirmed', plan_id: 'p1' })
    expect(plans[0].status).toBe('confirmed')
  })

  it('breakdownTasks 失败时抛出后端 detail 文案', async () => {
    mockFetch(async () => json({ detail: '方案尚未确认，不能拆解任务' }, 400))
    await expect(breakdownTasks(10, 'p1')).rejects.toThrow('方案尚未确认，不能拆解任务')
  })

  it('runTask 返回最新任务（含状态与交付物）', async () => {
    mockFetch(async () => json({ status: 'ok', task: { id: 3, status: 'review', files: [] } }))
    const task = await runTask(3)
    expect(task.status).toBe('review')
  })

  it('applyTask 返回写入文件与校验结果', async () => {
    mockFetch(async () =>
      json({
        status: 'ok',
        written: ['scripts/a.py'],
        checks: [{ path: 'a.py', ok: true, detail: 'Python 语法校验通过' }],
        task: { id: 3, status: 'done' },
      }),
    )
    const r = await applyTask(3)
    expect(r.written).toEqual(['scripts/a.py'])
    expect(r.checks[0].ok).toBe(true)
  })
})

describe('SSE 数据契约', () => {
  it('解析分片 UTF-8、CRLF 和没有尾部换行的完成事件', async () => {
    const bytes = new TextEncoder().encode('data: {"type":"token","content":"中文"}\r\n\r\ndata: {"type":"done"}')
    const body = new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3))
      controller.close()
    } })
    mockFetch(async () => new Response(body))
    const onEvent = vi.fn()
    await streamChat('问题', 's', { force_retrieval: true, allow_fetch: false, replace_from_id: 9 }, onEvent)
    expect(onEvent.mock.calls.map(([e]) => e)).toEqual([{ type: 'token', content: '中文' }, { type: 'done' }])
  })

  it('流提前结束时提示回答不完整', async () => {
    mockFetch(async () => new Response('data: {"type":"token","content":"partial"}\n\n'))
    await expect(streamChat('问题', 's', { force_retrieval: false, allow_fetch: false }, vi.fn())).rejects.toThrow('连接提前结束')
  })

  it('透出后端编辑限制，不把业务错误掩盖成 HTTP 状态', async () => {
    mockFetch(async () => json({ detail: '后续已有完成任务，请新建会话' }, 409))
    await expect(streamChat('问题', 's', { force_retrieval: false, allow_fetch: false }, vi.fn())).rejects.toThrow('后续已有完成任务')
  })
})
