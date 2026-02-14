import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store';
import { ProjectSelector } from '../ProjectSelector';
import './StatusBar.css';

export const StatusBar: React.FC = () => {
  const {
    media,
    tasks,
    selectedPostId,
    totalPosts,
  } = useAppStore();

  const [selectedPostStatus, setSelectedPostStatus] = useState<string | null>(null);

  // Fetch selected post status from database
  useEffect(() => {
    if (!selectedPostId) {
      setSelectedPostStatus(null);
      return;
    }
    window.electronAPI?.posts.get(selectedPostId).then(post => {
      setSelectedPostStatus(post?.status || null);
    });
  }, [selectedPostId]);

  const runningTasks = tasks.filter(t => t.status === 'running');

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {/* Project Selector */}
        <ProjectSelector />

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
        {selectedPostStatus && (
          <div className="status-bar-item">
            <span className={`status-dot status-${selectedPostStatus}`} />
            <span>{selectedPostStatus}</span>
          </div>
        )}

        {/* Stats */}
        <div className="status-bar-item">
          <span>{totalPosts} posts</span>
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
