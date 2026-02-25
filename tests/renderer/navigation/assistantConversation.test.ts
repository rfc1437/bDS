import { describe, expect, it } from 'vitest';
import { planAssistantRequest } from '../../../src/renderer/navigation/assistantConversation';

describe('assistantConversation', () => {
  it('creates enriched first message when no conversation exists yet', () => {
    const result = planAssistantRequest({
      conversationId: null,
      userPrompt: 'Find weak tags',
      context: {
        tabType: 'post',
        id: 'post-1',
        title: 'Launch Notes',
      },
    });

    expect(result.shouldCreateConversation).toBe(true);
    expect(result.outboundMessage).toContain('User request: Find weak tags');
    expect(result.outboundMessage).toContain('Current editor context type: post');
  });

  it('sends plain follow-up message when conversation already exists', () => {
    const result = planAssistantRequest({
      conversationId: 'conv-1',
      userPrompt: 'What next?',
      context: {
        tabType: 'post',
        id: 'post-1',
        title: 'Launch Notes',
      },
    });

    expect(result.shouldCreateConversation).toBe(false);
    expect(result.outboundMessage).toBe('What next?');
  });
});
