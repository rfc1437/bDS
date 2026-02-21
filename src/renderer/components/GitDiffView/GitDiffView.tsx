import React, { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { useAppStore } from '../../store';
import { useI18n } from '../../i18n';
import './GitDiffView.css';

interface CommitFileDiff {
  filePath: string;
  original: string;
  modified: string;
}

interface GitDiffViewProps {
  filePath: string;
}

function detectLanguage(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'typescript';
    case 'js':
      return 'javascript';
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'yml':
    case 'yaml':
      return 'yaml';
    default:
      return 'plaintext';
  }
}

function toModelPath(filePath: string, side: 'original' | 'modified', scope: string): string {
  const normalized = filePath.replace(/^\/+/, '');
  return `inmemory://model/git-diff/${scope}/${side}/${normalized}`;
}

export const GitDiffView: React.FC<GitDiffViewProps> = ({ filePath }) => {
  const { t: tr } = useI18n();
  const { activeProject, gitDiffPreferences } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [original, setOriginal] = useState('');
  const [modified, setModified] = useState('');
  const [commitFiles, setCommitFiles] = useState<CommitFileDiff[]>([]);
  const [selectedCommitFilePath, setSelectedCommitFilePath] = useState<string>('');
  const isCommitDiff = filePath.startsWith('commit:');
  const commitHash = isCommitDiff ? filePath.slice('commit:'.length) : '';
  const selectedCommitFile = commitFiles.find((entry) => entry.filePath === selectedCommitFilePath) ?? null;
  const selectedCommitFileIndex = selectedCommitFilePath
    ? commitFiles.findIndex((entry) => entry.filePath === selectedCommitFilePath)
    : -1;
  const canSelectPreviousFile = selectedCommitFileIndex > 0;
  const canSelectNextFile = selectedCommitFileIndex >= 0 && selectedCommitFileIndex < commitFiles.length - 1;
  const displayedOriginal = selectedCommitFile ? selectedCommitFile.original : original;
  const displayedModified = selectedCommitFile ? selectedCommitFile.modified : modified;
  const activeFilePath = selectedCommitFile ? selectedCommitFile.filePath : filePath;
  const modelScope = isCommitDiff ? `commit-${commitHash}` : 'working-tree';

  const selectPreviousCommitFile = () => {
    if (!canSelectPreviousFile) {
      return;
    }
    const previousFile = commitFiles[selectedCommitFileIndex - 1];
    if (previousFile) {
      setSelectedCommitFilePath(previousFile.filePath);
    }
  };

  const selectNextCommitFile = () => {
    if (!canSelectNextFile) {
      return;
    }
    const nextFile = commitFiles[selectedCommitFileIndex + 1];
    if (nextFile) {
      setSelectedCommitFilePath(nextFile.filePath);
    }
  };

  useEffect(() => {
    const loadDiff = async () => {
      setLoading(true);
      setError(null);

      try {
        if (!activeProject) {
          setError(tr('gitDiff.noProject'));
          return;
        }

        const projectPath = activeProject.dataPath
          ? activeProject.dataPath
          : await window.electronAPI.app.getDefaultProjectPath(activeProject.id);

        if (!projectPath) {
          setError(tr('gitDiff.noProjectPath'));
          return;
        }

        if (isCommitDiff) {
          const diff = await window.electronAPI.git.getCommitDiffContent(projectPath, commitHash);
          const files = diff.files || [];
          setCommitFiles(files);

          if (files.length > 0) {
            setSelectedCommitFilePath(files[0].filePath);
            setOriginal(files[0].original || '');
            setModified(files[0].modified || '');
          } else {
            setSelectedCommitFilePath('');
            setOriginal(diff.original || '');
            setModified(diff.modified || '');
          }
        } else {
          setCommitFiles([]);
          setSelectedCommitFilePath('');
          const diff = await window.electronAPI.git.getDiffContent(projectPath, filePath);
          setOriginal(diff.original || '');
          setModified(diff.modified || '');
        }
      } catch {
        setError(tr('gitDiff.loadFailed'));
      } finally {
        setLoading(false);
      }
    };

    void loadDiff();
  }, [activeProject, filePath, isCommitDiff, commitHash, tr]);

  const headerTarget = isCommitDiff ? `Commit ${commitHash}` : filePath;
  const headerLabel = tr('gitDiff.header', { target: headerTarget });

  if (loading) {
    return (
      <div className="git-diff-view">
        <div className="git-diff-header">{headerLabel}</div>
        <div className="git-diff-message">{tr('gitDiff.loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="git-diff-view">
        <div className="git-diff-header">{headerLabel}</div>
        <div className="git-diff-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="git-diff-view">
      <div className="git-diff-header">{headerLabel}</div>
      {isCommitDiff && commitFiles.length > 0 && (
        <div className="git-diff-commit-nav">
          <label htmlFor="git-diff-commit-files" className="git-diff-commit-label">
            {tr('gitDiff.changedFiles')}
          </label>
          <button
            type="button"
            className="git-diff-commit-button"
            onClick={selectPreviousCommitFile}
            disabled={!canSelectPreviousFile}
            aria-label={tr('gitDiff.previousFile')}
          >
            {tr('gitDiff.previousFile')}
          </button>
          <select
            id="git-diff-commit-files"
            className="git-diff-commit-select"
            value={selectedCommitFilePath}
            onChange={(event) => setSelectedCommitFilePath(event.target.value)}
            aria-label={tr('gitDiff.changedFiles')}
          >
            {commitFiles.map((entry) => (
              <option key={entry.filePath} value={entry.filePath}>
                {entry.filePath}
              </option>
            ))}
          </select>
            <button
              type="button"
              className="git-diff-commit-button"
              onClick={selectNextCommitFile}
              disabled={!canSelectNextFile}
              aria-label={tr('gitDiff.nextFile')}
            >
              {tr('gitDiff.nextFile')}
            </button>
        </div>
      )}
      <div className="git-diff-editor-wrap">
        <DiffEditor
          original={displayedOriginal}
          modified={displayedModified}
          originalModelPath={toModelPath(activeFilePath, 'original', modelScope)}
          modifiedModelPath={toModelPath(activeFilePath, 'modified', modelScope)}
          keepCurrentOriginalModel
          keepCurrentModifiedModel
          language={detectLanguage(activeFilePath)}
          theme="vs-dark"
          height="100%"
          options={{
            readOnly: true,
            renderSideBySide: gitDiffPreferences.viewStyle === 'side-by-side',
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            renderOverviewRuler: true,
            originalEditable: false,
            diffCodeLens: false,
            wordWrap: gitDiffPreferences.wordWrap ? 'on' : 'off',
            hideUnchangedRegions: {
              enabled: gitDiffPreferences.hideUnchangedRegions,
            },
            ignoreTrimWhitespace: false,
          }}
        />
      </div>
    </div>
  );
};
