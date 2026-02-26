import { describe, expect, it, vi } from 'vitest';
import {
  ensureConversationId,
  sendConversationMessage,
  type ChatService,
} from '../../../src/renderer/navigation/chatSession';

describe('chatSession', () => {
  it('reuses existing conversation id when available', async () => {
    const chatService: Pick<ChatService, 'createConversation'> = {
      createConversation: vi.fn(),
    };

    const conversationId = await ensureConversationId({
      currentConversationId: 'conv-existing',
      createTitle: 'Ignored',
      chatService,
    });

    expect(conversationId).toBe('conv-existing');
    expect(chatService.createConversation).not.toHaveBeenCalled();
  });

  it('creates conversation when no id exists', async () => {
    const chatService: Pick<ChatService, 'createConversation'> = {
      createConversation: vi.fn().mockResolvedValue({ id: 'conv-created' }),
    };

    const conversationId = await ensureConversationId({
      currentConversationId: null,
      createTitle: 'Assistant Session',
      chatService,
    });

    expect(conversationId).toBe('conv-created');
    expect(chatService.createConversation).toHaveBeenCalledWith('Assistant Session');
  });

  it('throws when conversation creation returns no id', async () => {
    const chatService: Pick<ChatService, 'createConversation'> = {
      createConversation: vi.fn().mockResolvedValue(null),
    };

    await expect(
      ensureConversationId({
        currentConversationId: null,
        createTitle: 'Assistant Session',
        chatService,
      }),
    ).rejects.toThrow('No conversation id returned');
  });

  it('normalizes successful send response', async () => {
    const chatService: Pick<ChatService, 'sendMessage'> = {
      sendMessage: vi.fn().mockResolvedValue({ success: true, message: 'Response text' }),
    };

    const result = await sendConversationMessage({
      conversationId: 'conv-1',
      message: 'Hello',
      chatService,
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Response text');
    expect(chatService.sendMessage).toHaveBeenCalledWith('conv-1', 'Hello');
  });

  it('normalizes error send response', async () => {
    const chatService: Pick<ChatService, 'sendMessage'> = {
      sendMessage: vi.fn().mockResolvedValue({ success: false, error: 'Failed' }),
    };

    const result = await sendConversationMessage({
      conversationId: 'conv-1',
      message: 'Hello',
      chatService,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed');
  });

  it('forwards send metadata such as UI surface', async () => {
    const chatService: Pick<ChatService, 'sendMessage'> = {
      sendMessage: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    };

    await sendConversationMessage({
      conversationId: 'conv-1',
      message: 'Hello',
      metadata: { surface: 'sidebar' },
      chatService,
    });

    expect(chatService.sendMessage).toHaveBeenCalledWith('conv-1', 'Hello', { surface: 'sidebar' });
  });
});
