import { createPythonRuntimeWorker } from './createPythonRuntimeWorker';
import type { PythonWorkerMessage, PythonWorkerRequest } from './runtimeProtocol';
import { parseMacroContextV1, parseMacroResultV1, type MacroContextV1, type MacroResultV1 } from './abiV1';

type WorkerFactory = () => Worker;

interface InitializeDeferred {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface PendingRun {
  kind: 'run' | 'macro-v1';
  stdout: string;
  resolve: (value: PythonRunResult | PythonMacroV1Result) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

export interface PythonRunResult {
  result: string;
  stdout: string;
}

export interface PythonExecuteOptions {
  timeoutMs?: number;
}

export interface PythonMacroV1Result {
  result: MacroResultV1;
  stdout: string;
}

export class PythonRuntimeManager {
  private worker: Worker | null = null;
  private initializingPromise: Promise<void> | null = null;
  private initializeDeferred: InitializeDeferred | null = null;
  private ready = false;
  private pendingRuns = new Map<string, PendingRun>();
  private requestCounter = 0;

  constructor(private readonly workerFactory: WorkerFactory = createPythonRuntimeWorker) {}

  initialize(): Promise<void> {
    if (this.ready) {
      return Promise.resolve();
    }

    if (this.initializingPromise) {
      return this.initializingPromise;
    }

    this.worker = this.workerFactory();
    this.ready = false;

    this.initializingPromise = new Promise<void>((resolve, reject) => {
      this.initializeDeferred = { resolve, reject };

      if (!this.worker) {
        this.initializeDeferred = null;
        reject(new Error('Python runtime worker factory returned no worker'));
        return;
      }

      this.worker.onmessage = (event: MessageEvent<PythonWorkerMessage>) => {
        this.handleWorkerMessage(event.data);
      };
      this.worker.onerror = (event: ErrorEvent) => {
        this.handleWorkerError(event.error instanceof Error ? event.error : new Error(event.message || 'Python runtime worker failed to initialize'));
      };
    });

    return this.initializingPromise;
  }

  async execute(code: string, options?: PythonExecuteOptions): Promise<PythonRunResult> {
    await this.initialize();

    if (!this.worker || !this.ready) {
      throw new Error('Python runtime is not ready');
    }

    const requestId = this.nextRequestId();
    const timeoutMs = options?.timeoutMs ?? 5000;

    return new Promise<PythonRunResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRuns.delete(requestId);
        this.resetRuntime(`Python script execution timed out after ${timeoutMs}ms`);
        reject(new Error(`Python script execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRuns.set(requestId, {
        kind: 'run',
        stdout: '',
        resolve: (value) => resolve(value as PythonRunResult),
        reject,
        timeoutId,
      });

      const message: PythonWorkerRequest = {
        type: 'run',
        requestId,
        code,
      };

      this.worker!.postMessage(message);
    });
  }

  async renderMacroV1(code: string, context: unknown, options?: PythonExecuteOptions): Promise<PythonMacroV1Result> {
    const validatedContext = parseMacroContextV1(context);
    await this.initialize();

    if (!this.worker || !this.ready) {
      throw new Error('Python runtime is not ready');
    }

    const requestId = this.nextRequestId();
    const timeoutMs = options?.timeoutMs ?? 5000;

    return new Promise<PythonMacroV1Result>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRuns.delete(requestId);
        this.resetRuntime(`Python script execution timed out after ${timeoutMs}ms`);
        reject(new Error(`Python script execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRuns.set(requestId, {
        kind: 'macro-v1',
        stdout: '',
        resolve: (value) => resolve(value as PythonMacroV1Result),
        reject,
        timeoutId,
      });

      const message: PythonWorkerRequest = {
        type: 'renderMacroV1',
        requestId,
        code,
        context: validatedContext,
      };

      this.worker!.postMessage(message);
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  dispose(): void {
    this.resetRuntime();
  }

  private handleWorkerMessage(payload: PythonWorkerMessage): void {
    if (payload.type === 'ready') {
      this.ready = true;
      this.initializingPromise = null;
      this.initializeDeferred?.resolve();
      this.initializeDeferred = null;
      return;
    }

    if (payload.type === 'error') {
      this.handleWorkerError(new Error(payload.error));
      return;
    }

    const pendingRun = this.pendingRuns.get(payload.requestId);
    if (!pendingRun) {
      return;
    }

    if (payload.type === 'stdout') {
      pendingRun.stdout += payload.chunk;
      return;
    }

    this.pendingRuns.delete(payload.requestId);
    if (pendingRun.timeoutId) {
      clearTimeout(pendingRun.timeoutId);
    }

    if (payload.type === 'runResult') {
      if (pendingRun.kind !== 'run') {
        pendingRun.reject(new Error('Invalid response type for pending macro request'));
        return;
      }
      pendingRun.resolve({ result: payload.result, stdout: pendingRun.stdout });
      return;
    }

    if (payload.type === 'macroResult') {
      if (pendingRun.kind !== 'macro-v1') {
        pendingRun.reject(new Error('Invalid response type for pending run request'));
        return;
      }

      try {
        const validatedResult = parseMacroResultV1(payload.result);
        pendingRun.resolve({ result: validatedResult, stdout: pendingRun.stdout });
      } catch (error) {
        pendingRun.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }

    pendingRun.reject(new Error(payload.error));
  }

  private handleWorkerError(error: Error): void {
    if (this.initializeDeferred) {
      this.initializeDeferred.reject(error);
      this.initializeDeferred = null;
    }

    for (const run of this.pendingRuns.values()) {
      if (run.timeoutId) {
        clearTimeout(run.timeoutId);
      }
      run.reject(error);
    }

    this.pendingRuns.clear();
    this.worker?.terminate();
    this.worker = null;
    this.initializingPromise = null;
    this.ready = false;
  }

  private resetRuntime(timeoutErrorMessage?: string): void {
    if (this.initializeDeferred) {
      this.initializeDeferred.reject(new Error(timeoutErrorMessage ?? 'Python runtime reset'));
      this.initializeDeferred = null;
    }

    for (const run of this.pendingRuns.values()) {
      if (run.timeoutId) {
        clearTimeout(run.timeoutId);
      }
      if (timeoutErrorMessage) {
        run.reject(new Error(timeoutErrorMessage));
      }
    }

    this.pendingRuns.clear();
    this.worker?.terminate();
    this.worker = null;
    this.initializingPromise = null;
    this.ready = false;
  }

  private nextRequestId(): string {
    this.requestCounter += 1;
    return `req-${this.requestCounter}`;
  }
}
