/**
 * Tests for the Macro Registry
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerMacro,
  getMacro,
  hasMacro,
  getMacroNames,
  getAllMacros,
  clearMacros,
  parseParams,
  parseMacros,
  renderMacro,
  renderAllMacros,
  getEditorPreview,
} from '../../../src/renderer/macros/registry';
import type { MacroDefinition, MacroParams, MacroRenderContext, ParsedMacro } from '../../../src/renderer/macros/types';

// Helper to create a test macro
function createTestMacro(overrides: Partial<MacroDefinition> = {}): MacroDefinition {
  return {
    name: 'testmacro',
    description: 'A test macro',
    render: (params: MacroParams) => `<div>Test: ${params.value || 'no value'}</div>`,
    ...overrides,
  };
}

describe('Macro Registry', () => {
  beforeEach(() => {
    clearMacros();
  });

  describe('registerMacro', () => {
    it('should register a macro successfully', () => {
      const macro = createTestMacro({ name: 'mymacro' });
      registerMacro(macro);
      
      expect(hasMacro('mymacro')).toBe(true);
      expect(getMacro('mymacro')).toBe(macro);
    });

    it('should store macro names as lowercase', () => {
      const macro = createTestMacro({ name: 'MyMacro' });
      registerMacro(macro);
      
      expect(hasMacro('mymacro')).toBe(true);
      expect(hasMacro('MyMacro')).toBe(true);
      expect(hasMacro('MYMACRO')).toBe(true);
    });

    it('should overwrite existing macro with warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const macro1 = createTestMacro({ name: 'dupe', description: 'First' });
      const macro2 = createTestMacro({ name: 'dupe', description: 'Second' });
      
      registerMacro(macro1);
      registerMacro(macro2);
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('already registered'));
      expect(getMacro('dupe')?.description).toBe('Second');
      
      consoleSpy.mockRestore();
    });
  });

  describe('getMacro', () => {
    it('should return undefined for unregistered macro', () => {
      expect(getMacro('nonexistent')).toBeUndefined();
    });

    it('should return macro case-insensitively', () => {
      const macro = createTestMacro({ name: 'gallery' });
      registerMacro(macro);
      
      expect(getMacro('gallery')).toBe(macro);
      expect(getMacro('Gallery')).toBe(macro);
      expect(getMacro('GALLERY')).toBe(macro);
    });
  });

  describe('getMacroNames', () => {
    it('should return empty array when no macros registered', () => {
      expect(getMacroNames()).toEqual([]);
    });

    it('should return all registered macro names', () => {
      registerMacro(createTestMacro({ name: 'alpha' }));
      registerMacro(createTestMacro({ name: 'beta' }));
      registerMacro(createTestMacro({ name: 'gamma' }));
      
      const names = getMacroNames();
      expect(names).toHaveLength(3);
      expect(names).toContain('alpha');
      expect(names).toContain('beta');
      expect(names).toContain('gamma');
    });
  });

  describe('getAllMacros', () => {
    it('should return all registered macro definitions', () => {
      const macro1 = createTestMacro({ name: 'one' });
      const macro2 = createTestMacro({ name: 'two' });
      
      registerMacro(macro1);
      registerMacro(macro2);
      
      const macros = getAllMacros();
      expect(macros).toHaveLength(2);
      expect(macros).toContain(macro1);
      expect(macros).toContain(macro2);
    });
  });
});

describe('parseParams', () => {
  it('should parse double-quoted parameters', () => {
    const result = parseParams('foo="bar" baz="qux"');
    expect(result).toEqual({ foo: 'bar', baz: 'qux' });
  });

  it('should parse single-quoted parameters', () => {
    const result = parseParams("foo='bar' baz='qux'");
    expect(result).toEqual({ foo: 'bar', baz: 'qux' });
  });

  it('should parse mixed quotes', () => {
    const result = parseParams('foo="bar" baz=\'qux\'');
    expect(result).toEqual({ foo: 'bar', baz: 'qux' });
  });

  it('should handle empty string', () => {
    expect(parseParams('')).toEqual({});
  });

  it('should handle undefined', () => {
    expect(parseParams(undefined)).toEqual({});
  });

  it('should handle parameters with spaces in values', () => {
    const result = parseParams('title="Hello World" caption="Nice photo"');
    expect(result).toEqual({ title: 'Hello World', caption: 'Nice photo' });
  });

  it('should handle parameters with special characters', () => {
    const result = parseParams('url="https://example.com/path?a=1&b=2"');
    expect(result).toEqual({ url: 'https://example.com/path?a=1&b=2' });
  });

  it('should parse unquoted numeric parameters', () => {
    const result = parseParams('year=2016 month=6');
    expect(result).toEqual({ year: '2016', month: '6' });
  });

  it('should parse unquoted alphanumeric parameters', () => {
    const result = parseParams('id=abc123 type=photo');
    expect(result).toEqual({ id: 'abc123', type: 'photo' });
  });

  it('should parse mixed quoted and unquoted parameters', () => {
    const result = parseParams('year=2016 title="My Photos" month=6');
    expect(result).toEqual({ year: '2016', title: 'My Photos', month: '6' });
  });
});

describe('parseMacros', () => {
  it('should parse a single macro without params', () => {
    const result = parseMacros('Hello [[gallery]] world');
    
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('gallery');
    expect(result[0].params).toEqual({});
    expect(result[0].rawText).toBe('[[gallery]]');
  });

  it('should parse a macro with parameters', () => {
    const result = parseMacros('[[gallery link="photos" columns="3"]]');
    
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('gallery');
    expect(result[0].params).toEqual({ link: 'photos', columns: '3' });
  });

  it('should parse multiple macros', () => {
    const result = parseMacros('Intro [[gallery]] middle [[youtube id="abc"]] end');
    
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('gallery');
    expect(result[1].name).toBe('youtube');
    expect(result[1].params).toEqual({ id: 'abc' });
  });

  it('should capture start and end positions', () => {
    const text = 'Hello [[test]] world';
    const result = parseMacros(text);
    
    expect(result[0].start).toBe(6);
    expect(result[0].end).toBe(14);
    expect(text.slice(result[0].start, result[0].end)).toBe('[[test]]');
  });

  it('should return empty array for text without macros', () => {
    expect(parseMacros('Just regular text')).toEqual([]);
    expect(parseMacros('')).toEqual([]);
  });

  it('should handle macro names case-insensitively', () => {
    const result = parseMacros('[[MyMacro]]');
    expect(result[0].name).toBe('mymacro');
  });
});

describe('renderMacro', () => {
  const context: MacroRenderContext = { isPreview: true };

  beforeEach(() => {
    clearMacros();
  });

  it('should render a registered macro', async () => {
    registerMacro({
      name: 'hello',
      description: 'Says hello',
      render: (params) => `<span>Hello, ${params.name || 'world'}!</span>`,
    });

    const macro: ParsedMacro = {
      name: 'hello',
      params: { name: 'Alice' },
      rawText: '[[hello name="Alice"]]',
      start: 0,
      end: 22,
    };

    const result = await renderMacro(macro, context);
    expect(result).toBe('<span>Hello, Alice!</span>');
  });

  it('should return error span for unknown macro', async () => {
    const macro: ParsedMacro = {
      name: 'unknown',
      params: {},
      rawText: '[[unknown]]',
      start: 0,
      end: 11,
    };

    const result = await renderMacro(macro, context);
    expect(result).toContain('macro-error');
    expect(result).toContain('Unknown macro');
    expect(result).toContain('[[unknown]]');
  });

  it('should handle async render functions', async () => {
    registerMacro({
      name: 'async',
      description: 'Async macro',
      render: async (params) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return `<div>Async: ${params.val}</div>`;
      },
    });

    const macro: ParsedMacro = {
      name: 'async',
      params: { val: 'test' },
      rawText: '[[async val="test"]]',
      start: 0,
      end: 20,
    };

    const result = await renderMacro(macro, context);
    expect(result).toBe('<div>Async: test</div>');
  });

  it('should return error span when validation fails', async () => {
    registerMacro({
      name: 'validated',
      description: 'Validated macro',
      validate: (params) => params.required ? undefined : 'Missing required param',
      render: () => '<div>OK</div>',
    });

    const macro: ParsedMacro = {
      name: 'validated',
      params: {},
      rawText: '[[validated]]',
      start: 0,
      end: 13,
    };

    const result = await renderMacro(macro, context);
    expect(result).toContain('macro-error');
    expect(result).toContain('Missing required param');
  });

  it('should return error span when render throws', async () => {
    registerMacro({
      name: 'broken',
      description: 'Broken macro',
      render: () => { throw new Error('Render failed'); },
    });

    const macro: ParsedMacro = {
      name: 'broken',
      params: {},
      rawText: '[[broken]]',
      start: 0,
      end: 10,
    };

    const result = await renderMacro(macro, context);
    expect(result).toContain('macro-error');
    expect(result).toContain('Render failed');
  });
});

describe('renderAllMacros', () => {
  const context: MacroRenderContext = { isPreview: true };

  beforeEach(() => {
    clearMacros();
  });

  it('should replace all macros in text', async () => {
    registerMacro({
      name: 'bold',
      description: 'Makes text bold',
      render: (params) => `<strong>${params.text}</strong>`,
    });

    const input = 'Hello [[bold text="world"]]!';
    const result = await renderAllMacros(input, context);
    
    expect(result).toBe('Hello <strong>world</strong>!');
  });

  it('should handle multiple macros', async () => {
    registerMacro({
      name: 'a',
      description: 'Macro A',
      render: () => 'AAA',
    });
    registerMacro({
      name: 'b',
      description: 'Macro B',
      render: () => 'BBB',
    });

    const input = '[[a]] and [[b]]';
    const result = await renderAllMacros(input, context);
    
    expect(result).toBe('AAA and BBB');
  });

  it('should return unchanged text when no macros', async () => {
    const input = 'Just plain text';
    const result = await renderAllMacros(input, context);
    
    expect(result).toBe(input);
  });
});

describe('getEditorPreview', () => {
  beforeEach(() => {
    clearMacros();
  });

  it('should return warning for unknown macro', () => {
    const result = getEditorPreview('unknown', {});
    expect(result).toBe('⚠ unknown');
  });

  it('should return custom preview from macro definition', () => {
    registerMacro({
      name: 'gallery',
      description: 'Gallery',
      render: () => '',
      editorPreview: (params) => `📷 ${params.title || 'Gallery'}`,
    });

    const result = getEditorPreview('gallery', { title: 'My Photos' });
    expect(result).toBe('📷 My Photos');
  });

  it('should return default preview when editorPreview not defined', () => {
    registerMacro({
      name: 'simple',
      description: 'Simple macro',
      render: () => '',
    });

    const result = getEditorPreview('simple', {});
    expect(result).toBe('⬡ simple');
  });
});
