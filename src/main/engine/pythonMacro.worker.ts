import { parentPort } from 'worker_threads';

interface WorkerRenderMacroRequest {
  type: 'renderMacro';
  requestId: string;
  scriptContent: string;
  entrypoint: string;
  contextJson: string;
  postDataJson?: string | null;
  cacheKey?: string;
}

interface WorkerApiResultMessage {
  type: 'apiResult';
  callId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

type WorkerIncomingMessage = WorkerRenderMacroRequest | WorkerApiResultMessage;

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

type WorkerResponseMessage = WorkerReadyMessage | WorkerMacroResultMessage | WorkerMacroErrorMessage | WorkerFatalErrorMessage | WorkerApiCallMessage;

type PyodideRuntime = {
  globals: {
    set: (name: string, value: unknown) => void;
  } | any;
  runPythonAsync: (code: string) => Promise<unknown>;
  registerJsModule: (name: string, module: Record<string, unknown>) => void;
};

let runtimePromise: Promise<PyodideRuntime> | null = null;
let lastCacheKey: string | null = null;
let activeRequestId: string | null = null;
let apiCallCounter = 0;

interface PendingApiCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const pendingApiCalls = new Map<string, PendingApiCall>();

function postWorkerMessage(message: WorkerResponseMessage): void {
  parentPort?.postMessage(message);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function requestHostApi(requestId: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  apiCallCounter += 1;
  const callId = `api-${apiCallCounter}`;

  return new Promise((resolve, reject) => {
    pendingApiCalls.set(callId, { resolve, reject });

    postWorkerMessage({
      type: 'apiCall',
      requestId,
      callId,
      method,
      args,
    });
  });
}

function handleApiResultMessage(message: WorkerApiResultMessage): void {
  const pendingCall = pendingApiCalls.get(message.callId);
  if (!pendingCall) {
    return;
  }

  pendingApiCalls.delete(message.callId);

  if (message.ok) {
    pendingCall.resolve(message.result);
    return;
  }

  pendingCall.reject(new Error(message.error ?? 'Host API call failed'));
}

function rejectPendingApiCalls(message: string): void {
  for (const [callId, pendingCall] of pendingApiCalls.entries()) {
    pendingApiCalls.delete(callId);
    pendingCall.reject(new Error(message));
  }
}

async function getRuntime(): Promise<PyodideRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const pyodideModule = await import('pyodide');
      const runtime = (await pyodideModule.loadPyodide()) as unknown as PyodideRuntime;

      // Register bds_api transport bridge
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

      // Install bds_api module
      const { generatePythonApiModuleV1 } = await import('../shared/generatePythonApiModuleV1');
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

      return runtime;
    })();
  }

  return runtimePromise;
}

async function renderMacro(request: WorkerRenderMacroRequest): Promise<void> {
  activeRequestId = request.requestId;
  try {
    const runtime = await getRuntime();

    const shouldReloadScript = !request.cacheKey || request.cacheKey !== lastCacheKey;

    if (shouldReloadScript) {
      await runtime.runPythonAsync(request.scriptContent);
      lastCacheKey = request.cacheKey ?? null;
    }

    runtime.globals.set('__bds_macro_context_json', request.contextJson);
    runtime.globals.set('__bds_macro_entrypoint', request.entrypoint);
    runtime.globals.set('__bds_macro_post_data_json', request.postDataJson ?? '');

    const rawResult = await runtime.runPythonAsync(`
import json as _json
import inspect as _inspect

_macro_ctx = _json.loads(__bds_macro_context_json)
_macro_ep = __bds_macro_entrypoint
_macro_fn = globals().get(_macro_ep)
if _macro_fn is None or not callable(_macro_fn):
    raise RuntimeError(f"Macro entrypoint '{_macro_ep}' is not callable")
_macro_post_json = __bds_macro_post_data_json
_macro_post = _json.loads(_macro_post_json) if _macro_post_json else None
_macro_call = _macro_fn(_macro_ctx, _macro_post)
if _inspect.isawaitable(_macro_call):
    _macro_result = await _macro_call
else:
    _macro_result = _macro_call
if _macro_result is None:
    raise RuntimeError("Macro function returned None")
if not isinstance(_macro_result, dict):
    raise RuntimeError("Macro function must return a dict with at least an 'html' key")
if "html" not in _macro_result:
    raise RuntimeError("Macro result must contain an 'html' key")
_json.dumps(_macro_result)
`);

    const parsed = JSON.parse(String(rawResult));

    postWorkerMessage({
      type: 'macroResult',
      requestId: request.requestId,
      html: typeof parsed.html === 'string' ? parsed.html : '',
      data: parsed.data,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : undefined,
    });
  } catch (error) {
    rejectPendingApiCalls('Python macro execution failed');
    const message = error instanceof Error ? error.message : String(error);
    postWorkerMessage({ type: 'macroError', requestId: request.requestId, error: message });
  } finally {
    rejectPendingApiCalls('Python macro execution finished');
    activeRequestId = null;
  }
}

parentPort?.on('message', (message: WorkerIncomingMessage) => {
  if (message.type === 'apiResult') {
    handleApiResultMessage(message);
    return;
  }

  if (message.type !== 'renderMacro') {
    return;
  }

  void renderMacro(message);
});

void getRuntime()
  .then(() => {
    postWorkerMessage({ type: 'ready' });
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    postWorkerMessage({ type: 'error', error: message });
  });
