import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import './PostSearchModal.css';

interface SearchResult {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
}

interface PostSearchModalProps {
  onSelect: (post: SearchResult) => void;
  onClose: () => void;
  initialQuery?: string;
}

export const PostSearchModal: React.FC<PostSearchModalProps> = ({
  onSelect,
  onClose,
  initialQuery = ''
}) => {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search effect
  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        const searchResults = await window.electronAPI.posts.search(query);
        setResults(searchResults || []);
        setSelectedIndex(0);
      } catch (error) {
        console.error('Search failed:', error);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query]);

  // Keyboard navigation handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          onSelect(results[selectedIndex]);
        }
        break;
    }
  }, [results, selectedIndex, onClose, onSelect]);

  // Backdrop click handler
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Result click handler
  const handleResultClick = useCallback((post: SearchResult) => {
    onSelect(post);
  }, [onSelect]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = document.querySelector('.post-search-result-item.selected');
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  return (
    <div className="post-search-modal-backdrop" onClick={handleBackdropClick}>
      <div className="post-search-modal" onKeyDown={handleKeyDown}>
        <div className="post-search-header">
          <input
            ref={inputRef}
            type="text"
            className="post-search-input"
            placeholder={t('postSearch.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="post-search-results">
          {isSearching && (
            <div className="post-search-loading">
              {t('postSearch.searching')}
            </div>
          )}

          {!isSearching && query.length < 2 && (
            <div className="post-search-empty">
              {t('postSearch.typeMore')}
            </div>
          )}

          {!isSearching && query.length >= 2 && results.length === 0 && (
            <div className="post-search-empty">
              {t('postSearch.noResults', { query })}
            </div>
          )}

          {!isSearching && results.length > 0 && results.map((post, index) => (
            <div
              key={post.id}
              className={`post-search-result-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => handleResultClick(post)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="post-search-result-title">{post.title}</div>
              {post.excerpt && (
                <div className="post-search-result-excerpt">
                  {post.excerpt.length > 120
                    ? post.excerpt.substring(0, 120) + '...'
                    : post.excerpt}
                </div>
              )}
              <div className="post-search-result-slug">/posts/{post.slug}</div>
            </div>
          ))}
        </div>

        <div className="post-search-footer">
          <span className="post-search-hint">
            {t('postSearch.hint')}
          </span>
        </div>
      </div>
    </div>
  );
};
