import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChatMessageSender } from '../../../src/renderer/navigation/useChatMessageSender';

describe('useChatMessageSender', () => {
  it('sends message and clears error on success', async () => {
    const chatService = {
      sendMessage: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    };

    const { result } = renderHook(() => useChatMessageSender({ chatService }));

    let response: Awaited<ReturnType<typeof result.current.sendMessage>> | null = null;
    await act(async () => {
      response = await result.current.sendMessage({
        conversationId: 'conv-1',
        message: 'hello',
      });
    });

    expect(response?.success).toBe(true);
    expect(response?.message).toBe('ok');
    expect(result.current.lastError).toBeNull();
  });

  it('stores normalized error when send fails', async () => {
    const chatService = {
      sendMessage: vi.fn().mockResolvedValue({ success: false, error: 'boom' }),
    };

    const { result } = renderHook(() => useChatMessageSender({ chatService }));

    await act(async () => {
      await result.current.sendMessage({
        conversationId: 'conv-1',
        message: 'hello',
      });
    });

    expect(result.current.lastError).toBe('boom');
  });

  it('returns default error when service is unavailable', async () => {
    const { result } = renderHook(() => useChatMessageSender({ chatService: null }));

    let response: Awaited<ReturnType<typeof result.current.sendMessage>> | null = null;
    await act(async () => {
      response = await result.current.sendMessage({
        conversationId: 'conv-1',
        message: 'hello',
      });
    });

    expect(response?.success).toBe(false);
    expect(response?.error).toContain('Chat service unavailable');
    expect(result.current.lastError).toContain('Chat service unavailable');
  });
});
