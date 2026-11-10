import type { Plan, Task } from '../types'

/** 测试夹具：方案与任务（与后端 normalize 后的结构一致） */
export function makePlan(over: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-a',
    title: '差旅报销线上化落地方案',
    approach: '在现有系统上配置化改造',
    background: '现有报销为线下提交，周期长。',
    goal: '报销全流程线上化',
    steps: [
      { title: '梳理流程', detail: '输出流程图' },
      { title: '配置系统', detail: '配置审批流' },
    ],
    evidence: [{ source: 'samples/员工差旅与费用报销制度.md', quote: 'P1-P4 一线城市 450 元/晚' }],
    risks: [{ risk: '旧单积压', mitigation: '并行过渡一个月' }],
    systems: ['OA', '费用系统'],
    cost: '约 2 人月',
    duration: '2 周',
    risk_level: '低',
    recommended: true,
    status: 'draft',
    ...over,
  }
}

export function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    session_id: 's1',
    message_id: 10,
    plan_id: 'plan-a',
    title: '输出差旅报销流程图',
    detail: '梳理申请-审批-报销-打款节点',
    output: '流程图与节点说明',
    kind: 'doc',
    status: 'pending',
    artifact: null,
    files: null,
    checks: null,
    ...over,
  }
}
