import { loadPyodide, type PyodideInterface } from 'pyodide';
import type { PythonWorkerMessage, PythonWorkerRequest } from './runtimeProtocol';
import { parseMacroContextV1, parseMacroResultV1 } from './abiV1';
import { resolvePyodideIndexURL } from './pyodideAssetUrl';

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

async function runPythonCode(code: string, cacheKey?: string): Promise<unknown> {
  if (!runtime) {
    throw new Error('Python runtime is not ready');
  }

  if (!cacheKey) {
    return runtime.runPythonAsync(code);
  }

  runtime.globals.set('__bds_source_code', code);
  runtime.globals.set('__bds_cache_key', cacheKey);

  return runtime.runPythonAsync(`
__bds_compiled_cache = globals().setdefault("__bds_compiled_cache", {})
__bds_compiled_code = __bds_compiled_cache.get(__bds_cache_key)
if __bds_compiled_code is None:
    __bds_compiled_code = compile(__bds_source_code, f"<bds:{__bds_cache_key}>", "exec")
    __bds_compiled_cache[__bds_cache_key] = __bds_compiled_code
exec(__bds_compiled_code, globals(), globals())
`);
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
    let result: unknown;
    if (request.entrypoint && request.entrypoint !== 'main') {
      await runPythonCode(request.code, request.cacheKey);
      runtime.globals.set('__bds_selected_entrypoint', request.entrypoint);
      result = await runtime.runPythonAsync(`
__bds_target = globals().get(__bds_selected_entrypoint)
if __bds_target is None:
    raise NameError(f"Entrypoint '{__bds_selected_entrypoint}' not found")
if not callable(__bds_target):
    raise TypeError(f"Entrypoint '{__bds_selected_entrypoint}' is not callable")
__bds_target()
`);
    } else {
      result = await runPythonCode(request.code, request.cacheKey);
    }

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

    await runPythonCode(request.code, request.cacheKey);

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

async function inspectEntrypoints(request: PythonWorkerRequest): Promise<void> {
  if (request.type !== 'inspectEntrypoints') {
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
    runtime.globals.set('__bds_entrypoints_source', request.code);
    const rawJsonResult = await runtime.runPythonAsync(`
import ast
import json

__bds_entrypoints_tree = ast.parse(__bds_entrypoints_source)
__bds_entrypoints = []
for __bds_node in __bds_entrypoints_tree.body:
    if isinstance(__bds_node, (ast.FunctionDef, ast.AsyncFunctionDef)) and not __bds_node.name.startswith('_'):
        __bds_entrypoints.append(__bds_node.name)

json.dumps(__bds_entrypoints)
`);

    const parsed = JSON.parse(toResultString(rawJsonResult));
    const entrypoints = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];

    postRuntimeMessage({
      type: 'entrypoints',
      requestId: request.requestId,
      entrypoints,
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
    const indexURL = resolvePyodideIndexURL(import.meta.url);
    runtime = await loadPyodide({
      ...(indexURL ? { indexURL } : {}),
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
    return;
  }

  if (request.type === 'inspectEntrypoints') {
    void inspectEntrypoints(request);
  }
};

void bootstrapRuntime();
