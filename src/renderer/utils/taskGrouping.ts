import type { TaskProgress } from '../../main/shared/electronApi';

export interface GroupedTaskEntry {
  kind: 'group';
  groupId: string;
  groupName: string;
  tasks: TaskProgress[];
}

export interface SingleTaskEntry {
  kind: 'single';
  task: TaskProgress;
}

export type TaskEntry = GroupedTaskEntry | SingleTaskEntry;

export interface TaskGroupSummary {
  total: number;
  running: number;
  pending: number;
  completed: number;
  failed: number;
  cancelled: number;
  progressPercent: number;
}

function clampProgress(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function getProgressContribution(task: TaskProgress): number {
  switch (task.status) {
    case 'completed':
    case 'failed':
    case 'cancelled':
      return 100;
    case 'pending':
      return 0;
    case 'running':
    default:
      return clampProgress(task.progress);
  }
}

export function summarizeTaskGroup(tasks: TaskProgress[]): TaskGroupSummary {
  const summary: TaskGroupSummary = {
    total: tasks.length,
    running: 0,
    pending: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    progressPercent: 0,
  };

  if (tasks.length === 0) {
    return summary;
  }

  let progressTotal = 0;
  for (const task of tasks) {
    if (task.status === 'running') {
      summary.running += 1;
    } else if (task.status === 'pending') {
      summary.pending += 1;
    } else if (task.status === 'completed') {
      summary.completed += 1;
    } else if (task.status === 'failed') {
      summary.failed += 1;
    } else if (task.status === 'cancelled') {
      summary.cancelled += 1;
    }

    progressTotal += getProgressContribution(task);
  }

  summary.progressPercent = Math.round(progressTotal / tasks.length);
  return summary;
}

export function buildTaskEntries(tasks: TaskProgress[]): TaskEntry[] {
  const groupMap = new Map<string, { groupName: string; tasks: TaskProgress[]; firstIndex: number }>();
  const singles: Array<{ task: TaskProgress; index: number }> = [];

  tasks.forEach((task, index) => {
    if (!task.groupId) {
      singles.push({ task, index });
      return;
    }

    const existing = groupMap.get(task.groupId);
    if (existing) {
      existing.tasks.push(task);
      return;
    }

    groupMap.set(task.groupId, {
      groupName: task.groupName || task.groupId,
      tasks: [task],
      firstIndex: index,
    });
  });

  const entries: Array<{ entry: TaskEntry; index: number }> = [];

  for (const single of singles) {
    entries.push({
      index: single.index,
      entry: {
        kind: 'single',
        task: single.task,
      },
    });
  }

  for (const [groupId, group] of groupMap.entries()) {
    entries.push({
      index: group.firstIndex,
      entry: {
        kind: 'group',
        groupId,
        groupName: group.groupName,
        tasks: group.tasks,
      },
    });
  }

  return entries.sort((a, b) => a.index - b.index).map((entry) => entry.entry);
}
