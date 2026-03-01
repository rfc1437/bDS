import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatPanel } from '../../../src/renderer/components/ChatPanel/ChatPanel';
import { AssistantSidebar } from '../../../src/renderer/components/AssistantSidebar/AssistantSidebar';

describe('chat surface mode usage guards', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }

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

  it('shows model selector in tab chat but not in assistant sidebar', async () => {
    const { container: tabContainer } = render(React.createElement(ChatPanel, { conversationId: 'conv-tab' }));

    expect(tabContainer.querySelector('.model-selector-button')).not.toBeNull();

    render(React.createElement(AssistantSidebar));

    expect(screen.queryByText('gpt-5')).toBeNull();
  });
});
