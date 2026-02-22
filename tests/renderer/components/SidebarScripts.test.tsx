import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../../../src/renderer/components/Sidebar/Sidebar';
import { useAppStore } from '../../../src/renderer/store';

describe('Sidebar scripts list behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      scripts: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(),
        getAll: vi.fn().mockResolvedValue([
          {
            id: 'script-1',
            projectId: 'default',
            slug: 'hello-script',
            title: 'Hello Script',
            kind: 'utility',
            entrypoint: 'render',
            enabled: true,
            version: 1,
            filePath: '/tmp/hello-script.py',
            content: 'print("hello")',
            createdAt: '2026-02-22T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
          },
        ]),
      },
    };

    useAppStore.setState({
      activeView: 'scripts',
      sidebarVisible: true,
      tabs: [],
      activeTabId: null,
    });
  });

  it('opens a transient script tab on single click', async () => {
    render(<Sidebar />);

    const scriptRow = await screen.findByRole('button', { name: 'Hello Script' });
    fireEvent.click(scriptRow);

    expect(useAppStore.getState().tabs).toEqual([
      {
        type: 'scripts',
        id: 'script-1',
        isTransient: true,
      },
    ]);
    expect(useAppStore.getState().activeTabId).toBe('script-1');
  });

  it('renders scripts section title and create button', async () => {
    render(<Sidebar />);

    expect(screen.getByText('SCRIPTS')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'New Script' })).toBeInTheDocument();
  });

  it('shows loading state while scripts are being fetched', () => {
    (window as any).electronAPI.scripts.getAll = vi.fn().mockImplementation(
      () => new Promise(() => {}),
    );

    render(<Sidebar />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows empty state with create action when no scripts exist', async () => {
    (window as any).electronAPI.scripts.getAll = vi.fn().mockResolvedValue([]);

    render(<Sidebar />);

    expect(await screen.findByText('No scripts yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a script' })).toBeInTheDocument();
  });

  it('creates a new script from the create button and opens it pinned', async () => {
    const createMock = vi.fn().mockResolvedValue({
      id: 'script-new',
      projectId: 'default',
      slug: 'new-script',
      title: 'New Script',
      kind: 'utility',
      entrypoint: 'render',
      enabled: true,
      version: 1,
      filePath: '/tmp/new-script.py',
      content: 'print("new script")',
      createdAt: '2026-02-22T00:00:00.000Z',
      updatedAt: '2026-02-22T00:00:00.000Z',
    });

    (window as any).electronAPI.scripts.create = createMock;

    render(<Sidebar />);

    fireEvent.click(await screen.findByRole('button', { name: 'New Script' }));

    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Script',
          kind: 'utility',
          entrypoint: 'render',
          enabled: true,
        }),
      );
    });

    await vi.waitFor(() => {
      expect(useAppStore.getState().tabs).toEqual([
        {
          type: 'scripts',
          id: 'script-new',
          isTransient: false,
        },
      ]);
      expect(useAppStore.getState().activeTabId).toBe('script-new');
    });
  });

  it('opens a pinned script tab on double click', async () => {
    render(<Sidebar />);

    const scriptRow = await screen.findByRole('button', { name: 'Hello Script' });
    fireEvent.doubleClick(scriptRow);

    expect(useAppStore.getState().tabs).toEqual([
      {
        type: 'scripts',
        id: 'script-1',
        isTransient: false,
      },
    ]);
    expect(useAppStore.getState().activeTabId).toBe('script-1');
  });
});
