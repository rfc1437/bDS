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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseSSELines,
  parseOpenAIStreamEvent,
  parseAnthropicStreamEvent,
  withRetry,
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
