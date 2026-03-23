/**
 * Lightweight, in-memory engine implementations for use in worker threads.
 *
 * These replace the real PostEngine / MediaEngine / PostMediaEngine when running
 * inside a generation worker. They are backed entirely by pre-loaded data arrays
 * so no database access is needed for post/media queries.
 */
import type { PostData, PostFilter, PostTranslationData } from './PostEngine';
import type { PublishedTranslationVariant } from './BlogGenerationEngine';
import type { MediaData } from './MediaEngine';
import { readPostFile } from './postFileUtils';
import { readPostTranslationFile } from './postTranslationFileUtils';

// ---------------------------------------------------------------------------
// DataBackedPostEngine
// ---------------------------------------------------------------------------

export interface DataBackedPostEngineInit {
  /** All posts (published snapshots + translation variants). */
  allPosts: PostData[];
  /** Pre-resolved backlinks: postId → linking posts. */
  backlinksMap?: Map<
    string,
    Array<{ id: string; title: string; slug: string }>
  >;
  /** Post file paths for lazy content loading from filesystem: postId → absoluteFilePath. */
  postFilePaths?: Map<string, string>;
}

export interface DataBackedPostEngineContract {
  getPostsFiltered: (filter: PostFilter) => Promise<PostData[]>;
  getPublishedVersion: (id: string) => Promise<PostData | null>;
  getPost: (id: string) => Promise<PostData | null>;
  hasPublishedVersion: (id: string) => Promise<boolean>;
  findPublishedBySlug: (
    slug: string,
    dateFilter?: { year: number; month: number },
  ) => Promise<PostData | null>;
  getLinkedBy: (
    postId: string,
  ) => Promise<Array<{ id: string; title: string; slug: string }>>;
  getAllBacklinks: () => Promise<
    Map<string, Array<{ id: string; title: string; slug: string }>>
  >;
  getPostTranslation: (
    postId: string,
    language: string,
  ) => Promise<PostTranslationData | null>;
  getPostTranslations: (postId: string) => Promise<PostTranslationData[]>;
  setProjectContext: (projectId: string, dataDir?: string) => void;
}

export function createDataBackedPostEngine(
  init: DataBackedPostEngineInit,
): DataBackedPostEngineContract {
  const { allPosts, backlinksMap, postFilePaths } = init;

  // Build indexes for fast lookups
  const byId = new Map<string, PostData>();
  const bySlug = new Map<string, PostData[]>();
  for (const post of allPosts) {
    byId.set(post.id, post);
    const slugEntries = bySlug.get(post.slug);
    if (slugEntries) {
      slugEntries.push(post);
    } else {
      bySlug.set(post.slug, [post]);
    }
  }

  function matchesFilter(post: PostData, filter: PostFilter): boolean {
    if (filter.status && post.status !== filter.status) {
      return false;
    }

    if (filter.excludeCategories && filter.excludeCategories.length > 0) {
      const excluded = new Set(filter.excludeCategories);
      if (post.categories.some((c) => excluded.has(c))) {
        return false;
      }
    }

    if (filter.categories && filter.categories.length > 0) {
      if (!filter.categories.some((c) => post.categories.includes(c)))
      {return false;}
    }

    if (filter.tags && filter.tags.length > 0) {
      if (!filter.tags.every((t) => post.tags.includes(t))) {
        return false;
      }
    }

    if (filter.language && post.language !== filter.language) {
      return false;
    }

    if (filter.year !== undefined) {
      if (post.createdAt.getFullYear() !== filter.year) {
        return false;
      }
    }

    if (filter.month !== undefined) {
      if (post.createdAt.getMonth() + 1 !== filter.month) {
        return false;
      }
    }

    if (filter.startDate) {
      if (post.createdAt < filter.startDate) {
        return false;
      }
    }

    if (filter.endDate) {
      if (post.createdAt > filter.endDate) {
        return false;
      }
    }

    return true;
  }

  // Shared lazy content loader for posts with empty content
  async function lazyLoadContent(post: PostData): Promise<void> {
    if (post.content || !postFilePaths) {
      return;
    }
    const variant = post as PostData & { translationFilePath?: string };
    if (variant.translationFilePath) {
      const fileData = await readPostTranslationFile(
        variant.translationFilePath,
      );
      if (fileData) {
        post.content = fileData.content;
      }
    } else {
      const filePath = postFilePaths.get(post.id);
      if (filePath) {
        const fileData = await readPostFile(filePath);
        if (fileData) {
          post.content = fileData.content;
        }
      }
    }
  }

  return {
    async getPostsFiltered(filter: PostFilter): Promise<PostData[]> {
      const filtered = allPosts
        .filter((post) => {
          const tss = (post as PublishedTranslationVariant)
            .translationSourceSlug;
          // Keep canonical posts and resolved posts (slug === tss).
          // Exclude translation variant route posts (slug !== tss, e.g. "my-post.en").
          return !tss || post.slug === tss;
        })
        .filter((post) => matchesFilter(post, filter))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // Lazy-load content for posts that need it (e.g. resolved translation posts
      // have content: '' and need their translation file content loaded).
      await Promise.all(filtered.map((post) => lazyLoadContent(post)));

      return filtered;
    },

    async getPublishedVersion(id: string): Promise<PostData | null> {
      const post = byId.get(id);
      if (!post) {
        return null;
      }

      await lazyLoadContent(post);

      return post;
    },

    async getPost(id: string): Promise<PostData | null> {
      const post = byId.get(id) ?? null;
      if (post) {
        await lazyLoadContent(post);
      }
      return post;
    },

    async hasPublishedVersion(id: string): Promise<boolean> {
      return byId.has(id);
    },

    async findPublishedBySlug(
      slug: string,
      dateFilter?: { year: number; month: number },
    ): Promise<PostData | null> {
      const candidates = bySlug.get(slug);
      if (!candidates || candidates.length === 0) {
        return null;
      }

      if (!dateFilter) {
        return candidates[0];
      }

      return (
        candidates.find(
          (p) =>
            p.createdAt.getFullYear() === dateFilter.year &&
            p.createdAt.getMonth() === dateFilter.month - 1,
        ) ?? null
      );
    },

    async getLinkedBy(
      postId: string,
    ): Promise<Array<{ id: string; title: string; slug: string }>> {
      return backlinksMap?.get(postId) ?? [];
    },

    async getAllBacklinks(): Promise<
      Map<string, Array<{ id: string; title: string; slug: string }>>
      > {
      return backlinksMap ?? new Map();
    },

    async getPostTranslation(
      postId: string,
      language: string,
    ): Promise<PostTranslationData | null> {
      void postId;
      void language;
      // Translation variants are already included as separate route posts
      return null;
    },

    async getPostTranslations(postId: string): Promise<PostTranslationData[]> {
      void postId;
      return [];
    },

    setProjectContext(projectId: string, dataDir?: string): void {
      void projectId;
      void dataDir;
      // No-op — data is already loaded
    },
  };
}

