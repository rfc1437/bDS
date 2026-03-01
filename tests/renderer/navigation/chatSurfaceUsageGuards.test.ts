import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ChatPanel } from '../../../src/renderer/components/ChatPanel/ChatPanel';
import { AssistantSidebar } from '../../../src/renderer/components/AssistantSidebar/AssistantSidebar';
import { useAppStore } from '../../../src/renderer/store';

describe('chat surface shared usage guards', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }

    useAppStore.setState({ tabs: [], activeTabId: null, activeView: 'posts' });

    window.electronAPI.chat = {
      checkReady: vi.fn().mockResolvedValue({ ready: true }),
      validateApiKey: vi.fn(),
      setApiKey: vi.fn(),
      getApiKey: vi.fn(),
      getAvailableModels: vi.fn().mockResolvedValue({
        success: true,
        models: [{ id: 'gpt-5', name: 'GPT-5' }],
      }),
      setDefaultModel: vi.fn(),
      getSystemPrompt: vi.fn(),
      setSystemPrompt: vi.fn(),
      getConversations: vi.fn(),
      createConversation: vi.fn(),
      getConversation: vi.fn().mockResolvedValue({
        id: 'conv-tab',
        title: 'Chat',
        model: 'gpt-5',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
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
      validateMistralApiKey: vi.fn().mockResolvedValue({ isValid: false, models: [] }),
      setMistralApiKey: vi.fn().mockResolvedValue({ success: true }),
      getMistralApiKey: vi.fn().mockResolvedValue({ hasKey: false, maskedKey: '' }),
      getTitleModel: vi.fn().mockResolvedValue({ success: true, modelId: 'claude-haiku-4-5' }),
      setTitleModel: vi.fn().mockResolvedValue({ success: true }),
      getImageAnalysisModel: vi.fn().mockResolvedValue({ success: true, modelId: 'claude-sonnet-4-5' }),
      setImageAnalysisModel: vi.fn().mockResolvedValue({ success: true }),
    } as never;
  });

  it('wires chat panel to load data and subscribe to stream/tool/title events', () => {
    render(React.createElement(ChatPanel, { conversationId: 'conv-tab' }));

    expect(window.electronAPI.chat.checkReady).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.chat.getConversation).toHaveBeenCalledWith('conv-tab');
    expect(window.electronAPI.chat.getHistory).toHaveBeenCalledWith('conv-tab');
    expect(window.electronAPI.chat.getAvailableModels).toHaveBeenCalledTimes(1);

    expect(window.electronAPI.chat.onStreamDelta).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.chat.onToolCall).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.chat.onToolResult).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.chat.onTitleUpdated).toHaveBeenCalledTimes(1);
  });

  it('wires assistant sidebar stream subscriptions and does not auto-open chat tab', () => {
    render(React.createElement(AssistantSidebar));

    expect(window.electronAPI.chat.onStreamDelta).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.chat.onToolCall).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.chat.onToolResult).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.chat.onTitleUpdated).toHaveBeenCalledTimes(1);

    expect(useAppStore.getState().tabs.some((tab) => tab.type === 'chat')).toBe(false);
  });
});
