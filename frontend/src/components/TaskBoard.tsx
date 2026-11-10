import { useState } from 'react'
import type { Task } from '../types'
import { breakdownTasks, runTask } from '../api'
import { MarkdownView } from './MarkdownView'
import { IconCheck, IconPlan } from './icons'

const STATUS_LABEL: Record<Task['status'], string> = {
  pending: '待执行',
  running: '执行中',
  done: '已完成',
  failed: '执行失败',
}

/** 任务看板（P3 行动层 M3）：已确认方案 → 拆解任务 → 逐项执行 → 交付物预览 */
export function TaskBoard({
  messageId,
  planId,
  tasks,
  onTasks,
}: {
  messageId: number
  planId?: string
  tasks: Task[]
  onTasks: (tasks: Task[]) => void
}) {
  const [breaking, setBreaking] = useState(false)
  const [runningId, setRunningId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)

  const doneCount = tasks.filter((t) => t.status === 'done').length

  const breakdown = async () => {
    if (breaking) return
    setBreaking(true)
    setError('')
    try {
      onTasks(await breakdownTasks(messageId, planId))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBreaking(false)
    }
  }

  const run = async (task: Task) => {
    if (runningId !== null) return
    setRunningId(task.id)
    setError('')
    onTasks(tasks.map((t) => (t.id === task.id ? { ...t, status: 'running' } : t)))
    try {
      const updated = await runTask(task.id)
      onTasks(tasks.map((t) => (t.id === task.id ? updated : t)))
      setOpenId(task.id)
    } catch (e) {
      setError((e as Error).message)
      onTasks(tasks.map((t) => (t.id === task.id ? { ...t, status: 'failed' } : t)))
    } finally {
      setRunningId(null)
    }
  }

  return (
    <div className="task-board">
      <div className="task-head">
        <span className="task-title">
          <IconPlan size={14} /> 任务清单
          {tasks.length > 0 && (
            <span className="task-count">{doneCount}/{tasks.length} 完成</span>
          )}
        </span>
        {tasks.length === 0 ? (
          <button className="btn primary small" onClick={breakdown} disabled={breaking}>
            {breaking ? '拆解中…' : '拆解为任务'}
          </button>
        ) : (
          <span className="task-hint">执行产出可预览，后续将支持 diff 审批与落盘（P3/M4）</span>
        )}
      </div>

      {error && <p className="task-error">{error}</p>}

      {tasks.length > 0 && (
        <ol className="task-list">
          {tasks.map((t, i) => (
            <li key={t.id} className={`task-item ${t.status}`}>
              <div className="task-body">
                <div className="task-row">
                  <span className="task-index">{i + 1}</span>
                  <span className="task-item-title">{t.title}</span>
                  <span className={`task-status ${t.status}`}>{STATUS_LABEL[t.status]}</span>
                  <button
                    className="btn ghost small task-run"
                    onClick={() => run(t)}
                    disabled={runningId !== null || t.status === 'running'}
                  >
                    {t.status === 'done' ? '重新执行' : t.status === 'running' ? '执行中…' : '执行'}
                  </button>
                </div>
                {t.detail && <p className="task-detail">{t.detail}</p>}
                {t.output && <p className="task-output">产出：{t.output}</p>}
                {t.artifact && (
                  <div className="task-artifact">
                    <button
                      className="task-artifact-toggle"
                      onClick={() => setOpenId(openId === t.id ? null : t.id)}
                    >
                      <IconCheck size={12} />
                      {openId === t.id ? '收起交付物' : '查看交付物'}
                    </button>
                    {openId === t.id && (
                      <div className="task-artifact-body">
                        <MarkdownView content={t.artifact} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
