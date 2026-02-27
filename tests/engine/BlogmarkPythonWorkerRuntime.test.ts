import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BlogmarkPythonWorkerRuntime,
  type BlogmarkWorkerLike,
  type BlogmarkWorkerFactory,
} from '../../src/main/engine/BlogmarkPythonWorkerRuntime';

function createMockWorkerFactory(): {
  factory: BlogmarkWorkerFactory;
  postMessages: unknown[];
  triggerReady: () => void;
  triggerResult: (requestId: string, output: unknown, toasts?: string[]) => void;
  triggerError: (requestId: string, error: string) => void;
  triggerFatalError: (error: string) => void;
} {
  const postMessages: unknown[] = [];
  let messageHandler: ((msg: unknown) => void) | null = null;
  let readyCallback: (() => void) | null = null;

  const triggerReady = () => {
    messageHandler?.({ type: 'ready' });
  };

  const triggerResult = (requestId: string, output: unknown, toasts: string[] = []) => {
    messageHandler?.({ type: 'transformResult', requestId, output, toasts });
  };

  const triggerError = (requestId: string, error: string) => {
    messageHandler?.({ type: 'transformError', requestId, error });
  };

  const triggerFatalError = (error: string) => {
    messageHandler?.({ type: 'error', error });
  };

  const factory: BlogmarkWorkerFactory = () => {
    const worker: BlogmarkWorkerLike = {
      on(event: string, handler: (...args: unknown[]) => void) {
        if (event === 'message') {
          messageHandler = handler as (msg: unknown) => void;
        }
      },
      postMessage(message: unknown) {
        postMessages.push(message);
      },
      terminate() {},
      removeAllListeners() {
        messageHandler = null;
      },
    };

    readyCallback = () => triggerReady();

    // Auto-ready after microtask
    setTimeout(() => readyCallback?.(), 5);

    return worker;
  };

  return { factory, postMessages, triggerReady, triggerResult, triggerError, triggerFatalError };
}

function createAutoRespondFactory(): {
  factory: BlogmarkWorkerFactory;
  postMessages: unknown[];
} {
  const postMessages: unknown[] = [];

  const factory: BlogmarkWorkerFactory = () => {
    let messageHandler: ((msg: unknown) => void) | null = null;

    const worker: BlogmarkWorkerLike = {
      on(event: string, handler: (...args: unknown[]) => void) {
        if (event === 'message') {
          messageHandler = handler as (msg: unknown) => void;
        }
      },
      postMessage(message: unknown) {
        postMessages.push(message);
        const msg = message as { type: string; requestId: string };
        if (msg.type === 'runTransform') {
          setTimeout(() => {
            messageHandler?.({
              type: 'transformResult',
              requestId: msg.requestId,
              output: { transformed: true },
              toasts: ['done'],
            });
          }, 10);
        }
      },
      terminate() {},
      removeAllListeners() {
        messageHandler = null;
      },
    };

    setTimeout(() => messageHandler?.({ type: 'ready' }), 5);
    return worker;
  };

  return { factory, postMessages };
}

