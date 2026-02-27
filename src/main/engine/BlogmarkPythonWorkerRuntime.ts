import * as path from 'path';
import { Worker } from 'worker_threads';

export interface BlogmarkWorkerLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  postMessage(message: unknown): void;
  terminate(): void;
  removeAllListeners(): void;
}

export type BlogmarkWorkerFactory = (workerPath: string) => BlogmarkWorkerLike;

interface WorkerRunTransformRequest {
  type: 'runTransform';
  requestId: string;
  scriptContent: string;
  entrypoint: string;
  payloadJson: string;
}

interface WorkerReadyMessage {
  type: 'ready';
}

interface WorkerResultMessage {
  type: 'transformResult';
  requestId: string;
  output: unknown;
  toasts: string[];
}

interface WorkerErrorMessage {
  type: 'transformError';
  requestId: string;
  error: string;
}

interface WorkerFatalErrorMessage {
  type: 'error';
  error: string;
}

type WorkerResponseMessage = WorkerReadyMessage | WorkerResultMessage | WorkerErrorMessage | WorkerFatalErrorMessage;

interface QueuedRequest {
  request: WorkerRunTransformRequest;
  timeoutMs: number;
  resolve: (value: { output: unknown; toasts: string[] }) => void;
  reject: (error: Error) => void;
}

interface ActiveRequest extends QueuedRequest {
  timeoutId: ReturnType<typeof setTimeout> | null;
}

export class BlogmarkPythonWorkerRuntime {
  private worker: BlogmarkWorkerLike | null = null;
  private workerReady = false;
  private workerStartPromise: Promise<void> | null = null;
  private workerStartResolve: (() => void) | null = null;
  private workerStartReject: ((error: Error) => void) | null = null;
  private activeRequest: ActiveRequest | null = null;
  private queue: QueuedRequest[] = [];
  private requestCounter = 0;
  private readonly workerFactory: BlogmarkWorkerFactory;

  constructor(workerFactory?: BlogmarkWorkerFactory) {
    this.workerFactory = workerFactory ?? ((workerPath: string) => new Worker(workerPath) as unknown as BlogmarkWorkerLike);
  }

  async executeTransform(params: {
    scriptContent: string;
    entrypoint: string;
    payloadJson: string;
    timeoutMs?: number;
  }): Promise<{ output: unknown; toasts: string[] }> {
    const requestId = this.nextRequestId();
    const timeoutMs = params.timeoutMs ?? 5000;

    return new Promise<{ output: unknown; toasts: string[] }>((resolve, reject) => {
      this.queue.push({
        request: {
          type: 'runTransform',
          requestId,
          scriptContent: params.scriptContent,
          entrypoint: params.entrypoint,
          payloadJson: params.payloadJson,
        },
        timeoutMs,
        resolve,
        reject,
      });

      this.dispatchNext().catch((error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  dispose(): void {
    this.rejectStartPromise(new Error('Python worker runtime disposed'));
    this.rejectActiveAndQueue(new Error('Python worker runtime disposed'));
    this.resetWorker();
  }

  private async dispatchNext(): Promise<void> {
    if (this.activeRequest || this.queue.length === 0) {
      return;
    }

    await this.ensureWorkerStarted();

    // Re-check guard after await — another dispatchNext() may have
    // activated a request while we were waiting for the worker.
    if (this.activeRequest || this.queue.length === 0) {
      return;
    }

    const nextRequest = this.queue.shift();
    if (!nextRequest) {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (!this.activeRequest || this.activeRequest.request.requestId !== nextRequest.request.requestId) {
        return;
      }

      const timeoutError = new Error(`Python transform timed out after ${nextRequest.timeoutMs}ms`);
      this.activeRequest.reject(timeoutError);
      this.activeRequest = null;
      this.resetWorker();
      void this.dispatchNext();
    }, nextRequest.timeoutMs);

    this.activeRequest = {
      ...nextRequest,
      timeoutId,
    };

    this.worker?.postMessage(nextRequest.request);
  }

  private async ensureWorkerStarted(): Promise<void> {
    if (this.worker && this.workerReady) {
      return;
    }

    if (this.workerStartPromise) {
      return this.workerStartPromise;
    }

    const workerPath = path.join(__dirname, 'blogmarkPython.worker.js');
    this.worker = this.workerFactory(workerPath);
    this.workerReady = false;

    this.worker.on('message', (...args: unknown[]) => {
      this.handleWorkerMessage(args[0] as WorkerResponseMessage);
    });

    this.worker.on('error', (...args: unknown[]) => {
      const error = args[0];
      this.handleWorkerCrash(error instanceof Error ? error : new Error(String(error)));
    });

    this.worker.on('exit', (...args: unknown[]) => {
      const code = args[0] as number;
      if (code !== 0) {
        this.handleWorkerCrash(new Error(`Python worker exited with code ${code}`));
      }
    });

    this.workerStartPromise = new Promise<void>((resolve, reject) => {
      this.workerStartResolve = resolve;
      this.workerStartReject = reject;
    });

    return this.workerStartPromise;
  }

  private handleWorkerMessage(message: WorkerResponseMessage): void {
    if (message.type === 'ready') {
      this.workerReady = true;
      this.resolveStartPromise();
      return;
    }

    if (message.type === 'error') {
      this.handleWorkerCrash(new Error(message.error));
      return;
    }

    const active = this.activeRequest;
    if (!active) {
      return;
    }

    if (active.request.requestId !== message.requestId) {
      return;
    }

    if (active.timeoutId) {
      clearTimeout(active.timeoutId);
    }

    this.activeRequest = null;

    if (message.type === 'transformResult') {
      active.resolve({ output: message.output, toasts: message.toasts });
    } else {
      active.reject(new Error(message.error));
    }

    void this.dispatchNext();
  }

  private handleWorkerCrash(error: Error): void {
    this.rejectStartPromise(error);
    this.rejectActiveAndQueue(error);
    this.resetWorker();
  }

  private rejectActiveAndQueue(error: Error): void {
    if (this.activeRequest) {
      if (this.activeRequest.timeoutId) {
        clearTimeout(this.activeRequest.timeoutId);
      }
      this.activeRequest.reject(error);
      this.activeRequest = null;
    }

    while (this.queue.length > 0) {
      const queued = this.queue.shift();
      queued?.reject(error);
    }
  }

  private resolveStartPromise(): void {
    if (this.workerStartResolve) {
      this.workerStartResolve();
    }
    this.workerStartResolve = null;
    this.workerStartReject = null;
    this.workerStartPromise = null;
  }

  private rejectStartPromise(error: Error): void {
    if (this.workerStartReject) {
      this.workerStartReject(error);
    }
    this.workerStartResolve = null;
    this.workerStartReject = null;
    this.workerStartPromise = null;
  }

  private resetWorker(): void {
    if (this.worker) {
      this.worker.removeAllListeners();
      this.worker.terminate();
    }

    this.worker = null;
    this.workerReady = false;
    this.workerStartPromise = null;
    this.workerStartResolve = null;
    this.workerStartReject = null;
  }

  private nextRequestId(): string {
    this.requestCounter += 1;
    return `blogmark-py-${this.requestCounter}`;
  }
}

let blogmarkPythonWorkerRuntimeInstance: BlogmarkPythonWorkerRuntime | null = null;

export function getBlogmarkPythonWorkerRuntime(): BlogmarkPythonWorkerRuntime {
  if (!blogmarkPythonWorkerRuntimeInstance) {
    blogmarkPythonWorkerRuntimeInstance = new BlogmarkPythonWorkerRuntime();
  }

  return blogmarkPythonWorkerRuntimeInstance;
}
