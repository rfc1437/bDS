import { describe, expect, it } from 'vitest';
import { PageRenderer, type HtmlRewriteContext } from '../../src/main/engine/PageRenderer';
import type { PostData } from '../../src/main/engine/PostEngine';

const rewriteContext: HtmlRewriteContext = {
  canonicalPostPathBySlug: new Map<string, string>(),
  canonicalMediaPathBySourcePath: new Map<string, string>(),
};

function makePost(overrides: Partial<PostData> = {}): PostData {
  return {
    id: overrides.id ?? 'post-1',
    projectId: overrides.projectId ?? 'project-1',
    title: overrides.title ?? 'Test Post',
    slug: overrides.slug ?? 'test-post',
    excerpt: overrides.excerpt,
    content: overrides.content ?? 'Default body content.',
    status: overrides.status ?? 'published',
    author: overrides.author,
    language: overrides.language ?? 'en',
    createdAt: overrides.createdAt ?? new Date('2026-02-22T10:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-02-22T10:00:00Z'),
    publishedAt: overrides.publishedAt,
    tags: overrides.tags ?? [],
    categories: overrides.categories ?? [],
  };
}

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

  it('shows excerpt only for titled posts that have one, but keeps full body otherwise', async () => {
    const renderer = new PageRenderer(
      { getAllMedia: async () => [] },
      {
        getLinkedMediaDataForPost: async () => [],
        setProjectContext: () => {},
      },
    );

    const html = await renderer.renderPostList([
      makePost({
        id: 'with-excerpt',
        slug: 'with-excerpt',
        title: 'With Excerpt',
        excerpt: 'EXCERPT ONLY CONTENT',
        content: 'FULL BODY SHOULD NOT APPEAR',
      }),
      makePost({
        id: 'without-excerpt',
        slug: 'without-excerpt',
        title: 'Without Excerpt',
        content: 'FULL BODY WITHOUT EXCERPT',
      }),
      makePost({
        id: 'aside-post',
        slug: 'aside-post',
        title: 'Hidden Title',
        excerpt: 'ASIDE EXCERPT SHOULD NOT APPEAR',
        content: 'ASIDE FULL BODY SHOULD APPEAR',
        categories: ['aside'],
      }),
    ], rewriteContext, {
      archiveGrouping: false,
      routeKind: 'non-date',
      basePathname: '/',
      page_title: 'Test Blog',
      language: 'en',
      menu_items: [],
      categorySettings: {
        aside: {
          renderInLists: true,
          showTitle: false,
        },
      },
    });

    expect(html).toContain('EXCERPT ONLY CONTENT');
    expect(html).not.toContain('FULL BODY SHOULD NOT APPEAR');
    expect(html).toContain('FULL BODY WITHOUT EXCERPT');
    expect(html).toContain('ASIDE FULL BODY SHOULD APPEAR');
    expect(html).not.toContain('ASIDE EXCERPT SHOULD NOT APPEAR');
  });
});

describe('PageRenderer.renderSinglePost', () => {
  it('always renders the full body even when an excerpt exists', async () => {
    const renderer = new PageRenderer(
      { getAllMedia: async () => [] },
      {
        getLinkedMediaDataForPost: async () => [],
        setProjectContext: () => {},
      },
    );

    const html = await renderer.renderSinglePost(
      makePost({
        id: 'single-post',
        slug: 'single-post',
        title: 'Single Post',
        excerpt: 'SINGLE EXCERPT SHOULD NOT REPLACE BODY',
        content: 'SINGLE FULL BODY SHOULD APPEAR',
      }),
      rewriteContext,
      {
        page_title: 'Single Post',
        language: 'en',
        menu_items: [],
      },
    );

    expect(html).toContain('SINGLE FULL BODY SHOULD APPEAR');
    expect(html).not.toContain('SINGLE EXCERPT SHOULD NOT REPLACE BODY');
  });
});
