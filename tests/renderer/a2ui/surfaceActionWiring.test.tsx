import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { A2UIClientAction } from '../../../src/main/a2ui/types';
import { useAppStore } from '../../../src/renderer/store';

// Capture the onSurfaceAction prop passed to ChatTranscript
let capturedOnSurfaceAction: ((action: A2UIClientAction) => void) | undefined;

vi.mock('../../../src/renderer/components/ChatSurface', () => ({
  ChatTranscript: (props: { onSurfaceAction?: (action: A2UIClientAction) => void }) => {
    capturedOnSurfaceAction = props.onSurfaceAction;
    return React.createElement('div', { 'data-testid': 'mock-chat-transcript' });
  },
}));

vi.mock('../../../src/renderer/navigation/useChatSurfaceState', () => ({
  useChatSurfaceState: () => ({
    messages: [{ role: 'user', content: 'test' }],
    isStreaming: false,
    streamingContent: '',
    toolEvents: [],
    beginUserTurn: vi.fn(),
    appendStreamDelta: vi.fn(),
    recordToolCall: vi.fn(),
    recordToolResult: vi.fn(),
    finalizeAssistantTurn: vi.fn(),
    appendAssistantMessage: vi.fn(),
    stopStreaming: vi.fn(),
    abortStreaming: vi.fn(),
    getStreamingContent: vi.fn(() => ''),
    setMessages: vi.fn(),
  }),
}));

vi.mock('../../../src/renderer/navigation/useChatMessageSender', () => ({
  useChatMessageSender: () => ({
    sendMessage: vi.fn(),
  }),
}));

vi.mock('../../../src/renderer/a2ui/useA2UISurface', () => ({
  useA2UISurface: () => ({
    surfaces: [],
    surfacesByTurn: new Map(),
    latestSurfaceId: null,
    dismissedSurfaceIds: new Set(),
    dismissSurface: vi.fn(),
    updateLocalData: vi.fn(),
    getDataModel: vi.fn(() => ({})),
    clearSurfaces: vi.fn(),
    replayFromMessages: vi.fn(),
  }),
}));

function setupChatApi() {
  window.electronAPI.chat = {
    checkReady: vi.fn(),
    validateApiKey: vi.fn(),
    setApiKey: vi.fn(),
    getApiKey: vi.fn(),
    getAvailableModels: vi.fn(),
    setDefaultModel: vi.fn(),
    getSystemPrompt: vi.fn(),
    setSystemPrompt: vi.fn(),
    getConversations: vi.fn(),
    createConversation: vi.fn(),
    getConversation: vi.fn().mockResolvedValue({ id: 'conv-1', title: 'Test', model: 'm' }),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    sendMessage: vi.fn(),
    addSystemEvent: vi.fn(),
    abortMessage: vi.fn(),
    getHistory: vi.fn().mockResolvedValue([]),
    clearMessages: vi.fn(),
    setConversationModel: vi.fn(),
    analyzeTaxonomy: vi.fn(),
    analyzeMediaImage: vi.fn(),
    onStreamDelta: vi.fn(() => vi.fn()),
    onToolCall: vi.fn(() => vi.fn()),
    onToolResult: vi.fn(() => vi.fn()),
    onTitleUpdated: vi.fn(() => vi.fn()),
    onA2UIMessage: vi.fn(() => vi.fn()),
    onTokenUsage: vi.fn(() => vi.fn()),
    dispatchA2UIAction: vi.fn(),
  } as never;
}

describe('A2UI surface action wiring', () => {
  beforeEach(() => {
    capturedOnSurfaceAction = undefined;
    setupChatApi();
  });

  describe('AssistantSidebar', () => {
    it('routes surface actions through dispatchAssistantAction, not IPC', async () => {
      const { AssistantSidebar } = await import(
        '../../../src/renderer/components/AssistantSidebar/AssistantSidebar'
      );

      const setSelectedPost = vi.fn();
      const openTab = vi.fn();
      const setActiveView = vi.fn();

      useAppStore.setState({
        tabs: [],
        activeTabId: null,
        posts: [],
        media: [],
        setSelectedPost,
        setSelectedMedia: vi.fn(),
        openTab,
        setActiveView,
        toggleSidebar: vi.fn(),
        togglePanel: vi.fn(),
        toggleAssistantSidebar: vi.fn(),
      });

      render(React.createElement(AssistantSidebar));

      expect(capturedOnSurfaceAction).toBeDefined();

      capturedOnSurfaceAction!({
        surfaceId: 'surface-1',
        componentId: 'card-1',
        action: 'openPost',
        payload: { postId: 'post-abc' },
      });

      expect(setActiveView).toHaveBeenCalledWith('posts');
      expect(setSelectedPost).toHaveBeenCalledWith('post-abc');
      expect(openTab).toHaveBeenCalledWith({
        type: 'post',
        id: 'post-abc',
        isTransient: false,
      });

      // The IPC no-op handler must NOT be called
      expect(window.electronAPI.chat.dispatchA2UIAction).not.toHaveBeenCalled();
    });
  });

  describe('ChatPanel', () => {
    it('routes surface actions through dispatchAssistantAction, not IPC', async () => {
      const { ChatPanel } = await import(
        '../../../src/renderer/components/ChatPanel/ChatPanel'
      );

      const setSelectedPost = vi.fn();
      const openTab = vi.fn();
      const setActiveView = vi.fn();

      useAppStore.setState({
        tabs: [],
        activeTabId: null,
        posts: [],
        media: [],
        setSelectedPost,
        setSelectedMedia: vi.fn(),
        openTab,
        setActiveView,
        toggleSidebar: vi.fn(),
        togglePanel: vi.fn(),
        toggleAssistantSidebar: vi.fn(),
      });

      render(React.createElement(ChatPanel, { conversationId: 'conv-1' }));

      expect(capturedOnSurfaceAction).toBeDefined();

      capturedOnSurfaceAction!({
        surfaceId: 'surface-2',
        componentId: 'card-2',
        action: 'openPost',
        payload: { postId: 'post-xyz' },
      });

      expect(setActiveView).toHaveBeenCalledWith('posts');
      expect(setSelectedPost).toHaveBeenCalledWith('post-xyz');
      expect(openTab).toHaveBeenCalledWith({
        type: 'post',
        id: 'post-xyz',
        isTransient: false,
      });

      expect(window.electronAPI.chat.dispatchA2UIAction).not.toHaveBeenCalled();
    });
  });
});
