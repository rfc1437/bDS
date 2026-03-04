import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../store';
import { showToast } from '../Toast';
import { useI18n } from '../../i18n';
import './MetadataDiffPanel.css';

interface TableStats {
  totalPosts: number;
  publishedPosts: number;
  draftPosts: number;
  totalMedia: number;
  totalScripts: number;
  publishedScripts: number;
  totalTemplates: number;
  publishedTemplates: number;
}

// ── Generic diff item types (shared across entity tabs) ──

interface GenericDiffItem {
  id: string;
  label: string;
  dbValue: unknown;
  fileValue: unknown;
}

interface GenericDiffGroup {
  field: string;
  label: string;
  items: GenericDiffItem[];
}

interface GenericScanResult {
  totalScanned: number;
  itemsWithDifferences: number;
  groups: GenericDiffGroup[];
}

type EntityTab = 'posts' | 'media' | 'scripts' | 'templates';
type ScanPhase = 'idle' | 'loading-stats' | 'scanning' | 'complete';

// ── Adapters: normalise entity-specific API results → GenericScanResult ──

function adaptPostScanResult(raw: Awaited<ReturnType<NonNullable<typeof window.electronAPI>['metadataDiff']['scan']>>): GenericScanResult {
  return {
    totalScanned: raw.totalScanned,
    itemsWithDifferences: raw.postsWithDifferences,
    groups: raw.groups.map(g => ({
      field: g.field,
      label: g.label,
      items: g.posts.map(p => ({ id: p.postId, label: p.title || p.slug, dbValue: p.dbValue, fileValue: p.fileValue })),
    })),
  };
}

function adaptMediaScanResult(raw: Awaited<ReturnType<NonNullable<typeof window.electronAPI>['metadataDiff']['scanMedia']>>): GenericScanResult {
  return {
    totalScanned: raw.totalScanned,
    itemsWithDifferences: raw.itemsWithDifferences,
    groups: raw.groups.map(g => ({
      field: g.field,
      label: g.label,
      items: g.items.map(i => ({ id: i.mediaId, label: i.originalName, dbValue: i.dbValue, fileValue: i.fileValue })),
    })),
  };
}

function adaptScriptScanResult(raw: Awaited<ReturnType<NonNullable<typeof window.electronAPI>['metadataDiff']['scanScripts']>>): GenericScanResult {
  return {
    totalScanned: raw.totalScanned,
    itemsWithDifferences: raw.itemsWithDifferences,
    groups: raw.groups.map(g => ({
      field: g.field,
      label: g.label,
      items: g.items.map(i => ({ id: i.scriptId, label: i.title || i.slug, dbValue: i.dbValue, fileValue: i.fileValue })),
    })),
  };
}

function adaptTemplateScanResult(raw: Awaited<ReturnType<NonNullable<typeof window.electronAPI>['metadataDiff']['scanTemplates']>>): GenericScanResult {
  return {
    totalScanned: raw.totalScanned,
    itemsWithDifferences: raw.itemsWithDifferences,
    groups: raw.groups.map(g => ({
      field: g.field,
      label: g.label,
      items: g.items.map(i => ({ id: i.templateId, label: i.title || i.slug, dbValue: i.dbValue, fileValue: i.fileValue })),
    })),
  };
}

