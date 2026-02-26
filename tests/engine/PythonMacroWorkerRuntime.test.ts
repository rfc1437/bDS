import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PythonMacroWorkerRuntime, type WorkerLike, type WorkerFactory } from '../../src/main/engine/PythonMacroWorkerRuntime';

function createMockWorkerFactory(): {
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
      removeAllListeners() {},
    };

    setTimeout(() => {
      messageHandler?.({ type: 'ready' });
    }, 5);

    return worker;
  };

  return { factory, postMessages };
}

describe('PythonMacroWorkerRuntime', () => {
  let runtime: PythonMacroWorkerRuntime;
  let mockFactory: ReturnType<typeof createMockWorkerFactory>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFactory = createMockWorkerFactory();
    runtime = new PythonMacroWorkerRuntime(mockFactory.factory);
  });

  it('should render a Python macro successfully', async () => {
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
    expect(runtime.macroCount).toBe(0);

    await runtime.renderMacro({
      scriptContent: 'def render(ctx): return {"html": ""}',
      entrypoint: 'render',
      contextJson: '{}',
    });

    expect(runtime.macroCount).toBe(1);
  });

  it('should reset counters', async () => {
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
    await runtime.renderMacro({
      scriptContent: 'def render(ctx): return {"html": ""}',
      entrypoint: 'render',
      contextJson: '{}',
    });

    expect(() => runtime.dispose()).not.toThrow();
  });

  it('should pass cacheKey to the worker', async () => {
    await runtime.renderMacro({
      scriptContent: 'def render(ctx): return {"html": ""}',
      entrypoint: 'render',
      contextJson: '{}',
      cacheKey: 'script-1:v2',
    });

    const lastMessage = mockFactory.postMessages[mockFactory.postMessages.length - 1] as Record<string, unknown>;
    expect(lastMessage.type).toBe('renderMacro');
    expect(lastMessage.cacheKey).toBe('script-1:v2');
  });
});
