import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { ChatModel } from '../../types/electron';
import './ImportAnalysisView.css';

interface AnalysisReport {
  sourceFile: string;
  site: { title: string; link: string; description: string; language: string };
  analyzedAt: string;
  posts: ItemSection;
  pages: ItemSection;
  media: MediaSection;
  categories: TaxonomyItem[];
  tags: TaxonomyItem[];
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
  wxrPost: { wpId: number; title: string; slug: string; status: string };
  status: string;
  contentHash: string;
  markdownPreview: string;
  existingPost?: { id: string; title: string; slug: string };
}

interface AnalyzedMediaItem {
  wxrMedia: { wpId: number; title: string; filename: string; url: string; relativePath: string };
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

interface ImportAnalysisViewProps {
  definitionId: string;
}

export const ImportAnalysisView: React.FC<ImportAnalysisViewProps> = ({ definitionId }) => {
  const [name, setName] = useState('Untitled Import');
  const [uploadsFolder, setUploadsFolder] = useState<string | null>(null);
  const [wxrFilePath, setWxrFilePath] = useState<string | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDefinition, setIsLoadingDefinition] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const nameInputRef = useRef<HTMLInputElement>(null);

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

  // Load definition on mount
  useEffect(() => {
    const load = async () => {
      setIsLoadingDefinition(true);
      try {
        const def = await window.electronAPI?.importDefinitions.get(definitionId);
        if (def) {
          setName(def.name);
          if (def.uploadsFolderPath) setUploadsFolder(def.uploadsFolderPath);
          if (def.wxrFilePath) setWxrFilePath(def.wxrFilePath);
          if (def.lastAnalysisResult) {
            const parsed = typeof def.lastAnalysisResult === 'string'
              ? JSON.parse(def.lastAnalysisResult)
              : def.lastAnalysisResult;
            setReport(parsed as AnalysisReport);
          }
        }
      } catch (error) {
        console.error('Failed to load import definition:', error);
      } finally {
        setIsLoadingDefinition(false);
      }
    };
    load();
  }, [definitionId]);

  const handleNameBlur = useCallback(async () => {
    const trimmed = name.trim() || 'Untitled Import';
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
    try {
      const result = await window.electronAPI?.import.selectAndAnalyze(uploadsFolder || undefined) as AnalysisReport | null;
      if (result) {
        setReport(result);
        setWxrFilePath(result.sourceFile);
        await window.electronAPI?.importDefinitions.update(definitionId, {
          lastAnalysisResult: JSON.stringify(result),
          wxrFilePath: result.sourceFile,
        });
      }
    } catch (error) {
      console.error('Import analysis failed:', error);
    } finally {
      setIsLoading(false);
    }
  }, [definitionId, uploadsFolder]);

