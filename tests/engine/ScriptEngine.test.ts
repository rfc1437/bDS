import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import { ScriptEngine } from '../../src/main/engine/ScriptEngine';

const mockScripts = new Map<string, any>();
const mockFiles = new Map<string, string>();

function createSelectChain() {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => Promise.resolve(Array.from(mockScripts.values()))),
    get: vi.fn().mockImplementation(() => Promise.resolve(undefined)),
  };
}

function createDrizzleMock() {
  return {
    select: vi.fn(() => createSelectChain()),
    insert: vi.fn(() => ({
      values: vi.fn((data: any) => {
        mockScripts.set(data.id, data);
        return Promise.resolve();
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((updates: any) => ({
        where: vi.fn(async () => {
          for (const [scriptId, existing] of mockScripts.entries()) {
            mockScripts.set(scriptId, { ...existing, ...updates });
          }
        }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => {
        mockScripts.clear();
        return Promise.resolve();
      }),
    })),
  };
}

const mockLocalDb = createDrizzleMock();

vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => mockLocalDb),
  })),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-script-id'),
}));

vi.mock('fs/promises', () => ({
  readdir: vi.fn(async (dirPath: string, options?: { withFileTypes?: boolean }) => {
    if (options?.withFileTypes) {
      const files = Array.from((globalThis as any).__mockScriptFiles.keys()) as string[];
      const names = files
        .filter((filePath) => filePath.startsWith(`${dirPath}/`))
        .map((filePath) => filePath.slice(dirPath.length + 1))
        .filter((name) => !name.includes('/'));

      return names.map((name) => ({
        name,
        isDirectory: () => false,
        isFile: () => true,
      }));
    }

    return [];
  }),
  readFile: vi.fn(async (filePath: string) => {
    const value = (globalThis as any).__mockScriptFiles.get(filePath);
    if (typeof value !== 'string') {
      const error = new Error('ENOENT');
      (error as any).code = 'ENOENT';
      throw error;
    }
    return value;
  }),
  writeFile: vi.fn(async (filePath: string, content: string) => {
    (globalThis as any).__mockScriptFiles.set(filePath, content);
  }),
  unlink: vi.fn(async (filePath: string) => {
    (globalThis as any).__mockScriptFiles.delete(filePath);
  }),
  rename: vi.fn(async (fromPath: string, toPath: string) => {
    const files = (globalThis as any).__mockScriptFiles;
    const content = files.get(fromPath);
    files.delete(fromPath);
    files.set(toPath, content);
  }),
  mkdir: vi.fn(async () => {}),
}));

