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

    expect(created.slug).toBe('render-hero');
    expect(mockScripts.has(created.id)).toBe(true);
    expect(mockFiles.get('/mock/userData/projects/default/scripts/render-hero.py')).toContain('def render');
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

    expect(updated?.slug).toBe('render-hero-banner');
    expect(mockFiles.get('/mock/userData/projects/default/scripts/render-hero-banner.py')).toContain('Banner');
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
    expect(mockFiles.has('/mock/userData/projects/default/scripts/delete-me.py')).toBe(false);
  });
});
