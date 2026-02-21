import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('MenuEditorView styles', () => {
  const cssPath = path.resolve(
    __dirname,
    '../../../src/renderer/components/MenuEditorView/MenuEditorView.css'
  );

  it('makes page selector results scrollable with bounded height', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.menu-editor-picker-list\s*\{[^}]*max-height:\s*[^;]+;[^}]*overflow-y:\s*auto;[^}]*\}/s);
  });

  it('bounds the inline selector area so it does not spill beyond the editor viewport', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.menu-editor-inline-search\s*\{[^}]*max-height:\s*[^;]+;[^}]*overflow:\s*hidden;[^}]*\}/s);
  });
});
