import type { PostData, PostFilter, PostTranslationData } from './PostEngine';

export interface SharedSnapshotPostEngine {
  getPostsFiltered: (filter: PostFilter) => Promise<PostData[]>;
  getPost: (id: string) => Promise<PostData | null>;
  getPublishedVersion: (id: string) => Promise<PostData | null>;
  getPostTranslation?: (postId: string, language: string) => Promise<PostTranslationData | null>;
  findPublishedBySlug?: (slug: string, dateFilter?: { year: number; month: number }) => Promise<PostData | null>;
}

interface SinglePostPreviewOptions {
  useDraftContent?: boolean;
  draftPostId?: string;
  lang?: string;
  preferredLanguage?: string;
}

function buildSnapshotBaseFilter(filter: PostFilter): PostFilter {
  const baseFilter: PostFilter = {};

  if (filter.startDate) {
    baseFilter.startDate = filter.startDate;
  }
  if (filter.endDate) {
    baseFilter.endDate = filter.endDate;
  }
  if (filter.year !== undefined) {
    baseFilter.year = filter.year;
  }
  if (filter.month !== undefined) {
    baseFilter.month = filter.month;
  }

  return baseFilter;
}

async function toPublishedSnapshot(postEngine: SharedSnapshotPostEngine, post: PostData): Promise<PostData | null> {
  if (post.status === 'published') {
    return post;
  }

  if (post.status === 'draft') {
    return await postEngine.getPublishedVersion(post.id);
  }

  return null;
}

function paginateSnapshots(
  snapshots: PostData[],
  pagination?: { maxPostsPerPage: number; page?: number; excludeCategories?: string[] },
): { posts: PostData[]; totalPosts: number } {
  const totalPosts = snapshots.length;

  if (typeof pagination?.maxPostsPerPage !== 'number') {
    return { posts: snapshots, totalPosts };
  }

  const maxPostsPerPage = pagination.maxPostsPerPage;
  const page = Number.isInteger(pagination.page) && (pagination.page ?? 0) > 0
    ? (pagination.page as number)
    : 1;
  const offset = (page - 1) * maxPostsPerPage;

  return {
    posts: snapshots.slice(offset, offset + maxPostsPerPage),
    totalPosts,
  };
}

export async function loadPublishedSnapshotsPage(
  postEngine: SharedSnapshotPostEngine,
  filter: PostFilter,
  pagination?: { maxPostsPerPage: number; page?: number; excludeCategories?: string[] },
): Promise<{ posts: PostData[]; totalPosts: number }> {
  if (filter.status && filter.status !== 'published') {
    return { posts: [], totalPosts: 0 };
  }

  const baseFilter = buildSnapshotBaseFilter(filter);
  const publishedCandidates = await postEngine.getPostsFiltered({
    ...baseFilter,
    status: 'published',
    excludeCategories: filter.excludeCategories,
  });
  const draftCandidates = await postEngine.getPostsFiltered({
    ...baseFilter,
    status: 'draft',
    excludeCategories: filter.excludeCategories,
  });

  const snapshotCandidates = await Promise.all([
    ...publishedCandidates.map((post) => toPublishedSnapshot(postEngine, post)),
    ...draftCandidates.map((post) => toPublishedSnapshot(postEngine, post)),
  ]);

  let snapshots = snapshotCandidates.filter((post): post is PostData => post !== null);

  if (filter.tags && filter.tags.length > 0) {
    const { tags } = filter;
    snapshots = snapshots.filter((post) => tags.every((tag) => post.tags.includes(tag)));
  }

  if (filter.categories && filter.categories.length > 0) {
    const { categories } = filter;
    snapshots = snapshots.filter((post) => categories.some((category) => post.categories.includes(category)));
  }

  snapshots.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return paginateSnapshots(snapshots, pagination);
}

export async function loadPublishedSnapshots(
  postEngine: SharedSnapshotPostEngine,
  filter: PostFilter,
  pagination?: { maxPostsPerPage: number; page?: number; excludeCategories?: string[] },
): Promise<PostData[]> {
  const result = await loadPublishedSnapshotsPage(postEngine, filter, pagination);
  return result.posts;
}

