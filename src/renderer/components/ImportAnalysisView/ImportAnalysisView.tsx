import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { ChatModel } from '../../types/electron';
import { useEntityLoader } from '../../navigation/useEntityEditor';
import { useI18n } from '../../i18n';
import './ImportAnalysisView.css';

/** How to resolve a slug conflict during import */
type ImportConflictResolution = 'ignore' | 'overwrite' | 'import';

interface AnalysisReport {
  sourceFile: string;
  site: { title: string; link: string; description: string; language: string };
  analyzedAt: string;
  posts: ItemSection;
  pages: ItemSection;
  media: MediaSection;
  categories: TaxonomyItem[];
  tags: TaxonomyItem[];
  macros: MacroAnalysisSummary;
}

interface ItemSection {
  total: number;
  new: number;
  updates: number;
  conflicts: number;
  contentDuplicates: number;
  items: AnalyzedPostItem[];
}

interface MediaSection {
  total: number;
  new: number;
  updates: number;
  conflicts: number;
  contentDuplicates: number;
  missing: number;
  items: AnalyzedMediaItem[];
}

interface AnalyzedPostItem {
  wxrPost: {
    wpId: number;
    title: string;
    slug: string;
    status: string;
    excerpt: string;
    pubDate: string | null;
    postDate: string | null;
    postModified: string | null;
    creator: string;
    postType: string;
    categories: string[];
    tags: string[];
  };
  status: string;
  contentHash: string;
  markdownPreview: string;
  /** How to resolve conflict (only relevant when status is 'conflict'). Default is 'ignore'. */
  conflictResolution?: ImportConflictResolution;
  existingPost?: {
    id: string;
    title: string;
    slug: string;
    /** Date the existing post was created/published */
    pubDate?: string | null;
    /** Excerpt from existing post */
    excerpt?: string | null;
    /** Author of the existing post */
    author?: string | null;
    /** Tags of the existing post */
    tags?: string[];
    /** Categories of the existing post */
    categories?: string[];
  };
}

interface AnalyzedMediaItem {
  wxrMedia: {
    wpId: number;
    title: string;
    filename: string;
    url: string;
    relativePath: string;
    pubDate: string | null;
    parentId: number;
    mimeType: string;
    description: string;
  };
  status: string;
  fileHash: string | null;
  existingMedia?: { id: string; originalName: string };
}

interface TaxonomyItem {
  name: string;
  slug: string;
  existsInProject: boolean;
  mappedTo?: string; // When set, indicates this item should be mapped to the given name on import
}

/** Validation status for a macro usage */
type MacroValidationStatus = 'valid' | 'invalid' | 'unknown';

/** A single unique usage pattern of a macro */
interface MacroUsage {
  params: Record<string, string>;
  count: number;
  validationStatus: MacroValidationStatus;
  validationError?: string;
  paramsKey: string;
}

/** A discovered macro from the import content */
interface DiscoveredMacro {
  name: string;
  mapped: boolean;
  totalCount: number;
  usages: MacroUsage[];
  postSlugs: string[];
}

/** Summary of macro analysis */
interface MacroAnalysisSummary {
  total: number;
  mappedCount: number;
  unmappedCount: number;
  discovered: DiscoveredMacro[];
}

interface ImportAnalysisViewProps {
  definitionId: string;
}

interface ImportExecutionState {
  isExecuting: boolean;
  taskId: string | null;
  phase: string;
  current: number;
  total: number;
  detail: string;
  eta: number | null;
  completed: boolean;
  error: string | null;
}

const formatEta = (etaMs: number): string => {
  if (etaMs <= 0) return '';
  const seconds = Math.ceil(etaMs / 1000);
  if (seconds < 60) return `~${seconds}s remaining`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `~${minutes}m ${secs}s remaining`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `~${hours}h ${mins}m remaining`;
};

