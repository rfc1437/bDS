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
  const {
    panelVisible,
    panelActiveTab,
    setPanelActiveTab,
    tasks,
    tabs,
    activeTabId,
    posts,
    media,
    activeProject,
    openTab,
    setSelectedPost,
    setActiveView,
  } = useAppStore();
  const [gitLogLoading, setGitLogLoading] = useState(false);
  const [gitLogError, setGitLogError] = useState<string | null>(null);
  const [postLinksLoading, setPostLinksLoading] = useState(false);
  const [postLinksError, setPostLinksError] = useState<string | null>(null);
  const [postLinksEntries, setPostLinksEntries] = useState<Array<{
    id: string;
    title: string;
    slug: string;
    direction: 'from' | 'to';
  }>>([]);
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
  const canActivatePostLinks = activeEditorTab?.type === 'post';
  const canActivateGitLog = activeEditorTab?.type === 'post' || activeEditorTab?.type === 'media';
  const effectiveActivePanelTab = useMemo(() => {
    if (panelActiveTab === 'post-links' && !canActivatePostLinks) {
      return 'tasks';
    }
    if (panelActiveTab === 'git-log' && !canActivateGitLog) {
      return 'tasks';
    }
    return panelActiveTab;
  }, [panelActiveTab, canActivatePostLinks, canActivateGitLog]);

  useEffect(() => {
    if (!panelVisible || effectiveActivePanelTab !== 'post-links') {
      setPostLinksLoading(false);
      setPostLinksError(null);
      return;
    }

    if (!activeEditorTab || activeEditorTab.type !== 'post') {
      setPostLinksEntries([]);
      setPostLinksError(null);
      setPostLinksLoading(false);
      return;
    }

    const loadPostLinks = async () => {
      setPostLinksLoading(true);
      setPostLinksError(null);

      try {
        const [linkedBy, linksTo] = await Promise.all([
          window.electronAPI?.posts.getLinkedBy(activeEditorTab.id),
          window.electronAPI?.posts.getLinksTo(activeEditorTab.id),
        ]);

        const fromEntries = (linkedBy || []).map((post) => ({
          id: post.id,
          title: post.title,
          slug: post.slug,
          direction: 'from' as const,
        }));

        const toEntries = (linksTo || []).map((post) => ({
          id: post.id,
          title: post.title,
          slug: post.slug,
          direction: 'to' as const,
        }));

        setPostLinksEntries([...fromEntries, ...toEntries]);
      } catch (error) {
        setPostLinksError(error instanceof Error ? error.message : 'Failed to load post links.');
        setPostLinksEntries([]);
      } finally {
        setPostLinksLoading(false);
      }
    };

    void loadPostLinks();
  }, [panelVisible, effectiveActivePanelTab, activeEditorTab]);

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

  const handlePostLinkClick = (postId: string) => {
    openTab({ type: 'post', id: postId, isTransient: false });
    setSelectedPost(postId);
    setActiveView('posts');
  };

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
          {canActivatePostLinks && (
            <button
              type="button"
              role="tab"
              className={`panel-tab ${effectiveActivePanelTab === 'post-links' ? 'active' : ''}`}
              aria-selected={effectiveActivePanelTab === 'post-links'}
              onClick={() => setPanelActiveTab('post-links')}
            >
              Post Links
            </button>
          )}
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

        {effectiveActivePanelTab === 'post-links' && (
          !canActivatePostLinks ? (
            <div className="panel-empty">Open a post editor to view post links</div>
          ) : postLinksLoading ? (
            <div className="panel-empty">Loading post links...</div>
          ) : postLinksError ? (
            <div className="panel-empty">{postLinksError}</div>
          ) : postLinksEntries.length === 0 ? (
            <div className="panel-empty">No post links for this post</div>
          ) : (
            <div className="post-links-list">
              {postLinksEntries.map((entry) => (
                <button
                  key={`${entry.direction}-${entry.id}`}
                  type="button"
                  className="post-links-item"
                  onClick={() => handlePostLinkClick(entry.id)}
                  title={`Open ${entry.title || entry.slug}`}
                >
                  <span className="post-links-direction">{entry.direction} {entry.slug}</span>
                </button>
              ))}
            </div>
          )
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
