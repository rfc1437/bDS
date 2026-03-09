import { describe, expect, it, vi } from 'vitest';
import { GenerationWorkerPool, type WorkerLike, type WorkerFactory } from '../../src/main/engine/GenerationWorkerPool';
import type { GenerationWorkerTask, WorkerOutboundMessage } from '../../src/main/engine/GenerationWorkerData';

function makeTask(taskId: string, section: 'single' | 'category' | 'tag' | 'date' = 'single'): GenerationWorkerTask {
  return {
    taskId,
    section,
    posts: [],
    lookupPosts: [],
    mediaItems: [],
    backlinksMap: {},
    options: {
      projectId: 'proj-1',
      projectName: 'Test Blog',
      dataDir: '/data',
      baseUrl: 'https://example.com',
    },
    maxPostsPerPage: 50,
    htmlDir: '/data/html',
    hashMapEntries: [],
    postFilePathEntries: [],
  };
}

function createMockWorkerFactory(
  responses: Map<string, WorkerOutboundMessage[]>,
): WorkerFactory {
  return (_workerPath: string, workerData: GenerationWorkerTask): WorkerLike => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    const worker: WorkerLike = {
      on(event: string, listener: (...args: unknown[]) => void) {
        const existing = listeners.get(event) ?? [];
        existing.push(listener);
        listeners.set(event, existing);
      },
      async terminate() {
        return 0;
      },
      removeAllListeners() {
        listeners.clear();
      },
    };

    // Simulate async message delivery
    setTimeout(() => {
      const taskMessages = responses.get(workerData.taskId) ?? [
        { type: 'result', taskId: workerData.taskId, pagesGenerated: 0 },
      ];
      for (const msg of taskMessages) {
        const messageListeners = listeners.get('message') ?? [];
        for (const listener of messageListeners) {
          listener(msg);
        }
      }
    }, 1);

    return worker;
  };
}

