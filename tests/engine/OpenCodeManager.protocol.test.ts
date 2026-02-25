import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenCodeManager } from '../../src/main/engine/OpenCodeManager';
import { getProtocolTelemetryService } from '../../src/main/agentic/observability/protocolTelemetry';

interface MockConversation {
  id: string;
  model?: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>;
}

function createChatEngineMock(conversation: MockConversation) {
  const settings = new Map<string, string>();
  const addMessage = vi.fn().mockResolvedValue(undefined);

  return {
    getConversation: vi.fn().mockResolvedValue(conversation),
    addMessage,
    getDefaultSystemPrompt: vi.fn().mockResolvedValue('system prompt'),
    getSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
    setSetting: vi.fn(async (key: string, value: string) => {
      settings.set(key, value);
    }),
  };
}

describe('OpenCodeManager protocol integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses protocol envelope flow and persists workflow checkpoint for needs_input turns', async () => {
    const conversation: MockConversation = {
      id: 'conversation-1',
      model: 'gpt-5',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'previous user message' },
      ],
    };

    const chatEngineMock = createChatEngineMock(conversation);
    const manager = new OpenCodeManager(
      chatEngineMock as never,
      {} as never,
      {} as never,
      () => null,
    );

    manager.setApiKey('test-api-key');

    const providerSpy = vi.spyOn(manager as never, 'sendOpenAIMessage').mockResolvedValue({
      content: JSON.stringify({
        protocolVersion: '2.0',
        assistantText: 'Please provide a date range.',
        intent: 'ask_input',
        needsInput: {
          required: true,
          fields: [{ key: 'dateRange', label: 'Date range', inputType: 'date' }],
        },
        actions: [],
        confidence: 0.82,
        traceId: 'trace-needs-input',
      }),
      toolCalls: [],
    });

    const telemetryBefore = getProtocolTelemetryService().getSnapshot();

    const result = await manager.sendMessage('conversation-1', 'Generate report', {
      metadata: { surface: 'tab' },
    });

    expect(result.success).toBe(true);
    expect(result.envelope?.protocolVersion).toBe('2.0');
    expect(result.envelope?.needsInput.required).toBe(true);
    expect(result.envelope?.needsInput.fields[0]?.key).toBe('dateRange');

    expect(providerSpy).toHaveBeenCalledTimes(1);
    const providerMessages = providerSpy.mock.calls[0][2] as Array<{ role: string; content?: string }>;
    const latestUserMessage = providerMessages[providerMessages.length - 1]?.content ?? '';
    expect(latestUserMessage).toContain('[Protocol request envelope]');
    expect(latestUserMessage).toContain('"protocolVersion": "2.0"');
    expect(latestUserMessage).toContain('"surface": "tab"');

    const checkpointKey = 'agui.workflow.conversation-1';
    expect(chatEngineMock.setSetting).toHaveBeenCalledWith(
      checkpointKey,
      expect.any(String),
    );

    const persistedCheckpoint = await chatEngineMock.getSetting(checkpointKey);
    const checkpoint = JSON.parse(persistedCheckpoint as string) as { state: string; pendingFields: string[]; lastTraceId: string };
    expect(checkpoint.state).toBe('awaiting_input');
    expect(checkpoint.pendingFields).toEqual(['dateRange']);
    expect(checkpoint.lastTraceId).toBe('trace-needs-input');

    const telemetryAfter = getProtocolTelemetryService().getSnapshot();
    expect(telemetryAfter.totalTurns).toBe(telemetryBefore.totalTurns + 1);
    expect(telemetryAfter.validEnvelopeTurns).toBe(telemetryBefore.validEnvelopeTurns + 1);

    expect(chatEngineMock.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      role: 'assistant',
      content: 'Please provide a date range.',
    }));
  });

  it('blocks unsupported actions and records blocked-action telemetry', async () => {
    const conversation: MockConversation = {
      id: 'conversation-2',
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'previous user message' }],
    };

    const chatEngineMock = createChatEngineMock(conversation);
    const manager = new OpenCodeManager(
      chatEngineMock as never,
      {} as never,
      {} as never,
      () => null,
    );
    manager.setApiKey('test-api-key');

    vi.spyOn(manager as never, 'sendOpenAIMessage').mockResolvedValue({
      content: JSON.stringify({
        protocolVersion: '2.0',
        assistantText: 'Try toggling sidebar.',
        intent: 'propose_action',
        needsInput: { required: false, fields: [] },
        actions: [
          {
            id: 'a1',
            action: 'toggleAssistantSidebar',
            label: 'Toggle assistant sidebar',
            policy: 'silent',
            requiresConfirmation: false,
          },
        ],
        confidence: 0.74,
        traceId: 'trace-blocked-action',
      }),
      toolCalls: [],
    });

    const telemetryBefore = getProtocolTelemetryService().getSnapshot();

    const result = await manager.sendMessage('conversation-2', 'Toggle it', {
      metadata: { surface: 'tab' },
    });

    expect(result.success).toBe(true);
    expect(result.envelope?.actions).toEqual([]);
    expect(result.warnings?.some((warning) => warning.includes('Blocked unsupported action: toggleAssistantSidebar'))).toBe(true);

    const telemetryAfter = getProtocolTelemetryService().getSnapshot();
    expect(telemetryAfter.blockedActionCount).toBe(telemetryBefore.blockedActionCount + 1);
  });

  it('retries once with protocol repair prompt when first output is non-canonical', async () => {
    const conversation: MockConversation = {
      id: 'conversation-3',
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'show chart' }],
    };

    const chatEngineMock = createChatEngineMock(conversation);
    const manager = new OpenCodeManager(
      chatEngineMock as never,
      {} as never,
      {} as never,
      () => null,
    );
    manager.setApiKey('test-api-key');

    const sendSpy = vi.spyOn(manager as never, 'sendOpenAIMessage')
      .mockResolvedValueOnce({
        content: JSON.stringify({
          title: 'Legacy JSON',
          widgets: [{ type: 'chart', chartType: 'bar' }],
        }),
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          protocolVersion: '2.0',
          assistantText: 'Here is your chart.',
          ui: {
            specVersion: '1',
            elements: [
              {
                type: 'chart',
                chartType: 'bar',
                series: [{ label: '2015', value: 86 }],
              },
            ],
          },
          intent: 'summarize',
          needsInput: { required: false, fields: [] },
          actions: [],
          confidence: 0.8,
          traceId: 'trace-retry-success',
        }),
        toolCalls: [],
      });

    const result = await manager.sendMessage('conversation-3', 'Build chart', {
      metadata: { surface: 'tab' },
    });

    expect(result.success).toBe(true);
    expect(result.envelope?.traceId).toBe('trace-retry-success');
    expect(sendSpy).toHaveBeenCalledTimes(2);

    const retryMessages = sendSpy.mock.calls[1]?.[2] as Array<{ role: string; content?: string }>;
    const lastMessage = retryMessages[retryMessages.length - 1]?.content ?? '';
    expect(lastMessage).toContain('failed protocol validation');
    expect(lastMessage).toContain('Return ONLY one valid protocol envelope JSON object');

    expect(chatEngineMock.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-3',
      role: 'assistant',
      content: 'Here is your chart.',
    }));
  });
});