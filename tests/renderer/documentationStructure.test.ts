// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('documentation structure and presentation', () => {
  it('uses a main-chapter-only index and hierarchical headings', () => {
    const docPath = path.resolve(process.cwd(), 'DOCUMENTATION.md');
    const markdown = readFileSync(docPath, 'utf8');

    expect(markdown).toContain('## In this article');
    expect(markdown).not.toMatch(/^\s{2,}-\s+\[/m);
    expect(markdown).not.toMatch(/^##\s+\d+\)/m);
    expect(markdown).toContain('[Who this guide is for](#who-this-guide-is-for)');
    expect(markdown).toContain('## Who this guide is for');
  });

  it('scopes Pico conditional styling to the documentation view', () => {
    const viewPath = path.resolve(
      process.cwd(),
      'src/renderer/components/DocumentationView/DocumentationView.tsx',
    );
    const source = readFileSync(viewPath, 'utf8');

    expect(source).toContain('@picocss/pico/css/pico.conditional.slate.min.css');
    expect(source).toContain('className="documentation-content markdown-body pico"');
    expect(source).toContain('data-theme="auto"');
  });
});
