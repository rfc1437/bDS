/**
 * SSE Streaming Infrastructure
 *
 * Provides SSE line parsing, event parsers for OpenAI/Mistral and Anthropic
 * stream formats, tool-call accumulation, and retry-with-exponential-backoff.
 *
 * Used by OpenCodeManager to convert buffered HTTP calls to real-time
 * token-by-token streaming for all chat providers.
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';

// ── Types ──

export interface SSEEvent {
  event?: string;
  data: string;
}

export interface StreamEventResult {
  /** Text content delta to emit to UI */
  textDelta?: string;
  /** Whether the stream is complete */
  done: boolean;
  /** Finish reason from the model */
  finishReason?: string;
  /** Token usage information */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export interface OpenAIStreamAccumulator {
  toolCalls: Map<number, ToolCallAccumulator>;
}

export interface AnthropicStreamAccumulator {
  toolCalls: Map<number, ToolCallAccumulator>;
  thinkingBlocks: Map<number, { text: string }>;
}

export interface HttpStreamError extends Error {
  statusCode?: number;
  retryAfter?: number;
  isAbort?: boolean;
}

// ── SSE Line Parsing ──

/**
 * Parse raw SSE text into structured events.
 *
 * SSE protocol: events are separated by double-newlines (\n\n).
 * Each event can have `event:` and `data:` lines.
 * Multiple `data:` lines within one event are concatenated with newlines.
 * Lines starting with `:` are comments (ignored).
 *
 * Returns parsed events and any remaining incomplete text (buffer).
 */
export function parseSSELines(text: string): { events: SSEEvent[]; remaining: string } {
  const events: SSEEvent[] = [];

  // Normalize \r\n to \n
  const normalized = text.replace(/\r\n/g, '\n');

  // Split on double-newline (event boundary)
  const parts = normalized.split('\n\n');

  // Last part may be incomplete (no trailing \n\n)
  const remaining = normalized.endsWith('\n\n') ? '' : parts.pop() || '';

  for (const part of parts) {
    if (!part.trim()) continue;

    let eventType: string | undefined;
    const dataLines: string[] = [];

    for (const line of part.split('\n')) {
      // Comment lines start with ':'
      if (line.startsWith(':')) continue;

      if (line.startsWith('event: ') || line.startsWith('event:')) {
        const afterColon = line.slice(line.indexOf(':') + 1);
        eventType = afterColon.startsWith(' ') ? afterColon.slice(1) : afterColon;
      } else if (line.startsWith('data: ') || line.startsWith('data:')) {
        const afterColon = line.slice(line.indexOf(':') + 1);
        dataLines.push(afterColon.startsWith(' ') ? afterColon.slice(1) : afterColon);
      }
    }

    if (dataLines.length > 0) {
      events.push({
        event: eventType,
        data: dataLines.join('\n'),
      });
    }
  }

  return { events, remaining };
}

// ── Accumulator Factories ──

export function createOpenAIStreamAccumulator(): OpenAIStreamAccumulator {
  return { toolCalls: new Map() };
}

export function createAnthropicStreamAccumulator(): AnthropicStreamAccumulator {
  return { toolCalls: new Map(), thinkingBlocks: new Map() };
}

// ── OpenAI/Mistral SSE Parser ──

/**
 * Parse a single OpenAI/Mistral SSE event and update the accumulator.
 *
 * OpenAI streaming format:
 * - Text deltas: choices[0].delta.content
 * - Tool call start: delta.tool_calls[i] with id + function.name
 * - Tool call fragments: delta.tool_calls[i].function.arguments (append)
 * - Finish reason: choices[0].finish_reason
 * - Usage: usage object in final chunk (requires stream_options.include_usage)
 * - [DONE] sentinel: stop iteration
 */
export function parseOpenAIStreamEvent(
  event: SSEEvent,
  accumulator: OpenAIStreamAccumulator,
): StreamEventResult {
  // Handle [DONE] sentinel
  if (event.data === '[DONE]') {
    return { done: true };
  }

  let data: Record<string, unknown>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data = JSON.parse(event.data) as any;
  } catch {
    // Skip corrupted SSE events (e.g. partial JSON from TCP split)
    return { done: false };
  }
  const choice = (data as any).choices?.[0];
  const result: StreamEventResult = { done: false };

  if (choice) {
    const delta = choice.delta;

    // Text content delta
    if (delta?.content && delta.content.length > 0) {
      result.textDelta = delta.content;
    }

    // Tool calls
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        const existing = accumulator.toolCalls.get(idx);

        if (tc.id || tc.function?.name) {
          // New tool call or update
          if (!existing) {
            accumulator.toolCalls.set(idx, {
              id: tc.id || '',
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '',
            });
          } else {
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          }
        } else if (existing && tc.function?.arguments) {
          // Append argument fragment
          existing.arguments += tc.function.arguments;
        }
      }
    }

    // Finish reason
    if (choice.finish_reason) {
      result.finishReason = choice.finish_reason;
    }
  }

  // Token usage (arrives in final chunk with stream_options.include_usage)
  if ((data as any).usage) {
    const usage = (data as any).usage;
    const promptDetails = usage.prompt_tokens_details;
    result.usage = {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      cacheReadTokens: promptDetails?.cached_tokens,
    };
  }

  return result;
}