  const toggleSection = useCallback((section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  if (isLoadingDefinition) {
    return (
      <div className="import-analysis">
        <div className="import-loading">
          <div className="import-spinner" />
          Loading import definition...
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
          placeholder="Import name..."
        />
        <p>Select a WordPress export file (WXR) and an uploads folder to analyze what would be imported.</p>
      </div>

      <div className="import-file-selectors">
        <div className="import-file-row">
          <label>Uploads Folder</label>
          <div className={`import-file-path ${!uploadsFolder ? 'placeholder' : ''}`}>
            {uploadsFolder || 'No folder selected'}
          </div>
          <button onClick={handleSelectUploadsFolder}>Browse...</button>
        </div>
        <div className="import-file-row">
          <label>WXR File</label>
          <div className={`import-file-path ${!wxrFilePath ? 'placeholder' : ''}`}>
            {wxrFilePath || report?.sourceFile || 'Select a file to analyze'}
          </div>
          <button
            className="import-analyze-btn"
            onClick={handleSelectAndAnalyze}
            disabled={isLoading}
          >
            {isLoading ? 'Analyzing...' : 'Select & Analyze'}
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="import-loading">
          <div className="import-spinner" />
          Analyzing WXR file...
        </div>
      )}

      {!report && !isLoading && (
        <div className="import-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
          <p>Select a WordPress export file to begin analysis.</p>
        </div>
      )}

      {report && !isLoading && (
        <>
          <SiteInfoCard site={report.site} sourceFile={report.sourceFile} />
          <StatCards report={report} />

          {report.posts.conflicts > 0 && (
            <ConflictsSection
              title="Post Slug Conflicts"
              items={report.posts.items.filter(i => i.status === 'conflict')}
              expanded={expandedSections['post-conflicts'] ?? true}
              onToggle={() => toggleSection('post-conflicts')}
            />
          )}

          {report.pages.conflicts > 0 && (
            <ConflictsSection
              title="Page Slug Conflicts"
              items={report.pages.items.filter(i => i.status === 'conflict')}
              expanded={expandedSections['page-conflicts'] ?? true}
              onToggle={() => toggleSection('page-conflicts')}
            />
          )}

          <PostDetailSection
            title={`Posts (${report.posts.total})`}
            items={report.posts.items}
            expanded={expandedSections['posts'] ?? false}
            onToggle={() => toggleSection('posts')}
          />

          {report.pages.total > 0 && (
            <PostDetailSection
              title={`Pages (${report.pages.total})`}
              items={report.pages.items}
              expanded={expandedSections['pages'] ?? false}
              onToggle={() => toggleSection('pages')}
            />
          )}

          <MediaDetailSection
            title={`Media (${report.media.total})`}
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
        </>
      )}
    </div>
  );
};

const SiteInfoCard: React.FC<{ site: AnalysisReport['site']; sourceFile: string }> = ({ site, sourceFile }) => (
  <div className="import-site-info">
    <div className="import-site-info-item">
      <span className="info-label">Site</span>
      <span className="info-value">{site.title || 'Untitled'}</span>
    </div>
    <div className="import-site-info-item">
      <span className="info-label">URL</span>
      <span className="info-value">{site.link || 'N/A'}</span>
    </div>
    <div className="import-site-info-item">
      <span className="info-label">Language</span>
      <span className="info-value">{site.language || 'N/A'}</span>
    </div>
    <div className="import-site-info-item">
      <span className="info-label">File</span>
      <span className="info-value">{sourceFile.split(/[/\\]/).pop()}</span>
    </div>
  </div>
);

const StatCards: React.FC<{ report: AnalysisReport }> = ({ report }) => (
  <div className="import-stat-cards">
    <div className="import-stat-card">
      <h3>Posts</h3>
      <div className="import-stat-number">{report.posts.total}</div>
      <div className="import-stat-breakdown">
        {report.posts.new > 0 && <span className="import-stat-tag stat-new">{report.posts.new} new</span>}
        {report.posts.updates > 0 && <span className="import-stat-tag stat-update">{report.posts.updates} update</span>}
        {report.posts.conflicts > 0 && <span className="import-stat-tag stat-conflict">{report.posts.conflicts} conflict</span>}
        {report.posts.contentDuplicates > 0 && <span className="import-stat-tag stat-duplicate">{report.posts.contentDuplicates} duplicate</span>}
      </div>
    </div>

    <div className="import-stat-card">
      <h3>Pages</h3>
      <div className="import-stat-number">{report.pages.total}</div>
      <div className="import-stat-breakdown">
        {report.pages.new > 0 && <span className="import-stat-tag stat-new">{report.pages.new} new</span>}
        {report.pages.updates > 0 && <span className="import-stat-tag stat-update">{report.pages.updates} update</span>}
        {report.pages.conflicts > 0 && <span className="import-stat-tag stat-conflict">{report.pages.conflicts} conflict</span>}
        {report.pages.contentDuplicates > 0 && <span className="import-stat-tag stat-duplicate">{report.pages.contentDuplicates} duplicate</span>}
      </div>
    </div>

    <div className="import-stat-card">
      <h3>Media</h3>
      <div className="import-stat-number">{report.media.total}</div>
      <div className="import-stat-breakdown">
        {report.media.new > 0 && <span className="import-stat-tag stat-new">{report.media.new} new</span>}
        {report.media.updates > 0 && <span className="import-stat-tag stat-update">{report.media.updates} update</span>}
        {report.media.conflicts > 0 && <span className="import-stat-tag stat-conflict">{report.media.conflicts} conflict</span>}
        {report.media.contentDuplicates > 0 && <span className="import-stat-tag stat-duplicate">{report.media.contentDuplicates} duplicate</span>}
        {report.media.missing > 0 && <span className="import-stat-tag stat-missing">{report.media.missing} missing</span>}
      </div>
    </div>

    <div className="import-stat-card">
      <h3>Categories</h3>
      <div className="import-stat-number">{report.categories.length}</div>
      <div className="import-stat-breakdown">
        {report.categories.filter(c => c.existsInProject).length > 0 && (
          <span className="import-stat-tag stat-update">{report.categories.filter(c => c.existsInProject).length} existing</span>
        )}
        {report.categories.filter(c => !c.existsInProject && c.mappedTo).length > 0 && (
          <span className="import-stat-tag stat-mapped">{report.categories.filter(c => !c.existsInProject && c.mappedTo).length} mapped</span>
        )}
        {report.categories.filter(c => !c.existsInProject && !c.mappedTo).length > 0 && (
          <span className="import-stat-tag stat-new">{report.categories.filter(c => !c.existsInProject && !c.mappedTo).length} new</span>
        )}
      </div>
    </div>

    <div className="import-stat-card">
      <h3>Tags</h3>
      <div className="import-stat-number">{report.tags.length}</div>
      <div className="import-stat-breakdown">
        {report.tags.filter(t => t.existsInProject).length > 0 && (
          <span className="import-stat-tag stat-update">{report.tags.filter(t => t.existsInProject).length} existing</span>
        )}
        {report.tags.filter(t => !t.existsInProject && t.mappedTo).length > 0 && (
          <span className="import-stat-tag stat-mapped">{report.tags.filter(t => !t.existsInProject && t.mappedTo).length} mapped</span>
        )}
        {report.tags.filter(t => !t.existsInProject && !t.mappedTo).length > 0 && (
          <span className="import-stat-tag stat-new">{report.tags.filter(t => !t.existsInProject && !t.mappedTo).length} new</span>
        )}
      </div>
    </div>
  </div>
);

const ConflictsSection: React.FC<{
  title: string;
  items: AnalyzedPostItem[];
  expanded: boolean;
  onToggle: () => void;
}> = ({ title, items, expanded, onToggle }) => (
  <div className="import-detail-section">
    <h3 onClick={onToggle}>
      <span className={`toggle-icon ${expanded ? 'open' : ''}`}>&#9654;</span>
      {title} ({items.length})
    </h3>
    {expanded && (
      <table className="import-detail-table">
        <thead>
          <tr>
            <th>Slug</th>
            <th>WXR Title</th>
            <th>Existing Title</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx}>
              <td className="slug-cell">{item.wxrPost.slug}</td>
              <td>{item.wxrPost.title}</td>
              <td className="existing-match">{item.existingPost?.title || '--'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const PostDetailSection: React.FC<{
  title: string;
  items: AnalyzedPostItem[];
  expanded: boolean;
  onToggle: () => void;
}> = ({ title, items, expanded, onToggle }) => (
  <div className="import-detail-section">
    <h3 onClick={onToggle}>
      <span className={`toggle-icon ${expanded ? 'open' : ''}`}>&#9654;</span>
      {title}
    </h3>
    {expanded && (
      <table className="import-detail-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Title</th>
            <th>Slug</th>
            <th>WP Status</th>
            <th>Existing Match</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx}>
              <td><span className={`status-badge ${item.status}`}>{item.status}</span></td>
              <td>{item.wxrPost.title}</td>
              <td className="slug-cell">{item.wxrPost.slug}</td>
              <td>{item.wxrPost.status}</td>
              <td className="existing-match">{item.existingPost?.title || '--'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const MediaDetailSection: React.FC<{
  title: string;
  items: AnalyzedMediaItem[];
  expanded: boolean;
  onToggle: () => void;
}> = ({ title, items, expanded, onToggle }) => (
  <div className="import-detail-section">
    <h3 onClick={onToggle}>
      <span className={`toggle-icon ${expanded ? 'open' : ''}`}>&#9654;</span>
      {title}
    </h3>
    {expanded && (
      <table className="import-detail-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Filename</th>
            <th>Path</th>
            <th>Existing Match</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx}>
              <td><span className={`status-badge ${item.status}`}>{item.status}</span></td>
              <td>{item.wxrMedia.filename}</td>
              <td className="slug-cell">{item.wxrMedia.relativePath}</td>
              <td className="existing-match">{item.existingMedia?.originalName || '--'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const TaxonomySection: React.FC<{
  categories: TaxonomyItem[];
  tags: TaxonomyItem[];
  expanded: boolean;
  onToggle: () => void;
  onMappingsAnalyzed: (categoryMappings: Record<string, string>, tagMappings: Record<string, string>) => void;
  onMappingUpdated: (type: 'category' | 'tag', itemName: string, mappedTo: string | undefined) => void;
}> = ({ categories, tags, expanded, onToggle, onMappingsAnalyzed, onMappingUpdated }) => {
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
        Categories & Tags
        {(mappedCategoriesCount > 0 || mappedTagsCount > 0) && (
          <span className="taxonomy-mapped-count">
            {mappedCategoriesCount + mappedTagsCount} mapped
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
                    Analyzing...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                    Analyze with...
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 4 }}>
                      <path d="M7 10l5 5 5-5z"/>
                    </svg>
                  </>
                )}
              </button>
              {showModelSelector && (
                <div className="taxonomy-model-dropdown">
                  {availableModels.map(model => (
                    <button
                      key={model.id}
                      className="taxonomy-model-option"
                      onClick={() => handleAnalyze(model.id)}
                    >
                      {model.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="taxonomy-analyze-hint">
              AI will suggest mappings to consolidate similar tags and categories
            </span>
          </div>
          
          {categories.length > 0 && (
            <div style={{ marginBottom: 12, marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--vscode-descriptionForeground)', marginBottom: 6 }}>
                Categories
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
                Tags
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
            placeholder="Map to..."
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
    <span className={className} onClick={onStartEdit} title={`Click to ${hasMaping ? 'edit' : 'add'} mapping`}>
      {item.name}
      {hasMaping && (
        <>
          <span className="pill-arrow">→</span>
          <span className="pill-mapped-to">{item.mappedTo}</span>
          <button 
            className="pill-clear-btn" 
            onClick={(e) => { e.stopPropagation(); onClearMapping(); }}
            title="Clear mapping"
          >
            ×
          </button>
        </>
      )}
    </span>
  );
};
