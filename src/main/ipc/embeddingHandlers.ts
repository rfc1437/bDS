import type { EngineBundle } from '../engine/EngineBundle';
import { startDuplicateSearchTask } from './handlers';
import { resolveUiLanguageFromSystemLocale, translateMenu } from '../shared/i18n';
import { app } from 'electron';

type SafeHandle = (channel: string, handler: (...args: any[]) => Promise<any>) => void;

function tr(key: string): string {
  const systemLocale = typeof app.getLocale === 'function' ? app.getLocale() : 'en';
  const lang = resolveUiLanguageFromSystemLocale(systemLocale);
  return translateMenu(lang, key);
}

export function registerEmbeddingHandlers(safeHandle: SafeHandle, bundle: EngineBundle): void {
  const engine = () => bundle.embeddingEngine;

  safeHandle('embeddings:findSimilar', async (_, postId: string, k?: number) => {
    return engine().findSimilar(postId, k);
  });

  safeHandle('embeddings:computeSimilarities', async (_, sourcePostId: string, targetPostIds: string[]) => {
    return engine().computeSimilarities(sourcePostId, targetPostIds);
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

  safeHandle('embeddings:dismissPairs', async (_, pairIds: Array<[string, string]>) => {
    return engine().dismissPairs(pairIds);
  });

  safeHandle('embeddings:runDuplicateSearch', async (_, threshold?: number) => {
    startDuplicateSearchTask(bundle, threshold ?? 0.92);
  });

  safeHandle('embeddings:indexUnindexedPosts', async () => {
    const taskId = `embedding-index-${Date.now()}`;
    return bundle.taskManager.runTask({
      id: taskId,
      name: tr('task.embeddingIndex.name'),
      execute: async (onProgress) => {
        await engine().indexUnindexedPosts((indexed, total) => {
          const pct = total > 0 ? (indexed / total) * 100 : 0;
          onProgress(pct, tr('task.embeddingIndex.indexing')
            .replace('{indexed}', String(indexed))
            .replace('{total}', String(total)));
        });
        return engine().getIndexingProgress();
      },
    });
  });
}