describe('BlogmarkPythonWorkerRuntime', () => {
  let runtime: BlogmarkPythonWorkerRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute a transform successfully', async () => {
    const { factory } = createAutoRespondFactory();
    runtime = new BlogmarkPythonWorkerRuntime(factory);

    const result = await runtime.executeTransform({
      scriptContent: 'def transform(payload): return payload',
      entrypoint: 'transform',
      payloadJson: JSON.stringify({ url: 'https://example.com' }),
      timeoutMs: 3000,
    });

    expect(result.output).toEqual({ transformed: true });
    expect(result.toasts).toEqual(['done']);
  });

  it('should pass correct request shape to worker', async () => {
    const { factory, postMessages } = createAutoRespondFactory();
    runtime = new BlogmarkPythonWorkerRuntime(factory);

    await runtime.executeTransform({
      scriptContent: 'def t(p): return p',
      entrypoint: 'transform',
      payloadJson: '{}',
    });

    const request = postMessages[0] as Record<string, unknown>;
    expect(request.type).toBe('runTransform');
    expect(request.scriptContent).toBe('def t(p): return p');
    expect(request.entrypoint).toBe('transform');
    expect(request.payloadJson).toBe('{}');
    expect(request.requestId).toMatch(/^blogmark-py-/);
  });

  it('should reject when worker returns an error', async () => {
    const { factory, triggerError } = createMockWorkerFactory();
    runtime = new BlogmarkPythonWorkerRuntime(factory);

    const promise = runtime.executeTransform({
      scriptContent: 'def bad(): raise Exception("fail")',
      entrypoint: 'bad',
      payloadJson: '{}',
      timeoutMs: 3000,
    });

    // Wait for worker ready + dispatch
    await new Promise((r) => setTimeout(r, 20));
    triggerError('blogmark-py-1', 'Script execution failed');

    await expect(promise).rejects.toThrow('Script execution failed');
  });

  it('should reject on timeout', async () => {
    const { factory } = createMockWorkerFactory();
    runtime = new BlogmarkPythonWorkerRuntime(factory);

    const promise = runtime.executeTransform({
      scriptContent: 'import time; time.sleep(999)',
      entrypoint: 'slow',
      payloadJson: '{}',
      timeoutMs: 50,
    });

    await expect(promise).rejects.toThrow('Python transform timed out after 50ms');
  });

  it('should reject on fatal worker error', async () => {
    const { factory, triggerFatalError } = createMockWorkerFactory();
    runtime = new BlogmarkPythonWorkerRuntime(factory);

    const promise = runtime.executeTransform({
      scriptContent: '',
      entrypoint: 'x',
      payloadJson: '{}',
      timeoutMs: 3000,
    });

    await new Promise((r) => setTimeout(r, 20));
    triggerFatalError('Pyodide failed to load');

    await expect(promise).rejects.toThrow('Pyodide failed to load');
  });

  it('should serialize concurrent requests (queue)', async () => {
    // Use a factory where we manually control responses, worker starts ready
    const postMessages: unknown[] = [];
    let messageHandler: ((msg: unknown) => void) | null = null;

    const factory: BlogmarkWorkerFactory = () => {
      const worker: BlogmarkWorkerLike = {
        on(event: string, handler: (...args: unknown[]) => void) {
          if (event === 'message') {
            messageHandler = handler as (msg: unknown) => void;
          }
        },
        postMessage(message: unknown) { postMessages.push(message); },
        terminate() {},
        removeAllListeners() { messageHandler = null; },
      };
      setTimeout(() => messageHandler?.({ type: 'ready' }), 0);
      return worker;
    };

    runtime = new BlogmarkPythonWorkerRuntime(factory);

    // Prime the worker so it's ready
    const p0 = runtime.executeTransform({
      scriptContent: 'init', entrypoint: 'run', payloadJson: '{}', timeoutMs: 3000,
    });
    await new Promise((r) => setTimeout(r, 10));
    const initReq = postMessages[0] as { requestId: string };
    messageHandler?.({ type: 'transformResult', requestId: initReq.requestId, output: 'ok', toasts: [] });
    await p0;
    postMessages.length = 0;

    // Now enqueue two concurrent requests on an active worker
    const p1 = runtime.executeTransform({ scriptContent: 'first', entrypoint: 'run', payloadJson: '{}', timeoutMs: 3000 });
    const p2 = runtime.executeTransform({ scriptContent: 'second', entrypoint: 'run', payloadJson: '{}', timeoutMs: 3000 });
    await new Promise((r) => setTimeout(r, 10));

    // Only first should be dispatched
    expect(postMessages.length).toBe(1);
    const firstReq = postMessages[0] as { requestId: string; scriptContent: string };
    expect(firstReq.scriptContent).toBe('first');

    // Complete first → second should dispatch
    messageHandler?.({ type: 'transformResult', requestId: firstReq.requestId, output: 'result-1', toasts: [] });
    const r1 = await p1;
    expect(r1.output).toBe('result-1');

    await new Promise((r) => setTimeout(r, 10));
    expect(postMessages.length).toBe(2);
    const secondReq = postMessages[1] as { requestId: string; scriptContent: string };
    expect(secondReq.scriptContent).toBe('second');

    messageHandler?.({ type: 'transformResult', requestId: secondReq.requestId, output: 'result-2', toasts: [] });
    const r2 = await p2;
    expect(r2.output).toBe('result-2');
  });

  it('should dispose without errors', async () => {
    const { factory } = createAutoRespondFactory();
    runtime = new BlogmarkPythonWorkerRuntime(factory);

    await runtime.executeTransform({
      scriptContent: 'def t(p): return p',
      entrypoint: 't',
      payloadJson: '{}',
    });

    expect(() => runtime.dispose()).not.toThrow();
  });

  it('should reject queued requests on dispose', async () => {
    const { factory } = createMockWorkerFactory();
    runtime = new BlogmarkPythonWorkerRuntime(factory);

    const p1 = runtime.executeTransform({
      scriptContent: '',
      entrypoint: 'x',
      payloadJson: '{}',
      timeoutMs: 5000,
    });

    // Wait for worker start
    await new Promise((r) => setTimeout(r, 20));

    runtime.dispose();

    await expect(p1).rejects.toThrow('Python worker runtime disposed');
  });

  it('should recover from worker crash and accept new requests', async () => {
    let workerCount = 0;
    let messageHandler: ((msg: unknown) => void) | null = null;

    const factory: BlogmarkWorkerFactory = () => {
      workerCount++;
      const currentWorker = workerCount;

      const worker: BlogmarkWorkerLike = {
        on(event: string, handler: (...args: unknown[]) => void) {
          if (event === 'message') {
            messageHandler = handler as (msg: unknown) => void;
          }
        },
        postMessage(message: unknown) {
          const msg = message as { type: string; requestId: string; scriptContent: string };
          if (msg.type === 'runTransform' && msg.scriptContent !== 'hang') {
            setTimeout(() => {
              messageHandler?.({
                type: 'transformResult',
                requestId: msg.requestId,
                output: `result-from-worker-${currentWorker}`,
                toasts: [],
              });
            }, 5);
          }
          // 'hang' requests get no response — they will time out
        },
        terminate() {},
        removeAllListeners() { messageHandler = null; },
      };

      setTimeout(() => messageHandler?.({ type: 'ready' }), 0);
      return worker;
    };

    runtime = new BlogmarkPythonWorkerRuntime(factory);

    // First request succeeds
    const r1 = await runtime.executeTransform({
      scriptContent: 'ok',
      entrypoint: 'x',
      payloadJson: '{}',
      timeoutMs: 3000,
    });
    expect(r1.output).toBe('result-from-worker-1');

    // Force crash by timing out the next request (no response for 'hang')
    const crashPromise = runtime.executeTransform({
      scriptContent: 'hang',
      entrypoint: 'x',
      payloadJson: '{}',
      timeoutMs: 30,
    });

    await expect(crashPromise).rejects.toThrow('timed out');

    // New request should create a new worker and succeed
    const r2 = await runtime.executeTransform({
      scriptContent: 'ok',
      entrypoint: 'x',
      payloadJson: '{}',
      timeoutMs: 3000,
    });
    expect(r2.output).toBe('result-from-worker-2');
    expect(workerCount).toBe(2); // original + recovery after timeout reset
  });
});
