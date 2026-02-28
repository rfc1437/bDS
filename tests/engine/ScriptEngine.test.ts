import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import { ScriptEngine } from '../../src/main/engine/ScriptEngine';

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
  default: { execFile: mockExecFile },
}));

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

  describe('macro resolution', () => {
    it('getEnabledMacroScripts returns only enabled macro scripts', async () => {
      await scriptEngine.createScript({
        title: 'My Macro',
        kind: 'macro',
        content: 'def render(ctx): return {"html": "<p>hi</p>"}',
        enabled: true,
      });

      vi.mocked((await import('uuid')).v4).mockReturnValueOnce('mock-script-id-2');

      await scriptEngine.createScript({
        title: 'My Transform',
        kind: 'transform',
        content: 'def transform(post): return post',
        enabled: true,
      });

      vi.mocked((await import('uuid')).v4).mockReturnValueOnce('mock-script-id-3');

      await scriptEngine.createScript({
        title: 'Disabled Macro',
        kind: 'macro',
        content: 'def render(ctx): return {"html": ""}',
        enabled: false,
      });

      const macros = await scriptEngine.getEnabledMacroScripts();
      expect(macros).toHaveLength(1);
      expect(macros[0].kind).toBe('macro');
      expect(macros[0].enabled).toBe(true);
      expect(macros[0].title).toBe('My Macro');
    });

    it('getMacroScriptBySlug finds enabled macro by slug', async () => {
      await scriptEngine.createScript({
        title: 'Widget Macro',
        kind: 'macro',
        content: 'def render(ctx): return {"html": "<div>widget</div>"}',
        enabled: true,
      });

      const found = await scriptEngine.getMacroScriptBySlug('widget_macro');
      expect(found).not.toBeNull();
      expect(found?.slug).toBe('widget_macro');
      expect(found?.kind).toBe('macro');
    });

    it('getMacroScriptBySlug returns null for non-macro scripts', async () => {
      await scriptEngine.createScript({
        title: 'My Transform',
        kind: 'transform',
        content: 'def transform(post): return post',
        enabled: true,
      });

      const found = await scriptEngine.getMacroScriptBySlug('my_transform');
      expect(found).toBeNull();
    });

    it('getMacroScriptBySlug returns null for disabled macros', async () => {
      await scriptEngine.createScript({
        title: 'Disabled Macro',
        kind: 'macro',
        content: 'def render(ctx): return {"html": ""}',
        enabled: false,
      });

      const found = await scriptEngine.getMacroScriptBySlug('disabled_macro');
      expect(found).toBeNull();
    });

    it('getMacroScriptBySlug is case-insensitive', async () => {
      await scriptEngine.createScript({
        title: 'Case Test',
        kind: 'macro',
        content: 'def render(ctx): return {"html": ""}',
        enabled: true,
      });

      const found = await scriptEngine.getMacroScriptBySlug('CASE_TEST');
      expect(found).not.toBeNull();
      expect(found?.slug).toBe('case_test');
    });

    it('getMacroScriptBySlug returns null for non-existent slug', async () => {
      const found = await scriptEngine.getMacroScriptBySlug('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('validateScript', () => {
    it('returns valid for correct Python syntax', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string) => void) => {
        cb(null, JSON.stringify({ valid: true, errors: [] }));
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      });

      const result = await scriptEngine.validateScript('print("hello")');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('returns invalid with errors for bad Python syntax', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string) => void) => {
        cb(null, JSON.stringify({ valid: false, errors: ['invalid syntax (line 1, col 5)'] }));
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      });

      const result = await scriptEngine.validateScript('def (');
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(['invalid syntax (line 1, col 5)']);
    });

    it('returns valid when python3 is not available', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error, stdout: string) => void) => {
        cb(new Error('spawn python3 ENOENT'), '');
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      });

      const result = await scriptEngine.validateScript('print("hello")');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('returns valid when python3 output is not parseable JSON', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string) => void) => {
        cb(null, 'not json');
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      });

      const result = await scriptEngine.validateScript('print("hello")');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('passes script content via stdin', async () => {
      const writeFn = vi.fn();
      const endFn = vi.fn();
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string) => void) => {
        cb(null, JSON.stringify({ valid: true, errors: [] }));
        return { stdin: { write: writeFn, end: endFn } };
      });

      await scriptEngine.validateScript('x = 42');
      expect(writeFn).toHaveBeenCalledWith('x = 42');
      expect(endFn).toHaveBeenCalled();
    });
  });

  describe('draft lifecycle', () => {
    it('createDraftScript inserts a row with status draft and content in DB', async () => {
      const created = await scriptEngine.createDraftScript({
        title: 'Draft Macro',
        kind: 'macro',
        content: 'def render(ctx): return {"html": "<p>draft</p>"}',
      });

      expect(created.status).toBe('draft');
      expect(created.content).toBe('def render(ctx): return {"html": "<p>draft</p>"}');
      expect(created.slug).toBe('draft_macro');
      expect(mockScripts.has(created.id)).toBe(true);

      const row = mockScripts.get(created.id);
      expect(row.status).toBe('draft');
      expect(row.content).toBe('def render(ctx): return {"html": "<p>draft</p>"}');
    });

    it('createDraftScript does not write a file to disk', async () => {
      const fsModule = await import('fs/promises');
      vi.mocked(fsModule.writeFile).mockClear();

      await scriptEngine.createDraftScript({
        title: 'No File Draft',
        kind: 'utility',
        content: 'print("no file")',
      });

      expect(fsModule.writeFile).not.toHaveBeenCalled();
    });

    it('createDraftScript generates a unique slug', async () => {
      await scriptEngine.createDraftScript({
        title: 'Unique Slug',
        kind: 'macro',
        content: 'pass',
      });

      vi.mocked((await import('uuid')).v4).mockReturnValueOnce('mock-script-id-2');

      const second = await scriptEngine.createDraftScript({
        title: 'Unique Slug',
        kind: 'macro',
        content: 'pass',
      });

      expect(second.slug).toBe('unique_slug_2');
    });

    it('publishScript writes file and sets status to published', async () => {
      const draft = await scriptEngine.createDraftScript({
        title: 'Publish Me',
        kind: 'macro',
        content: 'def render(ctx): return {"html": "<p>publish</p>"}',
      });

      const published = await scriptEngine.publishScript(draft.id);

      expect(published).not.toBeNull();
      expect(published!.status).toBe('published');

      const row = mockScripts.get(draft.id);
      expect(row.status).toBe('published');
      expect(row.content).toBeNull();

      const fileContent = mockFiles.get(draft.filePath);
      expect(fileContent).toBeDefined();
      expect(fileContent).toContain('title: "Publish Me"');
      expect(fileContent).toContain('def render');
    });

    it('publishScript returns null for non-existent script', async () => {
      const result = await scriptEngine.publishScript('nonexistent-id');
      expect(result).toBeNull();
    });

    it('publishScript calls notifier with updated action', async () => {
      const mockNotifier = { notify: vi.fn().mockResolvedValue(undefined) };
      const notifiedEngine = new ScriptEngine(mockNotifier);
      notifiedEngine.setProjectContext('default', '/mock/userData/projects/default');

      const draft = await notifiedEngine.createDraftScript({
        title: 'Notified Publish',
        kind: 'macro',
        content: 'def render(ctx): pass',
      });

      await notifiedEngine.publishScript(draft.id);

      expect(mockNotifier.notify).toHaveBeenCalledWith('script', draft.id, 'updated');
    });

    it('deleteDraftScript removes a draft row from the database', async () => {
      const draft = await scriptEngine.createDraftScript({
        title: 'Delete Draft',
        kind: 'utility',
        content: 'pass',
      });

      const deleted = await scriptEngine.deleteDraftScript(draft.id);

      expect(deleted).toBe(true);
      expect(mockScripts.size).toBe(0);
    });

    it('deleteDraftScript returns false for non-existent script', async () => {
      const result = await scriptEngine.deleteDraftScript('no-such-id');
      expect(result).toBe(false);
    });

    it('deleteDraftScript returns false for published scripts', async () => {
      const created = await scriptEngine.createScript({
        title: 'Published Script',
        kind: 'macro',
        content: 'def render(ctx): pass',
      });

      const result = await scriptEngine.deleteDraftScript(created.id);
      expect(result).toBe(false);
    });

    it('deleteDraftScript calls notifier with deleted action', async () => {
      const mockNotifier = { notify: vi.fn().mockResolvedValue(undefined) };
      const notifiedEngine = new ScriptEngine(mockNotifier);
      notifiedEngine.setProjectContext('default', '/mock/userData/projects/default');

      const draft = await notifiedEngine.createDraftScript({
        title: 'Notified Delete',
        kind: 'utility',
        content: 'pass',
      });

      await notifiedEngine.deleteDraftScript(draft.id);

      expect(mockNotifier.notify).toHaveBeenCalledWith('script', draft.id, 'deleted');
    });
  });
});
