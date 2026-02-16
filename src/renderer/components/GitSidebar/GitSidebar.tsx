import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import type { GitInitProgress, GitHistoryEntry } from '../../../main/shared/electronApi';
import './GitSidebar.css';
import '../Sidebar/Sidebar.css';

export const GitSidebar: React.FC = () => {
  const { activeProject, openTab, tabs, closeTab } = useAppStore();
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'fetch' | 'pull' | 'push' | 'prune-lfs' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorGuidance, setErrorGuidance] = useState<string[]>([]);
  const [isRepo, setIsRepo] = useState(false);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [statusFiles, setStatusFiles] = useState<Array<{ path: string; status: string }>>([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<GitHistoryEntry[]>([]);
  const [initProgress, setInitProgress] = useState<GitInitProgress | null>(null);
  const [initTranscript, setInitTranscript] = useState<GitInitProgress[]>([]);
  const [isTranscriptExpanded, setIsTranscriptExpanded] = useState(false);
  const remoteUrlInputRef = useRef<HTMLInputElement | null>(null);
  const commitMessageInputRef = useRef<HTMLInputElement | null>(null);

  const getDiffTabId = (filePath: string): string => `git-diff:${filePath}`;
  const getCommitDiffTabId = (commitHash: string): string => `git-diff:commit:${commitHash}`;

  const getActionProgressMessage = (action: 'fetch' | 'pull' | 'push' | 'prune-lfs' | 'commit'): string => {
    if (action === 'push') {
      return 'Pushing commits to remote... this can take a while for large uploads.';
    }
    if (action === 'fetch') {
      return 'Fetching remote updates...';
    }
    if (action === 'pull') {
      return 'Pulling latest changes...';
    }
    if (action === 'prune-lfs') {
      return 'Pruning local Git LFS cache...';
    }
    return 'Creating commit...';
  };

  const getHistoryStatusLabel = (status: GitHistoryEntry['syncStatus']): string => {
    if (status === 'local-only') {
      return 'Local only';
    }
    if (status === 'remote-only') {
      return 'Remote only';
    }
    return 'Synced';
  };

  const openDiffTab = useCallback(
    (filePath: string, isTransient: boolean) => {
      openTab({
        type: 'git-diff',
        id: getDiffTabId(filePath),
        isTransient,
      });
    },
    [openTab],
  );

  const openCommitDiffTab = useCallback(
    (commitHash: string, isTransient: boolean) => {
      openTab({
        type: 'git-diff',
        id: getCommitDiffTabId(commitHash),
        isTransient,
      });
    },
    [openTab],
  );

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
    setErrorGuidance([]);

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

      if (repoState.isRepo) {
        setStatusLoading(true);
        setHistoryLoading(true);
        try {
          const [status, history] = await Promise.all([
            window.electronAPI.git.getStatus(resolvedProjectPath),
            window.electronAPI.git.getHistory(resolvedProjectPath, 20),
          ]);
          setStatusFiles(status.files);
          setHistoryEntries(history);
        } finally {
          setStatusLoading(false);
          setHistoryLoading(false);
        }
      } else {
        setStatusFiles([]);
        setHistoryEntries([]);
      }
    } catch {
      setError('Unable to load repository status.');
      setIsRepo(false);
      setStatusFiles([]);
      setHistoryEntries([]);
    } finally {
      setLoading(false);
    }
  }, [resolveProjectPath]);

  useEffect(() => {
    void loadRepoState();
  }, [loadRepoState]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.git.onInitProgress((progress) => {
      setInitProgress(progress);
      setInitTranscript((previous) => [...previous, progress].slice(-12));
      if (progress.phase === 'failed') {
        setIsTranscriptExpanded(true);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleInitialize = async () => {
    if (!projectPath) {
      return;
    }

    setInitializing(true);
    setError(null);
    setInitTranscript([]);
    setInitProgress({
      phase: 'initializing-repo',
      progress: 0,
      message: 'Preparing repository initialization...',
    });

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

  const handleRepoAction = async (action: 'fetch' | 'pull' | 'push' | 'prune-lfs') => {
    if (actionLoading) {
      return;
    }

    const effectiveProjectPath = projectPath ?? (await resolveProjectPath());
    if (!effectiveProjectPath) {
      setError('No active project selected.');
      return;
    }
    if (!projectPath) {
      setProjectPath(effectiveProjectPath);
    }

    setActionLoading(action);
    setError(null);
    setErrorGuidance([]);
    try {
      const result =
        action === 'fetch'
          ? await window.electronAPI.git.fetch(effectiveProjectPath)
          : action === 'pull'
            ? await window.electronAPI.git.pull(effectiveProjectPath)
            : action === 'push'
              ? await window.electronAPI.git.push(effectiveProjectPath)
              : await window.electronAPI.git.pruneLfs(effectiveProjectPath, {
                  dryRun: false,
                  verifyRemote: true,
                  recentCommitsToKeep: 2,
                });
      if (!result.success) {
        setError(result.error || `Failed to ${action}.`);
        setErrorGuidance('guidance' in result ? result.guidance || [] : []);
        return;
      }
      await loadRepoState();
    } catch {
      setError(`Failed to ${action}.`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCommit = async () => {
    if (actionLoading) {
      return;
    }

    const effectiveProjectPath = projectPath ?? (await resolveProjectPath());
    if (!effectiveProjectPath) {
      setError('No active project selected.');
      return;
    }
    if (!projectPath) {
      setProjectPath(effectiveProjectPath);
    }

    setActionLoading('commit');
    setError(null);
    setErrorGuidance([]);
    try {
      const messageToCommit = commitMessageInputRef.current?.value ?? commitMessage;
      const result = await window.electronAPI.git.commitAll(effectiveProjectPath, messageToCommit);
      if (!result.success) {
        setError(result.error || 'Failed to commit changes.');
        setErrorGuidance(result.guidance || []);
        return;
      }

      tabs
        .filter((tab) => tab.type === 'git-diff')
        .forEach((tab) => closeTab(tab.id));

      setCommitMessage('');
      await loadRepoState();
    } catch {
      setError('Failed to commit changes.');
    } finally {
      setActionLoading(null);
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

  const transcriptSection = initTranscript.length > 0 ? (
    <div className="git-sidebar-transcript">
      <button
        type="button"
        className="git-sidebar-transcript-toggle"
        onClick={() => setIsTranscriptExpanded((previous) => !previous)}
        aria-expanded={isTranscriptExpanded}
      >
        Initialization transcript
      </button>
      {isTranscriptExpanded && (
        <ul className="git-sidebar-transcript-list">
          {initTranscript.map((entry, index) => (
            <li key={`${entry.phase}-${entry.progress}-${index}`}>
              {entry.progress}% — {entry.message.toLowerCase().replace(/\.+$/, '')}
              {entry.detail ? ` (${entry.detail})` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null;

  if (isRepo) {
    return (
      <div className="git-sidebar">
        <div className="git-sidebar-header">SOURCE CONTROL</div>
        <div className="git-sidebar-content">
          <div className="git-sidebar-actions" role="group" aria-label="Repository actions">
            <button
              type="button"
              className="git-sidebar-button"
              onClick={() => handleRepoAction('fetch')}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'fetch' ? 'Fetching...' : 'Fetch'}
            </button>
            <button
              type="button"
              className="git-sidebar-button"
              onClick={() => handleRepoAction('pull')}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'pull' ? 'Pulling...' : 'Pull'}
            </button>
            <button
              type="button"
              className="git-sidebar-button"
              onClick={() => handleRepoAction('push')}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'push' ? 'Pushing...' : 'Push'}
            </button>
            <button
              type="button"
              className="git-sidebar-button"
              onClick={() => handleRepoAction('prune-lfs')}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'prune-lfs' ? 'Pruning...' : 'Prune LFS'}
            </button>
          </div>
          {actionLoading && (
            <div className="git-sidebar-empty-state git-sidebar-progress" role="status">
              {getActionProgressMessage(actionLoading)}
            </div>
          )}

          <div className="git-sidebar-section">
            <div className="sidebar-section-title">Open Changes ({statusFiles.length})</div>

            <div className="git-sidebar-commit-row">
              <input
                ref={commitMessageInputRef}
                className="git-sidebar-input"
                type="text"
                placeholder="Commit message"
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                disabled={actionLoading !== null}
              />
              <button
                type="button"
                className="git-sidebar-button"
                onClick={handleCommit}
                disabled={actionLoading !== null}
              >
                {actionLoading === 'commit' ? 'Committing...' : 'Commit'}
              </button>
            </div>

            {statusLoading ? (
              <div className="git-sidebar-empty-state">Loading changes...</div>
            ) : statusFiles.length === 0 ? (
              <div className="git-sidebar-empty-state">No changes</div>
            ) : (
              <div className="git-sidebar-file-list" role="list" aria-label="Open Changes">
                {statusFiles.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    className="git-sidebar-file-item"
                    onClick={() => openDiffTab(file.path, true)}
                    onDoubleClick={() => openDiffTab(file.path, false)}
                    title={`${file.status}: ${file.path}`}
                  >
                    <span className="git-sidebar-file-path">{file.path}</span>
                    <span className="git-sidebar-file-status">{file.status}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="git-sidebar-section git-sidebar-history">
            <div className="sidebar-section-title">Version History ({historyEntries.length})</div>
            <div className="git-sidebar-history-legend" aria-label="Commit status legend">
              <span className="git-sidebar-history-legend-item">
                <span
                  className="git-sidebar-history-legend-dot git-sidebar-history-legend-dot--both"
                  data-testid="git-history-legend-both"
                />
                Synced
              </span>
              <span className="git-sidebar-history-legend-item">
                <span
                  className="git-sidebar-history-legend-dot git-sidebar-history-legend-dot--local-only"
                  data-testid="git-history-legend-local-only"
                />
                Local only
              </span>
              <span className="git-sidebar-history-legend-item">
                <span
                  className="git-sidebar-history-legend-dot git-sidebar-history-legend-dot--remote-only"
                  data-testid="git-history-legend-remote-only"
                />
                Remote only
              </span>
            </div>
            {historyLoading ? (
              <div className="git-sidebar-empty-state">Loading history...</div>
            ) : historyEntries.length === 0 ? (
              <div className="git-sidebar-empty-state">No commits yet</div>
            ) : (
              <div className="git-sidebar-history-list" role="list" aria-label="Version History">
                {historyEntries.map((entry) => (
                  <button
                    key={entry.hash}
                    type="button"
                    className={`git-sidebar-history-item git-sidebar-history-item--${entry.syncStatus ?? 'both'}`}
                    onClick={() => openCommitDiffTab(entry.hash, true)}
                    onDoubleClick={() => openCommitDiffTab(entry.hash, false)}
                    title={`${entry.shortHash}: ${entry.subject}`}
                  >
                    <div className="git-sidebar-history-subject">{entry.subject}</div>
                    <div className="git-sidebar-history-meta">
                      <span>{entry.shortHash}</span>
                      <span>{entry.author}</span>
                      <span>{new Date(entry.date).toLocaleDateString()}</span>
                      <span className={`git-sidebar-history-status git-sidebar-history-status--${entry.syncStatus ?? 'both'}`}>
                        {getHistoryStatusLabel(entry.syncStatus)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {currentBranch && <div className="git-sidebar-empty-state">Branch: {currentBranch}</div>}
          </div>
          {error && (
            <div className="git-sidebar-empty-state git-sidebar-error">
              <div>{error}</div>
              {errorGuidance.length > 0 && (
                <ul className="git-sidebar-guidance-list">
                  {errorGuidance.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {transcriptSection}
        </div>
      </div>
    );
  }

  return (
    <div className="git-sidebar">
      <div className="git-sidebar-header">SOURCE CONTROL</div>
      <div className="git-sidebar-empty">
        <div className="git-sidebar-main">
          <p>This project is not a git repository.</p>
          <input
            ref={remoteUrlInputRef}
            className="git-sidebar-input"
            type="text"
            placeholder="Optional remote repository URL"
            disabled={initializing}
          />
          {initializing && (
            <p className="git-sidebar-progress">
              {initProgress?.message || 'Initializing repository...'}
              {typeof initProgress?.progress === 'number' ? ` (${initProgress.progress}%)` : ''}
              {initProgress?.detail ? ` — ${initProgress.detail}` : ''}
            </p>
          )}
          {error && <p className="git-sidebar-error">{error}</p>}
          <button
            className="git-sidebar-button"
            onClick={handleInitialize}
            disabled={initializing || !projectPath}
          >
            {initializing ? 'Initializing...' : 'Initialize Git'}
          </button>
        </div>
        {transcriptSection}
      </div>
    </div>
  );
};
