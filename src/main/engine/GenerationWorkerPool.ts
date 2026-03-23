/**
 * Worker pool for parallel blog generation.
 *
 * Manages a pool of worker threads that render HTML pages concurrently.
 * Each worker gets a self-contained GenerationWorkerTask and produces pages
 * independently. The pool limits concurrency to os.cpus().length - 1 (min 1).
 */
import { Worker } from 'worker_threads';
import * as os from 'os';
import * as path from 'path';
import type {
  GenerationWorkerTask,
  WorkerOutboundMessage,
} from './GenerationWorkerData';

export interface WorkerPoolOptions {
  /** Max concurrent workers. Defaults to os.cpus().length - 1, min 1. */
  maxWorkers?: number;
  /** Override the worker script path (for testing). */
  workerPath?: string;
}

export interface WorkerPoolResult {
  pagesGenerated: number;
  errors: Array<{ taskId: string; error: string }>;
  hashUpdates: Array<{ relativePath: string; hash: string }>;
}

export type WorkerFactory = (workerPath: string, workerData: GenerationWorkerTask) => WorkerLike;

export interface WorkerLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  terminate(): Promise<number>;
  removeAllListeners(): void;
}

export class GenerationWorkerPool {
  private readonly maxWorkers: number;
  private readonly workerPath: string;
  private readonly workerFactory: WorkerFactory;

  constructor(options?: WorkerPoolOptions, workerFactory?: WorkerFactory) {
    this.maxWorkers = Math.max(1, options?.maxWorkers ?? (os.cpus().length - 1));
    this.workerPath = options?.workerPath ?? path.join(__dirname, 'generation.worker.js');
    this.workerFactory = workerFactory ?? ((wp, wd) => new Worker(wp, { workerData: wd }) as unknown as WorkerLike);
  }

  /**
   * Run a set of generation tasks across the worker pool.
   *
   * Tasks are distributed to workers up to maxWorkers concurrency.
   * When a worker finishes, the next queued task is dispatched.
   *
   * @param tasks - Array of self-contained worker tasks
   * @param onProgress - Called for each page generated (for progress bar updates)
   * @returns Merged results from all workers
   */
  async runTasks(
    tasks: GenerationWorkerTask[],
    onProgress: (message: string) => void,
  ): Promise<WorkerPoolResult> {
    if (tasks.length === 0) {
      return { pagesGenerated: 0, errors: [], hashUpdates: [] };
    }

    return new Promise<WorkerPoolResult>((resolve) => {
      let totalPages = 0;
      const errors: Array<{ taskId: string; error: string }> = [];
      const allHashUpdates: Array<{ relativePath: string; hash: string }> = [];
      let nextTaskIndex = 0;
      let activeWorkers = 0;

      const startNextWorker = () => {
        if (nextTaskIndex >= tasks.length) {
          if (activeWorkers === 0) {
            resolve({ pagesGenerated: totalPages, errors, hashUpdates: allHashUpdates });
          }
          return;
        }

        const task = tasks[nextTaskIndex++];
        activeWorkers++;

        const worker = this.workerFactory(this.workerPath, task);

        worker.on('message', (raw: unknown) => {
          const msg = raw as WorkerOutboundMessage;

          switch (msg.type) {
          case 'progress':
            onProgress(msg.message);
            break;

          case 'result':
            totalPages += msg.pagesGenerated;
            if (msg.hashUpdates) {
              allHashUpdates.push(...msg.hashUpdates);
            }
            activeWorkers--;
            void worker.terminate();
            startNextWorker();
            break;

          case 'error':
            errors.push({ taskId: msg.taskId, error: msg.error });
            activeWorkers--;
            void worker.terminate();
            startNextWorker();
            break;
          }
        });

        worker.on('error', (err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          errors.push({ taskId: task.taskId, error: errorMessage });
          activeWorkers--;
          startNextWorker();
        });

        worker.on('exit', (code: unknown) => {
          // If the worker exited unexpectedly (no result/error message received),
          // we need to account for it. The 'error' handler above covers crashes.
          // Exit code 0 is normal (worker finished). Non-zero without error handler
          // means something unexpected happened.
          if (typeof code === 'number' && code !== 0) {
            // Only handle if we haven't already decremented (check via activeWorkers)
            // This is a safety net — most crashes are caught by the 'error' event.
          }
        });
      };

      // Start initial batch of workers
      const initialBatch = Math.min(this.maxWorkers, tasks.length);
      for (let i = 0; i < initialBatch; i++) {
        startNextWorker();
      }
    });
  }
}
