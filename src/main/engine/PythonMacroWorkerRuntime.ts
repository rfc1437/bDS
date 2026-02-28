import * as path from 'path';
import { Worker } from 'worker_threads';

interface WorkerRenderMacroRequest {
  type: 'renderMacro';
  requestId: string;
  scriptContent: string;
  entrypoint: string;
  contextJson: string;
  postDataJson?: string | null;
  cacheKey?: string;
}

interface WorkerReadyMessage {
  type: 'ready';
}

interface WorkerMacroResultMessage {
  type: 'macroResult';
  requestId: string;
  html: string;
  data?: Record<string, unknown>;
  warnings?: string[];
}

interface WorkerMacroErrorMessage {
  type: 'macroError';
  requestId: string;
  error: string;
}

interface WorkerFatalErrorMessage {
  type: 'error';
  error: string;
}

interface WorkerApiCallMessage {
  type: 'apiCall';
  requestId: string;
  callId: string;
  method: string;
  args: Record<string, unknown>;
}

interface WorkerApiResultMessage {
  type: 'apiResult';
  callId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

type WorkerResponseMessage = WorkerReadyMessage | WorkerMacroResultMessage | WorkerMacroErrorMessage | WorkerFatalErrorMessage | WorkerApiCallMessage;

export interface MacroRenderParams {
  scriptContent: string;
  entrypoint: string;
  contextJson: string;
  postDataJson?: string | null;
  timeoutMs?: number;
  cacheKey?: string;
}

export interface MacroRenderResult {
  html: string;
  data?: Record<string, unknown>;
  warnings?: string[];
}

interface QueuedRequest {
  request: WorkerRenderMacroRequest;
  timeoutMs: number;
  resolve: (value: MacroRenderResult) => void;
  reject: (error: Error) => void;
}

interface ActiveRequest extends QueuedRequest {
  timeoutId: ReturnType<typeof setTimeout> | null;
}

export interface WorkerLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  postMessage(message: unknown): void;
  terminate(): void;
  removeAllListeners(): void;
}

export type WorkerFactory = (workerPath: string) => WorkerLike;

export type ApiInvoker = (method: string, args: Record<string, unknown>) => Promise<unknown>;

export class PythonMacroWorkerRuntime {
  private worker: WorkerLike | null = null;
  private workerReady = false;
  private workerStartPromise: Promise<void> | null = null;
  private workerStartResolve: (() => void) | null = null;
  private workerStartReject: ((error: Error) => void) | null = null;
  private activeRequest: ActiveRequest | null = null;
  private queue: QueuedRequest[] = [];
  private requestCounter = 0;
  private _macroCount = 0;
  private _errorCount = 0;
  private _timeoutCount = 0;
  private readonly workerFactory: WorkerFactory;
  private readonly apiInvoker: ApiInvoker | null;

  constructor(workerFactory?: WorkerFactory, apiInvoker?: ApiInvoker) {
    this.workerFactory = workerFactory ?? ((workerPath: string) => new Worker(workerPath) as unknown as WorkerLike);
    this.apiInvoker = apiInvoker ?? null;
  }

  async renderMacro(params: MacroRenderParams): Promise<MacroRenderResult> {
    const requestId = this.nextRequestId();
    const timeoutMs = params.timeoutMs ?? 5000;

    return new Promise<MacroRenderResult>((resolve, reject) => {
      this.queue.push({
        request: {
          type: 'renderMacro',
          requestId,
          scriptContent: params.scriptContent,
          entrypoint: params.entrypoint,
          contextJson: params.contextJson,
          postDataJson: params.postDataJson ?? null,
          cacheKey: params.cacheKey,
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

  get macroCount(): number {
    return this._macroCount;
  }

  get errorCount(): number {
    return this._errorCount;
  }

  get timeoutCount(): number {
    return this._timeoutCount;
  }

  resetCounters(): void {
    this._macroCount = 0;
    this._errorCount = 0;
    this._timeoutCount = 0;
  }

  dispose(): void {
    this.rejectStartPromise(new Error('Python macro worker runtime disposed'));
    this.rejectActiveAndQueue(new Error('Python macro worker runtime disposed'));
    this.resetWorker();
  }

  private async dispatchNext(): Promise<void> {
    if (this.activeRequest || this.queue.length === 0) {
      return;
    }

    await this.ensureWorkerStarted();

    const nextRequest = this.queue.shift();
    if (!nextRequest) {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (!this.activeRequest || this.activeRequest.request.requestId !== nextRequest.request.requestId) {
        return;
      }

      this._timeoutCount += 1;
      const timeoutError = new Error(`Python macro timed out after ${nextRequest.timeoutMs}ms`);
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

    const workerPath = path.join(__dirname, 'pythonMacro.worker.js');
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
        this.handleWorkerCrash(new Error(`Python macro worker exited with code ${code}`));
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

    if (message.type === 'apiCall') {
      void this.handleApiCall(message);
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
    this._macroCount += 1;

    if (message.type === 'macroResult') {
      active.resolve({
        html: message.html,
        data: message.data,
        warnings: message.warnings,
      });
    } else {
      this._errorCount += 1;
      active.reject(new Error(message.error));
    }

    void this.dispatchNext();
  }

  private handleWorkerCrash(error: Error): void {
    this.rejectStartPromise(error);
    this.rejectActiveAndQueue(error);
    this.resetWorker();
  }

  private async handleApiCall(message: WorkerApiCallMessage): Promise<void> {
    if (!this.worker || !this.apiInvoker) {
      this.worker?.postMessage({
        type: 'apiResult',
        callId: message.callId,
        ok: false,
        error: 'API invoker not available',
      } satisfies WorkerApiResultMessage);
      return;
    }

    try {
      const result = await this.apiInvoker(message.method, message.args);
      this.worker?.postMessage({
        type: 'apiResult',
        callId: message.callId,
        ok: true,
        result,
      } satisfies WorkerApiResultMessage);
    } catch (error) {
      this.worker?.postMessage({
        type: 'apiResult',
        callId: message.callId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies WorkerApiResultMessage);
    }
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
    return `py-macro-${this.requestCounter}`;
  }
}

