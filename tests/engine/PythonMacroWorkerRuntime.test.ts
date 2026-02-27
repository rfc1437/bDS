import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PythonMacroWorkerRuntime, type WorkerLike, type WorkerFactory } from '../../src/main/engine/PythonMacroWorkerRuntime';

function createAutoRespondFactory(): {
  factory: WorkerFactory;
  postMessages: unknown[];
} {
  const postMessages: unknown[] = [];

  const factory: WorkerFactory = () => {
    let messageHandler: ((msg: unknown) => void) | null = null;

    const worker: WorkerLike = {
      on(event: string, handler: (...args: unknown[]) => void) {
        if (event === 'message') {
          messageHandler = handler as (msg: unknown) => void;
        }
      },
      postMessage(message: unknown) {
        postMessages.push(message);
        const msg = message as { type: string; requestId: string };
        if (msg.type === 'renderMacro') {
          setTimeout(() => {
            messageHandler?.({
              type: 'macroResult',
              requestId: msg.requestId,
              html: '<p>Python macro output</p>',
              data: { key: 'value' },
              warnings: [],
            });
          }, 10);
        }
      },
      terminate() {},
      removeAllListeners() { messageHandler = null; },
    };

    setTimeout(() => {
      messageHandler?.({ type: 'ready' });
    }, 5);

    return worker;
  };

  return { factory, postMessages };
}

function createManualFactory(): {
  factory: WorkerFactory;
  postMessages: unknown[];
  triggerReady: () => void;
  triggerResult: (requestId: string, html: string, data?: Record<string, unknown>, warnings?: string[]) => void;
  triggerError: (requestId: string, error: string) => void;
  triggerFatalError: (error: string) => void;
} {
  const postMessages: unknown[] = [];
  let messageHandler: ((msg: unknown) => void) | null = null;

  const triggerReady = () => {
    messageHandler?.({ type: 'ready' });
  };

  const triggerResult = (requestId: string, html: string, data?: Record<string, unknown>, warnings?: string[]) => {
    messageHandler?.({ type: 'macroResult', requestId, html, data, warnings });
  };

  const triggerError = (requestId: string, error: string) => {
    messageHandler?.({ type: 'macroError', requestId, error });
  };

  const triggerFatalError = (error: string) => {
    messageHandler?.({ type: 'error', error });
  };

  const factory: WorkerFactory = () => {
    const worker: WorkerLike = {
      on(event: string, handler: (...args: unknown[]) => void) {
        if (event === 'message') {
          messageHandler = handler as (msg: unknown) => void;
        }
      },
      postMessage(message: unknown) {
        postMessages.push(message);
      },
      terminate() {},
      removeAllListeners() { messageHandler = null; },
    };

    setTimeout(() => triggerReady(), 5);
    return worker;
  };

  return { factory, postMessages, triggerReady, triggerResult, triggerError, triggerFatalError };
}

