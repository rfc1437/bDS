import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  wirePythonMacroPreview,
  invalidatePythonMacroScriptCache,
} from '../../../src/renderer/macros/pythonMacroPreview';
import {
  clearMacros,
  setPythonMacroResolver,
  renderMacro,
} from '../../../src/renderer/macros/registry';
import type { ParsedMacro, MacroRenderContext } from '../../../src/renderer/macros/types';

// Mock PythonRuntimeManager
const mockRenderMacroV1 = vi.fn().mockResolvedValue({
  result: { html: '<div>Python Preview Output</div>' },
  stdout: '',
});

vi.mock('../../../src/renderer/python/runtimeManagerInstance', () => ({
  getPythonRuntimeManager: () => ({
    renderMacroV1: mockRenderMacroV1,
  }),
}));

describe('pythonMacroPreview', () => {
  const context: MacroRenderContext = { isPreview: true };

  beforeEach(() => {
    clearMacros();
    setPythonMacroResolver(null, null);
    invalidatePythonMacroScriptCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should resolve a Python macro from scripts.getAll and render via PythonRuntimeManager', async () => {
    vi.stubGlobal('window', {
      electronAPI: {
        scripts: {
          getAll: vi.fn().mockResolvedValue([
            {
              id: 'script-1',
              slug: 'data_table',
              kind: 'macro',
              enabled: true,
              content: 'def render(ctx, post): return {"html": "<table/>"}',
              entrypoint: 'render',
              version: 3,
            },
            {
              id: 'script-2',
              slug: 'utility_script',
              kind: 'utility',
              enabled: true,
              content: '',
              entrypoint: 'run',
              version: 1,
            },
          ]),
        },
      },
    });

    wirePythonMacroPreview();

    const macro: ParsedMacro = {
      name: 'data_table',
      params: { source: 'posts' },
      rawText: '[[data_table source="posts"]]',
      start: 0,
      end: 29,
    };

    const result = await renderMacro(macro, context);

    expect(result).toBe('<div>Python Preview Output</div>');
    expect(mockRenderMacroV1).toHaveBeenCalledWith(
      'def render(ctx, post): return {"html": "<table/>"}',
      expect.objectContaining({
        env: expect.objectContaining({
          isPreview: true,
          source: { kind: 'script', id: 'script-1' },
        }),
        params: { source: 'posts' },
      }),
      expect.objectContaining({
        entrypoint: 'render',
        cacheKey: 'script-1:v3',
      }),
    );
  });

  it('should return unknown macro error when no script matches', async () => {
    vi.stubGlobal('window', {
      electronAPI: {
        scripts: {
          getAll: vi.fn().mockResolvedValue([]),
        },
      },
    });

    wirePythonMacroPreview();

    const macro: ParsedMacro = {
      name: 'nonexistent',
      params: {},
      rawText: '[[nonexistent]]',
      start: 0,
      end: 15,
    };

    const result = await renderMacro(macro, context);
    expect(result).toContain('macro-error');
    expect(result).toContain('Unknown macro');
  });

  it('should skip disabled scripts', async () => {
    vi.stubGlobal('window', {
      electronAPI: {
        scripts: {
          getAll: vi.fn().mockResolvedValue([
            {
              id: 'script-1',
              slug: 'widget',
              kind: 'macro',
              enabled: false,
              content: 'def render(ctx, post): return {"html": ""}',
              entrypoint: 'render',
              version: 1,
            },
          ]),
        },
      },
    });

    wirePythonMacroPreview();

    const macro: ParsedMacro = {
      name: 'widget',
      params: {},
      rawText: '[[widget]]',
      start: 0,
      end: 10,
    };

    const result = await renderMacro(macro, context);
    expect(result).toContain('macro-error');
    expect(result).toContain('Unknown macro');
  });

  it('should cache scripts and not refetch on second resolve', async () => {
    const mockGetAll = vi.fn().mockResolvedValue([
      {
        id: 's1',
        slug: 'chart',
        kind: 'macro',
        enabled: true,
        content: 'code',
        entrypoint: 'render',
        version: 1,
      },
    ]);

    vi.stubGlobal('window', {
      electronAPI: { scripts: { getAll: mockGetAll } },
    });

    wirePythonMacroPreview();

    const macro: ParsedMacro = {
      name: 'chart',
      params: {},
      rawText: '[[chart]]',
      start: 0,
      end: 9,
    };

    await renderMacro(macro, context);
    await renderMacro(macro, context);

    expect(mockGetAll).toHaveBeenCalledTimes(1);
  });

  it('should refetch after invalidatePythonMacroScriptCache', async () => {
    const mockGetAll = vi.fn().mockResolvedValue([
      {
        id: 's1',
        slug: 'chart',
        kind: 'macro',
        enabled: true,
        content: 'code',
        entrypoint: 'render',
        version: 1,
      },
    ]);

    vi.stubGlobal('window', {
      electronAPI: { scripts: { getAll: mockGetAll } },
    });

    wirePythonMacroPreview();

    const macro: ParsedMacro = {
      name: 'chart',
      params: {},
      rawText: '[[chart]]',
      start: 0,
      end: 9,
    };

    await renderMacro(macro, context);
    invalidatePythonMacroScriptCache();
    await renderMacro(macro, context);

    expect(mockGetAll).toHaveBeenCalledTimes(2);
  });

  it('should match slugs case-insensitively', async () => {
    vi.stubGlobal('window', {
      electronAPI: {
        scripts: {
          getAll: vi.fn().mockResolvedValue([
            {
              id: 's1',
              slug: 'MyWidget',
              kind: 'macro',
              enabled: true,
              content: 'code',
              entrypoint: 'render',
              version: 1,
            },
          ]),
        },
      },
    });

    wirePythonMacroPreview();

    const macro: ParsedMacro = {
      name: 'mywidget',
      params: {},
      rawText: '[[mywidget]]',
      start: 0,
      end: 12,
    };

    const result = await renderMacro(macro, context);
    expect(result).toBe('<div>Python Preview Output</div>');
  });
});
