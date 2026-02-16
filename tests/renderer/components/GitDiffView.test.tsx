import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GitDiffView } from '../../../src/renderer/components/GitDiffView/GitDiffView';
import { useAppStore } from '../../../src/renderer/store';

vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: (_props: unknown) => null,
  DiffEditor: (props: {
    original: string;
    modified: string;
    language?: string;
    options?: Record<string, unknown>;
    keepCurrentOriginalModel?: boolean;
    keepCurrentModifiedModel?: boolean;
  }) => (
    <div data-testid="monaco-diff-editor">
      <div>original:{props.original}</div>
      <div>modified:{props.modified}</div>
      <div>language:{props.language}</div>
      <div>renderSideBySide:{String(props.options?.renderSideBySide)}</div>
      <div>wordWrap:{String(props.options?.wordWrap)}</div>
      <div>hideUnchanged:{String((props.options?.hideUnchangedRegions as { enabled?: boolean } | undefined)?.enabled)}</div>
      <div>keepOriginal:{String(props.keepCurrentOriginalModel)}</div>
      <div>keepModified:{String(props.keepCurrentModifiedModel)}</div>
    </div>
  ),
}));

describe('GitDiffView', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useAppStore.setState({
      activeProject: {
        id: 'project-1',
        name: 'Test Project',
        slug: 'test-project',
        isActive: true,
        dataPath: '/repo/path',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      gitDiffPreferences: {
        wordWrap: true,
        viewStyle: 'inline',
        hideUnchangedRegions: false,
      },
    });

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      git: {
        ...(window as any).electronAPI?.git,
        getDiffContent: vi.fn().mockResolvedValue({
          filePath: 'posts/first.md',
          original: '# old line',
          modified: '# new line',
        }),
        getCommitDiffContent: vi.fn().mockResolvedValue({
          commitHash: 'abc123def456',
          original: '--- posts/first.md\nold',
          modified: '--- posts/first.md\nnew',
          files: [
            {
              filePath: 'posts/first.md',
              original: 'old',
              modified: 'new',
            },
            {
              filePath: 'src/main.ts',
              original: 'const oldValue = 1;',
              modified: 'const newValue = 2;',
            },
          ],
        }),
      },
      app: {
        ...(window as any).electronAPI?.app,
        getDefaultProjectPath: vi.fn().mockResolvedValue('/repo/path'),
      },
    };
  });

  it('loads and renders Monaco diff editor with original and modified content', async () => {
    render(<GitDiffView filePath="posts/first.md" />);

    expect(await screen.findByTestId('monaco-diff-editor')).toBeInTheDocument();
    expect((window as any).electronAPI.git.getDiffContent).toHaveBeenCalledWith('/repo/path', 'posts/first.md');
    expect(screen.getByText('original:# old line')).toBeInTheDocument();
    expect(screen.getByText('modified:# new line')).toBeInTheDocument();
    expect(screen.getByText('renderSideBySide:false')).toBeInTheDocument();
    expect(screen.getByText('wordWrap:on')).toBeInTheDocument();
    expect(screen.getByText('hideUnchanged:false')).toBeInTheDocument();
    expect(screen.getByText('keepOriginal:true')).toBeInTheDocument();
    expect(screen.getByText('keepModified:true')).toBeInTheDocument();
  });

  it('loads commit diff content when a commit tab identifier is used', async () => {
    render(<GitDiffView filePath="commit:abc123def456" />);

    const diffEditor = await screen.findByTestId('monaco-diff-editor');
    expect(diffEditor).toBeInTheDocument();
    expect(await screen.findByRole('combobox', { name: /changed files/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous file/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next file/i })).toBeEnabled();
    expect((window as any).electronAPI.git.getCommitDiffContent).toHaveBeenCalledWith('/repo/path', 'abc123def456');
    expect(diffEditor).toHaveTextContent(/original:\s*old/);
    expect(diffEditor).toHaveTextContent(/modified:\s*new/);
    expect(screen.getByText('language:markdown')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /next file/i }));

    expect(diffEditor).toHaveTextContent(/original:\s*const oldValue = 1;/);
    expect(diffEditor).toHaveTextContent(/modified:\s*const newValue = 2;/);
    expect(screen.getByText('language:typescript')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous file/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /next file/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /previous file/i }));

    expect(diffEditor).toHaveTextContent(/original:\s*old/);
    expect(diffEditor).toHaveTextContent(/modified:\s*new/);
    expect(screen.getByRole('button', { name: /previous file/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next file/i })).toBeEnabled();
  });
});