export const ImportAnalysisView: React.FC<ImportAnalysisViewProps> = ({ definitionId }) => {
  const { t } = useI18n();
  const [name, setName] = useState(t('importAnalysis.untitledImport'));
  const [uploadsFolder, setUploadsFolder] = useState<string | null>(null);
  const [wxrFilePath, setWxrFilePath] = useState<string | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [progressStep, setProgressStep] = useState<string>('');
  const [progressDetail, setProgressDetail] = useState<string>('');
  const [executionState, setExecutionState] = useState<ImportExecutionState>({
    isExecuting: false,
    taskId: null,
    phase: '',
    current: 0,
    total: 0,
    detail: '',
    eta: null,
    completed: false,
    error: null,
  });
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to progress events
  useEffect(() => {
    const unsubscribe = window.electronAPI?.import.onProgress(({ step, detail }) => {
      setProgressStep(step);
      setProgressDetail(detail || '');
    });
    return () => unsubscribe?.();
  }, []);

  // Subscribe to execution progress events
  useEffect(() => {
    const unsubscribe = window.electronAPI?.import.onExecutionProgress(({ taskId, phase, current, total, detail, eta }) => {
      setExecutionState(prev => {
        if (prev.taskId !== taskId) return prev;
        return {
          ...prev,
          phase,
          current,
          total,
          detail: detail || '',
          eta: eta ?? null,
        };
      });
    });
    return () => unsubscribe?.();
  }, []);

  // Subscribe to task completion events
  useEffect(() => {
    const unsubscribe = window.electronAPI?.on('task:completed', ((...args: unknown[]) => {
      const task = args[0] as { taskId: string };
      setExecutionState(prev => {
        if (prev.taskId !== task.taskId) return prev;
        return { ...prev, isExecuting: false, completed: true };
      });
    }) as (...args: unknown[]) => void);
    return () => unsubscribe?.();
  }, []);

  // Subscribe to task failure events
  useEffect(() => {
    const unsubscribe = window.electronAPI?.on('task:failed', ((...args: unknown[]) => {
      const task = args[0] as { taskId: string; error: string };
      setExecutionState(prev => {
        if (prev.taskId !== task.taskId) return prev;
        return { ...prev, isExecuting: false, error: task.error };
      });
    }) as (...args: unknown[]) => void);
    return () => unsubscribe?.();
  }, []);

  // Save the current report to the definition
  const persistReport = useCallback(async (updatedReport: AnalysisReport) => {
    await window.electronAPI?.importDefinitions.update(definitionId, {
      lastAnalysisResult: JSON.stringify(updatedReport),
    });
  }, [definitionId]);

  // Handler for updating taxonomy mappings
  const handleTaxonomyMappingsUpdated = useCallback(async (
    categoryMappings: Record<string, string>,
    tagMappings: Record<string, string>
  ) => {
    if (!report) return;
    
    const updatedReport: AnalysisReport = {
      ...report,
      categories: report.categories.map(cat => ({
        ...cat,
        mappedTo: categoryMappings[cat.name] || cat.mappedTo,
      })),
      tags: report.tags.map(tag => ({
        ...tag,
        mappedTo: tagMappings[tag.name] || tag.mappedTo,
      })),
    };
    
    setReport(updatedReport);
    await persistReport(updatedReport);
  }, [report, persistReport]);

  // Handler for updating a single item mapping
  const handleSingleMappingUpdated = useCallback(async (
    type: 'category' | 'tag',
    itemName: string,
    mappedTo: string | undefined
  ) => {
    if (!report) return;
    
    const updatedReport: AnalysisReport = {
      ...report,
      categories: type === 'category' 
        ? report.categories.map(cat => 
            cat.name === itemName ? { ...cat, mappedTo } : cat
          )
        : report.categories,
      tags: type === 'tag'
        ? report.tags.map(tag => 
            tag.name === itemName ? { ...tag, mappedTo } : tag
          )
        : report.tags,
    };
    
    setReport(updatedReport);
    await persistReport(updatedReport);
  }, [report, persistReport]);

  // Handler for updating conflict resolution for a specific post/page
  const handleConflictResolutionChange = useCallback(async (
    section: 'posts' | 'pages',
    slug: string,
    resolution: ImportConflictResolution
  ) => {
    if (!report) return;
    
    const updatedReport: AnalysisReport = {
      ...report,
      [section]: {
        ...report[section],
        items: report[section].items.map(item =>
          item.wxrPost.slug === slug && item.status === 'conflict'
            ? { ...item, conflictResolution: resolution }
            : item
        ),
      },
    };
    
    setReport(updatedReport);
    await persistReport(updatedReport);
  }, [report, persistReport]);

  // Load definition via shared entity loader (handles activeProject guard,
  // cancellation on ID change, and close-tab-on-not-found).
  const fetchDefinition = useCallback(
    (id: string) => window.electronAPI?.importDefinitions.get(id) ?? Promise.resolve(null),
    [],
  );
  const { isLoading: isLoadingDefinition } = useEntityLoader(definitionId, fetchDefinition, {
    onLoaded: (def) => {
      setName(def.name);
      setUploadsFolder(def.uploadsFolderPath ?? null);
      setWxrFilePath(def.wxrFilePath ?? null);
      if (def.lastAnalysisResult) {
        const parsed = typeof def.lastAnalysisResult === 'string'
          ? JSON.parse(def.lastAnalysisResult)
          : def.lastAnalysisResult;
        setReport(parsed as AnalysisReport);
      } else {
        setReport(null);
      }
    },
    onReset: () => {
      setName(t('importAnalysis.untitledImport'));
      setUploadsFolder(null);
      setWxrFilePath(null);
      setReport(null);
    },
  });

  const handleNameBlur = useCallback(async () => {
    const trimmed = name.trim() || t('importAnalysis.untitledImport');
    setName(trimmed);
    await window.electronAPI?.importDefinitions.update(definitionId, { name: trimmed });
  }, [definitionId, name]);

  const handleSelectUploadsFolder = useCallback(async () => {
    const folder = await window.electronAPI?.import.selectUploadsFolder();
    if (folder) {
      setUploadsFolder(folder);
      await window.electronAPI?.importDefinitions.update(definitionId, { uploadsFolderPath: folder });
    }
  }, [definitionId]);

  const handleSelectAndAnalyze = useCallback(async () => {
    setIsLoading(true);
    setReport(null);
    setProgressStep('');
    setProgressDetail('');
    try {
      const result = await window.electronAPI?.import.selectAndAnalyze(uploadsFolder || undefined) as AnalysisReport | null;
      if (result) {
        setReport(result);
        setWxrFilePath(result.sourceFile);
        await window.electronAPI?.importDefinitions.update(definitionId, {
          lastAnalysisResult: JSON.stringify(result),
          wxrFilePath: result.sourceFile,
          name: result.site.link || result.site.title || undefined,
        });
      }
    } catch (error) {
      console.error('Import analysis failed:', error);
    } finally {
      setIsLoading(false);
      setProgressStep('');
      setProgressDetail('');
    }
  }, [definitionId, uploadsFolder]);

  const handleExecuteImport = useCallback(async () => {
    if (!report) return;

    // Reset execution state
    setExecutionState({
      isExecuting: true,
      taskId: null,
      phase: t('importAnalysis.executionStarting'),
      current: 0,
      total: 0,
      detail: '',
      eta: null,
      completed: false,
      error: null,
    });

    try {
      const result = await window.electronAPI?.import.execute(
        JSON.stringify(report),
        uploadsFolder || undefined
      );
      
      if (result) {
        setExecutionState(prev => ({
          ...prev,
          taskId: result.taskId,
          total: result.totalItems,
        }));
      }
    } catch (error) {
      console.error('Import execution failed:', error);
      setExecutionState(prev => ({
        ...prev,
        isExecuting: false,
        error: error instanceof Error ? error.message : t('importAnalysis.unknownError'),
      }));
    }
  }, [report, uploadsFolder]);

  // Calculate how many items will be imported
  // Note: 'update' and 'content-duplicate' are SKIPPED - only 'new' and resolved conflicts are imported
  const getImportableCount = useCallback(() => {
    if (!report) return { posts: 0, media: 0, pages: 0, tags: 0 };
    
    const postsToImport = report.posts.items.filter(p => 
      p.status === 'new' || 
      (p.status === 'conflict' && p.conflictResolution && p.conflictResolution !== 'ignore')
    ).length;
    
    const mediaToImport = report.media.items.filter(m => 
      m.status === 'new'
    ).length;
    
    const pagesToImport = report.pages.items.filter(p => 
      p.status === 'new' || 
      (p.status === 'conflict' && p.conflictResolution && p.conflictResolution !== 'ignore')
    ).length;
    
    const tagsToImport = report.tags.filter(t => !t.existsInProject).length +
      report.categories.filter(c => !c.existsInProject).length;
    
    return { posts: postsToImport, media: mediaToImport, pages: pagesToImport, tags: tagsToImport };
  }, [report]);

  // Calculate date distribution for posts and media
  const getDateDistribution = useCallback(() => {
    if (!report) return { posts: {}, media: {} };
    
    const postsDistrib: Record<number, number> = {};
    const mediaDistrib: Record<number, number> = {};
    
    for (const item of report.posts.items) {
      const date = item.wxrPost.postDate || item.wxrPost.pubDate;
      if (date) {
        const year = new Date(date).getFullYear();
        postsDistrib[year] = (postsDistrib[year] || 0) + 1;
      }
    }
    
    for (const item of report.pages.items) {
      const date = item.wxrPost.postDate || item.wxrPost.pubDate;
      if (date) {
        const year = new Date(date).getFullYear();
        postsDistrib[year] = (postsDistrib[year] || 0) + 1;
      }
    }
    
    for (const item of report.media.items) {
      const date = item.wxrMedia.pubDate;
      if (date) {
        const year = new Date(date).getFullYear();
        mediaDistrib[year] = (mediaDistrib[year] || 0) + 1;
      }
    }
    
    return { posts: postsDistrib, media: mediaDistrib };
  }, [report]);

  const toggleSection = useCallback((section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  if (isLoadingDefinition) {
    return (
      <div className="import-analysis">
        <div className="import-loading">
          <div className="import-spinner" />
          {t('importAnalysis.loadingDefinition')}
        </div>
      </div>
    );
  }

  return (
    <div className="import-analysis">
      <div className="import-analysis-header">
        <input
          ref={nameInputRef}
          className="import-definition-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleNameBlur}
          onKeyDown={(e) => { if (e.key === 'Enter') nameInputRef.current?.blur(); }}
          placeholder={t('importAnalysis.namePlaceholder')}
        />
        <p>{t('importAnalysis.headerDescription')}</p>
      </div>

      <div className="import-file-selectors">
        <div className="import-file-row">
          <label>{t('importAnalysis.uploadsFolder')}</label>
          <div className={`import-file-path ${!uploadsFolder ? 'placeholder' : ''}`}>
            {uploadsFolder || t('importAnalysis.noFolderSelected')}
          </div>
          <button onClick={handleSelectUploadsFolder}>{t('settings.project.browse')}...</button>
        </div>
        <div className="import-file-row">
          <label>{t('importAnalysis.wxrFile')}</label>
          <div className={`import-file-path ${!wxrFilePath ? 'placeholder' : ''}`}>
            {wxrFilePath || report?.sourceFile || t('importAnalysis.selectFileToAnalyze')}
          </div>
          <button
            className="import-analyze-btn"
            onClick={handleSelectAndAnalyze}
            disabled={isLoading}
          >
            {isLoading ? t('importAnalysis.analyzing') : t('importAnalysis.selectAndAnalyze')}
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="import-loading">
          <div className="import-spinner" />
          <div className="import-progress">
            <div className="import-progress-step">{progressStep || t('importAnalysis.analyzingWxr')}</div>
            {progressDetail && <div className="import-progress-detail">{progressDetail}</div>}
          </div>
        </div>
      )}

      {!report && !isLoading && (
        <div className="import-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
          <p>{t('importAnalysis.emptyState')}</p>
        </div>
      )}

      {report && !isLoading && (
        <>
          <SiteInfoCard site={report.site} sourceFile={report.sourceFile} />
          <StatCards report={report} />
          <DateDistributionCard distribution={getDateDistribution()} />

          {/* Execution Progress */}
          {executionState.isExecuting && (
            <div className="import-execution-progress">
              <div className="import-execution-header">
                <h3>{t('importAnalysis.importing')}</h3>
                {executionState.eta !== null && executionState.eta > 0 && (
                  <span className="import-eta">{formatEta(executionState.eta)}</span>
                )}
              </div>
              <div className="import-progress-bar">
                <div 
                  className="import-progress-fill" 
                  style={{ width: `${executionState.total > 0 ? (executionState.current / executionState.total) * 100 : 0}%` }}
                />
              </div>
              <div className="import-progress-info">
                <span className="import-phase">{executionState.phase}</span>
                {executionState.detail && <span className="import-detail">{executionState.detail}</span>}
                <span className="import-counter">{executionState.current} / {executionState.total}</span>
              </div>
            </div>
          )}

          {/* Execution Complete */}
          {executionState.completed && (
            <div className="import-execution-complete">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
              <span>{t('importAnalysis.importComplete')}</span>
            </div>
          )}

          {/* Execution Error */}
          {executionState.error && (
            <div className="import-execution-error">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              <span>{t('importAnalysis.importFailed', { error: executionState.error })}</span>
            </div>
          )}

          {/* Execute Button */}
          {!executionState.isExecuting && !executionState.completed && (
            (() => {
              const counts = getImportableCount();
              const totalImportable = counts.posts + counts.media + counts.pages + counts.tags;
              return (
                <div className="import-execute-section">
                  <div className="import-execute-summary">
                    {t('importAnalysis.readyToImport')}
                    {counts.tags > 0 && <span className="import-count-tag">{counts.tags} {t('importAnalysis.tagsCategories')}</span>}
                    {counts.posts > 0 && <span className="import-count-tag">{counts.posts} {t('importAnalysis.posts')}</span>}
                    {counts.media > 0 && <span className="import-count-tag">{counts.media} {t('importAnalysis.media')}</span>}
                    {counts.pages > 0 && <span className="import-count-tag">{counts.pages} {t('importAnalysis.pages')}</span>}
                  </div>
                  <button
                    className="import-execute-btn"
                    onClick={handleExecuteImport}
                    disabled={totalImportable === 0}
                  >
                    {totalImportable === 0
                      ? t('importAnalysis.nothingToImport')
                      : t('importAnalysis.importItems', { count: totalImportable })}
                  </button>
                </div>
              );
            })()
          )}

          {report.posts.conflicts > 0 && (
            <ConflictsSection
              title={t('importAnalysis.postSlugConflicts')}
              items={report.posts.items.filter(i => i.status === 'conflict')}
              expanded={expandedSections['post-conflicts'] ?? true}
              onToggle={() => toggleSection('post-conflicts')}
              onResolutionChange={(slug, resolution) => handleConflictResolutionChange('posts', slug, resolution)}
            />
          )}

          {report.pages.conflicts > 0 && (
            <ConflictsSection
              title={t('importAnalysis.pageSlugConflicts')}
              items={report.pages.items.filter(i => i.status === 'conflict')}
              expanded={expandedSections['page-conflicts'] ?? true}
              onToggle={() => toggleSection('page-conflicts')}
              onResolutionChange={(slug, resolution) => handleConflictResolutionChange('pages', slug, resolution)}
            />
          )}

          {/* Posts section - only items with postType 'post' */}
          {(() => {
            const postsOnly = report.posts.items.filter(i => i.wxrPost.postType === 'post');
            return postsOnly.length > 0 && (
              <PostDetailSection
                title={t('importAnalysis.postsWithCount', { count: postsOnly.length })}
                items={postsOnly}
                expanded={expandedSections['posts'] ?? false}
                onToggle={() => toggleSection('posts')}
              />
            );
          })()}

          {/* Other post types section */}
          {(() => {
            const otherPosts = report.posts.items.filter(i => i.wxrPost.postType !== 'post');
            return otherPosts.length > 0 && (
              <PostDetailSection
                title={t('importAnalysis.otherWithCount', { count: otherPosts.length })}
                items={otherPosts}
                expanded={expandedSections['other'] ?? false}
                onToggle={() => toggleSection('other')}
                showType
              />
            );
          })()}

          {report.pages.total > 0 && (
            <PostDetailSection
              title={t('importAnalysis.pagesWithCount', { count: report.pages.total })}
              items={report.pages.items}
              expanded={expandedSections['pages'] ?? false}
              onToggle={() => toggleSection('pages')}
            />
          )}

          <MediaDetailSection
            title={t('importAnalysis.mediaWithCount', { count: report.media.total })}
            items={report.media.items}
            expanded={expandedSections['media'] ?? false}
            onToggle={() => toggleSection('media')}
          />

          {(report.categories.length > 0 || report.tags.length > 0) && (
            <TaxonomySection
              categories={report.categories}
              tags={report.tags}
              expanded={expandedSections['taxonomy'] ?? false}
              onToggle={() => toggleSection('taxonomy')}
              onMappingsAnalyzed={handleTaxonomyMappingsUpdated}
              onMappingUpdated={handleSingleMappingUpdated}
            />
          )}

          {report.macros && report.macros.total > 0 && (
            <MacrosSection
              macros={report.macros}
              expanded={expandedSections['macros'] ?? false}
              onToggle={() => toggleSection('macros')}
            />
          )}
        </>
      )}
    </div>
  );
};

