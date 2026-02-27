import { loadPyodide, type PyodideInterface } from 'pyodide';
import type { PythonWorkerMessage, PythonWorkerRequest } from './runtimeProtocol';
import { parseMacroContextV1, parseMacroResultV1 } from './abiV1';
import { resolvePyodideIndexURL } from './pyodideAssetUrl';
import { runPythonSyntaxCheck } from './pythonSyntaxCheck';
import { generatePythonApiModuleV1 } from '../../main/shared/generatePythonApiModuleV1';

let runtime: PyodideInterface | null = null;
let activeRequestId: string | null = null;
let apiCallCounter = 0;

interface PendingApiCall {
  requestId: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const pendingApiCalls = new Map<string, PendingApiCall>();

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

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function rejectPendingApiCallsForRequest(requestId: string, message: string): void {
  for (const [callId, pendingCall] of pendingApiCalls.entries()) {
    if (pendingCall.requestId !== requestId) {
      continue;
    }
    pendingApiCalls.delete(callId);
    pendingCall.reject(new Error(message));
  }
}

function requestHostApi(requestId: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  apiCallCounter += 1;
  const callId = `api-${apiCallCounter}`;

  return new Promise((resolve, reject) => {
    pendingApiCalls.set(callId, {
      requestId,
      resolve,
      reject,
    });

    postRuntimeMessage({
      type: 'apiCall',
      requestId,
      callId,
      method,
      args,
    });
  });
}

function handleApiResultMessage(request: PythonWorkerRequest): void {
  if (request.type !== 'apiResult') {
    return;
  }

  const pendingCall = pendingApiCalls.get(request.callId);
  if (!pendingCall) {
    return;
  }

  pendingApiCalls.delete(request.callId);

  if (request.ok) {
    pendingCall.resolve(request.result);
    return;
  }

  pendingCall.reject(new Error(request.error ?? 'Host API call failed'));
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
    rejectPendingApiCallsForRequest(request.requestId, 'Python script execution failed');
    const message = error instanceof Error ? error.message : String(error);
    postRuntimeMessage({ type: 'runError', requestId: request.requestId, error: message });
  } finally {
    rejectPendingApiCallsForRequest(request.requestId, 'Python script execution finished');
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

    const macroEntrypoint = request.entrypoint || 'render';
    runtime.globals.set('__bds_macro_entrypoint', macroEntrypoint);
    runtime.globals.set('__bds_macro_post_data_json', request.postDataJson ?? '');

    await runPythonCode(request.code, request.cacheKey);

    const rawJsonResult = await runtime.runPythonAsync(`
import json as _json
_macro_ep = __bds_macro_entrypoint
_macro_fn = globals().get(_macro_ep)
if _macro_fn is None or not callable(_macro_fn):
    raise RuntimeError(f"Macro entrypoint '{_macro_ep}' is not callable")
_macro_post_json = __bds_macro_post_data_json
_macro_post = _json.loads(_macro_post_json) if _macro_post_json else None
_json.dumps(_macro_fn(__bds_context_v1, _macro_post))
`);

    const parsedResult = parseMacroResultV1(JSON.parse(toResultString(rawJsonResult)));
    postRuntimeMessage({
      type: 'macroResult',
      requestId: request.requestId,
      result: parsedResult,
    });
  } catch (error) {
    rejectPendingApiCallsForRequest(request.requestId, 'Python macro execution failed');
    const message = error instanceof Error ? error.message : String(error);
    postRuntimeMessage({ type: 'runError', requestId: request.requestId, error: message });
  } finally {
    rejectPendingApiCallsForRequest(request.requestId, 'Python macro execution finished');
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
    rejectPendingApiCallsForRequest(request.requestId, 'Entrypoint inspection failed');
    const message = error instanceof Error ? error.message : String(error);
    postRuntimeMessage({ type: 'runError', requestId: request.requestId, error: message });
  } finally {
    rejectPendingApiCallsForRequest(request.requestId, 'Entrypoint inspection finished');
    activeRequestId = null;
  }
}

async function syntaxCheck(request: PythonWorkerRequest): Promise<void> {
  if (request.type !== 'syntaxCheck') {
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
    const errors = await runPythonSyntaxCheck(runtime, request.code);

    postRuntimeMessage({
      type: 'syntaxResult',
      requestId: request.requestId,
      errors,
    });
  } catch (error) {
    rejectPendingApiCallsForRequest(request.requestId, 'Syntax check failed');
    const message = error instanceof Error ? error.message : String(error);
    postRuntimeMessage({ type: 'runError', requestId: request.requestId, error: message });
  } finally {
    rejectPendingApiCallsForRequest(request.requestId, 'Syntax check finished');
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

    runtime.registerJsModule('__bds_transport', {
      call_host_api: async (method: unknown, argsJson: unknown) => {
        if (!activeRequestId) {
          throw new Error('No active Python request for host API bridge');
        }

        if (typeof method !== 'string' || method.length === 0) {
          throw new Error('Host API method must be a non-empty string');
        }

        let parsedArgs: Record<string, unknown> = {};
        if (typeof argsJson === 'string' && argsJson.length > 0) {
          const decoded = JSON.parse(argsJson);
          parsedArgs = toRecord(decoded);
        }

        const result = await requestHostApi(activeRequestId, method, parsedArgs);
        return JSON.stringify(result ?? null);
      },
    });

    runtime.globals.set('__bds_api_module_source', generatePythonApiModuleV1());
    await runtime.runPythonAsync(`
import sys
import types

__bds_api_module = types.ModuleType("bds_api")
exec(__bds_api_module_source, __bds_api_module.__dict__)

from __bds_transport import call_host_api as __bds_call_host_api
__bds_api_module.bds = __bds_api_module.install_bds_api(__bds_call_host_api)
sys.modules["bds_api"] = __bds_api_module
`);

    postRuntimeMessage({ type: 'ready' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postRuntimeMessage({ type: 'error', error: message });
  }
}

self.onmessage = (event: MessageEvent<PythonWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'apiResult') {
    handleApiResultMessage(request);
    return;
  }

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
    return;
  }

  if (request.type === 'syntaxCheck') {
    void syntaxCheck(request);
  }
};

void bootstrapRuntime();
