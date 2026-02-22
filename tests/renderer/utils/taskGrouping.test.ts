import { describe, it, expect } from 'vitest';
import type { TaskProgress } from '../../../src/main/shared/electronApi';
import { buildTaskEntries, summarizeTaskGroup } from '../../../src/renderer/utils/taskGrouping';

function createTask(overrides: Partial<TaskProgress>): TaskProgress {
  return {
    taskId: overrides.taskId || 'task-1',
    name: overrides.name || 'Task',
    status: overrides.status || 'running',
    progress: overrides.progress ?? 0,
    message: overrides.message || 'Working',
    startTime: overrides.startTime || new Date('2026-02-22T00:00:00.000Z').toISOString(),
    endTime: overrides.endTime,
    error: overrides.error,
    groupId: overrides.groupId,
    groupName: overrides.groupName,
  };
}

describe('taskGrouping', () => {
  it('should keep first-seen order while grouping task entries', () => {
    const tasks: TaskProgress[] = [
      createTask({ taskId: 'single-1', name: 'Single 1' }),
      createTask({ taskId: 'group-a-1', groupId: 'group-a', groupName: 'Group A' }),
      createTask({ taskId: 'single-2', name: 'Single 2' }),
      createTask({ taskId: 'group-a-2', groupId: 'group-a', groupName: 'Group A' }),
      createTask({ taskId: 'group-b-1', groupId: 'group-b', groupName: 'Group B' }),
    ];

    const entries = buildTaskEntries(tasks);

    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ kind: 'single' });
    expect(entries[1]).toMatchObject({ kind: 'group', groupId: 'group-a' });
    expect(entries[2]).toMatchObject({ kind: 'single' });
    expect(entries[3]).toMatchObject({ kind: 'group', groupId: 'group-b' });
  });

  it('should compute aggregate group progress for concurrent mixed statuses', () => {
    const tasks: TaskProgress[] = [
      createTask({ taskId: 'core', status: 'running', progress: 40, groupId: 'site-render' }),
      createTask({ taskId: 'single', status: 'running', progress: 10, groupId: 'site-render' }),
      createTask({ taskId: 'tag', status: 'pending', progress: 0, groupId: 'site-render' }),
      createTask({ taskId: 'category', status: 'completed', progress: 100, groupId: 'site-render', endTime: new Date('2026-02-22T00:01:00.000Z').toISOString() }),
      createTask({ taskId: 'date', status: 'failed', progress: 30, groupId: 'site-render', endTime: new Date('2026-02-22T00:01:00.000Z').toISOString() }),
    ];

    const summary = summarizeTaskGroup(tasks);

    expect(summary.total).toBe(5);
    expect(summary.running).toBe(2);
    expect(summary.pending).toBe(1);
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.cancelled).toBe(0);
    expect(summary.progressPercent).toBe(50);
  });
});
