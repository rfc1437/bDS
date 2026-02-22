import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('ScriptsView styles', () => {
  const cssPath = path.resolve(
    __dirname,
    '../../../src/renderer/components/ScriptsView/ScriptsView.css'
  );

  it('uses full editor area layout for the scripts container', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.scripts-view\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*\}/s);
  });

  it('keeps editor and textarea stretched to fill available space', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.scripts-editor\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*\}/s);
    expect(css).toMatch(/\.scripts-monaco\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*\}/s);
  });
});
