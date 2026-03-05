import type { DuplicatePair } from '../../main/shared/electronApi';

const store = new Map<string, DuplicatePair[]>();

export function persistDuplicatesResult(projectId: string, pairs: DuplicatePair[]): void {
  store.set(projectId, pairs);
}

export function getPersistedDuplicatesResult(projectId: string): DuplicatePair[] | null {
  return store.get(projectId) ?? null;
}

export function removeDismissedPair(projectId: string, postIdA: string, postIdB: string): void {
  const pairs = store.get(projectId);
  if (!pairs) return;
  store.set(
    projectId,
    pairs.filter(p => !(p.postA.id === postIdA && p.postB.id === postIdB)),
  );
}

export function removeDismissedPairs(projectId: string, pairIds: Array<[string, string]>): void {
  const pairs = store.get(projectId);
  if (!pairs) return;
  const keySet = new Set(pairIds.map(([a, b]) => `${a}::${b}`));
  store.set(
    projectId,
    pairs.filter(p => !keySet.has(`${p.postA.id}::${p.postB.id}`)),
  );
}
