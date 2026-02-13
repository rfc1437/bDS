import React, { useState, useCallback } from 'react';
import { useAppStore } from '../../store';
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
}

export const ImportAnalysisView: React.FC = () => {
  const { importAnalysis, importAnalysisLoading, setImportAnalysis, setImportAnalysisLoading } = useAppStore();
  const [uploadsFolder, setUploadsFolder] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const report = importAnalysis as AnalysisReport | null;

  const handleSelectUploadsFolder = useCallback(async () => {
    const folder = await window.electronAPI?.import.selectUploadsFolder();
    if (folder) {
      setUploadsFolder(folder);
    }
  }, []);

  const handleSelectAndAnalyze = useCallback(async () => {
    setImportAnalysisLoading(true);
    setImportAnalysis(null);
    try {
      const result = await window.electronAPI?.import.selectAndAnalyze(uploadsFolder || undefined);
      if (result) {
        setImportAnalysis(result);
      }
    } catch (error) {
      console.error('Import analysis failed:', error);
    } finally {
      setImportAnalysisLoading(false);
    }
  }, [uploadsFolder, setImportAnalysis, setImportAnalysisLoading]);

  const toggleSection = useCallback((section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  return (
    <div className="import-analysis">
      <div className="import-analysis-header">
        <h2>Import Analysis</h2>
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
          <div className={`import-file-path ${!report ? 'placeholder' : ''}`}>
            {report?.sourceFile || 'Select a file to analyze'}
          </div>
          <button
            className="import-analyze-btn"
            onClick={handleSelectAndAnalyze}
            disabled={importAnalysisLoading}
          >
            {importAnalysisLoading ? 'Analyzing...' : 'Select & Analyze'}
          </button>
        </div>
      </div>

      {importAnalysisLoading && (
        <div className="import-loading">
          <div className="import-spinner" />
          Analyzing WXR file...
        </div>
      )}

      {!report && !importAnalysisLoading && (
        <div className="import-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
          <p>Select a WordPress export file to begin analysis.</p>
        </div>
      )}

      {report && !importAnalysisLoading && (
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
        {report.categories.filter(c => !c.existsInProject).length > 0 && (
          <span className="import-stat-tag stat-new">{report.categories.filter(c => !c.existsInProject).length} new</span>
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
        {report.tags.filter(t => !t.existsInProject).length > 0 && (
          <span className="import-stat-tag stat-new">{report.tags.filter(t => !t.existsInProject).length} new</span>
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
}> = ({ categories, tags, expanded, onToggle }) => (
  <div className="import-detail-section">
    <h3 onClick={onToggle}>
      <span className={`toggle-icon ${expanded ? 'open' : ''}`}>&#9654;</span>
      Categories & Tags
    </h3>
    {expanded && (
      <>
        {categories.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--vscode-descriptionForeground)', marginBottom: 6 }}>
              Categories
            </div>
            <div className="import-taxonomy-list">
              {categories.map((cat, idx) => (
                <span key={idx} className={`import-taxonomy-pill ${cat.existsInProject ? 'exists' : 'new-tax'}`}>
                  {cat.name}
                </span>
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
                <span key={idx} className={`import-taxonomy-pill ${tag.existsInProject ? 'exists' : 'new-tax'}`}>
                  {tag.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </>
    )}
  </div>
);
