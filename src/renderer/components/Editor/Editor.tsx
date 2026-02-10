import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { useAppStore, PostData, EditorMode, MediaData } from '../../store';
import { showToast } from '../Toast';
import { WysiwygEditor } from '../WysiwygEditor';
import { Lightbox, useMarkdownImages } from '../Lightbox';
import { PostLinks } from '../PostLinks';
import { ErrorModal } from '../ErrorModal';
import { SettingsView } from '../SettingsView';
import './Editor.css';

/**
 * Resolves media references in markdown content to bds-media:// URLs
 * Matches images by:
 * 1. Media ID in the path (e.g., /media/2025/01/{id}.jpg)
 * 2. Original filename (e.g., image.jpg)
 * 3. Filename pattern (e.g., {id}.jpg)
 */
const resolveMediaUrls = (content: string, mediaList: MediaData[]): string => {
  if (!content || mediaList.length === 0) return content;
  
  // Build lookup maps for efficient matching
  const byId = new Map<string, string>();
  const byOriginalName = new Map<string, string>();
  const byFilename = new Map<string, string>();
  
  for (const m of mediaList) {
    byId.set(m.id, m.id);
    byOriginalName.set(m.originalName.toLowerCase(), m.id);
    byFilename.set(m.filename.toLowerCase(), m.id);
  }
  
  // Replace image URLs in markdown
  return content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    // Skip if already using bds-media protocol or external URLs
    if (src.startsWith('bds-media://') || src.startsWith('http://') || src.startsWith('https://')) {
      return match;
    }
    
    // Extract the filename from the path
    const filename = src.split('/').pop() || '';
    const filenameWithoutExt = filename.replace(/\.[^.]+$/, '');
    const filenameLower = filename.toLowerCase();
    
    // Try to match by:
    // 1. UUID in path (the file is named by ID)
    if (byId.has(filenameWithoutExt)) {
      return `![${alt}](bds-media://${filenameWithoutExt})`;
    }
    
    // 2. Filename lookup
    if (byFilename.has(filenameLower)) {
      return `![${alt}](bds-media://${byFilename.get(filenameLower)})`;
    }
    
    // 3. Original name lookup
    if (byOriginalName.has(filenameLower)) {
      return `![${alt}](bds-media://${byOriginalName.get(filenameLower)})`;
    }
    
    // No match found, return original
    return match;
  });
};

// Simple markdown to HTML converter for preview
const markdownToHtml = (markdown: string): string => {
  return markdown
    // Escape HTML
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    // Images
    .replace(/!\[(.*?)\]\((.*?)\)/gim, '<img alt="$1" src="$2" style="max-width: 100%;" />')
    // Links
    .replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2" target="_blank">$1</a>')
    // Code blocks
    .replace(/```([\s\S]*?)```/gim, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`(.*?)`/gim, '<code>$1</code>')
    // Blockquotes
    .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
    // Horizontal rules
    .replace(/^---$/gim, '<hr />')
    // Line breaks
    .replace(/\n/g, '<br />');
};

interface PostEditorProps {
  post: PostData;
}

