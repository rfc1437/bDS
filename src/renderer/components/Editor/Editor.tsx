import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore, PostData } from '../../store';
import './Editor.css';

interface PostEditorProps {
  post: PostData;
}

const PostEditor: React.FC<PostEditorProps> = ({ post }) => {
  const { updatePost } = useAppStore();
  const [title, setTitle] = useState(post.title);
  const [content, setContent] = useState(post.content);
  const [tags, setTags] = useState(post.tags.join(', '));
  const [isDirty, setIsDirty] = useState(false);

  // Reset when post changes
  useEffect(() => {
    setTitle(post.title);
    setContent(post.content);
    setTags(post.tags.join(', '));
    setIsDirty(false);
  }, [post.id]);

  // Track changes
  useEffect(() => {
    const hasChanges = 
      title !== post.title ||
      content !== post.content ||
      tags !== post.tags.join(', ');
    setIsDirty(hasChanges);
  }, [title, content, tags, post]);

  const handleSave = useCallback(async () => {
    if (!isDirty) return;

    try {
      const updated = await window.electronAPI?.posts.update(post.id, {
        title,
        content,
        tags: tags.split(',').map(t => t.trim()).filter(t => t.length > 0),
      });
      
      if (updated) {
        updatePost(post.id, updated as Partial<PostData>);
        setIsDirty(false);
      }
    } catch (error) {
      console.error('Failed to save post:', error);
    }
  }, [post.id, title, content, tags, isDirty, updatePost]);

  const handlePublish = async () => {
    await handleSave();
    try {
      const updated = await window.electronAPI?.posts.publish(post.id);
      if (updated) {
        updatePost(post.id, updated as Partial<PostData>);
      }
    } catch (error) {
      console.error('Failed to publish post:', error);
    }
  };

  const handleUnpublish = async () => {
    try {
      const updated = await window.electronAPI?.posts.unpublish(post.id);
      if (updated) {
        updatePost(post.id, updated as Partial<PostData>);
      }
    } catch (error) {
      console.error('Failed to unpublish post:', error);
    }
  };

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this post?')) {
      try {
        await window.electronAPI?.posts.delete(post.id);
        useAppStore.getState().removePost(post.id);
      } catch (error) {
        console.error('Failed to delete post:', error);
      }
    }
  };

  // Save on Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  // Listen for menu events
  useEffect(() => {
    const unsubscribeSave = window.electronAPI?.on('menu:save', handleSave);
    const unsubscribePublish = window.electronAPI?.on('menu:publishSelected', handlePublish);
    const unsubscribeUnpublish = window.electronAPI?.on('menu:unpublishSelected', handleUnpublish);

    return () => {
      unsubscribeSave?.();
      unsubscribePublish?.();
      unsubscribeUnpublish?.();
    };
  }, [handleSave]);

  return (
    <div className="editor">
      <div className="editor-header">
        <div className="editor-tabs">
          <div className={`editor-tab active ${isDirty ? 'dirty' : ''}`}>
            <span className="editor-tab-title">{post.title || 'Untitled'}</span>
            {isDirty && <span className="editor-tab-dirty">●</span>}
          </div>
        </div>
        <div className="editor-actions">
          <span className={`status-badge status-${post.status}`}>
            {post.status}
          </span>
          {post.status === 'draft' ? (
            <button onClick={handlePublish} title="Publish">Publish</button>
          ) : (
            <button onClick={handleUnpublish} className="secondary" title="Unpublish">
              Unpublish
            </button>
          )}
          <button onClick={handleSave} disabled={!isDirty} title="Save (Ctrl+S)">
            Save
          </button>
          <button onClick={handleDelete} className="secondary danger" title="Delete">
            Delete
          </button>
        </div>
      </div>

      <div className="editor-content">
        <div className="editor-meta">
          <div className="editor-field">
            <label>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Post title"
            />
          </div>
          <div className="editor-field">
            <label>Slug</label>
            <input
              type="text"
              value={post.slug}
              disabled
              className="disabled"
            />
          </div>
          <div className="editor-field">
            <label>Tags (comma-separated)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="tag1, tag2, tag3"
            />
          </div>
        </div>
        
        <div className="editor-body">
          <label>Content (Markdown)</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your post content in Markdown..."
            spellCheck
          />
        </div>
      </div>

      <div className="editor-footer">
        <span className="text-muted text-small">
          Created: {new Date(post.createdAt).toLocaleString()}
        </span>
        <span className="text-muted text-small">
          Updated: {new Date(post.updatedAt).toLocaleString()}
        </span>
        {post.publishedAt && (
          <span className="text-muted text-small">
            Published: {new Date(post.publishedAt).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
};

const MediaEditor: React.FC<{ mediaId: string }> = ({ mediaId }) => {
  const { media, updateMedia } = useAppStore();
  const item = media.find(m => m.id === mediaId);
  
  const [alt, setAlt] = useState(item?.alt || '');
  const [caption, setCaption] = useState(item?.caption || '');
  const [tags, setTags] = useState(item?.tags.join(', ') || '');

  useEffect(() => {
    if (item) {
      setAlt(item.alt || '');
      setCaption(item.caption || '');
      setTags(item.tags.join(', '));
    }
  }, [item?.id]);

  if (!item) {
    return <div className="editor-empty">Media not found</div>;
  }

  const handleSave = async () => {
    try {
      const updated = await window.electronAPI?.media.update(item.id, {
        alt,
        caption,
        tags: tags.split(',').map(t => t.trim()).filter(t => t.length > 0),
      });
      if (updated) {
        updateMedia(item.id, updated as Partial<typeof item>);
      }
    } catch (error) {
      console.error('Failed to update media:', error);
    }
  };

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this media file?')) {
      try {
        await window.electronAPI?.media.delete(item.id);
        useAppStore.getState().removeMedia(item.id);
      } catch (error) {
        console.error('Failed to delete media:', error);
      }
    }
  };

  return (
    <div className="editor">
      <div className="editor-header">
        <div className="editor-tabs">
          <div className="editor-tab active">
            <span className="editor-tab-title">{item.originalName}</span>
          </div>
        </div>
        <div className="editor-actions">
          <button onClick={handleSave}>Save</button>
          <button onClick={handleDelete} className="secondary danger">Delete</button>
        </div>
      </div>

      <div className="editor-content media-editor">
        <div className="media-preview">
          {item.mimeType.startsWith('image/') ? (
            <div className="media-preview-placeholder">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
              </svg>
              <span>{item.originalName}</span>
            </div>
          ) : (
            <div className="media-preview-placeholder">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
              </svg>
              <span>{item.originalName}</span>
            </div>
          )}
        </div>

        <div className="media-details">
          <div className="editor-field">
            <label>File Name</label>
            <input type="text" value={item.originalName} disabled className="disabled" />
          </div>
          <div className="editor-field">
            <label>Type</label>
            <input type="text" value={item.mimeType} disabled className="disabled" />
          </div>
          <div className="editor-field-row">
            <div className="editor-field">
              <label>Size</label>
              <input type="text" value={`${(item.size / 1024).toFixed(1)} KB`} disabled className="disabled" />
            </div>
            {item.width && item.height && (
              <div className="editor-field">
                <label>Dimensions</label>
                <input type="text" value={`${item.width} × ${item.height}`} disabled className="disabled" />
              </div>
            )}
          </div>
          <div className="editor-field">
            <label>Alt Text</label>
            <input
              type="text"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="Describe the image for accessibility"
            />
          </div>
          <div className="editor-field">
            <label>Caption</label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Image caption"
              rows={3}
            />
          </div>
          <div className="editor-field">
            <label>Tags (comma-separated)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="tag1, tag2, tag3"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

const WelcomeScreen: React.FC = () => {
  return (
    <div className="editor-empty">
      <div className="welcome-content">
        <h1>Blogging Desktop Server</h1>
        <p className="text-muted">bDS - Your offline-first blogging platform</p>
        
        <div className="welcome-actions">
          <div className="welcome-action">
            <h3>Create a New Post</h3>
            <p>Start writing your next blog post with Markdown support.</p>
            <button onClick={() => window.electronAPI?.posts.create({ title: 'New Post' })}>
              New Post
            </button>
          </div>
          <div className="welcome-action">
            <h3>Import Media</h3>
            <p>Add images and files to use in your posts.</p>
            <button className="secondary" onClick={() => window.electronAPI?.media.importDialog()}>
              Import Media
            </button>
          </div>
          <div className="welcome-action">
            <h3>Configure Sync</h3>
            <p>Connect to Turso for cloud synchronization.</p>
            <button className="secondary" onClick={() => useAppStore.getState().setActiveView('settings')}>
              Open Settings
            </button>
          </div>
        </div>

        <div className="welcome-shortcuts">
          <h4>Keyboard Shortcuts</h4>
          <div className="shortcut-list">
            <div className="shortcut-item">
              <kbd>Ctrl</kbd> + <kbd>N</kbd>
              <span>New Post</span>
            </div>
            <div className="shortcut-item">
              <kbd>Ctrl</kbd> + <kbd>S</kbd>
              <span>Save</span>
            </div>
            <div className="shortcut-item">
              <kbd>Ctrl</kbd> + <kbd>B</kbd>
              <span>Toggle Sidebar</span>
            </div>
            <div className="shortcut-item">
              <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>
              <span>Publish</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const Editor: React.FC = () => {
  const { activeView, selectedPostId, selectedMediaId, posts } = useAppStore();

  if (activeView === 'posts' && selectedPostId) {
    const post = posts.find(p => p.id === selectedPostId);
    if (post) {
      return <PostEditor post={post} />;
    }
  }

  if (activeView === 'media' && selectedMediaId) {
    return <MediaEditor mediaId={selectedMediaId} />;
  }

  return <WelcomeScreen />;
};
