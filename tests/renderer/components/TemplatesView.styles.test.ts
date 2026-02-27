import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('TemplatesView styles', () => {
  const cssPath = path.resolve(
    __dirname,
    '../../../src/renderer/components/TemplatesView/TemplatesView.css'
  );

  it('uses full editor area layout for the templates container', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.templates-view\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*\}/s);
  });

  it('keeps editor and monaco stretched to fill available space', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.templates-editor\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*\}/s);
    expect(css).toMatch(/\.templates-monaco\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*\}/s);
  });
});
