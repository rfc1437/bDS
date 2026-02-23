import { describe, expect, it, vi } from 'vitest';
import type { ScriptData } from '../../src/main/shared/electronApi';
import {
  BlogmarkTransformService,
  type BlogmarkTransformExecutor,
  type BlogmarkTransformInput,
  type BlogmarkTransformScriptProvider,
} from '../../src/main/engine/BlogmarkTransformService';

function createScript(overrides: Partial<ScriptData>): ScriptData {
  const baseDate = '2026-02-23T00:00:00.000Z';
  return {
    id: 'script-default',
    projectId: 'default',
    slug: 'script_default',
    title: 'Default Script',
    kind: 'transform',
    entrypoint: 'transform',
    enabled: true,
    version: 1,
    filePath: '/tmp/default.py',
    content: 'def transform(payload):\n    return payload',
    createdAt: baseDate,
    updatedAt: baseDate,
    ...overrides,
  };
}

function createInput(overrides: Partial<BlogmarkTransformInput> = {}): BlogmarkTransformInput {
  return {
    post: {
      title: 'Hello',
      content: '[Hello](https://example.com)',
      tags: ['inbox'],
      categories: ['blogmark'],
    },
    context: {
      source: 'blogmark',
      url: 'https://example.com',
    },
    ...overrides,
  };
}

