import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import MonacoEditor, { Monaco } from '@monaco-editor/react';
import { useAppStore, PostData, EditorMode, MediaData } from '../../store';
import { showToast } from '../Toast';
import { MilkdownEditor } from '../MilkdownEditor';
import { Lightbox, useMarkdownImages } from '../Lightbox';
import { PostLinks } from '../PostLinks';
import { LinkedMediaPanel } from '../LinkedMediaPanel';
import { ErrorModal } from '../ErrorModal';
import { ConfirmDeleteModal } from '../ConfirmDeleteModal';
import { SettingsView } from '../SettingsView';
import { StyleView } from '../StyleView/StyleView';
import { TagsView } from '../TagsView';
import { TagInput } from '../TagInput';
import { ChatPanel } from '../ChatPanel';
import { ImportAnalysisView } from '../ImportAnalysisView';
import { MenuEditorView } from '../MenuEditorView/MenuEditorView';
import { MetadataDiffPanel } from '../MetadataDiffPanel';
import { GitDiffView } from '../GitDiffView/GitDiffView';
import { DocumentationView } from '../DocumentationView/DocumentationView';
import { SiteValidationView } from '../SiteValidationView';
import { TranslationValidationView } from '../TranslationValidationView';
import { ScriptsView } from '../ScriptsView/ScriptsView';
import { TemplatesView } from '../TemplatesView/TemplatesView';
import { DuplicatesView } from '../DuplicatesView/DuplicatesView';
import { AutoSaveManager, getContrastColor, loadTagColorMap } from '../../utils';
import { InsertModal } from '../InsertModal';
import { AISuggestionsModal } from '../AISuggestionsModal/AISuggestionsModal';
import type { SuggestionField } from '../AISuggestionsModal/AISuggestionsModal';
import { openEntityTab } from '../../navigation/tabPolicy';
import { EditorRoute, resolveEditorRoute } from '../../navigation/editorRouting';
import { useEntityLoader, useSaveShortcut } from '../../navigation/useEntityEditor';
import { useI18n } from '../../i18n';
import documentationContent from '../../../../DOCUMENTATION.md?raw';
import apiDocumentationContent from '../../../../API.md?raw';
import './Editor.css';

/** Debounce a value so it only updates after `delay` ms of inactivity. */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const UI_DATE_LOCALE: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  it: 'it-IT',
  es: 'es-ES',
};

const SUPPORTED_POST_LANGUAGES = ['en', 'de', 'fr', 'it', 'es'] as const;
const POST_LANGUAGE_FLAGS: Record<(typeof SUPPORTED_POST_LANGUAGES)[number], string> = {
  en: '🇬🇧',
  de: '🇩🇪',
  fr: '🇫🇷',
  it: '🇮🇹',
  es: '🇪🇸',
};

/** Get display name for media: prefer title over originalName */
function getMediaDisplayName(media: { title?: string; originalName: string }): string {
  return media.title || media.originalName;
}

