import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PythonRuntimeManager } from '../../../src/renderer/python/PythonRuntimeManager';

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