// ── Anthropic SSE Parser ──

/**
 * Parse a single Anthropic SSE event and update the accumulator.
 *
 * Anthropic streaming format uses named event types:
 * - message_start: input token usage
 * - content_block_start: text, tool_use, or thinking block begins
 * - content_block_delta: text_delta, input_json_delta, or thinking_delta
 * - content_block_stop: block ends
 * - message_delta: output tokens + stop_reason
 * - message_stop: stream complete
 * - ping: keep-alive (ignored)
 * - error: server error mid-stream
 */
export function parseAnthropicStreamEvent(
  event: SSEEvent,
  accumulator: AnthropicStreamAccumulator,
): StreamEventResult {
  let data: Record<string, unknown>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data = JSON.parse(event.data) as any;
  } catch {
    // Skip corrupted SSE events (e.g. partial JSON from TCP split)
    return { done: false };
  }
  const result: StreamEventResult = { done: false };

  switch (event.event) {
    case 'message_start': {
      const usage = (data as any).message?.usage;
      if (usage) {
        result.usage = {
          inputTokens: usage.input_tokens || 0,
          cacheReadTokens: usage.cache_read_input_tokens || 0,
          cacheWriteTokens: usage.cache_creation_input_tokens || 0,
        };
      }
      break;
    }

    case 'content_block_start': {
      const block = (data as any).content_block;
      if (block?.type === 'tool_use') {
        accumulator.toolCalls.set(data.index as number, {
          id: block.id,
          name: block.name,
          arguments: '',
        });
      } else if (block?.type === 'thinking') {
        accumulator.thinkingBlocks.set(data.index as number, { text: '' });
      }
      // text block start is a no-op (empty initial text)
      break;
    }

    case 'content_block_delta': {
      const delta = (data as any).delta;
      if (delta?.type === 'text_delta' && delta.text) {
        result.textDelta = delta.text;
      } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
        const tc = accumulator.toolCalls.get(data.index as number);
        if (tc) {
          tc.arguments += delta.partial_json;
        }
      } else if (delta?.type === 'thinking_delta' && delta.thinking) {
        const tb = accumulator.thinkingBlocks.get(data.index as number);
        if (tb) {
          tb.text += delta.thinking;
        }
      }
      break;
    }

    case 'content_block_stop':
      // Block is complete. Tool arguments can now be parsed by the caller.
      break;

    case 'message_delta': {
      if ((data as any).usage) {
        result.usage = {
          outputTokens: (data as any).usage.output_tokens || 0,
        };
      }
      if ((data as any).delta?.stop_reason) {
        result.finishReason = (data as any).delta.stop_reason;
      }
      break;
    }

    case 'message_stop':
      result.done = true;
      break;

    case 'ping':
      // Keep-alive, ignore
      break;

    case 'error': {
      const errorMsg = (data as any).error?.message || 'Unknown streaming error';
      throw new Error(errorMsg);
    }

    default:
      // Unknown event type, ignore
      break;
  }

  return result;
}

// ── Retry with Exponential Backoff ──

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503]);

/**
 * Retry a function with exponential backoff for transient HTTP errors.
 *
 * Retries on 429 (rate limit), 502 (bad gateway), 503 (service unavailable).
 * Also retries errors without a statusCode (e.g. ECONNRESET, EPIPE) since
 * these indicate transient network failures during connection.
 *
 * Does NOT retry on other 4xx errors (400, 401, 403 — client errors) or abort.
 * Respects Retry-After header for 429 responses.
 *
 * Best practice: wrap only the HTTP connection (httpRequestStream) in withRetry,
 * NOT the event processing loop. This ensures onDelta callbacks are never
 * called twice for the same text on retry.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; onRetry?: (attempt: number, error: Error) => void } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      const httpError = error as HttpStreamError;

      // Don't retry on abort
      if (httpError.isAbort || httpError.message === 'Request cancelled') {
        throw error;
      }

      // Don't retry on non-retryable status codes
      if (httpError.statusCode && !RETRYABLE_STATUS_CODES.has(httpError.statusCode)) {
        throw error;
      }

      // Don't retry if we've exhausted retries
      if (attempt >= maxRetries) {
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const baseDelay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      const jitter = Math.random() * 500;
      let delay = baseDelay + jitter;

      // Respect Retry-After header for 429
      if (httpError.retryAfter && httpError.retryAfter > 0) {
        delay = Math.max(delay, httpError.retryAfter * 1000);
      }

      if (options.onRetry) {
        options.onRetry(attempt + 1, lastError);
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ── HTTP Streaming Request ──

interface HttpStreamOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeout?: number;
}

/**
 * Make an HTTP request that returns an async iterable of SSE events.
 *
 * Uses Node.js http/https modules directly, reading the response
 * as a readable stream and parsing SSE events incrementally.
 *
 * On non-2xx status: collects the error body and throws.
 * Supports AbortSignal for cancellation.
 */
