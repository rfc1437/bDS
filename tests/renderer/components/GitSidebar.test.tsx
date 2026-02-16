import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GitSidebar } from '../../../src/renderer/components/GitSidebar/GitSidebar';
import { useAppStore } from '../../../src/renderer/store';

describe('GitSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useAppStore.setState({
      activeProject: {
        id: 'project-1',
        name: 'Test Project',
        slug: 'test-project',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      app: {
        ...(window as any).electronAPI?.app,
        getDefaultProjectPath: vi.fn().mockResolvedValue('/repo/path'),
      },
      git: {
        checkAvailability: vi.fn().mockResolvedValue({ gitFound: true, version: '2.49.0' }),
        getRepoState: vi.fn().mockResolvedValue({ isRepo: false, hasRemote: false }),
        init: vi.fn().mockResolvedValue({ success: true }),
      },
    };
  });

  it('shows Initialize Git button when active project is not a git repository', async () => {
    render(<GitSidebar />);

    expect(await screen.findByRole('button', { name: /initialize git/i })).toBeInTheDocument();
  });

  it('initializes repository and refreshes repo state after clicking Initialize Git', async () => {
    const getRepoStateMock = vi
      .fn()
      .mockResolvedValueOnce({ isRepo: false, hasRemote: false })
      .mockResolvedValueOnce({ isRepo: true, rootPath: '/repo/path', currentBranch: 'main', hasRemote: true });

    (window as any).electronAPI.git.getRepoState = getRepoStateMock;
    (window as any).electronAPI.git.init = vi.fn().mockResolvedValue({ success: true });

    render(<GitSidebar />);

    const initButton = await screen.findByRole('button', { name: /initialize git/i });
    await act(async () => {
      fireEvent.click(initButton);
    });

    await vi.waitFor(() => {
      expect((window as any).electronAPI.git.init).toHaveBeenCalledWith('/repo/path');
    });

    await vi.waitFor(() => {
      expect(screen.getByText(/git repository ready/i)).toBeInTheDocument();
    });
  });

  it('passes remote url to init when user provides one', async () => {
    (window as any).electronAPI.git.init = vi.fn().mockResolvedValue({ success: true });
    (window as any).electronAPI.git.getRepoState = vi
      .fn()
      .mockResolvedValueOnce({ isRepo: false, hasRemote: false })
      .mockResolvedValueOnce({ isRepo: true, rootPath: '/repo/path', currentBranch: 'main', hasRemote: true });

    render(<GitSidebar />);

    const remoteInput = await screen.findByPlaceholderText(/optional remote repository url/i);
    await act(async () => {
      fireEvent.change(remoteInput, { target: { value: 'https://github.com/example/repo.git' } });
    });

    expect((remoteInput as HTMLInputElement).value).toBe('https://github.com/example/repo.git');

    const initButton = screen.getByRole('button', { name: /initialize git/i });
    await act(async () => {
      fireEvent.click(initButton);
    });

    await vi.waitFor(() => {
      expect((window as any).electronAPI.git.init).toHaveBeenCalledWith('/repo/path', 'https://github.com/example/repo.git');
    });
  });
});
