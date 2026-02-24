import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareSitemapToHtml } from '../../src/main/engine/SiteValidationDiffService';

function makeTempName(): string {
  return `bds-site-validation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe('SiteValidationDiffService', () => {
  it('computes missing and extra URL paths from sitemap xml and html tree', async () => {
    const tempRoot = path.join('/tmp', makeTempName());
    const htmlDir = path.join(tempRoot, 'html');

    await mkdir(path.join(htmlDir, 'category', 'news', 'page', '2'), { recursive: true });
    await mkdir(path.join(htmlDir, 'stale'), { recursive: true });
    await writeFile(path.join(htmlDir, 'index.html'), '<html>root</html>', 'utf-8');
    await writeFile(path.join(htmlDir, 'category', 'news', 'index.html'), '<html>news</html>', 'utf-8');
    await writeFile(path.join(htmlDir, 'category', 'news', 'page', '2', 'index.html'), '<html>news p2</html>', 'utf-8');
    await writeFile(path.join(htmlDir, 'stale', 'index.html'), '<html>stale</html>', 'utf-8');

    const sitemapXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '  <url><loc>https://example.com/</loc></url>',
      '  <url><loc>https://example.com/category/news/</loc></url>',
      '  <url><loc>https://example.com/category/news/page/2/</loc></url>',
      '  <url><loc>https://example.com/tag/dev/</loc></url>',
      '</urlset>',
      '',
    ].join('\n');

    const result = await compareSitemapToHtml({
      sitemapXml,
      baseUrl: 'https://example.com',
      htmlDir,
    });

    expect(result.missingUrlPaths).toEqual(['/tag/dev']);
    expect(result.extraUrlPaths).toEqual(['/stale']);
    expect(result.expectedUrlCount).toBe(4);
    expect(result.existingHtmlUrlCount).toBe(4);
  });

  it('normalizes base path urls and tolerates missing html dir', async () => {
    const sitemapXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '  <url><loc>https://example.com/blog/</loc></url>',
      '  <url><loc>https://example.com/blog/page/2/</loc></url>',
      '</urlset>',
      '',
    ].join('\n');

    const result = await compareSitemapToHtml({
      sitemapXml,
      baseUrl: 'https://example.com/blog',
      htmlDir: path.join('/tmp', makeTempName(), 'missing-html-dir'),
    });

    expect(result.missingUrlPaths).toEqual(['/', '/page/2']);
    expect(result.extraUrlPaths).toEqual([]);
    expect(result.expectedUrlCount).toBe(2);
    expect(result.existingHtmlUrlCount).toBe(0);
  });

  it('treats zero-byte index pages as missing routes that need regeneration', async () => {
    const tempRoot = path.join('/tmp', makeTempName());
    const htmlDir = path.join(tempRoot, 'html');

    await mkdir(path.join(htmlDir, '2026', '02', '22'), { recursive: true });
    await writeFile(path.join(htmlDir, '2026', '02', '22', 'index.html'), '', 'utf-8');

    const sitemapXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '  <url><loc>https://example.com/2026/02/22/</loc></url>',
      '</urlset>',
      '',
    ].join('\n');

    const result = await compareSitemapToHtml({
      sitemapXml,
      baseUrl: 'https://example.com',
      htmlDir,
    });

    expect(result.missingUrlPaths).toEqual(['/2026/02/22']);
    expect(result.extraUrlPaths).toEqual([]);
    expect(result.expectedUrlCount).toBe(1);
    expect(result.existingHtmlUrlCount).toBe(0);
  });

  it('detects updated post routes when source markdown is newer than generated html', async () => {
    const tempRoot = path.join('/tmp', makeTempName());
    const htmlDir = path.join(tempRoot, 'html');
    const postsDir = path.join(tempRoot, 'posts');

    await mkdir(path.join(htmlDir, '2026', '02', '24', 'updated-post'), { recursive: true });
    await mkdir(path.join(postsDir, '2026', '02'), { recursive: true });

    const htmlPath = path.join(htmlDir, '2026', '02', '24', 'updated-post', 'index.html');
    const postPath = path.join(postsDir, '2026', '02', 'updated-post.md');

    await writeFile(htmlPath, '<html>old render</html>', 'utf-8');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(postPath, '# Updated post', 'utf-8');

    const sitemapXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '  <url><loc>https://example.com/2026/02/24/updated-post/</loc></url>',
      '</urlset>',
      '',
    ].join('\n');

    const result = await compareSitemapToHtml({
      sitemapXml,
      baseUrl: 'https://example.com',
      htmlDir,
      postTimestampChecks: [{
        postUrlPath: '/2026/02/24/updated-post',
        postFilePath: postPath,
      }],
    });

    expect(result.missingUrlPaths).toEqual([]);
    expect(result.extraUrlPaths).toEqual([]);
    expect(result.updatedPostUrlPaths).toEqual(['/2026/02/24/updated-post']);
  });
});