export function httpRequestStream(
  urlStr: string,
  options: HttpStreamOptions,
): Promise<{
  statusCode: number;
  events: AsyncIterable<SSEEvent>;
}> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const protocol = url.protocol === 'https:' ? https : http;
    const timeout = options.timeout ?? 120000;

    const req = protocol.request(url, {
      method: options.method || 'POST',
      headers: options.headers || {},
      timeout,
    }, (res) => {
      const statusCode = res.statusCode || 0;

      // Non-2xx: collect error body and throw
      if (statusCode < 200 || statusCode >= 300) {
        let errorBody = '';
        res.on('data', (chunk: Buffer) => { errorBody += chunk; });
        res.on('end', () => {
          const error: HttpStreamError = new Error(`API error: ${statusCode}`) as HttpStreamError;
          error.statusCode = statusCode;

          // Parse Retry-After for 429
          if (statusCode === 429) {
            const retryAfter = res.headers['retry-after'];
            if (retryAfter) {
              const seconds = parseInt(retryAfter, 10);
              if (!isNaN(seconds)) {
                error.retryAfter = seconds;
              }
            }
          }

          // Try to extract a better error message
          try {
            const parsed = JSON.parse(errorBody);
            error.message = parsed.error?.message || parsed.message || error.message;
          } catch {
            if (errorBody.length > 0) {
              error.message = `${error.message}: ${errorBody.slice(0, 200)}`;
            }
          }
          reject(error);
        });
        return;
      }

      // 2xx: create async iterable of SSE events
      const events: AsyncIterable<SSEEvent> = {
        [Symbol.asyncIterator]() {
          let buffer = '';
          let done = false;
          let pendingError: Error | null = null;
          const eventQueue: SSEEvent[] = [];
          let resolveNext: ((value: IteratorResult<SSEEvent>) => void) | null = null;
          let rejectNext: ((error: Error) => void) | null = null;

          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf-8');
            const { events: parsed, remaining } = parseSSELines(buffer);
            buffer = remaining;

            for (const event of parsed) {
              if (resolveNext) {
                const resolve = resolveNext;
                resolveNext = null;
                rejectNext = null;
                resolve({ value: event, done: false });
              } else {
                eventQueue.push(event);
              }
            }
          });

          res.on('end', () => {
            done = true;
            if (resolveNext) {
              const resolve = resolveNext;
              resolveNext = null;
              rejectNext = null;
              resolve({ value: undefined as unknown as SSEEvent, done: true });
            }
          });

          res.on('error', (err: Error) => {
            done = true;
            if (rejectNext) {
              const reject = rejectNext;
              resolveNext = null;
              rejectNext = null;
              reject(err);
            } else {
              // Store error for next .next() call so it's not silently swallowed
              pendingError = err;
            }
          });

          return {
            next(): Promise<IteratorResult<SSEEvent>> {
              // Return queued event immediately
              if (eventQueue.length > 0) {
                return Promise.resolve({ value: eventQueue.shift()!, done: false });
              }

              // Throw stored error from a previous event that fired with no consumer waiting
              if (pendingError) {
                const err = pendingError;
                pendingError = null;
                return Promise.reject(err);
              }

              // Stream already ended
              if (done) {
                return Promise.resolve({ value: undefined as unknown as SSEEvent, done: true });
              }

              // Wait for next event
              return new Promise<IteratorResult<SSEEvent>>((resolve, reject) => {
                resolveNext = resolve;
                rejectNext = reject;
              });
            },
            return(): Promise<IteratorResult<SSEEvent>> {
              // Called when for-await-of exits early (break, return, throw).
              // Destroy the response stream to free the socket immediately.
              done = true;
              res.destroy();
              return Promise.resolve({ value: undefined as unknown as SSEEvent, done: true });
            },
          };
        },
      };

      resolve({ statusCode, events });
    });

    req.on('error', (err: Error) => {
      const error: HttpStreamError = err as HttpStreamError;
      if (options.signal?.aborted) {
        error.isAbort = true;
      }
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (options.signal) {
      if (options.signal.aborted) {
        req.destroy();
        const error: HttpStreamError = new Error('Request cancelled') as HttpStreamError;
        error.isAbort = true;
        reject(error);
        return;
      }
      options.signal.addEventListener('abort', () => {
        req.destroy();
      }, { once: true });
    }

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}
