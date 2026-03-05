import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../store';
import { openEntityTab } from '../../navigation/tabPolicy';
import { useI18n } from '../../i18n';
import type { DuplicatePair } from '../../../main/shared/electronApi';
import './DuplicatesView.css';

export const DuplicatesView: React.FC = () => {
  const { t } = useI18n();
  const { openTab } = useAppStore();
  const [pairs, setPairs] = useState<DuplicatePair[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notEnabled, setNotEnabled] = useState(false);

  const loadDuplicates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const metadata = await window.electronAPI?.meta.getProjectMetadata();
      if (!metadata?.semanticSimilarityEnabled) {
        setNotEnabled(true);
        setPairs([]);
        return;
      }
      setNotEnabled(false);
      const result = await window.electronAPI?.embeddings.findDuplicates(0.85);
      setPairs(result ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDuplicates();
  }, [loadDuplicates]);

  const handleDismiss = useCallback(async (postIdA: string, postIdB: string) => {
    try {
      await window.electronAPI?.embeddings.dismissPair(postIdA, postIdB);
      setPairs(prev => prev.filter(p => !(p.postA.id === postIdA && p.postB.id === postIdB)));
    } catch (err) {
      console.error('Failed to dismiss duplicate pair:', err);
    }
  }, []);

  const handleOpenPost = useCallback((postId: string) => {
    openEntityTab(openTab, 'post', postId, 'pin');
  }, [openTab]);

  return (
    <div className="duplicates-view">
      <div className="duplicates-view-header">
        <h2>{t('duplicatesView.title')}</h2>
        <p>{t('duplicatesView.description')}</p>
      </div>

      {!notEnabled && (
        <div className="duplicates-view-actions">
          <button
            type="button"
            className="duplicates-view-refresh"
            onClick={() => void loadDuplicates()}
            disabled={isLoading}
          >
            {t('duplicatesView.refresh')}
          </button>
        </div>
      )}

      {notEnabled && (
        <p className="duplicates-view-not-enabled">{t('duplicatesView.notEnabled')}</p>
      )}

      {!notEnabled && isLoading && (
        <p className="duplicates-view-status">{t('duplicatesView.loading')}</p>
      )}

      {!notEnabled && error && (
        <p className="duplicates-view-status">{t('duplicatesView.error')}: {error}</p>
      )}

      {!notEnabled && !isLoading && !error && pairs.length === 0 && (
        <p className="duplicates-view-status">{t('duplicatesView.empty')}</p>
      )}

      {!notEnabled && pairs.length > 0 && (
        <div className="duplicates-view-list">
          {pairs.map(pair => (
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
        </div>
      )}
    </div>
  );
};
