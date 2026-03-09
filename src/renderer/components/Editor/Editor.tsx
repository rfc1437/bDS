import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '../../store';
import { ErrorModal } from '../ErrorModal';
import { ConfirmDeleteModal } from '../ConfirmDeleteModal';
import { SettingsView } from '../SettingsView';
import { StyleView } from '../StyleView/StyleView';
import { TagsView } from '../TagsView';
import { ChatPanel } from '../ChatPanel';
import { ImportAnalysisView } from '../ImportAnalysisView';
import { MenuEditorView } from '../MenuEditorView/MenuEditorView';
import { MetadataDiffPanel } from '../MetadataDiffPanel';
import { GitDiffView } from '../GitDiffView/GitDiffView';
import { DocumentationView } from '../DocumentationView/DocumentationView';
import { SiteValidationView } from '../SiteValidationView';
import { TranslationValidationView } from '../TranslationValidationView';
import { ScriptsView } from '../ScriptsView/ScriptsView';
import { TemplatesView } from '../TemplatesView/TemplatesView';
import { DuplicatesView } from '../DuplicatesView/DuplicatesView';
import { getContrastColor, loadTagColorMap } from '../../utils';
import { openEntityTab } from '../../navigation/tabPolicy';
import { EditorRoute, resolveEditorRoute } from '../../navigation/editorRouting';
import { useI18n } from '../../i18n';
import documentationContent from '../../../../DOCUMENTATION.md?raw';
import apiDocumentationContent from '../../../../API.md?raw';
import { PostEditor } from './PostEditor';
import { MediaEditor } from './MediaEditor';
import { UI_DATE_LOCALE } from './editorUtils';
import './Editor.css';

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

interface DashboardStats {
  totalPosts: number;
  draftCount: number;
  publishedCount: number;
  archivedCount: number;
}

interface TagCount {
  tag: string;
  count: number;
}

interface CategoryCount {
  category: string;
  count: number;
}

