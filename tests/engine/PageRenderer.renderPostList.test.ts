import { describe, expect, it } from 'vitest';
import { PageRenderer, type HtmlRewriteContext } from '../../src/main/engine/PageRenderer';

const rewriteContext: HtmlRewriteContext = {
  canonicalPostPathBySlug: new Map<string, string>(),
  canonicalMediaPathBySourcePath: new Map<string, string>(),
};

describe('PageRenderer.renderPostList', () => {
  it('renders base framework for empty day archive pages instead of returning empty html', async () => {
    const renderer = new PageRenderer(
      { getAllMedia: async () => [] },
      {
        getLinkedMediaDataForPost: async () => [],
        setProjectContext: () => {},
      },
    );

    const html = await renderer.renderPostList([], rewriteContext, {
      archiveGrouping: true,
      routeKind: 'date',
      archiveContext: { kind: 'day', year: 2026, month: 2, day: 22 },
      basePathname: '/2026/02/22',
      page_title: 'Test Blog',
      language: 'en',
      menu_items: [],
      renderEmptyState: true,
    });

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<section class="post-list"');
    expect(html).toContain('<h1 class="archive-heading">Archive 22. February 2026</h1>');
  });
});
