import type { PostData } from './PostEngine';

export interface GenerationSnapshotPostEngine {
  getPostsFiltered: (filter: { status?: 'draft' | 'published' | 'archived'; excludeCategories?: string[] }) => Promise<PostData[]>;
  getPublishedVersion: (id: string) => Promise<PostData | null>;
  getPublishedVersionsBulk?: (ids: string[]) => Promise<Map<string, PostData>>;
}

export interface GenerationPublishedSets {
  publishedPosts: PostData[];
  publishedListPosts: PostData[];
}

async function resolvePublishedVersions(
  postEngine: GenerationSnapshotPostEngine,
  ids: string[],
): Promise<Map<string, PostData>> {
  if (ids.length === 0) {
    return new Map();
  }

  if (postEngine.getPublishedVersionsBulk) {
    return postEngine.getPublishedVersionsBulk(ids);
  }

  const result = new Map<string, PostData>();
  const entries = await Promise.all(
    ids.map(async (id) => {
      const version = await postEngine.getPublishedVersion(id);
      return { id, version };
    }),
  );
  for (const { id, version } of entries) {
    if (version) {
      result.set(id, version);
    }
  }
  return result;
}

export async function loadPublishedGenerationSets(
  postEngine: GenerationSnapshotPostEngine,
  listExcludedCategories: string[],
): Promise<GenerationPublishedSets> {
  const publishedCandidates = await postEngine.getPostsFiltered({ status: 'published' });
  const draftCandidates = await postEngine.getPostsFiltered({ status: 'draft' });

  const allIds = new Set<string>();
  for (const p of publishedCandidates) {
    allIds.add(p.id);
  }
  for (const p of draftCandidates) {
    allIds.add(p.id);
  }

  const publishedVersions = await resolvePublishedVersions(postEngine, Array.from(allIds));

  const excludedCategorySet = new Set(listExcludedCategories);
  const isListExcluded = (post: PostData) =>
    excludedCategorySet.size > 0 && post.categories.some((c) => excludedCategorySet.has(c));

  const publishedPostById = new Map<string, PostData>();
  const publishedListPostById = new Map<string, PostData>();

  for (const post of publishedCandidates) {
    const snapshot = publishedVersions.get(post.id) || post;
    publishedPostById.set(post.id, snapshot);
    if (!isListExcluded(post)) {
      publishedListPostById.set(post.id, snapshot);
    }
  }

  for (const post of draftCandidates) {
    const snapshot = publishedVersions.get(post.id);
    if (snapshot) {
      publishedPostById.set(post.id, snapshot);
      if (!isListExcluded(post)) {
        publishedListPostById.set(post.id, snapshot);
      }
    }
  }

  return {
    publishedPosts: Array.from(publishedPostById.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    publishedListPosts: Array.from(publishedListPostById.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  };
}