export async function loadPostsForDayPage(
  postEngine: SharedSnapshotPostEngine,
  year: number,
  month: number,
  day: number,
  pagination?: { maxPostsPerPage: number; page?: number; excludeCategories?: string[] },
): Promise<{ posts: PostData[]; totalPosts: number }> {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { posts: [], totalPosts: 0 };
  }

  const startDate = new Date(year, month - 1, day, 0, 0, 0, 0);
  const endDate = new Date(year, month - 1, day, 23, 59, 59, 999);

  const result = await loadPublishedSnapshotsPage(
    postEngine,
    {
      status: 'published',
      excludeCategories: pagination?.excludeCategories,
      startDate,
      endDate,
    },
    pagination,
  );

  const posts = result.posts.filter((post) => {
    const createdAt = post.createdAt;
    return createdAt.getFullYear() === year
      && createdAt.getMonth() === month - 1
      && createdAt.getDate() === day;
  });

  return {
    posts,
    totalPosts: result.totalPosts,
  };
}

export async function findPublishedPostBySlug(
  postEngine: SharedSnapshotPostEngine,
  slug: string,
  dateFilter?: { year: number; month: number },
): Promise<PostData | null> {
  if (!slug) {
    return null;
  }

  if (postEngine.findPublishedBySlug) {
    const directMatch = await postEngine.findPublishedBySlug(slug, dateFilter);
    if (directMatch) {
      return directMatch;
    }
  }

  const filter: PostFilter = {
    ...(dateFilter ? { year: dateFilter.year, month: dateFilter.month } : {}),
  };

  const candidates = await loadPublishedSnapshots(postEngine, filter);
  const match = candidates.find((candidate) => candidate.slug === slug);
  return match ?? null;
}

export async function findSinglePostBySlug(
  postEngine: SharedSnapshotPostEngine,
  slug: string,
  singlePostOptions?: SinglePostPreviewOptions,
  dateFilter?: { year: number; month: number; day?: number },
): Promise<PostData | null> {
  let resolvedPost: PostData | null = null;

  if (singlePostOptions?.useDraftContent && singlePostOptions.draftPostId) {
    const draftCandidate = await postEngine.getPost(singlePostOptions.draftPostId);
    if (draftCandidate && draftCandidate.status === 'draft' && draftCandidate.slug === slug) {
      if (!dateFilter) {
        resolvedPost = draftCandidate;
      } else {
        const sameYear = draftCandidate.createdAt.getFullYear() === dateFilter.year;
        const sameMonth = draftCandidate.createdAt.getMonth() === dateFilter.month - 1;
        const sameDay = dateFilter.day === undefined || draftCandidate.createdAt.getDate() === dateFilter.day;
        if (sameYear && sameMonth && sameDay) {
          resolvedPost = draftCandidate;
        }
      }
    }
  }

  if (!resolvedPost) {
    const fallbackDateFilter = dateFilter ? { year: dateFilter.year, month: dateFilter.month } : undefined;
    resolvedPost = await findPublishedPostBySlug(postEngine, slug, fallbackDateFilter);
  }

  if (!resolvedPost) {
    return null;
  }

  const requestedLanguage = (singlePostOptions?.lang ?? singlePostOptions?.preferredLanguage)?.trim().toLowerCase();
  if (!requestedLanguage || requestedLanguage === (resolvedPost.language || '').trim().toLowerCase() || !postEngine.getPostTranslation) {
    return resolvedPost;
  }

  const translation = await postEngine.getPostTranslation(resolvedPost.id, requestedLanguage);
  if (!translation) {
    return resolvedPost;
  }

  const availableLanguages = Array.from(new Set([
    ...((Array.isArray(resolvedPost.availableLanguages) ? resolvedPost.availableLanguages : [])),
    requestedLanguage,
    (resolvedPost.language || '').trim(),
  ].filter((language): language is string => typeof language === 'string' && language.length > 0)));

  return {
    ...resolvedPost,
    id: translation.id,
    slug: `${resolvedPost.slug}.${translation.language}`,
    title: translation.title,
    excerpt: translation.excerpt,
    content: translation.content,
    language: translation.language,
    updatedAt: translation.updatedAt,
    publishedAt: translation.publishedAt ?? resolvedPost.publishedAt,
    availableLanguages,
    translationSourceSlug: resolvedPost.slug,
    translationCanonicalLanguage: resolvedPost.language,
  } as PostData;
}
