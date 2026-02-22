import { describe, expect, it } from 'vitest';
import { normalizePreviewHref, rewriteRenderedHtmlUrls, type HtmlRewriteContext } from '../../src/main/engine/PageRenderer';

function makeRewriteContext(): HtmlRewriteContext {
  return {
    canonicalPostPathBySlug: new Map<string, string>([
      ['target-post', '/2025/02/14/target-post'],
    ]),
    canonicalMediaPathBySourcePath: new Map<string, string>([
      ['media/2025/02/example.jpg', '/media/2025/02/3b94f5d1-91f5-4c9b-a8d4-6f3bf8f045cf.jpg'],
    ]),
  };
}

describe('PageRenderer URL rewriting', () => {
  it('rewrites post alias URLs with .html and preserves query/hash suffixes', () => {
    const rewriteContext = makeRewriteContext();

    const rewrittenByLegacyPost = normalizePreviewHref('/post/target-post.html?draft=true#preview', rewriteContext);
    expect(rewrittenByLegacyPost).toBe('/2025/02/14/target-post?draft=true#preview');

    const rewrittenByLegacyPosts = normalizePreviewHref('/posts/2025/2/target-post.html?foo=bar#frag', rewriteContext);
    expect(rewrittenByLegacyPosts).toBe('/2025/02/14/target-post?foo=bar#frag');
  });

  it('normalizes canonical day-route URLs with .html to zero-padded canonical form', () => {
    const rewriteContext = makeRewriteContext();

    const rewritten = normalizePreviewHref('/2025/2/3/target-post.html?x=1#y', rewriteContext);
    expect(rewritten).toBe('/2025/02/03/target-post?x=1#y');
  });

  it('rewrites media alias links in href using original filename and mixed case', () => {
    const rewriteContext = makeRewriteContext();

    const html = '<p><a href="/media/2025/02/ExAmPlE.JPG?download=1#asset">Image</a></p>';
    const rewrittenHtml = rewriteRenderedHtmlUrls(html, rewriteContext);

    expect(rewrittenHtml).toContain('href="/media/2025/02/3b94f5d1-91f5-4c9b-a8d4-6f3bf8f045cf.jpg?download=1#asset"');
  });

  it('keeps unknown internal media links stable while preserving suffixes', () => {
    const rewriteContext = makeRewriteContext();

    const rewritten = normalizePreviewHref('/media/2025/02/unknown-file.jpg?raw=1#top', rewriteContext);
    expect(rewritten).toBe('/media/2025/02/unknown-file.jpg?raw=1#top');
  });

  it('does not rewrite protocol-relative URLs', () => {
    const rewriteContext = makeRewriteContext();

    const html = '<p><a href="//cdn.example.com/file.jpg?x=1#y">CDN</a><img src="//cdn.example.com/pic.jpg?x=1#y" alt="CDN image"></p>';
    const rewrittenHtml = rewriteRenderedHtmlUrls(html, rewriteContext);

    expect(rewrittenHtml).toContain('href="//cdn.example.com/file.jpg?x=1#y"');
    expect(rewrittenHtml).toContain('src="//cdn.example.com/pic.jpg?x=1#y"');
  });
});