// Module-level AutoSaveManager for idle-time based auto-saving
const autoSaveManager = new AutoSaveManager({
  idleTimeMs: 3000, // Save after 3 seconds of idle time
  onSave: async (id, changes) => {
    // Note: We don't check if post exists in store's posts array since that's limited to 500.
    // If the post was deleted, the update will fail gracefully.

    // Build update payload from changes
    const update: Parameters<typeof window.electronAPI.posts.update>[1] = {};
    if ('title' in changes) update.title = changes.title as string;
    if ('content' in changes) update.content = changes.content as string;
    if ('excerpt' in changes) update.excerpt = changes.excerpt as string;
    if ('tags' in changes) {
      const tagsStr = changes.tags as string;
      update.tags = tagsStr.split(',').map(t => t.trim()).filter(t => t.length > 0);
    }
    if ('categories' in changes) {
      update.categories = changes.categories as string[];
    }
    if ('templateSlug' in changes) {
      (update as Record<string, unknown>).templateSlug = changes.templateSlug as string || null;
    }
    if ('language' in changes) {
      update.language = changes.language as string || undefined;
    }

    const updated = await window.electronAPI?.posts.update(id, update);
    if (updated) {
      useAppStore.getState().updatePost(id, updated as Partial<PostData>);
      useAppStore.getState().markClean(id);
      // Emit event so PostEditor can update its local state
      window.dispatchEvent(new CustomEvent('bds:post-auto-saved', { detail: { id, updated } }));
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

interface PostEditorProps {
  postId: string;
}

interface EditableContentDraft {
  title: string;
  excerpt: string;
  content: string;
}

function toEditableContentDraft(value: { title?: string; excerpt?: string; content?: string } | null | undefined): EditableContentDraft {
  return {
    title: value?.title || '',
    excerpt: value?.excerpt || '',
    content: value?.content || '',
  };
}

function editableDraftEquals(left: EditableContentDraft, right: EditableContentDraft): boolean {
  return left.title === right.title && left.excerpt === right.excerpt && left.content === right.content;
}

function mapTranslationsByLanguage(items: import('../../../main/shared/electronApi').PostTranslationData[]): Record<string, import('../../../main/shared/electronApi').PostTranslationData> {
  return Object.fromEntries(items.map((item) => [item.language, item]));
}

export const PostEditor: React.FC<PostEditorProps> = ({ postId }) => {
  const { t: tr, language } = useI18n();
  const {
    updatePost,
    markDirty,
    markClean,
    isDirty: checkIsDirty,
    preferredEditorMode,
    setPreferredEditorMode,
    showErrorModal,
    showConfirmDeleteModal,
    media,
    closeTab,
  } = useAppStore();
  
  // Fetch full post data from backend
  const fetchPost = useCallback(
    (id: string) => window.electronAPI?.posts.get(id).then((p) => (p as PostData) || null) ?? Promise.resolve(null),
    [],
  );

  const [post, setPost] = useState<PostData | null>(null);
  // Track whether form state has been initialized from post data
  const [isInitialized, setIsInitialized] = useState(false);

  const { isLoading: isLoadingPost } = useEntityLoader<PostData>(postId, fetchPost, {
    onLoaded: (loadedPost) => {
      setPost(loadedPost);
      useAppStore.getState().updatePost(postId, loadedPost as Partial<PostData>);
    },
    onReset: () => {
      setPost(null);
      setIsInitialized(false);
    },
  });

  const [title, setTitleState] = useState('');
  const [content, setContentState] = useState('');
  const [excerpt, setExcerptState] = useState('');
  const [author, setAuthor] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['article']);
  const [templateSlug, setTemplateSlug] = useState('');
  const [postLanguage, setPostLanguage] = useState('');
  const [activeEditingLanguage, setActiveEditingLanguage] = useState('');
  const [canonicalDraft, setCanonicalDraft] = useState<EditableContentDraft>({ title: '', excerpt: '', content: '' });
  const [savedCanonicalDraft, setSavedCanonicalDraft] = useState<EditableContentDraft>({ title: '', excerpt: '', content: '' });
  const [translationDrafts, setTranslationDrafts] = useState<Record<string, import('../../../main/shared/electronApi').PostTranslationData>>({});
  const [savedTranslationDrafts, setSavedTranslationDrafts] = useState<Record<string, import('../../../main/shared/electronApi').PostTranslationData>>({});
  const [availablePostTemplates, setAvailablePostTemplates] = useState<Array<{ slug: string; title: string }>>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isDetectingLanguage, setIsDetectingLanguage] = useState(false);
  const [hasPublishedVersion, setHasPublishedVersion] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>(preferredEditorMode);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [showPostSearch, setShowPostSearch] = useState(false);
  const [showMediaSearch, setShowMediaSearch] = useState(false);
  const [metadataExpanded, setMetadataExpanded] = useState(true);
  const [excerptExpanded, setExcerptExpanded] = useState(false);
  const editorRef = useRef<unknown>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const excerptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const editorBodyRef = useRef<HTMLDivElement | null>(null);
  // Token incremented to signal Monaco that it should re-read its defaultValue.
  // This is used instead of controlled `value` to avoid cursor-reset races.
  const [monacoResetToken, setMonacoResetToken] = useState(0);

  // Quick actions state for AI post analysis
  const [showPostQuickActions, setShowPostQuickActions] = useState(false);
  const [projectLanguage, setProjectLanguage] = useState('en');
  const [translations, setTranslations] = useState<import('../../../main/shared/electronApi').PostTranslationData[]>([]);
  const [showTranslationModal, setShowTranslationModal] = useState(false);
  const [translationTargetLanguage, setTranslationTargetLanguage] = useState('');
  const [isTranslatingPost, setIsTranslatingPost] = useState(false);
  const postQuickActionsRef = useRef<HTMLDivElement>(null);
  const [showPostAISuggestionsModal, setShowPostAISuggestionsModal] = useState(false);
  const [isAnalyzingPost, setIsAnalyzingPost] = useState(false);
  const [postAISuggestionFields, setPostAISuggestionFields] = useState<SuggestionField[]>([]);
  const [postAIError, setPostAIError] = useState<string | undefined>(undefined);

  const isDirty = checkIsDirty(postId);

  const canonicalLanguage = postLanguage || post?.language || projectLanguage;
  const fieldIdPrefix = `post-editor-${postId}`;

  const loadTranslations = useCallback(async () => {
    const result = await window.electronAPI?.posts.getTranslations?.(postId);
    const items = result || [];
    const mapped = mapTranslationsByLanguage(items);
    setTranslations(items);
    setTranslationDrafts(mapped);
    setSavedTranslationDrafts(mapped);
    return items;
  }, [postId]);

  const getLanguageLabel = useCallback((languageCode: string) => {
    return tr(`language.${languageCode}`);
  }, [tr]);

  const getLanguageFlag = useCallback((languageCode: string) => {
    return POST_LANGUAGE_FLAGS[languageCode as keyof typeof POST_LANGUAGE_FLAGS] || '🏳️';
  }, []);

  const applyDisplayedDraft = useCallback((languageCode: string, canonicalValue: EditableContentDraft, translationMap: Record<string, import('../../../main/shared/electronApi').PostTranslationData>) => {
    if (languageCode === canonicalLanguage) {
      setTitleState(canonicalValue.title);
      setExcerptState(canonicalValue.excerpt);
      setContentState(canonicalValue.content);
    } else {
      const translation = translationMap[languageCode];
      setTitleState(translation?.title || '');
      setExcerptState(translation?.excerpt || '');
      setContentState(translation?.content || '');
    }
    setActiveEditingLanguage(languageCode);
    setMonacoResetToken((value) => value + 1);
  }, [canonicalLanguage]);

  const translationLanguageOptions = useMemo(() => {
    const statusByLanguage = new Map(translations.map((item) => [item.language, item.status]));
    return SUPPORTED_POST_LANGUAGES
      .filter((languageCode) => languageCode !== canonicalLanguage)
      .map((languageCode) => ({
        language: languageCode,
        status: statusByLanguage.get(languageCode),
      }));
  }, [canonicalLanguage, translations]);

  const selectedTranslation = useMemo(() => {
    return translations.find((item) => item.language === translationTargetLanguage) ?? null;
  }, [translationTargetLanguage, translations]);

  const languageFlags = useMemo(() => {
    const canonicalLabel = getLanguageLabel(canonicalLanguage);
    return [
      {
        language: canonicalLanguage,
        status: post?.status || 'draft',
        isCanonical: true,
        ariaLabel: `${canonicalLabel} (${tr('editor.field.languageDefault')})`,
      },
      ...translations.map((translation) => ({
        language: translation.language,
        status: translation.status,
        isCanonical: false,
        ariaLabel: `${getLanguageLabel(translation.language)} (${tr(`editor.translations.status.${translation.status}`)})`,
      })),
    ];
  }, [canonicalLanguage, getLanguageLabel, post?.status, tr, translations]);

  const updateDisplayedDraft = useCallback((field: keyof EditableContentDraft, value: string) => {
    if (field === 'title') setTitleState(value);
    if (field === 'excerpt') setExcerptState(value);
    if (field === 'content') setContentState(value);

    if (activeEditingLanguage === canonicalLanguage) {
      setCanonicalDraft((current) => ({ ...current, [field]: value }));
    } else if (activeEditingLanguage) {
      setTranslationDrafts((current) => {
        const existing = current[activeEditingLanguage] ?? {
          id: `local-${postId}-${activeEditingLanguage}`,
          projectId: post?.projectId || '',
          translationFor: postId,
          language: activeEditingLanguage,
          title: canonicalDraft.title,
          excerpt: canonicalDraft.excerpt || undefined,
          content: canonicalDraft.content,
          status: 'draft' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          publishedAt: undefined,
          filePath: '',
        };
        return {
          ...current,
          [activeEditingLanguage]: {
            ...existing,
            [field]: value,
            status: 'draft',
            updatedAt: new Date().toISOString(),
          },
        };
      });
      setTranslations((current) => {
        const existing = current.find((item) => item.language === activeEditingLanguage);
        const next = {
          ...(existing ?? {
            id: `local-${postId}-${activeEditingLanguage}`,
            projectId: post?.projectId || '',
            translationFor: postId,
            language: activeEditingLanguage,
            title: canonicalDraft.title,
            excerpt: canonicalDraft.excerpt || undefined,
            content: canonicalDraft.content,
            status: 'draft' as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            publishedAt: undefined,
            filePath: '',
          }),
          [field]: value,
          status: 'draft' as const,
          updatedAt: new Date().toISOString(),
        };
        return existing
          ? current.map((item) => item.language === activeEditingLanguage ? next : item)
          : [...current, next].sort((left, right) => left.language.localeCompare(right.language));
      });
      if (post?.status === 'published') {
        setPost((current) => current ? { ...current, status: 'draft' } : current);
        updatePost(postId, { status: 'draft' } as Partial<PostData>);
      }
    }
  }, [activeEditingLanguage, canonicalDraft, canonicalLanguage, post?.projectId, post?.status, postId, updatePost]);

  const setTitle = useCallback((value: string) => updateDisplayedDraft('title', value), [updateDisplayedDraft]);
  const setExcerpt = useCallback((value: string) => updateDisplayedDraft('excerpt', value), [updateDisplayedDraft]);
  const setContent = useCallback((value: string) => updateDisplayedDraft('content', value), [updateDisplayedDraft]);

  const handleActivateLanguage = useCallback((languageCode: string) => {
    applyDisplayedDraft(languageCode, canonicalDraft, translationDrafts);
  }, [applyDisplayedDraft, canonicalDraft, translationDrafts]);

  const handleCanonicalLanguageChange = useCallback((nextLanguage: string) => {
    const resolvedLanguage = nextLanguage || projectLanguage;
    const wasCanonicalActive = !activeEditingLanguage || activeEditingLanguage === canonicalLanguage;
    setPostLanguage(nextLanguage);
    if (wasCanonicalActive) {
      setActiveEditingLanguage(resolvedLanguage);
    }
  }, [activeEditingLanguage, canonicalLanguage, projectLanguage]);

  // Listen for auto-save events to keep local post state in sync
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, updated } = (e as CustomEvent).detail;
      if (id === postId && updated) {
        setPost(prev => prev ? { ...prev, ...updated as Partial<PostData> } : prev);
      }
    };
    window.addEventListener('bds:post-auto-saved', handler);
    return () => window.removeEventListener('bds:post-auto-saved', handler);
  }, [postId]);

  // Check if post has a published version for discard functionality
  useEffect(() => {
    window.electronAPI?.posts.hasPublishedVersion(postId).then(setHasPublishedVersion);
  }, [postId]);

  useEffect(() => {
    loadTranslations().catch((error) => {
      console.error('Failed to load post translations:', error);
    });
  }, [loadTranslations]);

  // Debounce content for lightbox-only computations (not time-critical)
  const debouncedContent = useDebouncedValue(content, 500);

  // Resolve media URLs in content for display (lightbox only)
  const resolvedContent = useMemo(() => resolveMediaUrls(debouncedContent, media), [debouncedContent, media]);

  // Extract images from resolved content for lightbox
  const images = useMarkdownImages(resolvedContent);

  useEffect(() => {
    if (editorMode !== 'preview') return;

    let cancelled = false;
    setPreviewUrl(null);

    const previewOptions: Parameters<typeof window.electronAPI.posts.getPreviewUrl>[1] = { draft: true };
    if (activeEditingLanguage && activeEditingLanguage !== canonicalLanguage) {
      previewOptions.lang = activeEditingLanguage;
    }

    window.electronAPI?.posts.getPreviewUrl(postId, previewOptions)
      .then((url) => {
        if (!cancelled) {
          setPreviewUrl(url);
        }
      })
      .catch((error) => {
        console.error('Failed to load post preview URL:', error);
        if (!cancelled) {
          setPreviewUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeEditingLanguage, canonicalLanguage, editorMode, postId]);

  // Track latest values for auto-save on unmount/switch
  const pendingChangesRef = useRef<{
    title: string;
    content: string;
    excerpt: string;
    tags: string[];
    categories: string[];
    postId: string;
    isDirty: boolean;
  } | null>(null);

  // Update ref when values change
  useEffect(() => {
    pendingChangesRef.current = {
      title: canonicalDraft.title,
      content: canonicalDraft.content,
      excerpt: canonicalDraft.excerpt,
      tags,
      categories: selectedCategories,
      postId,
      isDirty,
    };
  }, [canonicalDraft, tags, selectedCategories, postId, isDirty]);

  // Auto-save when switching away from a post or unmounting
  useEffect(() => {
    return () => {
      // Cancel any pending auto-save timer - we'll save immediately
      autoSaveManager.cancel(postId);
      
      const pending = pendingChangesRef.current;
      // Auto-save if we have pending changes (the update will fail gracefully if post was deleted)
      if (pending && pending.postId === postId && pending.isDirty) {
        // Fire and forget auto-save
        window.electronAPI?.posts.update(pending.postId, {
          title: pending.title,
          content: pending.content,
          excerpt: pending.excerpt || undefined,
          tags: pending.tags,
          categories: pending.categories.length > 0 ? pending.categories : ['article'],
        }).then((updated) => {
          if (updated) {
            useAppStore.getState().updatePost(pending.postId, updated as Partial<PostData>);
            useAppStore.getState().markClean(pending.postId);
            window.dispatchEvent(new CustomEvent('bds:post-auto-saved', { detail: { id: pending.postId, updated } }));
          }
        }).catch((error) => {
          console.error('Auto-save failed:', error);
        });
      }
    };
  }, [postId]);

  // Reset when post data is loaded or changes
  // Only sync local state from post on initial load.
  // After initialization, local state is the source of truth — this prevents
  // auto-save or manual-save completions from overwriting the user's in-progress
  // edits and causing the Monaco editor to reset cursor position.
  useEffect(() => {
    if (post && !isInitialized) {
      const nextCanonicalDraft = toEditableContentDraft(post);
      setCanonicalDraft(nextCanonicalDraft);
      setSavedCanonicalDraft(nextCanonicalDraft);
      setTitleState(nextCanonicalDraft.title);
      setContentState(nextCanonicalDraft.content);
      setExcerptState(nextCanonicalDraft.excerpt);
      setAuthor(post.author || '');
      setTags(post.tags);
      setSelectedCategories(post.categories.length > 0 ? post.categories : ['article']);
      setTemplateSlug((post as PostData & { templateSlug?: string }).templateSlug || '');
      setPostLanguage(post.language || '');
      setActiveEditingLanguage(post.language || projectLanguage);
      setMetadataExpanded(post.title === '');
      markClean(postId);
      // Mark as initialized AFTER setting local state
      setIsInitialized(true);
      // Load available post templates for the dropdown
      window.electronAPI?.templates.getEnabledByKind('post').then((templates) => {
        setAvailablePostTemplates((templates ?? []).map((tmpl) => ({ slug: tmpl.slug, title: tmpl.title })));
      });
    }
  }, [post, postId, markClean, isInitialized, projectLanguage]);

  // Track changes and notify auto-save manager
  // Only run after form has been initialized from post data
  useEffect(() => {
    if (!post || !isInitialized) return;

    // Short-circuit: check cheap comparisons first (content changes on every keystroke)
    const contentChanged = canonicalDraft.content !== post.content;
    const titleChanged = canonicalDraft.title !== post.title;
    const excerptChanged = canonicalDraft.excerpt !== (post.excerpt || '');
    const authorChanged = author !== (post.author || '');
    const templateSlugChanged = templateSlug !== ((post as PostData & { templateSlug?: string }).templateSlug || '');
    const languageChanged = postLanguage !== (post.language || '');
    const translationChanged = (() => {
      const languages = new Set([...Object.keys(translationDrafts), ...Object.keys(savedTranslationDrafts)]);
      return Array.from(languages).some((languageCode) => {
        const current = translationDrafts[languageCode];
        const saved = savedTranslationDrafts[languageCode];
        if (!current && !saved) return false;
        if (!current || !saved) return true;
        return !editableDraftEquals(toEditableContentDraft(current), toEditableContentDraft(saved));
      });
    })();
    const hasChanges = contentChanged || titleChanged || excerptChanged || authorChanged || templateSlugChanged || languageChanged ||
      translationChanged ||
      JSON.stringify(tags.slice().sort()) !== JSON.stringify(post.tags.slice().sort()) ||
      JSON.stringify(selectedCategories.slice().sort()) !== JSON.stringify(post.categories.slice().sort());

    if (hasChanges) {
      if (!isDirty) markDirty(postId);
      // Notify auto-save manager with accumulated changes
      // Convert tags array to comma-separated string for auto-save compatibility
      autoSaveManager.notifyChange(postId, {
        title: canonicalDraft.title,
        content: canonicalDraft.content,
        excerpt: canonicalDraft.excerpt,
        author,
        tags: tags.join(', '),
        categories: selectedCategories,
        templateSlug: templateSlug || undefined,
        language: postLanguage || undefined,
      });
    } else {
      markClean(postId);
    }
  }, [canonicalDraft, author, tags, selectedCategories, templateSlug, postLanguage, post, postId, isInitialized, isDirty, markDirty, markClean, savedTranslationDrafts, translationDrafts]);

  // Handle editor mode change and persist preference
  const handleEditorModeChange = (mode: EditorMode) => {
    setEditorMode(mode);
    setPreferredEditorMode(mode);
  };

  const getDisplayedDraft = useCallback((): EditableContentDraft => {
    let currentContent = content;

    if (editorMode === 'markdown') {
      const monacoEditor = editorRef.current as { getValue?: () => string } | null;
      if (typeof monacoEditor?.getValue === 'function') {
        currentContent = monacoEditor.getValue();
      }
    } else if (editorMode === 'wysiwyg') {
      const textarea = editorBodyRef.current?.querySelector('textarea');
      if (textarea instanceof HTMLTextAreaElement) {
        currentContent = textarea.value;
      }
    }

    return {
      title: titleInputRef.current?.value ?? title,
      excerpt: excerptInputRef.current?.value ?? excerpt,
      content: currentContent,
    };
  }, [content, editorMode, excerpt, title]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;

    const displayedDraft = getDisplayedDraft();
    const effectiveCanonicalDraft = activeEditingLanguage === canonicalLanguage ? displayedDraft : canonicalDraft;

    const effectiveTranslationDrafts = activeEditingLanguage && activeEditingLanguage !== canonicalLanguage
      ? {
          ...translationDrafts,
          [activeEditingLanguage]: {
            ...(translationDrafts[activeEditingLanguage] ?? {
              id: `local-${postId}-${activeEditingLanguage}`,
              projectId: post?.projectId || '',
              translationFor: postId,
              language: activeEditingLanguage,
              title: displayedDraft.title,
              excerpt: displayedDraft.excerpt || undefined,
              content: displayedDraft.content,
              status: 'draft' as const,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              publishedAt: undefined,
              filePath: '',
            }),
            title: displayedDraft.title,
            excerpt: displayedDraft.excerpt || undefined,
            content: displayedDraft.content,
            status: 'draft' as const,
            updatedAt: new Date().toISOString(),
          },
        }
      : translationDrafts;

    const translationChanged = (() => {
      const languages = new Set([...Object.keys(effectiveTranslationDrafts), ...Object.keys(savedTranslationDrafts)]);
      return Array.from(languages).some((languageCode) => {
        const current = effectiveTranslationDrafts[languageCode];
        const saved = savedTranslationDrafts[languageCode];
        if (!current && !saved) return false;
        if (!current || !saved) return true;
        return !editableDraftEquals(toEditableContentDraft(current), toEditableContentDraft(saved));
      });
    })();

    const canonicalChanged = post
      ? !editableDraftEquals(effectiveCanonicalDraft, toEditableContentDraft(post))
        || author !== (post.author || '')
        || templateSlug !== ((post as PostData & { templateSlug?: string }).templateSlug || '')
        || postLanguage !== (post.language || '')
        || JSON.stringify(tags.slice().sort()) !== JSON.stringify(post.tags.slice().sort())
        || JSON.stringify(selectedCategories.slice().sort()) !== JSON.stringify(post.categories.slice().sort())
      : false;

    if (!canonicalChanged && !translationChanged) return;

    // Cancel any pending auto-save since we're saving manually
    autoSaveManager.cancel(postId);
    
    setIsSaving(true);
    try {
      let updatedPost = post;
      if (canonicalChanged) {
        const updated = await window.electronAPI?.posts.update(postId, {
          title: effectiveCanonicalDraft.title,
          content: effectiveCanonicalDraft.content,
          excerpt: effectiveCanonicalDraft.excerpt || undefined,
          author: author || undefined,
          language: postLanguage || undefined,
          tags,
          categories: selectedCategories.length > 0 ? selectedCategories : ['article'],
          templateSlug: templateSlug || null,
        } as Parameters<typeof window.electronAPI.posts.update>[1]);

        if (updated) {
          updatedPost = updated as PostData;
          updatePost(postId, updated as Partial<PostData>);
          setPost(prev => prev ? { ...prev, ...updated as Partial<PostData> } : prev);
          setSavedCanonicalDraft(toEditableContentDraft(updated as PostData));
          setCanonicalDraft(toEditableContentDraft(updated as PostData));
        }
      }

      const languages = new Set([...Object.keys(effectiveTranslationDrafts), ...Object.keys(savedTranslationDrafts)]);
      const nextSavedTranslations = { ...savedTranslationDrafts };
      let savedTranslationCount = 0;

      if (activeEditingLanguage && activeEditingLanguage !== canonicalLanguage) {
        const activeDraft = effectiveTranslationDrafts[activeEditingLanguage];
        const savedActiveDraft = savedTranslationDrafts[activeEditingLanguage];
        if (activeDraft && (!savedActiveDraft || !editableDraftEquals(toEditableContentDraft(activeDraft), toEditableContentDraft(savedActiveDraft)))) {
          const updatedActiveTranslation = await window.electronAPI?.posts.upsertTranslation(postId, activeEditingLanguage, {
            title: activeDraft.title,
            excerpt: activeDraft.excerpt || undefined,
            content: activeDraft.content,
          });
          if (updatedActiveTranslation) {
            nextSavedTranslations[activeEditingLanguage] = updatedActiveTranslation as import('../../../main/shared/electronApi').PostTranslationData;
            savedTranslationCount += 1;
          }
        }
      }

      for (const languageCode of languages) {
        if (languageCode === activeEditingLanguage) continue;
        const current = effectiveTranslationDrafts[languageCode];
        const saved = savedTranslationDrafts[languageCode];
        if (!current) continue;
        if (saved && editableDraftEquals(toEditableContentDraft(current), toEditableContentDraft(saved))) continue;

        const updatedTranslation = await window.electronAPI?.posts.upsertTranslation(postId, languageCode, {
          title: current.title,
          excerpt: current.excerpt || undefined,
          content: current.content,
        });
        if (updatedTranslation) {
          nextSavedTranslations[languageCode] = updatedTranslation as import('../../../main/shared/electronApi').PostTranslationData;
          savedTranslationCount += 1;
        }
      }
      setSavedTranslationDrafts(nextSavedTranslations);
      setTranslationDrafts(nextSavedTranslations);

      if (Object.keys(nextSavedTranslations).length > 0) {
        setTranslations(Object.values(nextSavedTranslations).sort((left, right) => left.language.localeCompare(right.language)));
      }

      if (!canonicalChanged && savedTranslationCount > 0 && updatedPost?.status === 'published') {
        setPost(prev => prev ? { ...prev, status: 'draft' } : prev);
        updatePost(postId, { status: 'draft' } as Partial<PostData>);
      }
      markClean(postId);
    } catch (error) {
      console.error('Failed to save post:', error);
      const err = error as Error;
      showErrorModal({
        title: tr('editor.error.saveTitle'),
        message: err.message || tr('editor.error.saveMessage'),
        stack: err.stack,
      });
    } finally {
      setIsSaving(false);
    }
  }, [activeEditingLanguage, author, canonicalDraft, canonicalLanguage, getDisplayedDraft, isSaving, markClean, post, postId, postLanguage, savedTranslationDrafts, selectedCategories, showErrorModal, tags, templateSlug, translationDrafts, updatePost]);

  const handleDetectLanguage = useCallback(async () => {
    if (isDetectingLanguage || (!title && !content)) return;
    setIsDetectingLanguage(true);
    try {
      const result = await window.electronAPI?.chat.detectPostLanguage(title, content);
      if (result?.success && result.language) {
        setPostLanguage(result.language);
        showToast.success(tr('editor.post.quickActions.languageDetected'));
      } else {
        showToast.error(result?.error || tr('editor.post.quickActions.detectLanguageFailed'));
      }
    } catch (error) {
      console.error('Failed to detect post language:', error);
      showToast.error(tr('editor.post.quickActions.detectLanguageFailed'));
    } finally {
      setIsDetectingLanguage(false);
    }
  }, [title, content, isDetectingLanguage, tr]);

  const handleTranslatePost = useCallback(async (targetLanguage: string) => {
    if (!targetLanguage || isTranslatingPost) return;
    setIsTranslatingPost(true);
    try {
      const result = await window.electronAPI?.chat.translatePost(postId, targetLanguage);
      if (result?.success) {
        setTranslationTargetLanguage('');
        const loadedTranslations = await loadTranslations();
        const refreshedPost = await window.electronAPI?.posts.get(postId);
        if (refreshedPost) {
          updatePost(postId, refreshedPost as Partial<PostData>);
          setPost(prev => prev ? { ...prev, ...refreshedPost as Partial<PostData> } : prev);
        }
        const refreshedMap = mapTranslationsByLanguage(loadedTranslations);
        applyDisplayedDraft(targetLanguage, canonicalDraft, refreshedMap);
        showToast.success(tr('editor.translations.translateSuccess', { language: getLanguageLabel(targetLanguage) }));
      } else {
        showToast.error(result?.error || tr('editor.translations.translateFailed'));
      }
    } catch (error) {
      console.error('Failed to translate post:', error);
      showToast.error(tr('editor.translations.translateFailed'));
    } finally {
      setIsTranslatingPost(false);
    }
  }, [applyDisplayedDraft, canonicalDraft, getLanguageLabel, isTranslatingPost, loadTranslations, postId, tr, updatePost]);

  const handleOpenTranslationModal = useCallback(() => {
    const preferredLanguage = translationTargetLanguage
      || translationLanguageOptions.find((option) => !option.status)?.language
      || translationLanguageOptions[0]?.language
      || '';
    setShowPostQuickActions(false);
    setTranslationTargetLanguage(preferredLanguage);
    setShowTranslationModal(true);
  }, [translationLanguageOptions, translationTargetLanguage]);

  const handleCloseTranslationModal = useCallback(() => {
    setShowTranslationModal(false);
  }, []);

  const handleConfirmTranslation = useCallback(() => {
    if (!translationTargetLanguage) return;
    setShowTranslationModal(false);
    void handleTranslatePost(translationTargetLanguage);
  }, [handleTranslatePost, translationTargetLanguage]);

  // Load project language for AI post analysis
  useEffect(() => {
    window.electronAPI?.meta?.getProjectMetadata?.()?.then(metadata => {
      if (metadata?.mainLanguage) {
        setProjectLanguage(metadata.mainLanguage);
      }
    });
  }, []);

  // Close quick actions menu when clicking outside
  useEffect(() => {
    if (!showPostQuickActions) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (postQuickActionsRef.current && !postQuickActionsRef.current.contains(e.target as Node)) {
        setShowPostQuickActions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPostQuickActions]);

  // Handle AI post analysis (title, excerpt, slug suggestions)
  const handlePostAIAnalysis = useCallback(async () => {
    if (!post || isAnalyzingPost) return;

    setShowPostQuickActions(false);
    setShowPostAISuggestionsModal(true);
    setIsAnalyzingPost(true);
    setPostAISuggestionFields([]);
    setPostAIError(undefined);

    try {
      const result = await window.electronAPI?.chat.analyzePost(postId, projectLanguage);

      if (result?.success) {
        const slugLocked = !!post.publishedAt;
        setPostAISuggestionFields([
          { key: 'title', label: tr('aiSuggestions.titleField'), currentValue: title, suggestedValue: result.title },
          { key: 'excerpt', label: tr('aiSuggestions.excerptField'), currentValue: excerpt, suggestedValue: result.excerpt },
          {
            key: 'slug',
            label: tr('aiSuggestions.slugField'),
            currentValue: post.slug,
            suggestedValue: result.slug,
            disabled: slugLocked,
            warning: slugLocked ? tr('aiSuggestions.slugLockedWarning') : undefined,
          },
        ]);
      } else {
        setPostAIError(result?.error || tr('editor.post.error.analyzePost'));
      }
    } catch (error) {
      console.error('Failed to analyze post:', error);
      setPostAIError((error as Error).message || tr('editor.post.error.analyzePost'));
    } finally {
      setIsAnalyzingPost(false);
    }
  }, [post, postId, projectLanguage, isAnalyzingPost, title, excerpt, tr]);

  // Handle applying AI post suggestions
  const handleApplyPostAISuggestions = useCallback(async (values: Record<string, string>) => {
    setShowPostAISuggestionsModal(false);
    if (Object.keys(values).length === 0) return;

    try {
      const updatePayload: Record<string, unknown> = {};
      if (values.title) updatePayload.title = values.title;
      if (values.excerpt) updatePayload.excerpt = values.excerpt;
      if (values.slug && !post?.publishedAt) updatePayload.slug = values.slug;

      const updated = await window.electronAPI?.posts.update(postId, updatePayload as Parameters<typeof window.electronAPI.posts.update>[1]);
      if (updated) {
        updatePost(postId, updated as Partial<PostData>);
        setPost(prev => prev ? { ...prev, ...updated as Partial<PostData> } : prev);
        // Update local state for fields that changed
        if (values.title) setTitle(values.title);
        if (values.excerpt) setExcerpt(values.excerpt);
        markDirty(postId);
        showToast.success(tr('editor.post.toast.aiApplied'));
      }
    } catch (error) {
      console.error('Failed to apply AI suggestions:', error);
      showToast.error(tr('editor.post.error.applyFailed'));
    }
  }, [post, postId, updatePost, markDirty, tr]);

  // Close AI post suggestions modal
  const handleClosePostAISuggestionsModal = useCallback(() => {
    setShowPostAISuggestionsModal(false);
    setPostAISuggestionFields([]);
    setPostAIError(undefined);
  }, []);

  const handlePublish = async () => {
    await handleSave();
    try {
      const updated = await window.electronAPI?.posts.publish(postId);
      if (updated) {
        updatePost(postId, updated as Partial<PostData>);
        setPost(prev => prev ? { ...prev, ...updated as Partial<PostData> } : prev);
        showToast.success(tr('editor.toast.published'));
      }
    } catch (error) {
      console.error('Failed to publish post:', error);
      const err = error as Error;
      showErrorModal({
        title: tr('editor.error.publishTitle'),
        message: err.message || tr('editor.error.publishMessage'),
        stack: err.stack,
      });
    }
  };

  const handleDiscard = async () => {
    // If this post has a published version, revert to it
    // If never published, delete the post entirely
    const confirmMessage = hasPublishedVersion
      ? tr('editor.confirm.discardChanges')
      : tr('editor.confirm.deleteDraft');
    
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      if (hasPublishedVersion) {
        // Revert to published version
        const reverted = await window.electronAPI?.posts.discard(postId);
        if (reverted) {
          setTitle(reverted.title);
          setContent(reverted.content);
          setAuthor(reverted.author || '');
          setTags(reverted.tags);
          setSelectedCategories(reverted.categories.length > 0 ? reverted.categories : ['article']);
          // Force Monaco to remount with the reverted content
          setMonacoResetToken(prev => prev + 1);
          // Update local post state so UI reflects the published status
          setPost(reverted as PostData);
          updatePost(postId, reverted as Partial<PostData>);
          markClean(postId);
          showToast.success(tr('editor.toast.reverted'));
        }
      } else {
        // Never published - delete the post entirely
        await window.electronAPI?.posts.delete(postId);
        // Clear pending ref to prevent auto-save on unmount from resurrecting the post
        pendingChangesRef.current = null;
        useAppStore.getState().removePost(postId);
        useAppStore.getState().closeTab(postId);
        showToast.success(tr('editor.toast.draftDeleted'));
      }
    } catch (error) {
      console.error('Failed to discard/delete:', error);
      const err = error as Error;
      showErrorModal({
        title: hasPublishedVersion ? tr('editor.error.discardTitle') : tr('editor.error.deleteTitle'),
        message: err.message || tr('editor.error.operationMessage'),
        stack: err.stack,
      });
    }
  };

  const handleDelete = async () => {
    try {
      // Fetch references to this post
      const [linkedBy, linkedMedia] = await Promise.all([
        window.electronAPI?.posts.getLinkedBy(postId),
        window.electronAPI?.postMedia.getForPost(postId),
      ]);

      // Build references array
      const references: Array<{ id: string; title: string; type: 'post' | 'media' | 'link' }> = [];

      // Add posts that link to this post
      if (linkedBy && linkedBy.length > 0) {
        linkedBy.forEach((p: { id: string; title: string }) => {
          references.push({ id: p.id, title: p.title, type: 'link' });
        });
      }

      // Add linked media
      if (linkedMedia && linkedMedia.length > 0) {
        linkedMedia.forEach((m: { mediaId: string }) => {
          const mediaItem = media.find(item => item.id === m.mediaId);
          if (mediaItem) {
            references.push({
              id: mediaItem.id,
              title: getMediaDisplayName(mediaItem),
              type: 'media',
            });
          }
        });
      }

      // Show confirmation modal
      showConfirmDeleteModal({
        itemType: 'post',
        itemTitle: title || tr('editor.untitled'),
        references,
        onConfirm: async () => {
          try {
            await window.electronAPI?.posts.delete(postId);
            // Clear pending ref to prevent auto-save on unmount from resurrecting the post
            pendingChangesRef.current = null;
            useAppStore.getState().removePost(postId);
            useAppStore.getState().closeTab(postId);
            useAppStore.getState().setSelectedPost(null);
            showToast.success(tr('editor.toast.postDeleted'));
          } catch (error) {
            console.error('Failed to delete post:', error);
            const err = error as Error;
            showErrorModal({
              title: tr('editor.error.deleteTitle'),
              message: err.message || tr('editor.error.deletePostMessage'),
              stack: err.stack,
            });
          }
        },
      });
    } catch (error) {
      console.error('Failed to fetch post references:', error);
      const err = error as Error;
      showErrorModal({
        title: tr('errorModal.error'),
        message: err.message || tr('editor.error.fetchPostReferencesMessage'),
        stack: err.stack,
      });
    }
  };

  // Handle Monaco editor mount
  const handleEditorDidMount = (editor: unknown, monaco: Monaco) => {
    editorRef.current = editor;
    const ed = editor as any;

    // Add keyboard shortcut and command for inserting post links
    ed.addAction({
      id: 'editor.action.insertPostLink',
      label: 'Insert Link to Post',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: () => {
        setShowPostSearch(true);
      }
    });
  };

  // Handle link insertion from InsertModal (for posts or external URLs)
  const handleInsertLink = useCallback((url: string, text?: string) => {
    const editor = editorRef.current as any;
    if (!editor) return;

    const model = editor.getModel();
    if (!model) return;

    const selection = editor.getSelection();
    const selectedText = selection ? model.getValueInRange(selection) : '';

    const linkText = text || selectedText || url;
    const linkMarkdown = `[${linkText}](${url})`;

    editor.executeEdits('insert-link', [{
      range: selection || editor.getSelection(),
      text: linkMarkdown,
      forceMoveMarkers: true
    }]);

    setShowPostSearch(false);
  }, []);

  // Handle image insertion from InsertModal (for media library)
  const handleInsertImage = useCallback(async (url: string, alt: string, mediaId?: string) => {
    const editor = editorRef.current as any;
    if (!editor) return;

    const selection = editor.getSelection();
    const imageMarkdown = `![${alt}](${url})`;

    editor.executeEdits('insert-image', [{
      range: selection || editor.getSelection(),
      text: imageMarkdown,
      forceMoveMarkers: true
    }]);

    // Link the media to this post if mediaId is provided (from media library)
    if (mediaId) {
      try {
        await window.electronAPI?.postMedia.link(postId, mediaId);
        console.log(`[Editor] Linked media ${mediaId} to post ${postId}`);
      } catch (error) {
        console.error('Failed to link media to post:', error);
      }
    }

    setShowMediaSearch(false);
  }, [postId]);

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
  useSaveShortcut(handleSave);

  // Listen for menu events
  useEffect(() => {
    const unsubscribeSave = window.electronAPI?.on('menu:save', handleSave);
    const unsubscribePublish = window.electronAPI?.on('menu:publishSelected', handlePublish);

    return () => {
      unsubscribeSave?.();
      unsubscribePublish?.();
    };
  }, [handleSave]);

  // Show loading state while fetching post data
  if (isLoadingPost || !post) {
    return (
      <div className="editor">
        <div className="editor-empty">
          <div className="welcome-content">
            <p className="text-muted">{tr('editor.loadingPost')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="editor">
      <div className="editor-header">
        <div className="editor-tabs">
          <div className={`editor-tab active ${isDirty ? 'dirty' : ''}`}>
            <span className="editor-tab-title">{title || tr('editor.untitled')}</span>
            {isDirty && <span className="editor-tab-dirty" title={tr('editor.unsavedChanges')}>●</span>}
          </div>
        </div>
        <div className="editor-actions">
          <span className={`status-badge status-${post.status}`}>
            {post.status}
          </span>
          {isSaving && <span className="auto-save-indicator">{tr('editor.saving')}</span>}
          <div className="quick-actions-wrapper" ref={postQuickActionsRef}>
            <button
              className="secondary quick-actions-btn"
              onClick={() => setShowPostQuickActions(!showPostQuickActions)}
              disabled={isAnalyzingPost}
              title={tr('editor.post.quickActions.title')}
            >
              {isAnalyzingPost ? tr('editor.post.quickActions.analyzing') : tr('editor.post.quickActions.button')}
            </button>
            {showPostQuickActions && (
              <div className="quick-actions-menu">
                <button
                  className="quick-action-item"
                  onClick={handlePostAIAnalysis}
                  disabled={isAnalyzingPost || !content}
                >
                  <span className="quick-action-icon">🤖</span>
                  <span className="quick-action-text">
                    <strong>{tr('editor.post.quickActions.aiTitle')}</strong>
                    <small>{tr('editor.post.quickActions.aiDescription')}</small>
                  </span>
                </button>
                <div className="quick-actions-divider" />
                <button
                  className="quick-action-item"
                  onClick={handleOpenTranslationModal}
                  disabled={isTranslatingPost || translationLanguageOptions.length === 0}
                >
                  <span className="quick-action-icon">🌍</span>
                  <span className="quick-action-text">
                    <strong>{tr('editor.translations.translateButton')}</strong>
                    <small>{tr('editor.translations.selectTarget')}</small>
                  </span>
                </button>
              </div>
            )}
          </div>
          {post.status === 'draft' && (
            <button
              onClick={handlePublish}
              className="success"
              title={tr('editor.publishTitle')}
            >
              {tr('editor.publish')}
            </button>
          )}
          {post.status === 'draft' && (
            <button 
              onClick={handleDiscard} 
              className="secondary danger"
              title={hasPublishedVersion ? tr('editor.discardChangesTitle') : tr('editor.discardDraftTitle')}
            >
              {hasPublishedVersion ? tr('editor.discardChanges') : tr('editor.discardDraft')}
            </button>
          )}
          {post.status === 'published' && (
            <button onClick={handleDelete} className="secondary danger" title={tr('editor.deleteTitle')}>
              {tr('editor.delete')}
            </button>
          )}
        </div>
      </div>

      <div className="editor-content">
        <button
          className={`metadata-toggle ${metadataExpanded ? 'expanded' : ''}`}
          onClick={() => setMetadataExpanded(v => !v)}
        >
          <span className="metadata-toggle-chevron">{metadataExpanded ? '▼' : '▶'}</span>
          <span>{tr('editor.metadata.toggle')}</span>
        </button>
        {metadataExpanded && (
        <div className="editor-header-row">
          <div className="editor-meta">
            <div className="editor-field">
              <label htmlFor={`${fieldIdPrefix}-title`}>{tr('editor.field.title')}</label>
              <input
                id={`${fieldIdPrefix}-title`}
                ref={titleInputRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={tr('editor.untitled')}
              />
            </div>
            <div className="editor-field">
              <label>{tr('editor.field.tags')}</label>
              <TagInput
                value={tags}
                onChange={setTags}
                placeholder={tr('editor.placeholder.tags')}
                postId={postId}
              />
            </div>
            <div className="editor-field">
              <label htmlFor={`${fieldIdPrefix}-author`}>{tr('editor.field.author')}</label>
              <input
                id={`${fieldIdPrefix}-author`}
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder={tr('editor.placeholder.author')}
              />
            </div>
            <div className="editor-field">
              <label htmlFor={`${fieldIdPrefix}-language`}>{tr('editor.field.language')}</label>
              <div className="editor-language-row">
                <select
                  id={`${fieldIdPrefix}-language`}
                  value={postLanguage}
                  onChange={(e) => handleCanonicalLanguageChange(e.target.value)}
                >
                  <option value="">{tr('editor.field.languageDefault')}</option>
                  {SUPPORTED_POST_LANGUAGES.map((languageCode) => (
                    <option key={languageCode} value={languageCode}>{getLanguageLabel(languageCode)}</option>
                  ))}
                </select>
                <div className="editor-translations-flags" aria-label={tr('editor.translations.title')}>
                  {languageFlags.map((item) => (
                    <button
                      key={item.language}
                      type="button"
                      onClick={() => handleActivateLanguage(item.language)}
                      aria-label={item.ariaLabel}
                      title={item.ariaLabel}
                      className={`editor-translation-flag status-${item.status} ${activeEditingLanguage === item.language ? 'active' : ''}`}
                    >
                      {getLanguageFlag(item.language)}
                    </button>
                  ))}
                </div>
                <button
                  className="secondary compact"
                  onClick={handleDetectLanguage}
                  disabled={isDetectingLanguage || (!title && !content)}
                  title={tr('editor.post.quickActions.detectLanguageDescription')}
                >
                  {isDetectingLanguage ? tr('editor.post.quickActions.detecting') : '🤖'}
                </button>
              </div>
            </div>
            <div className="editor-field-row">
              <div className="editor-field">
                <label htmlFor={`${fieldIdPrefix}-slug`}>{tr('editor.field.slug')}</label>
                <input
                  id={`${fieldIdPrefix}-slug`}
                  type="text"
                  value={post.slug}
                  disabled
                  className="disabled"
                />
              </div>
              <div className="editor-field">
                <label>{tr('editor.field.categories')}</label>
                <TagInput
                  value={selectedCategories}
                  onChange={(categories) => {
                    setSelectedCategories(categories.length > 0 ? categories : ['article']);
                  }}
                  placeholder={tr('editor.placeholder.categories')}
                  mode="category"
                />
              </div>
            </div>
            {availablePostTemplates.length > 0 && (
              <div className="editor-field">
                <label htmlFor={`${fieldIdPrefix}-template`}>{tr('editor.field.template')}</label>
                <select
                  id={`${fieldIdPrefix}-template`}
                  value={templateSlug}
                  onChange={(e) => setTemplateSlug(e.target.value)}
                >
                  <option value="">{tr('editor.field.templateDefault')}</option>
                  {availablePostTemplates.map((tmpl) => (
                    <option key={tmpl.slug} value={tmpl.slug}>{tmpl.title}</option>
                  ))}
                </select>
              </div>
            )}

            <PostLinks
              postId={postId}
              updatedAt={post.updatedAt}
              onPostClick={(id) => useAppStore.getState().setSelectedPost(id)}
            />
          </div>

          <div className="editor-media-panel">
            <LinkedMediaPanel postId={postId} />
          </div>
        </div>
        )}

        <button
          className={`metadata-toggle ${excerptExpanded ? 'expanded' : ''}`}
          onClick={() => setExcerptExpanded(v => !v)}
        >
          <span className="metadata-toggle-chevron">{excerptExpanded ? '▼' : '▶'}</span>
          <span>{tr('editor.excerpt.toggle')}</span>
        </button>
        {excerptExpanded && (
          <div className="editor-excerpt-panel">
            <div className="editor-field">
              <label htmlFor={`${fieldIdPrefix}-excerpt`}>{tr('editor.field.excerpt')}</label>
              <textarea
                id={`${fieldIdPrefix}-excerpt`}
                ref={excerptInputRef}
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                placeholder={tr('editor.placeholder.excerpt')}
                rows={4}
              />
            </div>
          </div>
        )}
        
        <div className="editor-body" ref={editorBodyRef}>
          <div className="editor-toolbar">
            <div className="editor-toolbar-left">
              <label>{tr('editor.field.content')}</label>
            </div>
            <div className="editor-toolbar-center">
              <div className="editor-mode-toggle">
                <button 
                  className={editorMode === 'wysiwyg' ? 'active' : ''} 
                  onClick={() => handleEditorModeChange('wysiwyg')}
                  title={tr('editor.mode.visualTitle')}
                >
                  {tr('editor.mode.visual')}
                </button>
                <button 
                  className={editorMode === 'markdown' ? 'active' : ''} 
                  onClick={() => handleEditorModeChange('markdown')}
                  title={tr('editor.mode.markdownTitle')}
                >
                  {tr('settings.editor.mode.markdown')}
                </button>
                <button 
                  className={editorMode === 'preview' ? 'active' : ''} 
                  onClick={() => handleEditorModeChange('preview')}
                  title={tr('editor.mode.previewTitle')}
                >
                  {tr('settings.editor.mode.preview')}
                </button>
              </div>
            </div>
            <div className="editor-toolbar-right">
              {images.length > 0 && (
                <button
                  className="gallery-button"
                  onClick={() => { setLightboxIndex(0); setLightboxOpen(true); }}
                  title={tr('editor.galleryTitle', { count: images.length })}
                >
                  📷 {images.length}
                </button>
              )}
              {editorMode === 'markdown' && (
                <>
                  <button
                    className="insert-post-link-button"
                    onClick={() => setShowPostSearch(true)}
                    title={tr('editor.insertPostLinkTitle')}
                  >
                    📝
                  </button>
                  <button
                    className="insert-media-button"
                    onClick={() => setShowMediaSearch(true)}
                    title={tr('editor.insertMediaTitle')}
                  >
                    🖼️
                  </button>
                </>
              )}
            </div>
          </div>
          
          {editorMode === 'wysiwyg' && (
            <MilkdownEditor
              content={content}
              onChange={setContent}
              placeholder={tr('editor.placeholder.startWriting')}
              currentPostTags={tags}
              currentPostCategories={selectedCategories}
            />
          )}
          
          {editorMode === 'markdown' && (
            <MonacoEditor
              key={monacoResetToken}
              height="100%"
              language="markdown-with-macros"
              defaultValue={content}
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
            <div className="editor-preview">
              {previewUrl ? (
                <iframe
                  className="editor-preview-frame"
                  src={previewUrl}
                  title={tr('editor.previewFrameTitle')}
                />
              ) : (
                <div className="editor-preview-loading">{tr('editor.previewLoading')}</div>
              )}
            </div>
          )}
        </div>
        
        {/* Lightbox for viewing images in content */}
        <Lightbox
          images={images}
          initialIndex={lightboxIndex}
          isOpen={lightboxOpen}
          onClose={() => { setLightboxOpen(false); }}
        />
      </div>

      <div className="editor-footer">
        <span className="text-muted text-small">
          {tr('editor.footer.created')}: {new Date(post.createdAt).toLocaleString(UI_DATE_LOCALE[language] || UI_DATE_LOCALE.en)}
        </span>
        <span className="text-muted text-small">
          {tr('editor.footer.updated')}: {new Date(post.updatedAt).toLocaleString(UI_DATE_LOCALE[language] || UI_DATE_LOCALE.en)}
        </span>
        {post.publishedAt && (
          <span className="text-muted text-small">
            {tr('editor.footer.published')}: {new Date(post.publishedAt).toLocaleString(UI_DATE_LOCALE[language] || UI_DATE_LOCALE.en)}
          </span>
        )}
      </div>

      {showPostSearch && (
        <InsertModal
          mode="link"
          onInsertLink={handleInsertLink}
          onInsertImage={() => {}}
          onClose={() => setShowPostSearch(false)}
          currentPostTags={tags}
          currentPostCategories={selectedCategories}
          currentPostId={postId}
        />
      )}
      
      {showMediaSearch && (
        <InsertModal
          mode="image"
          onInsertImage={handleInsertImage}
          onInsertLink={() => {}}
          onClose={() => setShowMediaSearch(false)}
        />
      )}

      {/* AI Post Suggestions Modal */}
      <AISuggestionsModal
        isOpen={showPostAISuggestionsModal}
        isLoading={isAnalyzingPost}
        fields={postAISuggestionFields}
        modalTitle={tr('aiSuggestions.postTitle')}
        loadingText={tr('aiSuggestions.analyzingPost')}
        emptyText={tr('aiSuggestions.postEmpty')}
        error={postAIError}
        onConfirm={handleApplyPostAISuggestions}
        onClose={handleClosePostAISuggestionsModal}
      />

      {showTranslationModal && (
        <div className="translation-modal-backdrop" onClick={handleCloseTranslationModal}>
          <div className="translation-modal" onClick={(event) => event.stopPropagation()}>
            <div className="translation-modal-header">
              <h2>{tr('editor.translations.title')}</h2>
              <button className="translation-modal-close" onClick={handleCloseTranslationModal} title={tr('common.cancel')}>×</button>
            </div>
            <div className="translation-modal-body">
              <label className="translation-modal-label" htmlFor="translation-target-language">{tr('editor.translations.selectTarget')}</label>
              <p className="translation-modal-copy">{tr('editor.translations.currentLanguage', { language: getLanguageLabel(postLanguage || post?.language || projectLanguage) })}</p>
              <select
                id="translation-target-language"
                className="translation-modal-select"
                value={translationTargetLanguage}
                onChange={(e) => setTranslationTargetLanguage(e.target.value)}
              >
                {translationLanguageOptions.map((option) => (
                  <option key={option.language} value={option.language}>
                    {getLanguageLabel(option.language)}{option.status ? ` (${tr(`editor.translations.status.${option.status}`)})` : ''}
                  </option>
                ))}
              </select>
              {translationTargetLanguage && (
                <div className="translation-modal-status-row">
                  <span className="translation-modal-flag" aria-hidden="true">{getLanguageFlag(translationTargetLanguage)}</span>
                  <span className="translation-modal-status-copy">
                    <strong>{getLanguageLabel(translationTargetLanguage)}</strong>
                    <small>
                      {selectedTranslation
                        ? tr(`editor.translations.status.${selectedTranslation.status}`)
                        : tr('editor.translations.none')}
                    </small>
                  </span>
                </div>
              )}
            </div>
            <div className="translation-modal-footer">
              <button className="secondary" onClick={handleCloseTranslationModal}>{tr('common.cancel')}</button>
              <button
                onClick={handleConfirmTranslation}
                disabled={!translationTargetLanguage || isTranslatingPost}
                title={tr('editor.translations.translateTitle')}
              >
                {isTranslatingPost ? tr('editor.translations.translating') : tr('editor.translations.translateButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MediaEditor: React.FC<{ mediaId: string }> = ({ mediaId }) => {
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
  const [showTranslateDropdown, setShowTranslateDropdown] = useState(false);

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
        updateMedia(item!.id, updated as Partial<typeof item>);
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
          updateMedia(item.id, updated as Partial<typeof item>);
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
    setShowTranslateDropdown(false);
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
    setAISuggestions(null);
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
        updateMedia(item.id, updated as Partial<typeof item>);
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
        updateMedia(item.id, updated as Partial<typeof item>);
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
          {item.mimeType.startsWith('image/') && (
            <div className="quick-actions-wrapper" ref={quickActionsRef}>
              <button 
                className="secondary quick-actions-btn"
                onClick={() => setShowQuickActions(!showQuickActions)}
                disabled={isAnalyzing}
                title={tr('editor.media.quickActions.title')}
              >
                {isAnalyzing ? tr('editor.media.quickActions.analyzing') : tr('editor.media.quickActions.button')}
              </button>
              {showQuickActions && (
                <div className="quick-actions-menu">
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
                </div>
              )}
            </div>
          )}
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
                src={`bds-media://${item.id}?t=${item.updatedAt instanceof Date ? item.updatedAt.getTime() : item.updatedAt}`} 
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
            <div className="editor-field-row">
              <select
                value={mediaLanguage}
                onChange={(e) => handleLanguageChange(e.target.value)}
              >
                <option value="">{tr('editor.media.field.languageNone')}</option>
                {SUPPORTED_POST_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>{tr(`language.${lang}`)}</option>
                ))}
              </select>
              <button
                className="secondary"
                onClick={handleDetectLanguage}
                disabled={isDetectingLanguage || (!title && !alt && !caption)}
                title={tr('editor.media.translations.detectTitle')}
              >
                {isDetectingLanguage ? tr('editor.media.translations.detecting') : tr('editor.media.translations.detect')}
              </button>
            </div>
          </div>

          {mediaLanguage && (
            <div className="editor-field media-translations-section">
              <label>
                {tr('editor.media.translations.title')}
                {availableTranslationLanguages.length > 0 && (
                  <div className="quick-actions-wrapper" style={{ display: 'inline-block', marginLeft: '8px' }}>
                    <button
                      className="add-link-btn"
                      onClick={() => setShowTranslateDropdown(!showTranslateDropdown)}
                      disabled={isTranslating}
                    >
                      {isTranslating ? tr('editor.media.translations.translating') : tr('editor.media.translations.translateButton')}
                    </button>
                    {showTranslateDropdown && (
                      <div className="quick-actions-menu">
                        {availableTranslationLanguages.map((lang) => (
                          <button
                            key={lang}
                            className="quick-action-item"
                            onClick={() => handleTranslateMedia(lang)}
                          >
                            <span className="quick-action-icon">{POST_LANGUAGE_FLAGS[lang]}</span>
                            <span className="quick-action-text">{tr(`language.${lang}`)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </label>

              {mediaTranslations.length === 0 ? (
                <div className="no-linked-posts">{tr('editor.media.translations.none')}</div>
              ) : (
                <div className="linked-posts-list">
                  {mediaTranslations.map((translation) => (
                    <div key={translation.language} className="linked-post-item">
                      <span className="linked-post-title">
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
  const { t: tr, language } = useI18n();
  const { posts, media } = useAppStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [yearMonthData, setYearMonthData] = useState<{ year: number; month: number; count: number }[]>([]);
  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);
  const [tagColors, setTagColors] = useState<Map<string, string>>(new Map());
  const [categoryCounts, setCategoryCounts] = useState<CategoryCount[]>([]);

  const uiDateLocale = UI_DATE_LOCALE[language] || UI_DATE_LOCALE.en;
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(uiDateLocale, { month: 'short' }),
    [uiDateLocale]
  );

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [ds, ym, tc, cc, colorMap] = await Promise.all([
          window.electronAPI?.posts.getDashboardStats(),
          window.electronAPI?.posts.getByYearMonth(),
          window.electronAPI?.posts.getTagsWithCounts(),
          window.electronAPI?.posts.getCategoriesWithCounts(),
          loadTagColorMap(),
        ]);
        if (ds) setStats(ds);
        if (ym) setYearMonthData(ym);
        if (tc) setTagCounts(tc);
        if (cc) setCategoryCounts(cc);
        setTagColors(colorMap);
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
      color: tagColors.get(t.tag),
    })).sort((a, b) => a.tag.localeCompare(b.tag)); // alphabetical for cloud layout
  }, [tagCounts, tagColors]);

  const displayTotalPosts = stats?.totalPosts ?? posts.length;
  const displayDraftCount = stats?.draftCount ?? 0;
  const displayPublishedCount = stats?.publishedCount ?? 0;
  const displayArchivedCount = stats?.archivedCount ?? 0;

  const getPostCountLabel = useCallback((count: number) => {
    return tr(count === 1 ? 'dashboard.postCount.one' : 'dashboard.postCount.other', { count });
  }, [tr]);

  const getPostStatusLabel = useCallback((status: string) => {
    const statusKeyByValue: Record<string, string> = {
      draft: 'dashboard.status.draft',
      published: 'dashboard.status.published',
      archived: 'dashboard.status.archived',
    };
    const key = statusKeyByValue[status];
    return key ? tr(key) : status;
  }, [tr]);

  return (
    <div className="editor-empty">
      <div className="dashboard-content">
        <h1>{tr('dashboard.title')}</h1>
        <p className="text-muted">{tr('dashboard.subtitle')}</p>

        <div className="dashboard-stats">
          <div className="stat-card">
            <div className="stat-number">{displayTotalPosts}</div>
            <div className="stat-label">{tr('dashboard.stats.totalPosts')}</div>
            <div className="stat-breakdown">
              <span className="stat-tag stat-published">{tr('dashboard.stats.published', { count: displayPublishedCount })}</span>
              <span className="stat-tag stat-draft">{tr('dashboard.stats.drafts', { count: displayDraftCount })}</span>
              {displayArchivedCount > 0 && <span className="stat-tag stat-archived">{tr('dashboard.stats.archived', { count: displayArchivedCount })}</span>}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{media.length}</div>
            <div className="stat-label">{tr('dashboard.stats.mediaFiles')}</div>
            <div className="stat-breakdown">
              <span className="stat-tag">{tr('dashboard.stats.images', { count: imageCount })}</span>
              <span className="stat-tag">{formatBytes(totalMediaSize)}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{tagCounts.length}</div>
            <div className="stat-label">{tr('dashboard.stats.tags')}</div>
            <div className="stat-breakdown">
              <span className="stat-tag">{tr('dashboard.stats.categories', { count: categoryCounts.length })}</span>
            </div>
          </div>
        </div>

        {timelineEntries.length > 0 && (
          <div className="dashboard-section">
            <h4>{tr('dashboard.section.postsOverTime')}</h4>
            <div className="timeline-chart">
              {timelineEntries.map((entry) => (
                <div key={`${entry.year}-${entry.month}`} className="timeline-bar-container">
                  <div className="timeline-bar" style={{ height: `${(entry.count / maxCount) * 100}%` }}>
                    <span className="timeline-bar-count">{entry.count}</span>
                  </div>
                  <div className="timeline-bar-label">
                    <span className="timeline-bar-label-month">{monthFormatter.format(new Date(entry.year, entry.month - 1, 1))}</span>
                    <span className="timeline-bar-label-year">{entry.year}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tagCloudItems.length > 0 && (
          <div className="dashboard-section">
            <h4>{tr('dashboard.section.tags')}</h4>
            <div className="tag-cloud">
              {tagCloudItems.map(item => {
                const hasColor = !!item.color;
                const style: React.CSSProperties = hasColor
                  ? {
                      fontSize: `${item.fontSize}px`,
                      backgroundColor: item.color,
                      color: getContrastColor(item.color!),
                    }
                  : { fontSize: `${item.fontSize}px` };
                return (
                  <span
                    key={item.tag}
                    className={`dashboard-tag ${hasColor ? 'has-color' : ''}`}
                    style={style}
                    title={getPostCountLabel(item.count)}
                  >
                    {item.tag}
                  </span>
                );
              })}
              {tagCounts.length > 40 && <span className="text-muted tag-cloud-more">{tr('dashboard.tagCloud.more', { count: tagCounts.length - 40 })}</span>}
            </div>
          </div>
        )}

        {categoryCounts.length > 0 && (
          <div className="dashboard-section">
            <h4>{tr('dashboard.section.categories')}</h4>
            <div className="tag-cloud">
              {categoryCounts.map(cat => (
                <span
                  key={cat.category}
                  className="dashboard-tag dashboard-category"
                  title={getPostCountLabel(cat.count)}
                >
                  {cat.category} <span className="tag-count">{cat.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {recentPosts.length > 0 && (
          <div className="dashboard-section">
            <h4>{tr('dashboard.section.recentlyUpdated')}</h4>
            <div className="recent-posts-list">
              {recentPosts.map(post => (
                <div
                  key={post.id}
                  className="recent-post-item"
                  onClick={() => {
                    useAppStore.getState().setActiveView('posts');
                    useAppStore.getState().setSelectedPost(post.id);
                    openEntityTab(useAppStore.getState().openTab, 'post', post.id, 'preview');
                  }}
                  onDoubleClick={() => {
                    useAppStore.getState().setActiveView('posts');
                    useAppStore.getState().setSelectedPost(post.id);
                    openEntityTab(useAppStore.getState().openTab, 'post', post.id, 'pin');
                  }}
                >
                  <span className="recent-post-title">{post.title || tr('editor.untitled')}</span>
                  <span className={`recent-post-status status-${post.status}`}>{getPostStatusLabel(post.status)}</span>
                  <span className="recent-post-date">{new Date(post.updatedAt).toLocaleDateString(uiDateLocale)}</span>
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
    confirmDeleteModal,
    hideConfirmDeleteModal,
    isLoading,
    setSelectedPost,
    setSelectedMedia,
    closeTab,
  } = useAppStore();

  // Get the active tab
  const activeTab = tabs.find(t => t.id === activeTabId);

  const editorRoute = resolveEditorRoute(activeTab);

  useEffect(() => {
    const activePostId = activeTab?.type === 'post' ? activeTab.id : null;
    window.electronAPI?.app.setPreviewPostTarget(activePostId).catch((error) => {
      console.error('Failed to sync preview post target:', error);
    });
  }, [activeTab]);

  // Clear selectedPostId if the post doesn't exist (e.g., after project switch)
  useEffect(() => {
    if (activeView === 'posts' && selectedPostId && !isLoading) {
      window.electronAPI?.posts.get(selectedPostId).then(post => {
        if (!post) {
          setSelectedPost(null);
        }
      });
    }
  }, [activeView, selectedPostId, isLoading, setSelectedPost]);

  // Clear selectedMediaId if the media doesn't exist (e.g., after project switch)
  useEffect(() => {
    if (activeView === 'media' && selectedMediaId && !isLoading) {
      const mediaExists = media.some(m => m.id === selectedMediaId);
      if (!mediaExists) {
        setSelectedMedia(null);
      }
    }
  }, [activeView, selectedMediaId, media, isLoading, setSelectedMedia]);

  // Close media tab if the media doesn't exist anymore
  useEffect(() => {
    if (activeTab && !isLoading) {
      if (activeTab.type === 'media') {
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

  // Show confirm delete modal if present
  const renderConfirmDeleteModal = () => (
    <ConfirmDeleteModal details={confirmDeleteModal} onClose={hideConfirmDeleteModal} />
  );

  const editorViewRenderers: Record<EditorRoute, () => React.ReactNode> = {
    settings: () => <SettingsView />,
    style: () => <StyleView />,
    tags: () => <TagsView />,
    chat: () => (editorRoute.tabId ? <ChatPanel key={editorRoute.tabId} conversationId={editorRoute.tabId} /> : <Dashboard />),
    import: () =>
      editorRoute.tabId ? <ImportAnalysisView key={editorRoute.tabId} definitionId={editorRoute.tabId} /> : <Dashboard />,
    'menu-editor': () => <MenuEditorView />,
    'metadata-diff': () => <MetadataDiffPanel />,
    'git-diff': () =>
      editorRoute.tabId && editorRoute.gitDiffResource
        ? <GitDiffView key={editorRoute.tabId} filePath={editorRoute.gitDiffResource} />
        : <Dashboard />,
    documentation: () => (
      <DocumentationView
        content={documentationContent}
        titleKey="docs.title"
        subtitleKey="docs.subtitle"
      />
    ),
    'api-documentation': () => (
      <DocumentationView
        content={apiDocumentationContent}
        titleKey="docs.apiTitle"
        subtitleKey="docs.apiSubtitle"
      />
    ),
    'site-validation': () => <SiteValidationView />,
    'translation-validation': () => <TranslationValidationView />,
    'find-duplicates': () => <DuplicatesView />,
    scripts: () => <ScriptsView scriptId={editorRoute.tabId} />,
    templates: () => <TemplatesView templateId={editorRoute.tabId} />,
    post: () => (editorRoute.tabId ? <PostEditor key={editorRoute.tabId} postId={editorRoute.tabId} /> : <Dashboard />),
    media: () => (editorRoute.tabId ? <MediaEditor key={editorRoute.tabId} mediaId={editorRoute.tabId} /> : <Dashboard />),
    dashboard: () => <Dashboard />,
  };

  const editorContent = editorViewRenderers[editorRoute.route]();

  return (
    <div className="editor">
      {editorContent}
      {renderErrorModal()}
      {renderConfirmDeleteModal()}
    </div>
  );
};
