import { describe, expect, it } from 'vitest';
import { createMacroRenderOptions } from '../../../src/renderer/python/macroRenderOptions';

describe('createMacroRenderOptions', () => {
  it('maps hook/source metadata into runtime macro options', () => {
    const options = createMacroRenderOptions({
      hook: 'preview:macro',
      source: {
        kind: 'post',
        id: 'post-5',
      },
      cacheKey: 'script-1:1:abc',
      timeoutMs: 4000,
    });

    expect(options).toEqual({
      macroHook: 'preview:macro',
      macroSource: {
        kind: 'post',
        id: 'post-5',
      },
      cacheKey: 'script-1:1:abc',
      timeoutMs: 4000,
    });
  });

  it('returns empty options when no values are provided', () => {
    expect(createMacroRenderOptions()).toEqual({});
  });
});