// ---------------------------------------------------------------------------
// DataBackedMediaEngine
// ---------------------------------------------------------------------------

export interface DataBackedMediaEngineContract {
  getAllMedia: () => Promise<MediaData[]>;
  setProjectContext: (
    projectId: string,
    dataDir?: string,
    internalDir?: string,
  ) => void;
}

export function createDataBackedMediaEngine(
  mediaItems: MediaData[],
): DataBackedMediaEngineContract {
  return {
    async getAllMedia() {
      return mediaItems;
    },
    setProjectContext(
      projectId: string,
      dataDir?: string,
      internalDir?: string,
    ): void {
      void projectId;
      void dataDir;
      void internalDir;
      // No-op
    },
  };
}

// ---------------------------------------------------------------------------
// DataBackedPostMediaEngine
// ---------------------------------------------------------------------------

export interface DataBackedPostMediaEngineInit {
  mediaItems: MediaData[];
  postMediaLinks: Map<string, Array<{ mediaId: string; sortOrder: number }>>;
}

export interface DataBackedPostMediaEngineContract {
  setProjectContext: (projectId: string) => void;
  getLinkedMediaForPost: (
    postId: string,
  ) => Promise<Array<{ mediaId: string; sortOrder: number }>>;
  getLinkedMediaDataForPost: (
    postId: string,
  ) => Promise<Array<{ media: MediaData }>>;
}

export function createDataBackedPostMediaEngine(
  init: DataBackedPostMediaEngineInit,
): DataBackedPostMediaEngineContract {
  const { mediaItems, postMediaLinks } = init;
  const mediaById = new Map<string, MediaData>();
  for (const m of mediaItems) {
    mediaById.set(m.id, m);
  }

  return {
    setProjectContext(projectId: string): void {
      void projectId;
      // No-op
    },
    async getLinkedMediaForPost(
      postId: string,
    ): Promise<Array<{ mediaId: string; sortOrder: number }>> {
      return postMediaLinks.get(postId) ?? [];
    },
    async getLinkedMediaDataForPost(
      postId: string,
    ): Promise<Array<{ media: MediaData }>> {
      const links = postMediaLinks.get(postId) ?? [];
      const result: Array<{ media: MediaData }> = [];
      for (const link of links) {
        const media = mediaById.get(link.mediaId);
        if (media) {
          result.push({ media });
        }
      }
      return result;
    },
  };
}
