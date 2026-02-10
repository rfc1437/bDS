import React, { useState, useEffect } from 'react';
import { useAppStore, PostData } from '../../store';
import { showToast } from '../Toast';
import { ProjectSelector } from '../ProjectSelector';
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
  const { posts, selectedPostId, setSelectedPost } = useAppStore();
  
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
        // Map search results to PostData (search returns SearchResult with score)
        const postIds = (results as { id: string }[]).map(r => r.id);
        setSearchResults(posts.filter(p => postIds.includes(p.id)));
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
    try {
      const newPost = await window.electronAPI?.posts.create({
        title: 'Untitled Post',
        content: '# New Post\n\nStart writing your content here...',
      });
      if (newPost) {
        setSelectedPost((newPost as PostData).id);
        showToast.success('Post created');
      }
    } catch (error) {
      console.error('Failed to create post:', error);
      showToast.error('Failed to create post');
    }
  };

  // Determine which posts to display
  const displayPosts = searchResults ?? filteredPosts ?? posts;
  const isFiltered = searchResults !== null || filteredPosts !== null;
  const hasActiveFilters = searchQuery || selectedYear || selectedTags.length > 0 || selectedCategories.length > 0;

  const groupedPosts = {
    draft: displayPosts.filter(p => p.status === 'draft'),
    published: displayPosts.filter(p => p.status === 'published'),
    archived: displayPosts.filter(p => p.status === 'archived'),
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
            {displayPosts.length} result{displayPosts.length !== 1 ? 's' : ''}
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
            {groupedPosts.draft.map(post => (
              <div
                key={post.id}
                className={`sidebar-item ${selectedPostId === post.id ? 'selected' : ''}`}
                onClick={() => setSelectedPost(post.id)}
              >
                <div className="sidebar-item-title">{post.title}</div>
                <div className="sidebar-item-meta">{formatDate(post.updatedAt)}</div>
              </div>
            ))}
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
            {groupedPosts.published.map(post => (
              <div
                key={post.id}
                className={`sidebar-item ${selectedPostId === post.id ? 'selected' : ''}`}
                onClick={() => setSelectedPost(post.id)}
              >
                <div className="sidebar-item-title">{post.title}</div>
                <div className="sidebar-item-meta">{formatDate(post.publishedAt || post.updatedAt)}</div>
              </div>
            ))}
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
            {groupedPosts.archived.map(post => (
              <div
                key={post.id}
                className={`sidebar-item ${selectedPostId === post.id ? 'selected' : ''}`}
                onClick={() => setSelectedPost(post.id)}
              >
                <div className="sidebar-item-title">{post.title}</div>
                <div className="sidebar-item-meta">{formatDate(post.updatedAt)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {displayPosts.length === 0 && !isFiltered && (
        <div className="sidebar-empty">
          <p>No posts yet</p>
          <button onClick={handleCreatePost}>Create your first post</button>
        </div>
      )}

      {displayPosts.length === 0 && isFiltered && (
        <div className="sidebar-empty">
          <p>No matching posts</p>
          <button onClick={clearAllFilters}>Clear filters</button>
        </div>
      )}
    </div>
  );
};

const MediaList: React.FC = () => {
  const { media, selectedMediaId, setSelectedMedia } = useAppStore();

  const handleImportMedia = async () => {
    try {
      await window.electronAPI?.media.importDialog();
    } catch (error) {
      console.error('Failed to import media:', error);
    }
  };

  return (
    <div className="sidebar-content">
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>MEDIA</span>
          <button className="sidebar-action" onClick={handleImportMedia} title="Import Media">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="sidebar-list media-grid">
        {media.map(item => (
          <div
            key={item.id}
            className={`media-item ${selectedMediaId === item.id ? 'selected' : ''}`}
            onClick={() => setSelectedMedia(item.id)}
            title={item.originalName}
          >
            {item.mimeType.startsWith('image/') ? (
              <div className="media-thumbnail">
                {/* Would load actual image in production */}
                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" opacity="0.5">
                  <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                </svg>
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

      {media.length === 0 && (
        <div className="sidebar-empty">
          <p>No media files</p>
          <button onClick={handleImportMedia}>Import media</button>
        </div>
      )}
    </div>
  );
};

const SettingsPanel: React.FC = () => {
  const { syncConfigured } = useAppStore();
  const [tursoUrl, setTursoUrl] = React.useState('');
  const [tursoToken, setTursoToken] = React.useState('');

  const handleSaveSync = async () => {
    try {
      await window.electronAPI?.sync.configure({
        tursoUrl,
        tursoAuthToken: tursoToken,
        autoSync: true,
        syncInterval: 5,
      });
    } catch (error) {
      console.error('Failed to configure sync:', error);
    }
  };

  return (
    <div className="sidebar-content settings-panel">
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>SETTINGS</span>
        </div>
      </div>

      <div className="settings-group">
        <h3>Cloud Sync (Turso/LibSQL)</h3>
        <div className="settings-field">
          <label>Turso Database URL</label>
          <input
            type="text"
            placeholder="libsql://your-db.turso.io"
            value={tursoUrl}
            onChange={(e) => setTursoUrl(e.target.value)}
          />
        </div>
        <div className="settings-field">
          <label>Auth Token</label>
          <input
            type="password"
            placeholder="Your auth token"
            value={tursoToken}
            onChange={(e) => setTursoToken(e.target.value)}
          />
        </div>
        <button onClick={handleSaveSync}>
          {syncConfigured ? 'Update Sync Settings' : 'Enable Sync'}
        </button>
        
        {syncConfigured && (
          <p className="settings-status status-published">✓ Sync is configured</p>
        )}
      </div>

      <div className="settings-group">
        <h3>Data Management</h3>
        <button 
          className="secondary"
          onClick={() => window.electronAPI?.posts.rebuildFromFiles()}
        >
          Rebuild Posts Database
        </button>
        <button 
          className="secondary"
          onClick={() => window.electronAPI?.media.rebuildFromFiles()}
        >
          Rebuild Media Database
        </button>
        <button 
          className="secondary"
          onClick={async () => {
            const paths = await window.electronAPI?.app.getDataPaths();
            if (paths) {
              window.electronAPI?.app.openFolder(paths.posts);
            }
          }}
        >
          Open Data Folder
        </button>
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
      <ProjectSelector />
      {activeView === 'posts' && <PostsList />}
      {activeView === 'media' && <MediaList />}
      {activeView === 'settings' && <SettingsPanel />}
    </div>
  );
};
