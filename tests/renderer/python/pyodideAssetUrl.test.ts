import { describe, expect, it } from 'vitest';
import { resolvePyodideIndexURL } from '../../../src/renderer/python/pyodideAssetUrl';

describe('resolvePyodideIndexURL', () => {
  it('resolves to packaged node_modules path for dist worker urls', () => {
    const workerUrl = 'file:///Applications/bDS.app/Contents/Resources/app.asar/dist/renderer/assets/pythonRuntime.worker-abc123.js';
    expect(resolvePyodideIndexURL(workerUrl)).toBe(
      'file:///Applications/bDS.app/Contents/Resources/app.asar/node_modules/pyodide/'
    );
  });

  it('returns undefined for dev worker urls to let pyodide use module-relative defaults', () => {
    const workerUrl = 'http://localhost:5173/src/renderer/python/pythonRuntime.worker.ts';
    expect(resolvePyodideIndexURL(workerUrl)).toBeUndefined();
  });

  it('returns undefined for vite worker_file urls with query parameters', () => {
    const workerUrl = 'http://localhost:5173/python/pythonRuntime.worker.ts?worker_file&type=module';
    expect(resolvePyodideIndexURL(workerUrl)).toBeUndefined();
  });
});
