import React from 'react';
import { useAppStore } from '../../store';
import './StatusBar.css';

export const StatusBar: React.FC = () => {
  const { 
    syncStatus, 
    syncConfigured, 
    pendingChanges, 
    posts, 
    media,
    tasks,
    selectedPostId,
  } = useAppStore();

  const runningTasks = tasks.filter(t => t.status === 'running');
  const totalPending = pendingChanges.posts + pendingChanges.media;
  const selectedPost = posts.find(p => p.id === selectedPostId);

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {/* Sync Status */}
        <div className={`status-bar-item ${!syncConfigured ? 'warning' : ''}`}>
          <span className={`sync-indicator ${syncStatus}`} />
          {!syncConfigured ? (
            <span>Sync not configured</span>
          ) : syncStatus === 'syncing' ? (
            <span>Syncing...</span>
          ) : totalPending > 0 ? (
            <span>{totalPending} pending</span>
          ) : (
            <span>Synced</span>
          )}
        </div>

        {/* Running Tasks */}
        {runningTasks.length > 0 && (
          <div className="status-bar-item">
            <span className="task-spinner" />
            <span>{runningTasks[0].message}</span>
            {runningTasks.length > 1 && (
              <span className="text-muted">+{runningTasks.length - 1} more</span>
            )}
          </div>
        )}
      </div>

      <div className="status-bar-right">
        {/* Current Post Info */}
        {selectedPost && (
          <div className="status-bar-item">
            <span className={`status-dot status-${selectedPost.status}`} />
            <span>{selectedPost.status}</span>
          </div>
        )}

        {/* Stats */}
        <div className="status-bar-item">
          <span>{posts.length} posts</span>
        </div>
        <div className="status-bar-item">
          <span>{media.length} media</span>
        </div>

        {/* App Name */}
        <div className="status-bar-item brand">
          <span>bDS</span>
        </div>
      </div>
    </div>
  );
};
