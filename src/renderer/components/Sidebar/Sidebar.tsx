import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore, PostData, MediaData } from '../../store';
import { showToast } from '../Toast';
import type { ChatConversation } from '../../types/electron';
import './Sidebar.css';

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

// Get post type icon based on categories
const getPostTypeIcon = (categories: string[]): { icon: string; type: string } => {
  const lowerCategories = categories.map(c => c.toLowerCase());
  if (lowerCategories.includes('picture') || lowerCategories.includes('photo') || lowerCategories.includes('image')) {
    return { icon: '🖼️', type: 'picture' };
  }
  if (lowerCategories.includes('aside') || lowerCategories.includes('note') || lowerCategories.includes('quick')) {
    return { icon: '📝', type: 'aside' };
  }
  if (lowerCategories.includes('link') || lowerCategories.includes('bookmark')) {
    return { icon: '🔗', type: 'link' };
  }
  if (lowerCategories.includes('video')) {
    return { icon: '🎬', type: 'video' };
  }
  if (lowerCategories.includes('quote')) {
    return { icon: '💬', type: 'quote' };
  }
  // Default to article
  return { icon: '📄', type: 'article' };
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface CalendarViewProps {
  onDateSelect: (year: number, month?: number) => void;
  selectedYear?: number;
  selectedMonth?: number;
}

const CalendarView: React.FC<CalendarViewProps> = ({ onDateSelect, selectedYear, selectedMonth }) => {
  const [yearMonthData, setYearMonthData] = useState<{ year: number; month: number; count: number }[]>([]);
  const [expandedYear, setExpandedYear] = useState<number | null>(null);

  useEffect(() => {
    const loadData = async () => {
      const data = await window.electronAPI?.posts.getByYearMonth();
      if (data) {
        setYearMonthData(data as { year: number; month: number; count: number }[]);
      }
    };
    loadData();
  }, []);

  // Group by year
  const years = [...new Set(yearMonthData.map(d => d.year))].sort((a, b) => b - a);

  const getYearCount = (year: number) => {
    return yearMonthData.filter(d => d.year === year).reduce((sum, d) => sum + d.count, 0);
  };

  const getMonthsForYear = (year: number) => {
    return yearMonthData.filter(d => d.year === year).sort((a, b) => b.month - a.month);
  };

  return (
    <div className="calendar-view">
      <div className="calendar-header">
        <span>ARCHIVE</span>
        {(selectedYear || selectedMonth !== undefined) && (
          <button className="clear-filter" onClick={() => onDateSelect(0)} title="Clear filter">
            ✕
          </button>
        )}
      </div>
      <div className="calendar-years">
        {years.map(year => (
          <div key={year} className="calendar-year">
            <div 
              className={`calendar-year-header ${selectedYear === year && selectedMonth === undefined ? 'selected' : ''}`}
              onClick={() => {
                setExpandedYear(expandedYear === year ? null : year);
                onDateSelect(year);
              }}
            >
              <span className="expand-icon">{expandedYear === year ? '▼' : '▶'}</span>
              <span className="year-label">{year}</span>
              <span className="year-count">{getYearCount(year)}</span>
            </div>
            {expandedYear === year && (
              <div className="calendar-months">
                {getMonthsForYear(year).map(({ month, count }) => (
                  <div
                    key={month}
                    className={`calendar-month ${selectedYear === year && selectedMonth === month ? 'selected' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDateSelect(year, month);
                    }}
                  >
                    <span className="month-label">{MONTH_NAMES[month]}</span>
                    <span className="month-count">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {years.length === 0 && (
          <div className="calendar-empty">No posts yet</div>
        )}
      </div>
    </div>
  );
};

interface FilterPanelProps {
  tags: string[];
  categories: string[];
  selectedTags: string[];
  selectedCategories: string[];
  onTagSelect: (tags: string[]) => void;
  onCategorySelect: (categories: string[]) => void;
}

const FilterPanel: React.FC<FilterPanelProps> = ({
  tags,
  categories,
  selectedTags,
  selectedCategories,
  onTagSelect,
  onCategorySelect,
}) => {
  return (
    <div className="filter-panel">
      {tags.length > 0 && (
        <div className="filter-section">
          <div className="filter-header">TAGS</div>
          <div className="filter-chips">
            {tags.map(tag => (
              <button
                key={tag}
                className={`filter-chip ${selectedTags.includes(tag) ? 'active' : ''}`}
                onClick={() => {
                  if (selectedTags.includes(tag)) {
                    onTagSelect(selectedTags.filter(t => t !== tag));
                  } else {
                    onTagSelect([...selectedTags, tag]);
                  }
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}
      {categories.length > 0 && (
        <div className="filter-section">
          <div className="filter-header">CATEGORIES</div>
          <div className="filter-chips">
            {categories.map(cat => (
              <button
                key={cat}
                className={`filter-chip ${selectedCategories.includes(cat) ? 'active' : ''}`}
                onClick={() => {
                  if (selectedCategories.includes(cat)) {
                    onCategorySelect(selectedCategories.filter(c => c !== cat));
                  } else {
                    onCategorySelect([...selectedCategories, cat]);
                  }
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Media-specific calendar view
interface MediaCalendarViewProps {
  onDateSelect: (year: number, month?: number) => void;
  selectedYear?: number;
  selectedMonth?: number;
}

const MediaCalendarView: React.FC<MediaCalendarViewProps> = ({ onDateSelect, selectedYear, selectedMonth }) => {
  const [yearMonthData, setYearMonthData] = useState<{ year: number; month: number; count: number }[]>([]);
  const [expandedYear, setExpandedYear] = useState<number | null>(null);

  useEffect(() => {
    const loadData = async () => {
      const data = await window.electronAPI?.media.getByYearMonth();
      if (data) {
        setYearMonthData(data as { year: number; month: number; count: number }[]);
      }
    };
    loadData();
  }, []);

  const years = [...new Set(yearMonthData.map(d => d.year))].sort((a, b) => b - a);

  const getYearCount = (year: number) => {
    return yearMonthData.filter(d => d.year === year).reduce((sum, d) => sum + d.count, 0);
  };

  const getMonthsForYear = (year: number) => {
    return yearMonthData.filter(d => d.year === year).sort((a, b) => b.month - a.month);
  };

  return (
    <div className="calendar-view">
      <div className="calendar-header">
        <span>ARCHIVE</span>
        {(selectedYear || selectedMonth !== undefined) && (
          <button className="clear-filter" onClick={() => onDateSelect(0)} title="Clear filter">
            ✕
          </button>
        )}
      </div>
      <div className="calendar-years">
        {years.map(year => (
          <div key={year} className="calendar-year">
            <div
              className={`calendar-year-header ${selectedYear === year && selectedMonth === undefined ? 'selected' : ''}`}
              onClick={() => {
                setExpandedYear(expandedYear === year ? null : year);
                onDateSelect(year);
              }}
            >
              <span className="expand-icon">{expandedYear === year ? '▼' : '▶'}</span>
              <span className="year-label">{year}</span>
              <span className="year-count">{getYearCount(year)}</span>
            </div>
            {expandedYear === year && (
              <div className="calendar-months">
                {getMonthsForYear(year).map(({ month, count }) => (
                  <div
                    key={month}
                    className={`calendar-month ${selectedYear === year && selectedMonth === month ? 'selected' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDateSelect(year, month);
                    }}
                  >
                    <span className="month-label">{MONTH_NAMES[month]}</span>
                    <span className="month-count">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {years.length === 0 && (
          <div className="calendar-empty">No media yet</div>
        )}
      </div>
    </div>
  );
};

// Media-specific filter panel
interface MediaFilterPanelProps {
  tags: string[];
  selectedTags: string[];
  onTagSelect: (tags: string[]) => void;
}

const MediaFilterPanel: React.FC<MediaFilterPanelProps> = ({
  tags,
  selectedTags,
  onTagSelect,
}) => {
  return (
    <div className="filter-panel">
      {tags.length > 0 && (
        <div className="filter-section">
          <div className="filter-header">TAGS</div>
          <div className="filter-chips">
            {tags.map(tag => (
              <button
                key={tag}
                className={`filter-chip ${selectedTags.includes(tag) ? 'active' : ''}`}
                onClick={() => {
                  if (selectedTags.includes(tag)) {
                    onTagSelect(selectedTags.filter(t => t !== tag));
                  } else {
                    onTagSelect([...selectedTags, tag]);
                  }
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

interface SearchBoxProps {
  onSearch: (query: string) => void;
}

const SearchBox: React.FC<SearchBoxProps> = ({ onSearch }) => {
  const [query, setQuery] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query);
  };

  return (
    <form className="search-box" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Search posts..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button type="submit" title="Search">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M15.7 14.3l-4.2-4.2c-.2-.2-.5-.3-.8-.3.9-1.1 1.5-2.5 1.5-4C12.2 2.6 9.6 0 6.4 0S.6 2.6.6 5.8s2.6 5.8 5.8 5.8c1.5 0 2.9-.5 4-1.4 0 .3.1.6.3.8l4.2 4.2c.2.2.5.3.7.3s.5-.1.7-.3c.4-.4.4-1 0-1.4zm-9.3-4c-2.5 0-4.5-2-4.5-4.5s2-4.5 4.5-4.5 4.5 2 4.5 4.5-2 4.5-4.5 4.5z"/>
        </svg>
      </button>
      {query && (
        <button type="button" className="clear-search" onClick={() => { setQuery(''); onSearch(''); }} title="Clear">
          ✕
        </button>
      )}
    </form>
  );
};

const PostsList: React.FC = () => {
  const { posts, hasMorePosts, totalPosts, appendPosts, openTab, activeTabId } = useAppStore();
  
  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PostData[] | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | undefined>();
  const [selectedMonth, setSelectedMonth] = useState<number | undefined>();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filteredPosts, setFilteredPosts] = useState<PostData[] | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Load available tags and categories
  useEffect(() => {
    const loadFilters = async () => {
      const [tags, categories] = await Promise.all([
        window.electronAPI?.posts.getTags(),
        window.electronAPI?.posts.getCategories(),
      ]);
      if (tags) setAvailableTags(tags as string[]);
      if (categories) setAvailableCategories(categories as string[]);
    };
    loadFilters();
  }, [posts]);

  // Handle search
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const results = await window.electronAPI?.posts.search(query);
      if (results) {
        // Fetch full PostData for each search result
        const fullPosts: PostData[] = [];
        for (const result of results as { id: string }[]) {
          const post = await window.electronAPI?.posts.get(result.id);
          if (post) {
            fullPosts.push(post as PostData);
          }
        }
        setSearchResults(fullPosts);
      }
    } catch (error) {
      console.error('Search failed:', error);
      showToast.error('Search failed');
    }
  };

  // Handle date selection
  const handleDateSelect = async (year: number, month?: number) => {
    if (year === 0) {
      // Clear filter
      setSelectedYear(undefined);
      setSelectedMonth(undefined);
      setFilteredPosts(null);
      return;
    }
    setSelectedYear(year);
    setSelectedMonth(month);
    
    try {
      const results = await window.electronAPI?.posts.filter({
        year,
        month,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        categories: selectedCategories.length > 0 ? selectedCategories : undefined,
      });
      if (results) {
        setFilteredPosts(results as PostData[]);
      }
    } catch (error) {
      console.error('Filter failed:', error);
    }
  };

  // Handle tag/category filter changes
  useEffect(() => {
    const applyFilters = async () => {
      if (!selectedYear && selectedTags.length === 0 && selectedCategories.length === 0) {
        setFilteredPosts(null);
        return;
      }
      
      try {
        const results = await window.electronAPI?.posts.filter({
          year: selectedYear,
          month: selectedMonth,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
          categories: selectedCategories.length > 0 ? selectedCategories : undefined,
        });
        if (results) {
          setFilteredPosts(results as PostData[]);
        }
      } catch (error) {
        console.error('Filter failed:', error);
      }
    };
    applyFilters();
  }, [selectedTags, selectedCategories]);

  const handleCreatePost = async () => {
    // Create a real post immediately in the database with default empty content
    try {
      const { setSelectedPost: selectPost } = useAppStore.getState();
      const newPost = await window.electronAPI?.posts.create({
        title: '',
        content: '',
        tags: [],
        categories: [],
      });
      if (newPost) {
        selectPost(newPost.id);
      }
    } catch (error) {
      console.error('Failed to create post:', error);
    }
  };

  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMorePosts) return;
    
    setIsLoadingMore(true);
    try {
      const postsResult = await window.electronAPI?.posts.getAll({ limit: 500, offset: posts.length });
      if (postsResult) {
        const { items, hasMore } = postsResult as { items: PostData[]; hasMore: boolean };
        appendPosts(items, hasMore);
      }
    } catch (error) {
      console.error('Failed to load more posts:', error);
      showToast.error('Failed to load more posts');
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Determine which posts to display
  // Filters only apply to published/archived posts — drafts are always shown unfiltered
  const filteredDisplayPosts = searchResults ?? filteredPosts ?? null;
  const isFiltered = filteredDisplayPosts !== null;
  const hasActiveFilters = searchQuery || selectedYear || selectedTags.length > 0 || selectedCategories.length > 0;

  const groupedPosts = {
    draft: posts.filter(p => p.status === 'draft'),
    published: (filteredDisplayPosts ?? posts).filter(p => p.status === 'published'),
    archived: (filteredDisplayPosts ?? posts).filter(p => p.status === 'archived'),
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setSearchResults(null);
    setSelectedYear(undefined);
    setSelectedMonth(undefined);
    setSelectedTags([]);
    setSelectedCategories([]);
    setFilteredPosts(null);
  };

  // Click handlers for tabs
  const handlePostClick = (postId: string) => {
    openTab({ type: 'post', id: postId, isTransient: true });
  };

  const handlePostDoubleClick = (postId: string) => {
    openTab({ type: 'post', id: postId, isTransient: false });
  };

  return (
    <div className="sidebar-content">
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>POSTS</span>
          <div className="sidebar-actions">
            <button 
              className={`sidebar-action ${showFilters ? 'active' : ''}`} 
              onClick={() => setShowFilters(!showFilters)} 
              title="Toggle Filters"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6 12v-1h4v1H6zM4 8v-1h8v1H4zm-2-4v-1h12v1H2z"/>
              </svg>
            </button>
            <button className="sidebar-action" onClick={handleCreatePost} title="New Post">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <SearchBox onSearch={handleSearch} />
      
      {showFilters && (
        <>
          <CalendarView 
            onDateSelect={handleDateSelect}
            selectedYear={selectedYear}
            selectedMonth={selectedMonth}
          />
          <FilterPanel
            tags={availableTags}
            categories={availableCategories}
            selectedTags={selectedTags}
            selectedCategories={selectedCategories}
            onTagSelect={setSelectedTags}
            onCategorySelect={setSelectedCategories}
          />
        </>
      )}

      {hasActiveFilters && (
        <div className="filter-status">
          <span>
            {groupedPosts.published.length + groupedPosts.archived.length} result{groupedPosts.published.length + groupedPosts.archived.length !== 1 ? 's' : ''}
            {searchQuery && ` for "${searchQuery}"`}
          </span>
          <button onClick={clearAllFilters} title="Clear all filters">
            Clear filters
          </button>
        </div>
      )}

      {groupedPosts.draft.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-section-title">
            <span className="section-icon status-draft">●</span>
            Drafts ({groupedPosts.draft.length})
          </div>
          <div className="sidebar-list">
            {groupedPosts.draft.map(post => {
              const postType = getPostTypeIcon(post.categories);
              return (
                <div
                  key={post.id}
                  className={`sidebar-item post-type-${postType.type} ${activeTabId === post.id ? 'selected' : ''}`}
                  onClick={() => handlePostClick(post.id)}
                  onDoubleClick={() => handlePostDoubleClick(post.id)}
                >
                  <span className="post-type-icon" title={postType.type}>{postType.icon}</span>
                  <div className="sidebar-item-content">
                    <div className="sidebar-item-title">{post.title || 'Untitled'}</div>
                    <div className="sidebar-item-meta">{formatDate(post.updatedAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {groupedPosts.published.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-section-title">
            <span className="section-icon status-published">●</span>
            Published ({groupedPosts.published.length})
          </div>
          <div className="sidebar-list">
            {groupedPosts.published.map(post => {
              const postType = getPostTypeIcon(post.categories);
              return (
                <div
                  key={post.id}
                  className={`sidebar-item post-type-${postType.type} ${activeTabId === post.id ? 'selected' : ''}`}
                  onClick={() => handlePostClick(post.id)}
                  onDoubleClick={() => handlePostDoubleClick(post.id)}
                >
                  <span className="post-type-icon" title={postType.type}>{postType.icon}</span>
                  <div className="sidebar-item-content">
                    <div className="sidebar-item-title">{post.title || 'Untitled'}</div>
                    <div className="sidebar-item-meta">{formatDate(post.publishedAt || post.updatedAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {groupedPosts.archived.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-section-title">
            <span className="section-icon status-archived">●</span>
            Archived ({groupedPosts.archived.length})
          </div>
          <div className="sidebar-list">
            {groupedPosts.archived.map(post => {
              const postType = getPostTypeIcon(post.categories);
              return (
                <div
                  key={post.id}
                  className={`sidebar-item post-type-${postType.type} ${activeTabId === post.id ? 'selected' : ''}`}
                  onClick={() => handlePostClick(post.id)}
                  onDoubleClick={() => handlePostDoubleClick(post.id)}
                >
                  <span className="post-type-icon" title={postType.type}>{postType.icon}</span>
                  <div className="sidebar-item-content">
                    <div className="sidebar-item-title">{post.title || 'Untitled'}</div>
                    <div className="sidebar-item-meta">{formatDate(post.updatedAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {posts.length === 0 && !isFiltered && (
        <div className="sidebar-empty">
          <p>No posts yet</p>
          <button onClick={handleCreatePost}>Create your first post</button>
        </div>
      )}

      {groupedPosts.published.length === 0 && groupedPosts.archived.length === 0 && isFiltered && (
        <div className="sidebar-empty">
          <p>No matching posts</p>
          <button onClick={clearAllFilters}>Clear filters</button>
        </div>
      )}

      {/* Load More button - only show when not filtering and has more posts */}
      {!isFiltered && hasMorePosts && (
        <div className="sidebar-load-more">
          <button 
            onClick={handleLoadMore} 
            disabled={isLoadingMore}
            className="load-more-button"
          >
            {isLoadingMore ? 'Loading...' : `Load more (${posts.length} of ${totalPosts})`}
          </button>
        </div>
      )}
    </div>
  );
};

const MediaList: React.FC = () => {
  const { media, openTab, activeTabId } = useAppStore();

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MediaData[] | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | undefined>();
  const [selectedMonth, setSelectedMonth] = useState<number | undefined>();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filteredMedia, setFilteredMedia] = useState<MediaData[] | null>(null);

  // Load available tags
  useEffect(() => {
    const loadTags = async () => {
      const tags = await window.electronAPI?.media.getTags();
      if (tags) setAvailableTags(tags as string[]);
    };
    loadTags();
  }, [media]);

  // Handle search
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const results = await window.electronAPI?.media.search(query);
      if (results) {
        const mediaIds = (results as { id: string }[]).map(r => r.id);
        setSearchResults(media.filter(m => mediaIds.includes(m.id)));
      }
    } catch (error) {
      console.error('Search failed:', error);
      showToast.error('Search failed');
    }
  };

  // Handle date selection
  const handleDateSelect = async (year: number, month?: number) => {
    if (year === 0) {
      // Clear filter
      setSelectedYear(undefined);
      setSelectedMonth(undefined);
      setFilteredMedia(null);
      return;
    }
    setSelectedYear(year);
    setSelectedMonth(month);

    try {
      const results = await window.electronAPI?.media.filter({
        year,
        month,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      });
      if (results) {
        setFilteredMedia(results as MediaData[]);
      }
    } catch (error) {
      console.error('Filter failed:', error);
    }
  };

  // Handle tag filter changes
  useEffect(() => {
    const applyFilters = async () => {
      if (!selectedYear && selectedTags.length === 0) {
        setFilteredMedia(null);
        return;
      }

      try {
        const results = await window.electronAPI?.media.filter({
          year: selectedYear,
          month: selectedMonth,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
        });
        if (results) {
          setFilteredMedia(results as MediaData[]);
        }
      } catch (error) {
        console.error('Filter failed:', error);
      }
    };
    applyFilters();
  }, [selectedTags]);

  const handleImportMedia = async () => {
    try {
      await window.electronAPI?.media.importDialog();
    } catch (error) {
      console.error('Failed to import media:', error);
    }
  };

  const handleMediaClick = (mediaId: string) => {
    openTab({ type: 'media', id: mediaId, isTransient: true });
  };

  const handleMediaDoubleClick = (mediaId: string) => {
    openTab({ type: 'media', id: mediaId, isTransient: false });
  };

  // Determine which media to display
  const filteredDisplayMedia = searchResults ?? filteredMedia ?? media;
  const hasActiveFilters = searchQuery || selectedYear || selectedTags.length > 0;

  const clearAllFilters = () => {
    setSearchQuery('');
    setSearchResults(null);
    setSelectedYear(undefined);
    setSelectedMonth(undefined);
    setSelectedTags([]);
    setFilteredMedia(null);
  };

  return (
    <div className="sidebar-content">
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>MEDIA</span>
          <div className="sidebar-actions">
            <button
              className={`sidebar-action ${showFilters ? 'active' : ''}`}
              onClick={() => setShowFilters(!showFilters)}
              title="Toggle Filters"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6 12v-1h4v1H6zM4 8v-1h8v1H4zm-2-4v-1h12v1H2z"/>
              </svg>
            </button>
            <button className="sidebar-action" onClick={handleImportMedia} title="Import Media">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <SearchBox onSearch={handleSearch} />

      {showFilters && (
        <>
          <MediaCalendarView
            onDateSelect={handleDateSelect}
            selectedYear={selectedYear}
            selectedMonth={selectedMonth}
          />
          <MediaFilterPanel
            tags={availableTags}
            selectedTags={selectedTags}
            onTagSelect={setSelectedTags}
          />
        </>
      )}

      {hasActiveFilters && (
        <div className="filter-status">
          <span>
            {filteredDisplayMedia.length} result{filteredDisplayMedia.length !== 1 ? 's' : ''}
            {searchQuery && ` for "${searchQuery}"`}
          </span>
          <button onClick={clearAllFilters} title="Clear all filters">
            Clear filters
          </button>
        </div>
      )}

      <div className="sidebar-list media-grid">
        {filteredDisplayMedia.map(item => (
          <div
            key={item.id}
            className={`media-item ${activeTabId === item.id ? 'selected' : ''}`}
            onClick={() => handleMediaClick(item.id)}
            onDoubleClick={() => handleMediaDoubleClick(item.id)}
            title={item.originalName}
          >
            {item.mimeType.startsWith('image/') ? (
              <div className="media-thumbnail">
                <img
                  src={`bds-thumb://${item.id}`}
                  alt={item.alt || item.originalName}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                  }}
                />
              </div>
            ) : (
              <div className="media-thumbnail">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" opacity="0.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
                </svg>
              </div>
            )}
            <div className="media-item-info">
              <div className="media-item-name truncate">{item.originalName}</div>
              <div className="media-item-size">{formatFileSize(item.size)}</div>
            </div>
          </div>
        ))}
      </div>

      {filteredDisplayMedia.length === 0 && (
        <div className="sidebar-empty">
          <p>No media files</p>
          <button onClick={handleImportMedia}>Import media</button>
        </div>
      )}
    </div>
  );
};

import { scrollToSettingsSection, SettingsCategory } from '../SettingsView/SettingsView';
import { scrollToTagsSection, TagsCategory } from '../TagsView';

const TagsNav: React.FC = () => {
  const [activeSection, setActiveSection] = useState<TagsCategory | null>(null);

  const handleNavClick = (category: TagsCategory) => {
    setActiveSection(category);
    scrollToTagsSection(category);
  };

  return (
    <div className="sidebar-content settings-panel">
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>TAGS</span>
        </div>
      </div>

      <div className="settings-nav-list">
        <button
          className={`settings-nav-entry ${activeSection === 'cloud' ? 'active' : ''}`}
          onClick={() => handleNavClick('cloud')}
        >
          <span className="settings-nav-entry-icon">☁️</span>
          <span>Tag Cloud</span>
        </button>
        <button
          className={`settings-nav-entry ${activeSection === 'manage' ? 'active' : ''}`}
          onClick={() => handleNavClick('manage')}
        >
          <span className="settings-nav-entry-icon">✏️</span>
          <span>Create & Edit</span>
        </button>
        <button 
          className={`settings-nav-entry ${activeSection === 'merge' ? 'active' : ''}`}
          onClick={() => handleNavClick('merge')}
        >
          <span className="settings-nav-entry-icon">🔀</span>
          <span>Merge Tags</span>
        </button>
      </div>
    </div>
  );
};

const SettingsNav: React.FC = () => {
  const { syncConfigured, tabs, activeTabId, openTab } = useAppStore();
  const [activeSection, setActiveSection] = useState<SettingsCategory | null>(null);

  // Check if settings panel is currently active
  const isSettingsTabActive = tabs.some(t => t.type === 'settings' && t.id === activeTabId);

  const handleNavClick = (category: SettingsCategory) => {
    // If settings panel is not open or not active, open it first
    if (!isSettingsTabActive) {
      openTab({ type: 'settings', id: 'settings', isTransient: false });
    }
    setActiveSection(category);
    // Use setTimeout to allow panel to open before scrolling
    setTimeout(() => {
      scrollToSettingsSection(category);
    }, isSettingsTabActive ? 0 : 100);
  };

  return (
    <div className="sidebar-content settings-panel">
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>SETTINGS</span>
        </div>
      </div>

      <div className="settings-nav-list">
        <button
          className={`settings-nav-entry ${activeSection === 'project' ? 'active' : ''}`}
          onClick={() => handleNavClick('project')}
        >
          <span className="settings-nav-entry-icon">📁</span>
          <span>Project</span>
        </button>
        <button
          className={`settings-nav-entry ${activeSection === 'editor' ? 'active' : ''}`}
          onClick={() => handleNavClick('editor')}
        >
          <span className="settings-nav-entry-icon">📝</span>
          <span>Editor</span>
        </button>
        <button 
          className={`settings-nav-entry ${activeSection === 'content' ? 'active' : ''}`}
          onClick={() => handleNavClick('content')}
        >
          <span className="settings-nav-entry-icon">📋</span>
          <span>Content</span>
        </button>
        <button 
          className={`settings-nav-entry ${activeSection === 'ai' ? 'active' : ''}`}
          onClick={() => handleNavClick('ai')}
        >
          <span className="settings-nav-entry-icon">🤖</span>
          <span>AI Assistant</span>
        </button>
        <button 
          className={`settings-nav-entry ${activeSection === 'sync' ? 'active' : ''}`}
          onClick={() => handleNavClick('sync')}
        >
          <span className="settings-nav-entry-icon">🔄</span>
          <span>Sync</span>
          {syncConfigured && <span className="settings-nav-badge">✓</span>}
        </button>
        <button 
          className={`settings-nav-entry ${activeSection === 'publishing' ? 'active' : ''}`}
          onClick={() => handleNavClick('publishing')}
        >
          <span className="settings-nav-entry-icon">🚀</span>
          <span>Publishing</span>
        </button>
        <button 
          className={`settings-nav-entry ${activeSection === 'data' ? 'active' : ''}`}
          onClick={() => handleNavClick('data')}
        >
          <span className="settings-nav-entry-icon">🗄️</span>
          <span>Data</span>
        </button>
      </div>
    </div>
  );
};

// Chat conversations list
const ChatList: React.FC = () => {
  const { openTab, closeTab } = useAppStore();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);

  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      const convs = await window.electronAPI?.chat.getConversations();
      if (convs) {
        setConversations(convs);
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  }, []);

  // Check if service is ready
  const checkReady = useCallback(async () => {
    try {
      const status = await window.electronAPI?.chat.checkReady();
      setIsReady(status?.ready ?? false);
    } catch {
      setIsReady(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await checkReady();
      await loadConversations();
      setIsLoading(false);
    };
    init();

    // Subscribe to title updates
    const unsubTitle = window.electronAPI?.chat.onTitleUpdated((data) => {
      setConversations(prev =>
        prev.map(c => c.id === data.conversationId ? { ...c, title: data.title } : c)
      );
    });

    return () => {
      unsubTitle?.();
    };
  }, [loadConversations, checkReady]);

  const handleNewChat = async () => {
    try {
      const conversation = await window.electronAPI?.chat.createConversation();
      if (conversation) {
        setConversations(prev => [conversation, ...prev]);
        openTab({ type: 'chat', id: conversation.id, isTransient: false });
      }
    } catch (error) {
      console.error('Failed to create conversation:', error);
      showToast.error('Failed to create new chat');
    }
  };

  const handleOpenChat = (conversationId: string) => {
    openTab({ type: 'chat', id: conversationId, isTransient: false });
  };

  const handleDeleteChat = async (conversationId: string) => {
    try {
      await window.electronAPI?.chat.deleteConversation(conversationId);
      setConversations(prev => prev.filter(c => c.id !== conversationId));
      // Close the tab for the deleted chat
      closeTab(conversationId);
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      showToast.error('Failed to delete chat');
    }
  };

  const formatChatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (isLoading) {
    return (
      <div className="chat-list">
        <div className="chat-list-header">
          <span>AI ASSISTANT</span>
        </div>
        <div className="chat-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="chat-list">
      <div className="chat-list-header">
        <span>AI ASSISTANT</span>
        <button className="chat-new-button" onClick={handleNewChat} title="New Chat">
          +
        </button>
      </div>
      {!isReady && (
        <div className="chat-auth-prompt">
          <p>API key needed. Open a chat to configure.</p>
        </div>
      )}
      <div className="chat-list-items">
        {conversations.length === 0 ? (
          <div className="chat-empty">
            <p>No conversations yet</p>
            <button className="chat-start-button" onClick={handleNewChat}>
              Start a new chat
            </button>
          </div>
        ) : (
          conversations.map(conv => (
            <div
              key={conv.id}
              className="chat-list-item"
              onClick={() => handleOpenChat(conv.id)}
            >
              <div className="chat-item-content">
                <div className="chat-item-title">{conv.title}</div>
                <div className="chat-item-date">{formatChatDate(conv.updatedAt)}</div>
              </div>
              <button
                className="chat-item-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteChat(conv.id);
                }}
                title="Delete conversation"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export const Sidebar: React.FC = () => {
  const { activeView, sidebarVisible } = useAppStore();

  if (!sidebarVisible) {
    return null;
  }

  return (
    <div className="sidebar">
      {activeView === 'posts' && <PostsList />}
      {activeView === 'media' && <MediaList />}
      {activeView === 'settings' && <SettingsNav />}
      {activeView === 'tags' && <TagsNav />}
      {activeView === 'chat' && <ChatList />}
    </div>
  );
};
