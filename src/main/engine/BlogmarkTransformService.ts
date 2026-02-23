import { z } from 'zod';
import { getScriptEngine } from './ScriptEngine';
import { getMetaEngine } from './MetaEngine';
import { getBlogmarkPythonWorkerRuntime } from './BlogmarkPythonWorkerRuntime';

const transformPostSchema = z.object({
  title: z.string().trim().min(1),
  content: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)),
  categories: z.array(z.string().trim().min(1)),
});

export type BlogmarkTransformedPost = z.infer<typeof transformPostSchema>;

export interface BlogmarkTransformInput {
  post: BlogmarkTransformedPost;
  context: {
    source: 'blogmark';
    url: string;
  };
}

export interface BlogmarkTransformScriptRecord {
  id: string;
  slug: string;
  title: string;
  kind: 'macro' | 'utility' | 'transform';
  entrypoint: string;
  enabled: boolean;
  content: string;
  updatedAt: Date | string;
}

export interface BlogmarkTransformExecutor {
  runTransform(script: BlogmarkTransformScriptRecord, input: BlogmarkTransformInput): Promise<unknown>;
}

export interface BlogmarkTransformScriptProvider {
  getScripts(): Promise<BlogmarkTransformScriptRecord[]>;
}

export interface BlogmarkTransformError {
  scriptId: string;
  scriptSlug: string;
  message: string;
}

export interface BlogmarkTransformExecutionData {
  output: unknown;
  toasts: string[];
}

export interface BlogmarkTransformResult {
  post: BlogmarkTransformedPost;
  appliedScriptIds: string[];
  errors: BlogmarkTransformError[];
  toasts: string[];
}

export type PythonRuntimeMode = 'webworker' | 'main-thread';

const MAX_TOASTS_PER_SCRIPT = 5;
const MAX_TOASTS_TOTAL = 20;
const MAX_TOAST_LENGTH = 300;

const scriptEngineBackedProvider: BlogmarkTransformScriptProvider = {
  async getScripts() {
    return getScriptEngine().getAllScripts();
  },
};

function toTimestamp(value: Date | string): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePost(value: unknown): BlogmarkTransformedPost | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const valueRecord = value as Record<string, unknown>;
  const maybePost = valueRecord.post;

  const candidate = maybePost && typeof maybePost === 'object' && !Array.isArray(maybePost)
    ? maybePost
    : value;

  const parsed = transformPostSchema.safeParse(candidate);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
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

function toExecutionData(value: unknown): BlogmarkTransformExecutionData {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const valueRecord = value as Record<string, unknown>;
    const toasts = Array.isArray(valueRecord.toasts)
      ? valueRecord.toasts
        .map((item) => normalizeToastMessage(item))
        .filter((item): item is string => item !== null)
      : [];

    if (Object.prototype.hasOwnProperty.call(valueRecord, 'output')) {
      return {
        output: valueRecord.output,
        toasts,
      };
    }

    return {
      output: value,
      toasts,
    };
  }

  return {
    output: value,
    toasts: [],
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

function resolveTransformEntrypoint(value: string): string {
  const nextEntrypoint = typeof value === 'string' ? value.trim() : '';
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(nextEntrypoint) && nextEntrypoint !== 'main') {
    return nextEntrypoint;
  }

  return 'transform';
}

function resolvePythonRuntimeMode(value: unknown): PythonRuntimeMode {
  if (value === 'main-thread') {
    return 'main-thread';
  }

  return 'webworker';
}

async function getConfiguredPythonRuntimeMode(): Promise<PythonRuntimeMode> {
  const metadata = await getMetaEngine().getProjectMetadata();
  return resolvePythonRuntimeMode((metadata as { pythonRuntimeMode?: unknown } | null)?.pythonRuntimeMode);
}

class PythonBlogmarkTransformExecutor implements BlogmarkTransformExecutor {
  private runtimePromise: Promise<any> | null = null;

  async runTransform(script: BlogmarkTransformScriptRecord, input: BlogmarkTransformInput): Promise<unknown> {
    const runtime = await this.getRuntime();
    const toastMessages: string[] = [];
    const pushToast = (message: unknown): void => {
      if (toastMessages.length >= MAX_TOASTS_PER_SCRIPT) {
        return;
      }

      const normalizedMessage = normalizeToastMessage(message);
      if (!normalizedMessage) {
        return;
      }

      toastMessages.push(normalizedMessage);
    };

    runtime.globals.set('__bds_push_toast', pushToast);
    await runtime.runPythonAsync(`
def toast(message):
    __bds_push_toast(str(message))
`);

    await runtime.runPythonAsync(script.content);

    const requestedEntrypoint = resolveTransformEntrypoint(script.entrypoint);
    const payload = JSON.stringify(input);
    runtime.globals.set('__bds_transform_payload_json', payload);
    runtime.globals.set('__bds_transform_entrypoint', requestedEntrypoint);

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

    return {
      output: JSON.parse(String(rawResult)),
      toasts: toastMessages,
    };
  }

