import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../store';
import type { TaskProgress } from '../../../main/shared/electronApi';
import { buildTaskEntries, summarizeTaskGroup, type TaskEntry } from '../../utils/taskGrouping';
import { useI18n } from '../../i18n';
import './TaskPopup.css';

export const TaskPopup: React.FC = () => {
  const { t } = useI18n();
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
          title={t('tasks.cancelTask')}
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

    const summary = summarizeTaskGroup(entry.tasks);
    const breakdownParts: string[] = [];
    if (summary.running > 0) {
      breakdownParts.push(`${summary.running} ${t('common.running')}`);
    }
    if (summary.pending > 0) {
      breakdownParts.push(`${summary.pending} ${t('common.pending')}`);
    }
    const breakdownSuffix = breakdownParts.length > 0 ? ` · ${breakdownParts.join(' · ')}` : '';
    const groupMetaText = `${summary.progressPercent}%${breakdownSuffix}`;
    const isExpanded = !collapsedGroups.has(entry.groupId);
    return (
      <div key={entry.groupId} className="task-group">
        <button
          className="task-group-toggle"
          onClick={() => toggleGroup(entry.groupId)}
          aria-expanded={isExpanded}
          aria-label={`${entry.groupName} (${entry.tasks.length}, ${groupMetaText})`}
        >
          <span className="task-group-chevron">{isExpanded ? '▾' : '▸'}</span>
          <span className="task-group-title">{entry.groupName} ({entry.tasks.length})</span>
          <span className="task-group-meta">{groupMetaText}</span>
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
        title={t('tasks.triggerTitle', { running: runningTasks.length, pending: pendingTasks.length })}
      >
        {runningTasks.length > 0 ? (
          <>
            <span className="task-spinner" />
            <span>{`${runningTasks.length} ${t('common.running')}`}</span>
          </>
        ) : pendingTasks.length > 0 ? (
          <>
            <span className="task-icon pending">○</span>
            <span>{`${pendingTasks.length} ${t('common.pending')}`}</span>
          </>
        ) : (
          <span>{t('common.tasks')}</span>
        )}
      </button>

      {isOpen && (
        <div className="task-popup">
          <div className="task-popup-header">
            <h4>{t('tasks.backgroundTasks')}</h4>
            {recentTasks.length > 0 && (
              <button className="text-button" onClick={handleClearCompleted}>
                {t('tasks.clearCompleted')}
              </button>
            )}
          </div>

          {runningTasks.length > 0 && (
            <div className="task-section">
              <div className="task-section-title">{t('common.running')}</div>
              {renderEntries(runningEntries)}
            </div>
          )}

          {pendingTasks.length > 0 && (
            <div className="task-section">
              <div className="task-section-title">{t('common.pending')}</div>
              {renderEntries(pendingEntries)}
            </div>
          )}

          {recentTasks.length > 0 && (
            <div className="task-section">
              <div className="task-section-title">{t('tasks.recent')}</div>
              {renderEntries(recentEntries)}
            </div>
          )}

          {runningTasks.length === 0 && pendingTasks.length === 0 && recentTasks.length === 0 && (
            <div className="task-empty">{t('tasks.noActive')}</div>
          )}
        </div>
      )}
    </div>
  );
};

export default TaskPopup;
