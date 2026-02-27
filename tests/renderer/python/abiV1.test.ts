import { describe, expect, it } from 'vitest';
import { parseMacroContextV1, parseMacroResultV1 } from '../../../src/renderer/python/abiV1';

describe('macroContextV1Schema', () => {
  it('accepts optional env hook and source metadata', () => {
    const parsed = parseMacroContextV1({
      env: {
        isPreview: true,
        mainLanguage: 'en',
        hook: 'post:render',
        source: {
          kind: 'post',
          id: 'post-1',
        },
      },
      params: {
        title: 'Hello',
      },
      data: {
        post: {
          id: 'post-1',
          slug: 'hello',
        },
      },
    });

    expect(parsed.env.hook).toBe('post:render');
    expect(parsed.env.source).toEqual({ kind: 'post', id: 'post-1' });
  });

  it('rejects unknown env fields', () => {
    expect(() =>
      parseMacroContextV1({
        env: {
          isPreview: true,
          unknown: 'value',
        },
      })
    ).toThrow('Invalid macro context');
  });

  it('rejects when env.isPreview is missing', () => {
    expect(() =>
      parseMacroContextV1({
        env: {},
      })
    ).toThrow('Invalid macro context');
  });

  it('rejects when env.isPreview is not a boolean', () => {
    expect(() =>
      parseMacroContextV1({
        env: { isPreview: 'yes' },
      })
    ).toThrow('Invalid macro context');
  });

  it('rejects when env is missing entirely', () => {
    expect(() =>
      parseMacroContextV1({})
    ).toThrow('Invalid macro context');
  });

  it('accepts minimal valid context with only env.isPreview', () => {
    const parsed = parseMacroContextV1({
      env: { isPreview: false },
    });

    expect(parsed.env.isPreview).toBe(false);
    expect(parsed.params).toBeUndefined();
    expect(parsed.data).toBeUndefined();
  });

  it('accepts params with non-string JSON values', () => {
    const parsed = parseMacroContextV1({
      env: { isPreview: false },
      params: {
        count: 42,
        enabled: true,
        tags: ['a', 'b'],
        nested: { deep: { value: null } },
      },
    });

    expect(parsed.params?.count).toBe(42);
    expect(parsed.params?.enabled).toBe(true);
    expect(parsed.params?.tags).toEqual(['a', 'b']);
    expect(parsed.params?.nested).toEqual({ deep: { value: null } });
  });

  it('rejects unknown top-level fields', () => {
    expect(() =>
      parseMacroContextV1({
        env: { isPreview: true },
        extra: 'nope',
      })
    ).toThrow('Invalid macro context');
  });

  it('rejects unknown source fields', () => {
    expect(() =>
      parseMacroContextV1({
        env: {
          isPreview: true,
          source: { kind: 'macro', id: '1', extra: 'bad' },
        },
      })
    ).toThrow('Invalid macro context');
  });

  it('accepts source without optional id', () => {
    const parsed = parseMacroContextV1({
      env: {
        isPreview: false,
        source: { kind: 'macro' },
      },
    });

    expect(parsed.env.source).toEqual({ kind: 'macro' });
  });
});

describe('macroResultV1Schema', () => {
  it('accepts minimal result with html only', () => {
    const parsed = parseMacroResultV1({ html: '<p>hello</p>' });

    expect(parsed.html).toBe('<p>hello</p>');
    expect(parsed.data).toBeUndefined();
    expect(parsed.warnings).toBeUndefined();
  });

  it('accepts result with all optional fields', () => {
    const parsed = parseMacroResultV1({
      html: '<div>test</div>',
      data: { count: 5, nested: { key: 'val' } },
      warnings: ['slow', 'deprecated'],
    });

    expect(parsed.html).toBe('<div>test</div>');
    expect(parsed.data).toEqual({ count: 5, nested: { key: 'val' } });
    expect(parsed.warnings).toEqual(['slow', 'deprecated']);
  });

  it('accepts empty html string', () => {
    const parsed = parseMacroResultV1({ html: '' });
    expect(parsed.html).toBe('');
  });

  it('rejects when html is missing', () => {
    expect(() =>
      parseMacroResultV1({})
    ).toThrow('Invalid macro result');
  });

  it('rejects when html is not a string', () => {
    expect(() =>
      parseMacroResultV1({ html: 42 })
    ).toThrow('Invalid macro result');
  });

  it('rejects unknown top-level fields', () => {
    expect(() =>
      parseMacroResultV1({ html: '', extra: true })
    ).toThrow('Invalid macro result');
  });

  it('rejects non-string warnings', () => {
    expect(() =>
      parseMacroResultV1({ html: '', warnings: [42] })
    ).toThrow('Invalid macro result');
  });
});
