import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import { useI18n } from '../../i18n';
import type { GitInitProgress, GitHistoryEntry, GitRemoteStateDto } from '../../../main/shared/electronApi';
import './GitSidebar.css';
import '../Sidebar/Sidebar.css';

type GitSidebarStatusFile = { path: string; status: string };

const mergeStatusFilesIncremental = (
  previous: GitSidebarStatusFile[],
  next: GitSidebarStatusFile[],
): GitSidebarStatusFile[] => {
  const previousByPath = new Map(previous.map((entry) => [entry.path, entry]));

  return next.map((entry) => {
    const existing = previousByPath.get(entry.path);
    if (!existing) {
      return entry;
    }

    if (existing.status === entry.status) {
      return existing;
    }

    return entry;
  });
};

export const GitSidebar: React.FC = () => {
  const { t: tr } = useI18n();
  const { activeProject, openTab, tabs, closeTab } = useAppStore();
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'fetch' | 'pull' | 'push' | 'prune-lfs' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorGuidance, setErrorGuidance] = useState<string[]>([]);
  const [isRepo, setIsRepo] = useState(false);
  const [hasRemote, setHasRemote] = useState(false);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [statusFiles, setStatusFiles] = useState<Array<{ path: string; status: string }>>([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<GitHistoryEntry[]>([]);
  const [remoteState, setRemoteState] = useState<GitRemoteStateDto | null>(null);
  const [remoteStateError, setRemoteStateError] = useState<string | null>(null);
  const [initProgress, setInitProgress] = useState<GitInitProgress | null>(null);
  const [initTranscript, setInitTranscript] = useState<GitInitProgress[]>([]);
  const [isTranscriptExpanded, setIsTranscriptExpanded] = useState(false);
  const remoteUrlInputRef = useRef<HTMLInputElement | null>(null);
  const commitMessageInputRef = useRef<HTMLInputElement | null>(null);
  const statusRefreshInFlightRef = useRef(false);
  const remoteRefreshInFlightRef = useRef(false);

  const refreshRepoDetails = useCallback(
    async (targetProjectPath: string, options?: { background?: boolean }) => {
      if (statusRefreshInFlightRef.current) {
        return;
      }

      const background = options?.background ?? false;

      statusRefreshInFlightRef.current = true;
      if (!background) {
        setStatusLoading(true);
        setHistoryLoading(true);
      }

      try {
        const [status, history] = await Promise.all([
          window.electronAPI.git.getStatus(targetProjectPath),
          window.electronAPI.git.getHistory(targetProjectPath, 20),
        ]);
        setStatusFiles((previous) => mergeStatusFilesIncremental(previous, status.files));
        setHistoryEntries(history);
      } finally {
        statusRefreshInFlightRef.current = false;
        if (!background) {
          setStatusLoading(false);
          setHistoryLoading(false);
        }
      }
    },
    [],
  );

  const refreshRemoteState = useCallback(
    async (targetProjectPath: string, options?: { background?: boolean; fetchFirst?: boolean }) => {
      if (remoteRefreshInFlightRef.current) {
        return;
      }

      const background = options?.background ?? false;
      const fetchFirst = options?.fetchFirst ?? false;

      remoteRefreshInFlightRef.current = true;
      try {
        if (fetchFirst) {
          const fetchResult = await window.electronAPI.git.fetch(targetProjectPath);
          if (!fetchResult.success) {
              const message = fetchResult.error || tr('gitSidebar.error.fetchRemoteUpdates');
            setRemoteStateError(message);
            if (!background) {
              setError(message);
            }
            return;
          }
        }

        const nextRemoteState = await window.electronAPI.git.getRemoteState(targetProjectPath);
        setRemoteState(nextRemoteState);
        setRemoteStateError(null);
      } catch {
        const message = tr('gitSidebar.error.refreshRemoteState');
        setRemoteStateError(message);
        if (!background) {
          setError(message);
        }
      } finally {
        remoteRefreshInFlightRef.current = false;
      }
    },
    [tr],
  );

  const getDiffTabId = (filePath: string): string => `git-diff:${filePath}`;
  const getCommitDiffTabId = (commitHash: string): string => `git-diff:commit:${commitHash}`;

  const getActionProgressMessage = (action: 'fetch' | 'pull' | 'push' | 'prune-lfs' | 'commit'): string => {
    if (action === 'push') {
      return tr('gitSidebar.progress.pushingRemote');
    }
    if (action === 'fetch') {
      return tr('gitSidebar.progress.fetching');
    }
    if (action === 'pull') {
      return tr('gitSidebar.progress.pulling');
    }
    if (action === 'prune-lfs') {
      return tr('gitSidebar.progress.pruningLfs');
    }
    return tr('gitSidebar.progress.committing');
  };

  const getHistoryStatusLabel = (status: GitHistoryEntry['syncStatus']): string => {
    if (status === 'local-only') {
      return tr('gitSidebar.history.localOnly');
    }
    if (status === 'remote-only') {
      return tr('gitSidebar.history.remoteOnly');
    }
    return tr('gitSidebar.history.synced');
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
        setError(tr('gitSidebar.error.gitMissing'));
        setIsRepo(false);
        return;
      }

      const resolvedProjectPath = await resolveProjectPath();
      setProjectPath(resolvedProjectPath);

      if (!resolvedProjectPath) {
        setError(tr('gitSidebar.error.noActiveProject'));
        setIsRepo(false);
        return;
      }

      const repoState = await window.electronAPI.git.getRepoState(resolvedProjectPath);
      setIsRepo(repoState.isRepo);
      setHasRemote(repoState.hasRemote);
      setCurrentBranch(repoState.currentBranch || null);

      if (repoState.isRepo) {
        await refreshRepoDetails(resolvedProjectPath);
        if (repoState.hasRemote) {
          await refreshRemoteState(resolvedProjectPath);
        } else {
          setRemoteState(null);
          setRemoteStateError(null);
        }
      } else {
        setStatusFiles([]);
        setHistoryEntries([]);
        setRemoteState(null);
        setRemoteStateError(null);
      }
    } catch {
      setError(tr('gitSidebar.error.loadRepoStatus'));
      setIsRepo(false);
      setHasRemote(false);
      setStatusFiles([]);
      setHistoryEntries([]);
      setRemoteState(null);
      setRemoteStateError(null);
    } finally {
      setLoading(false);
    }
  }, [refreshRemoteState, refreshRepoDetails, resolveProjectPath, tr]);

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

  useEffect(() => {
    if (!isRepo || !projectPath) {
      return;
    }

    const intervalId = globalThis.setInterval(() => {
      void refreshRepoDetails(projectPath, { background: true });
    }, 2000);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [isRepo, projectPath, refreshRepoDetails]);

  useEffect(() => {
    if (!isRepo || !hasRemote || !projectPath) {
      return;
    }

    const intervalId = globalThis.setInterval(() => {
      void refreshRemoteState(projectPath, { background: true, fetchFirst: true });
    }, 30000);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [hasRemote, isRepo, projectPath, refreshRemoteState]);

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
      message: tr('gitSidebar.progress.preparingInit'),
    });

    try {
      const normalizedRemoteUrl = remoteUrlInputRef.current?.value.trim() || '';
      const result = normalizedRemoteUrl
        ? await window.electronAPI.git.init(projectPath, normalizedRemoteUrl)
        : await window.electronAPI.git.init(projectPath);
      if (!result.success) {
        setError(result.error || tr('gitSidebar.error.initFailed'));
        return;
      }

      await loadRepoState();
    } catch {
      setError(tr('gitSidebar.error.initFailed'));
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
      setError(tr('gitSidebar.error.noActiveProject'));
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
        setError(result.error || tr('gitSidebar.error.actionFailed', { action }));
        setErrorGuidance('guidance' in result ? result.guidance || [] : []);
        return;
      }
      await loadRepoState();
    } catch {
      setError(tr('gitSidebar.error.actionFailed', { action }));
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
      setError(tr('gitSidebar.error.noActiveProject'));
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
        setError(result.error || tr('gitSidebar.error.commitFailed'));
        setErrorGuidance(result.guidance || []);
        return;
      }

      tabs
        .filter((tab) => tab.type === 'git-diff')
        .forEach((tab) => closeTab(tab.id));

      setCommitMessage('');
      await loadRepoState();
    } catch {
      setError(tr('gitSidebar.error.commitFailed'));
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="git-sidebar">
        <div className="git-sidebar-header">{tr('gitSidebar.header')}</div>
        <div className="git-sidebar-empty">{tr('gitSidebar.loading')}</div>
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
        {tr('gitSidebar.init.transcript')}
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
        <div className="git-sidebar-header">{tr('gitSidebar.header')}</div>
        <div className="git-sidebar-content">
          <div className="git-sidebar-actions" role="group" aria-label={tr('gitSidebar.aria.repoActions')}>
            <button
              type="button"
              className="git-sidebar-button"
              onClick={() => handleRepoAction('fetch')}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'fetch' ? tr('gitSidebar.action.fetching') : tr('gitSidebar.action.fetch')}
            </button>
            <button
              type="button"
              className="git-sidebar-button"
              onClick={() => handleRepoAction('pull')}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'pull' ? tr('gitSidebar.action.pulling') : tr('gitSidebar.action.pull')}
            </button>
            <button
              type="button"
              className="git-sidebar-button"
              onClick={() => handleRepoAction('push')}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'push' ? tr('gitSidebar.action.pushing') : tr('gitSidebar.action.push')}
            </button>
            <button
              type="button"
              className="git-sidebar-button"
              onClick={() => handleRepoAction('prune-lfs')}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'prune-lfs' ? tr('gitSidebar.action.pruning') : tr('gitSidebar.action.pruneLfs')}
            </button>
          </div>
          {actionLoading && (
            <div className="git-sidebar-empty-state git-sidebar-progress" role="status">
              {getActionProgressMessage(actionLoading)}
            </div>
          )}

          <div className="git-sidebar-section">
            <div className="sidebar-section-title">{tr('gitSidebar.openChanges', { count: statusFiles.length })}</div>

            <div className="git-sidebar-commit-row">
              <input
                ref={commitMessageInputRef}
                className="git-sidebar-input"
                type="text"
                placeholder={tr('gitSidebar.placeholder.commitMessage')}
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
                {actionLoading === 'commit' ? tr('gitSidebar.action.committing') : tr('gitSidebar.action.commit')}
              </button>
            </div>

            {statusLoading ? (
              <div className="git-sidebar-empty-state">{tr('gitSidebar.loadingChanges')}</div>
            ) : statusFiles.length === 0 ? (
              <div className="git-sidebar-empty-state">{tr('gitSidebar.noChanges')}</div>
            ) : (
              <div className="git-sidebar-file-list" role="list" aria-label={tr('gitSidebar.aria.openChanges')}>
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
            <div className="sidebar-section-title">{tr('gitSidebar.versionHistory', { count: historyEntries.length })}</div>
            <div className="git-sidebar-history-legend" aria-label={tr('gitSidebar.aria.commitStatusLegend')}>
              <span className="git-sidebar-history-legend-item">
                <span
                  className="git-sidebar-history-legend-dot git-sidebar-history-legend-dot--both"
                  data-testid="git-history-legend-both"
                />
                {tr('gitSidebar.history.synced')}
              </span>
              <span className="git-sidebar-history-legend-item">
                <span
                  className="git-sidebar-history-legend-dot git-sidebar-history-legend-dot--local-only"
                  data-testid="git-history-legend-local-only"
                />
                {tr('gitSidebar.history.localOnly')}
              </span>
              <span className="git-sidebar-history-legend-item">
                <span
                  className="git-sidebar-history-legend-dot git-sidebar-history-legend-dot--remote-only"
                  data-testid="git-history-legend-remote-only"
                />
                {tr('gitSidebar.history.remoteOnly')}
              </span>
            </div>
            {historyLoading ? (
              <div className="git-sidebar-empty-state">{tr('gitSidebar.loadingHistory')}</div>
            ) : historyEntries.length === 0 ? (
              <div className="git-sidebar-empty-state">{tr('gitSidebar.noCommits')}</div>
            ) : (
              <div className="git-sidebar-history-list" role="list" aria-label={tr('gitSidebar.aria.versionHistory')}>
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
            {currentBranch && <div className="git-sidebar-empty-state">{tr('gitSidebar.branch', { branch: currentBranch })}</div>}
            {remoteState?.hasUpstream && remoteState.localBranch && remoteState.upstreamBranch && (
              <div className="git-sidebar-empty-state">{remoteState.localBranch} → {remoteState.upstreamBranch}</div>
            )}
            {remoteState?.hasUpstream && (
              <div className="git-sidebar-empty-state">{tr('gitSidebar.aheadBehind', { ahead: remoteState.ahead, behind: remoteState.behind })}</div>
            )}
            {remoteStateError && <div className="git-sidebar-empty-state git-sidebar-error">{remoteStateError}</div>}
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
      <div className="git-sidebar-header">{tr('gitSidebar.header')}</div>
      <div className="git-sidebar-empty">
        <div className="git-sidebar-main">
          <p>{tr('gitSidebar.notRepo')}</p>
          <input
            ref={remoteUrlInputRef}
            className="git-sidebar-input"
            type="text"
            placeholder={tr('gitSidebar.placeholder.remoteUrl')}
            disabled={initializing}
          />
          {initializing && (
            <p className="git-sidebar-progress">
              {initProgress?.message || tr('gitSidebar.progress.initializingRepo')}
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
            {initializing ? tr('gitSidebar.action.initializing') : tr('gitSidebar.action.initializeGit')}
          </button>
        </div>
        {transcriptSection}
      </div>
    </div>
  );
};
