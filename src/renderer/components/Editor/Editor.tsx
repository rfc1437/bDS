import React, { useState, useEffect, useCallback, useRef } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { useAppStore, PostData, UnsavedDraft, EditorMode } from '../../store';
import { showToast } from '../Toast';
import { WysiwygEditor } from '../WysiwygEditor';
import { Lightbox, useMarkdownImages } from '../Lightbox';
import { PostLinks } from '../PostLinks';
import { ErrorModal } from '../ErrorModal';
import './Editor.css';

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

// Check if an ID is for an unsaved draft
const isUnsavedDraftId = (id: string): boolean => id.startsWith('draft-');

interface SavedPostEditorProps {
  post: PostData;
}

const SavedPostEditor: React.FC<SavedPostEditorProps> = ({ post }) => {
  const { 
    updatePost, 
    markDirty, 
    markClean, 
    isDirty: checkIsDirty,
    preferredEditorMode,
    setPreferredEditorMode,
    showErrorModal,
  } = useAppStore();
  
  const [title, setTitle] = useState(post.title);
  const [content, setContent] = useState(post.content);
  const [tags, setTags] = useState(post.tags.join(', '));
  const [categories, setCategories] = useState(post.categories.join(', '));
  const [isSaving, setIsSaving] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>(preferredEditorMode);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const editorRef = useRef<unknown>(null);

  const isDirty = checkIsDirty(post.id);

  // Extract images from content for lightbox
  const images = useMarkdownImages(content);

  // Reset when post changes
  useEffect(() => {
    setTitle(post.title);
    setContent(post.content);
    setTags(post.tags.join(', '));
    setCategories(post.categories.join(', '));
    markClean(post.id);
  }, [post.id, post.title, post.content, post.tags, post.categories, markClean]);

  // Track changes
  useEffect(() => {
    const hasChanges = 
      title !== post.title ||
      content !== post.content ||
      tags !== post.tags.join(', ') ||
      categories !== post.categories.join(', ');
    
    if (hasChanges) {
      markDirty(post.id);
    } else {
      markClean(post.id);
    }
  }, [title, content, tags, categories, post, markDirty, markClean]);

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
        categories: categories.split(',').map(c => c.trim()).filter(c => c.length > 0),
      });
      
      if (updated) {
        updatePost(post.id, updated as Partial<PostData>);
        markClean(post.id);
        showToast.success('Post saved');
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
  }, [post.id, title, content, tags, categories, isDirty, isSaving, updatePost, markClean, showErrorModal]);

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

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this post?')) {
      try {
        await window.electronAPI?.posts.delete(post.id);
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
          <button onClick={handleSave} disabled={!isDirty || isSaving} title="Save (Ctrl+S)">
            {isSaving ? 'Saving...' : 'Save'}
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
              <label>Categories (comma-separated)</label>
              <input
                type="text"
                value={categories}
                onChange={(e) => setCategories(e.target.value)}
                placeholder="category1, category2"
              />
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
                dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
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

interface UnsavedDraftEditorProps {
  draft: UnsavedDraft;
}

const UnsavedDraftEditor: React.FC<UnsavedDraftEditorProps> = ({ draft }) => {
  const { 
    updateUnsavedDraft, 
    removeUnsavedDraft,
    addPost,
    setSelectedPost,
    preferredEditorMode,
    setPreferredEditorMode,
    showErrorModal,
    markClean,
  } = useAppStore();
  
  const [title, setTitle] = useState(draft.title);
  const [content, setContent] = useState(draft.content);
  const [tags, setTags] = useState(draft.tags.join(', '));
  const [categories, setCategories] = useState(draft.categories.join(', '));
  const [isSaving, setIsSaving] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>(preferredEditorMode);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const editorRef = useRef<unknown>(null);

  // Extract images from content for lightbox
  const images = useMarkdownImages(content);

  // Update draft in store when local state changes (for recovery purposes)
  useEffect(() => {
    const timeout = setTimeout(() => {
      updateUnsavedDraft(draft.id, { 
        title, 
        content, 
        tags: tags.split(',').map(t => t.trim()).filter(t => t.length > 0),
        categories: categories.split(',').map(c => c.trim()).filter(c => c.length > 0),
      });
    }, 500); // Debounce updates
    
    return () => clearTimeout(timeout);
  }, [title, content, tags, categories, draft.id, updateUnsavedDraft]);

  // Handle editor mode change and persist preference
  const handleEditorModeChange = (mode: EditorMode) => {
    setEditorMode(mode);
    setPreferredEditorMode(mode);
  };

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    
    // Validate - need at least a title
    if (!title.trim()) {
      showErrorModal({
        title: 'Validation Error',
        message: 'Please enter a title for your post before saving.',
      });
      return;
    }

    setIsSaving(true);
    try {
      // Create the post in the database
      const newPost = await window.electronAPI?.posts.create({
        title: title.trim(),
        content,
        tags: tags.split(',').map(t => t.trim()).filter(t => t.length > 0),
        categories: categories.split(',').map(c => c.trim()).filter(c => c.length > 0),
      });
      
      if (newPost) {
        const postData = newPost as PostData;
        // Add to posts list
        addPost(postData);
        // Remove the unsaved draft
        removeUnsavedDraft(draft.id);
        // Select the new post
        setSelectedPost(postData.id);
        markClean(postData.id);
        showToast.success('Post saved');
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
  }, [title, content, tags, categories, isSaving, draft.id, addPost, removeUnsavedDraft, setSelectedPost, markClean, showErrorModal]);

  const handleDiscard = () => {
    if (title.trim() || content.trim()) {
      if (!confirm('Are you sure you want to discard this unsaved post?')) {
        return;
      }
    }
    removeUnsavedDraft(draft.id);
    setSelectedPost(null);
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
    return () => {
      unsubscribeSave?.();
    };
  }, [handleSave]);

  const hasContent = title.trim() || content.trim();

  return (
    <div className="editor">
      <div className="editor-header">
        <div className="editor-tabs">
          <div className="editor-tab active dirty">
            <span className="editor-tab-title">{title || 'New Post'}</span>
            <span className="editor-tab-dirty">●</span>
            <span className="editor-tab-badge new">NEW</span>
          </div>
        </div>
        <div className="editor-actions">
          <span className="status-badge status-unsaved">unsaved</span>
          <button onClick={handleSave} disabled={isSaving} title="Save (Ctrl+S)">
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={handleDiscard} className="secondary danger" title="Discard">
            Discard
          </button>
        </div>
      </div>

      <div className="editor-content">
        <div className="editor-meta">
          <div className="editor-field">
            <label>Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter post title..."
              autoFocus
            />
          </div>
          <div className="editor-field slug-preview">
            <label>Slug (auto-generated on save)</label>
            <input
              type="text"
              value={title ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : ''}
              disabled
              className="disabled"
              placeholder="will-be-generated-from-title"
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
              <label>Categories (comma-separated)</label>
              <input
                type="text"
                value={categories}
                onChange={(e) => setCategories(e.target.value)}
                placeholder="category1, category2"
              />
            </div>
          </div>
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
              placeholder="Start writing your post..."
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
              {!content.trim() ? (
                <div className="preview-empty">
                  <p className="text-muted">No content to preview</p>
                </div>
              ) : (
                <div
                  className="preview-content"
                  dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
                />
              )}
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
          New post - not yet saved
        </span>
        {hasContent && (
          <span className="text-muted text-small">
            Press Ctrl+S to save
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
  const { createUnsavedDraft, setSelectedPost } = useAppStore();

  const handleNewPost = () => {
    const draftId = createUnsavedDraft();
    setSelectedPost(draftId);
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
    unsavedDrafts,
    errorModal,
    hideErrorModal,
  } = useAppStore();

  // Show error modal if present
  const renderErrorModal = () => (
    <ErrorModal error={errorModal} onClose={hideErrorModal} />
  );

  if (activeView === 'posts' && selectedPostId) {
    // Check if it's an unsaved draft
    if (isUnsavedDraftId(selectedPostId)) {
      const draft = unsavedDrafts.find(d => d.id === selectedPostId);
      if (draft) {
        return (
          <>
            <UnsavedDraftEditor draft={draft} />
            {renderErrorModal()}
          </>
        );
      }
    }
    
    // Otherwise, it's a saved post
    const post = posts.find(p => p.id === selectedPostId);
    if (post) {
      return (
        <>
          <SavedPostEditor post={post} />
          {renderErrorModal()}
        </>
      );
    }
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
