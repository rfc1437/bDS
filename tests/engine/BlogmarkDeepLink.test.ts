import { describe, it, expect } from 'vitest';
import {
  buildBlogmarkMarkdownLink,
  extractBlogmarkPayloadFromDeepLink,
  generateBlogmarkBookmarkletSource,
} from '../../src/main/shared/blogmark';

describe('blogmark deep-link payload', () => {
  it('extracts and sanitizes title and URL from deep link', () => {
    const payload = extractBlogmarkPayloadFromDeepLink(
      'bds://new-post?title=Hello%20%3Cb%3EWorld%3C%2Fb%3E&url=https%3A%2F%2Fexample.com%2Fpost%3Fx%3D1%23frag',
    );

    expect(payload).toEqual({
      title: 'Hello <b>World</b>',
      url: 'https://example.com/post?x=1',
    });
  });

  it('rejects non-http URLs', () => {
    const payload = extractBlogmarkPayloadFromDeepLink(
      'bds://new-post?title=Unsafe&url=javascript%3Aalert(1)',
    );

    expect(payload).toBeNull();
  });

  it('rejects entity-obfuscated script URLs', () => {
    const payload = extractBlogmarkPayloadFromDeepLink(
      'bds://new-post?title=Unsafe&url=javascript%26%2397%3Balert(1)',
    );

    expect(payload).toBeNull();
  });

  it('builds safe markdown source link', () => {
    const markdown = buildBlogmarkMarkdownLink('A [title] (test)', 'https://example.com/x?y=1');
    expect(markdown).toBe('[A \\[title\\] \\(test\\)](https://example.com/x?y=1)');
  });

  it('generates bookmarklet that targets bds protocol', () => {
    const source = generateBlogmarkBookmarkletSource();

    expect(source.startsWith('javascript:')).toBe(true);
    expect(source).toContain('bds://new-post?title=');
    expect(source).toContain('encodeURIComponent(document.title');
    expect(source).toContain('encodeURIComponent(location.href');
  });
});