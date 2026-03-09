import { describe, it, expect, vi } from 'vitest';
import {
  renderMacro,
  replaceAllMacrosAsync,
  isBuiltInMacro,
  normalizeMacroName,
  type PythonMacroRendererContract,
  type PythonMacroScript,
} from '../../src/main/engine/PageRenderer';

describe('isBuiltInMacro', () => {
  it('returns true for all known JS built-in macro names', () => {
    expect(isBuiltInMacro('youtube')).toBe(true);
    expect(isBuiltInMacro('vimeo')).toBe(true);
    expect(isBuiltInMacro('gallery')).toBe(true);
    expect(isBuiltInMacro('photo_archive')).toBe(true);
    expect(isBuiltInMacro('tag_cloud')).toBe(true);
    expect(isBuiltInMacro('photo_album')).toBe(true);
  });

  it('returns false for unknown macro names', () => {
    expect(isBuiltInMacro('my_custom_macro')).toBe(false);
    expect(isBuiltInMacro('python_report')).toBe(false);
    expect(isBuiltInMacro('data_table')).toBe(false);
  });
});

describe('replaceAllMacrosAsync', () => {
  it('replaces built-in JS macros without Python renderer', async () => {
    const result = await replaceAllMacrosAsync(
      'Before [[youtube id="abc123"]] After',
      'post-1',
      [],
      null,
      [],
      'en',
      null,
    );

    expect(result).toContain('class="macro-youtube"');
    expect(result).toContain('abc123');
    expect(result).not.toContain('[[youtube');
  });

  it('replaces Python macros when renderer is provided', async () => {
    const mockRenderer: PythonMacroRendererContract = {
      getEnabledMacroScripts: vi.fn().mockResolvedValue([
        {
          id: 'script-1',
          slug: 'my_widget',
          entrypoint: 'render',
          content: 'def render(ctx): return {"html": "<div>Widget</div>"}',
          version: 1,
        },
      ] satisfies PythonMacroScript[]),
      renderMacro: vi.fn().mockResolvedValue({
        html: '<div class="python-widget">Hello from Python</div>',
      }),
    };

    const result = await replaceAllMacrosAsync(
      'Before [[my_widget title="Hello"]] After',
      'post-1',
      [],
      null,
      [],
      'en',
      mockRenderer,
    );

    expect(result).toBe('Before <div class="python-widget">Hello from Python</div> After');
    expect(mockRenderer.renderMacro).toHaveBeenCalledWith(
      expect.objectContaining({
        scriptContent: 'def render(ctx): return {"html": "<div>Widget</div>"}',
        entrypoint: 'render',
        cacheKey: 'script-1:1',
      }),
    );
  });

  it('preserves JS macros alongside Python macros', async () => {
    const mockRenderer: PythonMacroRendererContract = {
      getEnabledMacroScripts: vi.fn().mockResolvedValue([
        {
          id: 'script-2',
          slug: 'custom_box',
          entrypoint: 'render',
          content: 'def render(ctx): return {"html": "<aside>box</aside>"}',
          version: 3,
        },
      ] satisfies PythonMacroScript[]),
      renderMacro: vi.fn().mockResolvedValue({
        html: '<aside class="custom-box">Custom Content</aside>',
      }),
    };

    const result = await replaceAllMacrosAsync(
      '[[youtube id="xyz789"]] then [[custom_box]]',
      'post-1',
      [],
      null,
      [],
      'en',
      mockRenderer,
    );

    expect(result).toContain('class="macro-youtube"');
    expect(result).toContain('xyz789');
    expect(result).toContain('<aside class="custom-box">Custom Content</aside>');
  });

  it('preserves unknown macros without Python renderer', async () => {
    const result = await replaceAllMacrosAsync(
      'Before [[unknown_macro]] After',
      'post-1',
      [],
      null,
      [],
      'en',
      null,
    );

    expect(result).toBe('Before [[unknown_macro]] After');
  });

  it('preserves unmatched Python macros', async () => {
    const mockRenderer: PythonMacroRendererContract = {
      getEnabledMacroScripts: vi.fn().mockResolvedValue([]),
      renderMacro: vi.fn(),
    };

    const result = await replaceAllMacrosAsync(
      'Before [[nonexistent_macro]] After',
      'post-1',
      [],
      null,
      [],
      'en',
      mockRenderer,
    );

    expect(result).toBe('Before [[nonexistent_macro]] After');
    expect(mockRenderer.renderMacro).not.toHaveBeenCalled();
  });

  it('handles Python macro rendering errors gracefully', async () => {
    const mockRenderer: PythonMacroRendererContract = {
      getEnabledMacroScripts: vi.fn().mockResolvedValue([
        {
          id: 'script-err',
          slug: 'broken_macro',
          entrypoint: 'render',
          content: 'def render(ctx): raise Exception("oops")',
          version: 1,
        },
      ] satisfies PythonMacroScript[]),
      renderMacro: vi.fn().mockRejectedValue(new Error('Python execution failed')),
    };

    const result = await replaceAllMacrosAsync(
      'Before [[broken_macro]] After',
      'post-1',
      [],
      null,
      [],
      'en',
      mockRenderer,
    );

    expect(result).toBe('Before  After');
  });

  it('handles script resolution errors gracefully', async () => {
    const mockRenderer: PythonMacroRendererContract = {
      getEnabledMacroScripts: vi.fn().mockRejectedValue(new Error('DB error')),
      renderMacro: vi.fn(),
    };

    const result = await replaceAllMacrosAsync(
      'Before [[my_macro]] After',
      'post-1',
      [],
      null,
      [],
      'en',
      mockRenderer,
    );

    expect(result).toBe('Before [[my_macro]] After');
  });

  it('preserves the original unknown macro tag including params', async () => {
    const result = await replaceAllMacrosAsync(
      'Before [[unknown_macro title="Hello" count="2"]] After',
      'post-1',
      [],
      null,
      [],
      'en',
      null,
    );

    expect(result).toBe('Before [[unknown_macro title="Hello" count="2"]] After');
  });

  it('does not look up Python scripts when all macros are built-in', async () => {
    const mockRenderer: PythonMacroRendererContract = {
      getEnabledMacroScripts: vi.fn().mockResolvedValue([]),
      renderMacro: vi.fn(),
    };

    await replaceAllMacrosAsync(
      '[[youtube id="a"]] [[vimeo id="1"]]',
      'post-1',
      [],
      null,
      [],
      'en',
      mockRenderer,
    );

    expect(mockRenderer.getEnabledMacroScripts).not.toHaveBeenCalled();
  });

  it('passes correct context to Python macro renderer', async () => {
    const mockRenderer: PythonMacroRendererContract = {
      getEnabledMacroScripts: vi.fn().mockResolvedValue([
        {
          id: 'ctx-script',
          slug: 'ctx_test',
          entrypoint: 'run',
          content: 'def run(ctx): return {"html": "ok"}',
          version: 2,
        },
      ] satisfies PythonMacroScript[]),
      renderMacro: vi.fn().mockResolvedValue({ html: 'ok' }),
    };

    await replaceAllMacrosAsync(
      '[[ctx_test name="Alice" count="5"]]',
      'post-42',
      [],
      null,
      [],
      'de',
      mockRenderer,
    );

    const call = (mockRenderer.renderMacro as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const parsedContext = JSON.parse(call.contextJson);

    expect(parsedContext.env.isPreview).toBe(false);
    expect(parsedContext.env.mainLanguage).toBe('de');
    expect(parsedContext.env.hook).toBe('ctx_test');
    expect(parsedContext.env.source).toEqual({ kind: 'macro', id: 'ctx-script' });
    expect(parsedContext.params).toEqual({ name: 'Alice', count: '5' });
    expect(call.entrypoint).toBe('run');
    expect(call.cacheKey).toBe('ctx-script:2');
  });

  it('passes languagePrefix and translations in Python macro context', async () => {
    const mockRenderer: PythonMacroRendererContract = {
      getEnabledMacroScripts: vi.fn().mockResolvedValue([
        {
          id: 'lang-script',
          slug: 'lang_test',
          entrypoint: 'render',
          content: 'def render(ctx, post): return {"html": "ok"}',
          version: 1,
        },
      ] satisfies PythonMacroScript[]),
      renderMacro: vi.fn().mockResolvedValue({ html: 'ok' }),
    };

    await replaceAllMacrosAsync(
      '[[lang_test]]',
      'post-1',
      [],
      null,
      [],
      'fr',
      mockRenderer,
      null,
      '/fr',
    );

    const call = (mockRenderer.renderMacro as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const parsedContext = JSON.parse(call.contextJson);

    expect(parsedContext.env.languagePrefix).toBe('/fr');
    expect(parsedContext.env.mainLanguage).toBe('fr');
    expect(parsedContext.env.translations).toBeDefined();
    expect(typeof parsedContext.env.translations).toBe('object');
    expect(parsedContext.env.translations['render.archive']).toBe('Archives');
  });

  it('passes empty languagePrefix when not provided', async () => {
    const mockRenderer: PythonMacroRendererContract = {
      getEnabledMacroScripts: vi.fn().mockResolvedValue([
        {
          id: 'no-prefix-script',
          slug: 'no_prefix',
          entrypoint: 'render',
          content: 'def render(ctx, post): return {"html": "ok"}',
          version: 1,
        },
      ] satisfies PythonMacroScript[]),
      renderMacro: vi.fn().mockResolvedValue({ html: 'ok' }),
    };

    await replaceAllMacrosAsync(
      '[[no_prefix]]',
      'post-1',
      [],
      null,
      [],
      'en',
      mockRenderer,
    );

    const call = (mockRenderer.renderMacro as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const parsedContext = JSON.parse(call.contextJson);

    expect(parsedContext.env.languagePrefix).toBe('');
    expect(parsedContext.env.translations).toBeDefined();
  });

  it('returns unchanged text when there are no macros', async () => {
    const content = 'Just plain text with no macros';
    const result = await replaceAllMacrosAsync(content, '', [], null, [], 'en', null);
    expect(result).toBe(content);
  });
});
