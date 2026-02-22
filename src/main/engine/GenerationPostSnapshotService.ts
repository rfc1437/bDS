import type { PostData } from './PostEngine';

export interface GenerationSnapshotPostEngine {
  getPostsFiltered: (filter: { status?: 'draft' | 'published' | 'archived'; excludeCategories?: string[] }) => Promise<PostData[]>;
  getPublishedVersion: (id: string) => Promise<PostData | null>;
}

export interface GenerationPublishedSets {
  publishedPosts: PostData[];
  publishedListPosts: PostData[];
}

export async function loadPublishedGenerationSets(
  postEngine: GenerationSnapshotPostEngine,
  listExcludedCategories: string[],
): Promise<GenerationPublishedSets> {
  const publishedCandidates = await postEngine.getPostsFiltered({ status: 'published' });
  const draftCandidates = await postEngine.getPostsFiltered({ status: 'draft' });
  const publishedListCandidates = await postEngine.getPostsFiltered({
    status: 'published',
    excludeCategories: listExcludedCategories,
  });
  const draftListCandidates = await postEngine.getPostsFiltered({
    status: 'draft',
    excludeCategories: listExcludedCategories,
  });

  const publishedSnapshots = await Promise.all(
    publishedCandidates.map(async (post) => {
      const snapshot = await postEngine.getPublishedVersion(post.id);
      return snapshot || post;
    }),
  );
  const draftPublishedSnapshots = await Promise.all(
    draftCandidates.map(async (post) => postEngine.getPublishedVersion(post.id)),
  );
  const publishedListSnapshots = await Promise.all(
    publishedListCandidates.map(async (post) => {
      const snapshot = await postEngine.getPublishedVersion(post.id);
      return snapshot || post;
    }),
  );
  const draftListPublishedSnapshots = await Promise.all(
    draftListCandidates.map(async (post) => postEngine.getPublishedVersion(post.id)),
  );

  const publishedPostById = new Map<string, PostData>();
  for (const post of publishedSnapshots) {
    publishedPostById.set(post.id, post);
  }
  for (const snapshot of draftPublishedSnapshots) {
    if (snapshot) {
      publishedPostById.set(snapshot.id, snapshot);
    }
  }

  const publishedListPostById = new Map<string, PostData>();
  for (const post of publishedListSnapshots) {
    publishedListPostById.set(post.id, post);
  }
  for (const snapshot of draftListPublishedSnapshots) {
    if (snapshot) {
      publishedListPostById.set(snapshot.id, snapshot);
    }
  }

  return {
    publishedPosts: Array.from(publishedPostById.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    publishedListPosts: Array.from(publishedListPostById.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  };
}
