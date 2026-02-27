import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerMacro,
  clearMacros,
  renderMacro,
  renderAllMacros,
  setPythonMacroResolver,
} from '../../../src/renderer/macros/registry';
import type {
  MacroRenderContext,
  ParsedMacro,
  PythonMacroInfo,
  PythonMacroResolver,
  PythonMacroRendererFn,
} from '../../../src/renderer/macros/types';

describe('Python macro coexistence in renderer registry', () => {
  const context: MacroRenderContext = { isPreview: true };

  beforeEach(() => {
    clearMacros();
    setPythonMacroResolver(null, null);
  });

  describe('renderMacro with Python fallback', () => {
    it('should prefer JS macro over Python macro with same name', async () => {
      registerMacro({
        name: 'widget',
        description: 'JS widget',
        render: () => '<div>JS Widget</div>',
      });

      const resolver: PythonMacroResolver = vi.fn().mockResolvedValue({
        scriptId: 'py-1',
        slug: 'widget',
        code: 'def render(ctx): return {"html": "<div>Python Widget</div>"}',
        entrypoint: 'render',
        version: 1,
      });
      const renderer: PythonMacroRendererFn = vi.fn().mockResolvedValue('<div>Python Widget</div>');

      setPythonMacroResolver(resolver, renderer);

      const macro: ParsedMacro = {
        name: 'widget',
        params: {},
        rawText: '[[widget]]',
        start: 0,
        end: 10,
      };

      const result = await renderMacro(macro, context);
      expect(result).toBe('<div>JS Widget</div>');
      expect(resolver).not.toHaveBeenCalled();
      expect(renderer).not.toHaveBeenCalled();
    });

    it('should fall back to Python macro when not in JS registry', async () => {
      const pythonInfo: PythonMacroInfo = {
        scriptId: 'py-2',
        slug: 'data_table',
        code: 'def render(ctx): return {"html": "<table>...</table>"}',
        entrypoint: 'render',
        version: 1,
      };

      const resolver: PythonMacroResolver = vi.fn().mockResolvedValue(pythonInfo);
      const renderer: PythonMacroRendererFn = vi.fn().mockResolvedValue('<table class="python-table"><tr><td>Data</td></tr></table>');

      setPythonMacroResolver(resolver, renderer);

      const macro: ParsedMacro = {
        name: 'data_table',
        params: { source: 'posts' },
        rawText: '[[data_table source="posts"]]',
        start: 0,
        end: 29,
      };

      const result = await renderMacro(macro, context);
      expect(result).toBe('<table class="python-table"><tr><td>Data</td></tr></table>');
      expect(resolver).toHaveBeenCalledWith('data_table');
      expect(renderer).toHaveBeenCalledWith(pythonInfo, { source: 'posts' }, context);
    });

    it('should show error span when Python resolver returns null', async () => {
      const resolver: PythonMacroResolver = vi.fn().mockResolvedValue(null);
      const renderer: PythonMacroRendererFn = vi.fn();

      setPythonMacroResolver(resolver, renderer);

      const macro: ParsedMacro = {
        name: 'unknown_thing',
        params: {},
        rawText: '[[unknown_thing]]',
        start: 0,
        end: 17,
      };

      const result = await renderMacro(macro, context);
      expect(result).toContain('macro-error');
      expect(result).toContain('Unknown macro');
      expect(renderer).not.toHaveBeenCalled();
    });

    it('should show error span when Python resolver throws', async () => {
      const resolver: PythonMacroResolver = vi.fn().mockRejectedValue(new Error('Resolution failed'));
      const renderer: PythonMacroRendererFn = vi.fn();

      setPythonMacroResolver(resolver, renderer);

      const macro: ParsedMacro = {
        name: 'broken_resolve',
        params: {},
        rawText: '[[broken_resolve]]',
        start: 0,
        end: 18,
      };

      const result = await renderMacro(macro, context);
      expect(result).toContain('macro-error');
      expect(result).toContain('Resolution failed');
    });

    it('should show unknown macro error when no Python resolver is set', async () => {
      const macro: ParsedMacro = {
        name: 'no_resolver',
        params: {},
        rawText: '[[no_resolver]]',
        start: 0,
        end: 15,
      };

      const result = await renderMacro(macro, context);
      expect(result).toContain('macro-error');
      expect(result).toContain('Unknown macro');
    });
  });

  describe('renderAllMacros with mixed JS and Python', () => {
    it('should render mixed JS and Python macros in one document', async () => {
      registerMacro({
        name: 'hello',
        description: 'Greeting',
        render: (params) => `<span>Hello ${params.name || 'World'}</span>`,
      });

      const resolver: PythonMacroResolver = vi.fn().mockImplementation(async (name: string) => {
        if (name === 'chart') {
          return {
            scriptId: 'py-chart',
            slug: 'chart',
            code: 'def render(ctx): return {"html": "<canvas>chart</canvas>"}',
            entrypoint: 'render',
            version: 1,
          };
        }
        return null;
      });

      const renderer: PythonMacroRendererFn = vi.fn().mockResolvedValue('<canvas>Rendered Chart</canvas>');

      setPythonMacroResolver(resolver, renderer);

      const input = 'Intro [[hello name="Alice"]] middle [[chart type="bar"]] end';
      const result = await renderAllMacros(input, context);

      expect(result).toContain('<span>Hello Alice</span>');
      expect(result).toContain('<canvas>Rendered Chart</canvas>');
      expect(result).toContain('Intro');
      expect(result).toContain('middle');
      expect(result).toContain('end');
    });

    it('should handle multiple Python macros in sequence', async () => {
      const resolver: PythonMacroResolver = vi.fn().mockImplementation(async (name: string) => {
        if (name === 'box_a') {
          return { scriptId: 'a', slug: 'box_a', code: '', entrypoint: 'render', version: 1 };
        }
        if (name === 'box_b') {
          return { scriptId: 'b', slug: 'box_b', code: '', entrypoint: 'render', version: 1 };
        }
        return null;
      });

      let callCount = 0;
      const renderer: PythonMacroRendererFn = vi.fn().mockImplementation(async (info: PythonMacroInfo) => {
        callCount++;
        return `<div class="${info.slug}">Output ${callCount}</div>`;
      });

      setPythonMacroResolver(resolver, renderer);

      const input = '[[box_a]] [[box_b]]';
      const result = await renderAllMacros(input, context);

      expect(result).toContain('<div class="box_a">Output 1</div>');
      expect(result).toContain('<div class="box_b">Output 2</div>');
    });
  });

  describe('precedence and dispatch documentation', () => {
    it('JS built-in macros always take priority over Python scripts', async () => {
      registerMacro({
        name: 'gallery',
        description: 'JS Gallery',
        render: () => '<div class="js-gallery">Built-in</div>',
      });

      const resolver: PythonMacroResolver = vi.fn().mockResolvedValue({
        scriptId: 'py-gal',
        slug: 'gallery',
        code: 'def render(ctx): return {"html": "<div class=py-gallery>Custom</div>"}',
        entrypoint: 'render',
        version: 1,
      });
      const renderer: PythonMacroRendererFn = vi.fn().mockResolvedValue('<div class="py-gallery">Custom</div>');

      setPythonMacroResolver(resolver, renderer);

      const macro: ParsedMacro = {
        name: 'gallery',
        params: {},
        rawText: '[[gallery]]',
        start: 0,
        end: 11,
      };

      const result = await renderMacro(macro, context);
      expect(result).toBe('<div class="js-gallery">Built-in</div>');
      expect(resolver).not.toHaveBeenCalled();
    });

    it('Python macros are only used for names not in JS registry', async () => {
      registerMacro({
        name: 'existing',
        description: 'Existing JS',
        render: () => 'JS',
      });

      const resolver: PythonMacroResolver = vi.fn().mockImplementation(async (name: string) => {
        if (name === 'python_only') {
          return { scriptId: 'p1', slug: 'python_only', code: '', entrypoint: 'render', version: 1 };
        }
        return null;
      });
      const renderer: PythonMacroRendererFn = vi.fn().mockResolvedValue('Python Output');

      setPythonMacroResolver(resolver, renderer);

      const input = '[[existing]] [[python_only]]';
      const result = await renderAllMacros(input, context);

      expect(result).toContain('JS');
      expect(result).toContain('Python Output');
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(resolver).toHaveBeenCalledWith('python_only');
    });
  });
});
