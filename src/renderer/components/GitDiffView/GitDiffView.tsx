import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../store';
import './GitDiffView.css';

interface GitDiffViewProps {
  filePath: string;
}

export const GitDiffView: React.FC<GitDiffViewProps> = ({ filePath }) => {
  const { activeProject } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patch, setPatch] = useState('');

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

        const diff = await window.electronAPI.git.getDiff(projectPath, filePath);
        setPatch(diff.patch || '');
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
      {patch ? <pre className="git-diff-patch">{patch}</pre> : <div className="git-diff-message">No diff available.</div>}
    </div>
  );
};
