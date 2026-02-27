import { describe, expect, it } from 'vitest';
import { resolvePostTemplateName, resolveListTemplateName, resolvePageRendererTemplateRoots } from '../../src/main/engine/PageRenderer';

describe('resolvePostTemplateName', () => {
  it('returns default single-post when no overrides exist', () => {
    const result = resolvePostTemplateName({});
    expect(result).toBe('single-post');
  });

  it('returns post-level templateSlug when set', () => {
    const result = resolvePostTemplateName({ templateSlug: 'photo-post' });
    expect(result).toBe('photo-post');
  });

  it('returns tag-level override when post has no template and tag does', () => {
    const result = resolvePostTemplateName(
      { tags: ['photography', 'travel'] },
      { photography: { postTemplateSlug: 'photo-layout' } },
    );
    expect(result).toBe('photo-layout');
  });

  it('prioritizes post-level over tag-level', () => {
    const result = resolvePostTemplateName(
      { templateSlug: 'custom-post', tags: ['photography'] },
      { photography: { postTemplateSlug: 'photo-layout' } },
    );
    expect(result).toBe('custom-post');
  });

  it('returns category-level override when no post or tag override', () => {
    const result = resolvePostTemplateName(
      { categories: ['article'] },
      undefined,
      { article: { postTemplateSlug: 'article-layout' } },
    );
    expect(result).toBe('article-layout');
  });

  it('prioritizes tag-level over category-level', () => {
    const result = resolvePostTemplateName(
      { tags: ['featured'], categories: ['article'] },
      { featured: { postTemplateSlug: 'featured-layout' } },
      { article: { postTemplateSlug: 'article-layout' } },
    );
    expect(result).toBe('featured-layout');
  });

  it('skips tags/categories with null postTemplateSlug', () => {
    const result = resolvePostTemplateName(
      { tags: ['empty'], categories: ['article'] },
      { empty: { postTemplateSlug: null } },
      { article: { postTemplateSlug: 'article-layout' } },
    );
    expect(result).toBe('article-layout');
  });

  it('returns default when all overrides are null/undefined', () => {
    const result = resolvePostTemplateName(
      { templateSlug: null, tags: ['empty'], categories: ['plain'] },
      { empty: { postTemplateSlug: null } },
      { plain: { postTemplateSlug: undefined } },
    );
    expect(result).toBe('single-post');
  });

  it('uses first matching tag with a template slug', () => {
    const result = resolvePostTemplateName(
      { tags: ['no-template', 'has-template', 'also-has'] },
      {
        'has-template': { postTemplateSlug: 'first-match' },
        'also-has': { postTemplateSlug: 'second-match' },
      },
    );
    expect(result).toBe('first-match');
  });
});

describe('resolveListTemplateName', () => {
  it('returns default post-list when no overrides exist', () => {
    const result = resolveListTemplateName();
    expect(result).toBe('post-list');
  });

  it('returns default when no route category', () => {
    const result = resolveListTemplateName(undefined, {
      article: { listTemplateSlug: 'article-list' },
    });
    expect(result).toBe('post-list');
  });

  it('returns category-level listTemplateSlug', () => {
    const result = resolveListTemplateName('article', {
      article: { listTemplateSlug: 'article-list' },
    });
    expect(result).toBe('article-list');
  });

  it('returns default when category has no listTemplateSlug', () => {
    const result = resolveListTemplateName('article', {
      article: { listTemplateSlug: undefined },
    });
    expect(result).toBe('post-list');
  });

  it('returns default when category not in settings', () => {
    const result = resolveListTemplateName('unknown', {
      article: { listTemplateSlug: 'article-list' },
    });
    expect(result).toBe('post-list');
  });
});

describe('resolvePageRendererTemplateRoots with userTemplatesDir', () => {
  it('adds user templates directory first when provided', () => {
    const roots = resolvePageRendererTemplateRoots({
      moduleDir: '/app/dist/main/engine',
      cwd: '/app',
      userTemplatesDir: '/data/project/templates',
    });

    expect(roots[0]).toBe('/data/project/templates');
  });

  it('does not add user templates when not provided', () => {
    const roots = resolvePageRendererTemplateRoots({
      moduleDir: '/app/dist/main/engine',
      cwd: '/app',
    });

    expect(roots).not.toContain(undefined);
    expect(roots.every(r => r.length > 0)).toBe(true);
  });
});
