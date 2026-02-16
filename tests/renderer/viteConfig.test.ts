// @vitest-environment node

import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';

describe('vite renderer chunking', () => {
  it('splits monaco editor modules into a dedicated chunk', () => {
    const resolved = typeof viteConfig === 'function' ? viteConfig({ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false }) : viteConfig;
    const output = resolved.build?.rollupOptions?.output;

    if (Array.isArray(output)) {
      throw new Error('Expected a single rollup output config for renderer build');
    }

    expect(output?.manualChunks).toBeTypeOf('function');

    const chunkName = output?.manualChunks?.('node_modules/monaco-editor/esm/vs/editor/editor.api.js');
    expect(chunkName).toBe('monaco-vendor');
  });

  it('sets an explicit chunk size warning limit for Monaco worker assets', () => {
    const resolved = typeof viteConfig === 'function' ? viteConfig({ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false }) : viteConfig;
    expect(resolved.build?.chunkSizeWarningLimit).toBe(8000);
  });
});
