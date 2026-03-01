import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AssistantSidebar } from '../../../src/renderer/components/AssistantSidebar/AssistantSidebar';
import { useAppStore } from '../../../src/renderer/store';

describe('assistant sidebar guard rails', () => {
  beforeEach(() => {
    useAppStore.setState({ tabs: [], activeTabId: null, activeView: 'posts' });

    window.electronAPI.chat = {
      checkReady: vi.fn().mockResolvedValue({ ready: true }),
      validateApiKey: vi.fn(),
      setApiKey: vi.fn(),
      getApiKey: vi.fn(),
      getAvailableModels: vi.fn(),
      setDefaultModel: vi.fn(),
      getSystemPrompt: vi.fn(),
      setSystemPrompt: vi.fn(),
      getConversations: vi.fn(),
      createConversation: vi.fn(),
      getConversation: vi.fn(),
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

  it('keeps assistant sidebar self-contained and avoids opening chat tabs on mount', () => {
    render(React.createElement(AssistantSidebar));

    expect(useAppStore.getState().tabs.some((tab) => tab.type === 'chat')).toBe(false);
  });
});
