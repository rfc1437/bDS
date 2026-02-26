import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChatSurfaceState } from '../../../src/renderer/navigation/useChatSurfaceState';

describe('useChatSurfaceState', () => {
  it('tracks a full user-assistant turn including streaming and tool calls', () => {
    const { result } = renderHook(() => useChatSurfaceState());

    act(() => {
      result.current.beginUserTurn('conv-1', 'hello');
      result.current.appendStreamDelta('A');
      result.current.appendStreamDelta('B');
      result.current.recordToolCall('list_posts', { query: 'hello' });
      result.current.recordToolResult('list_posts');
      result.current.finalizeAssistantTurn('conv-1', 'AB');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].role).toBe('user');
    expect(result.current.messages[1].role).toBe('assistant');
    expect(result.current.messages[1].content).toBe('AB');
    expect(result.current.messages[1].toolCalls).toContain('list_posts');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingContent).toBe('');
  });

  it('aborts a stream into a partial assistant message', () => {
    const { result } = renderHook(() => useChatSurfaceState());

    act(() => {
      result.current.beginUserTurn('conv-2', 'hello');
      result.current.appendStreamDelta('partial content');
      result.current.abortStreaming('conv-2', 'Cancelled');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].content).toContain('partial content');
    expect(result.current.messages[1].content).toContain('Cancelled');
  });
});
