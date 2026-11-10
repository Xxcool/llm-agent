import { useState } from 'react'
import type { Task } from '../types'
import { applyTask, archiveTask, breakdownTasks, discardTask, runTask } from '../api'
import { MarkdownView } from './MarkdownView'
import { IconCheck, IconPlan, IconX } from './icons'

const STATUS_LABEL: Record<Task['status'], string> = {
  pending: '待执行',
  running: '执行中',
  review: '待审批',
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
  const [applyingId, setApplyingId] = useState<number | null>(null)
  const [archivingId, setArchivingId] = useState<number | null>(null)
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

  /** 代码类：批准落盘（写入工作区沙箱 + 校验） */
  const apply = async (task: Task) => {
    if (applyingId !== null) return
    setApplyingId(task.id)
    setError('')
    try {
      const r = await applyTask(task.id)
      // 校验结果以响应为准（即便 task 未携带 checks 也能展示）
      const merged = { ...r.task, checks: r.checks }
      onTasks(tasks.map((t) => (t.id === task.id ? merged : t)))
      const failed = r.checks.filter((c) => !c.ok)
      if (failed.length) setError(`已落盘，但 ${failed.length} 个文件校验未通过：${failed[0].detail}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setApplyingId(null)
    }
  }

  /** 已完成任务：把交付物归档回知识库（P4/M5） */
  const archive = async (task: Task) => {
    if (archivingId !== null) return
    setArchivingId(task.id)
    setError('')
    try {
      const r = await archiveTask(task.id)
      onTasks(tasks.map((t) => (t.id === task.id ? r.task : t)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setArchivingId(null)
    }
  }

  /** 代码类：丢弃待审批文件 */
  const discard = async (task: Task) => {
    if (applyingId !== null) return
    setApplyingId(task.id)
    setError('')
    try {
      const updated = await discardTask(task.id)
      onTasks(tasks.map((t) => (t.id === task.id ? updated : t)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setApplyingId(null)
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
          <span className="task-hint">文档类直接交付；代码类先看 diff，批准后落入工作区沙箱并自动校验</span>
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
                  <span className={`task-kind ${t.kind}`}>{t.kind === 'code' ? '代码' : '文档'}</span>
                  <span className={`task-status ${t.status}`}>{STATUS_LABEL[t.status]}</span>
                  {t.status === 'review' ? (
                    <span className="task-review-actions">
                      <button
                        className="btn primary small"
                        onClick={() => apply(t)}
                        disabled={applyingId !== null}
                      >
                        <IconCheck size={12} /> {applyingId === t.id ? '落盘中…' : '批准落盘'}
                      </button>
                      <button
                        className="btn ghost small"
                        onClick={() => discard(t)}
                        disabled={applyingId !== null}
                      >
                        <IconX size={12} /> 丢弃
                      </button>
                    </span>
                  ) : (
                    <>
                      {t.status === 'done' && (
                        t.archive_path ? (
                          <span className="task-archived" title={t.archive_path}>已归档</span>
                        ) : (
                          <button
                            className="btn ghost small"
                            onClick={() => archive(t)}
                            disabled={archivingId !== null}
                          >
                            {archivingId === t.id ? '归档中…' : '归档到知识库'}
                          </button>
                        )
                      )}
                      <button
                        className="btn ghost small task-run"
                        onClick={() => run(t)}
                        disabled={runningId !== null || t.status === 'running'}
                      >
                        {t.status === 'done' ? '重新执行' : t.status === 'running' ? '执行中…' : '执行'}
                      </button>
                    </>
                  )}
                </div>
                {t.detail && <p className="task-detail">{t.detail}</p>}
                {t.output && <p className="task-output">产出：{t.output}</p>}

                {/* 代码类交付：diff 预览（批准前不落盘） */}
                {t.files && t.files.length > 0 && (
                  <div className="task-files">
                    <p className="task-files-hint">
                      待落盘文件 {t.files.length} 个 · 工作区沙箱 · 批准后写入并自动校验
                    </p>
                    {t.files.map((f) => (
                      <div key={f.path} className="task-file">
                        <div className="task-file-head">
                          <span className="task-file-path">{f.path}</span>
                          <span className={`task-file-flag ${f.exists ? 'mod' : 'new'}`}>
                            {f.exists ? '修改' : '新增'}
                          </span>
                          <span className="task-file-stat">
                            <b className="add">+{f.added}</b>
                            <b className="del">-{f.removed}</b>
                          </span>
                        </div>
                        {f.diff && (
                          <pre className="task-diff">
                            {f.diff.split('\n').map((line, li) => (
                              <span
                                key={li}
                                className={
                                  line.startsWith('+') && !line.startsWith('+++')
                                    ? 'd-add'
                                    : line.startsWith('-') && !line.startsWith('---')
                                      ? 'd-del'
                                      : line.startsWith('@@')
                                        ? 'd-hunk'
                                        : ''
                                }
                              >
                                {line}{'\n'}
                              </span>
                            ))}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* 落盘后的确定性校验结果 */}
                {t.checks && t.checks.length > 0 && (
                  <div className="task-checks">
                    {t.checks.map((c) => (
                      <span key={c.path} className={`task-check ${c.ok ? 'ok' : 'err'}`}>
                        {c.ok ? '✓' : '✗'} {c.path}：{c.detail}
                      </span>
                    ))}
                  </div>
                )}

                {t.artifact && (
                  <div className="task-artifact">
                    <button
                      className="task-artifact-toggle"
                      onClick={() => setOpenId(openId === t.id ? null : t.id)}
                    >
                      <IconCheck size={12} />
                      {openId === t.id ? '收起交付物' : t.kind === 'code' ? '查看交付说明' : '查看交付物'}
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
