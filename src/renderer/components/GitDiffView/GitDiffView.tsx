import React, { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { useAppStore } from '../../store';
import './GitDiffView.css';

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

export const GitDiffView: React.FC<GitDiffViewProps> = ({ filePath }) => {
  const { activeProject } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [original, setOriginal] = useState('');
  const [modified, setModified] = useState('');

  useEffect(() => {
    const loadDiff = async () => {
      setLoading(true);
      setError(null);

      try {
        if (!activeProject) {
          setError('No active project selected.');
          return;
        }

        const projectPath = activeProject.dataPath
          ? activeProject.dataPath
          : await window.electronAPI.app.getDefaultProjectPath(activeProject.id);

        if (!projectPath) {
          setError('Unable to resolve project path.');
          return;
        }

        const diff = await window.electronAPI.git.getDiffContent(projectPath, filePath);
        setOriginal(diff.original || '');
        setModified(diff.modified || '');
      } catch {
        setError('Failed to load diff.');
      } finally {
        setLoading(false);
      }
    };

    void loadDiff();
  }, [activeProject, filePath]);

  if (loading) {
    return (
      <div className="git-diff-view">
        <div className="git-diff-header">Diff: {filePath}</div>
        <div className="git-diff-message">Loading diff...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="git-diff-view">
        <div className="git-diff-header">Diff: {filePath}</div>
        <div className="git-diff-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="git-diff-view">
      <div className="git-diff-header">Diff: {filePath}</div>
      <div className="git-diff-editor-wrap">
        <DiffEditor
          original={original}
          modified={modified}
          language={detectLanguage(filePath)}
          theme="vs-dark"
          height="100%"
          options={{
            readOnly: true,
            renderSideBySide: false,
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            renderOverviewRuler: true,
            originalEditable: false,
            diffCodeLens: false,
            wordWrap: 'off',
            ignoreTrimWhitespace: false,
          }}
        />
      </div>
    </div>
  );
};
