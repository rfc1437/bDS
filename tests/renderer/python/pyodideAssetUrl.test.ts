import { describe, expect, it } from 'vitest';
import { resolvePyodideIndexURL } from '../../../src/renderer/python/pyodideAssetUrl';

describe('resolvePyodideIndexURL', () => {
  it('resolves to packaged node_modules path for dist worker urls', () => {
    const workerUrl = 'file:///Applications/bDS.app/Contents/Resources/app.asar/dist/renderer/assets/pythonRuntime.worker-abc123.js';
    expect(resolvePyodideIndexURL(workerUrl)).toBe(
      'file:///Applications/bDS.app/Contents/Resources/app.asar/node_modules/pyodide/'
    );
  });

  it('resolves to vite node_modules path for dev worker urls', () => {
    const workerUrl = 'http://localhost:5173/src/renderer/python/pythonRuntime.worker.ts';
    expect(resolvePyodideIndexURL(workerUrl)).toBe('http://localhost:5173/node_modules/pyodide/');
  });
});
