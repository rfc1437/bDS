import type { PanelOutputEntry, PostData } from '../store';

export interface BlogmarkTransformDebugError {
  scriptId: string;
  scriptSlug: string;
  message: string;
}

export interface BlogmarkTransformDebugInfo {
  appliedScriptIds: string[];
  errors: BlogmarkTransformDebugError[];
  toasts: string[];
}

export interface BlogmarkTransformToastNotification {
  kind: 'success' | 'error';
  message: string;
}

export interface BlogmarkCreatedEventPayload {
  post: PostData;
  transform?: BlogmarkTransformDebugInfo;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTransformDebugInfo(value: unknown): BlogmarkTransformDebugInfo | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const appliedScriptIds = Array.isArray(value.appliedScriptIds)
    ? value.appliedScriptIds.filter((item): item is string => typeof item === 'string')
    : [];

  const errors = Array.isArray(value.errors)
    ? value.errors
      .map((entry) => {
        if (!isRecord(entry)) {
          return null;
        }

        const scriptId = typeof entry.scriptId === 'string' ? entry.scriptId : '';
        const scriptSlug = typeof entry.scriptSlug === 'string' ? entry.scriptSlug : '';
        const message = typeof entry.message === 'string' ? entry.message : '';

        if (!scriptId || !scriptSlug || !message) {
          return null;
        }

        return {
          scriptId,
          scriptSlug,
          message,
        };
      })
      .filter((item): item is BlogmarkTransformDebugError => item !== null)
    : [];

  const toasts = Array.isArray(value.toasts)
    ? value.toasts
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0)
    : [];

  if (appliedScriptIds.length === 0 && errors.length === 0 && toasts.length === 0) {
    return undefined;
  }

  return {
    appliedScriptIds,
    errors,
    toasts,
  };
}

export function parseBlogmarkCreatedEventPayload(payload: unknown): BlogmarkCreatedEventPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (isRecord(payload.post)) {
    return {
      post: payload.post as unknown as PostData,
      transform: parseTransformDebugInfo(payload.transform),
    };
  }

  return {
    post: payload as unknown as PostData,
    transform: undefined,
  };
}

export function buildBlogmarkTransformOutputEntries(
  transform: BlogmarkTransformDebugInfo | undefined,
  t: (key: string, values?: Record<string, string | number>) => string,
): Array<Omit<PanelOutputEntry, 'id' | 'createdAt'>> {
  if (!transform) {
    return [];
  }

  const entries: Array<Omit<PanelOutputEntry, 'id' | 'createdAt'>> = [];
  entries.push({
    kind: 'result',
    message: t('app.blogmark.transforms.summary', {
      applied: transform.appliedScriptIds.length,
      failed: transform.errors.length,
    }),
  });

  if (transform.appliedScriptIds.length > 0) {
    entries.push({
      kind: 'result',
      message: t('app.blogmark.transforms.appliedList', {
        scripts: transform.appliedScriptIds.join(', '),
      }),
    });
  }

  for (const toastMessage of transform.toasts) {
    entries.push({
      kind: 'result',
      message: t('app.blogmark.transforms.toast', {
        message: toastMessage,
      }),
    });
  }

  for (const error of transform.errors) {
    entries.push({
      kind: 'error',
      message: t('app.blogmark.transforms.failed', {
        script: error.scriptSlug,
        message: error.message,
      }),
    });
  }

  return entries;
}

export function shouldAutoOpenPanelForOutputEntries(
  entries: Array<Omit<PanelOutputEntry, 'id' | 'createdAt'>>,
): boolean {
  return entries.some((entry) => entry.kind === 'error' || entry.kind === 'stdout');
}

export function buildBlogmarkTransformToastNotifications(
  transform: BlogmarkTransformDebugInfo | undefined,
  t: (key: string, values?: Record<string, string | number>) => string,
): BlogmarkTransformToastNotification[] {
  if (!transform) {
    return [];
  }

  const notifications: BlogmarkTransformToastNotification[] = transform.toasts.map((message) => ({
    kind: 'success',
    message,
  }));

  if (transform.errors.length > 0) {
    notifications.push({
      kind: 'error',
      message: t('app.blogmark.transforms.errorToast', {
        count: transform.errors.length,
      }),
    });
  }

  return notifications;
}
