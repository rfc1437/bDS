import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Global SVG button pointer-events styles', () => {
  const cssPath = path.resolve(__dirname, '../../src/renderer/styles/global.css');

  it('routes pointer events through buttons instead of nested SVG geometry', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/button\s+svg\s*,\s*button\s+svg\s*\*\s*\{[^}]*pointer-events:\s*none;[^}]*\}/s);
  });
});
