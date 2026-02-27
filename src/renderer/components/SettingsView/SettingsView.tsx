import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../store';
import { showToast } from '../Toast';
import { useI18n } from '../../i18n';
import {
  resolveSupportedRenderLanguage,
  SUPPORTED_RENDER_LANGUAGES,
  type SupportedLanguage,
} from '../../../main/shared/i18n';
import './SettingsView.css';

// Export category IDs for sidebar navigation
export type SettingsCategory = 'project' | 'editor' | 'content' | 'ai' | 'technology' | 'publishing' | 'data';

// Scroll to a settings section by category ID
export const scrollToSettingsSection = (category: SettingsCategory) => {
  const element = document.getElementById(`settings-section-${category}`);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

// Settings categories

interface Credentials {
  // SSH Publishing
  sshHost: string;
  sshUser: string;
  sshRemotePath: string;
  sshMode: 'scp' | 'rsync';
}

interface CategoryMetadata {
  renderInLists: boolean;
  showTitle: boolean;
  title: string;
}

const RENDER_LANGUAGE_LABEL_KEY: Record<SupportedLanguage, string> = {
  en: 'settings.language.english',
  de: 'settings.language.german',
  fr: 'settings.language.french',
  it: 'settings.language.italian',
  es: 'settings.language.spanish',
};

const defaultCredentials: Credentials = {
  sshHost: '',
  sshUser: '',
  sshRemotePath: '',
  sshMode: 'scp',
};

// Search icon for the search bar
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M15.25 0a.75.75 0 0 1 .53.22.75.75 0 0 1 0 1.06l-3.25 3.25A6.5 6.5 0 1 1 11.47 3.47l3.25-3.25A.75.75 0 0 1 15.25 0zM6.5 12a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11z"/>
  </svg>
);

// Default post categories based on VISION.md
const DEFAULT_POST_CATEGORIES = ['article', 'picture', 'aside', 'page'];

const DEFAULT_CATEGORY_METADATA: Record<string, CategoryMetadata> = {
  article: { renderInLists: true, showTitle: true, title: 'article' },
  picture: { renderInLists: true, showTitle: true, title: 'picture' },
  aside: { renderInLists: true, showTitle: false, title: 'aside' },
  page: { renderInLists: false, showTitle: true, title: 'page' },
};

// Standard categories that cannot be deleted
const PROTECTED_CATEGORIES = ['article', 'aside', 'page', 'picture'];

