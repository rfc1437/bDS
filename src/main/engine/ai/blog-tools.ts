/**
 * Blog data tools — single source of truth for both AI SDK chat and MCP server.
 *
 * Each tool is defined with a Zod input schema and an execute function.
 * AI SDK uses these directly via `tool()`.
 * MCPServer extracts schemas + handlers from the same definitions.
 */

import { z } from 'zod';
import { tool } from 'ai';
import type { PostData, PostFilter, PaginationOptions } from '../PostEngine';
import type { MediaData } from '../MediaEngine';
import type { PostMediaLinkData } from '../PostMediaEngine';

// ---------------------------------------------------------------------------
// Dependency contracts — injected at creation time, no hard engine coupling
// ---------------------------------------------------------------------------

export interface BlogToolDeps {
  postEngine: {
    getPost: (id: string) => Promise<PostData | null>;
    getPostBySlug: (slug: string) => Promise<PostData | null>;
    getAllPosts: (options?: PaginationOptions) => Promise<{ items: PostData[]; total: number }>;
    getPostsFiltered: (filter: PostFilter) => Promise<PostData[]>;
    searchPostsFiltered: (query: string, filter: PostFilter, pagination?: PaginationOptions) => Promise<{ posts: PostData[]; total: number }>;
    getCategoriesWithCounts: () => Promise<Array<{ category: string; count: number }>>;
    getTagsWithCounts: () => Promise<Array<{ tag: string; count: number }>>;
    getLinkedBy: (postId: string) => Promise<Array<{ id: string; title: string; slug: string }>>;
    getLinksTo: (postId: string) => Promise<Array<{ id: string; title: string; slug: string }>>;
    updatePost: (id: string, data: Partial<PostData>) => Promise<PostData | null>;
    getBlogStats: () => Promise<{
      totalPosts: number;
      draftCount: number;
      publishedCount: number;
      archivedCount: number;
      oldestPostDate: Date | null;
      newestPostDate: Date | null;
      postsPerYear: Record<number, number>;
      tagCount: number;
      categoryCount: number;
    }>;
    getDashboardStats: () => Promise<{ totalPosts: number; draftCount: number; publishedCount: number; archivedCount: number }>;
    getPostCounts: (groupBy: Array<'year' | 'month' | 'tag' | 'category' | 'status'>, filter?: { year?: number; month?: number; status?: string; category?: string; tags?: string[] }) => Promise<{ groups: Record<string, string | number>[]; totalPosts: number }>;
  };
  mediaEngine: {
    getMedia: (id: string) => Promise<MediaData | null>;
    getAllMedia: () => Promise<MediaData[]>;
    getMediaFiltered: (filter: { year?: number; month?: number; tags?: string[] }) => Promise<MediaData[]>;
    updateMedia: (id: string, data: Partial<MediaData>) => Promise<MediaData | null>;
    getThumbnailDataUrl: (mediaId: string, size: 'small' | 'medium' | 'large') => Promise<string | null>;
  };
  postMediaEngine: {
    getLinkedMediaDataForPost: (postId: string) => Promise<Array<PostMediaLinkData & { media: MediaData }>>;
    getLinkedPostsForMedia: (mediaId: string) => Promise<PostMediaLinkData[]>;
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Deps contract for link enrichment — narrow so MCPServer can also use it. */
export interface LinkEnrichmentDeps {
  getLinkedBy: (postId: string) => Promise<Array<{ id: string; title: string; slug: string }>>;
  getLinksTo: (postId: string) => Promise<Array<{ id: string; title: string; slug: string }>>;
}

/** Enrich posts with backlinks and outlinks. */
export async function enrichWithLinks<T extends { id: string }>(
  posts: T[],
  postEngine: LinkEnrichmentDeps,
): Promise<Array<T & { backlinks: Array<{ id: string; title: string; slug: string }>; linksTo: Array<{ id: string; title: string; slug: string }> }>> {
  return Promise.all(posts.map(async (p) => {
    const [backlinks, linksTo] = await Promise.all([
      postEngine.getLinkedBy(p.id),
      postEngine.getLinksTo(p.id),
    ]);
    return {
      ...p,
      backlinks: backlinks.map(b => ({ id: b.id, title: b.title, slug: b.slug })),
      linksTo: linksTo.map(l => ({ id: l.id, title: l.title, slug: l.slug })),
    };
  }));
}

/** Contract for ambiguity hint building — narrow so MCPServer can also use it. */
export interface AmbiguityHintDeps {
  getCategoriesWithCounts: () => Promise<Array<{ category: string; count: number }>>;
  getTagsWithCounts: () => Promise<Array<{ tag: string; count: number }>>;
}

/**
 * Build ambiguity hint strings when category/tag terms overlap across namespaces.
 * Shared by both AI SDK tools and MCPServer.
 */
export async function buildAmbiguityHints(
  postEngine: AmbiguityHintDeps,
  category: string | undefined,
  tags: string[] | undefined,
): Promise<string[]> {
  const hints: string[] = [];

  if (category) {
    const allTags = await postEngine.getTagsWithCounts();
    const tagMatch = allTags.find(t => t.tag.toLowerCase() === category.toLowerCase());
    if (tagMatch) {
      hints.push(`Note: "${category}" also exists as a tag (${tagMatch.count} post${tagMatch.count !== 1 ? 's' : ''}). Use the tags parameter to filter by tag instead.`);
    }
  }

  if (tags && tags.length > 0) {
    const allCats = await postEngine.getCategoriesWithCounts();
    for (const tag of tags) {
      const catMatch = allCats.find(c => c.category.toLowerCase() === tag.toLowerCase());
      if (catMatch) {
        hints.push(`Note: "${tag}" also exists as a category (${catMatch.count} post${catMatch.count !== 1 ? 's' : ''}). Use the category parameter to filter by category instead.`);
      }
    }
  }

  return hints;
}

/** Shared check_term logic — returns a plain result object. */
export async function executeCheckTerm(
  term: string,
  postEngine: AmbiguityHintDeps,
): Promise<{ term: string; asCategory: boolean; categoryPostCount: number; asTag: boolean; tagPostCount: number }> {
  const [categories, tags] = await Promise.all([
    postEngine.getCategoriesWithCounts(),
    postEngine.getTagsWithCounts(),
  ]);
  const termLower = term.toLowerCase();
  const catMatch = categories.find(c => c.category.toLowerCase() === termLower);
  const tagMatch = tags.find(t => t.tag.toLowerCase() === termLower);
  return {
    term,
    asCategory: !!catMatch,
    categoryPostCount: catMatch?.count ?? 0,
    asTag: !!tagMatch,
    tagPostCount: tagMatch?.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createBlogTools(deps: BlogToolDeps) {
  const { postEngine, mediaEngine, postMediaEngine } = deps;

  return {
    check_term: tool({
      description: 'Check whether a term exists as a category, tag, or both. Returns post counts for each. Use this before search_posts or list_posts when unsure whether a term is a category or tag.',
      inputSchema: z.object({
        term: z.string().describe('The term to look up'),
      }),
      execute: async ({ term }) => {
        const result = await executeCheckTerm(term, postEngine);
        return { success: true, ...result };
      },
    }),

    search_posts: tool({
      description: 'Search blog posts using full-text search. Can filter by category, tags, year, or month. Returns paginated results with totalMatches count. Use offset to page through results when totalMatches > limit. Use check_term first if unsure whether a term is a category or tag.',
      inputSchema: z.object({
        query: z.string().describe('The search query text to find in posts'),
        category: z.string().optional().describe('Optional category to filter by'),
        tags: z.array(z.string()).optional().describe('Optional array of tags to filter by (all must match)'),
        language: z.string().optional().describe('Require posts that are available in this language'),
        missingTranslationLanguage: z.string().optional().describe('Require posts that are missing this translation language'),
        year: z.number().optional().describe('Filter to posts created in this year'),
        month: z.number().optional().describe('Filter to posts created in this month (1-12). Requires year.'),
        limit: z.number().optional().describe('Maximum number of results to return (default: 10)'),
        offset: z.number().optional().describe('Offset for pagination (default: 0)'),
      }),
      execute: async ({ query, category, tags, language, missingTranslationLanguage, year, month, limit: lim, offset: off }) => {
        if (month !== undefined && year === undefined) {
          return { success: false, error: 'month requires year. Example: year: 2025, month: 3' };
        }

        const filter: PostFilter = {};
        if (category) filter.categories = [category];
        if (tags && tags.length > 0) filter.tags = tags;
        if (language) filter.language = language;
        if (missingTranslationLanguage) filter.missingTranslationLanguage = missingTranslationLanguage;
        if (year !== undefined) filter.year = year;
        if (month !== undefined && year !== undefined) filter.month = month;

        const offset = off ?? 0;
        const limit = lim ?? 10;

        const { posts: filteredPosts, total: totalMatches } = await postEngine.searchPostsFiltered(query, filter, { offset, limit });
        const hints = await buildAmbiguityHints(postEngine, category, tags);

        const posts = await enrichWithLinks(
          filteredPosts.map(p => ({
            id: p.id, title: p.title, slug: p.slug,
            excerpt: p.excerpt, status: p.status,
            categories: p.categories, tags: p.tags,
            availableLanguages: p.availableLanguages,
            createdAt: p.createdAt, updatedAt: p.updatedAt,
          })),
          postEngine,
        );

        const result: Record<string, unknown> = {
          success: true,
          count: posts.length,
          totalMatches,
          hasMore: offset + limit < totalMatches,
          offset,
          limit,
          posts,
        };
        if (hints.length > 0) result.hints = hints;
        return result;
      },
    }),

    read_post: tool({
      description: 'Read the full content and metadata of a specific blog post by its ID. Includes backlinks (posts linking to this post).',
      inputSchema: z.object({
        postId: z.string().describe('The unique ID of the post to read'),
      }),
      execute: async ({ postId }) => {
        const post = await postEngine.getPost(postId);
        if (!post) return { success: false, error: 'Post not found' };
        const [backlinks, linksTo] = await Promise.all([
          postEngine.getLinkedBy(post.id),
          postEngine.getLinksTo(post.id),
        ]);
        return {
          success: true,
          post: {
            id: post.id, title: post.title, slug: post.slug,
            content: post.content, excerpt: post.excerpt,
            status: post.status, author: post.author,
            categories: post.categories, tags: post.tags,
            availableLanguages: post.availableLanguages,
            createdAt: post.createdAt, updatedAt: post.updatedAt,
            publishedAt: post.publishedAt,
            backlinks: backlinks.map(b => ({ id: b.id, title: b.title, slug: b.slug })),
            linksTo: linksTo.map(l => ({ id: l.id, title: l.title, slug: l.slug })),
          },
        };
      },
    }),

    read_post_by_slug: tool({
      description: 'Read the full content and metadata of a specific blog post by its slug. Includes backlinks (posts linking to this post). Useful when you know the slug but not the ID.',
      inputSchema: z.object({
        slug: z.string().describe('The slug of the post to read'),
      }),
      execute: async ({ slug }) => {
        const post = await postEngine.getPostBySlug(slug);
        if (!post) return { success: false, error: 'Post not found' };
        const [backlinks, linksTo] = await Promise.all([
          postEngine.getLinkedBy(post.id),
          postEngine.getLinksTo(post.id),
        ]);
        return {
          success: true,
          post: {
            id: post.id, title: post.title, slug: post.slug,
            content: post.content, excerpt: post.excerpt,
            status: post.status, author: post.author,
            categories: post.categories, tags: post.tags,
            availableLanguages: post.availableLanguages,
            createdAt: post.createdAt, updatedAt: post.updatedAt,
            publishedAt: post.publishedAt,
            backlinks: backlinks.map(b => ({ id: b.id, title: b.title, slug: b.slug })),
            linksTo: linksTo.map(l => ({ id: l.id, title: l.title, slug: l.slug })),
          },
        };
      },
    }),

    list_posts: tool({
      description: 'List blog posts with optional filtering by status, category, tags, year, or month. Returns paginated results. Each post includes backlinks. The response includes "total" (global post count) and "filteredTotal" (count matching current filters). Use year/month filters to efficiently narrow to a time period. Use check_term first if unsure whether a term is a category or tag.',
      inputSchema: z.object({
        status: z.enum(['draft', 'published', 'archived']).optional().describe('Filter by post status'),
        category: z.string().optional().describe('Filter by category'),
        tags: z.array(z.string()).optional().describe('Filter by tags (posts must have all specified tags)'),
        language: z.string().optional().describe('Require posts that are available in this language'),
        missingTranslationLanguage: z.string().optional().describe('Require posts that are missing this translation language'),
        year: z.number().optional().describe('Filter to posts created in this year'),
        month: z.number().optional().describe('Filter to posts created in this month (1-12). Requires year.'),
        limit: z.number().optional().describe('Maximum number of results (default: 20)'),
        offset: z.number().optional().describe('Offset for pagination (default: 0)'),
      }),
      execute: async ({ status, category, tags, language, missingTranslationLanguage, year, month, limit: lim, offset: off }) => {
        if (month !== undefined && year === undefined) {
          return { success: false, error: 'month requires year. Example: year: 2025, month: 3' };
        }

        const filter: PostFilter = {};
        if (status) filter.status = status;
        if (tags) filter.tags = tags;
        if (category) filter.categories = [category];
        if (language) filter.language = language;
        if (missingTranslationLanguage) filter.missingTranslationLanguage = missingTranslationLanguage;
        if (year !== undefined) filter.year = year;
        if (month !== undefined && year !== undefined) filter.month = month;

        const offset = off ?? 0;
        const limit = lim ?? 20;

        const globalStats = await postEngine.getDashboardStats();
        const globalTotal = globalStats.totalPosts;

        let pageItems: PostData[];
        let filteredTotal: number;

        if (Object.keys(filter).length > 0) {
          const allFiltered = await postEngine.getPostsFiltered(filter);
          filteredTotal = allFiltered.length;
          pageItems = allFiltered.slice(offset, offset + limit);
        } else {
          const listResult = await postEngine.getAllPosts({ limit, offset });
          pageItems = listResult.items;
          filteredTotal = listResult.total;
        }

        const hints = await buildAmbiguityHints(postEngine, category, tags);

        const posts = await enrichWithLinks(
          pageItems.map(p => ({
            id: p.id, title: p.title, slug: p.slug,
            status: p.status, categories: p.categories,
            tags: p.tags, availableLanguages: p.availableLanguages, createdAt: p.createdAt, updatedAt: p.updatedAt,
          })),
          postEngine,
        );

        const result: Record<string, unknown> = {
          success: true,
          count: posts.length,
          total: globalTotal,
          filteredTotal,
          hasMore: offset + limit < filteredTotal,
          offset,
          limit,
          posts,
        };
        if (hints.length > 0) result.hints = hints;
        return result;
      },
    }),

    get_media: tool({
      description: 'Get information about a specific media file (image) by its ID.',
      inputSchema: z.object({
        mediaId: z.string().describe('The unique ID of the media file'),
      }),
      execute: async ({ mediaId }) => {
        const media = await mediaEngine.getMedia(mediaId);
        if (!media) return { success: false, error: 'Media not found' };
        return {
          success: true,
          media: {
            id: media.id, filename: media.filename,
            originalName: media.originalName, mimeType: media.mimeType,
            size: media.size, width: media.width, height: media.height,
            title: media.title, alt: media.alt, caption: media.caption, tags: media.tags,
            createdAt: media.createdAt, updatedAt: media.updatedAt,
          },
        };
      },
    }),

    list_media: tool({
      description: 'List media files in the current project with optional filtering by MIME type, year, month, or tags. Returns paginated results with total count.',
      inputSchema: z.object({
        mimeTypeFilter: z.string().optional().describe('Filter by MIME type prefix (e.g., "image/")'),
        tags: z.array(z.string()).optional().describe('Filter by tags (media must have all specified tags)'),
        year: z.number().optional().describe('Filter to media created in this year'),
        month: z.number().optional().describe('Filter to media created in this month (1-12). Requires year.'),
        limit: z.number().optional().describe('Maximum number of results (default: 20)'),
        offset: z.number().optional().describe('Offset for pagination (default: 0)'),
      }),
      execute: async ({ mimeTypeFilter, tags, year, month, limit: lim, offset: off }) => {
        if (month !== undefined && year === undefined) {
          return { success: false, error: 'month requires year. Example: year: 2025, month: 3' };
        }

        const hasMediaFilter = year !== undefined || (tags && tags.length > 0);
        let mediaList: MediaData[];

        if (hasMediaFilter) {
          const mediaFilter: { year?: number; month?: number; tags?: string[] } = {};
          if (year !== undefined) mediaFilter.year = year;
          if (month !== undefined && year !== undefined) mediaFilter.month = month;
          if (tags) mediaFilter.tags = tags;
          mediaList = await mediaEngine.getMediaFiltered(mediaFilter);
        } else {
          mediaList = await mediaEngine.getAllMedia();
        }

        const totalMedia = mediaList.length;
        if (mimeTypeFilter) {
          mediaList = mediaList.filter(m => m.mimeType.startsWith(mimeTypeFilter));
        }
        const filteredTotal = mediaList.length;
        const offset = off ?? 0;
        const limit = lim ?? 20;
        const pageItems = mediaList.slice(offset, offset + limit);
        return {
          success: true,
          count: pageItems.length,
          total: totalMedia,
          filteredTotal,
          hasMore: offset + limit < filteredTotal,
          offset,
          limit,
          media: pageItems.map(m => ({
            id: m.id, filename: m.filename,
            originalName: m.originalName, mimeType: m.mimeType,
            title: m.title, alt: m.alt, tags: m.tags,
          })),
        };
      },
    }),

    update_post_metadata: tool({
      description: 'Update metadata for a blog post (title, excerpt, tags, categories). Does NOT update post content.',
      inputSchema: z.object({
        postId: z.string().describe('The unique ID of the post to update'),
        title: z.string().optional().describe('New title for the post'),
        excerpt: z.string().optional().describe('New excerpt/summary for the post'),
        tags: z.array(z.string()).optional().describe('New tags for the post'),
        categories: z.array(z.string()).optional().describe('New categories for the post'),
      }),
      execute: async ({ postId, title, excerpt, tags, categories }) => {
        const updates: Record<string, unknown> = {};
        if (title !== undefined) updates.title = title;
        if (excerpt !== undefined) updates.excerpt = excerpt;
        if (tags !== undefined) updates.tags = tags;
        if (categories !== undefined) updates.categories = categories;

        if (Object.keys(updates).length === 0) {
          return { success: false, error: 'No updates provided' };
        }

        await postEngine.updatePost(postId, updates);
        return { success: true, message: `Post ${postId} metadata updated successfully` };
      },
    }),

    update_media_metadata: tool({
      description: 'Update metadata for a media file (title, alt text, caption, tags).',
      inputSchema: z.object({
        mediaId: z.string().describe('The unique ID of the media to update'),
        title: z.string().optional().describe('New title for display in lists and search results'),
        alt: z.string().optional().describe('New alt text for the image'),
        caption: z.string().optional().describe('New caption for the image'),
        tags: z.array(z.string()).optional().describe('New tags for the media'),
      }),
      execute: async ({ mediaId, title, alt, caption, tags }) => {
        const updates: Record<string, unknown> = {};
        if (title !== undefined) updates.title = title;
        if (alt !== undefined) updates.alt = alt;
        if (caption !== undefined) updates.caption = caption;
        if (tags !== undefined) updates.tags = tags;

        if (Object.keys(updates).length === 0) {
          return { success: false, error: 'No updates provided' };
        }

        await mediaEngine.updateMedia(mediaId, updates);
        return { success: true, message: `Media ${mediaId} metadata updated successfully` };
      },
    }),

    list_tags: tool({
      description: 'List all tags used across blog posts, with the count of posts using each tag.',
      inputSchema: z.object({}),
      execute: async () => {
        const tagsWithCounts = await postEngine.getTagsWithCounts();
        return {
          success: true,
          count: tagsWithCounts.length,
          tags: tagsWithCounts,
        };
      },
    }),

    count_posts: tool({
      description: 'Count posts grouped by one or more dimensions (year, month, tag, category, status). Returns aggregated counts without transferring full post data. Ideal for analytics, heat maps, and distribution overviews. Example: groupBy=["month","tag"] with year=2004 returns post counts per month per tag.',
      inputSchema: z.object({
        groupBy: z.array(z.enum(['year', 'month', 'tag', 'category', 'status'])).describe('Dimensions to group by (1-3 recommended)'),
        year: z.number().optional().describe('Filter to posts in this year'),
        month: z.number().optional().describe('Filter to posts in this month (1-12). Requires year.'),
        status: z.enum(['draft', 'published', 'archived']).optional().describe('Filter by status'),
        category: z.string().optional().describe('Filter by category'),
        tags: z.array(z.string()).optional().describe('Filter by tags (all must match)'),
      }),
      execute: async ({ groupBy, year, month, status, category, tags }) => {
        if (month !== undefined && year === undefined) {
          return { success: false, error: 'month requires year. Example: year: 2025, month: 3' };
        }
        const filter: { year?: number; month?: number; status?: string; category?: string; tags?: string[] } = {};
        if (year !== undefined) filter.year = year;
        if (month !== undefined) filter.month = month;
        if (status) filter.status = status;
        if (category) filter.category = category;
        if (tags && tags.length > 0) filter.tags = tags;

        const result = await postEngine.getPostCounts(groupBy, Object.keys(filter).length > 0 ? filter : undefined);
        return {
          success: true,
          groupCount: result.groups.length,
          totalPosts: result.totalPosts,
          groups: result.groups,
        };
      },
    }),

    list_categories: tool({
      description: 'List all categories used across blog posts, with the count of posts in each category.',
      inputSchema: z.object({}),
      execute: async () => {
        const categoriesWithCounts = await postEngine.getCategoriesWithCounts();
        return {
          success: true,
          count: categoriesWithCounts.length,
          categories: categoriesWithCounts,
        };
      },
    }),

    get_blog_stats: tool({
      description: 'Get comprehensive blog statistics: total posts, drafts, published, archived counts, date range, posts per year breakdown, unique tags/categories counts, and total media count. Use this FIRST to understand the full scope of the blog before making queries.',
      inputSchema: z.object({}),
      execute: async () => {
        const stats = await postEngine.getBlogStats();
        const mediaList = await mediaEngine.getAllMedia();
        return {
          success: true,
          totalPosts: stats.totalPosts,
          draftCount: stats.draftCount,
          publishedCount: stats.publishedCount,
          archivedCount: stats.archivedCount,
          dateRange: stats.oldestPostDate && stats.newestPostDate
            ? { oldest: stats.oldestPostDate, newest: stats.newestPostDate }
            : null,
          postsPerYear: stats.postsPerYear,
          tagCount: stats.tagCount,
          categoryCount: stats.categoryCount,
          totalMedia: mediaList.length,
        };
      },
    }),

    view_image: tool({
      description: 'View an image to analyze its visual content. Returns the actual image for visual inspection. Only works with image files (not PDFs or other media types).',
      inputSchema: z.object({
        mediaId: z.string().describe('The unique ID of the image to view'),
        size: z.enum(['small', 'medium', 'large']).optional().describe('Image size: small (150px), medium (400px, default), large (800px)'),
      }),
      execute: async ({ mediaId, size: sizeArg }) => {
        const size = sizeArg ?? 'medium';
        const mediaItem = await mediaEngine.getMedia(mediaId);
        if (!mediaItem) {
          return { success: false, error: 'Image not found' };
        }
        if (!mediaItem.mimeType.startsWith('image/')) {
          return { success: false, error: `Cannot view this file type: ${mediaItem.mimeType}. Only images are supported.` };
        }
        const dataUrl = await mediaEngine.getThumbnailDataUrl(mediaId, size);
        if (!dataUrl) {
          return { success: false, error: 'Thumbnail not available. Try regenerating thumbnails from Settings.' };
        }
        const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        return {
          __isImageResult: true,
          success: true,
          mediaType: 'image/webp',
          base64: base64Data,
          metadata: {
            id: mediaItem.id,
            filename: mediaItem.filename,
            originalName: mediaItem.originalName,
            width: mediaItem.width,
            height: mediaItem.height,
            title: mediaItem.title,
            alt: mediaItem.alt,
            caption: mediaItem.caption,
            size,
          },
        };
      },
    }),

    get_post_backlinks: tool({
      description: 'Get all posts that link TO a specific post (backlinks/inbound links). Helpful for understanding how content is interconnected.',
      inputSchema: z.object({
        postId: z.string().describe('The ID of the post to find backlinks for'),
      }),
      execute: async ({ postId }) => {
        const linkedBy = await postEngine.getLinkedBy(postId);
        return {
          success: true,
          postId,
          count: linkedBy.length,
          linkedBy: linkedBy.map(p => ({ id: p.id, title: p.title, slug: p.slug })),
        };
      },
    }),

    get_post_outlinks: tool({
      description: 'Get all posts that a specific post links TO (outbound links). Helpful for understanding content relationships.',
      inputSchema: z.object({
        postId: z.string().describe('The ID of the post to find outbound links for'),
      }),
      execute: async ({ postId }) => {
        const linksTo = await postEngine.getLinksTo(postId);
        return {
          success: true,
          postId,
          count: linksTo.length,
          linksTo: linksTo.map(p => ({ id: p.id, title: p.title, slug: p.slug })),
        };
      },
    }),

    get_post_media: tool({
      description: 'Get all media files linked to a specific post. Returns media explicitly associated with the post (featured images, galleries, etc.).',
      inputSchema: z.object({
        postId: z.string().describe('The ID of the post to get linked media for'),
      }),
      execute: async ({ postId }) => {
        const linkedMedia = await postMediaEngine.getLinkedMediaDataForPost(postId);
        return {
          success: true,
          postId,
          count: linkedMedia.length,
          media: linkedMedia.map(link => ({
            id: link.media.id,
            filename: link.media.filename,
            originalName: link.media.originalName,
            mimeType: link.media.mimeType,
            title: link.media.title,
            alt: link.media.alt,
            caption: link.media.caption,
            width: link.media.width,
            height: link.media.height,
            sortOrder: link.sortOrder,
          })),
        };
      },
    }),

    get_media_posts: tool({
      description: 'Get all posts that a specific media file is linked to. Helpful for understanding media usage across posts.',
      inputSchema: z.object({
        mediaId: z.string().describe('The ID of the media file to find linked posts for'),
      }),
      execute: async ({ mediaId }) => {
        const linkedPosts = await postMediaEngine.getLinkedPostsForMedia(mediaId);
        const postsData = await Promise.all(
          linkedPosts.map(async (link) => {
            const post = await postEngine.getPost(link.postId);
            return post ? { id: post.id, title: post.title, slug: post.slug, status: post.status } : null;
          }),
        );
        const validPosts = postsData.filter(p => p !== null);
        return {
          success: true,
          mediaId,
          count: validPosts.length,
          posts: validPosts,
        };
      },
    }),
  };
}

/** The return type of createBlogTools — useful for typing tool maps. */
export type BlogTools = ReturnType<typeof createBlogTools>;