export const MetadataDiffPanel: React.FC = () => {
  const { t: tr } = useI18n();
  const activeProjectId = useAppStore((s) => s.activeProject?.id ?? null);
  const [stats, setStats] = useState<TableStats | null>(null);
  const [activeTab, setActiveTab] = useState<EntityTab>('posts');
  const [scanResults, setScanResults] = useState<Record<EntityTab, GenericScanResult | null>>({ posts: null, media: null, scripts: null, templates: null });
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' });
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [syncingGroups, setSyncingGroups] = useState<Set<string>>(new Set());

  // Load initial stats
  useEffect(() => {
    if (!activeProjectId) return;
    const loadStats = async () => {
      setScanPhase('loading-stats');
      try {
        const result = await window.electronAPI?.metadataDiff.getStats();
        if (result) setStats(result as TableStats);
      } catch (error) {
        console.error('Failed to load stats:', error);
        showToast.error(tr('metadataDiff.error.loadStats'));
      }
      setScanPhase('idle');
    };
    loadStats();
  }, [tr, activeProjectId]);

  // Subscribe to task progress
  useEffect(() => {
    const unsubscribe = window.electronAPI?.on('task:progress', (data: unknown) => {
      const p = data as { id: string; progress: number; message?: string };
      if (p.id.startsWith('metadata-')) {
        setProgress({ current: Math.round(p.progress), total: 100, message: p.message || '' });
      }
    });
    return () => { unsubscribe?.(); };
  }, []);

  const handleScan = useCallback(async () => {
    setScanPhase('scanning');
    setProgress({ current: 0, total: 100, message: tr('metadataDiff.progress.starting') });
    setScanResults({ posts: null, media: null, scripts: null, templates: null });

    try {
      // Scan all entity types in parallel
      const [postResult, mediaResult, scriptResult, templateResult] = await Promise.all([
        window.electronAPI?.metadataDiff.scan(),
        window.electronAPI?.metadataDiff.scanMedia(),
        window.electronAPI?.metadataDiff.scanScripts(),
        window.electronAPI?.metadataDiff.scanTemplates(),
      ]);

      const results: Record<EntityTab, GenericScanResult | null> = {
        posts: postResult ? adaptPostScanResult(postResult) : null,
        media: mediaResult ? adaptMediaScanResult(mediaResult) : null,
        scripts: scriptResult ? adaptScriptScanResult(scriptResult) : null,
        templates: templateResult ? adaptTemplateScanResult(templateResult) : null,
      };
      setScanResults(results);

      // Auto-expand groups with differences for active tab
      const currentResult = results[activeTab];
      if (currentResult) {
        setExpandedGroups(new Set(currentResult.groups.map(g => g.field)));
      }

      setScanPhase('complete');
    } catch (error) {
      console.error('Scan failed:', error);
      showToast.error(tr('metadataDiff.error.scan'));
      setScanPhase('idle');
    }
  }, [tr, activeTab]);

  const toggleGroup = (field: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(field) ? next.delete(field) : next.add(field);
      return next;
    });
  };

  // When switching tabs, auto-expand that tab's groups
  const handleTabChange = (tab: EntityTab) => {
    setActiveTab(tab);
    const result = scanResults[tab];
    if (result) {
      setExpandedGroups(new Set(result.groups.map(g => g.field)));
    }
  };

  const handleSyncDbToFile = useCallback(async (group: GenericDiffGroup) => {
    const ids = group.items.map(i => i.id);
    setSyncingGroups(prev => new Set(prev).add(group.field));

    try {
      let result: { success: number; failed: number } | undefined;
      switch (activeTab) {
        case 'posts': result = await window.electronAPI?.metadataDiff.syncDbToFile(ids, group.label); break;
        case 'media': result = await window.electronAPI?.metadataDiff.syncMediaDbToFile(ids, group.label); break;
        case 'scripts': result = await window.electronAPI?.metadataDiff.syncScriptDbToFile(ids, group.label); break;
        case 'templates': result = await window.electronAPI?.metadataDiff.syncTemplateDbToFile(ids, group.label); break;
      }
      if (result) {
        showToast.success(tr('metadataDiff.sync.dbToFile.success', { success: result.success, failed: result.failed > 0 ? `, ${result.failed} ${tr('metadataDiff.sync.failed')}` : '' }));
        handleScan();
      }
    } catch (error) {
      console.error('Sync failed:', error);
      showToast.error(tr('metadataDiff.sync.dbToFile.error'));
    } finally {
      setSyncingGroups(prev => { const next = new Set(prev); next.delete(group.field); return next; });
    }
  }, [activeTab, handleScan, tr]);

  const handleSyncFileToDb = useCallback(async (group: GenericDiffGroup) => {
    const ids = group.items.map(i => i.id);
    setSyncingGroups(prev => new Set(prev).add(group.field));

    try {
      let result: { success: number; failed: number } | undefined;
      switch (activeTab) {
        case 'posts': result = await window.electronAPI?.metadataDiff.syncFileToDb(ids, group.field, group.label); break;
        case 'media': result = await window.electronAPI?.metadataDiff.syncMediaFileToDb(ids, group.field, group.label); break;
        case 'scripts': result = await window.electronAPI?.metadataDiff.syncScriptFileToDb(ids, group.field, group.label); break;
        case 'templates': result = await window.electronAPI?.metadataDiff.syncTemplateFileToDb(ids, group.field, group.label); break;
      }
      if (result) {
        showToast.success(tr('metadataDiff.sync.fileToDb.success', { success: result.success, failed: result.failed > 0 ? `, ${result.failed} ${tr('metadataDiff.sync.failed')}` : '' }));
        handleScan();
      }
    } catch (error) {
      console.error('Sync failed:', error);
      showToast.error(tr('metadataDiff.sync.fileToDb.error'));
    } finally {
      setSyncingGroups(prev => { const next = new Set(prev); next.delete(group.field); return next; });
    }
  }, [activeTab, handleScan, tr]);

  const formatValue = (value: unknown): string => {
    if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '(empty)';
    if (value === null || value === undefined || value === '') return '(empty)';
    return String(value);
  };

  const currentResult = scanResults[activeTab];

  const summaryKey = (tab: EntityTab, hasDiffs: boolean): string => {
    const map: Record<EntityTab, [string, string]> = {
      posts: ['metadataDiff.summary.noDiffs', 'metadataDiff.summary.withDiffs'],
      media: ['metadataDiff.summary.mediaNoDiffs', 'metadataDiff.summary.mediaWithDiffs'],
      scripts: ['metadataDiff.summary.scriptNoDiffs', 'metadataDiff.summary.scriptWithDiffs'],
      templates: ['metadataDiff.summary.templateNoDiffs', 'metadataDiff.summary.templateWithDiffs'],
    };
    return hasDiffs ? map[tab][1] : map[tab][0];
  };

  const tabBadge = (tab: EntityTab): number => scanResults[tab]?.itemsWithDifferences ?? 0;

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
          <div className="stat-item">
            <span className="stat-label">{tr('metadataDiff.stats.scripts')}</span>
            <span className="stat-value">{stats.totalScripts}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">{tr('metadataDiff.stats.templates')}</span>
            <span className="stat-value">{stats.totalTemplates}</span>
          </div>
        </div>
      )}

      {/* Progress Section */}
      {scanPhase === 'scanning' && (
        <div className="diff-progress">
          <h3>{tr('metadataDiff.progress.scanningPublished')}</h3>
          <div className="progress-bar-container">
            <div className="progress-bar" style={{ width: `${progress.current}%` }} />
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
          ) : currentResult ? (
            `🔄 ${tr('metadataDiff.action.rescan')}`
          ) : (
            `🔍 ${tr('metadataDiff.action.scan')}`
          )}
        </button>
      </div>

      {/* Results Section */}
      {scanPhase === 'complete' && (
        <>
          {/* Entity Tabs */}
          <div className="diff-tabs">
            {(['posts', 'media', 'scripts', 'templates'] as EntityTab[]).map(tab => (
              <button
                key={tab}
                className={`diff-tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => handleTabChange(tab)}
              >
                {tr(`metadataDiff.tab.${tab}`)}
                {tabBadge(tab) > 0 && <span className="tab-badge">{tabBadge(tab)}</span>}
              </button>
            ))}
          </div>

          {currentResult && (
            <div className="diff-results">
              <div className={`diff-summary ${currentResult.itemsWithDifferences > 0 ? 'has-differences' : 'no-differences'}`}>
                {tr(summaryKey(activeTab, currentResult.itemsWithDifferences > 0), {
                  total: currentResult.totalScanned,
                  count: currentResult.itemsWithDifferences,
                })}
              </div>

              {/* Groups */}
              {currentResult.groups.map(group => (
                <div key={group.field} className="diff-group">
                  <div className="diff-group-header" onClick={() => toggleGroup(group.field)}>
                    <div className="diff-group-title">
                      <span className={`chevron ${expandedGroups.has(group.field) ? 'expanded' : ''}`}>▶</span>
                      {tr('metadataDiff.group.differences', { label: group.label })}
                    </div>
                    <div className="diff-group-count">
                      <span className="badge">{tr('metadataDiff.group.itemsCount', { count: group.items.length })}</span>
                      <div className="diff-group-actions" onClick={e => e.stopPropagation()}>
                        <button className="db-to-file" onClick={() => handleSyncDbToFile(group)} disabled={syncingGroups.has(group.field)} title={tr('metadataDiff.sync.dbToFile.title')}>
                          DB → File
                        </button>
                        <button className="file-to-db" onClick={() => handleSyncFileToDb(group)} disabled={syncingGroups.has(group.field)} title={tr('metadataDiff.sync.fileToDb.title')}>
                          File → DB
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className={`diff-group-content ${!expandedGroups.has(group.field) ? 'collapsed' : ''}`}>
                    {group.items.map(item => (
                      <div key={item.id} className="diff-post-item">
                        <div className="diff-post-title" title={item.label}>{item.label}</div>
                        <div>
                          <div className="diff-value-label">{tr('metadataDiff.value.database')}</div>
                          <div className="diff-value db-value" title={formatValue(item.dbValue)}>{formatValue(item.dbValue)}</div>
                        </div>
                        <div>
                          <div className="diff-value-label">{tr('metadataDiff.value.file')}</div>
                          <div className="diff-value file-value" title={formatValue(item.fileValue)}>{formatValue(item.fileValue)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {scanPhase === 'idle' && !currentResult && (
        <div className="diff-empty">
          <div className="icon">📊</div>
          <div>{tr('metadataDiff.empty')}</div>
        </div>
      )}
    </div>
  );
};
