import { parentPort } from 'worker_threads';

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

type PyodideRuntime = {
  globals: {
    set: (name: string, value: unknown) => void;
  } | any;
  runPythonAsync: (code: string) => Promise<unknown>;
};

const MAX_TOASTS_PER_SCRIPT = 5;
const MAX_TOAST_LENGTH = 300;

let runtimePromise: Promise<PyodideRuntime> | null = null;

function postMessage(message: WorkerResponseMessage): void {
  parentPort?.postMessage(message);
}

function normalizeToastMessage(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.slice(0, MAX_TOAST_LENGTH);
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

async function runTransform(request: WorkerRunTransformRequest): Promise<void> {
  try {
    const runtime = await getRuntime();
    const toastMessages: string[] = [];

    const pushToast = (message: unknown): void => {
      if (toastMessages.length >= MAX_TOASTS_PER_SCRIPT) {
        return;
      }

      const normalized = normalizeToastMessage(message);
      if (!normalized) {
        return;
      }

      toastMessages.push(normalized);
    };

    runtime.globals.set('__bds_push_toast', pushToast);
    await runtime.runPythonAsync(`
def toast(message):
    __bds_push_toast(str(message))
`);

    await runtime.runPythonAsync(request.scriptContent);
    runtime.globals.set('__bds_transform_payload_json', request.payloadJson);
    runtime.globals.set('__bds_transform_entrypoint', request.entrypoint);

    const rawResult = await runtime.runPythonAsync(`
import json
_payload = json.loads(__bds_transform_payload_json)
_entrypoint = __bds_transform_entrypoint
_transform_fn = globals().get(_entrypoint)
if _transform_fn is None or not callable(_transform_fn):
    raise RuntimeError(f"Transform entrypoint '{_entrypoint}' is not callable")
_post = _payload.get("post")
if not isinstance(_post, dict):
    raise RuntimeError("Transform payload is missing a valid 'post' object")
_context = _payload.get("context")
try:
    _result = _transform_fn(_post, _context)
except TypeError:
    _result = _transform_fn(_post)
if _result is None:
    _result = _post
json.dumps(_result)
`);

    postMessage({
      type: 'transformResult',
      requestId: request.requestId,
      output: JSON.parse(String(rawResult)),
      toasts: toastMessages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postMessage({ type: 'transformError', requestId: request.requestId, error: message });
  }
}

parentPort?.on('message', (message: WorkerRunTransformRequest) => {
  if (message.type !== 'runTransform') {
    return;
  }

  void runTransform(message);
});

void getRuntime()
  .then(() => {
    postMessage({ type: 'ready' });
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    postMessage({ type: 'error', error: message });
  });
