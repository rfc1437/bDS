import React from 'react';
import { useAppStore } from '../../store';
import './Panel.css';

export const Panel: React.FC = () => {
  const { panelVisible, tasks } = useAppStore();

  if (!panelVisible) {
    return null;
  }

  const recentTasks = tasks.slice(-10).reverse();

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-tabs">
          <div className="panel-tab active">Tasks</div>
          <div className="panel-tab">Output</div>
          <div className="panel-tab">Sync Log</div>
        </div>
        <button 
          className="panel-close"
          onClick={() => useAppStore.getState().togglePanel()}
          title="Close Panel"
        >
          ×
        </button>
      </div>
      <div className="panel-content">
        {recentTasks.length === 0 ? (
          <div className="panel-empty">No recent tasks</div>
        ) : (
          <div className="task-list">
            {recentTasks.map(task => (
              <div key={task.taskId} className={`task-item status-${task.status}`}>
                <div className="task-status">
                  {task.status === 'running' && <span className="task-spinner" />}
                  {task.status === 'completed' && <span className="task-check">✓</span>}
                  {task.status === 'failed' && <span className="task-error">✗</span>}
                  {task.status === 'pending' && <span className="task-pending">○</span>}
                </div>
                <div className="task-info">
                  <div className="task-message">{task.message}</div>
                  {task.status === 'running' && (
                    <div className="task-progress-bar">
                      <div 
                        className="task-progress-fill" 
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  )}
                </div>
                {task.status === 'running' && (
                  <button 
                    className="task-cancel"
                    onClick={() => window.electronAPI?.tasks.cancel(task.taskId)}
                  >
                    Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
