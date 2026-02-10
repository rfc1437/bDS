import React from 'react';
import { useAppStore, PostData } from '../../store';
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

const PostsList: React.FC = () => {
  const { posts, selectedPostId, setSelectedPost } = useAppStore();

  const handleCreatePost = async () => {
    try {
      const newPost = await window.electronAPI?.posts.create({
        title: 'Untitled Post',
        content: '# New Post\n\nStart writing your content here...',
      });
      if (newPost) {
        setSelectedPost((newPost as PostData).id);
      }
    } catch (error) {
      console.error('Failed to create post:', error);
    }
  };

  const groupedPosts = {
    draft: posts.filter(p => p.status === 'draft'),
    published: posts.filter(p => p.status === 'published'),
    archived: posts.filter(p => p.status === 'archived'),
  };

  return (
    <div className="sidebar-content">
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>POSTS</span>
          <button className="sidebar-action" onClick={handleCreatePost} title="New Post">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/>
            </svg>
          </button>
        </div>
      </div>

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

      {posts.length === 0 && (
        <div className="sidebar-empty">
          <p>No posts yet</p>
          <button onClick={handleCreatePost}>Create your first post</button>
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
      {activeView === 'posts' && <PostsList />}
      {activeView === 'media' && <MediaList />}
      {activeView === 'settings' && <SettingsPanel />}
    </div>
  );
};
