import { describe, expect, it, vi } from 'vitest';
import type { PostData } from '../../src/main/engine/PostEngine';
import { generateRootPages, generateSinglePostPages } from '../../src/main/engine/RoutePageGenerationService';

function makePost(overrides: Partial<PostData> = {}): PostData {
  const createdAt = overrides.createdAt ?? new Date('2025-01-02T10:00:00.000Z');
  return {
    id: overrides.id ?? 'post-1',
    projectId: overrides.projectId ?? 'project',
    title: overrides.title ?? 'Title',
    slug: overrides.slug ?? 'title',
    excerpt: overrides.excerpt,
    content: overrides.content ?? 'Body',
    status: overrides.status ?? 'published',
    author: overrides.author,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    publishedAt: overrides.publishedAt,
    tags: overrides.tags ?? [],
    categories: overrides.categories ?? [],
  };
}

describe('RoutePageGenerationService', () => {
  it('renders root and paginated list routes', async () => {
    const posts = [makePost({ id: '1' }), makePost({ id: '2' }), makePost({ id: '3' })];
    const renderRoute = vi.fn().mockResolvedValue('<html>ok</html>');
    const writePage = vi.fn().mockResolvedValue(true);

    const count = await generateRootPages({
      projectId: 'p',
      posts,
      maxPostsPerPage: 2,
      renderRoute,
      writePage,
      onPageGenerated: () => {},
    });

    expect(count).toBe(2);
    expect(renderRoute).toHaveBeenCalledWith('/');
    expect(renderRoute).toHaveBeenCalledWith('/page/2');
  });

  it('renders canonical single post routes', async () => {
    const posts = [makePost({ id: '1', slug: 'hello', createdAt: new Date('2025-01-15T10:00:00.000Z') })];
    const renderRoute = vi.fn().mockResolvedValue('<html>ok</html>');
    const writePage = vi.fn().mockResolvedValue(true);

    const count = await generateSinglePostPages({
      projectId: 'p',
      posts,
      renderRoute,
      writePage,
      onPageGenerated: () => {},
    });

    expect(count).toBe(1);
    expect(renderRoute).toHaveBeenCalledWith('/2025/01/15/hello');
    expect(writePage).toHaveBeenCalledWith('p', '2025/01/15/hello', '<html>ok</html>');
  });
});