describe('BlogmarkTransformService', () => {
  it('applies enabled transform scripts sequentially in deterministic order', async () => {
    const scripts: ScriptData[] = [
      createScript({ id: 'b', slug: 'b', updatedAt: '2026-02-23T00:00:01.000Z' }),
      createScript({ id: 'a', slug: 'a', updatedAt: '2026-02-23T00:00:01.000Z' }),
      createScript({ id: 'c', slug: 'c', updatedAt: '2026-02-23T00:00:00.000Z' }),
    ];

    const executionOrder: string[] = [];
    const executor: BlogmarkTransformExecutor = {
      runTransform: vi.fn(async (script, input) => {
        executionOrder.push(script.id);
        return {
          post: {
            ...input.post,
            title: `${input.post.title}:${script.id}`,
          },
        };
      }),
    };

    const provider: BlogmarkTransformScriptProvider = {
      getScripts: vi.fn(async () => scripts),
    };

    const service = new BlogmarkTransformService({ executor, provider });

    const result = await service.applyTransforms(createInput());

    expect(executionOrder).toEqual(['c', 'a', 'b']);
    expect(result.post.title).toBe('Hello:c:a:b');
    expect(result.appliedScriptIds).toEqual(['c', 'a', 'b']);
    expect(result.errors).toEqual([]);
    expect(result.toasts).toEqual([]);
  });

  it('skips disabled and non-transform scripts', async () => {
    const scripts: ScriptData[] = [
      createScript({ id: 'transform-enabled', kind: 'transform', enabled: true }),
      createScript({ id: 'transform-disabled', kind: 'transform', enabled: false }),
      createScript({ id: 'macro-enabled', kind: 'macro', enabled: true }),
      createScript({ id: 'utility-enabled', kind: 'utility', enabled: true }),
    ];

    const executor: BlogmarkTransformExecutor = {
      runTransform: vi.fn(async (script, input) => ({
        post: {
          ...input.post,
          title: `${input.post.title}:${script.id}`,
        },
      })),
    };

    const service = new BlogmarkTransformService({
      executor,
      provider: { getScripts: async () => scripts },
    });

    const result = await service.applyTransforms(createInput());

    expect(result.post.title).toBe('Hello:transform-enabled');
    expect(result.appliedScriptIds).toEqual(['transform-enabled']);
    expect(result.errors).toEqual([]);
    expect(result.toasts).toEqual([]);
  });

  it('continues with next scripts when one transform fails', async () => {
    const scripts: ScriptData[] = [
      createScript({ id: 'first', slug: 'first' }),
      createScript({ id: 'broken', slug: 'broken' }),
      createScript({ id: 'last', slug: 'last' }),
    ];

    const executor: BlogmarkTransformExecutor = {
      runTransform: vi.fn(async (script, input) => {
        if (script.id === 'broken') {
          throw new Error('boom');
        }

        return {
          post: {
            ...input.post,
            title: `${input.post.title}:${script.id}`,
          },
        };
      }),
    };

    const service = new BlogmarkTransformService({
      executor,
      provider: { getScripts: async () => scripts },
    });

    const result = await service.applyTransforms(createInput());

    expect(result.post.title).toBe('Hello:first:last');
    expect(result.appliedScriptIds).toEqual(['first', 'last']);
    expect(result.errors).toEqual([
      {
        scriptId: 'broken',
        scriptSlug: 'broken',
        message: 'boom',
      },
    ]);
    expect(result.toasts).toEqual([]);
  });

  it('rejects invalid transform result and keeps latest valid post', async () => {
    const scripts: ScriptData[] = [
      createScript({ id: 'valid-1', slug: 'valid-1' }),
      createScript({ id: 'invalid', slug: 'invalid' }),
      createScript({ id: 'valid-2', slug: 'valid-2' }),
    ];

    const executor: BlogmarkTransformExecutor = {
      runTransform: vi.fn(async (script, input) => {
        if (script.id === 'invalid') {
          return {
            post: {
              title: '',
              content: '',
              tags: [],
              categories: [],
            },
          };
        }

        return {
          title: `${input.post.title}:${script.id}`,
          content: input.post.content,
          tags: input.post.tags,
          categories: input.post.categories,
        };
      }),
    };

    const service = new BlogmarkTransformService({
      executor,
      provider: { getScripts: async () => scripts },
    });

    const result = await service.applyTransforms(createInput());

    expect(result.post.title).toBe('Hello:valid-1:valid-2');
    expect(result.appliedScriptIds).toEqual(['valid-1', 'valid-2']);
    expect(result.errors).toEqual([
      {
        scriptId: 'invalid',
        scriptSlug: 'invalid',
        message: 'Transform output validation failed',
      },
    ]);
    expect(result.toasts).toEqual([]);
  });

  it('allows transforms to set multiple categories and add tags', async () => {
    const scripts: ScriptData[] = [
      createScript({ id: 'taxonomy', slug: 'taxonomy' }),
    ];

    const executor: BlogmarkTransformExecutor = {
      runTransform: vi.fn(async (_script, input) => ({
        output: {
          ...input.post,
          tags: [...input.post.tags, 'reading-list', 'python'],
          categories: ['link', 'reference'],
        },
        toasts: [],
      })),
    };

    const service = new BlogmarkTransformService({
      executor,
      provider: { getScripts: async () => scripts },
    });

    const result = await service.applyTransforms(createInput());

    expect(result.post.tags).toEqual(['inbox', 'reading-list', 'python']);
    expect(result.post.categories).toEqual(['link', 'reference']);
  });

  it('collects toast intents emitted by transform scripts', async () => {
    const scripts: ScriptData[] = [
      createScript({ id: 'alpha', slug: 'alpha' }),
      createScript({ id: 'beta', slug: 'beta' }),
    ];

    const executor: BlogmarkTransformExecutor = {
      runTransform: vi.fn(async (_script, input) => ({
        post: input.post,
        toasts: ['Step finished'],
      })),
    };

    const service = new BlogmarkTransformService({
      executor,
      provider: { getScripts: async () => scripts },
    });

    const result = await service.applyTransforms(createInput());

    expect(result.toasts).toEqual(['Step finished', 'Step finished']);
  });

  it('uses webworker executor when runtime mode resolves to webworker', async () => {
    const webworkerExecutor: BlogmarkTransformExecutor = {
      runTransform: vi.fn(async (_script, input) => ({ output: input.post, toasts: [] })),
    };
    const mainThreadExecutor: BlogmarkTransformExecutor = {
      runTransform: vi.fn(async (_script, input) => ({ output: input.post, toasts: [] })),
    };

    const service = new BlogmarkTransformService({
      provider: {
        getScripts: async () => [createScript({ id: 'worker-script', slug: 'worker-script' })],
      },
      resolvePythonRuntimeMode: async () => 'webworker',
      executors: {
        webworker: webworkerExecutor,
        'main-thread': mainThreadExecutor,
      },
    });

    await service.applyTransforms(createInput());

    expect(webworkerExecutor.runTransform).toHaveBeenCalledTimes(1);
    expect(mainThreadExecutor.runTransform).not.toHaveBeenCalled();
  });

  it('uses main-thread executor when runtime mode resolves to main-thread', async () => {
    const webworkerExecutor: BlogmarkTransformExecutor = {
      runTransform: vi.fn(async (_script, input) => ({ output: input.post, toasts: [] })),
    };
    const mainThreadExecutor: BlogmarkTransformExecutor = {
      runTransform: vi.fn(async (_script, input) => ({ output: input.post, toasts: [] })),
    };

    const service = new BlogmarkTransformService({
      provider: {
        getScripts: async () => [createScript({ id: 'main-script', slug: 'main-script' })],
      },
      resolvePythonRuntimeMode: async () => 'main-thread',
      executors: {
        webworker: webworkerExecutor,
        'main-thread': mainThreadExecutor,
      },
    });

    await service.applyTransforms(createInput());

    expect(mainThreadExecutor.runTransform).toHaveBeenCalledTimes(1);
    expect(webworkerExecutor.runTransform).not.toHaveBeenCalled();
  });
});
