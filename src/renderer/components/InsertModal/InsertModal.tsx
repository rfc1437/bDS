import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { showToast } from '../Toast';
import './InsertModal.css';

interface PostSearchResult {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
}

interface MediaSearchResult {
  id: string;
  originalName: string;
  title?: string;
  mimeType: string;
  createdAt: string;
}

/** Get display name for media: title (truncated to 60 chars) or fallback to filename */
function getMediaDisplayName(media: MediaSearchResult): string {
  if (media.title) {
    return media.title.length > 60
      ? media.title.substring(0, 60) + '...'
      : media.title;
  }
  return media.originalName;
}

type SearchResult = PostSearchResult | MediaSearchResult;

type InsertMode = 'link' | 'image';
type Tab = 'external' | 'internal';

interface InsertModalProps {
  mode: InsertMode;
  onInsertLink: (url: string, text?: string) => void;
  onInsertImage: (url: string, alt: string, mediaId?: string) => void;
  onClose: () => void;
  initialText?: string; // Selected text in editor
  currentPostTags?: string[];
  currentPostCategories?: string[];
  currentPostId?: string; // For semantic "related posts" suggestions
}

function isPostResult(result: SearchResult): result is PostSearchResult {
  return 'title' in result;
}

function isMediaResult(result: SearchResult): result is MediaSearchResult {
  return 'originalName' in result;
}

