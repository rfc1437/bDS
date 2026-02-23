import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../../../src/renderer/components/Sidebar/Sidebar';
import { useAppStore } from '../../../src/renderer/store';

describe('Sidebar scripts list behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const listeners = new Map<string, Set<(event: Event) => void>>();
    (window as any).addEventListener = vi.fn((type: string, listener: (event: Event) => void) => {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)?.add(listener);
    });
    (window as any).removeEventListener = vi.fn((type: string, listener: (event: Event) => void) => {
      listeners.get(type)?.delete(listener);
    });
    (window as any).dispatchEvent = vi.fn((event: Event) => {
      listeners.get(event.type)?.forEach((listener) => listener(event));
      return true;
    });

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
    const { container } = render(<Sidebar />);

    const scriptRow = await screen.findByRole('button', { name: 'Hello Script' });
    expect(scriptRow).toHaveClass('chat-list-item');
    expect(container.querySelector('.chat-item-date')).not.toBeNull();
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

  it('deletes a script from sidebar action', async () => {
    const deleteMock = vi.fn().mockResolvedValue(true);
    (window as any).electronAPI.scripts.delete = deleteMock;

    useAppStore.setState({
      tabs: [{ type: 'scripts', id: 'script-1', isTransient: false }],
      activeTabId: 'script-1',
    });

    render(<Sidebar />);

    const deleteButton = await screen.findByTitle('Delete script');
    fireEvent.click(deleteButton);

    await vi.waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith('script-1');
      expect(useAppStore.getState().tabs).toEqual([]);
    });
  });

  it('refreshes scripts list when scripts-changed event is emitted', async () => {
    const getAllMock = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'script-1',
          projectId: 'default',
          slug: 'hello_script',
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
      ])
      .mockResolvedValueOnce([
        {
          id: 'script-1',
          projectId: 'default',
          slug: 'renamed_script',
          title: 'Renamed Script',
          kind: 'utility',
          entrypoint: 'render',
          enabled: true,
          version: 2,
          filePath: '/tmp/hello-script.py',
          content: 'print("hello")',
          createdAt: '2026-02-22T00:00:00.000Z',
          updatedAt: '2026-02-22T00:01:00.000Z',
        },
      ]);

    (window as any).electronAPI.scripts.getAll = getAllMock;

    render(<Sidebar />);

    await screen.findByRole('button', { name: 'Hello Script' });
    window.dispatchEvent(new CustomEvent('bds:scripts-changed'));

    expect(await screen.findByRole('button', { name: 'Renamed Script' })).toBeInTheDocument();
  });

  it('reloads scripts when active project context becomes available after mount', async () => {
    const getAllMock = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'script-1',
          projectId: 'project-1',
          slug: 'hello_script',
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
      ]);

    (window as any).electronAPI.scripts.getAll = getAllMock;

    useAppStore.setState({
      activeProject: null,
      activeView: 'scripts',
      sidebarVisible: true,
      tabs: [],
      activeTabId: null,
    });

    render(<Sidebar />);

    expect(await screen.findByText('No scripts yet')).toBeInTheDocument();

    act(() => {
      useAppStore.setState({
        activeProject: {
          id: 'project-1',
          name: 'Project 1',
          slug: 'project-1',
          dataPath: '/tmp/project-1',
          isActive: true,
          createdAt: '2026-02-22T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
        },
      });
    });

    expect(await screen.findByRole('button', { name: 'Hello Script' })).toBeInTheDocument();
    expect(getAllMock).toHaveBeenCalledTimes(2);
  });
});
