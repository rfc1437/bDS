/**
 * Tests for SSE streaming infrastructure (PR 1)
 *
 * Covers:
 * - SSE line parsing (buffering partial lines across TCP chunks)
 * - OpenAI/Mistral SSE event parsing (text deltas, tool calls, usage, [DONE])
 * - Anthropic SSE event parsing (message_start, content_block_delta, etc.)
 * - Tool-call argument accumulation during streaming
 * - Error handling (mid-stream errors, non-2xx status, abort)
 * - Retry with exponential backoff (429/502/503, Retry-After, no retry on 4xx/abort)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import {
  parseSSELines,
  parseOpenAIStreamEvent,
  parseAnthropicStreamEvent,
  withRetry,
  httpRequestStream,
  type SSEEvent,
  type OpenAIStreamAccumulator,
  type AnthropicStreamAccumulator,
  createOpenAIStreamAccumulator,
  createAnthropicStreamAccumulator,
} from '../../src/main/engine/streaming';

// ── SSE Line Parsing ──

describe('parseSSELines', () => {
  it('parses a complete SSE event from a single chunk', () => {
    const buffer = '';
    const chunk = 'data: {"id":"1","choices":[{"delta":{"content":"Hello"}}]}\n\n';
    const { events, remaining } = parseSSELines(buffer + chunk);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ event: undefined, data: '{"id":"1","choices":[{"delta":{"content":"Hello"}}]}' });
    expect(remaining).toBe('');
  });

  it('handles partial lines across TCP chunks', () => {
    // First chunk ends mid-line
    const chunk1 = 'data: {"id":"1","cho';
    const { events: events1, remaining: rem1 } = parseSSELines(chunk1);
    expect(events1).toHaveLength(0);
    expect(rem1).toBe('data: {"id":"1","cho');

    // Second chunk completes the line
    const chunk2 = 'ices":[{"delta":{"content":"Hello"}}]}\n\n';
    const { events: events2, remaining: rem2 } = parseSSELines(rem1 + chunk2);
    expect(events2).toHaveLength(1);
    expect(events2[0].data).toBe('{"id":"1","choices":[{"delta":{"content":"Hello"}}]}');
    expect(rem2).toBe('');
  });

  it('handles multiple events in a single chunk', () => {
    const chunk = 'data: {"a":1}\n\ndata: {"b":2}\n\n';
    const { events, remaining } = parseSSELines(chunk);
    expect(events).toHaveLength(2);
    expect(events[0].data).toBe('{"a":1}');
    expect(events[1].data).toBe('{"b":2}');
    expect(remaining).toBe('');
  });

  it('handles named event types (Anthropic format)', () => {
    const chunk = 'event: message_start\ndata: {"type":"message_start"}\n\n';
    const { events, remaining } = parseSSELines(chunk);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('message_start');
    expect(events[0].data).toBe('{"type":"message_start"}');
    expect(remaining).toBe('');
  });

  it('handles [DONE] sentinel', () => {
    const chunk = 'data: [DONE]\n\n';
    const { events, remaining } = parseSSELines(chunk);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('[DONE]');
    expect(remaining).toBe('');
  });

  it('ignores empty data lines (keep-alive pings)', () => {
    const chunk = ':\n\ndata: {"a":1}\n\n';
    const { events, remaining } = parseSSELines(chunk);
    // The comment line ':' should be ignored
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"a":1}');
    expect(remaining).toBe('');
  });

  it('handles multiple data lines for a single event (concatenation per SSE spec)', () => {
    const chunk = 'data: line1\ndata: line2\n\n';
    const { events, remaining } = parseSSELines(chunk);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('line1\nline2');
    expect(remaining).toBe('');
  });

  it('returns incomplete data as remaining buffer', () => {
    const chunk = 'data: {"partial';
    const { events, remaining } = parseSSELines(chunk);
    expect(events).toHaveLength(0);
    expect(remaining).toBe('data: {"partial');
  });

  it('handles \\r\\n line endings', () => {
    const chunk = 'data: {"a":1}\r\n\r\n';
    const { events, remaining } = parseSSELines(chunk);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"a":1}');
    expect(remaining).toBe('');
  });
});

// ── OpenAI/Mistral Stream Event Parsing ──

describe('parseOpenAIStreamEvent', () => {
  let accumulator: OpenAIStreamAccumulator;

  beforeEach(() => {
    accumulator = createOpenAIStreamAccumulator();
  });

  it('extracts text delta from content field', () => {
    const event: SSEEvent = {
      data: JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ delta: { content: 'Hello' }, index: 0 }],
      }),
    };
    const result = parseOpenAIStreamEvent(event, accumulator);
    expect(result.textDelta).toBe('Hello');
    expect(result.done).toBe(false);
  });

  it('accumulates tool call start (id + name)', () => {
    const event: SSEEvent = {
      data: JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_abc',
              function: { name: 'search_posts', arguments: '' },
            }],
          },
          index: 0,
        }],
      }),
    };
    const result = parseOpenAIStreamEvent(event, accumulator);
    expect(result.textDelta).toBeUndefined();
    expect(accumulator.toolCalls.get(0)).toEqual({
      id: 'call_abc',
      name: 'search_posts',
      arguments: '',
    });
  });

  it('accumulates tool call argument fragments', () => {
    // First event: tool call start
    parseOpenAIStreamEvent({
      data: JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0, id: 'call_abc',
              function: { name: 'search_posts', arguments: '' },
            }],
          },
          index: 0,
        }],
      }),
    }, accumulator);

    // Second event: argument fragment
    parseOpenAIStreamEvent({
      data: JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: '{"query"' },
            }],
          },
          index: 0,
        }],
      }),
    }, accumulator);

    // Third event: more arguments
    parseOpenAIStreamEvent({
      data: JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: ': "test"}' },
            }],
          },
          index: 0,
        }],
      }),
    }, accumulator);

    expect(accumulator.toolCalls.get(0)?.arguments).toBe('{"query": "test"}');
  });

  it('handles multiple concurrent tool calls', () => {
    // Tool call 0
    parseOpenAIStreamEvent({
      data: JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [
              { index: 0, id: 'call_1', function: { name: 'search_posts', arguments: '{"q":"a"}' } },
              { index: 1, id: 'call_2', function: { name: 'list_posts', arguments: '{"limit":5}' } },
            ],
          },
          index: 0,
        }],
      }),
    }, accumulator);

    expect(accumulator.toolCalls.get(0)?.name).toBe('search_posts');
    expect(accumulator.toolCalls.get(1)?.name).toBe('list_posts');
  });

  it('detects finish_reason stop', () => {
    const event: SSEEvent = {
      data: JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
      }),
    };
    const result = parseOpenAIStreamEvent(event, accumulator);
    expect(result.finishReason).toBe('stop');
  });

  it('detects finish_reason tool_calls', () => {
    const event: SSEEvent = {
      data: JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'tool_calls', index: 0 }],
      }),
    };
    const result = parseOpenAIStreamEvent(event, accumulator);
    expect(result.finishReason).toBe('tool_calls');
  });

  it('extracts token usage from final chunk', () => {
    const event: SSEEvent = {
      data: JSON.stringify({
        choices: [{ delta: {}, index: 0 }],
        usage: {
          prompt_tokens: 150,
          completion_tokens: 42,
          total_tokens: 192,
        },
      }),
    };
    const result = parseOpenAIStreamEvent(event, accumulator);
    expect(result.usage).toEqual({
      promptTokens: 150,
      completionTokens: 42,
      totalTokens: 192,
    });
  });

  it('handles [DONE] sentinel', () => {
    const event: SSEEvent = { data: '[DONE]' };
    const result = parseOpenAIStreamEvent(event, accumulator);
    expect(result.done).toBe(true);
  });

  it('returns empty result for empty content delta', () => {
    const event: SSEEvent = {
      data: JSON.stringify({
        choices: [{ delta: { content: '' }, index: 0 }],
      }),
    };
    const result = parseOpenAIStreamEvent(event, accumulator);
    expect(result.textDelta).toBeUndefined();
  });
});

// ── Anthropic Stream Event Parsing ──

describe('parseAnthropicStreamEvent', () => {
  let accumulator: AnthropicStreamAccumulator;

  beforeEach(() => {
    accumulator = createAnthropicStreamAccumulator();
  });

  it('extracts input_tokens from message_start', () => {
    const event: SSEEvent = {
      event: 'message_start',
      data: JSON.stringify({
        type: 'message_start',
        message: {
          id: 'msg_1',
          model: 'claude-sonnet-4-5',
          usage: {
            input_tokens: 150,
            cache_read_input_tokens: 50,
            cache_creation_input_tokens: 10,
          },
        },
      }),
    };
    const result = parseAnthropicStreamEvent(event, accumulator);
    expect(result.usage).toEqual({
      inputTokens: 150,
      cacheReadTokens: 50,
      cacheWriteTokens: 10,
    });
  });

  it('handles text content_block_start (no-op)', () => {
    const event: SSEEvent = {
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
    };
    const result = parseAnthropicStreamEvent(event, accumulator);
    expect(result.textDelta).toBeUndefined();
  });

  it('handles tool_use content_block_start', () => {
    const event: SSEEvent = {
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_abc', name: 'search_posts' },
      }),
    };
    const result = parseAnthropicStreamEvent(event, accumulator);
    expect(result.textDelta).toBeUndefined();
    expect(accumulator.toolCalls.get(1)).toEqual({
      id: 'toolu_abc',
      name: 'search_posts',
      arguments: '',
    });
  });

  it('extracts text_delta from content_block_delta', () => {
    const event: SSEEvent = {
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello world' },
      }),
    };
    const result = parseAnthropicStreamEvent(event, accumulator);
    expect(result.textDelta).toBe('Hello world');
  });

  it('accumulates tool input_json_delta fragments', () => {
    // Start tool block
    parseAnthropicStreamEvent({
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_abc', name: 'search_posts' },
      }),
    }, accumulator);

    // First argument fragment
    parseAnthropicStreamEvent({
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"query"' },
      }),
    }, accumulator);

    // Second argument fragment
    parseAnthropicStreamEvent({
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: ': "test"}' },
      }),
    }, accumulator);

    expect(accumulator.toolCalls.get(1)?.arguments).toBe('{"query": "test"}');
  });

  it('extracts output_tokens from message_delta', () => {
    const event: SSEEvent = {
      event: 'message_delta',
      data: JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 42 },
      }),
    };
    const result = parseAnthropicStreamEvent(event, accumulator);
    expect(result.usage).toEqual({ outputTokens: 42 });
    expect(result.finishReason).toBe('end_turn');
  });

  it('signals done on message_stop', () => {
    const event: SSEEvent = {
      event: 'message_stop',
      data: JSON.stringify({ type: 'message_stop' }),
    };
    const result = parseAnthropicStreamEvent(event, accumulator);
    expect(result.done).toBe(true);
  });

  it('ignores ping events', () => {
    const event: SSEEvent = {
      event: 'ping',
      data: JSON.stringify({ type: 'ping' }),
    };
    const result = parseAnthropicStreamEvent(event, accumulator);
    expect(result.textDelta).toBeUndefined();
    expect(result.done).toBe(false);
  });

  it('throws on error events', () => {
    const event: SSEEvent = {
      event: 'error',
      data: JSON.stringify({
        type: 'error',
        error: { type: 'overloaded_error', message: 'Server is overloaded' },
      }),
    };
    expect(() => parseAnthropicStreamEvent(event, accumulator)).toThrow('Server is overloaded');
  });

  it('signals tool_use finish reason from message_delta', () => {
    const event: SSEEvent = {
      event: 'message_delta',
      data: JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 10 },
      }),
    };
    const result = parseAnthropicStreamEvent(event, accumulator);
    expect(result.finishReason).toBe('tool_use');
  });

  it('handles thinking content_block_start', () => {
    const event: SSEEvent = {
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      }),
    };
    const result = parseAnthropicStreamEvent(event, accumulator);
    expect(result.textDelta).toBeUndefined();
    expect(accumulator.thinkingBlocks.get(0)).toEqual({ text: '' });
  });

  it('accumulates thinking_delta fragments', () => {
    // Start thinking block
    parseAnthropicStreamEvent({
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      }),
    }, accumulator);

    // First thinking fragment
    parseAnthropicStreamEvent({
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Let me think' },
      }),
    }, accumulator);

    // Second thinking fragment
    parseAnthropicStreamEvent({
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: ' about this...' },
      }),
    }, accumulator);

    expect(accumulator.thinkingBlocks.get(0)?.text).toBe('Let me think about this...');
  });

  it('does not emit thinking_delta as textDelta', () => {
    // Start thinking block
    parseAnthropicStreamEvent({
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      }),
    }, accumulator);

    const result = parseAnthropicStreamEvent({
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Internal reasoning' },
      }),
    }, accumulator);

    // thinking_delta must NOT leak to textDelta — it's internal model reasoning
    expect(result.textDelta).toBeUndefined();
  });

  it('accumulates thinking and text blocks independently', () => {
    // Thinking block at index 0
    parseAnthropicStreamEvent({
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      }),
    }, accumulator);

    parseAnthropicStreamEvent({
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Reasoning...' },
      }),
    }, accumulator);

    // Text block at index 1
    const textResult = parseAnthropicStreamEvent({
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'Here is my answer' },
      }),
    }, accumulator);

    // Thinking accumulated separately
    expect(accumulator.thinkingBlocks.get(0)?.text).toBe('Reasoning...');
    // Text still emitted as textDelta
    expect(textResult.textDelta).toBe('Here is my answer');
  });
});

// ── Tool Call Accumulation ──

describe('tool call accumulation', () => {
  it('OpenAI: builds complete tool calls from fragments', () => {
    const acc = createOpenAIStreamAccumulator();

    // Start
    parseOpenAIStreamEvent({
      data: JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0, id: 'call_1',
              function: { name: 'search_posts', arguments: '' },
            }],
          },
          index: 0,
        }],
      }),
    }, acc);

    // Fragments
    for (const frag of ['{"', 'query', '": "', 'hello', '"}']) {
      parseOpenAIStreamEvent({
        data: JSON.stringify({
          choices: [{
            delta: { tool_calls: [{ index: 0, function: { arguments: frag } }] },
            index: 0,
          }],
        }),
      }, acc);
    }

    const tc = acc.toolCalls.get(0)!;
    expect(tc.id).toBe('call_1');
    expect(tc.name).toBe('search_posts');
    expect(JSON.parse(tc.arguments)).toEqual({ query: 'hello' });
  });

  it('Anthropic: builds complete tool calls from fragments', () => {
    const acc = createAnthropicStreamAccumulator();

    // Start block
    parseAnthropicStreamEvent({
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'list_posts' },
      }),
    }, acc);

    // Fragments
    for (const frag of ['{"', 'limit', '": ', '5}']) {
      parseAnthropicStreamEvent({
        event: 'content_block_delta',
        data: JSON.stringify({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: frag },
        }),
      }, acc);
    }

    const tc = acc.toolCalls.get(1)!;
    expect(tc.id).toBe('toolu_1');
    expect(tc.name).toBe('list_posts');
    expect(JSON.parse(tc.arguments)).toEqual({ limit: 5 });
  });
});

// ── Retry with Exponential Backoff ──

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('returns result on first successful call', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const promise = withRetry(fn, { maxRetries: 3 });
    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 status and succeeds', async () => {
    const error429 = Object.assign(new Error('Rate limited'), { statusCode: 429 });
    const fn = vi.fn()
      .mockRejectedValueOnce(error429)
      .mockResolvedValue('success');

    const promise = withRetry(fn, { maxRetries: 3 });
    // Advance past the retry delay
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 502 status', async () => {
    const error502 = Object.assign(new Error('Bad Gateway'), { statusCode: 502 });
    const fn = vi.fn()
      .mockRejectedValueOnce(error502)
      .mockResolvedValue('ok');

    const promise = withRetry(fn, { maxRetries: 3 });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 503 status', async () => {
    const error503 = Object.assign(new Error('Service Unavailable'), { statusCode: 503 });
    const fn = vi.fn()
      .mockRejectedValueOnce(error503)
      .mockResolvedValue('ok');

    const promise = withRetry(fn, { maxRetries: 3 });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 400 status', async () => {
    const error400 = Object.assign(new Error('Bad Request'), { statusCode: 400 });
    const fn = vi.fn().mockRejectedValue(error400);

    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow('Bad Request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 401 status', async () => {
    const error401 = Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    const fn = vi.fn().mockRejectedValue(error401);

    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow('Unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 403 status', async () => {
    const error403 = Object.assign(new Error('Forbidden'), { statusCode: 403 });
    const fn = vi.fn().mockRejectedValue(error403);

    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow('Forbidden');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on abort', async () => {
    const abortError = Object.assign(new Error('Request cancelled'), { isAbort: true });
    const fn = vi.fn().mockRejectedValue(abortError);

    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow('Request cancelled');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts max retries and throws last error', async () => {
    vi.useRealTimers(); // Real timers work better for this test
    const error429 = Object.assign(new Error('Rate limited'), { statusCode: 429 });
    let callCount = 0;
    const fn = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.reject(error429);
    });

    await expect(withRetry(fn, { maxRetries: 2 })).rejects.toThrow('Rate limited');
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    vi.useFakeTimers(); // Restore for afterEach
  });

  it('respects Retry-After header for 429', async () => {
    const error429 = Object.assign(new Error('Rate limited'), {
      statusCode: 429,
      retryAfter: 5,
    });
    const fn = vi.fn()
      .mockRejectedValueOnce(error429)
      .mockResolvedValue('ok');

    const promise = withRetry(fn, { maxRetries: 3 });
    // Should NOT have retried yet at 3 seconds (Retry-After is 5)
    await vi.advanceTimersByTimeAsync(3000);
    expect(fn).toHaveBeenCalledTimes(1);
    // Advance past the Retry-After
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

// ── Full stream-to-result integration ──

describe('stream event sequences', () => {
  it('OpenAI: processes a complete text response stream', () => {
    const acc = createOpenAIStreamAccumulator();
    const textChunks: string[] = [];

    const events: SSEEvent[] = [
      { data: JSON.stringify({ choices: [{ delta: { role: 'assistant' }, index: 0 }] }) },
      { data: JSON.stringify({ choices: [{ delta: { content: 'Hello' }, index: 0 }] }) },
      { data: JSON.stringify({ choices: [{ delta: { content: ' world' }, index: 0 }] }) },
      { data: JSON.stringify({ choices: [{ delta: { content: '!' }, index: 0 }] }) },
      { data: JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop', index: 0 }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }) },
      { data: '[DONE]' },
    ];

    for (const event of events) {
      const result = parseOpenAIStreamEvent(event, acc);
      if (result.textDelta) textChunks.push(result.textDelta);
    }

    expect(textChunks.join('')).toBe('Hello world!');
  });

  it('Anthropic: processes a complete text response stream', () => {
    const acc = createAnthropicStreamAccumulator();
    const textChunks: string[] = [];

    const events: SSEEvent[] = [
      { event: 'message_start', data: JSON.stringify({ type: 'message_start', message: { id: 'msg_1', model: 'claude-sonnet-4', usage: { input_tokens: 100 } } }) },
      { event: 'content_block_start', data: JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) },
      { event: 'content_block_delta', data: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }) },
      { event: 'content_block_delta', data: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world!' } }) },
      { event: 'content_block_stop', data: JSON.stringify({ type: 'content_block_stop', index: 0 }) },
      { event: 'message_delta', data: JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }) },
      { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) },
    ];

    for (const event of events) {
      const result = parseAnthropicStreamEvent(event, acc);
      if (result.textDelta) textChunks.push(result.textDelta);
    }

    expect(textChunks.join('')).toBe('Hello world!');
  });

  it('OpenAI: processes a tool call response stream', () => {
    const acc = createOpenAIStreamAccumulator();

    const events: SSEEvent[] = [
      { data: JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search_posts', arguments: '' } }] }, index: 0 }] }) },
      { data: JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query"' } }] }, index: 0 }] }) },
      { data: JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ': "test"}' } }] }, index: 0 }] }) },
      { data: JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls', index: 0 }] }) },
      { data: '[DONE]' },
    ];

    for (const event of events) {
      parseOpenAIStreamEvent(event, acc);
    }

    expect(acc.toolCalls.size).toBe(1);
    const tc = acc.toolCalls.get(0)!;
    expect(tc.name).toBe('search_posts');
    expect(JSON.parse(tc.arguments)).toEqual({ query: 'test' });
  });

  it('Anthropic: processes a tool call response stream', () => {
    const acc = createAnthropicStreamAccumulator();

    const events: SSEEvent[] = [
      { event: 'message_start', data: JSON.stringify({ type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 100 } } }) },
      { event: 'content_block_start', data: JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) },
      { event: 'content_block_delta', data: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me search.' } }) },
      { event: 'content_block_stop', data: JSON.stringify({ type: 'content_block_stop', index: 0 }) },
      { event: 'content_block_start', data: JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'search_posts' } }) },
      { event: 'content_block_delta', data: JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query": "test"}' } }) },
      { event: 'content_block_stop', data: JSON.stringify({ type: 'content_block_stop', index: 1 }) },
      { event: 'message_delta', data: JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } }) },
      { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) },
    ];

    const textChunks: string[] = [];
    for (const event of events) {
      const result = parseAnthropicStreamEvent(event, acc);
      if (result.textDelta) textChunks.push(result.textDelta);
    }

    expect(textChunks.join('')).toBe('Let me search.');
    expect(acc.toolCalls.size).toBe(1);
    const tc = acc.toolCalls.get(1)!;
    expect(tc.name).toBe('search_posts');
    expect(JSON.parse(tc.arguments)).toEqual({ query: 'test' });
  });
});

// ── JSON Parse Error Resilience ──

describe('parser JSON error resilience', () => {
  it('OpenAI: skips corrupted SSE events with invalid JSON', () => {
    const acc = createOpenAIStreamAccumulator();
    const event: SSEEvent = { data: '{corrupted json' };
    const result = parseOpenAIStreamEvent(event, acc);
    expect(result.done).toBe(false);
    expect(result.textDelta).toBeUndefined();
  });

  it('OpenAI: recovers from corrupted event and processes subsequent valid events', () => {
    const acc = createOpenAIStreamAccumulator();

    // Corrupted event
    parseOpenAIStreamEvent({ data: 'not-json' }, acc);

    // Valid event after corruption
    const result = parseOpenAIStreamEvent({
      data: JSON.stringify({ choices: [{ delta: { content: 'OK' }, index: 0 }] }),
    }, acc);
    expect(result.textDelta).toBe('OK');
  });

  it('Anthropic: skips corrupted SSE events with invalid JSON', () => {
    const acc = createAnthropicStreamAccumulator();
    const event: SSEEvent = { event: 'content_block_delta', data: '{broken' };
    const result = parseAnthropicStreamEvent(event, acc);
    expect(result.done).toBe(false);
    expect(result.textDelta).toBeUndefined();
  });

  it('Anthropic: recovers from corrupted event and processes subsequent valid events', () => {
    const acc = createAnthropicStreamAccumulator();

    // Corrupted event
    parseAnthropicStreamEvent({ event: 'ping', data: 'not-json' }, acc);

    // Valid event after corruption
    const result = parseAnthropicStreamEvent({
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Recovered' },
      }),
    }, acc);
    expect(result.textDelta).toBe('Recovered');
  });
});

// ── OpenAI Cache Token Extraction ──

describe('OpenAI cache token extraction', () => {
  it('extracts cached_tokens from prompt_tokens_details', () => {
    const acc = createOpenAIStreamAccumulator();
    const event: SSEEvent = {
      data: JSON.stringify({
        choices: [{ delta: {}, index: 0 }],
        usage: {
          prompt_tokens: 150,
          completion_tokens: 42,
          total_tokens: 192,
          prompt_tokens_details: { cached_tokens: 100 },
        },
      }),
    };
    const result = parseOpenAIStreamEvent(event, acc);
    expect(result.usage).toEqual({
      promptTokens: 150,
      completionTokens: 42,
      totalTokens: 192,
      cacheReadTokens: 100,
    });
  });

  it('returns undefined cacheReadTokens when prompt_tokens_details is absent', () => {
    const acc = createOpenAIStreamAccumulator();
    const event: SSEEvent = {
      data: JSON.stringify({
        choices: [{ delta: {}, index: 0 }],
        usage: {
          prompt_tokens: 150,
          completion_tokens: 42,
          total_tokens: 192,
        },
      }),
    };
    const result = parseOpenAIStreamEvent(event, acc);
    expect(result.usage?.cacheReadTokens).toBeUndefined();
  });
});

// ── httpRequestStream ──

describe('httpRequestStream', () => {
  // Use a real HTTP server for integration tests (avoids ESM spyOn limitations)

  function startTestServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
    return new Promise((resolve) => {
      const server = http.createServer(handler);
      server.listen(0, () => {
        const addr = server.address() as { port: number };
        resolve({
          url: `http://localhost:${addr.port}`,
          close: () => new Promise<void>((r) => server.close(() => r())),
        });
      });
    });
  }

  it('parses streamed SSE events from response data chunks', async () => {
    const srv = await startTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":" world"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    try {
      const { events } = await httpRequestStream(srv.url, { method: 'POST', body: '{}' });
      const collected: SSEEvent[] = [];
      for await (const event of events) {
        collected.push(event);
      }
      expect(collected).toHaveLength(3);
      expect(collected[0].data).toBe('{"choices":[{"delta":{"content":"Hello"}}]}');
      expect(collected[1].data).toBe('{"choices":[{"delta":{"content":" world"}}]}');
      expect(collected[2].data).toBe('[DONE]');
    } finally {
      await srv.close();
    }
  });

  it('collects error body and rejects on non-2xx status', async () => {
    const srv = await startTestServer((_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
      res.end(JSON.stringify({ error: { message: 'Rate limited' } }));
    });

    try {
      await expect(httpRequestStream(srv.url, {})).rejects.toMatchObject({
        message: 'Rate limited',
        statusCode: 429,
        retryAfter: 5,
      });
    } finally {
      await srv.close();
    }
  });

  it('propagates mid-stream errors to async iterable consumer', async () => {
    const srv = await startTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n');
      // Destroy the socket to simulate TCP disconnect
      setTimeout(() => res.destroy(), 20);
    });

    try {
      const { events } = await httpRequestStream(srv.url, {});
      const collected: SSEEvent[] = [];
      await expect(async () => {
        for await (const event of events) {
          collected.push(event);
        }
      }).rejects.toThrow();

      // Should have received the first event before the error
      expect(collected).toHaveLength(1);
      expect(collected[0].data).toBe('{"choices":[{"delta":{"content":"Hi"}}]}');
    } finally {
      await srv.close();
    }
  });

  it('propagates stored error when no consumer was waiting (pendingError fix)', async () => {
    const srv = await startTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // Send data and immediately destroy — error fires before consumer calls .next()
      res.write('data: {"ok":true}\n\n');
      // Give a tiny delay so the data event fires first
      setTimeout(() => res.destroy(), 5);
    });

    try {
      const { events } = await httpRequestStream(srv.url, {});
      const iter = events[Symbol.asyncIterator]();

      // Wait a bit for both data and error to fire
      await new Promise(resolve => setTimeout(resolve, 50));

      // First call should return the queued event
      const first = await iter.next();
      expect(first.done).toBe(false);
      expect(first.value.data).toBe('{"ok":true}');

      // Second call should throw the stored (pending) error
      await expect(iter.next()).rejects.toThrow();
    } finally {
      await srv.close();
    }
  });

  it('handles already-aborted signal', async () => {
    // No server needed — should reject immediately
    const controller = new AbortController();
    controller.abort();

    await expect(httpRequestStream('http://localhost:1/test', {
      signal: controller.signal,
    })).rejects.toMatchObject({
      isAbort: true,
    });
  });

  it('handles non-JSON error body', async () => {
    const srv = await startTestServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    });

    try {
      await expect(httpRequestStream(srv.url, {})).rejects.toMatchObject({
        statusCode: 500,
      });
    } finally {
      await srv.close();
    }
  });
});

// ── withRetry onRetry callback ──

describe('withRetry onRetry callback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onRetry callback before each retry attempt', async () => {
    const error429 = Object.assign(new Error('Rate limited'), { statusCode: 429 });
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(error429)
      .mockRejectedValueOnce(error429)
      .mockResolvedValue('success');

    const promise = withRetry(fn, { maxRetries: 3, onRetry });
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;

    expect(result).toBe('success');
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, error429);
    expect(onRetry).toHaveBeenCalledWith(2, error429);
  });

  it('does not call onRetry when first attempt succeeds', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 3, onRetry });

    expect(result).toBe('ok');
    expect(onRetry).not.toHaveBeenCalled();
  });
});

// ── Mid-stream retry integration ──

describe('mid-stream retry with withRetry', () => {
  it('retries stream consumption on transient mid-stream error', async () => {
    vi.useRealTimers();

    let attempt = 0;
    const fn = async () => {
      attempt++;
      if (attempt === 1) {
        // First attempt: simulate partial stream then error
        const error = Object.assign(new Error('Service temporarily unavailable'), { statusCode: 503 });
        throw error;
      }
      // Second attempt: succeed
      return { text: 'Hello world!', toolCalls: [] };
    };

    const result = await withRetry(fn, { maxRetries: 2 });
    expect(result).toEqual({ text: 'Hello world!', toolCalls: [] });
    expect(attempt).toBe(2);
  });

  it('retries on mid-stream TCP error (no status code)', async () => {
    vi.useRealTimers();

    let attempt = 0;
    const fn = async () => {
      attempt++;
      if (attempt === 1) {
        throw new Error('ECONNRESET');
      }
      return 'recovered';
    };

    const result = await withRetry(fn, { maxRetries: 2 });
    expect(result).toBe('recovered');
    expect(attempt).toBe(2);
  });

  it('does not retry mid-stream abort errors', async () => {
    const abortError = Object.assign(new Error('Request cancelled'), { isAbort: true });

    let attempt = 0;
    const fn = async () => {
      attempt++;
      throw abortError;
    };

    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow('Request cancelled');
    expect(attempt).toBe(1);
  });
});

// ── Connection-only retry (no double-emission) ──

describe('connection-only retry pattern (withRetry wrapping httpRequestStream)', () => {
  function startTestServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
    return new Promise((resolve) => {
      const server = http.createServer(handler);
      server.listen(0, () => {
        const addr = server.address() as { port: number };
        resolve({
          url: `http://localhost:${addr.port}`,
          close: () => new Promise<void>((r) => server.close(() => r())),
        });
      });
    });
  }

  it('retries 429 at connection time without emitting duplicate deltas', async () => {
    let requestCount = 0;
    const srv = await startTestServer((_req, res) => {
      requestCount++;
      if (requestCount === 1) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' });
        res.end(JSON.stringify({ error: { message: 'Rate limited' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":" world"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    try {
      const deltas: string[] = [];

      // Retry only the connection, process events outside retry
      const { events } = await withRetry(() => httpRequestStream(srv.url, { method: 'POST', body: '{}' }));

      const acc = createOpenAIStreamAccumulator();
      for await (const event of events) {
        const result = parseOpenAIStreamEvent(event, acc);
        if (result.textDelta) deltas.push(result.textDelta);
      }

      // Each delta appears exactly once — no double-emission
      expect(deltas).toEqual(['Hello', ' world']);
      expect(requestCount).toBe(2); // 1 failed + 1 success
    } finally {
      await srv.close();
    }
  });

  it('mid-stream TCP error propagates without retry when only connection is wrapped', async () => {
    const srv = await startTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n');
      // Destroy socket to simulate mid-stream TCP disconnect
      setTimeout(() => res.destroy(), 20);
    });

    try {
      const deltas: string[] = [];

      // Only connection is retried — mid-stream errors propagate
      const { events } = await withRetry(() => httpRequestStream(srv.url, { method: 'POST', body: '{}' }));

      const acc = createOpenAIStreamAccumulator();
      await expect(async () => {
        for await (const event of events) {
          const result = parseOpenAIStreamEvent(event, acc);
          if (result.textDelta) deltas.push(result.textDelta);
        }
      }).rejects.toThrow();

      // Partial delta was received before the error — no duplication
      expect(deltas).toEqual(['Hi']);
    } finally {
      await srv.close();
    }
  });

  it('retries 502 at connection time then streams successfully', async () => {
    let requestCount = 0;
    const srv = await startTestServer((_req, res) => {
      requestCount++;
      if (requestCount === 1) {
        res.writeHead(502);
        res.end('Bad Gateway');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10}}}\n\n');
      res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}\n\n');
      res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
      res.end();
    });

    try {
      const deltas: string[] = [];

      const { events } = await withRetry(() => httpRequestStream(srv.url, { method: 'POST', body: '{}' }));

      const acc = createAnthropicStreamAccumulator();
      for await (const event of events) {
        const result = parseAnthropicStreamEvent(event, acc);
        if (result.textDelta) deltas.push(result.textDelta);
      }

      expect(deltas).toEqual(['OK']);
      expect(requestCount).toBe(2);
    } finally {
      await srv.close();
    }
  });
});

// ── SSE spec compliance ──

describe('SSE spec compliance - single space removal', () => {
  it('removes exactly one leading space after colon in data field', () => {
    const chunk = 'data: {"key": "value"}\n\n';
    const { events } = parseSSELines(chunk);
    expect(events[0].data).toBe('{"key": "value"}');
  });

  it('preserves data when no space after colon', () => {
    const chunk = 'data:{"key":"value"}\n\n';
    const { events } = parseSSELines(chunk);
    expect(events[0].data).toBe('{"key":"value"}');
  });

  it('preserves extra leading spaces after removing one', () => {
    const chunk = 'data:  two spaces\n\n';
    const { events } = parseSSELines(chunk);
    // Per SSE spec: only one leading space is removed
    expect(events[0].data).toBe(' two spaces');
  });

  it('removes exactly one leading space from event type', () => {
    const chunk = 'event: message_start\ndata: {}\n\n';
    const { events } = parseSSELines(chunk);
    expect(events[0].event).toBe('message_start');
  });

  it('handles event type with no space after colon', () => {
    const chunk = 'event:ping\ndata: {}\n\n';
    const { events } = parseSSELines(chunk);
    expect(events[0].event).toBe('ping');
  });
});

// ── Async iterator return() cleanup ──

describe('async iterator return() cleanup', () => {
  function startTestServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
    return new Promise((resolve) => {
      const server = http.createServer(handler);
      server.listen(0, () => {
        const addr = server.address() as { port: number };
        resolve({
          url: `http://localhost:${addr.port}`,
          close: () => new Promise<void>((r) => server.close(() => r())),
        });
      });
    });
  }

  it('destroys response stream when for-await-of breaks early', async () => {
    const srv = await startTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"A"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"B"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"C"}}]}\n\n');
      // Don't end the response — the client should destroy it via return()
      // Keep connection alive for a bit
      setTimeout(() => res.end(), 5000);
    });

    try {
      const { events } = await httpRequestStream(srv.url, { method: 'POST', body: '{}' });
      const collected: SSEEvent[] = [];
      for await (const event of events) {
        collected.push(event);
        if (collected.length === 1) break; // Early exit triggers return()
      }

      expect(collected).toHaveLength(1);
      expect(collected[0].data).toBe('{"choices":[{"delta":{"content":"A"}}]}');
    } finally {
      await srv.close();
    }
  });

  it('return() method signals done and is idempotent', async () => {
    const srv = await startTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"ok":true}\n\n');
      setTimeout(() => res.end(), 5000);
    });

    try {
      const { events } = await httpRequestStream(srv.url, { method: 'POST', body: '{}' });
      const iter = events[Symbol.asyncIterator]();

      // Consume one event
      const first = await iter.next();
      expect(first.done).toBe(false);

      // Call return() explicitly
      const returnResult = await iter.return!(undefined as unknown as SSEEvent);
      expect(returnResult.done).toBe(true);

      // Subsequent next() should return done
      const after = await iter.next();
      expect(after.done).toBe(true);
    } finally {
      await srv.close();
    }
  });
});

// ── Thinking block signature capture ──

describe('Anthropic thinking block signature', () => {
  let accumulator: AnthropicStreamAccumulator;

  beforeEach(() => {
    accumulator = createAnthropicStreamAccumulator();
  });

  it('captures signature from content_block_stop for thinking blocks', () => {
    // Start thinking block
    parseAnthropicStreamEvent({
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      }),
    }, accumulator);

    // Accumulate thinking
    parseAnthropicStreamEvent({
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Let me reason...' },
      }),
    }, accumulator);

    // content_block_stop with signature
    parseAnthropicStreamEvent({
      event: 'content_block_stop',
      data: JSON.stringify({
        type: 'content_block_stop',
        index: 0,
        content_block: {
          type: 'thinking',
          thinking: 'Let me reason...',
          signature: 'ErUBCkYIAxgCIkD+ybfICm10kSig...',
        },
      }),
    }, accumulator);

    const tb = accumulator.thinkingBlocks.get(0);
    expect(tb).toBeDefined();
    expect(tb!.text).toBe('Let me reason...');
    expect(tb!.signature).toBe('ErUBCkYIAxgCIkD+ybfICm10kSig...');
  });

  it('leaves signature undefined when content_block_stop has no signature', () => {
    // Start thinking block
    parseAnthropicStreamEvent({
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      }),
    }, accumulator);

    // content_block_stop without signature
    parseAnthropicStreamEvent({
      event: 'content_block_stop',
      data: JSON.stringify({
        type: 'content_block_stop',
        index: 0,
      }),
    }, accumulator);

    const tb = accumulator.thinkingBlocks.get(0);
    expect(tb).toBeDefined();
    expect(tb!.signature).toBeUndefined();
  });

  it('does not affect tool_call blocks on content_block_stop', () => {
    // Start tool_use block
    parseAnthropicStreamEvent({
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'search_posts' },
      }),
    }, accumulator);

    // Tool argument fragment
    parseAnthropicStreamEvent({
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"query":"test"}' },
      }),
    }, accumulator);

    // content_block_stop (no signature for tool blocks)
    parseAnthropicStreamEvent({
      event: 'content_block_stop',
      data: JSON.stringify({
        type: 'content_block_stop',
        index: 0,
      }),
    }, accumulator);

    // Tool call should be unaffected
    const tc = accumulator.toolCalls.get(0);
    expect(tc).toBeDefined();
    expect(tc!.arguments).toBe('{"query":"test"}');
  });

  it('full thinking sequence produces signature on accumulator', () => {
    // Full realistic sequence: thinking block -> text block -> tool_use
    // Thinking at index 0
    parseAnthropicStreamEvent({
      event: 'content_block_start',
      data: JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
    }, accumulator);
    parseAnthropicStreamEvent({
      event: 'content_block_delta',
      data: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Step 1. ' } }),
    }, accumulator);
    parseAnthropicStreamEvent({
      event: 'content_block_delta',
      data: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Step 2.' } }),
    }, accumulator);
    parseAnthropicStreamEvent({
      event: 'content_block_stop',
      data: JSON.stringify({ type: 'content_block_stop', index: 0, content_block: { type: 'thinking', thinking: 'Step 1. Step 2.', signature: 'sig_abc123' } }),
    }, accumulator);

    expect(accumulator.thinkingBlocks.get(0)).toEqual({ text: 'Step 1. Step 2.', signature: 'sig_abc123' });
  });
});

// ── withRetry abort-aware delay ──

describe('withRetry abort during delay', () => {
  it('rejects quickly when signal is aborted during retry delay', async () => {
    const controller = new AbortController();
    const error429 = Object.assign(new Error('Rate limited'), { statusCode: 429 });
    const fn = vi.fn().mockRejectedValue(error429);

    const promise = withRetry(fn, {
      maxRetries: 3,
      signal: controller.signal,
    });

    // First attempt fails immediately, then enters retry delay.
    // Wait a small amount for the first attempt to fail and delay to start.
    await new Promise(r => setTimeout(r, 50));
    expect(fn).toHaveBeenCalledTimes(1);

    // Abort during the delay
    controller.abort();

    // Should reject with abort error, not wait for delay to finish
    await expect(promise).rejects.toThrow();
    // Should NOT have made a second attempt — aborted during delay
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not abort delay when no signal is provided', async () => {
    vi.useFakeTimers();
    const error429 = Object.assign(new Error('Rate limited'), { statusCode: 429 });
    const fn = vi.fn()
      .mockRejectedValueOnce(error429)
      .mockResolvedValue('ok');

    const promise = withRetry(fn, { maxRetries: 3 });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('works normally when signal is not aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const error429 = Object.assign(new Error('Rate limited'), { statusCode: 429 });
    const fn = vi.fn()
      .mockRejectedValueOnce(error429)
      .mockResolvedValue('ok');

    const promise = withRetry(fn, {
      maxRetries: 3,
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
