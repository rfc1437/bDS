import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('GitSidebar styles', () => {
  const cssPath = path.resolve(
    __dirname,
    '../../../src/renderer/components/GitSidebar/GitSidebar.css'
  );

  it('limits version history section to 50% of available sidebar room', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.git-sidebar-history\s*\{[^}]*flex:\s*0\s+0\s+50%;[^}]*max-height:\s*50%;[^}]*\}/s);
  });

  it('keeps commit list scrollable within the bounded history section', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.git-sidebar-history-list\s*\{[^}]*overflow:\s*auto;[^}]*\}/s);
  });
});
