import { describe, expect, it } from 'vitest';
import type { ScriptData } from '../../src/main/shared/electronApi';
import {
  BlogmarkTransformService,
  type BlogmarkTransformInput,
  type BlogmarkTransformScriptProvider,
} from '../../src/main/engine/BlogmarkTransformService';

function createInput(overrides: Partial<BlogmarkTransformInput> = {}): BlogmarkTransformInput {
  return {
    post: {
      title: 'BoardGameGeek | Great Game',
      content: 'Read this: BoardGameGeek | Great Game',
      tags: ['inbox'],
      categories: ['blogmark'],
    },
    context: {
      source: 'blogmark',
      url: 'https://boardgamegeek.com/boardgame/12345',
    },
    ...overrides,
  };
}

function createTransformScript(overrides: Partial<ScriptData> = {}): ScriptData {
  return {
    id: 'bgg-link-transform',
    projectId: 'default',
    slug: 'bgg_link',
    title: 'BGG Link Transform',
    kind: 'transform',
    entrypoint: 'normalize_blogmark',
    enabled: true,
    version: 1,
    filePath: '/tmp/bgg_link.py',
    content: [
      'def normalize_blogmark(post, context=None):',
      '    title = (post.get("title") or "").strip()',
      '    if title and "BoardGameGeek" in title:',
      '        clean_title = title.split(" | ")[0]',
      '        post["title"] = clean_title',
      '        post["content"] = (post.get("content") or "").replace(title, clean_title)',
      '    post["categories"] = ["spielelog", "asides"]',
      '    tags = post.get("tags") or []',
      '    tags.append("spielen")',
      '    post["tags"] = sorted({str(tag).strip().lower() for tag in tags if str(tag).strip()})',
      '    if context and context.get("url"):',
      '        toast(f"BGG transform applied: {post.get(' + "'title'" + ')} @ {context.get(' + "'url'" + ')}")',
      '    else:',
      '        toast(f"BGG transform applied: {post.get(' + "'title'" + ')}")',
      '    return post',
      '',
    ].join('\n'),
    createdAt: '2026-02-23T00:00:00.000Z',
    updatedAt: '2026-02-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('BlogmarkTransformService (Pyodide integration)', () => {
  it('executes transform scripts with real pyodide runtime and applies post mutations', async () => {
    const provider: BlogmarkTransformScriptProvider = {
      getScripts: async () => [createTransformScript()],
    };

    const service = new BlogmarkTransformService({
      provider,
      resolvePythonRuntimeMode: async () => 'main-thread',
    });

    const result = await service.applyTransforms(createInput());

    expect(result.errors).toEqual([]);
    expect(result.appliedScriptIds).toEqual(['bgg-link-transform']);
    expect(result.post.title).toBe('BoardGameGeek');
    expect(result.post.content).toBe('Read this: BoardGameGeek');
    expect(result.post.categories).toEqual(['spielelog', 'asides']);
    expect(result.post.tags).toEqual(['inbox', 'spielen']);
    expect(result.toasts).toHaveLength(1);
    expect(result.toasts[0]).toContain('BGG transform applied: BoardGameGeek');
    expect(result.toasts[0]).toContain('boardgamegeek.com/boardgame/12345');
  }, 60000);
});