const SiteInfoCard: React.FC<{ site: AnalysisReport['site']; sourceFile: string }> = ({ site, sourceFile }) => {
  const { t } = useI18n();

  return <div className="import-site-info">
    <div className="import-site-info-item">
      <span className="info-label">{t('importAnalysis.site')}</span>
      <span className="info-value">{site.title || t('importAnalysis.untitled')}</span>
    </div>
    <div className="import-site-info-item">
      <span className="info-label">{t('importAnalysis.url')}</span>
      <span className="info-value">{site.link || t('importAnalysis.notAvailable')}</span>
    </div>
    <div className="import-site-info-item">
      <span className="info-label">{t('importAnalysis.language')}</span>
      <span className="info-value">{site.language || t('importAnalysis.notAvailable')}</span>
    </div>
    <div className="import-site-info-item">
      <span className="info-label">{t('importAnalysis.file')}</span>
      <span className="info-value">{sourceFile.split(/[/\\]/).pop()}</span>
    </div>
  </div>
  };

const StatCards: React.FC<{ report: AnalysisReport }> = ({ report }) => {
  const { t } = useI18n();
  // Split posts by type
  const postsOnly = report.posts.items.filter(i => i.wxrPost.postType === 'post');
  const otherPosts = report.posts.items.filter(i => i.wxrPost.postType !== 'post');
  
  const postsStats = {
    total: postsOnly.length,
    new: postsOnly.filter(i => i.status === 'new').length,
    updates: postsOnly.filter(i => i.status === 'update').length,
    conflicts: postsOnly.filter(i => i.status === 'conflict').length,
    contentDuplicates: postsOnly.filter(i => i.status === 'content-duplicate').length,
  };
  
  const otherStats = {
    total: otherPosts.length,
    new: otherPosts.filter(i => i.status === 'new').length,
    updates: otherPosts.filter(i => i.status === 'update').length,
    conflicts: otherPosts.filter(i => i.status === 'conflict').length,
    contentDuplicates: otherPosts.filter(i => i.status === 'content-duplicate').length,
  };
  
  // Get unique other post types for display
  const otherTypes = [...new Set(otherPosts.map(i => i.wxrPost.postType))].join(', ');

  return (
    <div className="import-stat-cards">
      <div className="import-stat-card">
        <h3>{t('importAnalysis.posts')}</h3>
        <div className="import-stat-number">{postsStats.total}</div>
        <div className="import-stat-breakdown">
          {postsStats.new > 0 && <span className="import-stat-tag stat-new">{postsStats.new} {t('importAnalysis.new')}</span>}
          {postsStats.updates > 0 && <span className="import-stat-tag stat-update">{postsStats.updates} {t('importAnalysis.update')}</span>}
          {postsStats.conflicts > 0 && <span className="import-stat-tag stat-conflict">{postsStats.conflicts} {t('importAnalysis.conflict')}</span>}
          {postsStats.contentDuplicates > 0 && <span className="import-stat-tag stat-duplicate">{postsStats.contentDuplicates} {t('importAnalysis.duplicate')}</span>}
        </div>
      </div>

      {otherStats.total > 0 && (
        <div className="import-stat-card">
          <h3 title={otherTypes}>{t('importAnalysis.other')}</h3>
          <div className="import-stat-number">{otherStats.total}</div>
          <div className="import-stat-breakdown">
            {otherStats.new > 0 && <span className="import-stat-tag stat-new">{otherStats.new} {t('importAnalysis.new')}</span>}
            {otherStats.updates > 0 && <span className="import-stat-tag stat-update">{otherStats.updates} {t('importAnalysis.update')}</span>}
            {otherStats.conflicts > 0 && <span className="import-stat-tag stat-conflict">{otherStats.conflicts} {t('importAnalysis.conflict')}</span>}
            {otherStats.contentDuplicates > 0 && <span className="import-stat-tag stat-duplicate">{otherStats.contentDuplicates} {t('importAnalysis.duplicate')}</span>}
          </div>
        </div>
      )}

      <div className="import-stat-card">
        <h3>{t('importAnalysis.pages')}</h3>
        <div className="import-stat-number">{report.pages.total}</div>
        <div className="import-stat-breakdown">
          {report.pages.new > 0 && <span className="import-stat-tag stat-new">{report.pages.new} {t('importAnalysis.new')}</span>}
          {report.pages.updates > 0 && <span className="import-stat-tag stat-update">{report.pages.updates} {t('importAnalysis.update')}</span>}
          {report.pages.conflicts > 0 && <span className="import-stat-tag stat-conflict">{report.pages.conflicts} {t('importAnalysis.conflict')}</span>}
          {report.pages.contentDuplicates > 0 && <span className="import-stat-tag stat-duplicate">{report.pages.contentDuplicates} {t('importAnalysis.duplicate')}</span>}
        </div>
      </div>

      <div className="import-stat-card">
        <h3>{t('importAnalysis.media')}</h3>
        <div className="import-stat-number">{report.media.total}</div>
        <div className="import-stat-breakdown">
          {report.media.new > 0 && <span className="import-stat-tag stat-new">{report.media.new} {t('importAnalysis.new')}</span>}
          {report.media.updates > 0 && <span className="import-stat-tag stat-update">{report.media.updates} {t('importAnalysis.update')}</span>}
          {report.media.conflicts > 0 && <span className="import-stat-tag stat-conflict">{report.media.conflicts} {t('importAnalysis.conflict')}</span>}
          {report.media.contentDuplicates > 0 && <span className="import-stat-tag stat-duplicate">{report.media.contentDuplicates} {t('importAnalysis.duplicate')}</span>}
          {report.media.missing > 0 && <span className="import-stat-tag stat-missing">{report.media.missing} {t('importAnalysis.missing')}</span>}
        </div>
      </div>

      <div className="import-stat-card">
        <h3>{t('importAnalysis.categories')}</h3>
        <div className="import-stat-number">{report.categories.length}</div>
        <div className="import-stat-breakdown">
          {report.categories.filter(c => c.existsInProject).length > 0 && (
            <span className="import-stat-tag stat-update">{report.categories.filter(c => c.existsInProject).length} {t('importAnalysis.existing')}</span>
          )}
          {report.categories.filter(c => !c.existsInProject && c.mappedTo).length > 0 && (
            <span className="import-stat-tag stat-mapped">{report.categories.filter(c => !c.existsInProject && c.mappedTo).length} {t('importAnalysis.mapped')}</span>
          )}
          {report.categories.filter(c => !c.existsInProject && !c.mappedTo).length > 0 && (
            <span className="import-stat-tag stat-new">{report.categories.filter(c => !c.existsInProject && !c.mappedTo).length} {t('importAnalysis.new')}</span>
          )}
        </div>
      </div>

      <div className="import-stat-card">
        <h3>{t('importAnalysis.tags')}</h3>
        <div className="import-stat-number">{report.tags.length}</div>
        <div className="import-stat-breakdown">
          {report.tags.filter(t => t.existsInProject).length > 0 && (
            <span className="import-stat-tag stat-update">{report.tags.filter(t => t.existsInProject).length} {t('importAnalysis.existing')}</span>
          )}
          {report.tags.filter(t => !t.existsInProject && t.mappedTo).length > 0 && (
            <span className="import-stat-tag stat-mapped">{report.tags.filter(t => !t.existsInProject && t.mappedTo).length} {t('importAnalysis.mapped')}</span>
          )}
          {report.tags.filter(t => !t.existsInProject && !t.mappedTo).length > 0 && (
            <span className="import-stat-tag stat-new">{report.tags.filter(t => !t.existsInProject && !t.mappedTo).length} {t('importAnalysis.new')}</span>
          )}
        </div>
      </div>
    </div>
  );
};

