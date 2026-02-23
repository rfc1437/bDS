import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Sidebar } from '../../../src/renderer/components/Sidebar/Sidebar';
import { useAppStore } from '../../../src/renderer/store';

describe('Sidebar chat list behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      chat: {
        getConversations: vi.fn(),
        checkReady: vi.fn().mockResolvedValue({ ready: true }),
        onTitleUpdated: vi.fn(() => () => {}),
        createConversation: vi.fn(),
        deleteConversation: vi.fn(),
      },
    };

    useAppStore.setState({
      activeProject: null,
      activeView: 'chat',
      sidebarVisible: true,
      tabs: [],
      activeTabId: null,
    });
  });

  it('reloads chat conversations when active project becomes available after mount', async () => {
    const getConversationsMock = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'conv-1',
          title: 'Project Conversation',
          createdAt: '2026-02-22T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
        },
      ]);

    (window as any).electronAPI.chat.getConversations = getConversationsMock;

    render(<Sidebar />);

    expect(await screen.findByText('No conversations yet')).toBeInTheDocument();

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

    expect(await screen.findByText('Project Conversation')).toBeInTheDocument();
    expect(getConversationsMock).toHaveBeenCalledTimes(2);
  });
});
