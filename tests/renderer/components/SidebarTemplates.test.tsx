import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../../../src/renderer/components/Sidebar/Sidebar';
import { useAppStore } from '../../../src/renderer/store';

describe('Sidebar templates list behavior', () => {
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
      templates: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn().mockResolvedValue({ deleted: true }),
        get: vi.fn(),
        getAll: vi.fn().mockResolvedValue([
          {
            id: 'template-1',
            projectId: 'default',
            slug: 'custom_post',
            title: 'Custom Post',
            kind: 'post',
            enabled: true,
            version: 1,
            filePath: '/tmp/custom_post.liquid',
            content: '<main>{{ post.title }}</main>',
            createdAt: '2026-02-22T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
          },
        ]),
        getEnabledByKind: vi.fn().mockResolvedValue([]),
        validate: vi.fn(),
        rebuildFromFiles: vi.fn(),
      },
    };

    useAppStore.setState({
      activeView: 'templates',
      sidebarVisible: true,
      tabs: [],
      activeTabId: null,
    });
  });

  it('opens a transient template tab on single click', async () => {
    const { container } = render(<Sidebar />);

    const templateRow = await screen.findByRole('button', { name: 'Custom Post' });
    expect(templateRow).toHaveClass('chat-list-item');
    expect(container.querySelector('.chat-item-date')).not.toBeNull();
    fireEvent.click(templateRow);

    expect(useAppStore.getState().tabs).toEqual([
      {
        type: 'templates',
        id: 'template-1',
        isTransient: true,
      },
    ]);
    expect(useAppStore.getState().activeTabId).toBe('template-1');
  });

  it('renders templates section title and create button', async () => {
    render(<Sidebar />);

    expect(screen.getByText('TEMPLATES')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'New Template' })).toBeInTheDocument();
  });

  it('shows loading state while templates are being fetched', () => {
    (window as any).electronAPI.templates.getAll = vi.fn().mockImplementation(
      () => new Promise(() => {}),
    );

    render(<Sidebar />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows empty state with create action when no templates exist', async () => {
    (window as any).electronAPI.templates.getAll = vi.fn().mockResolvedValue([]);

    render(<Sidebar />);

    expect(await screen.findByText('No templates yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a template' })).toBeInTheDocument();
  });

  it('creates a new template from the create button and opens it pinned', async () => {
    const createMock = vi.fn().mockResolvedValue({
      id: 'template-new',
      projectId: 'default',
      slug: 'new_template',
      title: 'New Template',
      kind: 'post',
      enabled: true,
      version: 1,
      filePath: '/tmp/new_template.liquid',
      content: '',
      createdAt: '2026-02-22T00:00:00.000Z',
      updatedAt: '2026-02-22T00:00:00.000Z',
    });

    (window as any).electronAPI.templates.create = createMock;

    render(<Sidebar />);

    fireEvent.click(await screen.findByRole('button', { name: 'New Template' }));

    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Template',
          kind: 'post',
          content: '',
          enabled: true,
        }),
      );
    });

    await vi.waitFor(() => {
      expect(useAppStore.getState().tabs).toEqual([
        {
          type: 'templates',
          id: 'template-new',
          isTransient: false,
        },
      ]);
      expect(useAppStore.getState().activeTabId).toBe('template-new');
    });
  });

  it('opens a pinned template tab on double click', async () => {
    render(<Sidebar />);

    const templateRow = await screen.findByRole('button', { name: 'Custom Post' });
    fireEvent.doubleClick(templateRow);

    expect(useAppStore.getState().tabs).toEqual([
      {
        type: 'templates',
        id: 'template-1',
        isTransient: false,
      },
    ]);
    expect(useAppStore.getState().activeTabId).toBe('template-1');
  });

  it('deletes a template from sidebar action', async () => {
    const deleteMock = vi.fn().mockResolvedValue({ deleted: true });
    (window as any).electronAPI.templates.delete = deleteMock;

    useAppStore.setState({
      tabs: [{ type: 'templates', id: 'template-1', isTransient: false }],
      activeTabId: 'template-1',
    });

    render(<Sidebar />);

    const deleteButton = await screen.findByTitle('Delete template');
    fireEvent.click(deleteButton);

    await vi.waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith('template-1');
      expect(useAppStore.getState().tabs).toEqual([]);
    });
  });

  it('refreshes templates list when templates-changed event is emitted', async () => {
    const getAllMock = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'template-1',
          projectId: 'default',
          slug: 'custom_post',
          title: 'Custom Post',
          kind: 'post',
          enabled: true,
          version: 1,
          filePath: '/tmp/custom_post.liquid',
          content: '<main>{{ post.title }}</main>',
          createdAt: '2026-02-22T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'template-1',
          projectId: 'default',
          slug: 'renamed_template',
          title: 'Renamed Template',
          kind: 'post',
          enabled: true,
          version: 2,
          filePath: '/tmp/custom_post.liquid',
          content: '<main>{{ post.title }}</main>',
          createdAt: '2026-02-22T00:00:00.000Z',
          updatedAt: '2026-02-22T00:01:00.000Z',
        },
      ]);

    (window as any).electronAPI.templates.getAll = getAllMock;

    render(<Sidebar />);

    await screen.findByRole('button', { name: 'Custom Post' });
    window.dispatchEvent(new CustomEvent('bds:templates-changed'));

    expect(await screen.findByRole('button', { name: 'Renamed Template' })).toBeInTheDocument();
  });

  it('reloads templates when active project context becomes available after mount', async () => {
    const getAllMock = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'template-1',
          projectId: 'project-1',
          slug: 'custom_post',
          title: 'Custom Post',
          kind: 'post',
          enabled: true,
          version: 1,
          filePath: '/tmp/custom_post.liquid',
          content: '<main>{{ post.title }}</main>',
          createdAt: '2026-02-22T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
        },
      ]);

    (window as any).electronAPI.templates.getAll = getAllMock;

    useAppStore.setState({
      activeProject: null,
      activeView: 'templates',
      sidebarVisible: true,
      tabs: [],
      activeTabId: null,
    });

    render(<Sidebar />);

    expect(await screen.findByText('No templates yet')).toBeInTheDocument();

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

    expect(await screen.findByRole('button', { name: 'Custom Post' })).toBeInTheDocument();
    expect(getAllMock).toHaveBeenCalledTimes(2);
  });
});