describe('PythonMacroWorkerRuntime', () => {
  let runtime: PythonMacroWorkerRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render a Python macro successfully', async () => {
    const { factory } = createAutoRespondFactory();
    runtime = new PythonMacroWorkerRuntime(factory);

    const result = await runtime.renderMacro({
      scriptContent: 'def render(ctx): return {"html": "<p>output</p>"}',
      entrypoint: 'render',
      contextJson: JSON.stringify({ env: { isPreview: false } }),
      timeoutMs: 3000,
    });

    expect(result.html).toBe('<p>Python macro output</p>');
    expect(result.data).toEqual({ key: 'value' });
  });

  it('should track macro execution counter', async () => {
    const { factory } = createAutoRespondFactory();
    runtime = new PythonMacroWorkerRuntime(factory);
    expect(runtime.macroCount).toBe(0);

    await runtime.renderMacro({
      scriptContent: 'def render(ctx): return {"html": ""}',
      entrypoint: 'render',
      contextJson: '{}',
    });

    expect(runtime.macroCount).toBe(1);
  });

  it('should reset counters', async () => {
    const { factory } = createAutoRespondFactory();
    runtime = new PythonMacroWorkerRuntime(factory);

    await runtime.renderMacro({
      scriptContent: 'def render(ctx): return {"html": ""}',
      entrypoint: 'render',
      contextJson: '{}',
    });

    expect(runtime.macroCount).toBe(1);
    runtime.resetCounters();
    expect(runtime.macroCount).toBe(0);
    expect(runtime.errorCount).toBe(0);
    expect(runtime.timeoutCount).toBe(0);
  });

  it('should dispose without errors', async () => {
    const { factory } = createAutoRespondFactory();
    runtime = new PythonMacroWorkerRuntime(factory);

    await runtime.renderMacro({
      scriptContent: 'def render(ctx): return {"html": ""}',
      entrypoint: 'render',
      contextJson: '{}',
    });

    expect(() => runtime.dispose()).not.toThrow();
  });

  it('should pass cacheKey to the worker', async () => {
    const { factory, postMessages } = createAutoRespondFactory();
    runtime = new PythonMacroWorkerRuntime(factory);

    await runtime.renderMacro({
      scriptContent: 'def render(ctx): return {"html": ""}',
      entrypoint: 'render',
      contextJson: '{}',
      cacheKey: 'script-1:v2',
    });

    const lastMessage = postMessages[postMessages.length - 1] as Record<string, unknown>;
    expect(lastMessage.type).toBe('renderMacro');
    expect(lastMessage.cacheKey).toBe('script-1:v2');
  });

  it('should reject on timeout and increment timeoutCount', async () => {
    const { factory } = createManualFactory();
    runtime = new PythonMacroWorkerRuntime(factory);

    const promise = runtime.renderMacro({
      scriptContent: 'import time; time.sleep(999)',
      entrypoint: 'slow',
      contextJson: '{}',
      timeoutMs: 50,
    });

    await expect(promise).rejects.toThrow('Python macro timed out after 50ms');
    expect(runtime.timeoutCount).toBe(1);
    expect(runtime.macroCount).toBe(0);
  });

  it('should increment errorCount when worker returns macroError', async () => {
    const { factory, triggerError } = createManualFactory();
    runtime = new PythonMacroWorkerRuntime(factory);

    const promise = runtime.renderMacro({
      scriptContent: 'def bad(): raise Exception("fail")',
      entrypoint: 'bad',
      contextJson: '{}',
      timeoutMs: 3000,
    });

    await new Promise((r) => setTimeout(r, 20));
    triggerError('py-macro-1', 'Script execution failed');

    await expect(promise).rejects.toThrow('Script execution failed');
    expect(runtime.errorCount).toBe(1);
    expect(runtime.macroCount).toBe(1);
  });

  it('should reject on fatal worker error', async () => {
    const { factory, triggerFatalError } = createManualFactory();
    runtime = new PythonMacroWorkerRuntime(factory);

    const promise = runtime.renderMacro({
      scriptContent: '',
      entrypoint: 'x',
      contextJson: '{}',
      timeoutMs: 3000,
    });

    await new Promise((r) => setTimeout(r, 20));
    triggerFatalError('Pyodide failed to load');

    await expect(promise).rejects.toThrow('Pyodide failed to load');
  });

  it('should serialize concurrent requests (queue)', async () => {
    const postMessages: unknown[] = [];
    let messageHandler: ((msg: unknown) => void) | null = null;

    const factory: WorkerFactory = () => {
      const worker: WorkerLike = {
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

    runtime = new PythonMacroWorkerRuntime(factory);

    // Prime the worker
    const p0 = runtime.renderMacro({
      scriptContent: 'init', entrypoint: 'render', contextJson: '{}', timeoutMs: 3000,
    });
    await new Promise((r) => setTimeout(r, 10));
    const initReq = postMessages[0] as { requestId: string };
    messageHandler?.({ type: 'macroResult', requestId: initReq.requestId, html: 'ok' });
    await p0;
    postMessages.length = 0;

    // Enqueue two concurrent requests — both dispatch to the async path.
    // The first will become active; the second sees activeRequest set and queues.
    const p1 = runtime.renderMacro({ scriptContent: 'first', entrypoint: 'render', contextJson: '{}', timeoutMs: 3000 });
    // Let p1's dispatchNext settle so activeRequest is set before p2 enqueues
    await new Promise((r) => setTimeout(r, 10));
    const p2 = runtime.renderMacro({ scriptContent: 'second', entrypoint: 'render', contextJson: '{}', timeoutMs: 3000 });
    await new Promise((r) => setTimeout(r, 10));

    // Only first should be dispatched
    expect(postMessages.length).toBe(1);
    const firstReq = postMessages[0] as { requestId: string; scriptContent: string };
    expect(firstReq.scriptContent).toBe('first');

    // Complete first → second should dispatch
    messageHandler?.({ type: 'macroResult', requestId: firstReq.requestId, html: 'result-1' });
    const r1 = await p1;
    expect(r1.html).toBe('result-1');

    await new Promise((r) => setTimeout(r, 10));
    expect(postMessages.length).toBe(2);
    const secondReq = postMessages[1] as { requestId: string; scriptContent: string };
    expect(secondReq.scriptContent).toBe('second');

    messageHandler?.({ type: 'macroResult', requestId: secondReq.requestId, html: 'result-2' });
    const r2 = await p2;
    expect(r2.html).toBe('result-2');
  });

  it('should reject queued requests on dispose', async () => {
    const { factory } = createManualFactory();
    runtime = new PythonMacroWorkerRuntime(factory);

    const p1 = runtime.renderMacro({
      scriptContent: '',
      entrypoint: 'x',
      contextJson: '{}',
      timeoutMs: 5000,
    });

    await new Promise((r) => setTimeout(r, 20));

    runtime.dispose();

    await expect(p1).rejects.toThrow('Python macro worker runtime disposed');
  });

  it('should recover from worker crash and accept new requests', async () => {
    let workerCount = 0;
    let messageHandler: ((msg: unknown) => void) | null = null;

    const factory: WorkerFactory = () => {
      workerCount++;
      const currentWorker = workerCount;

      const worker: WorkerLike = {
        on(event: string, handler: (...args: unknown[]) => void) {
          if (event === 'message') {
            messageHandler = handler as (msg: unknown) => void;
          }
        },
        postMessage(message: unknown) {
          const msg = message as { type: string; requestId: string; scriptContent: string };
          if (msg.type === 'renderMacro' && msg.scriptContent !== 'hang') {
            setTimeout(() => {
              messageHandler?.({
                type: 'macroResult',
                requestId: msg.requestId,
                html: `result-from-worker-${currentWorker}`,
              });
            }, 5);
          }
        },
        terminate() {},
        removeAllListeners() { messageHandler = null; },
      };

      setTimeout(() => messageHandler?.({ type: 'ready' }), 0);
      return worker;
    };

    runtime = new PythonMacroWorkerRuntime(factory);

    // First request succeeds
    const r1 = await runtime.renderMacro({
      scriptContent: 'ok', entrypoint: 'x', contextJson: '{}', timeoutMs: 3000,
    });
    expect(r1.html).toBe('result-from-worker-1');

    // Force crash by timing out (no response for 'hang')
    const crashPromise = runtime.renderMacro({
      scriptContent: 'hang', entrypoint: 'x', contextJson: '{}', timeoutMs: 30,
    });

    await expect(crashPromise).rejects.toThrow('timed out');

    // New request should create a new worker and succeed
    const r2 = await runtime.renderMacro({
      scriptContent: 'ok', entrypoint: 'x', contextJson: '{}', timeoutMs: 3000,
    });
    expect(r2.html).toBe('result-from-worker-2');
    expect(workerCount).toBe(2);
  });

  it('should forward warnings from worker result', async () => {
    let messageHandler: ((msg: unknown) => void) | null = null;

    const factory: WorkerFactory = () => {
      const worker: WorkerLike = {
        on(event: string, handler: (...args: unknown[]) => void) {
          if (event === 'message') {
            messageHandler = handler as (msg: unknown) => void;
          }
        },
        postMessage(message: unknown) {
          const msg = message as { type: string; requestId: string };
          if (msg.type === 'renderMacro') {
            setTimeout(() => {
              messageHandler?.({
                type: 'macroResult',
                requestId: msg.requestId,
                html: '<p>ok</p>',
                warnings: ['deprecation notice', 'slow query'],
              });
            }, 10);
          }
        },
        terminate() {},
        removeAllListeners() { messageHandler = null; },
      };
      setTimeout(() => messageHandler?.({ type: 'ready' }), 5);
      return worker;
    };

    runtime = new PythonMacroWorkerRuntime(factory);

    const result = await runtime.renderMacro({
      scriptContent: 'def render(ctx): return {"html": "<p>ok</p>", "warnings": ["deprecation notice"]}',
      entrypoint: 'render',
      contextJson: '{}',
    });

    expect(result.warnings).toEqual(['deprecation notice', 'slow query']);
  });
});