describe('ScriptEngine', () => {
  let scriptEngine: ScriptEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockScripts.clear();
    mockFiles.clear();
    (globalThis as any).__mockScriptFiles = mockFiles;
    vi.mocked(mockLocalDb.select).mockImplementation(() => createSelectChain());

    scriptEngine = new ScriptEngine();
    scriptEngine.setProjectContext('default', '/mock/userData/projects/default');
  });

  it('creates script metadata and source file', async () => {
    const created = await scriptEngine.createScript({
      title: 'Render Hero',
      kind: 'macro',
      content: 'def render(context):\n    return {"html": "<h1>Hi</h1>"}',
    });

    expect(created.slug).toBe('render_hero');
    expect(mockScripts.has(created.id)).toBe(true);
    const persistedFile = mockFiles.get('/mock/userData/projects/default/scripts/render_hero.py') || '';
    expect(persistedFile).toContain('---');
    expect(persistedFile).toContain('title: "Render Hero"');
    expect(persistedFile).toContain('kind: "macro"');
    expect(persistedFile).toContain('entrypoint: "render"');
    expect(persistedFile).toContain('def render');
    expect(created.content).toBe('def render(context):\n    return {"html": "<h1>Hi</h1>"}');
  });

  it('updates script metadata and file content', async () => {
    const created = await scriptEngine.createScript({
      title: 'Render Hero',
      kind: 'macro',
      content: 'def render(context):\n    return {"html": "<h1>Hi</h1>"}',
    });

    const updated = await scriptEngine.updateScript(created.id, {
      title: 'Render Hero Banner',
      content: 'def render(context):\n    return {"html": "<h1>Banner</h1>"}',
    });

    expect(updated?.slug).toBe('render_hero_banner');
    expect(mockFiles.get('/mock/userData/projects/default/scripts/render_hero_banner.py')).toContain('Banner');
  });

  it('appends underscore numeric suffix for duplicate slugs', async () => {
    const first = await scriptEngine.createScript({
      title: 'Render Hero',
      kind: 'macro',
      content: 'def render(context):\n    return {"html": "<h1>Hi</h1>"}',
    });

    vi.mocked((await import('uuid')).v4)
      .mockReturnValueOnce('mock-script-id-2');

    const second = await scriptEngine.createScript({
      title: 'Render Hero',
      kind: 'macro',
      content: 'def render(context):\n    return {"html": "<h1>Again</h1>"}',
    });

    expect(first.slug).toBe('render_hero');
    expect(second.slug).toBe('render_hero_2');
    expect(mockFiles.get('/mock/userData/projects/default/scripts/render_hero_2.py')).toContain('Again');
  });

  it('deletes script metadata and source file', async () => {
    const created = await scriptEngine.createScript({
      title: 'Delete Me',
      kind: 'utility',
      content: 'print("bye")',
    });

    const deleted = await scriptEngine.deleteScript(created.id);

    expect(deleted).toBe(true);
    expect(mockScripts.has(created.id)).toBe(false);
    expect(mockFiles.has('/mock/userData/projects/default/scripts/delete_me.py')).toBe(false);
  });

  it('keeps script content clean when file contains metadata docstring frontmatter', async () => {
    const created = await scriptEngine.createScript({
      title: 'Metadata Test',
      kind: 'utility',
      content: 'print("hello")',
    });

    const loaded = await scriptEngine.getScript(created.id);

    expect(loaded?.content).toBe('print("hello")');
    expect(loaded?.title).toBe('Metadata Test');
    expect(loaded?.entrypoint).toBe('render');
  });

  it('rebuilds scripts from filesystem and applies external file metadata/content', async () => {
    const scriptPath = '/mock/userData/projects/default/scripts/external_transform.py';
    mockFiles.set(scriptPath, [
      '"""',
      '---',
      'id: "external-script-id"',
      'projectId: "default"',
      'slug: "external_transform"',
      'title: "External Transform"',
      'kind: "transform"',
      'entrypoint: "transform"',
      'enabled: false',
      'version: 3',
      'createdAt: "2026-02-20T10:00:00.000Z"',
      'updatedAt: "2026-02-21T11:00:00.000Z"',
      '---',
      '"""',
      'def transform(context):',
      '    return context',
    ].join('\n'));

    await scriptEngine.rebuildDatabaseFromFiles();

    const all = await scriptEngine.getAllScripts();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('external-script-id');
    expect(all[0].slug).toBe('external_transform');
    expect(all[0].kind).toBe('transform');
    expect(all[0].entrypoint).toBe('transform');
    expect(all[0].enabled).toBe(false);
    expect(all[0].version).toBe(3);
    expect(all[0].title).toBe('External Transform');
    expect(all[0].content).toContain('def transform(context):');
  });

  it('reconciles git changes for scripts (modify/add/delete)', async () => {
    const created = await scriptEngine.createScript({
      title: 'Render Hero',
      kind: 'macro',
      content: 'def render(context):\n    return {"html": "<h1>Hi</h1>"}',
    });

    const existingPath = '/repo/scripts/render_hero.py';
    mockFiles.set(existingPath, [
      '"""',
      '---',
      `id: "${created.id}"`,
      'projectId: "default"',
      'slug: "render_hero"',
      'title: "Render Hero Updated Outside"',
      'kind: "macro"',
      'entrypoint: "render"',
      'enabled: true',
      'version: 8',
      'createdAt: "2026-02-20T10:00:00.000Z"',
      'updatedAt: "2026-02-21T11:00:00.000Z"',
      '---',
      '"""',
      'def render(context):',
      '    return {"html": "<h1>Outside</h1>"}',
    ].join('\n'));

    const addedPath = '/repo/scripts/new_transform.py';
    mockFiles.set(addedPath, [
      '"""',
      '---',
      'id: "added-script-id"',
      'projectId: "default"',
      'slug: "new_transform"',
      'title: "New Transform"',
      'kind: "transform"',
      'entrypoint: "transform"',
      'enabled: true',
      'version: 1',
      'createdAt: "2026-02-22T10:00:00.000Z"',
      'updatedAt: "2026-02-22T11:00:00.000Z"',
      '---',
      '"""',
      'def transform(context):',
      '    return context',
    ].join('\n'));

    const result = await scriptEngine.reconcileScriptsFromGitChanges('/repo', [
      { status: 'modified', path: 'scripts/render_hero.py' },
      { status: 'added', path: 'scripts/new_transform.py' },
      { status: 'deleted', path: 'scripts/render_hero.py' },
    ]);

    expect(result.updated).toBe(1);
    expect(result.created).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.processedFiles).toBe(3);
  });
});
