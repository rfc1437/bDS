import { describe, expect, it, vi } from 'vitest';
import { dispatchAssistantAction } from '../../../src/renderer/navigation/assistantActionDispatcher';

describe('assistantActionDispatcher', () => {
  it('opens a post from action payload', () => {
    const setSelectedPost = vi.fn();
    const openTab = vi.fn();
    const setActiveView = vi.fn();

    const result = dispatchAssistantAction(
      {
        action: 'openPost',
        payload: { postId: 'post-123' },
      },
      {
        setSelectedPost,
        setSelectedMedia: vi.fn(),
        openTab,
        setActiveView,
        toggleSidebar: vi.fn(),
        togglePanel: vi.fn(),
        toggleAssistantSidebar: vi.fn(),
      },
    );

    expect(result.handled).toBe(true);
    expect(setActiveView).toHaveBeenCalledWith('posts');
    expect(setSelectedPost).toHaveBeenCalledWith('post-123');
    expect(openTab).toHaveBeenCalledWith({ type: 'post', id: 'post-123', isTransient: false });
  });

  it('opens media from action payload', () => {
    const setSelectedMedia = vi.fn();
    const openTab = vi.fn();
    const setActiveView = vi.fn();

    const result = dispatchAssistantAction(
      {
        action: 'openMedia',
        payload: { mediaId: 'media-321' },
      },
      {
        setSelectedPost: vi.fn(),
        setSelectedMedia,
        openTab,
        setActiveView,
        toggleSidebar: vi.fn(),
        togglePanel: vi.fn(),
        toggleAssistantSidebar: vi.fn(),
      },
    );

    expect(result.handled).toBe(true);
    expect(setActiveView).toHaveBeenCalledWith('media');
    expect(setSelectedMedia).toHaveBeenCalledWith('media-321');
    expect(openTab).toHaveBeenCalledWith({ type: 'media', id: 'media-321', isTransient: false });
  });

  it('switches sidebar view', () => {
    const setActiveView = vi.fn();

    const result = dispatchAssistantAction(
      {
        action: 'switchView',
        payload: { view: 'tags' },
      },
      {
        setSelectedPost: vi.fn(),
        setSelectedMedia: vi.fn(),
        openTab: vi.fn(),
        setActiveView,
        toggleSidebar: vi.fn(),
        togglePanel: vi.fn(),
        toggleAssistantSidebar: vi.fn(),
      },
    );

    expect(result.handled).toBe(true);
    expect(setActiveView).toHaveBeenCalledWith('tags');
  });

  it('rejects switchView payload when view is invalid', () => {
    const setActiveView = vi.fn();

    const result = dispatchAssistantAction(
      {
        action: 'switchView',
        payload: { view: 'not-a-view' },
      },
      {
        setSelectedPost: vi.fn(),
        setSelectedMedia: vi.fn(),
        openTab: vi.fn(),
        setActiveView,
        toggleSidebar: vi.fn(),
        togglePanel: vi.fn(),
        toggleAssistantSidebar: vi.fn(),
      },
    );

    expect(result.handled).toBe(false);
    expect(result.error).toContain('Invalid payload');
    expect(setActiveView).not.toHaveBeenCalled();
  });

  it('opens chat tab for openChat action', () => {
    const setActiveView = vi.fn();
    const openTab = vi.fn();

    const result = dispatchAssistantAction(
      {
        action: 'openChat',
        payload: { conversationId: 'conversation-42' },
      },
      {
        setSelectedPost: vi.fn(),
        setSelectedMedia: vi.fn(),
        openTab,
        setActiveView,
        toggleSidebar: vi.fn(),
        togglePanel: vi.fn(),
        toggleAssistantSidebar: vi.fn(),
      },
    );

    expect(result.handled).toBe(true);
    expect(setActiveView).toHaveBeenCalledWith('chat');
    expect(openTab).toHaveBeenCalledWith({ type: 'chat', id: 'conversation-42', isTransient: false });
  });

  it('opens settings tab for openSettings action', () => {
    const setActiveView = vi.fn();
    const openTab = vi.fn();

    const result = dispatchAssistantAction(
      {
        action: 'openSettings',
      },
      {
        setSelectedPost: vi.fn(),
        setSelectedMedia: vi.fn(),
        openTab,
        setActiveView,
        toggleSidebar: vi.fn(),
        togglePanel: vi.fn(),
        toggleAssistantSidebar: vi.fn(),
      },
    );

    expect(result.handled).toBe(true);
    expect(setActiveView).toHaveBeenCalledWith('settings');
    expect(openTab).toHaveBeenCalledWith({ type: 'settings', id: 'settings', isTransient: false });
  });

  it('rejects invalid payload for openChat action', () => {
    const result = dispatchAssistantAction(
      {
        action: 'openChat',
        payload: {},
      },
      {
        setSelectedPost: vi.fn(),
        setSelectedMedia: vi.fn(),
        openTab: vi.fn(),
        setActiveView: vi.fn(),
        toggleSidebar: vi.fn(),
        togglePanel: vi.fn(),
        toggleAssistantSidebar: vi.fn(),
      },
    );

    expect(result.handled).toBe(false);
    expect(result.error).toContain('Invalid payload');
  });

  it('returns an error for unknown actions', () => {
    const result = dispatchAssistantAction(
      {
        action: 'doesNotExist',
      },
      {
        setSelectedPost: vi.fn(),
        setSelectedMedia: vi.fn(),
        openTab: vi.fn(),
        setActiveView: vi.fn(),
        toggleSidebar: vi.fn(),
        togglePanel: vi.fn(),
        toggleAssistantSidebar: vi.fn(),
      },
    );

    expect(result.handled).toBe(false);
    expect(result.error).toContain('Unsupported action');
  });
});
