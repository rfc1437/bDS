import type { EngineBundle } from '../engine/EngineBundle';

type SafeHandle = (channel: string, handler: (...args: any[]) => Promise<any>) => void;

export function registerEmbeddingHandlers(safeHandle: SafeHandle, bundle: EngineBundle): void {
  const engine = () => bundle.embeddingEngine;

  safeHandle('embeddings:findSimilar', async (_, postId: string, k?: number) => {
    return engine().findSimilar(postId, k);
  });

  safeHandle('embeddings:getProgress', async () => {
    return engine().getIndexingProgress();
  });

  safeHandle('embeddings:suggestTags', async (_, postId: string, excludeTags: string[]) => {
    return engine().suggestTags(postId, excludeTags ?? []);
  });

  safeHandle('embeddings:findDuplicates', async (_, threshold?: number) => {
    return engine().findDuplicates(threshold);
  });

  safeHandle('embeddings:dismissPair', async (_, postIdA: string, postIdB: string) => {
    return engine().dismissPair(postIdA, postIdB);
  });

  safeHandle('embeddings:indexUnindexedPosts', async () => {
    const taskId = `embedding-index-${Date.now()}`;
    return bundle.taskManager.runTask({
      id: taskId,
      name: 'Indexing posts for semantic search',
      execute: async (onProgress) => {
        await engine().indexUnindexedPosts((indexed, total) => {
          const pct = total > 0 ? (indexed / total) * 100 : 0;
          onProgress(pct, `Indexed ${indexed}/${total} posts`);
        });
        return engine().getIndexingProgress();
      },
    });
  });
}
