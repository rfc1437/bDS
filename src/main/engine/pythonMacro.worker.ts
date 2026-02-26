import { parentPort } from 'worker_threads';

interface WorkerRenderMacroRequest {
  type: 'renderMacro';
  requestId: string;
  scriptContent: string;
  entrypoint: string;
  contextJson: string;
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

type WorkerResponseMessage = WorkerReadyMessage | WorkerMacroResultMessage | WorkerMacroErrorMessage | WorkerFatalErrorMessage;

type PyodideRuntime = {
  globals: {
    set: (name: string, value: unknown) => void;
  } | any;
  runPythonAsync: (code: string) => Promise<unknown>;
};

let runtimePromise: Promise<PyodideRuntime> | null = null;
let lastCacheKey: string | null = null;

function postMessage(message: WorkerResponseMessage): void {
  parentPort?.postMessage(message);
}

async function getRuntime(): Promise<PyodideRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const pyodideModule = await import('pyodide');
      return (await pyodideModule.loadPyodide()) as unknown as PyodideRuntime;
    })();
  }

  return runtimePromise;
}

async function renderMacro(request: WorkerRenderMacroRequest): Promise<void> {
  try {
    const runtime = await getRuntime();

    const shouldReloadScript = !request.cacheKey || request.cacheKey !== lastCacheKey;

    if (shouldReloadScript) {
      await runtime.runPythonAsync(request.scriptContent);
      lastCacheKey = request.cacheKey ?? null;
    }

    runtime.globals.set('__bds_macro_context_json', request.contextJson);
    runtime.globals.set('__bds_macro_entrypoint', request.entrypoint);

    const rawResult = await runtime.runPythonAsync(`
import json as _json

_macro_ctx = _json.loads(__bds_macro_context_json)
_macro_ep = __bds_macro_entrypoint
_macro_fn = globals().get(_macro_ep)
if _macro_fn is None or not callable(_macro_fn):
    raise RuntimeError(f"Macro entrypoint '{_macro_ep}' is not callable")
_macro_result = _macro_fn(_macro_ctx)
if _macro_result is None:
    raise RuntimeError("Macro function returned None")
if not isinstance(_macro_result, dict):
    raise RuntimeError("Macro function must return a dict with at least an 'html' key")
if "html" not in _macro_result:
    raise RuntimeError("Macro result must contain an 'html' key")
_json.dumps(_macro_result)
`);

    const parsed = JSON.parse(String(rawResult));

    postMessage({
      type: 'macroResult',
      requestId: request.requestId,
      html: typeof parsed.html === 'string' ? parsed.html : '',
      data: parsed.data,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postMessage({ type: 'macroError', requestId: request.requestId, error: message });
  }
}

parentPort?.on('message', (message: WorkerRenderMacroRequest) => {
  if (message.type !== 'renderMacro') {
    return;
  }

  void renderMacro(message);
});

void getRuntime()
  .then(() => {
    postMessage({ type: 'ready' });
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    postMessage({ type: 'error', error: message });
  });
