import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GitDiffView } from '../../../src/renderer/components/GitDiffView/GitDiffView';
import { useAppStore } from '../../../src/renderer/store';

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
        getDiff: vi.fn().mockResolvedValue({
          filePath: 'posts/first.md',
          patch: 'diff --git a/posts/first.md b/posts/first.md\n+hello',
        }),
      },
      app: {
        ...(window as any).electronAPI?.app,
        getDefaultProjectPath: vi.fn().mockResolvedValue('/repo/path'),
      },
    };
  });

  it('loads and renders the git diff patch for the selected file', async () => {
    render(<GitDiffView filePath="posts/first.md" />);

    expect(await screen.findByText(/diff --git a\/posts\/first\.md b\/posts\/first\.md/i)).toBeInTheDocument();
    expect((window as any).electronAPI.git.getDiff).toHaveBeenCalledWith('/repo/path', 'posts/first.md');
  });
});
