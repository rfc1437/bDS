import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import { useI18n } from '../../i18n';
import {
  getActivityConfig,
  isActivityActive,
  type ActivityId,
  type ActivitySnapshot,
} from '../../navigation/activityBehavior';
import { executeActivityClick as runActivityClick } from '../../navigation/activityExecution';
import './ActivityBar.css';

// Simple SVG icons
const PostsIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
    <path d="M8 12h8v2H8zm0 4h8v2H8z"/>
  </svg>
);

const PagesIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M4 4h10v4h6v12H4V4zm10 1.5V9h4.5L14 5.5zM7 12h10v1.5H7V12zm0 3h10v1.5H7V15z"/>
  </svg>
);

const MediaIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
  </svg>
);

const ScriptsIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20 3H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7v2H8v2h8v-2h-3v-2h7a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zM5 14V5h14v9H5zm2-7.5L9.5 9 7 11.5l1.4 1.4L12.3 9 8.4 5.1 7 6.5zm6.5 5.5h4v-2h-4v2z"/>
  </svg>
);

const SettingsIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
  </svg>
);

const TagsIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/>
  </svg>
);

const ChatIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
    <circle cx="8" cy="10" r="1.5"/>
    <circle cx="12" cy="10" r="1.5"/>
    <circle cx="16" cy="10" r="1.5"/>
  </svg>
);

const ImportIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
  </svg>
);

const GitIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M22 11.73L12.27 2a1 1 0 0 0-1.41 0L8.84 4.02l2.56 2.56a1.2 1.2 0 0 1 1.52 1.53l2.47 2.47a1.2 1.2 0 1 1-.72.67l-2.3-2.3v6.06a1.2 1.2 0 1 1-.85 0V8.9a1.2 1.2 0 0 1-.66-1.59L8.35 4.8 2 11.16a1 1 0 0 0 0 1.41L11.73 22a1 1 0 0 0 1.41 0L22 13.14a1 1 0 0 0 0-1.41z"/>
  </svg>
);

export const ActivityBar: React.FC = () => {
  const { t } = useI18n();
  const { activeView, setActiveView, sidebarVisible, toggleSidebar, tabs, activeTabId, activeProject } = useAppStore();
  const [pendingPullCount, setPendingPullCount] = useState(0);
  const gitRefreshInFlightRef = useRef(false);

  const refreshPendingPullCount = useCallback(async () => {
    if (gitRefreshInFlightRef.current) {
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setPendingPullCount(0);
      return;
    }

    if (!activeProject) {
      setPendingPullCount(0);
      return;
    }

    const gitApi = window.electronAPI?.git;
    if (!gitApi?.getRepoState || !gitApi?.fetch || !gitApi?.getRemoteState) {
      setPendingPullCount(0);
      return;
    }

    gitRefreshInFlightRef.current = true;
    try {
      const targetProjectPath = activeProject.dataPath || (await window.electronAPI?.app.getDefaultProjectPath(activeProject.id));
      if (!targetProjectPath) {
        setPendingPullCount(0);
        return;
      }

      const repoState = await gitApi.getRepoState(targetProjectPath);
      if (!repoState.isRepo || !repoState.hasRemote) {
        setPendingPullCount(0);
        return;
      }

      const fetchResult = await gitApi.fetch(targetProjectPath);
      if (!fetchResult.success) {
        return;
      }

      const remoteState = await gitApi.getRemoteState(targetProjectPath);
      setPendingPullCount(Math.max(0, remoteState.behind));
    } catch {
      setPendingPullCount(0);
    } finally {
      gitRefreshInFlightRef.current = false;
    }
  }, [activeProject]);

  useEffect(() => {
    void refreshPendingPullCount();

    const intervalId = globalThis.setInterval(() => {
      void refreshPendingPullCount();
    }, 30000);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [refreshPendingPullCount]);

  const snapshot: ActivitySnapshot = {
    activeView,
    sidebarVisible,
    tabs,
    activeTabId,
  };

  const executeActivityClick = (activityId: ActivityId) => {
    runActivityClick(snapshot, activityId, {
      toggleSidebar,
      setActiveView,
    });
  };

  const getTitle = (activityId: ActivityId) => `${t(getActivityConfig(activityId).labelKey)} ${t('activity.toggleHint')}`;

  return (
    <div className="activity-bar">
      <div className="activity-bar-top">
        <button
          className={`activity-bar-item ${isActivityActive(snapshot, 'posts') ? 'active' : ''}`}
          onClick={() => executeActivityClick('posts')}
          title={getTitle('posts')}
        >
          <PostsIcon />
        </button>
        <button
          className={`activity-bar-item ${isActivityActive(snapshot, 'pages') ? 'active' : ''}`}
          onClick={() => executeActivityClick('pages')}
          title={getTitle('pages')}
        >
          <PagesIcon />
        </button>
        <button
          className={`activity-bar-item ${isActivityActive(snapshot, 'media') ? 'active' : ''}`}
          onClick={() => executeActivityClick('media')}
          title={getTitle('media')}
        >
          <MediaIcon />
        </button>
        <button
          className={`activity-bar-item ${isActivityActive(snapshot, 'scripts') ? 'active' : ''}`}
          onClick={() => executeActivityClick('scripts')}
          title={getTitle('scripts')}
        >
          <ScriptsIcon />
        </button>
        <button
          className={`activity-bar-item ${isActivityActive(snapshot, 'tags') ? 'active' : ''}`}
          onClick={() => executeActivityClick('tags')}
          title={getTitle('tags')}
        >
          <TagsIcon />
        </button>
        <button
          className={`activity-bar-item ${isActivityActive(snapshot, 'chat') ? 'active' : ''}`}
          onClick={() => executeActivityClick('chat')}
          title={getTitle('chat')}
        >
          <ChatIcon />
        </button>
        <button
          className={`activity-bar-item ${isActivityActive(snapshot, 'import') ? 'active' : ''}`}
          onClick={() => executeActivityClick('import')}
          title={getTitle('import')}
        >
          <ImportIcon />
        </button>
      </div>
      
      <div className="activity-bar-bottom">
        <button
          className={`activity-bar-item ${isActivityActive(snapshot, 'git') ? 'active' : ''}`}
          onClick={() => executeActivityClick('git')}
          title={getTitle('git')}
        >
          <GitIcon />
          {pendingPullCount > 0 ? <span className="activity-bar-badge">{pendingPullCount > 99 ? '99+' : pendingPullCount}</span> : null}
        </button>
        <button
          className={`activity-bar-item ${isActivityActive(snapshot, 'settings') ? 'active' : ''}`}
          onClick={() => executeActivityClick('settings')}
          title={getTitle('settings')}
        >
          <SettingsIcon />
        </button>
      </div>
    </div>
  );
};
