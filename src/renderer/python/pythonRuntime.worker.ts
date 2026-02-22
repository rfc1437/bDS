import { loadPyodide, type PyodideInterface } from 'pyodide';
import type { PythonWorkerMessage, PythonWorkerRequest } from './runtimeProtocol';
import { parseMacroContextV1, parseMacroResultV1 } from './abiV1';

let runtime: PyodideInterface | null = null;
let activeRequestId: string | null = null;

function postRuntimeMessage(message: PythonWorkerMessage): void {
  self.postMessage(message);
}

function toResultString(result: unknown): string {
  if (result === undefined || result === null) {
    return '';
  }
  if (typeof result === 'string') {
    return result;
  }
  return String(result);
}

async function runScript(request: PythonWorkerRequest): Promise<void> {
  if (request.type !== 'run') {
    return;
  }

  if (!runtime) {
    postRuntimeMessage({ type: 'runError', requestId: request.requestId, error: 'Python runtime is not ready' });
    return;
  }

  if (activeRequestId) {
    postRuntimeMessage({ type: 'runError', requestId: request.requestId, error: 'Python runtime is busy' });
    return;
  }

  activeRequestId = request.requestId;

  try {
    const result = await runtime.runPythonAsync(request.code);
    postRuntimeMessage({
      type: 'runResult',
      requestId: request.requestId,
      result: toResultString(result),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postRuntimeMessage({ type: 'runError', requestId: request.requestId, error: message });
  } finally {
    activeRequestId = null;
  }
}

async function runMacroV1(request: PythonWorkerRequest): Promise<void> {
  if (request.type !== 'renderMacroV1') {
    return;
  }

  if (!runtime) {
    postRuntimeMessage({ type: 'runError', requestId: request.requestId, error: 'Python runtime is not ready' });
    return;
  }

  if (activeRequestId) {
    postRuntimeMessage({ type: 'runError', requestId: request.requestId, error: 'Python runtime is busy' });
    return;
  }

  activeRequestId = request.requestId;

  try {
    const validatedContext = parseMacroContextV1(request.context);
    runtime.globals.set('__bds_context_v1', validatedContext);

    await runtime.runPythonAsync(request.code);

    const rawJsonResult = await runtime.runPythonAsync(`
import json
json.dumps(render(__bds_context_v1))
`);

    const parsedResult = parseMacroResultV1(JSON.parse(toResultString(rawJsonResult)));
    postRuntimeMessage({
      type: 'macroResult',
      requestId: request.requestId,
      result: parsedResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postRuntimeMessage({ type: 'runError', requestId: request.requestId, error: message });
  } finally {
    activeRequestId = null;
  }
}

async function bootstrapRuntime(): Promise<void> {
  try {
    runtime = await loadPyodide({
      stdout: (chunk) => {
        if (!activeRequestId) {
          return;
        }
        postRuntimeMessage({ type: 'stdout', requestId: activeRequestId, chunk });
      },
    });
    if (!runtime) {
      throw new Error('Pyodide initialization returned no runtime');
    }
    postRuntimeMessage({ type: 'ready' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postRuntimeMessage({ type: 'error', error: message });
  }
}

self.onmessage = (event: MessageEvent<PythonWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'run') {
    void runScript(request);
    return;
  }

  if (request.type === 'renderMacroV1') {
    void runMacroV1(request);
  }
};

void bootstrapRuntime();
