import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../../store';
import { showToast } from '../Toast';
import { AISuggestionsModal } from '../AISuggestionsModal/AISuggestionsModal';
import { openEntityTab } from '../../navigation/tabPolicy';
import { useI18n } from '../../i18n';
import { SUPPORTED_POST_LANGUAGES, POST_LANGUAGE_FLAGS } from '../../../main/shared/i18n';
import type { MediaData } from '../../../main/shared/electronApi';
import { getMediaDisplayName } from './editorUtils';

export const MediaEditor: React.FC<{ mediaId: string }> = ({ mediaId }) => {
  const { t: tr } = useI18n();
  const { media, updateMedia, showErrorModal, showConfirmDeleteModal, openTab } = useAppStore();
  const activeProjectId = useAppStore((s) => s.activeProject?.id ?? null);
  const item = media.find(m => m.id === mediaId);
  
  const [title, setTitle] = useState(item?.title || '');
  const [alt, setAlt] = useState(item?.alt || '');
  const [caption, setCaption] = useState(item?.caption || '');
  const [author, setAuthor] = useState(item?.author || '');
  const [tags, setTags] = useState(item?.tags.join(', ') || '');
  const [linkedPosts, setLinkedPosts] = useState<{ postId: string; sortOrder: number }[]>([]);
  const [postTitles, setPostTitles] = useState<Map<string, string>>(new Map());
  const [showPostPicker, setShowPostPicker] = useState(false);
  const [postSearchQuery, setPostSearchQuery] = useState('');
  const [pickerPosts, setPickerPosts] = useState<{ id: string; title: string }[]>([]);
  
  // Quick action menu state
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [projectLanguage, setProjectLanguage] = useState('en');
  const quickActionsRef = useRef<HTMLDivElement>(null);

  // AI suggestions modal state
  const [showAISuggestionsModal, setShowAISuggestionsModal] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiSuggestionFields, setAISuggestionFields] = useState<Array<{ key: string; label: string; currentValue: string; suggestedValue?: string }>>([]);
  const [aiError, setAIError] = useState<string | undefined>(undefined);

  // Translation state
  const [mediaLanguage, setMediaLanguage] = useState(item?.language || '');
  const [mediaTranslations, setMediaTranslations] = useState<import('../../../main/shared/electronApi').MediaTranslationData[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isDetectingLanguage, setIsDetectingLanguage] = useState(false);
  const [showMediaTranslationModal, setShowMediaTranslationModal] = useState(false);
  const [translationTargetLanguage, setTranslationTargetLanguage] = useState('');
  const [editingTranslation, setEditingTranslation] = useState<{ language: string; title: string; alt: string; caption: string } | null>(null);

  // Load project language setting
  useEffect(() => {
    if (!activeProjectId) return;
    window.electronAPI?.meta.getProjectMetadata().then(metadata => {
      if (metadata?.mainLanguage) {
        setProjectLanguage(metadata.mainLanguage);
      }
    });
  }, [activeProjectId]);

  // Load media translations
  const loadMediaTranslations = useCallback(async () => {
    if (!mediaId) return;
    const result = await window.electronAPI?.media.getTranslations?.(mediaId);
    setMediaTranslations(result || []);
  }, [mediaId]);

  useEffect(() => {
    loadMediaTranslations();
  }, [loadMediaTranslations]);

  // Handle language change on canonical media
  const handleLanguageChange = async (newLanguage: string) => {
    setMediaLanguage(newLanguage);
    try {
      const updated = await window.electronAPI?.media.update(item!.id, { language: newLanguage || undefined });
      if (updated) {
        updateMedia(item!.id, updated as Partial<MediaData>);
      }
    } catch (error) {
      console.error('Failed to update media language:', error);
    }
  };

  // Detect media language from metadata
  const handleDetectLanguage = async () => {
    if (!item || isDetectingLanguage) return;
    setIsDetectingLanguage(true);
    try {
      const result = await window.electronAPI?.chat.detectMediaLanguage(
        title || item.title || '',
        alt || item.alt || '',
        caption || item.caption || '',
      );
      if (result?.success && result.language) {
        setMediaLanguage(result.language);
        const updated = await window.electronAPI?.media.update(item.id, { language: result.language });
        if (updated) {
          updateMedia(item.id, updated as Partial<MediaData>);
        }
        showToast.success(tr('editor.media.toast.languageDetected', { language: tr(`language.${result.language}`) }));
      } else {
        showToast.error(result?.error || tr('editor.media.error.detectLanguage'));
      }
    } catch (error) {
      console.error('Failed to detect media language:', error);
      showToast.error(tr('editor.media.error.detectLanguage'));
    } finally {
      setIsDetectingLanguage(false);
    }
  };

  // Translate media metadata with AI
  const handleTranslateMedia = async (targetLanguage: string) => {
    if (!item || isTranslating) return;
    setIsTranslating(true);
    try {
      const result = await window.electronAPI?.chat.translateMediaMetadata(item.id, targetLanguage);
      if (result?.success) {
        await loadMediaTranslations();
        showToast.success(tr('editor.media.translations.translateSuccess', { language: tr(`language.${targetLanguage}`) }));
      } else {
        showToast.error(result?.error || tr('editor.media.translations.translateFailed'));
      }
    } catch (error) {
      console.error('Failed to translate media metadata:', error);
      showToast.error(tr('editor.media.translations.translateFailed'));
    } finally {
      setIsTranslating(false);
    }
  };

  // Open translation modal (like posts)
  const handleOpenMediaTranslationModal = () => {
    const preferred = translationTargetLanguage
      || availableTranslationLanguages[0]
      || '';
    setShowQuickActions(false);
    setTranslationTargetLanguage(preferred);
    setShowMediaTranslationModal(true);
  };

  const handleCloseMediaTranslationModal = () => {
    setShowMediaTranslationModal(false);
  };

  const handleConfirmMediaTranslation = () => {
    if (!translationTargetLanguage) return;
    setShowMediaTranslationModal(false);
    void handleTranslateMedia(translationTargetLanguage);
  };

  // Open edit modal for an existing translation
  const handleOpenEditTranslation = (translation: import('../../../main/shared/electronApi').MediaTranslationData) => {
    setEditingTranslation({
      language: translation.language,
      title: translation.title || '',
      alt: translation.alt || '',
      caption: translation.caption || '',
    });
  };

  // Save edits to a translation
  const handleSaveEditTranslation = async () => {
    if (!item || !editingTranslation) return;
    try {
      await window.electronAPI?.media.upsertTranslation(item.id, editingTranslation.language, {
        title: editingTranslation.title || undefined,
        alt: editingTranslation.alt || undefined,
        caption: editingTranslation.caption || undefined,
      });
      await loadMediaTranslations();
      setEditingTranslation(null);
      showToast.success(tr('editor.media.translations.saved', { language: tr(`language.${editingTranslation.language}`) }));
    } catch (error) {
      console.error('Failed to save media translation:', error);
      showToast.error(tr('editor.media.translations.saveFailed'));
    }
  };

  // Delete a media translation
  const handleDeleteTranslation = async (language: string) => {
    if (!item) return;
    try {
      await window.electronAPI?.media.deleteTranslation?.(item.id, language);
      await loadMediaTranslations();
      showToast.success(tr('editor.media.translations.deleted', { language: tr(`language.${language}`) }));
    } catch (error) {
      console.error('Failed to delete media translation:', error);
      showToast.error(tr('editor.media.translations.deleteFailed'));
    }
  };

  // Available languages for translation (exclude canonical)
  const availableTranslationLanguages = SUPPORTED_POST_LANGUAGES.filter(
    lang => lang !== mediaLanguage && !mediaTranslations.find(t => t.language === lang)
  );

  // Close quick actions menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (quickActionsRef.current && !quickActionsRef.current.contains(event.target as Node)) {
        setShowQuickActions(false);
      }
    };
    if (showQuickActions) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showQuickActions]);

  // Handle AI image analysis for alt text and caption
  const handleAIAnalysis = async () => {
    if (!item || isAnalyzing) return;

    setShowQuickActions(false);
    setShowAISuggestionsModal(true);
    setIsAnalyzing(true);
    setAISuggestionFields([]);
    setAIError(undefined);

    try {
      const result = await window.electronAPI?.chat.analyzeMediaImage(item.id, projectLanguage);

      if (result?.success) {
        setAISuggestionFields([
          { key: 'title', label: tr('aiSuggestions.titleField'), currentValue: title, suggestedValue: result.title },
          { key: 'alt', label: tr('aiSuggestions.altField'), currentValue: alt, suggestedValue: result.alt },
          { key: 'caption', label: tr('aiSuggestions.captionField'), currentValue: caption, suggestedValue: result.caption },
        ]);
      } else {
        setAIError(result?.error || tr('editor.media.error.analyzeImage'));
      }
    } catch (error) {
      console.error('Failed to analyze image:', error);
      setAIError((error as Error).message || tr('editor.media.error.analyzeImage'));
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Handle applying AI suggestions
  const handleApplyAISuggestions = (values: Record<string, string>) => {
    if (values.title) setTitle(values.title);
    if (values.alt) setAlt(values.alt);
    if (values.caption) setCaption(values.caption);
    setShowAISuggestionsModal(false);
    if (Object.keys(values).length > 0) {
      showToast.success(tr('editor.media.toast.aiApplied'));
    }
  };

  // Close AI suggestions modal
  const handleCloseAISuggestionsModal = () => {
    setShowAISuggestionsModal(false);
    setAISuggestionFields([]);
    setAIError(undefined);
  };

  // Load linked posts for this media and fetch their titles
  useEffect(() => {
    const loadLinkedPosts = async () => {
      if (!mediaId || !activeProjectId) return;
      try {
        const links = await window.electronAPI?.postMedia.getForMedia(mediaId);
        if (links) {
          setLinkedPosts(links.map(l => ({ postId: l.postId, sortOrder: l.sortOrder })));
          // Fetch titles for linked posts
          const titles = new Map<string, string>();
          for (const link of links) {
            const post = await window.electronAPI?.posts.get(link.postId);
            if (post) {
              titles.set(link.postId, post.title || tr('editor.untitled'));
            }
          }
          setPostTitles(titles);
        }
      } catch (error) {
        console.error('Failed to load linked posts:', error);
      }
    };
    loadLinkedPosts();
  }, [mediaId, activeProjectId]);

  // Fetch posts for the picker when it opens
  useEffect(() => {
    if (!showPostPicker) return;
    const loadPickerPosts = async () => {
      try {
        const result = await window.electronAPI?.posts.getAll({ limit: 100, offset: 0 });
        if (result?.items) {
          setPickerPosts(result.items.map(p => ({ id: p.id, title: p.title || tr('editor.untitled') })));
        }
      } catch (error) {
        console.error('Failed to load posts for picker:', error);
      }
    };
    loadPickerPosts();
  }, [showPostPicker]);

  // Get post titles for display
  const getPostTitle = (postId: string): string => {
    return postTitles.get(postId) || tr('sidebar.loading');
  };

  // Handle linking to a new post
  const handleLinkToPost = async (postId: string, postTitle: string) => {
    try {
      await window.electronAPI?.postMedia.link(postId, mediaId);
      setLinkedPosts([...linkedPosts, { postId, sortOrder: linkedPosts.length }]);
      setPostTitles(prev => new Map(prev).set(postId, postTitle));
      setShowPostPicker(false);
      setPostSearchQuery('');
      showToast.success(tr('editor.media.toast.linkedToPost'));
    } catch (error) {
      console.error('Failed to link to post:', error);
      showToast.error(tr('editor.media.toast.linkFailed'));
    }
  };

  // Handle unlinking from a post
  const handleUnlinkFromPost = async (postId: string) => {
    try {
      await window.electronAPI?.postMedia.unlink(postId, mediaId);
      setLinkedPosts(linkedPosts.filter(l => l.postId !== postId));
      showToast.success(tr('editor.media.toast.unlinkedFromPost'));
    } catch (error) {
      console.error('Failed to unlink from post:', error);
      showToast.error(tr('editor.media.toast.unlinkFailed'));
    }
  };

  // Handle click on a post to navigate to it
  const handlePostClick = (postId: string) => {
    openEntityTab(openTab, 'post', postId, 'preview');
  };

  // Get unlinked posts for picker, filtered by search
  const unlinkedPosts = pickerPosts.filter(
    p => !linkedPosts.find(l => l.postId === p.id)
  ).filter(
    p => !postSearchQuery || p.title.toLowerCase().includes(postSearchQuery.toLowerCase())
  );

  useEffect(() => {
    if (item) {
      setTitle(item.title || '');
      setAlt(item.alt || '');
      setCaption(item.caption || '');
      setAuthor(item.author || '');
      setTags(item.tags.join(', '));
      setMediaLanguage(item.language || '');
    }
  }, [item?.id]);

  if (!item) {
    return <div className="editor-empty">{tr('editor.media.notFound')}</div>;
  }

  const handleSave = async () => {
    try {
      const updated = await window.electronAPI?.media.update(item.id, {
        title,
        alt,
        caption,
        author: author || undefined,
        language: mediaLanguage || undefined,
        tags: tags.split(',').map(t => t.trim()).filter(t => t.length > 0),
      });
      if (updated) {
        updateMedia(item.id, updated as Partial<MediaData>);
        showToast.success(tr('editor.media.toast.updated'));
      }
    } catch (error) {
      console.error('Failed to update media:', error);
      const err = error as Error;
      showErrorModal({
        title: tr('editor.media.error.updateTitle'),
        message: err.message || tr('editor.media.error.updateMessage'),
        stack: err.stack,
      });
    }
  };

  const handleReplaceFile = async () => {
    try {
      const updated = await window.electronAPI?.media.replaceFileDialog(item.id);
      if (updated) {
        updateMedia(item.id, updated as Partial<MediaData>);
        showToast.success(tr('editor.media.toast.fileReplaced'));
      }
      // null means user cancelled or file unchanged - no action needed
    } catch (error) {
      console.error('Failed to replace media file:', error);
      const err = error as Error;
      showErrorModal({
        title: tr('editor.media.error.replaceTitle'),
        message: err.message || tr('editor.media.error.replaceMessage'),
        stack: err.stack,
      });
    }
  };

  const handleDelete = async () => {
    try {
      // Fetch posts that link to this media
      const linkedPostsList = await window.electronAPI?.postMedia.getForMedia(mediaId);

      // Build references array
      const references: Array<{ id: string; title: string; type: 'post' | 'media' | 'link' }> = [];

      // Add posts that use this media - fetch titles from database
      if (linkedPostsList && linkedPostsList.length > 0) {
        for (const link of linkedPostsList) {
          const post = await window.electronAPI?.posts.get(link.postId);
          if (post) {
            references.push({
              id: post.id,
              title: post.title || tr('editor.untitled'),
              type: 'post',
            });
          }
        }
      }

      // Show confirmation modal
      showConfirmDeleteModal({
        itemType: 'media',
        itemTitle: getMediaDisplayName(item),
        references,
        onConfirm: async () => {
          try {
            await window.electronAPI?.media.delete(item.id);
            useAppStore.getState().removeMedia(item.id);
            showToast.success(tr('editor.media.toast.deleted'));
          } catch (error) {
            console.error('Failed to delete media:', error);
            const err = error as Error;
            showErrorModal({
              title: tr('editor.error.deleteTitle'),
              message: err.message || tr('editor.media.error.deleteMessage'),
              stack: err.stack,
            });
          }
        },
      });
    } catch (error) {
      console.error('Failed to fetch media references:', error);
      const err = error as Error;
      showErrorModal({
        title: tr('errorModal.error'),
        message: err.message || tr('editor.media.error.fetchReferencesMessage'),
        stack: err.stack,
      });
    }
  };

  return (
    <div className="editor">
      <div className="editor-header">
        <div className="editor-tabs">
          <div className="editor-tab active">
            <span className="editor-tab-title">{getMediaDisplayName(item)}</span>
          </div>
        </div>
        <div className="editor-actions">
          {/* Quick Actions Dropdown */}
          <div className="quick-actions-wrapper" ref={quickActionsRef}>
            <button 
              className="secondary quick-actions-btn"
              onClick={() => setShowQuickActions(!showQuickActions)}
              disabled={isAnalyzing || isDetectingLanguage || isTranslating}
              title={tr('editor.media.quickActions.title')}
            >
              {(isAnalyzing || isDetectingLanguage || isTranslating) ? tr('editor.media.quickActions.analyzing') : tr('editor.media.quickActions.button')}
            </button>
            {showQuickActions && (
              <div className="quick-actions-menu">
                {item.mimeType.startsWith('image/') && (
                  <button 
                    className="quick-action-item" 
                    onClick={handleAIAnalysis}
                    disabled={isAnalyzing}
                  >
                    <span className="quick-action-icon">🤖</span>
                    <span className="quick-action-text">
                      <strong>{tr('editor.media.quickActions.aiTitle')}</strong>
                      <small>{tr('editor.media.quickActions.aiDescription')}</small>
                    </span>
                  </button>
                )}
                {item.mimeType.startsWith('image/') && <div className="quick-actions-divider" />}
                <button
                  className="quick-action-item"
                  onClick={() => { setShowQuickActions(false); void handleDetectLanguage(); }}
                  disabled={isDetectingLanguage || (!title && !alt && !caption)}
                >
                  <span className="quick-action-icon">🔍</span>
                  <span className="quick-action-text">
                    <strong>{tr('editor.media.quickActions.detectLanguageTitle')}</strong>
                    <small>{tr('editor.media.quickActions.detectLanguageDescription')}</small>
                  </span>
                </button>
                <div className="quick-actions-divider" />
                <button
                  className="quick-action-item"
                  onClick={handleOpenMediaTranslationModal}
                  disabled={isTranslating || !mediaLanguage || availableTranslationLanguages.length === 0}
                >
                  <span className="quick-action-icon">🌍</span>
                  <span className="quick-action-text">
                    <strong>{tr('editor.media.quickActions.translateTitle')}</strong>
                    <small>{tr('editor.media.quickActions.translateDescription')}</small>
                  </span>
                </button>
              </div>
            )}
          </div>
          <button onClick={handleReplaceFile} className="secondary">{tr('editor.media.replaceFile')}</button>
          <button onClick={handleSave}>{tr('common.save')}</button>
          <button onClick={handleDelete} className="secondary danger">{tr('editor.delete')}</button>
        </div>
      </div>

      <div className="editor-content media-editor">
        <div className="media-preview">
          {item.mimeType.startsWith('image/') ? (
            <div className="media-preview-image">
              <img 
                src={`bds-media://${item.id}?t=${item.updatedAt}`} 
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
            <label>{tr('editor.media.field.fileName')}</label>
            <input type="text" value={item.originalName} disabled className="disabled" />
          </div>
          <div className="editor-field">
            <label>{tr('editor.media.field.type')}</label>
            <input type="text" value={item.mimeType} disabled className="disabled" />
          </div>
          <div className="editor-field-row">
            <div className="editor-field">
              <label>{tr('editor.media.field.size')}</label>
              <input type="text" value={`${(item.size / 1024).toFixed(1)} KB`} disabled className="disabled" />
            </div>
            {item.width && item.height && (
              <div className="editor-field">
                <label>{tr('editor.media.field.dimensions')}</label>
                <input type="text" value={`${item.width} × ${item.height}`} disabled className="disabled" />
              </div>
            )}
          </div>
          <div className="editor-field">
            <label>{tr('editor.media.field.title')}</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={tr('editor.media.placeholder.title')}
            />
          </div>
          <div className="editor-field">
            <label>{tr('editor.media.field.altText')}</label>
            <input
              type="text"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder={tr('editor.media.placeholder.altText')}
            />
          </div>
          <div className="editor-field">
            <label>{tr('editor.media.field.caption')}</label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={tr('editor.media.placeholder.caption')}
              rows={3}
            />
          </div>
          <div className="editor-field">
            <label>{tr('editor.media.field.tags')}</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={tr('editor.media.placeholder.tags')}
            />
          </div>
          <div className="editor-field">
            <label>{tr('editor.media.field.author')}</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder={tr('editor.media.placeholder.author')}
            />
          </div>

          {/* Language & Translations Section */}
          <div className="editor-field">
            <label>{tr('editor.media.field.language')}</label>
            <select
              value={mediaLanguage}
              onChange={(e) => handleLanguageChange(e.target.value)}
            >
              <option value="">{tr('editor.media.field.languageNone')}</option>
              {SUPPORTED_POST_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>{tr(`language.${lang}`)}</option>
              ))}
            </select>
          </div>

          {mediaLanguage && (
            <div className="editor-field media-translations-section">
              <label>{tr('editor.media.translations.title')}</label>

              {mediaTranslations.length === 0 ? (
                <div className="no-linked-posts">{tr('editor.media.translations.none')}</div>
              ) : (
                <div className="linked-posts-list">
                  {mediaTranslations.map((translation) => (
                    <div key={translation.language} className="linked-post-item">
                      <span
                        className="linked-post-title"
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleOpenEditTranslation(translation)}
                        title={tr('editor.media.translations.editTitle', { language: tr(`language.${translation.language}`) })}
                      >
                        {POST_LANGUAGE_FLAGS[translation.language as keyof typeof POST_LANGUAGE_FLAGS] || '🏳️'}{' '}
                        {tr(`language.${translation.language}`)}
                        {translation.title && ` — ${translation.title}`}
                      </span>
                      <button
                        className="secondary"
                        onClick={() => handleTranslateMedia(translation.language)}
                        disabled={isTranslating}
                        title={tr('editor.media.translations.refreshTitle')}
                        style={{ marginRight: '4px', fontSize: '0.8em', padding: '2px 6px' }}
                      >
                        {tr('editor.media.translations.refresh')}
                      </button>
                      <button
                        className="unlink-btn"
                        onClick={() => handleDeleteTranslation(translation.language)}
                        title={tr('editor.media.translations.deleteTitle')}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* Linked Posts Section */}
          <div className="editor-field linked-posts-section">
            <label>
              {tr('editor.media.linkedPosts')}
              <button 
                className="add-link-btn" 
                onClick={() => setShowPostPicker(!showPostPicker)}
                title={tr('editor.media.linkToPostTitle')}
              >
                {tr('editor.media.linkAction')}
              </button>
            </label>
            
            {showPostPicker && (
              <div className="post-picker">
                <div className="post-picker-search">
                  <input
                    type="text"
                    placeholder={tr('editor.media.searchPosts')}
                    value={postSearchQuery}
                    onChange={(e) => setPostSearchQuery(e.target.value)}
                    autoFocus
                  />
                </div>
                {unlinkedPosts.length === 0 ? (
                  <div className="no-posts">{postSearchQuery ? tr('editor.media.noMatchingPosts') : tr('editor.media.noPostsToLink')}</div>
                ) : (
                  <div className="post-picker-list">
                    {unlinkedPosts.slice(0, 10).map(post => (
                      <div 
                        key={post.id} 
                        className="post-picker-item"
                        onClick={() => handleLinkToPost(post.id, post.title)}
                      >
                        {post.title}
                      </div>
                    ))}
                    {unlinkedPosts.length > 10 && (
                      <div className="post-picker-more">
                        {tr('editor.media.morePosts', { count: unlinkedPosts.length - 10 })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {linkedPosts.length === 0 ? (
              <div className="no-linked-posts">{tr('editor.media.notLinked')}</div>
            ) : (
              <div className="linked-posts-list">
                {linkedPosts.map(({ postId }) => (
                  <div key={postId} className="linked-post-item">
                    <span 
                      className="linked-post-title"
                      onClick={() => handlePostClick(postId)}
                      title={tr('editor.media.openPost')}
                    >
                      📄 {getPostTitle(postId)}
                    </span>
                    <button 
                      className="unlink-btn"
                      onClick={() => handleUnlinkFromPost(postId)}
                      title={tr('editor.media.unlinkFromPost')}
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

      {/* AI Suggestions Modal */}
      <AISuggestionsModal
        isOpen={showAISuggestionsModal}
        isLoading={isAnalyzing}
        fields={aiSuggestionFields}
        modalTitle={tr('aiSuggestions.title')}
        loadingText={tr('aiSuggestions.analyzing')}
        emptyText={tr('aiSuggestions.empty')}
        error={aiError}
        onConfirm={handleApplyAISuggestions}
        onClose={handleCloseAISuggestionsModal}
      />

      {/* Translation Modal */}
      {showMediaTranslationModal && (
        <div className="translation-modal-backdrop" onClick={handleCloseMediaTranslationModal}>
          <div className="translation-modal" onClick={(event) => event.stopPropagation()}>
            <div className="translation-modal-header">
              <h2>{tr('editor.media.translations.title')}</h2>
              <button className="translation-modal-close" onClick={handleCloseMediaTranslationModal} title={tr('common.cancel')}>×</button>
            </div>
            <div className="translation-modal-body">
              <label className="translation-modal-label" htmlFor="media-translation-target-language">{tr('editor.media.translations.selectTarget')}</label>
              <p className="translation-modal-copy">{tr('editor.media.translations.currentLanguage', { language: tr(`language.${mediaLanguage}`) })}</p>
              <select
                id="media-translation-target-language"
                className="translation-modal-select"
                value={translationTargetLanguage}
                onChange={(e) => setTranslationTargetLanguage(e.target.value)}
              >
                {SUPPORTED_POST_LANGUAGES
                  .filter(lang => lang !== mediaLanguage)
                  .map((lang) => {
                    const existing = mediaTranslations.find(t => t.language === lang);
                    return (
                      <option key={lang} value={lang}>
                        {tr(`language.${lang}`)}{existing ? ` (${tr('editor.media.translations.refresh')})` : ''}
                      </option>
                    );
                  })}
              </select>
              {translationTargetLanguage && (
                <div className="translation-modal-status-row">
                  <span className="translation-modal-flag" aria-hidden="true">{POST_LANGUAGE_FLAGS[translationTargetLanguage as keyof typeof POST_LANGUAGE_FLAGS] || '🏳️'}</span>
                  <span className="translation-modal-status-copy">
                    <strong>{tr(`language.${translationTargetLanguage}`)}</strong>
                    <small>
                      {mediaTranslations.find(t => t.language === translationTargetLanguage)
                        ? tr('editor.media.translations.refresh')
                        : tr('editor.media.translations.none')}
                    </small>
                  </span>
                </div>
              )}
            </div>
            <div className="translation-modal-footer">
              <button className="secondary" onClick={handleCloseMediaTranslationModal}>{tr('common.cancel')}</button>
              <button
                onClick={handleConfirmMediaTranslation}
                disabled={!translationTargetLanguage || isTranslating}
                title={tr('editor.media.quickActions.translateDescription')}
              >
                {isTranslating ? tr('editor.media.translations.translating') : tr('editor.media.translations.translateButton')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Translation Modal */}
      {editingTranslation && (
        <div className="translation-modal-backdrop" onClick={() => setEditingTranslation(null)}>
          <div className="translation-modal" onClick={(event) => event.stopPropagation()}>
            <div className="translation-modal-header">
              <h2>{tr('editor.media.translations.editTitle', { language: tr(`language.${editingTranslation.language}`) })}</h2>
              <button className="translation-modal-close" onClick={() => setEditingTranslation(null)} title={tr('common.cancel')}>×</button>
            </div>
            <div className="translation-modal-body">
              <div className="editor-field">
                <label htmlFor="edit-translation-title">{tr('editor.media.field.title')}</label>
                <input
                  id="edit-translation-title"
                  type="text"
                  value={editingTranslation.title}
                  onChange={(e) => setEditingTranslation({ ...editingTranslation, title: e.target.value })}
                  placeholder={tr('editor.media.placeholder.title')}
                />
              </div>
              <div className="editor-field">
                <label htmlFor="edit-translation-alt">{tr('editor.media.field.altText')}</label>
                <input
                  id="edit-translation-alt"
                  type="text"
                  value={editingTranslation.alt}
                  onChange={(e) => setEditingTranslation({ ...editingTranslation, alt: e.target.value })}
                  placeholder={tr('editor.media.placeholder.altText')}
                />
              </div>
              <div className="editor-field">
                <label htmlFor="edit-translation-caption">{tr('editor.media.field.caption')}</label>
                <textarea
                  id="edit-translation-caption"
                  value={editingTranslation.caption}
                  onChange={(e) => setEditingTranslation({ ...editingTranslation, caption: e.target.value })}
                  placeholder={tr('editor.media.placeholder.caption')}
                  rows={3}
                />
              </div>
            </div>
            <div className="translation-modal-footer">
              <button className="secondary" onClick={() => setEditingTranslation(null)}>{tr('common.cancel')}</button>
              <button onClick={() => void handleSaveEditTranslation()}>{tr('common.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
