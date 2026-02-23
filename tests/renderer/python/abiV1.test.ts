import { describe, expect, it } from 'vitest';
import { parseMacroContextV1 } from '../../../src/renderer/python/abiV1';

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
});
