import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import type { TaskProgress } from '../../../main/shared/electronApi';
import { openEntityTab } from '../../navigation/tabPolicy';
import { useI18n } from '../../i18n';
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

  return entries
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.entry);
}

export const Panel: React.FC = () => {
  const { t, language } = useI18n();
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
  const [collapsedTaskGroups, setCollapsedTaskGroups] = useState<Set<string>>(new Set());
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
  const recentTaskEntries = useMemo(() => buildTaskEntries(recentTasks), [recentTasks]);
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
        setPostLinksError(error instanceof Error ? error.message : t('panel.error.loadPostLinks'));
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
        setGitLogError(error instanceof Error ? error.message : t('panel.error.loadGitLog'));
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
    openEntityTab(openTab, 'post', postId, 'pin');
    setSelectedPost(postId);
    setActiveView('posts');
  };

  const toggleTaskGroup = (groupId: string) => {
    setCollapsedTaskGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const renderTaskRow = (task: TaskProgress, isChild = false) => (
    <div key={task.taskId} className={`task-item status-${task.status} ${isChild ? 'task-child-row' : ''}`.trim()}>
      <div className="task-status">
        {task.status === 'running' && <span className="task-spinner" />}
        {task.status === 'completed' && <span className="task-check">✓</span>}
        {task.status === 'failed' && <span className="task-error">✗</span>}
        {task.status === 'pending' && <span className="task-pending">○</span>}
      </div>
      <div className="task-info">
        <div className="task-name">{task.name || task.taskId}</div>
        <div className="task-message">{task.message}</div>
        {(task.status === 'running' || task.status === 'pending') && (
          <div className="task-progress-row">
            <div className="task-progress-bar">
              <div
                className="task-progress-fill"
                style={{ width: `${task.progress}%` }}
              />
            </div>
            <span className="task-progress-value">{Math.round(task.progress)}%</span>
          </div>
        )}
      </div>
      {task.status === 'running' && (
        <button
          className="task-cancel"
          onClick={() => window.electronAPI?.tasks.cancel(task.taskId)}
        >
          {t('common.cancel')}
        </button>
      )}
    </div>
  );

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-tabs" role="tablist" aria-label={t('panel.tabsAria')}>
          <button
            type="button"
            role="tab"
            className={`panel-tab ${effectiveActivePanelTab === 'tasks' ? 'active' : ''}`}
            aria-selected={effectiveActivePanelTab === 'tasks'}
            onClick={() => setPanelActiveTab('tasks')}
          >
            {t('common.tasks')}
          </button>
          <button
            type="button"
            role="tab"
            className={`panel-tab ${effectiveActivePanelTab === 'output' ? 'active' : ''}`}
            aria-selected={effectiveActivePanelTab === 'output'}
            onClick={() => setPanelActiveTab('output')}
          >
            {t('panel.output')}
          </button>
          {canActivatePostLinks && (
            <button
              type="button"
              role="tab"
              className={`panel-tab ${effectiveActivePanelTab === 'post-links' ? 'active' : ''}`}
              aria-selected={effectiveActivePanelTab === 'post-links'}
              onClick={() => setPanelActiveTab('post-links')}
            >
              {t('panel.postLinks')}
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
            {t('panel.gitLog')}
          </button>
        </div>
        <button 
          className="panel-close"
          onClick={() => useAppStore.getState().togglePanel()}
          title={t('panel.closeTitle')}
        >
          ×
        </button>
      </div>
      <div className="panel-content">
        {effectiveActivePanelTab === 'tasks' && (
          recentTasks.length === 0 ? (
            <div className="panel-empty">{t('panel.noRecentTasks')}</div>
          ) : (
            <div className="task-list">
              {recentTaskEntries.map((entry) => {
                if (entry.kind === 'single') {
                  return renderTaskRow(entry.task);
                }

                const expanded = !collapsedTaskGroups.has(entry.groupId);
                return (
                  <div key={entry.groupId} className="task-group-row">
                    <button
                      type="button"
                      className="task-group-toggle"
                      onClick={() => toggleTaskGroup(entry.groupId)}
                      aria-expanded={expanded}
                      aria-label={`${entry.groupName} (${entry.tasks.length})`}
                    >
                      <span className="task-group-chevron">{expanded ? '▾' : '▸'}</span>
                      <span className="task-group-title">{entry.groupName} ({entry.tasks.length})</span>
                    </button>
                    {expanded && entry.tasks.map((task) => renderTaskRow(task, true))}
                  </div>
                );
              })}
            </div>
          )
        )}

        {effectiveActivePanelTab === 'output' && (
          <div className="panel-empty">{t('panel.noOutput')}</div>
        )}

        {effectiveActivePanelTab === 'post-links' && (
          !canActivatePostLinks ? (
            <div className="panel-empty">{t('panel.openPostEditor')}</div>
          ) : postLinksLoading ? (
            <div className="panel-empty">{t('panel.loadingPostLinks')}</div>
          ) : postLinksError ? (
            <div className="panel-empty">{postLinksError}</div>
          ) : postLinksEntries.length === 0 ? (
            <div className="panel-empty">{t('panel.noPostLinks')}</div>
          ) : (
            <div className="post-links-list">
              {postLinksEntries.map((entry) => (
                <button
                  key={`${entry.direction}-${entry.id}`}
                  type="button"
                  className="post-links-item"
                  onClick={() => handlePostLinkClick(entry.id)}
                  title={t('postLinks.openTitle', { title: entry.title || entry.slug })}
                >
                  <span className="post-links-direction">{t(`panel.direction.${entry.direction}`)} {entry.slug}</span>
                </button>
              ))}
            </div>
          )
        )}

        {effectiveActivePanelTab === 'git-log' && (
          !canActivateGitLog ? (
            <div className="panel-empty">{t('panel.openPostOrMediaEditor')}</div>
          ) : gitLogLoading ? (
            <div className="panel-empty">{t('panel.loadingGitLog')}</div>
          ) : gitLogError ? (
            <div className="panel-empty">{gitLogError}</div>
          ) : gitLogEntries.length === 0 ? (
            <div className="panel-empty">{t('panel.noCommits')}</div>
          ) : (
            <div className="git-log-list">
              <div className="git-log-target">{gitLogTargetLabel}</div>
              {gitLogEntries.map((entry) => (
                <div key={entry.hash} className="git-log-item">
                  <div className="git-log-subject">{entry.subject}</div>
                  <div className="git-log-meta">
                    <span className="git-log-hash">{entry.shortHash}</span>
                    <span>{entry.author}</span>
                    <span>{new Date(entry.date).toLocaleString(language)}</span>
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
