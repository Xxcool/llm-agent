import { describe, expect, it, vi, beforeEach } from 'vitest'
import { applyTask, breakdownTasks, runTask, updatePlanStatus } from './api'

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl)
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

    const [url, init] = fetchMock.mock.calls[0]
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