  private async getRuntime(): Promise<any> {
    if (!this.runtimePromise) {
      this.runtimePromise = (async () => {
        const pyodideModule = await import('pyodide');
        return pyodideModule.loadPyodide();
      })();
    }

    return this.runtimePromise;
  }
}

class PythonWorkerBlogmarkTransformExecutor implements BlogmarkTransformExecutor {
  async runTransform(script: BlogmarkTransformScriptRecord, input: BlogmarkTransformInput): Promise<unknown> {
    return getBlogmarkPythonWorkerRuntime().executeTransform({
      scriptContent: script.content,
      entrypoint: resolveTransformEntrypoint(script.entrypoint),
      payloadJson: JSON.stringify(input),
    });
  }
}

const mainThreadExecutor = new PythonBlogmarkTransformExecutor();
const workerExecutor = new PythonWorkerBlogmarkTransformExecutor();

export class BlogmarkTransformService {
  constructor(
    private readonly dependencies: {
      provider?: BlogmarkTransformScriptProvider;
      executor?: BlogmarkTransformExecutor;
      resolvePythonRuntimeMode?: () => Promise<PythonRuntimeMode>;
      executors?: Partial<Record<PythonRuntimeMode, BlogmarkTransformExecutor>>;
    } = {},
  ) {}

  async applyTransforms(input: BlogmarkTransformInput): Promise<BlogmarkTransformResult> {
    const parsedInput = transformPostSchema.parse(input.post);
    const transformInput: BlogmarkTransformInput = {
      ...input,
      post: parsedInput,
    };

    const provider = this.dependencies.provider ?? scriptEngineBackedProvider;
    const executor = this.dependencies.executor ?? await this.resolveExecutorForConfiguredRuntime();

    const scripts = await provider.getScripts();
    const activeTransforms = scripts
      .filter((script) => script.enabled && script.kind === 'transform')
      .sort((left, right) => {
        const byUpdatedAt = toTimestamp(left.updatedAt) - toTimestamp(right.updatedAt);
        if (byUpdatedAt !== 0) {
          return byUpdatedAt;
        }

        const bySlug = left.slug.localeCompare(right.slug);
        if (bySlug !== 0) {
          return bySlug;
        }

        return left.id.localeCompare(right.id);
      });

    let currentPost = transformInput.post;
    const appliedScriptIds: string[] = [];
    const errors: BlogmarkTransformError[] = [];
    const toasts: string[] = [];

    for (const script of activeTransforms) {
      try {
        const execution = await executor.runTransform(script, {
          ...transformInput,
          post: currentPost,
        });

        const executionData = toExecutionData(execution);
        const nextToasts = executionData.toasts
          .map((message) => normalizeToastMessage(message))
          .filter((message): message is string => message !== null);

        if (nextToasts.length > 0 && toasts.length < MAX_TOASTS_TOTAL) {
          const remaining = MAX_TOASTS_TOTAL - toasts.length;
          toasts.push(...nextToasts.slice(0, remaining));
        }

        const normalizedPost = normalizePost(executionData.output);
        if (!normalizedPost) {
          throw new Error('Transform output validation failed');
        }

        currentPost = normalizedPost;
        appliedScriptIds.push(script.id);
      } catch (error) {
        const message = toErrorMessage(error);
        errors.push({
          scriptId: script.id,
          scriptSlug: script.slug,
          message,
        });
        console.error(`[blogmark-transform] ${script.slug}: ${message}`);
      }
    }

    return {
      post: currentPost,
      appliedScriptIds,
      errors,
      toasts,
    };
  }

  private async resolveExecutorForConfiguredRuntime(): Promise<BlogmarkTransformExecutor> {
    const resolveMode = this.dependencies.resolvePythonRuntimeMode ?? getConfiguredPythonRuntimeMode;
    const mode = await resolveMode();
    const executors = this.dependencies.executors ?? {};

    if (mode === 'main-thread') {
      return executors['main-thread'] ?? mainThreadExecutor;
    }

    return executors.webworker ?? workerExecutor;
  }
}

let blogmarkTransformServiceInstance: BlogmarkTransformService | null = null;

export function getBlogmarkTransformService(): BlogmarkTransformService {
  if (!blogmarkTransformServiceInstance) {
    blogmarkTransformServiceInstance = new BlogmarkTransformService();
  }

  return blogmarkTransformServiceInstance;
}
