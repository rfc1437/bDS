/**
 * Verify that ChatTranscript and A2UIText block external images
 * by providing a custom marked-react renderer that converts them to links.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const chatTranscriptPath = path.resolve(
  __dirname,
  '../../../src/renderer/components/ChatSurface/ChatTranscript.tsx',
);
const a2uiTextPath = path.resolve(
  __dirname,
  '../../../src/renderer/a2ui/components/A2UIText.tsx',
);

describe('External image blocking', () => {
  it('ChatTranscript defines a safeRenderer that intercepts image tags', () => {
    const source = fs.readFileSync(chatTranscriptPath, 'utf8');

    // Must have a renderer that handles images
    expect(source).toContain('safeRenderer');
    expect(source).toContain('image(src');
    expect(source).toContain('https?:');

    // Both Markdown usages must pass the renderer
    const markdownUsages = source.match(/<Markdown[^>]*>/g) ?? [];
    expect(markdownUsages.length).toBeGreaterThanOrEqual(2);
    for (const usage of markdownUsages) {
      expect(usage).toContain('renderer={safeRenderer}');
    }
  });

  it('A2UIText defines a safeRenderer that intercepts image tags', () => {
    const source = fs.readFileSync(a2uiTextPath, 'utf8');

    expect(source).toContain('safeRenderer');
    expect(source).toContain('image(src');
    expect(source).toContain('https?:');
    expect(source).toContain('renderer={safeRenderer}');
  });

  it('safeRenderer converts external URLs to links, not img tags', () => {
    const source = fs.readFileSync(chatTranscriptPath, 'utf8');

    // The renderer should return <a> for external URLs, not <img>
    expect(source).toContain('https?:');
    expect(source).toContain('.test(src)');
    expect(source).toContain('<a href={src}');
  });
});
