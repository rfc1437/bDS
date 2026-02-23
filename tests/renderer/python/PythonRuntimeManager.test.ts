import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PythonRuntimeManager } from '../../../src/renderer/python/PythonRuntimeManager';
import { createMacroRenderOptions } from '../../../src/renderer/python/macroRenderOptions';

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  postedMessages: unknown[] = [];

  postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitError(error: Error): void {
    this.onerror?.({ error } as ErrorEvent);
  }
}

describe('PythonRuntimeManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes worker once and resolves on ready signal', async () => {
    const createdWorkers: MockWorker[] = [];
    const manager = new PythonRuntimeManager(() => {
      const worker = new MockWorker();
      createdWorkers.push(worker);
      return worker as unknown as Worker;
    });

    const initA = manager.initialize();
    const initB = manager.initialize();

    expect(initA).toBe(initB);
    expect(createdWorkers).toHaveLength(1);

    createdWorkers[0].emitMessage({ type: 'ready' });
    await expect(initA).resolves.toBeUndefined();
    expect(manager.isReady()).toBe(true);
  });

  it('rejects when worker emits an error before ready', async () => {
    const worker = new MockWorker();
    const manager = new PythonRuntimeManager(() => worker as unknown as Worker);

    const initPromise = manager.initialize();
    worker.emitError(new Error('bootstrap failed'));

    await expect(initPromise).rejects.toThrow('bootstrap failed');
    expect(manager.isReady()).toBe(false);
  });

  it('executes code and returns stdout and result', async () => {
    const worker = new MockWorker();
    const manager = new PythonRuntimeManager(() => worker as unknown as Worker);

    const initPromise = manager.initialize();
    worker.emitMessage({ type: 'ready' });
    await initPromise;

    const runPromise = manager.execute('print("hello")\n1 + 1');
    await Promise.resolve();
    const request = worker.postedMessages[0] as { type: string; requestId: string; code: string };

    worker.emitMessage({ type: 'stdout', requestId: request.requestId, chunk: 'hello\n' });
    worker.emitMessage({ type: 'runResult', requestId: request.requestId, result: '2' });

    await expect(runPromise).resolves.toEqual({ result: '2', stdout: 'hello\n' });
  });

  it('forwards compile cache key in execute request options', async () => {
    const worker = new MockWorker();
    const manager = new PythonRuntimeManager(() => worker as unknown as Worker);

    const initPromise = manager.initialize();
    worker.emitMessage({ type: 'ready' });
    await initPromise;

    const runPromise = manager.execute('value = 1', { cacheKey: 'script-1:3' });
    await Promise.resolve();
    const request = worker.postedMessages[0] as { requestId: string; cacheKey?: string };
    expect(request.cacheKey).toBe('script-1:3');

    worker.emitMessage({ type: 'runResult', requestId: request.requestId, result: '' });
    await expect(runPromise).resolves.toEqual({ result: '', stdout: '' });
  });

  it('forwards selected entrypoint in execute request options', async () => {
    const worker = new MockWorker();
    const manager = new PythonRuntimeManager(() => worker as unknown as Worker);

    const initPromise = manager.initialize();
    worker.emitMessage({ type: 'ready' });
    await initPromise;

    const runPromise = manager.execute('def helper():\n    return 42', { entrypoint: 'helper' });
    await Promise.resolve();
    const request = worker.postedMessages[0] as { requestId: string; entrypoint?: string };
    expect(request.entrypoint).toBe('helper');

    worker.emitMessage({ type: 'runResult', requestId: request.requestId, result: '42' });
    await expect(runPromise).resolves.toEqual({ result: '42', stdout: '' });
  });

  it('inspects script and returns available function names', async () => {
    const worker = new MockWorker();
    const manager = new PythonRuntimeManager(() => worker as unknown as Worker);

    const initPromise = manager.initialize();
    worker.emitMessage({ type: 'ready' });
    await initPromise;

    const inspectPromise = manager.inspectEntrypoints('def render(context):\n    return {}\n\ndef helper():\n    return 1');
    await Promise.resolve();

    const request = worker.postedMessages[0] as { type: string; requestId: string; code: string };
    expect(request.type).toBe('inspectEntrypoints');

    worker.emitMessage({ type: 'entrypoints', requestId: request.requestId, entrypoints: ['render', 'helper'] });
    await expect(inspectPromise).resolves.toEqual(['render', 'helper']);
  });

  it('rejects when runtime returns run error', async () => {
    const worker = new MockWorker();
    const manager = new PythonRuntimeManager(() => worker as unknown as Worker);

    const initPromise = manager.initialize();
    worker.emitMessage({ type: 'ready' });
    await initPromise;

    const runPromise = manager.execute('raise RuntimeError("boom")');
    await Promise.resolve();
    const request = worker.postedMessages[0] as { requestId: string };
    worker.emitMessage({ type: 'runError', requestId: request.requestId, error: 'boom' });

    await expect(runPromise).rejects.toThrow('boom');
  });

  it('terminates timed out worker and recovers with a new worker', async () => {
    const workers: MockWorker[] = [];
    const manager = new PythonRuntimeManager(() => {
      const worker = new MockWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });

    const firstInit = manager.initialize();
    workers[0].emitMessage({ type: 'ready' });
    await firstInit;

    const timedOutRun = manager.execute('while True: pass', { timeoutMs: 100 });
    await Promise.resolve();
    vi.advanceTimersByTime(101);
    await expect(timedOutRun).rejects.toThrow('timed out');
    expect(workers[0].terminated).toBe(true);
    expect(manager.isReady()).toBe(false);

    const secondInit = manager.initialize();
    workers[1].emitMessage({ type: 'ready' });
    await secondInit;

    const secondRun = manager.execute('40 + 2');
    await Promise.resolve();
    const request = workers[1].postedMessages[0] as { requestId: string };
    workers[1].emitMessage({ type: 'runResult', requestId: request.requestId, result: '42' });

    await expect(secondRun).resolves.toEqual({ result: '42', stdout: '' });
  });

  it('rejects macro execution when ABI context is invalid on caller side', async () => {
    const worker = new MockWorker();
    const manager = new PythonRuntimeManager(() => worker as unknown as Worker);

    const initPromise = manager.initialize();
    worker.emitMessage({ type: 'ready' });
    await initPromise;

    const runPromise = manager.renderMacroV1('def render(context):\n  return {"html": "<p>ok</p>"}', {
      env: {
        isPreview: 'yes',
      },
    });

    await expect(runPromise).rejects.toThrow('Invalid macro context');
    expect(worker.postedMessages).toHaveLength(0);
  });

  it('returns validated macro result and stdout', async () => {
    const worker = new MockWorker();
    const manager = new PythonRuntimeManager(() => worker as unknown as Worker);

    const initPromise = manager.initialize();
    worker.emitMessage({ type: 'ready' });
    await initPromise;

    const runPromise = manager.renderMacroV1('def render(context):\n  return {"html": "<p>ok</p>"}', {
      env: {
        isPreview: true,
      },
      params: {
        title: 'Hello',
      },
    });

    await Promise.resolve();
    const request = worker.postedMessages[0] as { requestId: string };
    worker.emitMessage({ type: 'stdout', requestId: request.requestId, chunk: 'rendering\n' });
    worker.emitMessage({ type: 'macroResult', requestId: request.requestId, result: { html: '<p>ok</p>' } });

    await expect(runPromise).resolves.toEqual({ result: { html: '<p>ok</p>' }, stdout: 'rendering\n' });
  });

  it('accepts optional env hook and source metadata for macro execution', async () => {
    const worker = new MockWorker();
    const manager = new PythonRuntimeManager(() => worker as unknown as Worker);

    const initPromise = manager.initialize();
    worker.emitMessage({ type: 'ready' });
    await initPromise;

    const runPromise = manager.renderMacroV1('def render(context):\n  return {"html": "<p>ok</p>"}', {
      env: {
        isPreview: true,
        hook: 'post:render',
        source: {
          kind: 'post',
          id: 'post-1',
        },
      },
    });

    await Promise.resolve();
    const request = worker.postedMessages[0] as {
      requestId: string;
      context: { env: { hook?: string; source?: { kind: string; id?: string } } };
    };
    expect(request.context.env.hook).toBe('post:render');
    expect(request.context.env.source).toEqual({ kind: 'post', id: 'post-1' });

    worker.emitMessage({ type: 'macroResult', requestId: request.requestId, result: { html: '<p>ok</p>' } });
    await expect(runPromise).resolves.toEqual({ result: { html: '<p>ok</p>' }, stdout: '' });
  });

  it('injects env hook and source metadata from macro execution options', async () => {
    const worker = new MockWorker();
    const manager = new PythonRuntimeManager(() => worker as unknown as Worker);

    const initPromise = manager.initialize();
    worker.emitMessage({ type: 'ready' });
    await initPromise;

    const runPromise = manager.renderMacroV1(
      'def render(context):\n  return {"html": "<p>ok</p>"}',
      {
        env: {
          isPreview: true,
        },
      },
      createMacroRenderOptions({
        hook: 'preview:macro',
        source: {
          kind: 'post',
          id: 'post-77',
        },
      })
    );

    await Promise.resolve();
    const request = worker.postedMessages[0] as {
      requestId: string;
      context: { env: { hook?: string; source?: { kind: string; id?: string } } };
    };

    expect(request.context.env.hook).toBe('preview:macro');
    expect(request.context.env.source).toEqual({ kind: 'post', id: 'post-77' });

    worker.emitMessage({ type: 'macroResult', requestId: request.requestId, result: { html: '<p>ok</p>' } });
    await expect(runPromise).resolves.toEqual({ result: { html: '<p>ok</p>' }, stdout: '' });
  });

  it('preserves explicit env hook and source over macro execution options', async () => {
    const worker = new MockWorker();
    const manager = new PythonRuntimeManager(() => worker as unknown as Worker);

    const initPromise = manager.initialize();
    worker.emitMessage({ type: 'ready' });
    await initPromise;

    const runPromise = manager.renderMacroV1(
      'def render(context):\n  return {"html": "<p>ok</p>"}',
      {
        env: {
          isPreview: true,
          hook: 'explicit:hook',
          source: {
            kind: 'page',
            id: 'page-9',
          },
        },
      },
      createMacroRenderOptions({
        hook: 'preview:macro',
        source: {
          kind: 'post',
          id: 'post-77',
        },
      })
    );

    await Promise.resolve();
    const request = worker.postedMessages[0] as {
      requestId: string;
      context: { env: { hook?: string; source?: { kind: string; id?: string } } };
    };

    expect(request.context.env.hook).toBe('explicit:hook');
    expect(request.context.env.source).toEqual({ kind: 'page', id: 'page-9' });

    worker.emitMessage({ type: 'macroResult', requestId: request.requestId, result: { html: '<p>ok</p>' } });
    await expect(runPromise).resolves.toEqual({ result: { html: '<p>ok</p>' }, stdout: '' });
  });

  it('rejects macro execution when worker result violates ABI schema', async () => {
    const worker = new MockWorker();
    const manager = new PythonRuntimeManager(() => worker as unknown as Worker);

    const initPromise = manager.initialize();
    worker.emitMessage({ type: 'ready' });
    await initPromise;

    const runPromise = manager.renderMacroV1('def render(context):\n  return {"html": "<p>ok</p>"}', {
      env: {
        isPreview: true,
      },
    });

    await Promise.resolve();
    const request = worker.postedMessages[0] as { requestId: string };
    worker.emitMessage({ type: 'macroResult', requestId: request.requestId, result: { html: 42 } });

    await expect(runPromise).rejects.toThrow('Invalid macro result');
  });
});
