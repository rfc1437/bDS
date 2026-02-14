import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  caption?: string;
  mimeType: string;
  createdAt: string;
}

/** Get display name for media: caption (truncated to 60 chars) or fallback to filename */
function getMediaDisplayName(media: MediaSearchResult): string {
  if (media.caption) {
    return media.caption.length > 60 
      ? media.caption.substring(0, 60) + '...' 
      : media.caption;
  }
  return media.originalName;
}

type SearchResult = PostSearchResult | MediaSearchResult;

type InsertMode = 'link' | 'image';
type Tab = 'external' | 'internal';

interface InsertModalProps {
  mode: InsertMode;
  onInsertLink: (url: string, text?: string) => void;
  onInsertImage: (url: string, alt: string) => void;
  onClose: () => void;
  initialText?: string; // Selected text in editor
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
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('internal');
  const [query, setQuery] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [externalText, setExternalText] = useState(initialText);
  const [externalAlt, setExternalAlt] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const externalUrlRef = useRef<HTMLInputElement>(null);

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
          setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
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
        if (activeTab === 'internal' && results[selectedIndex]) {
          handleSelectResult(results[selectedIndex]);
        } else if (activeTab === 'external' && externalUrl) {
          handleExternalSubmit();
        }
        break;
      case 'Tab':
        // Allow tab switching with Tab key when on the tab buttons
        break;
    }
  }, [activeTab, results, selectedIndex, externalUrl, onClose]);

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
        onInsertImage(url, altText);
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
      onInsertImage(externalUrl, externalAlt || 'Image');
    }
    onClose();
  }, [mode, externalUrl, externalText, externalAlt, onInsertLink, onInsertImage, onClose]);

  // Backdrop click handler
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = document.querySelector('.insert-modal-result-item.selected');
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  const title = mode === 'link' ? 'Insert Link' : 'Insert Image';
  const internalLabel = mode === 'link' ? 'Link to Post' : 'Media Library';
  const externalLabel = mode === 'link' ? 'External URL' : 'External Image';
  const searchPlaceholder = mode === 'link' 
    ? 'Search posts by title or content...' 
    : 'Search media by name, caption, or alt text...';

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
                autoComplete="off"
              />
            </div>

            <div className="insert-modal-results">
              {isSearching && (
                <div className="insert-modal-status">Searching...</div>
              )}

              {!isSearching && query.length < 2 && (
                <div className="insert-modal-status">
                  Type at least 2 characters to search
                </div>
              )}

              {!isSearching && query.length >= 2 && results.length === 0 && (
                <div className="insert-modal-status">
                  No {mode === 'link' ? 'posts' : 'media'} found for "{query}"
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
            </div>
          </>
        ) : (
          <div className="insert-modal-external">
            <div className="insert-modal-field">
              <label className="insert-modal-label">URL</label>
              <input
                ref={externalUrlRef}
                type="text"
                className="insert-modal-input"
                placeholder={mode === 'link' ? 'https://example.com' : 'https://example.com/image.jpg'}
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                autoComplete="off"
              />
            </div>
            
            {mode === 'link' ? (
              <div className="insert-modal-field">
                <label className="insert-modal-label">Link Text (optional)</label>
                <input
                  type="text"
                  className="insert-modal-input"
                  placeholder="Click here"
                  value={externalText}
                  onChange={(e) => setExternalText(e.target.value)}
                />
              </div>
            ) : (
              <div className="insert-modal-field">
                <label className="insert-modal-label">Alt Text</label>
                <input
                  type="text"
                  className="insert-modal-input"
                  placeholder="Description of the image"
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
              Insert {mode === 'link' ? 'Link' : 'Image'}
            </button>
          </div>
        )}

        <div className="insert-modal-footer">
          <span className="insert-modal-hint">
            {activeTab === 'internal' 
              ? 'Use ↑↓ to navigate, Enter to select, Esc to close'
              : 'Enter URL and press Enter or click button, Esc to close'}
          </span>
        </div>
      </div>
    </div>
  );
};
