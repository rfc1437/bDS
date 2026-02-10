import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../store';
import './TaskPopup.css';

export const TaskPopup: React.FC = () => {
  const { tasks } = useAppStore();
  const [isOpen, setIsOpen] = useState(false);
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
              {runningTasks.map(task => (
                <div key={task.taskId} className="task-item running">
                  <div className="task-item-info">
                    {getStatusIcon(task.status)}
                    <div className="task-item-details">
                      <div className="task-item-message">{task.message}</div>
                      <div className="task-progress-bar">
                        <div 
                          className="task-progress-fill" 
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <button 
                    className="task-cancel" 
                    onClick={() => handleCancel(task.taskId)}
                    title="Cancel task"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {pendingTasks.length > 0 && (
            <div className="task-section">
              <div className="task-section-title">Pending</div>
              {pendingTasks.map(task => (
                <div key={task.taskId} className="task-item pending">
                  <div className="task-item-info">
                    {getStatusIcon(task.status)}
                    <div className="task-item-details">
                      <div className="task-item-message">{task.message}</div>
                    </div>
                  </div>
                  <button 
                    className="task-cancel" 
                    onClick={() => handleCancel(task.taskId)}
                    title="Cancel task"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {recentTasks.length > 0 && (
            <div className="task-section">
              <div className="task-section-title">Recent</div>
              {recentTasks.map(task => (
                <div key={task.taskId} className={`task-item ${task.status}`}>
                  <div className="task-item-info">
                    {getStatusIcon(task.status)}
                    <div className="task-item-details">
                      <div className="task-item-message">{task.message}</div>
                      {task.error && (
                        <div className="task-item-error">{task.error}</div>
                      )}
                    </div>
                  </div>
                  {task.endTime && (
                    <span className="task-time">{formatTime(task.endTime)}</span>
                  )}
                </div>
              ))}
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
