import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GitDiffView } from '../../../src/renderer/components/GitDiffView/GitDiffView';
import { useAppStore } from '../../../src/renderer/store';

vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: (_props: unknown) => null,
  DiffEditor: (props: { original: string; modified: string; language?: string }) => (
    <div data-testid="monaco-diff-editor">
      <div>original:{props.original}</div>
      <div>modified:{props.modified}</div>
      <div>language:{props.language}</div>
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
  });
});
