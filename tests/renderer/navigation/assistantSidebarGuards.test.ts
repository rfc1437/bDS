import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { AssistantSidebar } from '../../../src/renderer/components/AssistantSidebar/AssistantSidebar';
import { AssistantPanelControls } from '../../../src/renderer/components/AssistantPanelControls';
import { useAppStore } from '../../../src/renderer/store';

describe('assistant sidebar guard rails', () => {
  beforeEach(() => {
    useAppStore.setState({ tabs: [], activeTabId: null, activeView: 'posts' });

    window.electronAPI.chat = {
      checkReady: vi.fn().mockResolvedValue({ ready: true }),
      validateApiKey: vi.fn(),
      setApiKey: vi.fn(),
      getApiKey: vi.fn(),
      getProtocolHealth: vi.fn(),
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
    } as never;
  });

  it('keeps assistant sidebar self-contained and avoids opening chat tabs on mount', () => {
    render(React.createElement(AssistantSidebar));

    expect(useAppStore.getState().tabs.some((tab) => tab.type === 'chat')).toBe(false);
  });

  it('renders rich assistant panel widget branches at runtime', () => {
    const onAction = vi.fn();

    const { container } = render(
      React.createElement(AssistantPanelControls, {
        elements: [
          { type: 'chart', chartType: 'bar', title: 'Trend', series: [{ label: 'Jan', value: 10 }] },
          {
            type: 'form',
            formId: 'f1',
            submitLabel: 'Submit',
            action: 'submitNeedsInput',
            fields: [{ key: 'name', label: 'Name', inputType: 'text', required: true }],
          },
          { type: 'datePicker', key: 'date', label: 'Date', submitLabel: 'Pick', action: 'submitNeedsInput' },
          { type: 'card', title: 'Card', body: 'Body', actions: [{ label: 'Open', action: 'openSettings' }] },
          { type: 'image', src: 'https://example.com/a.png', caption: 'Image', action: 'openSettings' },
          {
            type: 'tabs',
            tabs: [{ id: 'tab-1', label: 'Tab 1', elements: [{ type: 'text', text: 'Inside tab' }] }],
          },
          { type: 'input', key: 'query', label: 'Query', inputType: 'text', submitLabel: 'Run', action: 'openSettings' },
        ],
        onAction,
      }),
    );

    expect(container.querySelector('.assistant-panel-chart')).not.toBeNull();
    expect(container.querySelector('.assistant-panel-form')).not.toBeNull();
    expect(container.querySelector('.assistant-panel-card')).not.toBeNull();
    expect(container.querySelector('.assistant-panel-image')).not.toBeNull();
    expect(container.querySelector('.assistant-panel-tabs')).not.toBeNull();
  });

  it('enforces action confirmation policy before dispatching assistant actions', () => {
    const onAction = vi.fn();
    const confirmMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(window, 'confirm', {
      value: confirmMock,
      configurable: true,
    });

    const { getByText } = render(
      React.createElement(AssistantPanelControls, {
        elements: [{ type: 'action', label: 'Open Settings', action: 'openSettings' }],
        actionPolicies: { openSettings: 'confirm' },
        onAction,
      }),
    );

    fireEvent.click(getByText('Open Settings'));

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('openSettings', undefined);
  });
});
