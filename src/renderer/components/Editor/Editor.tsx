import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import MonacoEditor, { Monaco } from '@monaco-editor/react';
import { useAppStore, PostData, EditorMode, MediaData } from '../../store';
import { showToast } from '../Toast';
import { MilkdownEditor } from '../MilkdownEditor';
import { Lightbox, useMarkdownImages } from '../Lightbox';
import { PostLinks } from '../PostLinks';
import { LinkedMediaPanel } from '../LinkedMediaPanel';
import { ErrorModal } from '../ErrorModal';
import { SettingsView } from '../SettingsView';
import { TagsView } from '../TagsView';
import { TagInput } from '../TagInput';
import { ChatPanel } from '../ChatPanel';
import { AutoSaveManager } from '../../utils';
import { parseMacros, getMacro } from '../../macros/registry';
import './Editor.css';

// Module-level AutoSaveManager for idle-time based auto-saving
const autoSaveManager = new AutoSaveManager({
  idleTimeMs: 3000, // Save after 3 seconds of idle time
  onSave: async (id, changes) => {
    const state = useAppStore.getState();
    // Only save if post still exists in store
    const postExists = state.posts.some(p => p.id === id);
    if (!postExists) return;

    // Build update payload from changes
    const update: Parameters<typeof window.electronAPI.posts.update>[1] = {};
    if ('title' in changes) update.title = changes.title as string;
    if ('content' in changes) update.content = changes.content as string;
    if ('tags' in changes) {
      const tagsStr = changes.tags as string;
      update.tags = tagsStr.split(',').map(t => t.trim()).filter(t => t.length > 0);
    }
    if ('category' in changes) {
      const cat = changes.category as string;
      update.categories = cat ? [cat] : ['article'];
    }

    const updated = await window.electronAPI?.posts.update(id, update);
    if (updated) {
      useAppStore.getState().updatePost(id, updated as Partial<PostData>);
      useAppStore.getState().markClean(id);
    }
  },
  onSaveComplete: (id) => {
    console.log(`Auto-saved post ${id}`);
  },
  onSaveError: (id, error) => {
    console.error(`Auto-save failed for ${id}:`, error);
  },
});

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

// Render a macro synchronously for preview
const renderMacroSync = (name: string, params: Record<string, string>, postId?: string): string => {
  const macro = getMacro(name);
  if (!macro) {
    return `<span class="macro-error">Unknown macro: ${name}</span>`;
  }
  try {
    const result = macro.render(params, { postId, isPreview: true });
    // If it returns a promise, show loading state (shouldn't happen for gallery)
    if (result instanceof Promise) {
      return `<div class="macro-loading">Loading ${name}...</div>`;
    }
    return result;
  } catch (e) {
    return `<span class="macro-error">Error rendering ${name}</span>`;
  }
};

