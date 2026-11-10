import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Task } from '../types'
import { TaskBoard } from './TaskBoard'
import { applyTask, archiveTask, breakdownTasks, discardTask, runTask } from '../api'
import { makeTask } from '../test/fixtures'

vi.mock('../api', () => ({
  breakdownTasks: vi.fn(),
  runTask: vi.fn(),
  applyTask: vi.fn(),
  discardTask: vi.fn(),
  archiveTask: vi.fn(),
}))

// MarkdownView 依赖较多（KaTeX / mermaid），测试中替换为轻量占位
vi.mock('./MarkdownView', () => ({
  MarkdownView: ({ content }: { content: string }) => <div className="md-stub">{content}</div>,
}))

/** 受控包装：模拟 Chat 里 onTasks 更新 state 的行为 */
function Harness({ initial, onTasksSpy }: { initial: Task[]; onTasksSpy?: (t: Task[]) => void }) {
  const [tasks, setTasks] = useState<Task[]>(initial)
  return (
    <TaskBoard
      messageId={10}
      planId="plan-a"
      tasks={tasks}
      onTasks={(next) => {
        onTasksSpy?.(next)
        setTasks(next)
      }}
    />
  )
}

const mockedBreakdown = vi.mocked(breakdownTasks)
const mockedRun = vi.mocked(runTask)
const mockedApply = vi.mocked(applyTask)
const mockedArchive = vi.mocked(archiveTask)
const mockedDiscard = vi.mocked(discardTask)

describe('TaskBoard 任务看板', () => {
  it('无任务时提供拆解入口，拆解后渲染任务清单', async () => {
    const tasks = [makeTask({ id: 1 }), makeTask({ id: 2, title: '配置审批流', kind: 'code' })]
    mockedBreakdown.mockResolvedValueOnce(tasks)
    const onTasks = vi.fn()

    render(<Harness initial={[]} onTasksSpy={onTasks} />)
    await userEvent.click(screen.getByRole('button', { name: /拆解为任务/ }))

    expect(mockedBreakdown).toHaveBeenCalledWith(10, 'plan-a')
    await waitFor(() => expect(onTasks).toHaveBeenCalledWith(tasks))
  })

  it('执行任务调用 runTask 并展示交付物', async () => {
    const task = makeTask({ id: 3 })
    mockedRun.mockResolvedValueOnce({ ...task, status: 'done', artifact: '# 交付文档\n\n内容' })
    const onTasks = vi.fn()

    render(<Harness initial={[task]} onTasksSpy={onTasks} />)
    await userEvent.click(screen.getByRole('button', { name: '执行' }))

    expect(mockedRun).toHaveBeenCalledWith(3)
    await waitFor(() => expect(onTasks).toHaveBeenLastCalledWith([expect.objectContaining({ status: 'done' })]))
    // 交付物默认展开
    expect(screen.getByText(/交付文档/)).toBeInTheDocument()
  })

  it('待审批的代码任务展示 diff 与文件列表，批准后回传校验结果', async () => {
    const reviewTask = makeTask({
      id: 4,
      kind: 'code',
      status: 'review',
      artifact: '交付校验脚本',
      files: [
        {
          path: 'scripts/check_rules.py',
          exists: false,
          added: 2,
          removed: 0,
          diff: '--- /dev/null\n+++ b/scripts/check_rules.py\n@@ -0,0 +1,2 @@\n+def check():\n+    return True',
          content: 'def check():\n    return True',
        },
      ],
    })
    mockedApply.mockResolvedValueOnce({
      task: { ...reviewTask, status: 'done' },
      written: ['scripts/check_rules.py'],
      checks: [{ path: 'check_rules.py', ok: true, detail: 'Python 语法校验通过' }],
    })
    const onTasks = vi.fn()

    render(<Harness initial={[reviewTask]} onTasksSpy={onTasks} />)
    // 类型标签 / 待审批状态 / 文件与 diff
    expect(screen.getByText('代码')).toBeInTheDocument()
    expect(screen.getByText('待审批')).toBeInTheDocument()
    expect(screen.getByText('scripts/check_rules.py')).toBeInTheDocument()
    expect(screen.getByText(/\+2/)).toBeInTheDocument()
    expect(document.querySelector('.task-diff .d-add')).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /批准落盘/ }))
    expect(mockedApply).toHaveBeenCalledWith(4)
    await waitFor(() =>
      expect(screen.getByText(/Python 语法校验通过/)).toBeInTheDocument(),
    )
  })

  it('已完成任务可归档回知识库', async () => {
    const task = makeTask({ id: 6, status: 'done', artifact: '# 交付' })
    mockedArchive.mockResolvedValueOnce({
      task: { ...task, archive_path: '沉淀/2026-11/流程图-6.md' },
      source: '沉淀/2026-11/流程图-6.md',
      cached: false,
    })
    const onTasks = vi.fn()

    render(<Harness initial={[task]} onTasksSpy={onTasks} />)
    await userEvent.click(screen.getByRole('button', { name: /归档到知识库/ }))
    expect(mockedArchive).toHaveBeenCalledWith(6)
    await waitFor(() => expect(screen.getByText('已归档')).toBeInTheDocument())
    expect(onTasks).toHaveBeenCalled()
  })

  it('丢弃待审批文件调用 discardTask', async () => {
    const reviewTask = makeTask({ id: 5, kind: 'code', status: 'review', files: [] })
    mockedDiscard.mockResolvedValueOnce({ ...reviewTask, status: 'pending', files: [] })
    const onTasks = vi.fn()

    render(<Harness initial={[reviewTask]} onTasksSpy={onTasks} />)
    await userEvent.click(screen.getByRole('button', { name: /丢弃/ }))
    expect(mockedDiscard).toHaveBeenCalledWith(5)
    await waitFor(() => expect(onTasks).toHaveBeenCalled())
  })
})
