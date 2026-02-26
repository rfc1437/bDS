import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AssistantSidebar } from '../../../src/renderer/components/AssistantSidebar/AssistantSidebar';

describe('AssistantSidebar wiring', () => {
  beforeEach(() => {
    const onStreamDelta = vi.fn(() => vi.fn());
    const onToolCall = vi.fn(() => vi.fn());
    const onToolResult = vi.fn(() => vi.fn());
    const onTitleUpdated = vi.fn(() => vi.fn());

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
      getConversation: vi.fn(),
      updateConversation: vi.fn(),
      deleteConversation: vi.fn(),
      sendMessage: vi.fn(),
      addSystemEvent: vi.fn(),
      abortMessage: vi.fn(),
      getHistory: vi.fn(),
      clearMessages: vi.fn(),
      setConversationModel: vi.fn(),
      analyzeTaxonomy: vi.fn(),
      analyzeMediaImage: vi.fn(),
      onStreamDelta,
      onToolCall,
      onToolResult,
      onTitleUpdated,
      onA2UIMessage: vi.fn(() => vi.fn()),
      onTokenUsage: vi.fn(() => vi.fn()),
      dispatchA2UIAction: vi.fn(),
    } as never;
  });

  it('subscribes to chat streaming events on mount', () => {
    render(<AssistantSidebar />);

    expect(window.electronAPI.chat.onStreamDelta).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.chat.onToolCall).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.chat.onToolResult).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.chat.onTitleUpdated).toHaveBeenCalledTimes(1);
  });
});
