import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import './Panel.css';

function getPostRelativePath(createdAt: string, slug: string): string | null {
  const createdDate = new Date(createdAt);
  if (Number.isNaN(createdDate.getTime())) {
    return null;
  }

  const year = String(createdDate.getFullYear());
  const month = String(createdDate.getMonth() + 1).padStart(2, '0');
  return `posts/${year}/${month}/${slug}.md`;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function toRelativePath(absolutePath: string, projectPath: string): string {
  const normalizedAbsolute = normalizePath(absolutePath);
  const normalizedProject = normalizePath(projectPath);

  if (normalizedAbsolute.toLowerCase() === normalizedProject.toLowerCase()) {
    return '';
  }

  const prefix = `${normalizedProject}/`;
  if (normalizedAbsolute.toLowerCase().startsWith(prefix.toLowerCase())) {
    return normalizedAbsolute.slice(prefix.length);
  }

  return normalizedAbsolute;
}

export const Panel: React.FC = () => {
  const { panelVisible, panelActiveTab, setPanelActiveTab, tasks, tabs, activeTabId, posts, media, activeProject } = useAppStore();
  const [gitLogLoading, setGitLogLoading] = useState(false);
  const [gitLogError, setGitLogError] = useState<string | null>(null);
  const [gitLogTargetLabel, setGitLogTargetLabel] = useState<string | null>(null);
  const [gitLogEntries, setGitLogEntries] = useState<Array<{
    hash: string;
    shortHash: string;
    date: string;
    subject: string;
    author: string;
  }>>([]);
  const requestIdRef = useRef(0);

  const recentTasks = tasks.slice(-10).reverse();
  const activeEditorTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? null, [tabs, activeTabId]);
  const canActivateGitLog = activeEditorTab?.type === 'post' || activeEditorTab?.type === 'media';
  const effectiveActivePanelTab = panelActiveTab === 'git-log' && !canActivateGitLog
    ? 'tasks'
    : panelActiveTab;

  useEffect(() => {
    if (!panelVisible || effectiveActivePanelTab !== 'git-log') {
      setGitLogLoading(false);
      setGitLogError(null);
      return;
    }

    const projectPath = activeProject?.dataPath;
    if (!projectPath || !activeEditorTab || (activeEditorTab.type !== 'post' && activeEditorTab.type !== 'media')) {
      setGitLogEntries([]);
      setGitLogTargetLabel(null);
      setGitLogError(null);
      setGitLogLoading(false);
      return;
    }

    const currentRequestId = ++requestIdRef.current;

    const loadFileHistory = async () => {
      setGitLogLoading(true);
      setGitLogError(null);

      try {
        let targetLabel = '';
        let relativeFilePath = '';

        if (activeEditorTab.type === 'post') {
          const post = posts.find((item) => item.id === activeEditorTab.id) || await window.electronAPI?.posts.get(activeEditorTab.id);
          if (!post) {
            setGitLogEntries([]);
            setGitLogTargetLabel(null);
            setGitLogLoading(false);
            return;
          }

          targetLabel = post.title || post.slug;
          relativeFilePath = getPostRelativePath(post.createdAt, post.slug) || '';
        } else {
          const mediaItem = media.find((item) => item.id === activeEditorTab.id) || await window.electronAPI?.media.get(activeEditorTab.id);
          if (!mediaItem) {
            setGitLogEntries([]);
            setGitLogTargetLabel(null);
            setGitLogLoading(false);
            return;
          }

          targetLabel = mediaItem.title || mediaItem.originalName;
          const absoluteMediaPath = await window.electronAPI?.media.getFilePath(activeEditorTab.id);
          if (!absoluteMediaPath) {
            setGitLogEntries([]);
            setGitLogTargetLabel(targetLabel);
            setGitLogLoading(false);
            return;
          }

          relativeFilePath = toRelativePath(absoluteMediaPath, projectPath);
        }

        if (!relativeFilePath) {
          setGitLogEntries([]);
          setGitLogTargetLabel(targetLabel || null);
          setGitLogLoading(false);
          return;
        }

        const entries = await window.electronAPI?.git.getFileHistory(projectPath, relativeFilePath, 50);
        if (requestIdRef.current !== currentRequestId) {
          return;
        }

        setGitLogEntries(entries || []);
        setGitLogTargetLabel(targetLabel || relativeFilePath);
      } catch (error) {
        if (requestIdRef.current !== currentRequestId) {
          return;
        }
        setGitLogError(error instanceof Error ? error.message : 'Failed to load git log.');
        setGitLogEntries([]);
      } finally {
        if (requestIdRef.current === currentRequestId) {
          setGitLogLoading(false);
        }
      }
    };

    void loadFileHistory();
  }, [panelVisible, effectiveActivePanelTab, activeEditorTab, activeProject?.dataPath, posts, media]);

  if (!panelVisible) {
    return null;
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-tabs" role="tablist" aria-label="Panel tabs">
          <button
            type="button"
            role="tab"
            className={`panel-tab ${effectiveActivePanelTab === 'tasks' ? 'active' : ''}`}
            aria-selected={effectiveActivePanelTab === 'tasks'}
            onClick={() => setPanelActiveTab('tasks')}
          >
            Tasks
          </button>
          <button
            type="button"
            role="tab"
            className={`panel-tab ${effectiveActivePanelTab === 'output' ? 'active' : ''}`}
            aria-selected={effectiveActivePanelTab === 'output'}
            onClick={() => setPanelActiveTab('output')}
          >
            Output
          </button>
          <button
            type="button"
            role="tab"
            className={`panel-tab ${effectiveActivePanelTab === 'git-log' ? 'active' : ''}`}
            aria-selected={effectiveActivePanelTab === 'git-log'}
            aria-disabled={!canActivateGitLog}
            onClick={() => {
              if (canActivateGitLog) {
                setPanelActiveTab('git-log');
              }
            }}
          >
            Git Log
          </button>
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
        {effectiveActivePanelTab === 'tasks' && (
          recentTasks.length === 0 ? (
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
          )
        )}

        {effectiveActivePanelTab === 'output' && (
          <div className="panel-empty">No output</div>
        )}

        {effectiveActivePanelTab === 'git-log' && (
          !canActivateGitLog ? (
            <div className="panel-empty">Open a post or media editor to view git log</div>
          ) : gitLogLoading ? (
            <div className="panel-empty">Loading git log...</div>
          ) : gitLogError ? (
            <div className="panel-empty">{gitLogError}</div>
          ) : gitLogEntries.length === 0 ? (
            <div className="panel-empty">No commits found for this item</div>
          ) : (
            <div className="git-log-list">
              <div className="git-log-target">{gitLogTargetLabel}</div>
              {gitLogEntries.map((entry) => (
                <div key={entry.hash} className="git-log-item">
                  <div className="git-log-subject">{entry.subject}</div>
                  <div className="git-log-meta">
                    <span className="git-log-hash">{entry.shortHash}</span>
                    <span>{entry.author}</span>
                    <span>{new Date(entry.date).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
};