function normalizeBlogmarkCategory(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

// Individual setting row component (VS Code style)
const SettingRow: React.FC<{
  id: string;
  label: string;
  description: string;
  children: React.ReactNode;
}> = ({ id, label, description, children }) => (
  <div className="setting-row" id={`setting-${id}`}>
    <div className="setting-info">
      <label className="setting-label" htmlFor={id}>{label}</label>
      <p className="setting-description">{description}</p>
    </div>
    <div className="setting-control">
      {children}
    </div>
  </div>
);

// Section header component with optional ID for scrolling
const SettingSection: React.FC<{
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  hidden?: boolean;
}> = ({ id, title, description, children, hidden }) => {
  if (hidden) return null;
  return (
    <div className="setting-section" id={id}>
      <div className="setting-section-header">
        <h3>{title}</h3>
        {description && <p className="setting-section-description">{description}</p>}
      </div>
      <div className="setting-section-content">
        {children}
      </div>
    </div>
  );
};

export const SettingsView: React.FC = () => {
  const { t } = useI18n();
  const {
    preferredEditorMode,
    setPreferredEditorMode,
    gitDiffPreferences,
    setGitDiffPreferences,
    activeProject,
    setActiveProject,
  } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [credentials, setCredentials] = useState<Credentials>(defaultCredentials);
  const contentRef = useRef<HTMLDivElement>(null);

  // Project settings
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectDataPath, setProjectDataPath] = useState('');
  const [projectPublicUrl, setProjectPublicUrl] = useState('');
  const [defaultProjectPath, setDefaultProjectPath] = useState('');
  const [projectMainLanguage, setProjectMainLanguage] = useState<SupportedLanguage>('en');
  const [projectDefaultAuthor, setProjectDefaultAuthor] = useState('');
  const [projectMaxPostsPerPage, setProjectMaxPostsPerPage] = useState(50);
  const [projectBlogmarkCategory, setProjectBlogmarkCategory] = useState('article');
  const [projectPythonRuntimeMode, setProjectPythonRuntimeMode] = useState<'webworker' | 'main-thread'>('webworker');

  // Post categories management
  const [postCategories, setPostCategories] = useState<string[]>(DEFAULT_POST_CATEGORIES);
  const [categoryMetadata, setCategoryMetadata] = useState<Record<string, CategoryMetadata>>(DEFAULT_CATEGORY_METADATA);
  const [newCategoryInput, setNewCategoryInput] = useState('');

  // AI Assistant settings
  const [aiSystemPrompt, setAiSystemPrompt] = useState('');
  const [aiSystemPromptModified, setAiSystemPromptModified] = useState(false);
  const [aiApiKeyMasked, setAiApiKeyMasked] = useState('');
  const [aiHasApiKey, setAiHasApiKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [availableModels, setAvailableModels] = useState<{id: string; name: string}[]>([]);
  const [selectedModel, setSelectedModel] = useState('');

  // Check if a section has any matching settings
  const sectionHasMatches = useCallback((sectionKeywords: string[]) => {
    if (!searchQuery) return true;
    return sectionKeywords.some(keyword => 
      keyword.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery]);

  // Sync project fields from active project
  useEffect(() => {
    if (activeProject) {
      setProjectName(activeProject.name);
      setProjectDescription(activeProject.description || '');
      setProjectDataPath(activeProject.dataPath || '');

      // Load the default path for reference
      window.electronAPI?.app.getDefaultProjectPath(activeProject.id).then(path => {
        setDefaultProjectPath(path);
      });

      // Load project metadata (includes public URL, language, and default author)
      window.electronAPI?.meta.getProjectMetadata().then(metadata => {
        if (metadata?.publicUrl) {
          setProjectPublicUrl(metadata.publicUrl);
        } else {
          setProjectPublicUrl('');
        }
        if (metadata?.mainLanguage) {
          setProjectMainLanguage(resolveSupportedRenderLanguage(metadata.mainLanguage));
        }
        if (metadata?.defaultAuthor) {
          setProjectDefaultAuthor(metadata.defaultAuthor);
        } else {
          setProjectDefaultAuthor('');
        }
        const maxPostsPerPage = typeof metadata?.maxPostsPerPage === 'number'
          ? metadata.maxPostsPerPage
          : 50;
        setProjectMaxPostsPerPage(maxPostsPerPage);

        const incomingBlogmarkCategory = normalizeBlogmarkCategory((metadata as { blogmarkCategory?: unknown } | null)?.blogmarkCategory);
        setProjectBlogmarkCategory(incomingBlogmarkCategory || 'article');

        const incomingPythonRuntimeMode = (metadata as { pythonRuntimeMode?: unknown } | null)?.pythonRuntimeMode;
        setProjectPythonRuntimeMode(incomingPythonRuntimeMode === 'main-thread' ? 'main-thread' : 'webworker');

        const incomingCategoryMetadata = (metadata as any)?.categoryMetadata as Record<string, CategoryMetadata> | undefined;
        const incomingLegacyCategorySettings = (metadata as any)?.categorySettings as Record<string, { renderInLists: boolean; showTitle: boolean }> | undefined;
        setCategoryMetadata((current) => {
          const merged = { ...DEFAULT_CATEGORY_METADATA, ...current };
          const source = incomingCategoryMetadata && typeof incomingCategoryMetadata === 'object'
            ? incomingCategoryMetadata
            : incomingLegacyCategorySettings;
          if (source && typeof source === 'object') {
            for (const [category, settings] of Object.entries(source)) {
              merged[category] = {
                renderInLists: settings?.renderInLists !== false,
                showTitle: settings?.showTitle !== false,
                title: typeof (settings as any)?.title === 'string' && (settings as any).title.trim().length > 0
                  ? (settings as any).title.trim()
                  : category,
              };
            }
          }
          return merged;
        });
      });
    }
  }, [activeProject]);

  // Load saved credentials and categories
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Load publishing preferences from project meta (shareable)
        const publishingPrefs = await window.electronAPI?.meta.getPublishingPreferences();
        if (publishingPrefs) {
          setCredentials({
            sshHost: publishingPrefs.sshHost || '',
            sshUser: publishingPrefs.sshUser || '',
            sshRemotePath: publishingPrefs.sshRemotePath || '',
            sshMode: publishingPrefs.sshMode || 'scp',
          });
        } else {
          // Migrate from localStorage if meta file doesn't exist yet
          const savedCreds = localStorage.getItem('bds-credentials');
          if (savedCreds) {
            const parsed = { ...defaultCredentials, ...JSON.parse(savedCreds) };
            setCredentials(parsed);
            // Migrate to meta file and remove from localStorage
            if (parsed.sshHost || parsed.sshRemotePath) {
              await window.electronAPI?.meta.setPublishingPreferences(parsed);
              localStorage.removeItem('bds-credentials');
            }
          }
        }

        // Load categories from backend (project-scoped)
        const categories = await window.electronAPI?.meta.getCategories();
        if (categories && categories.length > 0) {
          setPostCategories(categories);
          setProjectBlogmarkCategory((current) => categories.includes(current) ? current : categories[0]);
          setCategoryMetadata((current) => {
            const next = { ...DEFAULT_CATEGORY_METADATA, ...current };
            for (const category of categories) {
              if (!next[category]) {
                next[category] = { renderInLists: true, showTitle: true, title: category };
              }
            }
            return next;
          });
        } else {
          // Initialize with defaults if no categories exist
          setPostCategories(DEFAULT_POST_CATEGORIES);
          setProjectBlogmarkCategory((current) => DEFAULT_POST_CATEGORIES.includes(current) ? current : DEFAULT_POST_CATEGORIES[0]);
          setCategoryMetadata(DEFAULT_CATEGORY_METADATA);
        }

        // Load AI settings
        try {
          const promptResult = await window.electronAPI?.chat.getSystemPrompt();
          if (promptResult?.success) {
            setAiSystemPrompt(promptResult.prompt || '');
          }
          
          const keyResult = await window.electronAPI?.chat.getApiKey();
          if (keyResult) {
            setAiHasApiKey(keyResult.hasKey);
            setAiApiKeyMasked(keyResult.maskedKey || '');
          }
          
          const modelsResult = await window.electronAPI?.chat.getAvailableModels();
          if (modelsResult?.success && modelsResult.models) {
            setAvailableModels(modelsResult.models);
            setSelectedModel(modelsResult.selectedModel || '');
          }
        } catch (error) {
          console.error('Failed to load AI settings:', error);
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    };
    loadSettings();
  }, [activeProject?.id]); // Reload when project changes

  const handleSavePublishing = async () => {
    try {
      await window.electronAPI?.meta.setPublishingPreferences(credentials);
      showToast.success(t('settings.toast.publishingSaved'));
    } catch (error) {
      console.error('Failed to save publishing credentials:', error);
      showToast.error(t('settings.toast.saveCredentialsFailed'));
    }
  };

  const handleClearCredentials = async () => {
    const newCreds = { ...credentials, sshHost: '', sshUser: '', sshRemotePath: '', sshMode: 'scp' as const };
    setCredentials(newCreds);
    await window.electronAPI?.meta.clearPublishingPreferences();
    showToast.success(t('settings.toast.credentialsCleared', { type: 'SSH' }));
  };

  // Save project settings
  const handleSaveProject = async () => {
    if (!activeProject) return;
    try {
      const updated = await window.electronAPI?.projects.update(activeProject.id, {
        name: projectName.trim() || activeProject.name,
        description: projectDescription.trim(),
        dataPath: projectDataPath.trim() || undefined,
      });
      if (updated) {
        setActiveProject(updated as any);
        useAppStore.getState().updateProject(activeProject.id, updated as any);

        // Also update project.json to keep dataPath, mainLanguage, and defaultAuthor in sync
        await window.electronAPI?.meta.updateProjectMetadata({
          name: projectName.trim() || activeProject.name,
          description: projectDescription.trim(),
          dataPath: projectDataPath.trim() || undefined,
          publicUrl: projectPublicUrl.trim() || undefined,
          mainLanguage: resolveSupportedRenderLanguage(projectMainLanguage),
          defaultAuthor: projectDefaultAuthor.trim() || undefined,
          maxPostsPerPage: Math.min(500, Math.max(1, Math.floor(projectMaxPostsPerPage || 50))),
          blogmarkCategory: normalizeBlogmarkCategory(projectBlogmarkCategory) || undefined,
          pythonRuntimeMode: projectPythonRuntimeMode,
          categoryMetadata,
        });
      }
      showToast.success(t('settings.toast.projectSaved'));
    } catch (error) {
      console.error('Failed to save project settings:', error);
      showToast.error(t('settings.toast.projectSaveFailed'));
    }
  };

  const handleBrowseDataPath = async () => {
    const selected = await window.electronAPI?.app.selectFolder(t('settings.project.selectDataFolder'));
    if (selected) {
      setProjectDataPath(selected);
    }
  };

  const handleResetDataPath = () => {
    setProjectDataPath('');
  };

  const handleCopyBlogmarkBookmarklet = async () => {
    try {
      const bookmarkletSource = await window.electronAPI?.app.getBlogmarkBookmarklet();
      if (!bookmarkletSource) {
        showToast.error(t('settings.toast.blogmarkBookmarkletGenerateFailed'));
        return;
      }

      const copied = await window.electronAPI?.app.copyToClipboard(bookmarkletSource);
      if (copied) {
        showToast.success(t('settings.toast.blogmarkBookmarkletCopied'));
        return;
      }

      showToast.error(t('settings.toast.blogmarkBookmarkletCopyFailed'));
    } catch (error) {
      console.error('Failed to copy blogmark bookmarklet:', error);
      showToast.error(t('settings.toast.blogmarkBookmarkletCopyFailed'));
    }
  };

  // Keywords for each section for search filtering
  const projectKeywords = ['project', 'name', 'description', 'blog', 'site', 'url', 'public', 'path', 'folder', 'location', 'data', 'language', 'author', 'default', 'preview', 'max', 'posts', 'page', 'bookmarklet', 'blogmark'];
  const editorKeywords = ['editor', 'mode', 'wysiwyg', 'markdown', 'preview', 'visual'];
  const contentKeywords = ['content', 'categories', 'post', 'article', 'picture', 'aside', 'page'];
  const aiKeywords = ['ai', 'assistant', 'chat', 'model', 'prompt', 'system', 'api', 'key', 'claude', 'gpt', 'opencode'];
  const technologyKeywords = ['technology', 'python', 'runtime', 'worker', 'webworker', 'main thread', 'execution'];
  const publishingKeywords = ['publishing', 'ssh', 'deploy', 'server', 'host', 'upload', 'scp', 'rsync'];
  const dataKeywords = ['data', 'database', 'rebuild', 'maintenance', 'posts', 'media', 'scripts', 'links', 'folder', 'filesystem'];

  const renderProjectSettings = () => (
    <SettingSection
      id="settings-section-project"
      title={t('settings.project.title')}
      description={t('settings.project.descriptionGeneral')}
      hidden={!sectionHasMatches(projectKeywords)}
    >
      <SettingRow
        id="project-name"
        label={t('settings.project.nameLabel')}
        description={t('settings.project.nameDescription')}
      >
        <input
          id="project-name"
          type="text"
          placeholder={t('settings.project.namePlaceholder')}
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
        />
      </SettingRow>

      <SettingRow
        id="project-description"
        label={t('settings.project.descriptionLabel')}
        description={t('settings.project.descriptionDescription')}
      >
        <textarea
          id="project-description"
          placeholder={t('settings.project.descriptionPlaceholder')}
          value={projectDescription}
          onChange={(e) => setProjectDescription(e.target.value)}
          rows={3}
        />
      </SettingRow>

      <SettingRow
        id="project-datapath"
        label={t('settings.project.dataPathLabel')}
        description={t('settings.project.dataPathDescription', { path: defaultProjectPath })}
      >
        <div className="setting-input-group">
          <input
            id="project-datapath"
            type="text"
            placeholder={defaultProjectPath || t('settings.project.defaultLocation')}
            value={projectDataPath}
            onChange={(e) => setProjectDataPath(e.target.value)}
          />
          <button className="secondary" onClick={handleBrowseDataPath} title={t('settings.project.browse')}>
            {t('settings.project.browse')}
          </button>
          {projectDataPath && (
            <button className="secondary" onClick={handleResetDataPath} title={t('settings.project.resetDefault')}>
              {t('settings.project.reset')}
            </button>
          )}
        </div>
      </SettingRow>

      <SettingRow
        id="project-public-url"
        label={t('settings.project.publicUrlLabel')}
        description={t('settings.project.publicUrlDescription')}
      >
        <input
          id="project-public-url"
          type="url"
          placeholder={t('settings.project.publicUrlPlaceholder')}
          value={projectPublicUrl}
          onChange={(e) => setProjectPublicUrl(e.target.value)}
        />
      </SettingRow>

      <SettingRow
        id="project-language"
        label={t('settings.project.mainLanguageLabel')}
        description={t('settings.project.mainLanguageDescription')}
      >
        <select
          id="project-language"
          value={projectMainLanguage}
          onChange={(e) => setProjectMainLanguage(resolveSupportedRenderLanguage(e.target.value))}
        >
          {SUPPORTED_RENDER_LANGUAGES.map((language) => (
            <option key={language} value={language}>{t(RENDER_LANGUAGE_LABEL_KEY[language])}</option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        id="project-author"
        label={t('settings.project.defaultAuthorLabel')}
        description={t('settings.project.defaultAuthorDescription')}
      >
        <input
          id="project-author"
          type="text"
          placeholder={t('settings.project.defaultAuthorPlaceholder')}
          value={projectDefaultAuthor}
          onChange={(e) => setProjectDefaultAuthor(e.target.value)}
        />
      </SettingRow>

      <SettingRow
        id="project-max-posts-per-page"
        label={t('settings.project.maxPostsPerPageLabel')}
        description={t('settings.project.maxPostsPerPageDescription')}
      >
        <input
          id="project-max-posts-per-page"
          type="number"
          min={1}
          max={500}
          value={projectMaxPostsPerPage}
          onChange={(e) => {
            const parsed = Number(e.target.value);
            if (!Number.isFinite(parsed)) {
              setProjectMaxPostsPerPage(50);
              return;
            }
            setProjectMaxPostsPerPage(Math.min(500, Math.max(1, Math.floor(parsed))));
          }}
        />
      </SettingRow>

      <SettingRow
        id="project-blogmark-category"
        label={t('settings.project.blogmarkCategoryLabel')}
        description={t('settings.project.blogmarkCategoryDescription')}
      >
        <select
          id="project-blogmark-category"
          value={projectBlogmarkCategory}
          onChange={(e) => setProjectBlogmarkCategory(e.target.value)}
        >
          {postCategories.map((category) => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        id="project-blogmark-bookmarklet"
        label={t('settings.project.blogmarkBookmarkletLabel')}
        description={t('settings.project.blogmarkBookmarkletDescription')}
      >
        <button className="secondary" onClick={handleCopyBlogmarkBookmarklet}>
          {t('settings.project.blogmarkBookmarkletCopyButton')}
        </button>
      </SettingRow>

      <div className="setting-actions">
        <button className="primary" onClick={handleSaveProject}>
          {t('settings.project.saveButton')}
        </button>
      </div>
    </SettingSection>
  );

  const renderEditorSettings = () => (
    <SettingSection
      id="settings-section-editor"
      title={t('settings.editor.title')}
      description={t('settings.editor.description')}
      hidden={!sectionHasMatches(editorKeywords)}
    >
      <SettingRow
        id="editor-mode"
        label={t('settings.editor.defaultModeLabel')}
        description={t('settings.editor.defaultModeDescription')}
      >
        <select
          id="editor-mode"
          value={preferredEditorMode}
          onChange={(e) => setPreferredEditorMode(e.target.value as 'wysiwyg' | 'markdown' | 'preview')}
        >
          <option value="wysiwyg">{t('settings.editor.mode.wysiwyg')}</option>
          <option value="markdown">{t('settings.editor.mode.markdown')}</option>
          <option value="preview">{t('settings.editor.mode.preview')}</option>
        </select>
      </SettingRow>

      <SettingRow
        id="diff-view-style"
        label={t('settings.editor.diffViewStyleLabel')}
        description={t('settings.editor.diffViewStyleDescription')}
      >
        <select
          id="diff-view-style"
          aria-label={t('settings.editor.diffViewStyleLabel')}
          value={gitDiffPreferences.viewStyle}
          onChange={(e) =>
            setGitDiffPreferences({
              ...gitDiffPreferences,
              viewStyle: e.target.value as 'inline' | 'side-by-side',
            })
          }
        >
          <option value="inline">{t('settings.editor.diff.inline')}</option>
          <option value="side-by-side">{t('settings.editor.diff.sideBySide')}</option>
        </select>
      </SettingRow>

      <SettingRow
        id="diff-wrap-long-lines"
        label={t('settings.editor.wrapLongLinesLabel')}
        description={t('settings.editor.wrapLongLinesDescription')}
      >
        <input
          id="diff-wrap-long-lines"
          aria-label={t('settings.editor.wrapLongLinesAria')}
          type="checkbox"
          checked={gitDiffPreferences.wordWrap}
          onChange={(e) =>
            setGitDiffPreferences({
              ...gitDiffPreferences,
              wordWrap: e.target.checked,
            })
          }
        />
      </SettingRow>

      <SettingRow
        id="diff-hide-unchanged-regions"
        label={t('settings.editor.hideUnchangedRegionsLabel')}
        description={t('settings.editor.hideUnchangedRegionsDescription')}
      >
        <input
          id="diff-hide-unchanged-regions"
          aria-label={t('settings.editor.hideUnchangedRegionsAria')}
          type="checkbox"
          checked={gitDiffPreferences.hideUnchangedRegions}
          onChange={(e) =>
            setGitDiffPreferences({
              ...gitDiffPreferences,
              hideUnchangedRegions: e.target.checked,
            })
          }
        />
      </SettingRow>
    </SettingSection>
  );

  // Handlers for post categories management
  const handleAddCategory = async () => {
    const trimmed = newCategoryInput.trim().toLowerCase();
    if (trimmed && !postCategories.includes(trimmed)) {
      try {
        const updatedCategories = await window.electronAPI?.meta.addCategory(trimmed);
        if (updatedCategories) {
          setPostCategories(updatedCategories);
        }
        const nextCategoryMetadata = {
          ...categoryMetadata,
          [trimmed]: categoryMetadata[trimmed] || { renderInLists: true, showTitle: true, title: trimmed },
        };
        setCategoryMetadata(nextCategoryMetadata);
        await window.electronAPI?.meta.updateProjectMetadata({ categoryMetadata: nextCategoryMetadata });
        setNewCategoryInput('');
        showToast.success(t('settings.toast.categoryAdded', { category: trimmed }));
      } catch (error) {
        console.error('Failed to add category:', error);
        showToast.error(t('settings.toast.categoryAddFailed'));
      }
    } else if (postCategories.includes(trimmed)) {
      showToast.error(t('settings.toast.categoryExists'));
    }
  };

  const handleRemoveCategory = async (categoryToRemove: string) => {
    if (PROTECTED_CATEGORIES.includes(categoryToRemove)) {
      showToast.error(t('settings.toast.categoryProtected', { category: categoryToRemove }));
      return;
    }
    if (postCategories.length <= 1) {
      showToast.error(t('settings.toast.categoryAtLeastOne'));
      return;
    }
    try {
      const updatedCategories = await window.electronAPI?.meta.removeCategory(categoryToRemove);
      if (updatedCategories) {
        setPostCategories(updatedCategories);
      }
      const nextCategoryMetadata = { ...categoryMetadata };
      delete nextCategoryMetadata[categoryToRemove];
      setCategoryMetadata(nextCategoryMetadata);
      await window.electronAPI?.meta.updateProjectMetadata({ categoryMetadata: nextCategoryMetadata });
      showToast.success(t('settings.toast.categoryRemoved', { category: categoryToRemove }));
    } catch (error) {
      console.error('Failed to remove category:', error);
      showToast.error(t('settings.toast.categoryRemoveFailed'));
    }
  };

  const handleResetCategories = async () => {
    try {
      // Remove non-protected categories
      const currentCategories = await window.electronAPI?.meta.getCategories() || [];
      for (const cat of currentCategories) {
        if (!PROTECTED_CATEGORIES.includes(cat)) {
          await window.electronAPI?.meta.removeCategory(cat);
        }
      }
      // Add any missing default categories
      for (const cat of DEFAULT_POST_CATEGORIES) {
        await window.electronAPI?.meta.addCategory(cat);
      }
      // Refresh the list
      const updatedCategories = await window.electronAPI?.meta.getCategories();
      setPostCategories(updatedCategories || DEFAULT_POST_CATEGORIES);
      const defaults = { ...DEFAULT_CATEGORY_METADATA };
      setCategoryMetadata(defaults);
      await window.electronAPI?.meta.updateProjectMetadata({ categoryMetadata: defaults });
      showToast.success(t('settings.toast.categoriesReset'));
    } catch (error) {
      console.error('Failed to reset categories:', error);
      showToast.error(t('settings.toast.categoriesResetFailed'));
    }
  };

  const handleCategorySettingToggle = async (
    category: string,
    field: keyof Pick<CategoryMetadata, 'renderInLists' | 'showTitle'>,
    value: boolean,
  ) => {
    const nextCategoryMetadata: Record<string, CategoryMetadata> = {
      ...categoryMetadata,
      [category]: {
        ...(categoryMetadata[category] || { renderInLists: true, showTitle: true, title: category }),
        [field]: value,
      },
    };

    setCategoryMetadata(nextCategoryMetadata);

    try {
      await window.electronAPI?.meta.updateProjectMetadata({ categoryMetadata: nextCategoryMetadata });
    } catch (error) {
      console.error('Failed to update category settings:', error);
      showToast.error(t('settings.toast.categorySettingsUpdateFailed'));
    }
  };

  const handleCategoryTitleChange = (category: string, value: string) => {
    setCategoryMetadata((current) => ({
      ...current,
      [category]: {
        ...(current[category] || { renderInLists: true, showTitle: true, title: category }),
        title: value,
      },
    }));
  };

  const persistCategoryTitle = async (category: string) => {
    const current = categoryMetadata[category] || { renderInLists: true, showTitle: true, title: category };
    const nextCategoryMetadata = {
      ...categoryMetadata,
      [category]: {
        ...current,
        title: current.title.trim().length > 0 ? current.title.trim() : category,
      },
    };

    setCategoryMetadata(nextCategoryMetadata);

    try {
      await window.electronAPI?.meta.updateProjectMetadata({ categoryMetadata: nextCategoryMetadata });
    } catch (error) {
      console.error('Failed to update category settings:', error);
      showToast.error(t('settings.toast.categorySettingsUpdateFailed'));
    }
  };

  const renderContentSettings = () => (
    <SettingSection
      id="settings-section-content"
      title={t('settings.content.title')}
      description={t('settings.content.description')}
      hidden={!sectionHasMatches(contentKeywords)}
    >
        <div className="categories-table-wrapper">
          <table className="categories-table">
            <thead>
              <tr>
                <th>{t('settings.content.categoryColumn')}</th>
                <th>{t('settings.content.titleColumn')}</th>
                <th>{t('settings.content.renderInLists')}</th>
                <th>{t('settings.content.showTitles')}</th>
                <th>{t('settings.content.actionsColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {postCategories.map((cat) => {
                const isProtected = PROTECTED_CATEGORIES.includes(cat);
                const metadata = categoryMetadata[cat] || { renderInLists: true, showTitle: true, title: cat };
                return (
                  <tr key={cat}>
                    <td className="category-name-cell">{cat}{isProtected && t('settings.content.standardSuffix')}</td>
                    <td>
                      <input
                        type="text"
                        value={metadata.title}
                        onChange={(event) => handleCategoryTitleChange(cat, event.target.value)}
                        onBlur={() => void persistCategoryTitle(cat)}
                        aria-label={t('settings.content.categoryTitleAria', { category: cat })}
                      />
                    </td>
                    <td className="category-checkbox-cell">
                      <input
                        id={`category-${cat}-render-in-lists`}
                        aria-label={t('settings.content.renderInListsAria', { category: cat })}
                        type="checkbox"
                        checked={metadata.renderInLists}
                        onChange={(event) => handleCategorySettingToggle(cat, 'renderInLists', event.target.checked)}
                      />
                    </td>
                    <td className="category-checkbox-cell">
                      <input
                        id={`category-${cat}-show-title`}
                        aria-label={t('settings.content.showTitlesAria', { category: cat })}
                        type="checkbox"
                        checked={metadata.showTitle}
                        onChange={(event) => handleCategorySettingToggle(cat, 'showTitle', event.target.checked)}
                      />
                    </td>
                    <td className="category-actions-cell">
                      {!isProtected && (
                        <button
                          className="category-remove"
                          onClick={() => handleRemoveCategory(cat)}
                          title={t('settings.content.removeCategoryTitle', { category: cat })}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="category-add-form">
          <input
            type="text"
            placeholder={t('settings.content.newCategoryPlaceholder')}
            value={newCategoryInput}
            onChange={(e) => setNewCategoryInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddCategory();
              }
            }}
          />
          <button className="primary" onClick={handleAddCategory}>
            {t('settings.content.addCategory')}
          </button>
        </div>

        <div className="setting-actions">
          <button className="secondary" onClick={handleResetCategories}>
            {t('settings.content.resetDefaults')}
          </button>
        </div>
    </SettingSection>
  );

  // AI Assistant handlers
  const handleSaveSystemPrompt = async () => {
    try {
      const result = await window.electronAPI?.chat.setSystemPrompt(aiSystemPrompt);
      if (result?.success) {
        setAiSystemPromptModified(false);
        showToast.success(t('settings.toast.systemPromptSaved'));
      } else {
        showToast.error(t('settings.toast.systemPromptSaveFailed'));
      }
    } catch (error) {
      console.error('Failed to save system prompt:', error);
      showToast.error(t('settings.toast.systemPromptSaveFailed'));
    }
  };

  const handleResetSystemPrompt = async () => {
    try {
      // Set to empty to use built-in default
      await window.electronAPI?.chat.setSystemPrompt('');
      const result = await window.electronAPI?.chat.getSystemPrompt();
      if (result?.success) {
        setAiSystemPrompt(result.prompt || '');
        setAiSystemPromptModified(false);
        showToast.success(t('settings.toast.systemPromptReset'));
      }
    } catch (error) {
      console.error('Failed to reset system prompt:', error);
      showToast.error(t('settings.toast.systemPromptResetFailed'));
    }
  };

  const handleSaveApiKey = async () => {
    if (!newApiKey.trim()) return;
    try {
      const validateResult = await window.electronAPI?.chat.validateApiKey(newApiKey.trim());
      if (validateResult?.isValid) {
        await window.electronAPI?.chat.setApiKey(newApiKey.trim());
        setAiHasApiKey(true);
        setAiApiKeyMasked('•'.repeat(Math.max(0, newApiKey.length - 4)) + newApiKey.slice(-4));
        setNewApiKey('');
        showToast.success(t('settings.toast.apiKeySaved'));
      } else {
        showToast.error(t('settings.toast.apiKeyInvalid'));
      }
    } catch (error) {
      console.error('Failed to save API key:', error);
      showToast.error(t('settings.toast.apiKeySaveFailed'));
    }
  };

  const handleModelChange = async (modelId: string) => {
    try {
      const result = await window.electronAPI?.chat.setDefaultModel(modelId);
      if (result?.success) {
        setSelectedModel(modelId);
        showToast.success(t('settings.toast.defaultModelUpdated'));
      }
    } catch (error) {
      console.error('Failed to set model:', error);
      showToast.error(t('settings.toast.defaultModelUpdateFailed'));
    }
  };

  const renderAISettings = () => (
    <SettingSection
      id="settings-section-ai"
      title={t('settings.ai.title')}
      description={t('settings.ai.description')}
      hidden={!sectionHasMatches(aiKeywords)}
    >
      <SettingRow
        id="ai-api-key"
        label={t('settings.ai.apiKeyLabel')}
        description={t('settings.ai.apiKeyDescription')}
      >
        <div className="setting-input-group">
          {aiHasApiKey ? (
            <>
              <input
                id="ai-api-key"
                type="text"
                value={aiApiKeyMasked}
                disabled
                placeholder={t('settings.ai.apiKeyConfigured')}
              />
              <span className="setting-status-badge success">{t('settings.ai.configured')}</span>
            </>
          ) : (
            <>
              <input
                id="ai-api-key"
                type="password"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder={t('chat.apiKeyPlaceholder')}
              />
              <button className="primary" onClick={handleSaveApiKey} disabled={!newApiKey.trim()}>
                {t('chat.apiKeySave')}
              </button>
            </>
          )}
        </div>
        {aiHasApiKey && (
          <div className="setting-inline-action">
            <button className="text-button" onClick={() => { setAiHasApiKey(false); setAiApiKeyMasked(''); }}>
              {t('settings.ai.changeApiKey')}
            </button>
          </div>
        )}
      </SettingRow>

      <SettingRow
        id="ai-model"
        label={t('settings.ai.defaultModelLabel')}
        description={t('settings.ai.defaultModelDescription')}
      >
        <select
          id="ai-model"
          value={selectedModel}
          onChange={(e) => handleModelChange(e.target.value)}
          disabled={!aiHasApiKey}
        >
          {availableModels.length === 0 && <option value="">{t('settings.ai.noModels')}</option>}
          {availableModels.map(model => (
            <option key={model.id} value={model.id}>{model.name}</option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        id="ai-system-prompt"
        label={t('settings.ai.systemPromptLabel')}
        description={t('settings.ai.systemPromptDescription')}
      >
        <textarea
          id="ai-system-prompt"
          value={aiSystemPrompt}
          onChange={(e) => {
            setAiSystemPrompt(e.target.value);
            setAiSystemPromptModified(true);
          }}
          placeholder={t('settings.ai.systemPromptPlaceholder')}
          rows={12}
          className="system-prompt-textarea"
        />
        <div className="setting-actions">
          <button
            className="primary"
            onClick={handleSaveSystemPrompt}
            disabled={!aiSystemPromptModified}
          >
            {t('settings.ai.savePrompt')}
          </button>
          <button className="secondary" onClick={handleResetSystemPrompt}>
            {t('settings.ai.resetPrompt')}
          </button>
        </div>
      </SettingRow>
    </SettingSection>
  );

  const renderTechnologySettings = () => (
    <SettingSection
      id="settings-section-technology"
      title={t('settings.technology.title')}
      description={t('settings.technology.description')}
      hidden={!sectionHasMatches(technologyKeywords)}
    >
      <SettingRow
        id="project-python-runtime-mode"
        label={t('settings.technology.pythonRuntimeModeLabel')}
        description={t('settings.technology.pythonRuntimeModeDescription')}
      >
        <select
          id="project-python-runtime-mode"
          value={projectPythonRuntimeMode}
          onChange={(event) => setProjectPythonRuntimeMode(event.target.value as 'webworker' | 'main-thread')}
        >
          <option value="webworker">{t('settings.technology.pythonRuntimeMode.webworker')}</option>
          <option value="main-thread">{t('settings.technology.pythonRuntimeMode.mainThread')}</option>
        </select>
      </SettingRow>
    </SettingSection>
  );

  const renderPublishingSettings = () => (
    <SettingSection
      id="settings-section-publishing"
      title={t('settings.publishing.sshTitle')}
      description={t('credentials.ssh.description')}
      hidden={!sectionHasMatches(publishingKeywords)}
    >
      <div className="setting-info-banner">
        <p>{t('settings.publishing.sshKeyAuthNotice')}</p>
      </div>

      <SettingRow
        id="ssh-mode"
        label={t('settings.publishing.sshModeLabel')}
        description={t('settings.publishing.sshModeDescription')}
      >
        <select
          id="ssh-mode"
          value={credentials.sshMode}
          onChange={(e) => setCredentials({ ...credentials, sshMode: e.target.value as 'scp' | 'rsync' })}
        >
          <option value="scp">{t('settings.publishing.sshMode.scp')}</option>
          <option value="rsync">{t('settings.publishing.sshMode.rsync')}</option>
        </select>
      </SettingRow>

      <SettingRow
        id="ssh-host"
        label={t('credentials.field.host')}
        description={t('settings.publishing.sshHostDescription')}
      >
        <input
          id="ssh-host"
          type="text"
          placeholder={t('credentials.ssh.placeholder.host')}
          value={credentials.sshHost}
          onChange={(e) => setCredentials({ ...credentials, sshHost: e.target.value })}
        />
      </SettingRow>

      <SettingRow
        id="ssh-user"
        label={t('credentials.field.username')}
        description={t('settings.publishing.sshUsernameDescription')}
      >
        <input
          id="ssh-user"
          type="text"
          placeholder={t('credentials.ssh.placeholder.username')}
          value={credentials.sshUser}
          onChange={(e) => setCredentials({ ...credentials, sshUser: e.target.value })}
        />
      </SettingRow>

      <SettingRow
        id="ssh-remote-path"
        label={t('credentials.field.sshRemotePath')}
        description={t('settings.publishing.sshRemotePathDescription')}
      >
        <input
          id="ssh-remote-path"
          type="text"
          placeholder={t('credentials.ssh.placeholder.remotePath')}
          value={credentials.sshRemotePath}
          onChange={(e) => setCredentials({ ...credentials, sshRemotePath: e.target.value })}
        />
      </SettingRow>

      <div className="setting-actions">
        <button className="primary" onClick={handleSavePublishing}>{t('common.save')}</button>
        <button className="secondary danger" onClick={handleClearCredentials}>{t('common.clear')}</button>
      </div>
    </SettingSection>
  );

  const renderDataSettings = () => (
    <>
      <SettingSection
        id="settings-section-data"
        title={t('settings.data.title')}
        description={t('settings.data.description')}
        hidden={!sectionHasMatches(dataKeywords)}
      >
        <SettingRow
          id="rebuild-posts"
          label={t('settings.data.rebuildPostsLabel')}
          description={t('settings.data.rebuildPostsDescription')}
        >
          <button
            className="secondary"
            onClick={async () => {
              showToast.loading(t('settings.toast.rebuildPostsLoading'));
              try {
                await window.electronAPI?.posts.rebuildFromFiles();
                const postsResult = await window.electronAPI?.posts.getAll({ limit: 500, offset: 0 });
                if (postsResult) {
                  useAppStore.getState().setPosts(postsResult.items, postsResult.hasMore, postsResult.total);
                }
                showToast.dismiss();
                showToast.success(t('settings.toast.rebuildPostsSuccess'));
              } catch {
                showToast.dismiss();
                showToast.error(t('settings.toast.rebuildPostsFailed'));
              }
            }}
          >
            {t('settings.data.rebuildPostsAction')}
          </button>
        </SettingRow>

        <SettingRow
          id="rebuild-media"
          label={t('settings.data.rebuildMediaLabel')}
          description={t('settings.data.rebuildMediaDescription')}
        >
          <button
            className="secondary"
            onClick={async () => {
              showToast.loading(t('settings.toast.rebuildMediaLoading'));
              try {
                await window.electronAPI?.media.rebuildFromFiles();
                const media = await window.electronAPI?.media.getAll();
                if (media) {
                  useAppStore.getState().setMedia(media as any[]);
                }
                showToast.dismiss();
                showToast.success(t('settings.toast.rebuildMediaSuccess'));
              } catch {
                showToast.dismiss();
                showToast.error(t('settings.toast.rebuildMediaFailed'));
              }
            }}
          >
            {t('settings.data.rebuildMediaAction')}
          </button>
        </SettingRow>

        <SettingRow
          id="rebuild-scripts"
          label={t('settings.data.rebuildScriptsLabel')}
          description={t('settings.data.rebuildScriptsDescription')}
        >
          <button
            className="secondary"
            onClick={async () => {
              showToast.loading(t('settings.toast.rebuildScriptsLoading'));
              try {
                await window.electronAPI?.scripts.rebuildFromFiles();
                showToast.dismiss();
                showToast.success(t('settings.toast.rebuildScriptsSuccess'));
              } catch {
                showToast.dismiss();
                showToast.error(t('settings.toast.rebuildScriptsFailed'));
              }
            }}
          >
            {t('settings.data.rebuildScriptsAction')}
          </button>
        </SettingRow>

        <SettingRow
          id="rebuild-links"
          label={t('settings.data.rebuildLinksLabel')}
          description={t('settings.data.rebuildLinksDescription')}
        >
          <button
            className="secondary"
            onClick={async () => {
              showToast.loading(t('settings.toast.rebuildLinksLoading'));
              try {
                await window.electronAPI?.posts.rebuildLinks();
                showToast.dismiss();
                showToast.success(t('settings.toast.rebuildLinksSuccess'));
              } catch {
                showToast.dismiss();
                showToast.error(t('settings.toast.rebuildLinksFailed'));
              }
            }}
          >
            {t('settings.data.rebuildLinksAction')}
          </button>
        </SettingRow>

        <SettingRow
          id="regenerate-thumbnails"
          label={t('settings.data.regenerateThumbnailsLabel')}
          description={t('settings.data.regenerateThumbnailsDescription')}
        >
          <button
            className="secondary"
            onClick={async () => {
              showToast.loading(t('settings.toast.thumbnailsLoading'));
              try {
                const result = await window.electronAPI?.media.regenerateMissingThumbnails();
                showToast.dismiss();
                if (result && result.generated > 0) {
                  showToast.success(t('settings.toast.thumbnailsGenerated', { count: result.generated }));
                } else if (result && result.processed === 0) {
                  showToast.success(t('settings.toast.thumbnailsAlreadyExist'));
                } else {
                  showToast.success(t('settings.toast.thumbnailsComplete'));
                }
              } catch {
                showToast.dismiss();
                showToast.error(t('settings.toast.thumbnailsFailed'));
              }
            }}
          >
            {t('settings.data.regenerateThumbnailsAction')}
          </button>
        </SettingRow>
      </SettingSection>

      <SettingSection
        title={t('settings.data.fileSystemTitle')}
        description={t('settings.data.fileSystemDescription')}
        hidden={!sectionHasMatches(dataKeywords)}
      >
        <SettingRow
          id="open-data"
          label={t('settings.data.openDataFolderLabel')}
          description={t('settings.data.openDataFolderDescription')}
        >
          <button
            className="secondary"
            onClick={async () => {
              const paths = await window.electronAPI?.app.getDataPaths();
              if (paths) {
                window.electronAPI?.app.openFolder(paths.posts);
              }
            }}
          >
            {t('settings.data.openFolderAction')}
          </button>
        </SettingRow>
      </SettingSection>
    </>
  );

  // Check if any results match the search
  const hasAnyMatches = !searchQuery ||
    sectionHasMatches(projectKeywords) ||
    sectionHasMatches(editorKeywords) ||
    sectionHasMatches(contentKeywords) ||
    sectionHasMatches(aiKeywords) ||
    sectionHasMatches(technologyKeywords) ||
    sectionHasMatches(publishingKeywords) ||
    sectionHasMatches(dataKeywords);

  return (
    <div className="settings-view">
      {/* Header with search */}
      <div className="settings-header">
        <h2>{t('common.settings')}</h2>
        <div className="settings-search">
          <span className="settings-search-icon"><SearchIcon /></span>
          <input
            type="text"
            placeholder={t('settings.search.placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="settings-search-clear"
              onClick={() => setSearchQuery('')}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Settings content - all sections in scrollable list */}
      <div className="settings-content" ref={contentRef}>
        {hasAnyMatches ? (
          <>
            {renderProjectSettings()}
            {renderEditorSettings()}
            {renderContentSettings()}
            {renderAISettings()}
            {renderTechnologySettings()}
            {renderPublishingSettings()}
            {renderDataSettings()}
          </>
        ) : (
          <div className="settings-no-results">
            <p>{t('settings.search.noResults', { query: searchQuery })}</p>
            <button onClick={() => setSearchQuery('')}>{t('settings.search.clear')}</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsView;