const Dashboard: React.FC = () => {
  const { t: tr, language } = useI18n();
  const { posts, media } = useAppStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [yearMonthData, setYearMonthData] = useState<{ year: number; month: number; count: number }[]>([]);
  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);
  const [tagColors, setTagColors] = useState<Map<string, string>>(new Map());
  const [categoryCounts, setCategoryCounts] = useState<CategoryCount[]>([]);

  const uiDateLocale = UI_DATE_LOCALE[language] || UI_DATE_LOCALE.en;
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(uiDateLocale, { month: 'short' }),
    [uiDateLocale]
  );

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [ds, ym, tc, cc, colorMap] = await Promise.all([
          window.electronAPI?.posts.getDashboardStats(),
          window.electronAPI?.posts.getByYearMonth(),
          window.electronAPI?.posts.getTagsWithCounts(),
          window.electronAPI?.posts.getCategoriesWithCounts(),
          loadTagColorMap(),
        ]);
        if (ds) setStats(ds);
        if (ym) setYearMonthData(ym);
        if (tc) setTagCounts(tc);
        if (cc) setCategoryCounts(cc);
        setTagColors(colorMap);
      } catch (e) {
        console.error('Failed to load dashboard stats:', e);
      }
    };
    loadStats();
  }, [posts.length, media.length]);

  // Media stats
  const totalMediaSize = media.reduce((sum, m) => sum + (m.size || 0), 0);
  const imageCount = media.filter(m => m.mimeType?.startsWith('image/')).length;

  // Recent posts (last 5 updated)
  const recentPosts = useMemo(() =>
    [...posts].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 5),
    [posts]
  );

  // Timeline chart - last 12 months that have posts
  const timelineEntries = useMemo(() => {
    const sorted = [...yearMonthData].sort((a, b) => a.year === b.year ? a.month - b.month : a.year - b.year);
    return sorted.slice(-12);
  }, [yearMonthData]);
  const maxCount = Math.max(1, ...timelineEntries.map(e => e.count));

  // Tag cloud font sizing
  const tagCloudItems = useMemo(() => {
    if (tagCounts.length === 0) return [];
    const items = tagCounts.slice(0, 40);
    const maxTagCount = Math.max(1, ...items.map(t => t.count));
    const minTagCount = Math.min(...items.map(t => t.count));
    const range = Math.max(1, maxTagCount - minTagCount);
    // Font sizes from 11px to 22px
    return items.map(t => ({
      ...t,
      fontSize: 11 + ((t.count - minTagCount) / range) * 11,
      color: tagColors.get(t.tag),
    })).sort((a, b) => a.tag.localeCompare(b.tag)); // alphabetical for cloud layout
  }, [tagCounts, tagColors]);

  const displayTotalPosts = stats?.totalPosts ?? posts.length;
  const displayDraftCount = stats?.draftCount ?? 0;
  const displayPublishedCount = stats?.publishedCount ?? 0;
  const displayArchivedCount = stats?.archivedCount ?? 0;

  const getPostCountLabel = useCallback((count: number) => {
    return tr(count === 1 ? 'dashboard.postCount.one' : 'dashboard.postCount.other', { count });
  }, [tr]);

  const getPostStatusLabel = useCallback((status: string) => {
    const statusKeyByValue: Record<string, string> = {
      draft: 'dashboard.status.draft',
      published: 'dashboard.status.published',
      archived: 'dashboard.status.archived',
    };
    const key = statusKeyByValue[status];
    return key ? tr(key) : status;
  }, [tr]);

  return (
    <div className="editor-empty">
      <div className="dashboard-content">
        <h1>{tr('dashboard.title')}</h1>
        <p className="text-muted">{tr('dashboard.subtitle')}</p>

        <div className="dashboard-stats">
          <div className="stat-card">
            <div className="stat-number">{displayTotalPosts}</div>
            <div className="stat-label">{tr('dashboard.stats.totalPosts')}</div>
            <div className="stat-breakdown">
              <span className="stat-tag stat-published">{tr('dashboard.stats.published', { count: displayPublishedCount })}</span>
              <span className="stat-tag stat-draft">{tr('dashboard.stats.drafts', { count: displayDraftCount })}</span>
              {displayArchivedCount > 0 && <span className="stat-tag stat-archived">{tr('dashboard.stats.archived', { count: displayArchivedCount })}</span>}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{media.length}</div>
            <div className="stat-label">{tr('dashboard.stats.mediaFiles')}</div>
            <div className="stat-breakdown">
              <span className="stat-tag">{tr('dashboard.stats.images', { count: imageCount })}</span>
              <span className="stat-tag">{formatBytes(totalMediaSize)}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{tagCounts.length}</div>
            <div className="stat-label">{tr('dashboard.stats.tags')}</div>
            <div className="stat-breakdown">
              <span className="stat-tag">{tr('dashboard.stats.categories', { count: categoryCounts.length })}</span>
            </div>
          </div>
        </div>

        {timelineEntries.length > 0 && (
          <div className="dashboard-section">
            <h4>{tr('dashboard.section.postsOverTime')}</h4>
            <div className="timeline-chart">
              {timelineEntries.map((entry) => (
                <div key={`${entry.year}-${entry.month}`} className="timeline-bar-container">
                  <div className="timeline-bar" style={{ height: `${(entry.count / maxCount) * 100}%` }}>
                    <span className="timeline-bar-count">{entry.count}</span>
                  </div>
                  <div className="timeline-bar-label">
                    <span className="timeline-bar-label-month">{monthFormatter.format(new Date(entry.year, entry.month - 1, 1))}</span>
                    <span className="timeline-bar-label-year">{entry.year}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tagCloudItems.length > 0 && (
          <div className="dashboard-section">
            <h4>{tr('dashboard.section.tags')}</h4>
            <div className="tag-cloud">
              {tagCloudItems.map(item => {
                const hasColor = !!item.color;
                const style: React.CSSProperties = hasColor
                  ? {
                      fontSize: `${item.fontSize}px`,
                      backgroundColor: item.color,
                      color: getContrastColor(item.color!),
                    }
                  : { fontSize: `${item.fontSize}px` };
                return (
                  <span
                    key={item.tag}
                    className={`dashboard-tag ${hasColor ? 'has-color' : ''}`}
                    style={style}
                    title={getPostCountLabel(item.count)}
                  >
                    {item.tag}
                  </span>
                );
              })}
              {tagCounts.length > 40 && <span className="text-muted tag-cloud-more">{tr('dashboard.tagCloud.more', { count: tagCounts.length - 40 })}</span>}
            </div>
          </div>
        )}

        {categoryCounts.length > 0 && (
          <div className="dashboard-section">
            <h4>{tr('dashboard.section.categories')}</h4>
            <div className="tag-cloud">
              {categoryCounts.map(cat => (
                <span
                  key={cat.category}
                  className="dashboard-tag dashboard-category"
                  title={getPostCountLabel(cat.count)}
                >
                  {cat.category} <span className="tag-count">{cat.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {recentPosts.length > 0 && (
          <div className="dashboard-section">
            <h4>{tr('dashboard.section.recentlyUpdated')}</h4>
            <div className="recent-posts-list">
              {recentPosts.map(post => (
                <div
                  key={post.id}
                  className="recent-post-item"
                  onClick={() => {
                    useAppStore.getState().setActiveView('posts');
                    useAppStore.getState().setSelectedPost(post.id);
                    openEntityTab(useAppStore.getState().openTab, 'post', post.id, 'preview');
                  }}
                  onDoubleClick={() => {
                    useAppStore.getState().setActiveView('posts');
                    useAppStore.getState().setSelectedPost(post.id);
                    openEntityTab(useAppStore.getState().openTab, 'post', post.id, 'pin');
                  }}
                >
                  <span className="recent-post-title">{post.title || tr('editor.untitled')}</span>
                  <span className={`recent-post-status status-${post.status}`}>{getPostStatusLabel(post.status)}</span>
                  <span className="recent-post-date">{new Date(post.updatedAt).toLocaleDateString(uiDateLocale)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const Editor: React.FC = () => {
  const {
    activeView,
    selectedPostId,
    selectedMediaId,
    tabs,
    activeTabId,
    posts,
    media,
    errorModal,
    hideErrorModal,
    confirmDeleteModal,
    hideConfirmDeleteModal,
    isLoading,
    setSelectedPost,
    setSelectedMedia,
    closeTab,
  } = useAppStore();

  // Get the active tab
  const activeTab = tabs.find(t => t.id === activeTabId);

  const editorRoute = resolveEditorRoute(activeTab);

  useEffect(() => {
    const activePostId = activeTab?.type === 'post' ? activeTab.id : null;
    window.electronAPI?.app.setPreviewPostTarget(activePostId).catch((error) => {
      console.error('Failed to sync preview post target:', error);
    });
  }, [activeTab]);

  // Clear selectedPostId if the post doesn't exist (e.g., after project switch)
  useEffect(() => {
    if (activeView === 'posts' && selectedPostId && !isLoading) {
      window.electronAPI?.posts.get(selectedPostId).then(post => {
        if (!post) {
          setSelectedPost(null);
        }
      });
    }
  }, [activeView, selectedPostId, isLoading, setSelectedPost]);

  // Clear selectedMediaId if the media doesn't exist (e.g., after project switch)
  useEffect(() => {
    if (activeView === 'media' && selectedMediaId && !isLoading) {
      const mediaExists = media.some(m => m.id === selectedMediaId);
      if (!mediaExists) {
        setSelectedMedia(null);
      }
    }
  }, [activeView, selectedMediaId, media, isLoading, setSelectedMedia]);

  // Close media tab if the media doesn't exist anymore
  useEffect(() => {
    if (activeTab && !isLoading) {
      if (activeTab.type === 'media') {
        const mediaExists = media.some(m => m.id === activeTab.id);
        if (!mediaExists) {
          closeTab(activeTab.id);
        }
      }
    }
  }, [activeTab, posts, media, isLoading, closeTab]);

  // Show error modal if present
  const renderErrorModal = () => (
    <ErrorModal error={errorModal} onClose={hideErrorModal} />
  );

  // Show confirm delete modal if present
  const renderConfirmDeleteModal = () => (
    <ConfirmDeleteModal details={confirmDeleteModal} onClose={hideConfirmDeleteModal} />
  );

  const editorViewRenderers: Record<EditorRoute, () => React.ReactNode> = {
    settings: () => <SettingsView />,
    style: () => <StyleView />,
    tags: () => <TagsView />,
    chat: () => (editorRoute.tabId ? <ChatPanel key={editorRoute.tabId} conversationId={editorRoute.tabId} /> : <Dashboard />),
    import: () =>
      editorRoute.tabId ? <ImportAnalysisView key={editorRoute.tabId} definitionId={editorRoute.tabId} /> : <Dashboard />,
    'menu-editor': () => <MenuEditorView />,
    'metadata-diff': () => <MetadataDiffPanel />,
    'git-diff': () =>
      editorRoute.tabId && editorRoute.gitDiffResource
        ? <GitDiffView key={editorRoute.tabId} filePath={editorRoute.gitDiffResource} />
        : <Dashboard />,
    documentation: () => (
      <DocumentationView
        content={documentationContent}
        titleKey="docs.title"
        subtitleKey="docs.subtitle"
      />
    ),
    'api-documentation': () => (
      <DocumentationView
        content={apiDocumentationContent}
        titleKey="docs.apiTitle"
        subtitleKey="docs.apiSubtitle"
      />
    ),
    'site-validation': () => <SiteValidationView />,
    'translation-validation': () => <TranslationValidationView />,
    'find-duplicates': () => <DuplicatesView />,
    scripts: () => <ScriptsView scriptId={editorRoute.tabId} />,
    templates: () => <TemplatesView templateId={editorRoute.tabId} />,
    post: () => (editorRoute.tabId ? <PostEditor key={editorRoute.tabId} postId={editorRoute.tabId} /> : <Dashboard />),
    media: () => (editorRoute.tabId ? <MediaEditor key={editorRoute.tabId} mediaId={editorRoute.tabId} /> : <Dashboard />),
    dashboard: () => <Dashboard />,
  };

  const editorContent = editorViewRenderers[editorRoute.route]();

  return (
    <div className="editor">
      {editorContent}
      {renderErrorModal()}
      {renderConfirmDeleteModal()}
    </div>
  );
};
