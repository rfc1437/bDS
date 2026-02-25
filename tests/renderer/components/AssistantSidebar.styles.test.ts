import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('AssistantSidebar styles', () => {
  const cssPath = path.resolve(
    __dirname,
    '../../../src/renderer/components/AssistantSidebar/AssistantSidebar.css'
  );

  it('keeps the sidebar container scrollable for long assistant content', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.assistant-sidebar\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*\}/s);
  });
});
