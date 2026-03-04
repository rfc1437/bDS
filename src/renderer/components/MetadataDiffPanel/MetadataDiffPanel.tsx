import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

// ── Generic diff types (item-first, showing all field diffs per item) ──

interface FieldDiff {
  dbValue: unknown;
  fileValue: unknown;
}

interface GenericDiffItem {
  id: string;
  label: string;
  fileMissing?: boolean;
  fields: Record<string, FieldDiff>;
}

interface GenericOrphanFile {
  filePath: string;
  slug: string;
  title?: string;
  id?: string;
}

interface FieldSummary {
  field: string;
  label: string;
  count: number;
}

interface GenericScanResult {
  totalScanned: number;
  itemsWithDifferences: number;
  items: GenericDiffItem[];
  fieldSummaries: FieldSummary[];
  orphanFiles: GenericOrphanFile[];
}

type EntityTab = 'posts' | 'media' | 'scripts' | 'templates';
type ScanPhase = 'idle' | 'loading-stats' | 'scanning' | 'complete';

// ── Adapters: use differences array (item-first) + groups for field labels ──

function adaptPostScanResult(raw: Awaited<ReturnType<NonNullable<typeof window.electronAPI>['metadataDiff']['scan']>>): GenericScanResult {
  return {
    totalScanned: raw.totalScanned,
    itemsWithDifferences: raw.postsWithDifferences,
    items: raw.differences.filter(d => d.hasDifferences).map(d => ({
      id: d.postId,
      label: d.title || d.slug,
      fileMissing: d.fileMissing,
      fields: d.differences as Record<string, FieldDiff>,
    })),
    fieldSummaries: raw.groups.map(g => ({ field: g.field, label: g.label, count: g.posts.length })),
    orphanFiles: raw.orphanFiles ?? [],
  };
}

function adaptMediaScanResult(raw: Awaited<ReturnType<NonNullable<typeof window.electronAPI>['metadataDiff']['scanMedia']>>): GenericScanResult {
  return {
    totalScanned: raw.totalScanned,
    itemsWithDifferences: raw.itemsWithDifferences,
    items: raw.differences.filter(d => d.hasDifferences).map(d => ({
      id: d.mediaId,
      label: d.originalName,
      fileMissing: d.fileMissing,
      fields: d.differences as Record<string, FieldDiff>,
    })),
    fieldSummaries: raw.groups.map(g => ({ field: g.field, label: g.label, count: g.items.length })),
    orphanFiles: [],
  };
}

function adaptScriptScanResult(raw: Awaited<ReturnType<NonNullable<typeof window.electronAPI>['metadataDiff']['scanScripts']>>): GenericScanResult {
  return {
    totalScanned: raw.totalScanned,
    itemsWithDifferences: raw.itemsWithDifferences,
    items: raw.differences.filter(d => d.hasDifferences).map(d => ({
      id: d.scriptId,
      label: d.title || d.slug,
      fileMissing: d.fileMissing,
      fields: d.differences as Record<string, FieldDiff>,
    })),
    fieldSummaries: raw.groups.map(g => ({ field: g.field, label: g.label, count: g.items.length })),
    orphanFiles: [],
  };
}