describe('GenerationWorkerPool', () => {
  it('returns zero pages for empty task list', async () => {
    const pool = new GenerationWorkerPool({ maxWorkers: 2 });
    const result = await pool.runTasks([], vi.fn());
    expect(result.pagesGenerated).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('runs a single task and reports result', async () => {
    const responses = new Map<string, WorkerOutboundMessage[]>([
      ['task-1', [{ type: 'result', taskId: 'task-1', pagesGenerated: 42 }]],
    ]);

    const pool = new GenerationWorkerPool(
      { maxWorkers: 2 },
      createMockWorkerFactory(responses),
    );

    const progress = vi.fn();
    const result = await pool.runTasks([makeTask('task-1')], progress);

    expect(result.pagesGenerated).toBe(42);
    expect(result.errors).toHaveLength(0);
  });

  it('merges results from multiple tasks', async () => {
    const responses = new Map<string, WorkerOutboundMessage[]>([
      ['task-1', [{ type: 'result', taskId: 'task-1', pagesGenerated: 10 }]],
      ['task-2', [{ type: 'result', taskId: 'task-2', pagesGenerated: 20 }]],
      ['task-3', [{ type: 'result', taskId: 'task-3', pagesGenerated: 30 }]],
    ]);

    const pool = new GenerationWorkerPool(
      { maxWorkers: 2 },
      createMockWorkerFactory(responses),
    );

    const result = await pool.runTasks(
      [makeTask('task-1'), makeTask('task-2'), makeTask('task-3')],
      vi.fn(),
    );

    expect(result.pagesGenerated).toBe(60);
  });

  it('collects progress messages', async () => {
    const responses = new Map<string, WorkerOutboundMessage[]>([
      ['task-1', [
        { type: 'progress', taskId: 'task-1', message: 'Page 1' },
        { type: 'progress', taskId: 'task-1', message: 'Page 2' },
        { type: 'result', taskId: 'task-1', pagesGenerated: 2 },
      ]],
    ]);

    const pool = new GenerationWorkerPool(
      { maxWorkers: 1 },
      createMockWorkerFactory(responses),
    );

    const progress = vi.fn();
    await pool.runTasks([makeTask('task-1')], progress);

    expect(progress).toHaveBeenCalledWith('Page 1');
    expect(progress).toHaveBeenCalledWith('Page 2');
  });

  it('collects errors from failed tasks', async () => {
    const responses = new Map<string, WorkerOutboundMessage[]>([
      ['task-1', [{ type: 'error', taskId: 'task-1', error: 'Render failed' }]],
      ['task-2', [{ type: 'result', taskId: 'task-2', pagesGenerated: 5 }]],
    ]);

    const pool = new GenerationWorkerPool(
      { maxWorkers: 2 },
      createMockWorkerFactory(responses),
    );

    const result = await pool.runTasks(
      [makeTask('task-1'), makeTask('task-2')],
      vi.fn(),
    );

    expect(result.pagesGenerated).toBe(5);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].taskId).toBe('task-1');
    expect(result.errors[0].error).toBe('Render failed');
  });

  it('handles worker crash via error event', async () => {
    const factory: WorkerFactory = (_workerPath, workerData): WorkerLike => {
      const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

      const worker: WorkerLike = {
        on(event: string, listener: (...args: unknown[]) => void) {
          const existing = listeners.get(event) ?? [];
          existing.push(listener);
          listeners.set(event, existing);
        },
        async terminate() {
          return 1;
        },
        removeAllListeners() {
          listeners.clear();
        },
      };

      setTimeout(() => {
        const errorListeners = listeners.get('error') ?? [];
        for (const listener of errorListeners) {
          listener(new Error('Worker crashed'));
        }
      }, 1);

      return worker;
    };

    const pool = new GenerationWorkerPool({ maxWorkers: 1 }, factory);
    const result = await pool.runTasks([makeTask('crash-task')], vi.fn());

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toBe('Worker crashed');
  });

  it('collects hashUpdates from worker results', async () => {
    const responses = new Map<string, WorkerOutboundMessage[]>([
      ['task-1', [{ type: 'result', taskId: 'task-1', pagesGenerated: 3, hashUpdates: [
        { relativePath: 'index.html', hash: 'aaa' },
        { relativePath: 'page/2/index.html', hash: 'bbb' },
      ] }]],
      ['task-2', [{ type: 'result', taskId: 'task-2', pagesGenerated: 2, hashUpdates: [
        { relativePath: 'tags/index.html', hash: 'ccc' },
      ] }]],
    ]);

    const pool = new GenerationWorkerPool(
      { maxWorkers: 2 },
      createMockWorkerFactory(responses),
    );

    const result = await pool.runTasks(
      [makeTask('task-1'), makeTask('task-2')],
      vi.fn(),
    );

    expect(result.pagesGenerated).toBe(5);
    expect(result.hashUpdates).toHaveLength(3);
    expect(result.hashUpdates).toContainEqual({ relativePath: 'index.html', hash: 'aaa' });
    expect(result.hashUpdates).toContainEqual({ relativePath: 'page/2/index.html', hash: 'bbb' });
    expect(result.hashUpdates).toContainEqual({ relativePath: 'tags/index.html', hash: 'ccc' });
  });

  it('returns empty hashUpdates when workers report errors', async () => {
    const responses = new Map<string, WorkerOutboundMessage[]>([
      ['task-1', [{ type: 'error', taskId: 'task-1', error: 'boom' }]],
    ]);

    const pool = new GenerationWorkerPool(
      { maxWorkers: 1 },
      createMockWorkerFactory(responses),
    );

    const result = await pool.runTasks([makeTask('task-1')], vi.fn());

    expect(result.hashUpdates).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });

  it('respects maxWorkers concurrency', async () => {
    let peakConcurrent = 0;
    let currentConcurrent = 0;

    const factory: WorkerFactory = (_workerPath, workerData): WorkerLike => {
      currentConcurrent++;
      if (currentConcurrent > peakConcurrent) peakConcurrent = currentConcurrent;

      const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

      const worker: WorkerLike = {
        on(event: string, listener: (...args: unknown[]) => void) {
          const existing = listeners.get(event) ?? [];
          existing.push(listener);
          listeners.set(event, existing);
        },
        async terminate() {
          currentConcurrent--;
          return 0;
        },
        removeAllListeners() {
          listeners.clear();
        },
      };

      setTimeout(() => {
        const messageListeners = listeners.get('message') ?? [];
        for (const listener of messageListeners) {
          listener({ type: 'result', taskId: workerData.taskId, pagesGenerated: 1 });
        }
      }, 5);

      return worker;
    };

    const pool = new GenerationWorkerPool({ maxWorkers: 2 }, factory);
    const result = await pool.runTasks(
      [makeTask('t1'), makeTask('t2'), makeTask('t3'), makeTask('t4')],
      vi.fn(),
    );

    expect(result.pagesGenerated).toBe(4);
    expect(peakConcurrent).toBeLessThanOrEqual(2);
  });
});