interface DateDistribution {
  posts: Record<number, number>;
  media: Record<number, number>;
}

const DateDistributionCard: React.FC<{ distribution: DateDistribution }> = ({ distribution }) => {
  const { t } = useI18n();
  const postYears = Object.keys(distribution.posts).map(Number).sort();
  const mediaYears = Object.keys(distribution.media).map(Number).sort();
  const allYears = [...new Set([...postYears, ...mediaYears])].sort();

  if (allYears.length === 0) {
    return null;
  }

  const maxPostCount = Math.max(...Object.values(distribution.posts), 1);
  const maxMediaCount = Math.max(...Object.values(distribution.media), 1);
  const totalPosts = Object.values(distribution.posts).reduce((a, b) => a + b, 0);
  const totalMedia = Object.values(distribution.media).reduce((a, b) => a + b, 0);

  return (
    <div className="import-date-distribution">
      <h3>{t('importAnalysis.dateDistribution')}</h3>
      <div className="distribution-grid">
        <div className="distribution-column">
          <div className="distribution-header">
            <span className="distribution-label">{t('importAnalysis.postsPages')}</span>
            <span className="distribution-total">{totalPosts} {t('importAnalysis.total')}</span>
          </div>
          <div className="distribution-bars">
            {allYears.map(year => {
              const count = distribution.posts[year] || 0;
              const percentage = (count / maxPostCount) * 100;
              return (
                <div key={`post-${year}`} className="distribution-row">
                  <span className="distribution-year">{year}</span>
                  <div className="distribution-bar-container">
                    <div 
                      className="distribution-bar distribution-bar-posts" 
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="distribution-count">{count || '-'}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="distribution-column">
          <div className="distribution-header">
            <span className="distribution-label">{t('importAnalysis.media')}</span>
            <span className="distribution-total">{totalMedia} {t('importAnalysis.total')}</span>
          </div>
          <div className="distribution-bars">
            {allYears.map(year => {
              const count = distribution.media[year] || 0;
              const percentage = (count / maxMediaCount) * 100;
              return (
                <div key={`media-${year}`} className="distribution-row">
                  <span className="distribution-year">{year}</span>
                  <div className="distribution-bar-container">
                    <div 
                      className="distribution-bar distribution-bar-media" 
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="distribution-count">{count || '-'}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper function to format post metadata for tooltip (new post from WXR)
function formatPostTooltip(wxrPost: AnalyzedPostItem['wxrPost'], t: (key: string, params?: Record<string, string | number>) => string): string {
  const lines: string[] = [];
  lines.push(`${t('importAnalysis.wordpressId')}: ${wxrPost.wpId}`);
  lines.push(`${t('importAnalysis.type')}: ${wxrPost.postType}`);
  lines.push(`${t('importAnalysis.author')}: ${wxrPost.creator || t('importAnalysis.unknown')}`);
  if (wxrPost.pubDate) {
    lines.push(`${t('importAnalysis.published')}: ${new Date(wxrPost.pubDate).toLocaleDateString()}`);
  }
  if (wxrPost.excerpt) {
    const shortExcerpt = wxrPost.excerpt.length > 100 
      ? wxrPost.excerpt.substring(0, 100) + '...'
      : wxrPost.excerpt;
    lines.push(`${t('importAnalysis.excerpt')}: ${shortExcerpt}`);
  }
  if (wxrPost.tags.length > 0) {
    lines.push(`${t('importAnalysis.tags')}: ${wxrPost.tags.join(', ')}`);
  }
  return lines.join('\n');
}

// Hover card component for post previews (both new WXR entries and existing posts)
function PostHoverCard({ children, className, metadata, contentPreview, onHover }: {
  children: React.ReactNode;
  className?: string;
  metadata: { title: string; author?: string | null; pubDate?: string | null; categories?: string[]; tags?: string[]; excerpt?: string | null };
  contentPreview?: string | null;
  onHover?: () => void;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);

  const handleMouseEnter = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const cardWidth = 420;
      const cardHeight = 250;
      let top = rect.bottom + 4;
      let left = rect.left;
      // Keep card inside viewport
      if (left + cardWidth > window.innerWidth) {
        left = window.innerWidth - cardWidth - 8;
      }
      if (left < 8) left = 8;
      if (top + cardHeight > window.innerHeight) {
        top = rect.top - cardHeight - 4;
      }
      if (top < 8) top = 8;
      setPos({ top, left });
    }
    setVisible(true);
    onHover?.();
  }, [onHover]);

  return (
    <span
      ref={triggerRef}
      className={className}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div className="post-hover-card" style={{ position: 'fixed', top: pos.top, left: pos.left }}>
          <div className="post-hover-title">{metadata.title}</div>
          <div className="post-hover-meta">
            {metadata.author && <span>{t('importAnalysis.author')}: {metadata.author}</span>}
            {metadata.pubDate && <span>{t('importAnalysis.published')}: {new Date(metadata.pubDate).toLocaleDateString()}</span>}
            {metadata.categories && metadata.categories.length > 0 && <span>{t('importAnalysis.categories')}: {metadata.categories.join(', ')}</span>}
            {metadata.tags && metadata.tags.length > 0 && <span>{t('importAnalysis.tags')}: {metadata.tags.join(', ')}</span>}
            {metadata.excerpt && <span>{t('importAnalysis.excerpt')}: {metadata.excerpt.length > 100 ? metadata.excerpt.substring(0, 100) + '...' : metadata.excerpt}</span>}
          </div>
          {contentPreview !== undefined && (
            <div className="post-hover-content">
              <div className="post-hover-content-label">{t('importAnalysis.content')}</div>
              <div className="post-hover-content-text">
                {contentPreview ? (contentPreview.substring(0, 200) + (contentPreview.length > 200 ? '...' : '')) : t('importAnalysis.loading')}
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  );
}

// Hover card for existing posts — loads everything from DB on hover
function ExistingPostHoverCard({ children, className, postId }: {
  children: React.ReactNode;
  className?: string;
  postId: string;
}) {
  const { t } = useI18n();
  const [postData, setPostData] = useState<{
    title: string; content: string; author?: string; pubDate?: string;
    tags: string[]; categories: string[]; excerpt?: string;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const handleHover = useCallback(async () => {
    if (!loaded) {
      const post = await window.electronAPI?.posts.get(postId);
      if (post) {
        const date = post.publishedAt || post.createdAt;
        setPostData({
          title: post.title,
          content: post.content?.trim().substring(0, 200) || '',
          author: post.author,
          pubDate: date ? new Date(date).toISOString() : undefined,
          tags: post.tags || [],
          categories: post.categories || [],
          excerpt: post.excerpt,
        });
      }
      setLoaded(true);
    }
  }, [postId, loaded]);

  return (
    <PostHoverCard
      className={className}
      metadata={postData || { title: t('importAnalysis.loading') }}
      contentPreview={loaded ? (postData?.content || null) : undefined}
      onHover={handleHover}
    >
      {children}
    </PostHoverCard>
  );
}

// Helper function to format media metadata for tooltip
function formatMediaTooltip(wxrMedia: AnalyzedMediaItem['wxrMedia'], t: (key: string, params?: Record<string, string | number>) => string): string {
  const lines: string[] = [];
  lines.push(`${t('importAnalysis.wordpressId')}: ${wxrMedia.wpId}`);
  lines.push(`${t('importAnalysis.mimeType')}: ${wxrMedia.mimeType || t('importAnalysis.unknown')}`);
  if (wxrMedia.pubDate) {
    lines.push(`${t('importAnalysis.uploaded')}: ${new Date(wxrMedia.pubDate).toLocaleDateString()}`);
  }
  if (wxrMedia.parentId) {
    lines.push(`${t('importAnalysis.parentPostId')}: ${wxrMedia.parentId}`);
  }
  lines.push(`${t('importAnalysis.url')}: ${wxrMedia.url}`);
  if (wxrMedia.description) {
    const shortDesc = wxrMedia.description.length > 100
      ? wxrMedia.description.substring(0, 100) + '...'
      : wxrMedia.description;
    lines.push(`${t('importAnalysis.description')}: ${shortDesc}`);
  }
  return lines.join('\n');
}

const ConflictsSection: React.FC<{
  title: string;
  items: AnalyzedPostItem[];
  expanded: boolean;
  onToggle: () => void;
  onResolutionChange: (slug: string, resolution: ImportConflictResolution) => void;
}> = ({ title, items, expanded, onToggle, onResolutionChange }) => {
  const { t } = useI18n();

  return (
    <div className="import-detail-section conflicts-section">
      <h3 onClick={onToggle}>
        <span className={`toggle-icon ${expanded ? 'open' : ''}`}>&#9654;</span>
        {title} ({items.length})
      </h3>
      {expanded && (
        <table className="import-detail-table conflicts-table">
          <thead>
            <tr>
              <th>{t('importAnalysis.slug')}</th>
              <th>{t('importAnalysis.newEntryWxr')}</th>
              <th>{t('importAnalysis.existingEntry')}</th>
              <th>{t('importAnalysis.resolution')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} className="conflict-row">
                <td className="slug-cell">{item.wxrPost.slug}</td>
                <td className="new-entry-cell">
                  <PostHoverCard
                    className="entry-title tooltip-target"
                    metadata={{ title: item.wxrPost.title, author: item.wxrPost.creator, pubDate: item.wxrPost.pubDate, categories: item.wxrPost.categories, tags: item.wxrPost.tags }}
                    contentPreview={item.markdownPreview}
                  >
                    {item.wxrPost.title}
                  </PostHoverCard>
                  {item.wxrPost.categories.length > 0 && (
                    <span className="entry-categories">
                      {item.wxrPost.categories.join(', ')}
                    </span>
                  )}
                </td>
                <td className="existing-entry-cell">
                  {item.existingPost ? (
                    <ExistingPostHoverCard
                      className="entry-title tooltip-target"
                      postId={item.existingPost.id}
                    >
                      {item.existingPost.title}
                    </ExistingPostHoverCard>
                  ) : (
                    <span className="entry-title">{t('importAnalysis.none')}</span>
                  )}
                </td>
                <td className="resolution-cell">
                  <select
                    className="resolution-select"
                    value={item.conflictResolution || 'ignore'}
                    onChange={(e) => onResolutionChange(item.wxrPost.slug, e.target.value as ImportConflictResolution)}
                  >
                    <option value="ignore">{t('importAnalysis.ignore')}</option>
                    <option value="overwrite">{t('importAnalysis.overwrite')}</option>
                    <option value="import">{t('importAnalysis.importNewSlug')}</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

const PostDetailSection: React.FC<{
  title: string;
  items: AnalyzedPostItem[];
  expanded: boolean;
  onToggle: () => void;
  showType?: boolean;
}> = ({ title, items, expanded, onToggle, showType }) => {
  const { t } = useI18n();

  return (
    <div className="import-detail-section">
      <h3 onClick={onToggle}>
        <span className={`toggle-icon ${expanded ? 'open' : ''}`}>&#9654;</span>
        {title}
      </h3>
      {expanded && (
        <table className="import-detail-table">
          <thead>
            <tr>
              <th>{t('importAnalysis.status')}</th>
              {showType && <th>{t('importAnalysis.type')}</th>}
              <th>{t('importAnalysis.title')}</th>
              <th>{t('importAnalysis.slug')}</th>
              <th>{t('importAnalysis.categories')}</th>
              <th>{t('importAnalysis.wpStatus')}</th>
              <th>{t('importAnalysis.existingMatch')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} className="post-row-with-tooltip" title={formatPostTooltip(item.wxrPost, t)}>
                <td><span className={`status-badge ${item.status}`}>{item.status}</span></td>
                {showType && <td className="post-type-cell">{item.wxrPost.postType}</td>}
                <td>{item.wxrPost.title}</td>
                <td className="slug-cell">{item.wxrPost.slug}</td>
                <td className="categories-cell">
                  {item.wxrPost.categories.length > 0
                    ? item.wxrPost.categories.join(', ')
                    : t('importAnalysis.none')}
                </td>
                <td>{item.wxrPost.status}</td>
                <td className="existing-match">{item.existingPost?.title || t('importAnalysis.none')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

const MediaDetailSection: React.FC<{
  title: string;
  items: AnalyzedMediaItem[];
  expanded: boolean;
  onToggle: () => void;
}> = ({ title, items, expanded, onToggle }) => {
  const { t } = useI18n();

  return (
    <div className="import-detail-section">
      <h3 onClick={onToggle}>
        <span className={`toggle-icon ${expanded ? 'open' : ''}`}>&#9654;</span>
        {title}
      </h3>
      {expanded && (
        <table className="import-detail-table">
          <thead>
            <tr>
              <th>{t('importAnalysis.status')}</th>
              <th>{t('importAnalysis.filename')}</th>
              <th>{t('importAnalysis.type')}</th>
              <th>{t('importAnalysis.path')}</th>
              <th>{t('importAnalysis.existingMatch')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} className="media-row-with-tooltip" title={formatMediaTooltip(item.wxrMedia, t)}>
                <td><span className={`status-badge ${item.status}`}>{item.status}</span></td>
                <td>{item.wxrMedia.filename}</td>
                <td className="mime-type-cell">{item.wxrMedia.mimeType || t('importAnalysis.none')}</td>
                <td className="slug-cell">{item.wxrMedia.relativePath}</td>
                <td className="existing-match">{item.existingMedia?.originalName || t('importAnalysis.none')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

const TaxonomySection: React.FC<{
  categories: TaxonomyItem[];
  tags: TaxonomyItem[];
  expanded: boolean;
  onToggle: () => void;
  onMappingsAnalyzed: (categoryMappings: Record<string, string>, tagMappings: Record<string, string>) => void;
  onMappingUpdated: (type: 'category' | 'tag', itemName: string, mappedTo: string | undefined) => void;
}> = ({ categories, tags, expanded, onToggle, onMappingsAnalyzed, onMappingUpdated }) => {
  const { t } = useI18n();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [availableModels, setAvailableModels] = useState<ChatModel[]>([]);
  const [editingItem, setEditingItem] = useState<{ type: 'category' | 'tag'; name: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const modelSelectorRef = useRef<HTMLDivElement>(null);

  // Load available models and existing taxonomy on mount
  useEffect(() => {
    const loadData = async () => {
      const [modelsResult, tagsResult, categoriesResult] = await Promise.all([
        window.electronAPI?.chat.getAvailableModels(),
        window.electronAPI?.tags.getAll(),
        window.electronAPI?.meta.getCategories(),
      ]);
      if (modelsResult?.models) {
        setAvailableModels(modelsResult.models);
      }
      if (tagsResult) {
        setExistingTags(tagsResult.map(t => t.name));
      }
      if (categoriesResult) {
        setExistingCategories(categoriesResult);
      }
    };
    loadData();
  }, []);

  // Close model selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(e.target as Node)) {
        setShowModelSelector(false);
      }
    };
    if (showModelSelector) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showModelSelector]);

  const handleAnalyze = async (modelId: string) => {
    setShowModelSelector(false);
    setIsAnalyzing(true);
    
    try {
      const result = await window.electronAPI?.chat.analyzeTaxonomy(categories, tags, modelId);
      if (result?.success) {
        onMappingsAnalyzed(result.categoryMappings || {}, result.tagMappings || {});
      } else {
        console.error('Taxonomy analysis failed:', result?.error);
      }
    } catch (error) {
      console.error('Taxonomy analysis error:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleStartEdit = (type: 'category' | 'tag', item: TaxonomyItem) => {
    setEditingItem({ type, name: item.name });
    setEditValue(item.mappedTo || '');
  };

  const handleSaveEdit = (directValue?: string) => {
    if (editingItem) {
      const valueToSave = directValue !== undefined ? directValue : editValue;
      onMappingUpdated(editingItem.type, editingItem.name, valueToSave.trim() || undefined);
      setEditingItem(null);
      setEditValue('');
    }
  };

  const handleClearMapping = (type: 'category' | 'tag', name: string) => {
    onMappingUpdated(type, name, undefined);
  };

  // Build suggestions list: existing project items + import items (deduplicated)
  const categorySuggestions = [...new Set([...existingCategories, ...categories.map(c => c.name)])].sort();
  const tagSuggestions = [...new Set([...existingTags, ...tags.map(t => t.name)])].sort();

  const mappedCategoriesCount = categories.filter(c => c.mappedTo).length;
  const mappedTagsCount = tags.filter(t => t.mappedTo).length;

  return (
    <div className="import-detail-section">
      <h3 onClick={onToggle}>
        <span className={`toggle-icon ${expanded ? 'open' : ''}`}>&#9654;</span>
        {t('importAnalysis.taxonomyTitle')}
        {(mappedCategoriesCount > 0 || mappedTagsCount > 0) && (
          <span className="taxonomy-mapped-count">
            {t('importAnalysis.mappedCount', { count: mappedCategoriesCount + mappedTagsCount })}
          </span>
        )}
      </h3>
      {expanded && (
        <>
          <div className="taxonomy-analyze-row">
            <div className="taxonomy-analyze-dropdown" ref={modelSelectorRef}>
              <button 
                className="taxonomy-analyze-btn"
                onClick={() => setShowModelSelector(!showModelSelector)}
                disabled={isAnalyzing}
              >
                {isAnalyzing ? (
                  <>
                    <span className="import-spinner small" />
                    {t('importAnalysis.analyzing')}
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                    {t('importAnalysis.analyzeWith')}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 4 }}>
                      <path d="M7 10l5 5 5-5z"/>
                    </svg>
                  </>
                )}
              </button>
              {showModelSelector && (
                <div className="taxonomy-model-dropdown">
                  {(() => {
                    const groups: Record<string, ChatModel[]> = {};
                    for (const model of availableModels) {
                      const p = model.provider || 'other';
                      if (!groups[p]) groups[p] = [];
                      groups[p].push(model);
                    }
                    return Object.entries(groups).map(([provider, models]) => (
                      <React.Fragment key={provider}>
                        {Object.keys(groups).length > 1 && (
                          <div className="model-group-header">{provider === 'mistral' ? t('settings.ai.providerMistral') : t('settings.ai.providerOpenCode')}</div>
                        )}
                        {models.map(model => (
                          <button
                            key={model.id}
                            className="taxonomy-model-option"
                            onClick={() => handleAnalyze(model.id)}
                          >
                            {model.name}
                          </button>
                        ))}
                      </React.Fragment>
                    ));
                  })()}
                </div>
              )}
            </div>
            <span className="taxonomy-analyze-hint">
              {t('importAnalysis.aiMappingHint')}
            </span>
          </div>
          
          {categories.length > 0 && (
            <div style={{ marginBottom: 12, marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--vscode-descriptionForeground)', marginBottom: 6 }}>
                {t('importAnalysis.categories')}
              </div>
              <div className="import-taxonomy-list">
                {categories.map((cat, idx) => (
                  <TaxonomyPill
                    key={idx}
                    item={cat}
                    type="category"
                    isEditing={editingItem?.type === 'category' && editingItem?.name === cat.name}
                    editValue={editValue}
                    suggestions={categorySuggestions}
                    onEditValueChange={setEditValue}
                    onStartEdit={() => handleStartEdit('category', cat)}
                    onSaveEdit={handleSaveEdit}
                    onCancelEdit={() => setEditingItem(null)}
                    onClearMapping={() => handleClearMapping('category', cat.name)}
                  />
                ))}
              </div>
            </div>
          )}
          {tags.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--vscode-descriptionForeground)', marginBottom: 6 }}>
                {t('importAnalysis.tags')}
              </div>
              <div className="import-taxonomy-list">
                {tags.map((tag, idx) => (
                  <TaxonomyPill
                    key={idx}
                    item={tag}
                    type="tag"
                    isEditing={editingItem?.type === 'tag' && editingItem?.name === tag.name}
                    editValue={editValue}
                    suggestions={tagSuggestions}
                    onEditValueChange={setEditValue}
                    onStartEdit={() => handleStartEdit('tag', tag)}
                    onSaveEdit={handleSaveEdit}
                    onCancelEdit={() => setEditingItem(null)}
                    onClearMapping={() => handleClearMapping('tag', tag.name)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const TaxonomyPill: React.FC<{
  item: TaxonomyItem;
  type: 'category' | 'tag';
  isEditing: boolean;
  editValue: string;
  suggestions: string[];
  onEditValueChange: (value: string) => void;
  onStartEdit: () => void;
  onSaveEdit: (directValue?: string) => void;
  onCancelEdit: () => void;
  onClearMapping: () => void;
}> = ({ item, type: _type, isEditing, editValue, suggestions, onEditValueChange, onStartEdit, onSaveEdit, onCancelEdit, onClearMapping }) => {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showDropdown, setShowDropdown] = useState(false);

  // Filter suggestions based on input, exclude current item name
  const filteredSuggestions = suggestions.filter(s => 
    s.toLowerCase() !== item.name.toLowerCase() && 
    s.toLowerCase().includes(editValue.toLowerCase())
  );

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      setShowDropdown(true);
      setSelectedIndex(-1);
    }
  }, [isEditing]);

  // Reset selection when filtered results change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [editValue]);

  const handleSelectSuggestion = (suggestion: string) => {
    setShowDropdown(false);
    onSaveEdit(suggestion);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => 
        prev < filteredSuggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < filteredSuggestions.length) {
        handleSelectSuggestion(filteredSuggestions[selectedIndex]);
      } else {
        onSaveEdit();
      }
    } else if (e.key === 'Escape') {
      onCancelEdit();
    } else if (e.key === 'Tab') {
      // Allow tab to close dropdown and save
      setShowDropdown(false);
    }
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Check if focus is moving to the dropdown
    if (dropdownRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }
    // Small delay to allow click on dropdown item
    setTimeout(() => {
      setShowDropdown(false);
      onSaveEdit();
    }, 150);
  };

  if (isEditing) {
    return (
      <span className="import-taxonomy-pill editing">
        <span className="pill-name">{item.name}</span>
        <span className="pill-arrow">→</span>
        <div className="pill-edit-container">
          <input
            ref={inputRef}
            type="text"
            className="pill-edit-input"
            value={editValue}
            onChange={(e) => {
              onEditValueChange(e.target.value);
              setShowDropdown(true);
            }}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            onFocus={() => setShowDropdown(true)}
            placeholder={t('importAnalysis.mapToPlaceholder')}
          />
          {showDropdown && filteredSuggestions.length > 0 && (
            <div className="pill-suggestions-dropdown" ref={dropdownRef}>
              {filteredSuggestions.slice(0, 10).map((suggestion, idx) => (
                <button
                  key={suggestion}
                  className={`pill-suggestion-item ${idx === selectedIndex ? 'selected' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectSuggestion(suggestion);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
      </span>
    );
  }

  const hasMaping = !!item.mappedTo;
  const className = `import-taxonomy-pill ${item.existsInProject ? 'exists' : 'new-tax'} ${hasMaping ? 'mapped' : ''}`;

  return (
    <span
      className={className}
      onClick={onStartEdit}
      title={t('importAnalysis.mappingTooltip', {
        action: hasMaping ? t('importAnalysis.mappingActionEdit') : t('importAnalysis.mappingActionAdd'),
      })}
    >
      {item.name}
      {hasMaping && (
        <>
          <span className="pill-arrow">→</span>
          <span className="pill-mapped-to">{item.mappedTo}</span>
          <button 
            className="pill-clear-btn" 
            onClick={(e) => { e.stopPropagation(); onClearMapping(); }}
            title={t('importAnalysis.clearMapping')}
          >
            ×
          </button>
        </>
      )}
    </span>
  );
};

/**
 * MacrosSection - Shows discovered macros from import content
 * Displays macro names, their different usages (parameters), and validation status
 */
const MacrosSection: React.FC<{
  macros: MacroAnalysisSummary;
  expanded: boolean;
  onToggle: () => void;
}> = ({ macros, expanded, onToggle }) => {
  const { t } = useI18n();
  const [expandedMacros, setExpandedMacros] = useState<Set<string>>(new Set());

  const toggleMacro = (name: string) => {
    setExpandedMacros(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  return (
    <div className="import-detail-section">
      <h3 onClick={onToggle}>
        <span className={`toggle-icon ${expanded ? 'open' : ''}`}>&#9654;</span>
        {t('importAnalysis.macrosWithCount', { count: macros.total })}
        <span className="macro-summary-counts">
          <span className="mapped-count">{t('importAnalysis.mappedCount', { count: macros.mappedCount })}</span>
          {macros.unmappedCount > 0 && (
            <span className="unmapped-count">{t('importAnalysis.unmappedCount', { count: macros.unmappedCount })}</span>
          )}
        </span>
      </h3>
      {expanded && (
        <div className="macros-list">
          {macros.discovered.map(macro => (
            <div key={macro.name} className={`macro-item ${macro.mapped ? 'mapped' : 'unmapped'}`}>
              <div className="macro-header" onClick={() => toggleMacro(macro.name)}>
                <span className={`toggle-icon small ${expandedMacros.has(macro.name) ? 'open' : ''}`}>&#9654;</span>
                <span className="macro-name">[{macro.name}]</span>
                <span className={`macro-status-badge ${macro.mapped ? 'mapped' : 'unmapped'}`}>
                  {macro.mapped ? t('importAnalysis.macroStatusMapped') : t('importAnalysis.macroStatusUnknown')}
                </span>
                <span className="macro-count">{t('importAnalysis.macroUses', { count: macro.totalCount })}</span>
              </div>
              
              {expandedMacros.has(macro.name) && (
                <div className="macro-usages">
                  <div className="macro-usages-header">
                    <span className="macro-posts-label">
                      {t('importAnalysis.usedIn', {
                        items: macro.postSlugs.slice(0, 5).join(', '),
                        more: macro.postSlugs.length > 5
                          ? t('importAnalysis.moreSuffix', { count: macro.postSlugs.length - 5 })
                          : '',
                      })}
                    </span>
                  </div>
                  
                  <div className="macro-usages-list">
                    {macro.usages.map((usage, idx) => (
                      <div 
                        key={idx} 
                        className={`macro-usage ${getValidationClass(usage.validationStatus)}`}
                        title={usage.validationError || ''}
                      >
                        <div className="macro-usage-params">
                          {Object.keys(usage.params).length === 0 ? (
                            <span className="no-params">{t('importAnalysis.noParameters')}</span>
                          ) : (
                            Object.entries(usage.params).map(([key, value]) => (
                              <span key={key} className="macro-param">
                                <span className="param-key">{key}</span>=<span className="param-value">"{value}"</span>
                              </span>
                            ))
                          )}
                        </div>
                        <div className="macro-usage-meta">
                          <span className={`validation-badge ${usage.validationStatus}`}>
                            {usage.validationStatus === 'valid' && '✓'}
                            {usage.validationStatus === 'invalid' && '✗'}
                            {usage.validationStatus === 'unknown' && '?'}
                          </span>
                          <span className="usage-count">×{usage.count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function getValidationClass(status: MacroValidationStatus): string {
  switch (status) {
    case 'valid': return 'valid';
    case 'invalid': return 'invalid';
    case 'unknown': return 'unknown';
  }
}
