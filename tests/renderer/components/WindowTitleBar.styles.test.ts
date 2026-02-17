import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('WindowTitleBar styles', () => {
  const cssPath = path.resolve(
    __dirname,
    '../../../src/renderer/components/WindowTitleBar/WindowTitleBar.css'
  );

  it('defines both standard and webkit drag regions for cross-platform support', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/app-region:\s*drag;/);
    expect(css).toMatch(/-webkit-app-region:\s*drag;/);
    expect(css).toMatch(/app-region:\s*no-drag;/);
    expect(css).toMatch(/-webkit-app-region:\s*no-drag;/);
  });

  it('reserves overlay control width to keep custom actions clickable on Windows/Linux', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/padding-right:\s*calc\(10px\s*\+\s*var\(--bds-titlebar-overlay-right,\s*0px\)\)/);
  });

  it('uses neutral focus styling for menu buttons without blue accent outlines', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.window-titlebar-menu-button:focus/);
    expect(css).toMatch(/outline:\s*none;/);
    expect(css).toMatch(/box-shadow:\s*none;/);
  });
});