export const InsertModal: React.FC<InsertModalProps> = ({
  mode,
  onInsertLink,
  onInsertImage,
  onClose,
  initialText = '',
  currentPostTags,
  currentPostCategories,
  currentPostId,
}) => {
  const { t: tr } = useI18n();
  const openTabInBackground = useAppStore((s) => s.openTabInBackground);
  const [activeTab, setActiveTab] = useState<Tab>('internal');
  const [query, setQuery] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [externalText, setExternalText] = useState(initialText);
  const [externalAlt, setExternalAlt] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const externalUrlRef = useRef<HTMLInputElement>(null);
  const [relatedPosts, setRelatedPosts] = useState<PostSearchResult[]>([]);
  const [isLoadingRelated, setIsLoadingRelated] = useState(false);

  // Load related posts via semantic similarity when idle (query < 2 chars)
  useEffect(() => {
    if (mode !== 'link' || !currentPostId || activeTab !== 'internal' || query.length >= 2) {
      setRelatedPosts([]);
      return;
    }
    let cancelled = false;
    setIsLoadingRelated(true);
    (async () => {
      try {
        const similar = await window.electronAPI.embeddings.findSimilar(currentPostId, 5);
        if (cancelled || similar.length === 0) { setRelatedPosts([]); return; }
        const posts = await Promise.all(similar.map(s => window.electronAPI.posts.get(s.postId)));
        if (!cancelled) {
          setRelatedPosts(
            posts.filter((p): p is NonNullable<typeof p> => p != null).map(p => ({
              id: p.id, title: p.title, slug: p.slug, excerpt: p.excerpt,
            })),
          );
        }
      } catch {
        if (!cancelled) setRelatedPosts([]);
      } finally {
        if (!cancelled) setIsLoadingRelated(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentPostId, mode, activeTab, query]);

  // Whether to show the "Create post" option
  const showCreateOption = mode === 'link' &&
    activeTab === 'internal' &&
    query.trim().length >= 2 &&
    !isSearching &&
    !results.some(r => isPostResult(r) && r.title.toLowerCase() === query.trim().toLowerCase());

  // Total selectable items count (results + optional create option)
  const totalItems = results.length + (showCreateOption ? 1 : 0);

  // Focus appropriate input on mount and tab change
  useEffect(() => {
    if (activeTab === 'internal') {
      inputRef.current?.focus();
    } else {
      externalUrlRef.current?.focus();
    }
  }, [activeTab]);

  // Debounced search effect
  useEffect(() => {
    if (activeTab !== 'internal' || query.length < 2) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        if (mode === 'link') {
          const searchResults = await window.electronAPI.posts.search(query);
          setResults(searchResults || []);
        } else {
          const searchResults = await window.electronAPI.media.search(query);
          setResults(searchResults || []);
        }
        setSelectedIndex(0);
      } catch (error) {
        console.error('Search failed:', error);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query, mode, activeTab]);

  // Handle creating a new post from the search query
  const handleCreatePost = useCallback(async () => {
    const title = query.trim();
    if (!title || isCreating) return;

    setIsCreating(true);
    try {
      const newPost = await window.electronAPI.posts.create({
        title,
        tags: currentPostTags || [],
        categories: currentPostCategories || [],
      });

      if (newPost) {
        openTabInBackground({ type: 'post', id: newPost.id, isTransient: false });
        const linkUrl = `/posts/${newPost.slug}`;
        onInsertLink(linkUrl, title);
        showToast.success(tr('insert.createdPost', { title }));
        onClose();
      }
    } catch (error) {
      const err = error as Error;
      showToast.error(err.message);
    } finally {
      setIsCreating(false);
    }
  }, [query, isCreating, currentPostTags, currentPostCategories, openTabInBackground, onInsertLink, onClose, tr]);

  // Keyboard navigation handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'ArrowDown':
        if (activeTab === 'internal') {
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, totalItems - 1));
        }
        break;
      case 'ArrowUp':
        if (activeTab === 'internal') {
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, 0));
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (activeTab === 'internal') {
          if (selectedIndex < results.length && results[selectedIndex]) {
            handleSelectResult(results[selectedIndex]);
          } else if (showCreateOption && selectedIndex === results.length) {
            handleCreatePost();
          }
        } else if (externalUrl) {
          handleExternalSubmit();
        }
        break;
      case 'Tab':
        // Allow tab switching with Tab key when on the tab buttons
        break;
    }
  }, [activeTab, results, selectedIndex, totalItems, showCreateOption, externalUrl, onClose, handleCreatePost]);

  // Handle selecting a search result
  const handleSelectResult = useCallback(async (result: SearchResult) => {
    if (mode === 'link' && isPostResult(result)) {
      const linkUrl = `/posts/${result.slug}`;
      const linkText = initialText || result.title;
      onInsertLink(linkUrl, linkText);
    } else if (mode === 'image' && isMediaResult(result)) {
      // Get the media URL
      const url = await window.electronAPI.media.getUrl(result.id);
      if (url) {
        // Extract filename without extension for alt text
        const altText = result.originalName.replace(/\.[^.]+$/, '');
        // Pass mediaId so the editor can link this media to the post
        onInsertImage(url, altText, result.id);
      }
    }
    onClose();
  }, [mode, initialText, onInsertLink, onInsertImage, onClose]);

  // Handle external URL submission
  const handleExternalSubmit = useCallback(() => {
    if (!externalUrl) return;

    if (mode === 'link') {
      onInsertLink(externalUrl, externalText || undefined);
    } else {
      // External images don't have a mediaId
      onInsertImage(externalUrl, externalAlt || tr('insert.title.image'), undefined);
    }
    onClose();
  }, [mode, externalUrl, externalText, externalAlt, onInsertLink, onInsertImage, onClose, tr]);

  // Backdrop click handler
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = document.querySelector('.insert-modal-result-item.selected, .insert-modal-result-create.selected');
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  const title = mode === 'link' ? tr('insert.title.link') : tr('insert.title.image');
  const internalLabel = mode === 'link' ? tr('insert.tab.linkInternal') : tr('insert.tab.imageInternal');
  const externalLabel = mode === 'link' ? tr('insert.tab.linkExternal') : tr('insert.tab.imageExternal');
  const searchPlaceholder = mode === 'link'
    ? tr('insert.searchPlaceholder.link')
    : tr('insert.searchPlaceholder.image');

  return (
    <div className="insert-modal-backdrop" onClick={handleBackdropClick}>
      <div className="insert-modal" onKeyDown={handleKeyDown}>
        <div className="insert-modal-header">
          <h3 className="insert-modal-title">{title}</h3>
          <div className="insert-modal-tabs">
            <button
              className={`insert-modal-tab ${activeTab === 'internal' ? 'active' : ''}`}
              onClick={() => setActiveTab('internal')}
            >
              {internalLabel}
            </button>
            <button
              className={`insert-modal-tab ${activeTab === 'external' ? 'active' : ''}`}
              onClick={() => setActiveTab('external')}
            >
              {externalLabel}
            </button>
          </div>
        </div>

        {activeTab === 'internal' ? (
          <>
            <div className="insert-modal-search">
              <input
                ref={inputRef}
                type="text"
                className="insert-modal-input"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                autoComplete="off"
              />
            </div>

            <div className="insert-modal-results">
              {isSearching && (
                <div className="insert-modal-status">{tr('insert.status.searching')}</div>
              )}

              {!isSearching && query.length < 2 && relatedPosts.length === 0 && !isLoadingRelated && (
                <div className="insert-modal-status">
                  {tr('insert.status.typeMore')}
                </div>
              )}

              {!isSearching && query.length < 2 && isLoadingRelated && (
                <div className="insert-modal-status">{tr('insert.status.loadingRelated')}</div>
              )}

              {!isSearching && query.length < 2 && relatedPosts.length > 0 && (
                <>
                  <div className="insert-modal-section-label">{tr('insert.section.relatedPosts')}</div>
                  {relatedPosts.map((result, index) => (
                    <div
                      key={result.id}
                      className={`insert-modal-result-item ${index === selectedIndex ? 'selected' : ''}`}
                      onClick={() => handleSelectResult(result)}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      <div className="insert-modal-result-title">{result.title}</div>
                      {result.excerpt && (
                        <div className="insert-modal-result-excerpt">
                          {result.excerpt.length > 120 ? result.excerpt.substring(0, 120) + '...' : result.excerpt}
                        </div>
                      )}
                      <div className="insert-modal-result-path">/posts/{result.slug}</div>
                    </div>
                  ))}
                </>
              )}

              {!isSearching && query.length >= 2 && results.length === 0 && !showCreateOption && (
                <div className="insert-modal-status">
                  {tr('insert.status.noResults', { kind: mode === 'link' ? tr('activity.posts').toLowerCase() : tr('activity.media').toLowerCase(), query })}
                </div>
              )}

              {!isSearching && results.length > 0 && results.map((result, index) => (
                <div
                  key={isPostResult(result) ? result.id : result.id}
                  className={`insert-modal-result-item ${index === selectedIndex ? 'selected' : ''}`}
                  onClick={() => handleSelectResult(result)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  {isPostResult(result) ? (
                    <>
                      <div className="insert-modal-result-title">{result.title}</div>
                      {result.excerpt && (
                        <div className="insert-modal-result-excerpt">
                          {result.excerpt.length > 120
                            ? result.excerpt.substring(0, 120) + '...'
                            : result.excerpt}
                        </div>
                      )}
                      <div className="insert-modal-result-path">/posts/{result.slug}</div>
                    </>
                  ) : (
                    <>
                      <div className="insert-modal-result-title">{getMediaDisplayName(result)}</div>
                      <div className="insert-modal-result-meta">
                        {result.mimeType} • {new Date(result.createdAt).toLocaleDateString()}
                      </div>
                    </>
                  )}
                </div>
              ))}

              {showCreateOption && (
                <button
                  type="button"
                  className={`insert-modal-result-create ${selectedIndex === results.length ? 'selected' : ''}`}
                  onClick={handleCreatePost}
                  onMouseEnter={() => setSelectedIndex(results.length)}
                  disabled={isCreating}
                >
                  <span className="insert-modal-create-icon">+</span>
                  <span>{tr('insert.createPost', { title: query.trim() })}</span>
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="insert-modal-external">
            <div className="insert-modal-field">
              <label className="insert-modal-label">{tr('insert.label.url')}</label>
              <input
                ref={externalUrlRef}
                type="text"
                className="insert-modal-input"
                placeholder={mode === 'link' ? tr('insert.placeholder.linkUrl') : tr('insert.placeholder.imageUrl')}
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                autoComplete="off"
              />
            </div>

            {mode === 'link' ? (
              <div className="insert-modal-field">
                <label className="insert-modal-label">{tr('insert.label.linkTextOptional')}</label>
                <input
                  type="text"
                  className="insert-modal-input"
                  placeholder={tr('insert.placeholder.linkText')}
                  value={externalText}
                  onChange={(e) => setExternalText(e.target.value)}
                />
              </div>
            ) : (
              <div className="insert-modal-field">
                <label className="insert-modal-label">{tr('insert.label.altText')}</label>
                <input
                  type="text"
                  className="insert-modal-input"
                  placeholder={tr('insert.placeholder.imageAlt')}
                  value={externalAlt}
                  onChange={(e) => setExternalAlt(e.target.value)}
                />
              </div>
            )}

            <button
              className="insert-modal-submit"
              onClick={handleExternalSubmit}
              disabled={!externalUrl}
            >
              {mode === 'link' ? tr('insert.submit.link') : tr('insert.submit.image')}
            </button>
          </div>
        )}

        <div className="insert-modal-footer">
          <div className="insert-modal-footer-content">
            <span className="insert-modal-hint">
              {activeTab === 'internal'
                ? tr('insert.hint.internal')
                : tr('insert.hint.external')}
            </span>
            {activeTab === 'internal' && (
              <span className="insert-modal-format-hint">
                {mode === 'link'
                  ? tr('insert.hint.canonicalPost')
                  : tr('insert.hint.canonicalMedia')}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