function adaptTemplateScanResult(raw: Awaited<ReturnType<NonNullable<typeof window.electronAPI>['metadataDiff']['scanTemplates']>>): GenericScanResult {
  return {
    totalScanned: raw.totalScanned,
    itemsWithDifferences: raw.itemsWithDifferences,
    items: raw.differences.filter(d => d.hasDifferences).map(d => ({
      id: d.templateId,
      label: d.title || d.slug,
      fileMissing: d.fileMissing,
      fields: d.differences as Record<string, FieldDiff>,
    })),
    fieldSummaries: raw.groups.map(g => ({ field: g.field, label: g.label, count: g.items.length })),
    orphanFiles: [],
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
  const [activeFieldFilter, setActiveFieldFilter] = useState<string | null>(null);
  const [syncingFields, setSyncingFields] = useState<Set<string>>(new Set());

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
      const p = data as { taskId: string; progress: number; message?: string };
      if (p.taskId?.startsWith('metadata-')) {
        setProgress({ current: Math.round(p.progress), total: 100, message: p.message || '' });
      }
    });
    return () => { unsubscribe?.(); };
  }, []);

  const handleScan = useCallback(async () => {
    setScanPhase('scanning');
    setProgress({ current: 0, total: 100, message: tr('metadataDiff.progress.starting') });
    setScanResults({ posts: null, media: null, scripts: null, templates: null });
    setActiveFieldFilter(null);

    try {
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
      setScanPhase('complete');
    } catch (error) {
      console.error('Scan failed:', error);
      showToast.error(tr('metadataDiff.error.scan'));
      setScanPhase('idle');
    }
  }, [tr]);

  const handleTabChange = (tab: EntityTab) => {
    setActiveTab(tab);
    setActiveFieldFilter(null);
  };

  const toggleFieldFilter = (field: string) => {
    setActiveFieldFilter(prev => prev === field ? null : field);
  };

  // Filter items: if a field filter is active, show only items that have that field diff,
  // but still show ALL fields for those items
  const currentResult = scanResults[activeTab];
  const filteredItems = useMemo(() => {
    if (!currentResult) return [];
    if (!activeFieldFilter) return currentResult.items;
    return currentResult.items.filter(item => activeFieldFilter in item.fields);
  }, [currentResult, activeFieldFilter]);

  const handleSyncDbToFile = useCallback(async (field: string, fieldLabel: string) => {
    // Get IDs of items that have this field diff (from filtered or all)
    const ids = (currentResult?.items ?? [])
      .filter(item => field in item.fields)
      .map(item => item.id);
    if (ids.length === 0) return;

    setSyncingFields(prev => new Set(prev).add(field));
    try {
      let result: { success: number; failed: number } | undefined;
      switch (activeTab) {
        case 'posts': result = await window.electronAPI?.metadataDiff.syncDbToFile(ids, fieldLabel); break;
        case 'media': result = await window.electronAPI?.metadataDiff.syncMediaDbToFile(ids, fieldLabel); break;
        case 'scripts': result = await window.electronAPI?.metadataDiff.syncScriptDbToFile(ids, fieldLabel); break;
        case 'templates': result = await window.electronAPI?.metadataDiff.syncTemplateDbToFile(ids, fieldLabel); break;
      }
      if (result) {
        showToast.success(tr('metadataDiff.sync.dbToFile.success', { success: result.success, failed: result.failed > 0 ? `, ${result.failed} ${tr('metadataDiff.sync.failed')}` : '' }));
        handleScan();
      }
    } catch (error) {
      console.error('Sync failed:', error);
      showToast.error(tr('metadataDiff.sync.dbToFile.error'));
    } finally {
      setSyncingFields(prev => { const next = new Set(prev); next.delete(field); return next; });
    }
  }, [activeTab, currentResult, handleScan, tr]);

  const handleSyncFileToDb = useCallback(async (field: string, fieldLabel: string) => {
    const ids = (currentResult?.items ?? [])
      .filter(item => field in item.fields)
      .map(item => item.id);
    if (ids.length === 0) return;

    setSyncingFields(prev => new Set(prev).add(field));
    try {
      let result: { success: number; failed: number } | undefined;
      switch (activeTab) {
        case 'posts': result = await window.electronAPI?.metadataDiff.syncFileToDb(ids, field, fieldLabel); break;
        case 'media': result = await window.electronAPI?.metadataDiff.syncMediaFileToDb(ids, field, fieldLabel); break;
        case 'scripts': result = await window.electronAPI?.metadataDiff.syncScriptFileToDb(ids, field, fieldLabel); break;
        case 'templates': result = await window.electronAPI?.metadataDiff.syncTemplateFileToDb(ids, field, fieldLabel); break;
      }
      if (result) {
        showToast.success(tr('metadataDiff.sync.fileToDb.success', { success: result.success, failed: result.failed > 0 ? `, ${result.failed} ${tr('metadataDiff.sync.failed')}` : '' }));
        handleScan();
      }
    } catch (error) {
      console.error('Sync failed:', error);
      showToast.error(tr('metadataDiff.sync.fileToDb.error'));
    } finally {
      setSyncingFields(prev => { const next = new Set(prev); next.delete(field); return next; });
    }
  }, [activeTab, currentResult, handleScan, tr]);

  const formatValue = (value: unknown): string => {
    if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '(empty)';
    if (value === null || value === undefined || value === '') return '(empty)';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
  };

  const summaryKey = (tab: EntityTab, hasDiffs: boolean): string => {
    const map: Record<EntityTab, [string, string]> = {
      posts: ['metadataDiff.summary.noDiffs', 'metadataDiff.summary.withDiffs'],
      media: ['metadataDiff.summary.mediaNoDiffs', 'metadataDiff.summary.mediaWithDiffs'],
      scripts: ['metadataDiff.summary.scriptNoDiffs', 'metadataDiff.summary.scriptWithDiffs'],
      templates: ['metadataDiff.summary.templateNoDiffs', 'metadataDiff.summary.templateWithDiffs'],
    };
    return hasDiffs ? map[tab][1] : map[tab][0];
  };

  const tabBadge = (tab: EntityTab): number => {
    const result = scanResults[tab];
    if (!result) return 0;
    return result.itemsWithDifferences + result.orphanFiles.length;
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

              {/* Field summaries — clickable pills that filter by field */}
              {currentResult.fieldSummaries.length > 0 && (
                <div className="diff-field-summaries">
                  {currentResult.fieldSummaries.map(fs => (
                    <div
                      key={fs.field}
                      className={`field-pill ${activeFieldFilter === fs.field ? 'active' : ''}`}
                      onClick={() => toggleFieldFilter(fs.field)}
                      title={tr('metadataDiff.fieldFilter.toggle', { field: fs.label })}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toggleFieldFilter(fs.field); }}
                    >
                      <span className="field-pill-label">{fs.label}</span>
                      <span className="field-pill-count">{fs.count}</span>
                      {/* Sync actions on field pills */}
                      <span className="field-pill-actions" onClick={e => e.stopPropagation()}>
                        <button
                          className="pill-sync db-to-file"
                          onClick={() => handleSyncDbToFile(fs.field, fs.label)}
                          disabled={syncingFields.has(fs.field)}
                          title={tr('metadataDiff.sync.dbToFile.title')}
                        >
                          {tr('metadataDiff.sync.dbToFile.short')}
                        </button>
                        <button
                          className="pill-sync file-to-db"
                          onClick={() => handleSyncFileToDb(fs.field, fs.label)}
                          disabled={syncingFields.has(fs.field)}
                          title={tr('metadataDiff.sync.fileToDb.title')}
                        >
                          {tr('metadataDiff.sync.fileToDb.short')}
                        </button>
                      </span>
                    </div>
                  ))}
                  {activeFieldFilter && (
                    <button className="field-pill clear-filter" onClick={() => setActiveFieldFilter(null)}>
                      ✕
                    </button>
                  )}
                </div>
              )}

              {/* Item list — each item shows all its field diffs */}
              {filteredItems.length > 0 && (
                <div className="diff-item-list">
                  {filteredItems.map(item => (
                    <div key={item.id} className={`diff-item-card ${item.fileMissing ? 'file-missing' : ''}`}>
                      <div className="diff-item-header">
                        {item.label}
                        {item.fileMissing && <span className="file-missing-badge">{tr('metadataDiff.fileMissing')}</span>}
                      </div>
                      <div className="diff-item-fields">
                        {Object.entries(item.fields).map(([field, diff]) => (
                          <div key={field} className="diff-field-row">
                            <div className="diff-field-name">{field}</div>
                            <div className="diff-field-values">
                              <div className="diff-field-value db-value" title={formatValue(diff.dbValue)}>
                                <span className="diff-source-label">{tr('metadataDiff.value.database')}</span>
                                {formatValue(diff.dbValue)}
                              </div>
                              <div className={`diff-field-value file-value ${item.fileMissing && diff.fileValue === null ? 'missing' : ''}`} title={item.fileMissing && diff.fileValue === null ? tr('metadataDiff.value.fileMissing') : formatValue(diff.fileValue)}>
                                <span className="diff-source-label">{tr('metadataDiff.value.file')}</span>
                                {item.fileMissing && diff.fileValue === null ? tr('metadataDiff.value.fileMissing') : formatValue(diff.fileValue)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Orphan files — files on disk with no DB entry */}
              {currentResult.orphanFiles.length > 0 && !activeFieldFilter && (
                <div className="orphan-files-section">
                  <h3>{tr('metadataDiff.orphanFiles.title', { count: currentResult.orphanFiles.length })}</h3>
                  <p className="orphan-files-description">{tr('metadataDiff.orphanFiles.description')}</p>
                  <div className="diff-item-list">
                    {currentResult.orphanFiles.map(orphan => (
                      <div key={orphan.filePath} className="diff-item-card orphan-file">
                        <div className="diff-item-header">
                          {orphan.title || orphan.slug}
                          <span className="orphan-file-badge">{tr('metadataDiff.orphanFiles.badge')}</span>
                        </div>
                        <div className="diff-item-fields">
                          <div className="diff-field-row">
                            <div className="diff-field-name">{tr('metadataDiff.orphanFiles.slug')}</div>
                            <div className="diff-field-values">
                              <div className="diff-field-value file-value">{orphan.slug}</div>
                            </div>
                          </div>
                          <div className="diff-field-row">
                            <div className="diff-field-name">{tr('metadataDiff.orphanFiles.path')}</div>
                            <div className="diff-field-values">
                              <div className="diff-field-value file-value orphan-path" title={orphan.filePath}>{orphan.filePath}</div>
                            </div>
                          </div>
                          {orphan.id && (
                            <div className="diff-field-row">
                              <div className="diff-field-name">ID</div>
                              <div className="diff-field-values">
                                <div className="diff-field-value file-value">{orphan.id}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
