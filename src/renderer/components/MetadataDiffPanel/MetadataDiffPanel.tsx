import React, { useState, useEffect, useCallback } from 'react';
import { showToast } from '../Toast';
import { useI18n } from '../../i18n';
import './MetadataDiffPanel.css';

interface TableStats {
  totalPosts: number;
  publishedPosts: number;
  draftPosts: number;
  totalMedia: number;
}

interface DiffPost {
  postId: string;
  title: string;
  slug: string;
  dbValue: unknown;
  fileValue: unknown;
}

interface DiffGroup {
  field: string;
  label: string;
  posts: DiffPost[];
}

interface ScanResult {
  totalScanned: number;
  postsWithDifferences: number;
  differences: Array<{
    postId: string;
    title: string;
    slug: string;
    filePath?: string;
    hasDifferences: boolean;
    differences: Record<string, { dbValue: unknown; fileValue: unknown }>;
  }>;
  groups: DiffGroup[];
}

type ScanPhase = 'idle' | 'loading-stats' | 'scanning' | 'complete';

export const MetadataDiffPanel: React.FC = () => {
  const { t: tr } = useI18n();
  const [stats, setStats] = useState<TableStats | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' });
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [syncingGroups, setSyncingGroups] = useState<Set<string>>(new Set());

  // Load initial stats
  useEffect(() => {
    const loadStats = async () => {
      setScanPhase('loading-stats');
      try {
        const result = await window.electronAPI?.metadataDiff.getStats();
        if (result) {
          setStats(result);
        }
      } catch (error) {
        console.error('Failed to load stats:', error);
        showToast.error(tr('metadataDiff.error.loadStats'));
      }
      setScanPhase('idle');
    };
    loadStats();
  }, [tr]);

  // Subscribe to task progress
  useEffect(() => {
    const unsubscribe = window.electronAPI?.on('task:progress', (data: unknown) => {
      const progress = data as { id: string; progress: number; message?: string };
      if (progress.id.startsWith('metadata-diff-scan')) {
        setProgress({
          current: Math.round(progress.progress),
          total: 100,
          message: progress.message || '',
        });
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  const handleScan = useCallback(async () => {
    setScanPhase('scanning');
    setProgress({ current: 0, total: 100, message: tr('metadataDiff.progress.starting') });
    setScanResult(null);

    try {
      const result = await window.electronAPI?.metadataDiff.scan();
      if (result) {
        setScanResult(result);
        // Auto-expand groups with differences
        const groupsWithDiffs = new Set(result.groups.map(g => g.field));
        setExpandedGroups(groupsWithDiffs);
      }
      setScanPhase('complete');
    } catch (error) {
      console.error('Scan failed:', error);
      showToast.error(tr('metadataDiff.error.scan'));
      setScanPhase('idle');
    }
  }, [tr]);

  const toggleGroup = (field: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }
      return next;
    });
  };

  const handleSyncDbToFile = useCallback(async (group: DiffGroup) => {
    const postIds = group.posts.map(p => p.postId);
    setSyncingGroups(prev => new Set(prev).add(group.field));

    try {
      const result = await window.electronAPI?.metadataDiff.syncDbToFile(postIds, group.label);
      if (result) {
        showToast.success(tr('metadataDiff.sync.dbToFile.success', { success: result.success, failed: result.failed > 0 ? `, ${result.failed} ${tr('metadataDiff.sync.failed')}` : '' }));
        // Re-scan to update the view
        handleScan();
      }
    } catch (error) {
      console.error('Sync failed:', error);
      showToast.error(tr('metadataDiff.sync.dbToFile.error'));
    } finally {
      setSyncingGroups(prev => {
        const next = new Set(prev);
        next.delete(group.field);
        return next;
      });
    }
  }, [handleScan, tr]);

  const handleSyncFileToDb = useCallback(async (group: DiffGroup) => {
    const postIds = group.posts.map(p => p.postId);
    setSyncingGroups(prev => new Set(prev).add(group.field));

    try {
      const result = await window.electronAPI?.metadataDiff.syncFileToDb(postIds, group.field, group.label);
      if (result) {
        showToast.success(tr('metadataDiff.sync.fileToDb.success', { success: result.success, failed: result.failed > 0 ? `, ${result.failed} ${tr('metadataDiff.sync.failed')}` : '' }));
        // Re-scan to update the view
        handleScan();
      }
    } catch (error) {
      console.error('Sync failed:', error);
      showToast.error(tr('metadataDiff.sync.fileToDb.error'));
    } finally {
      setSyncingGroups(prev => {
        const next = new Set(prev);
        next.delete(group.field);
        return next;
      });
    }
  }, [handleScan, tr]);

  const formatValue = (value: unknown): string => {
    if (Array.isArray(value)) {
      return value.length > 0 ? value.join(', ') : '(empty)';
    }
    if (value === null || value === undefined || value === '') {
      return '(empty)';
    }
    return String(value);
  };

  return (
    <div className="metadata-diff-panel">
      <h2>{tr('metadataDiff.title')}</h2>
      <p style={{ marginBottom: 16, color: 'var(--descriptionForeground)', fontSize: 13 }}>
        {tr('metadataDiff.description')}
      </p>

      {/* Stats Section */}
      {stats && (
        <div className="diff-stats">
          <div className="stat-item">
            <span className="stat-label">{tr('metadataDiff.stats.totalPosts')}</span>
            <span className="stat-value">{stats.totalPosts}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">{tr('metadataDiff.stats.published')}</span>
            <span className="stat-value">{stats.publishedPosts}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">{tr('metadataDiff.stats.drafts')}</span>
            <span className="stat-value">{stats.draftPosts}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">{tr('metadataDiff.stats.mediaFiles')}</span>
            <span className="stat-value">{stats.totalMedia}</span>
          </div>
        </div>
      )}

      {/* Progress Section */}
      {scanPhase === 'scanning' && (
        <div className="diff-progress">
          <h3>{tr('metadataDiff.progress.scanningPublished')}</h3>
          <div className="progress-bar-container">
            <div
              className="progress-bar"
              style={{ width: `${progress.current}%` }}
            />
          </div>
          <div className="progress-text">{progress.message}</div>
        </div>
      )}

      {/* Actions Section */}
      <div className="diff-actions">
        <button
          className="primary"
          onClick={handleScan}
          disabled={scanPhase === 'scanning' || scanPhase === 'loading-stats'}
        >
          {scanPhase === 'scanning' ? (
            <>
              <span className="spinner" style={{ width: 14, height: 14 }} />
              {tr('metadataDiff.progress.scanning')}
            </>
          ) : scanResult ? (
            `🔄 ${tr('metadataDiff.action.rescan')}`
          ) : (
            `🔍 ${tr('metadataDiff.action.scan')}`
          )}
        </button>
      </div>

      {/* Results Section */}
      {scanPhase === 'complete' && scanResult && (
        <div className="diff-results">
          <div className={`diff-summary ${scanResult.postsWithDifferences > 0 ? 'has-differences' : 'no-differences'}`}>
            {scanResult.postsWithDifferences === 0 ? (
              <>{tr('metadataDiff.summary.noDiffs', { total: scanResult.totalScanned })}</>
            ) : (
              <>
                {tr('metadataDiff.summary.withDiffs', { count: scanResult.postsWithDifferences, total: scanResult.totalScanned })}
              </>
            )}
          </div>

          {/* Groups */}
          {scanResult.groups.map(group => (
            <div key={group.field} className="diff-group">
              <div
                className="diff-group-header"
                onClick={() => toggleGroup(group.field)}
              >
                <div className="diff-group-title">
                  <span className={`chevron ${expandedGroups.has(group.field) ? 'expanded' : ''}`}>
                    ▶
                  </span>
                  {tr('metadataDiff.group.differences', { label: group.label })}
                </div>
                <div className="diff-group-count">
                  <span className="badge">{tr('metadataDiff.group.postsCount', { count: group.posts.length })}</span>
                  <div className="diff-group-actions" onClick={e => e.stopPropagation()}>
                    <button
                      className="db-to-file"
                      onClick={() => handleSyncDbToFile(group)}
                      disabled={syncingGroups.has(group.field)}
                      title={tr('metadataDiff.sync.dbToFile.title')}
                    >
                      DB → File
                    </button>
                    <button
                      className="file-to-db"
                      onClick={() => handleSyncFileToDb(group)}
                      disabled={syncingGroups.has(group.field)}
                      title={tr('metadataDiff.sync.fileToDb.title')}
                    >
                      File → DB
                    </button>
                  </div>
                </div>
              </div>
              <div className={`diff-group-content ${!expandedGroups.has(group.field) ? 'collapsed' : ''}`}>
                {group.posts.map(post => (
                  <div key={post.postId} className="diff-post-item">
                    <div className="diff-post-title" title={post.title}>
                      {post.title || post.slug}
                    </div>
                    <div>
                      <div className="diff-value-label">{tr('metadataDiff.value.database')}</div>
                      <div className="diff-value db-value" title={formatValue(post.dbValue)}>
                        {formatValue(post.dbValue)}
                      </div>
                    </div>
                    <div>
                      <div className="diff-value-label">{tr('metadataDiff.value.file')}</div>
                      <div className="diff-value file-value" title={formatValue(post.fileValue)}>
                        {formatValue(post.fileValue)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {scanPhase === 'idle' && !scanResult && (
        <div className="diff-empty">
          <div className="icon">📊</div>
          <div>{tr('metadataDiff.empty')}</div>
        </div>
      )}
    </div>
  );
};
