import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '../../store';
import { openEntityTab } from '../../navigation/tabPolicy';
import { useI18n } from '../../i18n';
import { getPersistedDuplicatesResult, removeDismissedPair } from '../../navigation/duplicatesPersistence';
import type { DuplicatePair } from '../../../main/shared/electronApi';
import './DuplicatesView.css';

const PAGE_SIZE = 500;

export const DuplicatesView: React.FC = () => {
  const { t } = useI18n();
  const { openTab, activeProject } = useAppStore();
  const [pairs, setPairs] = useState<DuplicatePair[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [notEnabled, setNotEnabled] = useState(false);
  const [checked, setChecked] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const projectId = activeProject?.id;

  // Load persisted results (or check if feature is enabled)
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      const metadata = await window.electronAPI?.meta.getProjectMetadata();
      if (cancelled) return;
      if (!metadata?.semanticSimilarityEnabled) {
        setNotEnabled(true);
        setPairs([]);
        setChecked(true);
        return;
      }
      setNotEnabled(false);
      const persisted = getPersistedDuplicatesResult(projectId);
      if (persisted) {
        setPairs(persisted);
      }
      setChecked(true);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // Listen for search result updates from the background task
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (!projectId || detail?.projectId !== projectId) return;
      const persisted = getPersistedDuplicatesResult(projectId);
      setPairs(persisted ?? []);
      setIsSearching(false);
      setVisibleCount(PAGE_SIZE);
    };
    window.addEventListener('bds:duplicates-updated', handler);
    return () => window.removeEventListener('bds:duplicates-updated', handler);
  }, [projectId]);

  const visiblePairs = useMemo(() => pairs.slice(0, visibleCount), [pairs, visibleCount]);
  const hasMore = visibleCount < pairs.length;

  const handleRunSearch = useCallback(() => {
    setIsSearching(true);
    window.electronAPI?.embeddings.runDuplicateSearch(0.92);
  }, []);

  const handleDismiss = useCallback(async (postIdA: string, postIdB: string) => {
    try {
      await window.electronAPI?.embeddings.dismissPair(postIdA, postIdB);
      setPairs(prev => prev.filter(p => !(p.postA.id === postIdA && p.postB.id === postIdB)));
      if (projectId) {
        removeDismissedPair(projectId, postIdA, postIdB);
      }
    } catch (err) {
      console.error('Failed to dismiss duplicate pair:', err);
    }
  }, [projectId]);

  const handleOpenPost = useCallback((postId: string) => {
    openEntityTab(openTab, 'post', postId, 'pin');
  }, [openTab]);

  const handleShowMore = useCallback(() => {
    setVisibleCount(prev => prev + PAGE_SIZE);
  }, []);

  const hasCachedResults = pairs.length > 0 || (checked && getPersistedDuplicatesResult(projectId ?? '') !== null);

  return (
    <div className="duplicates-view">
      <div className="duplicates-view-header">
        <h2>{t('duplicatesView.title')}</h2>
        <p>{t('duplicatesView.description')}</p>
      </div>

      {notEnabled && (
        <p className="duplicates-view-not-enabled">{t('duplicatesView.notEnabled')}</p>
      )}

      {!notEnabled && checked && (
        <div className="duplicates-view-actions">
          <button
            type="button"
            className="duplicates-view-refresh"
            onClick={handleRunSearch}
            disabled={isSearching}
          >
            {t('duplicatesView.refresh')}
          </button>
        </div>
      )}

      {!notEnabled && isSearching && (
        <p className="duplicates-view-status">{t('duplicatesView.loading')}</p>
      )}

      {!notEnabled && !isSearching && checked && !hasCachedResults && (
        <p className="duplicates-view-status">{t('duplicatesView.empty')}</p>
      )}

      {!notEnabled && !isSearching && pairs.length > 0 && (
        <div className="duplicates-view-list">
          <p className="duplicates-view-count">
            {t('duplicatesView.count', { count: pairs.length })}
          </p>
          {visiblePairs.map(pair => (
            <div key={`${pair.postA.id}-${pair.postB.id}`} className="duplicate-pair">
              <div className="duplicate-pair-posts">
                <button
                  type="button"
                  className="duplicate-pair-post"
                  onClick={() => handleOpenPost(pair.postA.id)}
                  title={t('duplicatesView.openPost')}
                >
                  {pair.postA.title || pair.postA.slug}
                </button>
                <span className="duplicate-pair-separator">↔</span>
                <button
                  type="button"
                  className="duplicate-pair-post"
                  onClick={() => handleOpenPost(pair.postB.id)}
                  title={t('duplicatesView.openPost')}
                >
                  {pair.postB.title || pair.postB.slug}
                </button>
              </div>
              <div className="duplicate-pair-meta">
                <span className="duplicate-pair-score">
                  {t('duplicatesView.similarity', { value: Math.round(pair.similarity * 100) })}
                </span>
                <button
                  type="button"
                  className="duplicate-pair-dismiss"
                  onClick={() => void handleDismiss(pair.postA.id, pair.postB.id)}
                >
                  {t('duplicatesView.dismiss')}
                </button>
              </div>
            </div>
          ))}
          {hasMore && (
            <button
              type="button"
              className="duplicates-view-show-more"
              onClick={handleShowMore}
            >
              {t('duplicatesView.showMore')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
