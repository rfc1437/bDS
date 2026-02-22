import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TaskPopup } from '../../../src/renderer/components/TaskPopup/TaskPopup';
import { useAppStore } from '../../../src/renderer/store';
import type { TaskProgress } from '../../../src/main/shared/electronApi';

function makeTask(overrides: Partial<TaskProgress> = {}): TaskProgress {
  return {
    taskId: overrides.taskId ?? 'task-1',
    status: overrides.status ?? 'running',
    progress: overrides.progress ?? 10,
    message: overrides.message ?? 'Running task',
    startTime: overrides.startTime ?? '2026-02-20T10:00:00.000Z',
    endTime: overrides.endTime,
    error: overrides.error,
    groupId: overrides.groupId,
    groupName: overrides.groupName,
  };
}

describe('TaskPopup grouped tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      tasks: [],
    });
  });

  it('shows grouped render tasks and expands to list child tasks', () => {
    useAppStore.setState({
      tasks: [
        makeTask({
          taskId: 'site-render-core-1',
          status: 'running',
          message: 'Generating root pages',
          groupId: 'site-render-1',
          groupName: 'Render Site',
        }),
        makeTask({
          taskId: 'site-render-date-1',
          status: 'pending',
          progress: 0,
          message: 'Generating date archive pages',
          groupId: 'site-render-1',
          groupName: 'Render Site',
        }),
      ],
    });

    render(<TaskPopup />);

    fireEvent.click(screen.getByRole('button', { name: /running/i }));

    const groupToggle = screen.getByRole('button', { name: /Render Site \(1, \d+% · 1 running\)/i });
    expect(groupToggle).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Render Site \(1, \d+% · 1 pending\)/i })).toBeInTheDocument();
    expect(screen.getByText('Generating root pages')).toBeInTheDocument();
    expect(screen.getByText('Generating date archive pages')).toBeInTheDocument();

    fireEvent.click(groupToggle);

    expect(screen.queryByText('Generating root pages')).not.toBeInTheDocument();
    expect(screen.queryByText('Generating date archive pages')).not.toBeInTheDocument();
  });

  it('continues to render ungrouped tasks directly', () => {
    useAppStore.setState({
      tasks: [
        makeTask({ taskId: 'ungrouped-1', status: 'running', message: 'Standalone task' }),
      ],
    });

    render(<TaskPopup />);

    fireEvent.click(screen.getByRole('button', { name: /running/i }));

    expect(screen.getByText('Standalone task')).toBeInTheDocument();
  });
});