const PostEditor: React.FC<PostEditorProps> = ({ post }) => {
  const { 
    updatePost, 
    markDirty, 
    markClean, 
    isDirty: checkIsDirty,
    preferredEditorMode,
    setPreferredEditorMode,
    showErrorModal,
    media,
  } = useAppStore();
  
  const [title, setTitle] = useState(post.title);
  const [content, setContent] = useState(post.content);
  const [tags, setTags] = useState(post.tags.join(', '));
  const [category, setCategory] = useState(post.categories[0] || 'article');
  const [availableCategories, setAvailableCategories] = useState<string[]>(['article', 'picture', 'aside', 'page']);
  const [isSaving, setIsSaving] = useState(false);
  const [hasPublishedVersion, setHasPublishedVersion] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>(preferredEditorMode);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const editorRef = useRef<unknown>(null);

  const isDirty = checkIsDirty(post.id);

  // Check if post has a published version for discard functionality
  useEffect(() => {
    window.electronAPI?.posts.hasPublishedVersion(post.id).then(setHasPublishedVersion);
  }, [post.id]);

  // Load available categories from localStorage
  useEffect(() => {
    const savedCategories = localStorage.getItem('bds-categories');
    if (savedCategories) {
      try {
        const parsed = JSON.parse(savedCategories);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setAvailableCategories(parsed);
        }
      } catch {
        // Keep defaults
      }
    }
  }, []);

  // Resolve media URLs in content for display
  const resolvedContent = useMemo(() => resolveMediaUrls(content, media), [content, media]);

  // Extract images from resolved content for lightbox
  const images = useMarkdownImages(resolvedContent);

  // Track latest values for auto-save on unmount/switch
  const pendingChangesRef = useRef<{
    title: string;
    content: string;
    tags: string;
    category: string;
    postId: string;
    isDirty: boolean;
  } | null>(null);

  // Update ref when values change
  useEffect(() => {
    pendingChangesRef.current = {
      title,
      content,
      tags,
      category,
      postId: post.id,
      isDirty,
    };
  }, [title, content, tags, category, post.id, isDirty]);

  // Auto-save when switching away from a post or unmounting
  useEffect(() => {
    const prevPostId = post.id;
    
    return () => {
      const pending = pendingChangesRef.current;
      // Only auto-save if the post still exists in the store (not deleted/discarded)
      const postStillExists = useAppStore.getState().posts.some(p => p.id === prevPostId);
      if (pending && pending.postId === prevPostId && pending.isDirty && postStillExists) {
        // Fire and forget auto-save
        window.electronAPI?.posts.update(pending.postId, {
          title: pending.title,
          content: pending.content,
          tags: pending.tags.split(',').map(t => t.trim()).filter(t => t.length > 0),
          categories: pending.category ? [pending.category] : ['article'],
        }).then((updated) => {
          if (updated) {
            useAppStore.getState().updatePost(pending.postId, updated as Partial<PostData>);
            useAppStore.getState().markClean(pending.postId);
          }
        }).catch((error) => {
          console.error('Auto-save failed:', error);
        });
      }
    };
  }, [post.id]);

  // Reset when post changes (after auto-save cleanup runs)
  useEffect(() => {
    setTitle(post.title);
    setContent(post.content);
    setTags(post.tags.join(', '));
    setCategory(post.categories[0] || 'article');
    markClean(post.id);
  }, [post.id, post.title, post.content, post.tags, post.categories, markClean]);

  // Track changes
  useEffect(() => {
    const currentCategory = post.categories[0] || 'article';
    const hasChanges = 
      title !== post.title ||
      content !== post.content ||
      tags !== post.tags.join(', ') ||
      category !== currentCategory;
    
    if (hasChanges) {
      markDirty(post.id);
    } else {
      markClean(post.id);
    }
  }, [title, content, tags, category, post, markDirty, markClean]);

  // Handle editor mode change and persist preference
  const handleEditorModeChange = (mode: EditorMode) => {
    setEditorMode(mode);
    setPreferredEditorMode(mode);
  };

  const handleSave = useCallback(async () => {
    if (!isDirty || isSaving) return;

    setIsSaving(true);
    try {
      const updated = await window.electronAPI?.posts.update(post.id, {
        title,
        content,
        tags: tags.split(',').map(t => t.trim()).filter(t => t.length > 0),
        categories: category ? [category] : ['article'],
      });
      
      if (updated) {
        updatePost(post.id, updated as Partial<PostData>);
        markClean(post.id);
      }
    } catch (error) {
      console.error('Failed to save post:', error);
      const err = error as Error;
      showErrorModal({
        title: 'Save Failed',
        message: err.message || 'Failed to save post',
        stack: err.stack,
      });
    } finally {
      setIsSaving(false);
    }
  }, [post.id, title, content, tags, category, isDirty, isSaving, updatePost, markClean, showErrorModal]);

  const handlePublish = async () => {
    await handleSave();
    try {
      const updated = await window.electronAPI?.posts.publish(post.id);
      if (updated) {
        updatePost(post.id, updated as Partial<PostData>);
        showToast.success('Post published');
      }
    } catch (error) {
      console.error('Failed to publish post:', error);
      const err = error as Error;
      showErrorModal({
        title: 'Publish Failed',
        message: err.message || 'Failed to publish post',
        stack: err.stack,
      });
    }
  };

  const handleUnpublish = async () => {
    try {
      const updated = await window.electronAPI?.posts.unpublish(post.id);
      if (updated) {
        updatePost(post.id, updated as Partial<PostData>);
        showToast.success('Post unpublished');
      }
    } catch (error) {
      console.error('Failed to unpublish post:', error);
      const err = error as Error;
      showErrorModal({
        title: 'Unpublish Failed',
        message: err.message || 'Failed to unpublish post',
        stack: err.stack,
      });
    }
  };

  const handleDiscard = async () => {
    // If this post has a published version, revert to it
    // If never published, delete the post entirely
    const confirmMessage = hasPublishedVersion
      ? 'Discard all changes since last publish? This cannot be undone.'
      : 'Delete this draft? This cannot be undone.';
    
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      if (hasPublishedVersion) {
        // Revert to published version
        const reverted = await window.electronAPI?.posts.discard(post.id);
        if (reverted) {
          setTitle(reverted.title);
          setContent(reverted.content);
          setTags(reverted.tags.join(', '));
          setCategory(reverted.categories[0] || 'article');
          updatePost(post.id, reverted as Partial<PostData>);
          markClean(post.id);
          showToast.success('Reverted to last published version');
        }
      } else {
        // Never published - delete the post entirely
        await window.electronAPI?.posts.delete(post.id);
        // Clear pending ref to prevent auto-save on unmount from resurrecting the post
        pendingChangesRef.current = null;
        useAppStore.getState().removePost(post.id);
        useAppStore.getState().setSelectedPost(null);
        showToast.success('Draft deleted');
      }
    } catch (error) {
      console.error('Failed to discard/delete:', error);
      const err = error as Error;
      showErrorModal({
        title: hasPublishedVersion ? 'Discard Failed' : 'Delete Failed',
        message: err.message || 'Operation failed',
        stack: err.stack,
      });
    }
  };

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this post?')) {
      try {
        await window.electronAPI?.posts.delete(post.id);
        // Clear pending ref to prevent auto-save on unmount from resurrecting the post
        pendingChangesRef.current = null;
        useAppStore.getState().removePost(post.id);
        useAppStore.getState().setSelectedPost(null);
        showToast.success('Post deleted');
      } catch (error) {
        console.error('Failed to delete post:', error);
        const err = error as Error;
        showErrorModal({
          title: 'Delete Failed',
          message: err.message || 'Failed to delete post',
          stack: err.stack,
        });
      }
    }
  };

  // Handle Monaco editor mount
  const handleEditorDidMount = (editor: unknown) => {
    editorRef.current = editor;
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
            <span className="editor-tab-title">{title || 'Untitled'}</span>
            {isDirty && <span className="editor-tab-dirty" title="Unsaved changes (auto-saves on switch)">●</span>}
          </div>
        </div>
        <div className="editor-actions">
          <span className={`status-badge status-${post.status}`}>
            {post.status}
          </span>
          {isSaving && <span className="auto-save-indicator">Saving...</span>}
          {post.status === 'draft' ? (
            <button 
              onClick={handlePublish} 
              className="success"
              title="Save and make this post public"
            >
              Publish
            </button>
          ) : (
            <button 
              onClick={handleUnpublish} 
              className="secondary" 
              title="Return to draft status"
            >
              Unpublish
            </button>
          )}
          {post.status === 'draft' && (
            <button 
              onClick={handleDiscard} 
              className="secondary danger"
              title={hasPublishedVersion ? "Revert to last published version" : "Delete this draft permanently"}
            >
              {hasPublishedVersion ? 'Discard Changes' : 'Discard Draft'}
            </button>
          )}
          {post.status === 'published' && (
            <button onClick={handleDelete} className="secondary danger" title="Delete this post permanently">
              Delete
            </button>
          )}
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
              placeholder="Untitled"
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
          <div className="editor-field-row">
            <div className="editor-field">
              <label>Tags (comma-separated)</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="tag1, tag2, tag3"
              />
            </div>
            <div className="editor-field">
              <label>Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {availableCategories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>
          
          <PostLinks 
            postId={post.id}
            onPostClick={(id) => useAppStore.getState().setSelectedPost(id)}
          />
        </div>
        
        <div className="editor-body">
          <div className="editor-toolbar">
            <label>Content</label>
            <div className="editor-mode-toggle">
              <button 
                className={editorMode === 'wysiwyg' ? 'active' : ''} 
                onClick={() => handleEditorModeChange('wysiwyg')}
                title="Visual editor"
              >
                Visual
              </button>
              <button 
                className={editorMode === 'markdown' ? 'active' : ''} 
                onClick={() => handleEditorModeChange('markdown')}
                title="Markdown source"
              >
                Markdown
              </button>
              <button 
                className={editorMode === 'preview' ? 'active' : ''} 
                onClick={() => handleEditorModeChange('preview')}
                title="Read-only preview"
              >
                Preview
              </button>
            </div>
            {images.length > 0 && (
              <button 
                className="gallery-button"
                onClick={() => { setLightboxIndex(0); setLightboxOpen(true); }}
                title={`View ${images.length} image(s)`}
              >
                📷 {images.length}
              </button>
            )}
          </div>
          
          {editorMode === 'wysiwyg' && (
            <WysiwygEditor
              content={content}
              onChange={setContent}
              placeholder="Start writing..."
            />
          )}
          
          {editorMode === 'markdown' && (
            <MonacoEditor
              height="100%"
              defaultLanguage="markdown"
              value={content}
              onChange={(value) => setContent(value || '')}
              onMount={handleEditorDidMount}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                wordWrap: 'on',
                lineNumbers: 'on',
                fontSize: 14,
                fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
                padding: { top: 12, bottom: 12 },
                automaticLayout: true,
                scrollBeyondLastLine: false,
                renderLineHighlight: 'line',
                quickSuggestions: false,
                formatOnPaste: true,
                cursorStyle: 'line',
                cursorBlinking: 'smooth',
              }}
            />
          )}
          
          {editorMode === 'preview' && (
            <div className="editor-preview markdown-body">
              <div
                className="preview-content"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(resolvedContent) }}
              />
            </div>
          )}
        </div>
        
        {/* Lightbox for viewing images in content */}
        <Lightbox
          images={images}
          initialIndex={lightboxIndex}
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
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
  const { media, updateMedia, showErrorModal } = useAppStore();
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
        showToast.success('Media updated');
      }
    } catch (error) {
      console.error('Failed to update media:', error);
      const err = error as Error;
      showErrorModal({
        title: 'Update Failed',
        message: err.message || 'Failed to update media',
        stack: err.stack,
      });
    }
  };

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this media file?')) {
      try {
        await window.electronAPI?.media.delete(item.id);
        useAppStore.getState().removeMedia(item.id);
        showToast.success('Media deleted');
      } catch (error) {
        console.error('Failed to delete media:', error);
        const err = error as Error;
        showErrorModal({
          title: 'Delete Failed',
          message: err.message || 'Failed to delete media',
          stack: err.stack,
        });
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
            <div className="media-preview-image">
              <img 
                src={`bds-media://${item.id}`} 
                alt={item.alt || item.originalName}
                onError={(e) => {
                  // Fallback to placeholder if image fails to load
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  target.parentElement?.classList.add('has-error');
                }}
              />
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
  const { setSelectedPost } = useAppStore();

  const handleNewPost = async () => {
    try {
      const newPost = await window.electronAPI?.posts.create({
        title: '',
        content: '',
        tags: [],
        categories: [],
      });
      if (newPost) {
        setSelectedPost(newPost.id);
      }
    } catch (error) {
      console.error('Failed to create post:', error);
    }
  };

  return (
    <div className="editor-empty">
      <div className="welcome-content">
        <h1>Blogging Desktop Server</h1>
        <p className="text-muted">bDS - Your offline-first blogging platform</p>
        
        <div className="welcome-actions">
          <div className="welcome-action">
            <h3>Create a New Post</h3>
            <p>Start writing your next blog post with Markdown support.</p>
            <button onClick={handleNewPost}>
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
  const { 
    activeView, 
    selectedPostId, 
    selectedMediaId, 
    posts, 
    errorModal,
    hideErrorModal,
    isLoading,
    setSelectedPost,
  } = useAppStore();

  // Show error modal if present
  const renderErrorModal = () => (
    <ErrorModal error={errorModal} onClose={hideErrorModal} />
  );

  if (activeView === 'settings') {
    return (
      <>
        <SettingsView />
        {renderErrorModal()}
      </>
    );
  }

  if (activeView === 'posts' && selectedPostId) {
    const post = posts.find(p => p.id === selectedPostId);
    if (post) {
      return (
        <>
          <PostEditor post={post} />
          {renderErrorModal()}
        </>
      );
    }
    
    // Post not found - show loading if still loading, otherwise clear selection
    if (isLoading) {
      return (
        <>
          <div className="editor-empty">
            <div className="welcome-content">
              <p className="text-muted">Loading post...</p>
            </div>
          </div>
          {renderErrorModal()}
        </>
      );
    }
    
    // Post truly not found - clear selection and fall through to welcome screen
    setSelectedPost(null);
  }

  if (activeView === 'media' && selectedMediaId) {
    return (
      <>
        <MediaEditor mediaId={selectedMediaId} />
        {renderErrorModal()}
      </>
    );
  }

  return (
    <>
      <WelcomeScreen />
      {renderErrorModal()}
    </>
  );
};
