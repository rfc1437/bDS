import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import './GitSidebar.css';

export const GitSidebar: React.FC = () => {
  const { activeProject } = useAppStore();
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRepo, setIsRepo] = useState(false);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const remoteUrlInputRef = useRef<HTMLInputElement | null>(null);

  const resolveProjectPath = useCallback(async (): Promise<string | null> => {
    if (!activeProject) {
      return null;
    }

    if (activeProject.dataPath) {
      return activeProject.dataPath;
    }

    return window.electronAPI.app.getDefaultProjectPath(activeProject.id);
  }, [activeProject]);

  const loadRepoState = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const availability = await window.electronAPI.git.checkAvailability();
      if (!availability.gitFound) {
        setError('Git executable not found. Please install Git and restart the app.');
        setIsRepo(false);
        return;
      }

      const resolvedProjectPath = await resolveProjectPath();
      setProjectPath(resolvedProjectPath);

      if (!resolvedProjectPath) {
        setError('No active project selected.');
        setIsRepo(false);
        return;
      }

      const repoState = await window.electronAPI.git.getRepoState(resolvedProjectPath);
      setIsRepo(repoState.isRepo);
      setCurrentBranch(repoState.currentBranch || null);
    } catch {
      setError('Unable to load repository status.');
      setIsRepo(false);
    } finally {
      setLoading(false);
    }
  }, [resolveProjectPath]);

  useEffect(() => {
    void loadRepoState();
  }, [loadRepoState]);

  const handleInitialize = async () => {
    if (!projectPath) {
      return;
    }

    setInitializing(true);
    setError(null);

    try {
      const normalizedRemoteUrl = remoteUrlInputRef.current?.value.trim() || '';
      const result = normalizedRemoteUrl
        ? await window.electronAPI.git.init(projectPath, normalizedRemoteUrl)
        : await window.electronAPI.git.init(projectPath);
      if (!result.success) {
        setError(result.error || 'Failed to initialize git repository.');
        return;
      }

      await loadRepoState();
    } catch {
      setError('Failed to initialize git repository.');
    } finally {
      setInitializing(false);
    }
  };

  if (loading) {
    return (
      <div className="git-sidebar">
        <div className="git-sidebar-header">SOURCE CONTROL</div>
        <div className="git-sidebar-empty">Loading...</div>
      </div>
    );
  }

  if (isRepo) {
    return (
      <div className="git-sidebar">
        <div className="git-sidebar-header">SOURCE CONTROL</div>
        <div className="git-sidebar-empty">
          <p>Git repository ready</p>
          {currentBranch && <p>Branch: {currentBranch}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="git-sidebar">
      <div className="git-sidebar-header">SOURCE CONTROL</div>
      <div className="git-sidebar-empty">
        <p>This project is not a git repository.</p>
        <input
          ref={remoteUrlInputRef}
          className="git-sidebar-input"
          type="text"
          placeholder="Optional remote repository URL"
          disabled={initializing}
        />
        {error && <p className="git-sidebar-error">{error}</p>}
        <button
          className="git-sidebar-button"
          onClick={handleInitialize}
          disabled={initializing || !projectPath}
        >
          {initializing ? 'Initializing...' : 'Initialize Git'}
        </button>
      </div>
    </div>
  );
};
