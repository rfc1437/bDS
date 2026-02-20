import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../store';
import type { TaskProgress } from '../../../main/shared/electronApi';
import './TaskPopup.css';

interface GroupedTaskEntry {
  kind: 'group';
  groupId: string;
  groupName: string;
  tasks: TaskProgress[];
}

interface SingleTaskEntry {
  kind: 'single';
  task: TaskProgress;
}

type TaskEntry = GroupedTaskEntry | SingleTaskEntry;

function buildTaskEntries(tasks: TaskProgress[]): TaskEntry[] {
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

  const groupedEntries: Array<{ entry: TaskEntry; index: number }> = [];

  for (const single of singles) {
    groupedEntries.push({
      index: single.index,
      entry: {
        kind: 'single',
        task: single.task,
      },
    });
  }

  for (const [groupId, group] of groupMap.entries()) {
    groupedEntries.push({
      index: group.firstIndex,
      entry: {
        kind: 'group',
        groupId,
        groupName: group.groupName,
        tasks: group.tasks,
      },
    });
  }

  return groupedEntries
    .sort((a, b) => a.index - b.index)
    .map((item) => item.entry);
}

export const TaskPopup: React.FC = () => {
  const { tasks } = useAppStore();
  const [isOpen, setIsOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const popupRef = useRef<HTMLDivElement>(null);

  const runningTasks = tasks.filter(t => t.status === 'running');
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const recentTasks = tasks
    .filter(t => t.status === 'completed' || t.status === 'failed')
    .sort((a, b) => {
      const aTime = a.endTime ? new Date(a.endTime).getTime() : 0;
      const bTime = b.endTime ? new Date(b.endTime).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 5);

  const hasActiveTasks = runningTasks.length > 0 || pendingTasks.length > 0;

  const runningEntries = buildTaskEntries(runningTasks);
  const pendingEntries = buildTaskEntries(pendingTasks);
  const recentEntries = buildTaskEntries(recentTasks);

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleCancel = async (taskId: string) => {
    await window.electronAPI?.tasks.cancel(taskId);
  };

  const handleClearCompleted = async () => {
    await window.electronAPI?.tasks.clearCompleted();
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <span className="task-spinner" />;
      case 'completed':
        return <span className="task-icon success">✓</span>;
      case 'failed':
        return <span className="task-icon error">✕</span>;
      case 'pending':
        return <span className="task-icon pending">○</span>;
      case 'cancelled':
        return <span className="task-icon cancelled">⊘</span>;
      default:
        return null;
    }
  };

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const renderTaskItem = (task: TaskProgress, className: string = '') => (
    <div key={task.taskId} className={`task-item ${task.status} ${className}`.trim()}>
      <div className="task-item-info">
        {getStatusIcon(task.status)}
        <div className="task-item-details">
          <div className="task-item-message">{task.message}</div>
          {task.status === 'running' && (
            <div className="task-progress-bar">
              <div
                className="task-progress-fill"
                style={{ width: `${task.progress}%` }}
              />
            </div>
          )}
          {task.error && (
            <div className="task-item-error">{task.error}</div>
          )}
        </div>
      </div>
      {(task.status === 'running' || task.status === 'pending') && (
        <button
          className="task-cancel"
          onClick={() => handleCancel(task.taskId)}
          title="Cancel task"
        >
          ✕
        </button>
      )}
      {(task.status === 'completed' || task.status === 'failed') && task.endTime && (
        <span className="task-time">{formatTime(task.endTime)}</span>
      )}
    </div>
  );

  const renderEntries = (entries: TaskEntry[]) => entries.map((entry) => {
    if (entry.kind === 'single') {
      return renderTaskItem(entry.task);
    }

    const isExpanded = !collapsedGroups.has(entry.groupId);
    return (
      <div key={entry.groupId} className="task-group">
        <button
          className="task-group-toggle"
          onClick={() => toggleGroup(entry.groupId)}
          aria-expanded={isExpanded}
          aria-label={`${entry.groupName} (${entry.tasks.length})`}
        >
          <span className="task-group-chevron">{isExpanded ? '▾' : '▸'}</span>
          <span className="task-group-title">{entry.groupName} ({entry.tasks.length})</span>
        </button>
        {isExpanded && entry.tasks.map((task) => renderTaskItem(task, 'task-group-child'))}
      </div>
    );
  });

  if (!hasActiveTasks && recentTasks.length === 0) {
    return null;
  }

  return (
    <div className="task-popup-wrapper" ref={popupRef}>
      <button 
        className={`task-popup-trigger ${hasActiveTasks ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title={`${runningTasks.length} running, ${pendingTasks.length} pending`}
      >
        {runningTasks.length > 0 ? (
          <>
            <span className="task-spinner" />
            <span>{runningTasks.length} running</span>
          </>
        ) : pendingTasks.length > 0 ? (
          <>
            <span className="task-icon pending">○</span>
            <span>{pendingTasks.length} pending</span>
          </>
        ) : (
          <span>Tasks</span>
        )}
      </button>

      {isOpen && (
        <div className="task-popup">
          <div className="task-popup-header">
            <h4>Background Tasks</h4>
            {recentTasks.length > 0 && (
              <button className="text-button" onClick={handleClearCompleted}>
                Clear completed
              </button>
            )}
          </div>

          {runningTasks.length > 0 && (
            <div className="task-section">
              <div className="task-section-title">Running</div>
              {renderEntries(runningEntries)}
            </div>
          )}

          {pendingTasks.length > 0 && (
            <div className="task-section">
              <div className="task-section-title">Pending</div>
              {renderEntries(pendingEntries)}
            </div>
          )}

          {recentTasks.length > 0 && (
            <div className="task-section">
              <div className="task-section-title">Recent</div>
              {renderEntries(recentEntries)}
            </div>
          )}

          {runningTasks.length === 0 && pendingTasks.length === 0 && recentTasks.length === 0 && (
            <div className="task-empty">No active tasks</div>
          )}
        </div>
      )}
    </div>
  );
};

export default TaskPopup;