// Simple markdown to HTML converter for preview
const markdownToHtml = (markdown: string, postId?: string): string => {
  // First, render macros
  const macros = parseMacros(markdown);
  let result = markdown;
  
  // Replace macros from end to start to preserve positions
  for (let i = macros.length - 1; i >= 0; i--) {
    const macro = macros[i];
    const rendered = renderMacroSync(macro.name, macro.params, postId);
    result = result.slice(0, macro.start) + rendered + result.slice(macro.end);
  }
  
  return result
    // Escape HTML (but not our rendered macros - they're already safe)
    // We need to be careful here - macro output contains HTML
    // For safety, we skip escaping since we control the macro output
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

/**
 * Hydrate gallery elements in the preview with actual linked media
 */
const hydrateGalleries = async (
  container: HTMLElement,
  postId: string,
  onImageClick: (index: number, images: { src: string; alt: string }[]) => void
) => {
  const galleries = container.querySelectorAll('.macro-gallery[data-post-id]');
  
  for (const gallery of galleries) {
    const galleryPostId = gallery.getAttribute('data-post-id');
    if (!galleryPostId || galleryPostId !== postId) continue;
    
    const galleryContainer = gallery.querySelector('.gallery-container');
    if (!galleryContainer) continue;
    
    try {
      // Load linked media for this post
      const linkedData = await window.electronAPI?.postMedia.getMediaDataForPost(postId);
      
      if (!linkedData || linkedData.length === 0) {
        galleryContainer.innerHTML = '<div class="gallery-empty">No media linked to this post</div>';
        continue;
      }
      
      // Filter to images only (media is nested in the link object)
      const images = linkedData.filter(link => link.media?.mimeType?.startsWith('image/'));
      
      if (images.length === 0) {
        galleryContainer.innerHTML = '<div class="gallery-empty">No images linked to this post</div>';
        continue;
      }
      
      // Build gallery grid (column count is handled via CSS class on parent)
      galleryContainer.innerHTML = images.map((link, index) => `
        <div class="gallery-item" data-index="${index}">
          <img 
            src="bds-media://${link.media.id}" 
            alt="${link.media.alt || link.media.originalName}" 
            title="${link.media.originalName}"
          />
        </div>
      `).join('');
      
      // Set up lightbox click handlers
      const items = galleryContainer.querySelectorAll('.gallery-item');
      const imageData = images.map(link => ({
        src: `bds-media://${link.media.id}`,
        alt: link.media.alt || link.media.originalName,
      }));
      
      items.forEach((item, index) => {
        item.addEventListener('click', () => onImageClick(index, imageData));
      });
      
    } catch (error) {
      console.error('Failed to hydrate gallery:', error);
      galleryContainer.innerHTML = '<div class="gallery-error">Failed to load gallery</div>';
    }
  }
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
  const [tags, setTags] = useState<string[]>(post.tags);
  const [category, setCategory] = useState(post.categories[0] || 'article');
  const [availableCategories, setAvailableCategories] = useState<string[]>(['article', 'picture', 'aside', 'page']);
  const [isSaving, setIsSaving] = useState(false);
  const [hasPublishedVersion, setHasPublishedVersion] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>(preferredEditorMode);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [galleryImages, setGalleryImages] = useState<{ src: string; alt: string }[]>([]);
  const editorRef = useRef<unknown>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const isDirty = checkIsDirty(post.id);

  // Check if post has a published version for discard functionality
  useEffect(() => {
    window.electronAPI?.posts.hasPublishedVersion(post.id).then(setHasPublishedVersion);
  }, [post.id]);

  // Load available categories from backend (project-scoped)
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const categories = await window.electronAPI?.meta.getCategories();
        if (categories && categories.length > 0) {
          setAvailableCategories(categories);
        }
      } catch {
        // Keep defaults
      }
    };
    loadCategories();
  }, []);

  // Resolve media URLs in content for display
  const resolvedContent = useMemo(() => resolveMediaUrls(content, media), [content, media]);

  // Extract images from resolved content for lightbox
  const images = useMarkdownImages(resolvedContent);
  
  // Combine regular images with gallery images for lightbox
  const allImages = useMemo(() => {
    // If gallery images are set, use those; otherwise use extracted images
    return galleryImages.length > 0 ? galleryImages : images;
  }, [images, galleryImages]);

  // Hydrate galleries when in preview mode
  useEffect(() => {
    if (editorMode !== 'preview' || !previewRef.current) return;
    
    // Small delay to ensure DOM is updated
    const timer = setTimeout(() => {
      if (previewRef.current) {
        hydrateGalleries(
          previewRef.current,
          post.id,
          (index, imgs) => {
            setGalleryImages(imgs);
            setLightboxIndex(index);
            setLightboxOpen(true);
          }
        );
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, [editorMode, post.id, resolvedContent]);

  // Track latest values for auto-save on unmount/switch
  const pendingChangesRef = useRef<{
    title: string;
    content: string;
    tags: string[];
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
      // Cancel any pending auto-save timer - we'll save immediately
      autoSaveManager.cancel(prevPostId);
      
      const pending = pendingChangesRef.current;
      // Only auto-save if the post still exists in the store (not deleted/discarded)
      const postStillExists = useAppStore.getState().posts.some(p => p.id === prevPostId);
      if (pending && pending.postId === prevPostId && pending.isDirty && postStillExists) {
        // Fire and forget auto-save
        window.electronAPI?.posts.update(pending.postId, {
          title: pending.title,
          content: pending.content,
          tags: pending.tags,
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
    setTags(post.tags);
    setCategory(post.categories[0] || 'article');
    markClean(post.id);
  }, [post.id, post.title, post.content, post.tags, post.categories, markClean]);

  // Track changes and notify auto-save manager
  useEffect(() => {
    const currentCategory = post.categories[0] || 'article';
    const tagsChanged = JSON.stringify(tags.slice().sort()) !== JSON.stringify(post.tags.slice().sort());
    const hasChanges = 
      title !== post.title ||
      content !== post.content ||
      tagsChanged ||
      category !== currentCategory;
    
    if (hasChanges) {
      markDirty(post.id);
      // Notify auto-save manager with accumulated changes
      // Convert tags array to comma-separated string for auto-save compatibility
      autoSaveManager.notifyChange(post.id, {
        title,
        content,
        tags: tags.join(', '),
        category,
      });
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

    // Cancel any pending auto-save since we're saving manually
    autoSaveManager.cancel(post.id);
    
    setIsSaving(true);
    try {
      const updated = await window.electronAPI?.posts.update(post.id, {
        title,
        content,
        tags,
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
          setTags(reverted.tags);
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

  // Configure Monaco before mount to add macro syntax highlighting
  const handleEditorWillMount = (monaco: Monaco) => {
    // Register a custom language that extends markdown with macro support
    monaco.languages.register({ id: 'markdown-with-macros' });
    
    // Define custom tokenization that highlights [[macro]] syntax
    monaco.languages.setMonarchTokensProvider('markdown-with-macros', {
      defaultToken: '',
      tokenPostfix: '.md',

      tokenizer: {
        root: [
          // Macro syntax: [[macroName param="value"]]
          [/\[\[[a-zA-Z][\w-]*/, { token: 'keyword.macro', next: '@macroParams' }],
          
          // Headers
          [/^#{1,6}\s.*$/, 'keyword.header'],
          
          // Block elements
          [/^\s*>+/, 'string.quote'],
          [/^\s*[-+*]\s/, 'keyword'],
          [/^\s*\d+\.\s/, 'keyword'],
          [/^\s*```\w*/, { token: 'string.code', next: '@codeblock' }],
          
          // Inline elements  
          [/\*\*[^*]+\*\*/, 'strong'],
          [/\*[^*]+\*/, 'emphasis'],
          [/__[^_]+__/, 'strong'],
          [/_[^_]+_/, 'emphasis'],
          [/`[^`]+`/, 'variable'],
          
          // Links and images
          [/!?\[[^\]]*\]\([^)]*\)/, 'string.link'],
          [/!?\[[^\]]*\]\[[^\]]*\]/, 'string.link'],
        ],

        macroParams: [
          [/\]\]/, { token: 'keyword.macro', next: '@root' }],
          [/[a-zA-Z][\w-]*(?=\s*=)/, 'attribute.name'],
          [/=/, 'delimiter'],
          [/"[^"]*"/, 'string'],
          [/\s+/, 'white'],
          [/[^\]"=\s]+/, 'attribute.value'],
        ],

        codeblock: [
          [/^\s*```\s*$/, { token: 'string.code', next: '@root' }],
          [/.*$/, 'variable.source'],
        ],
      },
    });

    // Define theme colors for macros
    monaco.editor.defineTheme('vs-dark-macros', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword.macro', foreground: 'C586C0', fontStyle: 'bold' },
        { token: 'attribute.name', foreground: '9CDCFE' },
        { token: 'attribute.value', foreground: 'CE9178' },
      ],
      colors: {},
    });
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

    return () => {
      unsubscribeSave?.();
      unsubscribePublish?.();
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
          {post.status === 'draft' && (
            <button 
              onClick={handlePublish} 
              className="success"
              title="Save and make this post public"
            >
              Publish
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
              <label>Tags</label>
              <TagInput
                value={tags}
                onChange={setTags}
                placeholder="Add tags..."
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
          
          <LinkedMediaPanel postId={post.id} />
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
            <MilkdownEditor
              content={content}
              onChange={setContent}
              placeholder="Start writing..."
            />
          )}
          
          {editorMode === 'markdown' && (
            <MonacoEditor
              height="100%"
              language="markdown-with-macros"
              value={content}
              onChange={(value) => setContent(value || '')}
              onMount={handleEditorDidMount}
              beforeMount={handleEditorWillMount}
              theme="vs-dark-macros"
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
            <div className="editor-preview markdown-body" ref={previewRef}>
              <div
                className="preview-content"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(resolvedContent, post.id) }}
              />
            </div>
          )}
        </div>
        
        {/* Lightbox for viewing images in content */}
        <Lightbox
          images={allImages}
          initialIndex={lightboxIndex}
          isOpen={lightboxOpen}
          onClose={() => { setLightboxOpen(false); setGalleryImages([]); }}
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
  const { media, posts, updateMedia, showErrorModal, openTab } = useAppStore();
  const item = media.find(m => m.id === mediaId);
  
  const [alt, setAlt] = useState(item?.alt || '');
  const [caption, setCaption] = useState(item?.caption || '');
  const [tags, setTags] = useState(item?.tags.join(', ') || '');
  const [linkedPosts, setLinkedPosts] = useState<{ postId: string; sortOrder: number }[]>([]);
  const [showPostPicker, setShowPostPicker] = useState(false);
  const [postSearchQuery, setPostSearchQuery] = useState('');

  // Load linked posts for this media
  useEffect(() => {
    const loadLinkedPosts = async () => {
      if (!mediaId) return;
      try {
        const links = await window.electronAPI?.postMedia.getForMedia(mediaId);
        if (links) {
          setLinkedPosts(links.map(l => ({ postId: l.postId, sortOrder: l.sortOrder })));
        }
      } catch (error) {
        console.error('Failed to load linked posts:', error);
      }
    };
    loadLinkedPosts();
  }, [mediaId]);

  // Get post titles for display
  const getPostTitle = (postId: string): string => {
    const post = posts.find(p => p.id === postId);
    return post?.title || 'Untitled';
  };

  // Handle linking to a new post
  const handleLinkToPost = async (postId: string) => {
    try {
      await window.electronAPI?.postMedia.link(postId, mediaId);
      setLinkedPosts([...linkedPosts, { postId, sortOrder: linkedPosts.length }]);
      setShowPostPicker(false);
      setPostSearchQuery('');
      showToast.success('Linked to post');
    } catch (error) {
      console.error('Failed to link to post:', error);
      showToast.error('Failed to link to post');
    }
  };

  // Handle unlinking from a post
  const handleUnlinkFromPost = async (postId: string) => {
    try {
      await window.electronAPI?.postMedia.unlink(postId, mediaId);
      setLinkedPosts(linkedPosts.filter(l => l.postId !== postId));
      showToast.success('Unlinked from post');
    } catch (error) {
      console.error('Failed to unlink from post:', error);
      showToast.error('Failed to unlink from post');
    }
  };

  // Handle click on a post to navigate to it
  const handlePostClick = (postId: string) => {
    openTab({ type: 'post', id: postId, isTransient: true });
  };

  // Get unlinked posts for picker, filtered by search
  const unlinkedPosts = posts.filter(
    p => !linkedPosts.find(l => l.postId === p.id)
  ).filter(
    p => !postSearchQuery || (p.title || 'Untitled').toLowerCase().includes(postSearchQuery.toLowerCase())
  );

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
          
          {/* Linked Posts Section */}
          <div className="editor-field linked-posts-section">
            <label>
              Linked Posts
              <button 
                className="add-link-btn" 
                onClick={() => setShowPostPicker(!showPostPicker)}
                title="Link to a post"
              >
                + Link
              </button>
            </label>
            
            {showPostPicker && (
              <div className="post-picker">
                <div className="post-picker-search">
                  <input
                    type="text"
                    placeholder="Search posts..."
                    value={postSearchQuery}
                    onChange={(e) => setPostSearchQuery(e.target.value)}
                    autoFocus
                  />
                </div>
                {unlinkedPosts.length === 0 ? (
                  <div className="no-posts">{postSearchQuery ? 'No matching posts' : 'No posts available to link'}</div>
                ) : (
                  <div className="post-picker-list">
                    {unlinkedPosts.slice(0, 10).map(post => (
                      <div 
                        key={post.id} 
                        className="post-picker-item"
                        onClick={() => handleLinkToPost(post.id)}
                      >
                        {post.title || 'Untitled'}
                      </div>
                    ))}
                    {unlinkedPosts.length > 10 && (
                      <div className="post-picker-more">
                        +{unlinkedPosts.length - 10} more posts
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {linkedPosts.length === 0 ? (
              <div className="no-linked-posts">Not linked to any posts</div>
            ) : (
              <div className="linked-posts-list">
                {linkedPosts.map(({ postId }) => (
                  <div key={postId} className="linked-post-item">
                    <span 
                      className="linked-post-title"
                      onClick={() => handlePostClick(postId)}
                      title="Open post"
                    >
                      📄 {getPostTitle(postId)}
                    </span>
                    <button 
                      className="unlink-btn"
                      onClick={() => handleUnlinkFromPost(postId)}
                      title="Unlink from post"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
  const { posts, media } = useAppStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [yearMonthData, setYearMonthData] = useState<{ year: number; month: number; count: number }[]>([]);
  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<CategoryCount[]>([]);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [ds, ym, tc, cc] = await Promise.all([
          window.electronAPI?.posts.getDashboardStats(),
          window.electronAPI?.posts.getByYearMonth(),
          window.electronAPI?.posts.getTagsWithCounts(),
          window.electronAPI?.posts.getCategoriesWithCounts(),
        ]);
        if (ds) setStats(ds);
        if (ym) setYearMonthData(ym);
        if (tc) setTagCounts(tc);
        if (cc) setCategoryCounts(cc);
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
    })).sort((a, b) => a.tag.localeCompare(b.tag)); // alphabetical for cloud layout
  }, [tagCounts]);

  const displayTotalPosts = stats?.totalPosts ?? posts.length;
  const displayDraftCount = stats?.draftCount ?? 0;
  const displayPublishedCount = stats?.publishedCount ?? 0;
  const displayArchivedCount = stats?.archivedCount ?? 0;

  return (
    <div className="editor-empty">
      <div className="dashboard-content">
        <h1>Dashboard</h1>
        <p className="text-muted">Overview of your blog database</p>

        <div className="dashboard-stats">
          <div className="stat-card">
            <div className="stat-number">{displayTotalPosts}</div>
            <div className="stat-label">Total Posts</div>
            <div className="stat-breakdown">
              <span className="stat-tag stat-published">{displayPublishedCount} published</span>
              <span className="stat-tag stat-draft">{displayDraftCount} drafts</span>
              {displayArchivedCount > 0 && <span className="stat-tag stat-archived">{displayArchivedCount} archived</span>}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{media.length}</div>
            <div className="stat-label">Media Files</div>
            <div className="stat-breakdown">
              <span className="stat-tag">{imageCount} images</span>
              <span className="stat-tag">{formatBytes(totalMediaSize)}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{tagCounts.length}</div>
            <div className="stat-label">Tags</div>
            <div className="stat-breakdown">
              <span className="stat-tag">{categoryCounts.length} categories</span>
            </div>
          </div>
        </div>

        {timelineEntries.length > 0 && (
          <div className="dashboard-section">
            <h4>Posts Over Time</h4>
            <div className="timeline-chart">
              {timelineEntries.map((entry) => (
                <div key={`${entry.year}-${entry.month}`} className="timeline-bar-container">
                  <div className="timeline-bar" style={{ height: `${(entry.count / maxCount) * 100}%` }}>
                    <span className="timeline-bar-count">{entry.count}</span>
                  </div>
                  <div className="timeline-bar-label">{MONTH_NAMES[entry.month]}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tagCloudItems.length > 0 && (
          <div className="dashboard-section">
            <h4>Tags</h4>
            <div className="tag-cloud">
              {tagCloudItems.map(item => (
                <span
                  key={item.tag}
                  className="dashboard-tag"
                  style={{ fontSize: `${item.fontSize}px` }}
                  title={`${item.count} post${item.count !== 1 ? 's' : ''}`}
                >
                  {item.tag}
                </span>
              ))}
              {tagCounts.length > 40 && <span className="text-muted tag-cloud-more">+{tagCounts.length - 40} more</span>}
            </div>
          </div>
        )}

        {categoryCounts.length > 0 && (
          <div className="dashboard-section">
            <h4>Categories</h4>
            <div className="tag-cloud">
              {categoryCounts.map(cat => (
                <span
                  key={cat.category}
                  className="dashboard-tag dashboard-category"
                  title={`${cat.count} post${cat.count !== 1 ? 's' : ''}`}
                >
                  {cat.category} <span className="tag-count">{cat.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {recentPosts.length > 0 && (
          <div className="dashboard-section">
            <h4>Recently Updated</h4>
            <div className="recent-posts-list">
              {recentPosts.map(post => (
                <div
                  key={post.id}
                  className="recent-post-item"
                  onClick={() => {
                    useAppStore.getState().setActiveView('posts');
                    useAppStore.getState().setSelectedPost(post.id);
                    useAppStore.getState().openTab({ type: 'post', id: post.id, isTransient: true });
                  }}
                  onDoubleClick={() => {
                    useAppStore.getState().setActiveView('posts');
                    useAppStore.getState().setSelectedPost(post.id);
                    useAppStore.getState().openTab({ type: 'post', id: post.id, isTransient: false });
                  }}
                >
                  <span className="recent-post-title">{post.title || 'Untitled'}</span>
                  <span className={`recent-post-status status-${post.status}`}>{post.status}</span>
                  <span className="recent-post-date">{new Date(post.updatedAt).toLocaleDateString()}</span>
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
    isLoading,
    setSelectedPost,
    setSelectedMedia,
    closeTab,
  } = useAppStore();

  // Get the active tab
  const activeTab = tabs.find(t => t.id === activeTabId);

  // Determine what to show based on active tab
  const showPost = activeTab?.type === 'post';
  const showMedia = activeTab?.type === 'media';
  const showSettings = activeTab?.type === 'settings' || (activeView === 'settings' && !activeTab);
  const showTags = activeTab?.type === 'tags' || (activeView === 'tags' && !activeTab);
  const showChat = activeTab?.type === 'chat';

  // Clear selectedPostId if the post doesn't exist (e.g., after project switch)
  useEffect(() => {
    if (activeView === 'posts' && selectedPostId && !isLoading) {
      const postExists = posts.some(p => p.id === selectedPostId);
      if (!postExists) {
        setSelectedPost(null);
      }
    }
  }, [activeView, selectedPostId, posts, isLoading, setSelectedPost]);

  // Clear selectedMediaId if the media doesn't exist (e.g., after project switch)
  useEffect(() => {
    if (activeView === 'media' && selectedMediaId && !isLoading) {
      const mediaExists = media.some(m => m.id === selectedMediaId);
      if (!mediaExists) {
        setSelectedMedia(null);
      }
    }
  }, [activeView, selectedMediaId, media, isLoading, setSelectedMedia]);

  // Close tab if the item doesn't exist anymore, or fetch it if not yet loaded
  useEffect(() => {
    if (activeTab && !isLoading) {
      if (activeTab.type === 'post') {
        const postExists = posts.some(p => p.id === activeTab.id);
        if (!postExists) {
          // Post might not be loaded yet (pagination / filtered view) — try fetching it
          window.electronAPI?.posts.get(activeTab.id).then((post) => {
            if (post) {
              useAppStore.getState().addPost(post as PostData);
            } else {
              closeTab(activeTab.id);
            }
          });
        }
      } else if (activeTab.type === 'media') {
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

  // Show settings if settings tab is active or settings view with no tab
  if (showSettings) {
    return (
      <div className="editor">
        <SettingsView />
        {renderErrorModal()}
      </div>
    );
  }

  // Show tags if tags tab is active
  if (showTags) {
    return (
      <div className="editor">
        <TagsView />
        {renderErrorModal()}
      </div>
    );
  }

  // Show chat if chat tab is active
  if (showChat && activeTabId) {
    return (
      <div className="editor">
        <ChatPanel key={activeTabId} conversationId={activeTabId} />
        {renderErrorModal()}
      </div>
    );
  }

  // Show post editor if a post tab is active
  if (showPost && activeTabId) {
    const post = posts.find(p => p.id === activeTabId);
    if (post) {
      return (
        <div className="editor">
          <PostEditor key={post.id} post={post} />
          {renderErrorModal()}
        </div>
      );
    }
    
    // Post not found - show loading or empty state
    return (
      <div className="editor">
        <div className="editor-empty">
          <div className="welcome-content">
            <p className="text-muted">{isLoading ? 'Loading post...' : ''}</p>
          </div>
        </div>
        {renderErrorModal()}
      </div>
    );
  }

  // Show media editor if a media tab is active
  if (showMedia && activeTabId) {
    return (
      <div className="editor">
        <MediaEditor key={activeTabId} mediaId={activeTabId} />
        {renderErrorModal()}
      </div>
    );
  }

  // No tab active - show dashboard
  return (
    <div className="editor">
      <Dashboard />
      {renderErrorModal()}
    </div>
  );
};
