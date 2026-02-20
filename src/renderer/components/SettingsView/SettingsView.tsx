import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../store';
import { showToast } from '../Toast';
import './SettingsView.css';

// Export category IDs for sidebar navigation
export type SettingsCategory = 'project' | 'editor' | 'content' | 'ai' | 'publishing' | 'data';

// Scroll to a settings section by category ID
export const scrollToSettingsSection = (category: SettingsCategory) => {
  const element = document.getElementById(`settings-section-${category}`);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

// Settings categories

interface Credentials {
  // FTP Publishing
  ftpHost: string;
  ftpUser: string;
  ftpPassword: string;
  // SSH Publishing
  sshHost: string;
  sshUser: string;
  sshKeyPath: string;
}

interface CategoryRenderSettings {
  renderInLists: boolean;
  showTitle: boolean;
}

const defaultCredentials: Credentials = {
  ftpHost: '',
  ftpUser: '',
  ftpPassword: '',
  sshHost: '',
  sshUser: '',
  sshKeyPath: '',
};

// Search icon for the search bar
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M15.25 0a.75.75 0 0 1 .53.22.75.75 0 0 1 0 1.06l-3.25 3.25A6.5 6.5 0 1 1 11.47 3.47l3.25-3.25A.75.75 0 0 1 15.25 0zM6.5 12a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11z"/>
  </svg>
);

// Default post categories based on VISION.md
const DEFAULT_POST_CATEGORIES = ['article', 'picture', 'aside', 'page'];

const DEFAULT_CATEGORY_SETTINGS: Record<string, CategoryRenderSettings> = {
  article: { renderInLists: true, showTitle: true },
  picture: { renderInLists: true, showTitle: true },
  aside: { renderInLists: true, showTitle: false },
  page: { renderInLists: false, showTitle: true },
};

// Standard categories that cannot be deleted
const PROTECTED_CATEGORIES = ['article', 'aside', 'page', 'picture'];

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
  const [showSecrets, setShowSecrets] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Project settings
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectDataPath, setProjectDataPath] = useState('');
  const [projectPublicUrl, setProjectPublicUrl] = useState('');
  const [defaultProjectPath, setDefaultProjectPath] = useState('');
  const [projectMainLanguage, setProjectMainLanguage] = useState('en');
  const [projectDefaultAuthor, setProjectDefaultAuthor] = useState('');
  const [projectMaxPostsPerPage, setProjectMaxPostsPerPage] = useState(50);

  // Post categories management
  const [postCategories, setPostCategories] = useState<string[]>(DEFAULT_POST_CATEGORIES);
  const [categorySettings, setCategorySettings] = useState<Record<string, CategoryRenderSettings>>(DEFAULT_CATEGORY_SETTINGS);
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
          setProjectMainLanguage(metadata.mainLanguage);
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

        const incomingCategorySettings = (metadata as any)?.categorySettings as Record<string, CategoryRenderSettings> | undefined;
        setCategorySettings((current) => {
          const merged = { ...DEFAULT_CATEGORY_SETTINGS, ...current };
          if (incomingCategorySettings && typeof incomingCategorySettings === 'object') {
            for (const [category, settings] of Object.entries(incomingCategorySettings)) {
              merged[category] = {
                renderInLists: settings?.renderInLists !== false,
                showTitle: settings?.showTitle !== false,
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
        const savedCreds = localStorage.getItem('bds-credentials');
        if (savedCreds) {
          setCredentials({ ...defaultCredentials, ...JSON.parse(savedCreds) });
        }

        // Load categories from backend (project-scoped)
        const categories = await window.electronAPI?.meta.getCategories();
        if (categories && categories.length > 0) {
          setPostCategories(categories);
          setCategorySettings((current) => {
            const next = { ...DEFAULT_CATEGORY_SETTINGS, ...current };
            for (const category of categories) {
              if (!next[category]) {
                next[category] = { renderInLists: true, showTitle: true };
              }
            }
            return next;
          });
        } else {
          // Initialize with defaults if no categories exist
          setPostCategories(DEFAULT_POST_CATEGORIES);
          setCategorySettings(DEFAULT_CATEGORY_SETTINGS);
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
      localStorage.setItem('bds-credentials', JSON.stringify(credentials));
      showToast.success('Publishing credentials saved');
    } catch (error) {
      console.error('Failed to save publishing credentials:', error);
      showToast.error('Failed to save credentials');
    }
  };

  const handleClearCredentials = (type: 'ftp' | 'ssh') => {
    const newCreds = { ...credentials };
    switch (type) {
      case 'ftp':
        newCreds.ftpHost = '';
        newCreds.ftpUser = '';
        newCreds.ftpPassword = '';
        break;
      case 'ssh':
        newCreds.sshHost = '';
        newCreds.sshUser = '';
        newCreds.sshKeyPath = '';
        break;
    }
    setCredentials(newCreds);
    localStorage.setItem('bds-credentials', JSON.stringify(newCreds));
    showToast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} credentials cleared`);
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
          mainLanguage: projectMainLanguage,
          defaultAuthor: projectDefaultAuthor.trim() || undefined,
          maxPostsPerPage: Math.min(500, Math.max(1, Math.floor(projectMaxPostsPerPage || 50))),
          categorySettings,
        });
      }
      showToast.success('Project settings saved');
    } catch (error) {
      console.error('Failed to save project settings:', error);
      showToast.error('Failed to save project settings');
    }
  };

  const handleBrowseDataPath = async () => {
    const selected = await window.electronAPI?.app.selectFolder('Select Project Data Folder');
    if (selected) {
      setProjectDataPath(selected);
    }
  };

  const handleResetDataPath = () => {
    setProjectDataPath('');
  };

  // Keywords for each section for search filtering
  const projectKeywords = ['project', 'name', 'description', 'blog', 'site', 'url', 'public', 'path', 'folder', 'location', 'data', 'language', 'author', 'default', 'preview', 'max', 'posts', 'page'];
  const editorKeywords = ['editor', 'mode', 'wysiwyg', 'markdown', 'preview', 'visual'];
  const contentKeywords = ['content', 'categories', 'post', 'article', 'picture', 'aside', 'page'];
  const aiKeywords = ['ai', 'assistant', 'chat', 'model', 'prompt', 'system', 'api', 'key', 'claude', 'gpt', 'opencode'];
  const publishingKeywords = ['publishing', 'ftp', 'ssh', 'deploy', 'server', 'host', 'upload'];
  const dataKeywords = ['data', 'database', 'rebuild', 'maintenance', 'posts', 'media', 'links', 'folder', 'filesystem'];

  const renderProjectSettings = () => (
    <SettingSection
      id="settings-section-project"
      title="Project"
      description="General settings for the active blog project."
      hidden={!sectionHasMatches(projectKeywords)}
    >
      <SettingRow
        id="project-name"
        label="Project Name"
        description="The display name of your blog project."
      >
        <input
          id="project-name"
          type="text"
          placeholder="My Blog"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
        />
      </SettingRow>

      <SettingRow
        id="project-description"
        label="Description"
        description="A short description of your blog. This can be used in templates and metadata."
      >
        <textarea
          id="project-description"
          placeholder="A blog about..."
          value={projectDescription}
          onChange={(e) => setProjectDescription(e.target.value)}
          rows={3}
        />
      </SettingRow>

      <SettingRow
        id="project-datapath"
        label="Project Data Path"
        description={`Custom folder for storing posts, media, and metadata. Leave empty to use the default location: ${defaultProjectPath}`}
      >
        <div className="setting-input-group">
          <input
            id="project-datapath"
            type="text"
            placeholder={defaultProjectPath || 'Default location'}
            value={projectDataPath}
            onChange={(e) => setProjectDataPath(e.target.value)}
          />
          <button className="secondary" onClick={handleBrowseDataPath} title="Browse...">
            Browse
          </button>
          {projectDataPath && (
            <button className="secondary" onClick={handleResetDataPath} title="Reset to default">
              Reset
            </button>
          )}
        </div>
      </SettingRow>

      <SettingRow
        id="project-public-url"
        label="Public URL"
        description="The public base URL of your published blog (used for sitemap generation)."
      >
        <input
          id="project-public-url"
          type="url"
          placeholder="https://example.com"
          value={projectPublicUrl}
          onChange={(e) => setProjectPublicUrl(e.target.value)}
        />
      </SettingRow>

      <SettingRow
        id="project-language"
        label="Main Language"
        description="The primary language for your blog content. AI-generated titles, alt text, and captions will use this language."
      >
        <select
          id="project-language"
          value={projectMainLanguage}
          onChange={(e) => setProjectMainLanguage(e.target.value)}
        >
          <option value="en">English</option>
          <option value="de">German (Deutsch)</option>
          <option value="es">Spanish (Español)</option>
          <option value="fr">French (Français)</option>
          <option value="it">Italian (Italiano)</option>
          <option value="pt">Portuguese (Português)</option>
          <option value="nl">Dutch (Nederlands)</option>
          <option value="pl">Polish (Polski)</option>
          <option value="ru">Russian (Русский)</option>
          <option value="ja">Japanese (日本語)</option>
          <option value="zh">Chinese (中文)</option>
          <option value="ko">Korean (한국어)</option>
          <option value="ar">Arabic (العربية)</option>
          <option value="hi">Hindi (हिन्दी)</option>
          <option value="tr">Turkish (Türkçe)</option>
          <option value="sv">Swedish (Svenska)</option>
          <option value="da">Danish (Dansk)</option>
          <option value="no">Norwegian (Norsk)</option>
          <option value="fi">Finnish (Suomi)</option>
          <option value="cs">Czech (Čeština)</option>
        </select>
      </SettingRow>

      <SettingRow
        id="project-author"
        label="Default Author"
        description="The default author name for new posts and media. Can be overridden per item."
      >
        <input
          id="project-author"
          type="text"
          placeholder="Author Name"
          value={projectDefaultAuthor}
          onChange={(e) => setProjectDefaultAuthor(e.target.value)}
        />
      </SettingRow>

      <SettingRow
        id="project-max-posts-per-page"
        label="Max Posts Per Page"
        description="Maximum number of posts shown per preview route page."
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

      <div className="setting-actions">
        <button className="primary" onClick={handleSaveProject}>
          Save Project Settings
        </button>
      </div>
    </SettingSection>
  );

  const renderEditorSettings = () => (
    <SettingSection
      id="settings-section-editor"
      title="Editor"
      description="Configure the blog post editor behavior and appearance."
      hidden={!sectionHasMatches(editorKeywords)}
    >
      <SettingRow
        id="editor-mode"
        label="Default Editor Mode"
        description="Choose the default mode when opening posts. You can switch modes at any time using the editor toolbar."
      >
        <select
          id="editor-mode"
          value={preferredEditorMode}
          onChange={(e) => setPreferredEditorMode(e.target.value as 'wysiwyg' | 'markdown' | 'preview')}
        >
          <option value="wysiwyg">WYSIWYG (Visual Editor)</option>
          <option value="markdown">Markdown (Source)</option>
          <option value="preview">Preview (Read-only)</option>
        </select>
      </SettingRow>

      <SettingRow
        id="diff-view-style"
        label="Diff View Style"
        description="Choose how Git diffs are shown by default."
      >
        <select
          id="diff-view-style"
          aria-label="Diff View Style"
          value={gitDiffPreferences.viewStyle}
          onChange={(e) =>
            setGitDiffPreferences({
              ...gitDiffPreferences,
              viewStyle: e.target.value as 'inline' | 'side-by-side',
            })
          }
        >
          <option value="inline">Inline</option>
          <option value="side-by-side">Side by Side</option>
        </select>
      </SettingRow>

      <SettingRow
        id="diff-wrap-long-lines"
        label="Wrap Long Lines in Diff"
        description="Enable word wrapping for long lines in Git diffs."
      >
        <input
          id="diff-wrap-long-lines"
          aria-label="Wrap long lines in diff"
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
        label="Hide Unchanged Regions"
        description="Collapse unchanged regions in Git diffs."
      >
        <input
          id="diff-hide-unchanged-regions"
          aria-label="Hide unchanged regions"
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
        const nextSettings = {
          ...categorySettings,
          [trimmed]: categorySettings[trimmed] || { renderInLists: true, showTitle: true },
        };
        setCategorySettings(nextSettings);
        await window.electronAPI?.meta.updateProjectMetadata({ categorySettings: nextSettings });
        setNewCategoryInput('');
        showToast.success(`Category "${trimmed}" added`);
      } catch (error) {
        console.error('Failed to add category:', error);
        showToast.error('Failed to add category');
      }
    } else if (postCategories.includes(trimmed)) {
      showToast.error('Category already exists');
    }
  };

  const handleRemoveCategory = async (categoryToRemove: string) => {
    if (PROTECTED_CATEGORIES.includes(categoryToRemove)) {
      showToast.error(`Cannot delete standard category "${categoryToRemove}"`);
      return;
    }
    if (postCategories.length <= 1) {
      showToast.error('Must have at least one category');
      return;
    }
    try {
      const updatedCategories = await window.electronAPI?.meta.removeCategory(categoryToRemove);
      if (updatedCategories) {
        setPostCategories(updatedCategories);
      }
      const nextSettings = { ...categorySettings };
      delete nextSettings[categoryToRemove];
      setCategorySettings(nextSettings);
      await window.electronAPI?.meta.updateProjectMetadata({ categorySettings: nextSettings });
      showToast.success(`Category "${categoryToRemove}" removed`);
    } catch (error) {
      console.error('Failed to remove category:', error);
      showToast.error('Failed to remove category');
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
      const defaults = { ...DEFAULT_CATEGORY_SETTINGS };
      setCategorySettings(defaults);
      await window.electronAPI?.meta.updateProjectMetadata({ categorySettings: defaults });
      showToast.success('Categories reset to defaults');
    } catch (error) {
      console.error('Failed to reset categories:', error);
      showToast.error('Failed to reset categories');
    }
  };

  const handleCategorySettingToggle = async (
    category: string,
    field: keyof CategoryRenderSettings,
    value: boolean,
  ) => {
    const nextSettings: Record<string, CategoryRenderSettings> = {
      ...categorySettings,
      [category]: {
        ...(categorySettings[category] || { renderInLists: true, showTitle: true }),
        [field]: value,
      },
    };

    setCategorySettings(nextSettings);

    try {
      await window.electronAPI?.meta.updateProjectMetadata({ categorySettings: nextSettings });
    } catch (error) {
      console.error('Failed to update category settings:', error);
      showToast.error('Failed to update category settings');
    }
  };

  const renderContentSettings = () => (
    <SettingSection
      id="settings-section-content"
      title="Post Categories"
      description="Manage the available categories for blog posts. Each post can have one category that determines its display template."
      hidden={!sectionHasMatches(contentKeywords)}
    >
        <div className="categories-list">
          {postCategories.map((cat) => {
            const isProtected = PROTECTED_CATEGORIES.includes(cat);
            const setting = categorySettings[cat] || { renderInLists: true, showTitle: true };
            return (
            <div key={cat} className="category-item">
              <span className="category-name">{cat}{isProtected && ' (standard)'}</span>
              <div className="category-settings-controls">
                <label className="category-setting-toggle" htmlFor={`category-${cat}-render-in-lists`}>
                  <input
                    id={`category-${cat}-render-in-lists`}
                    aria-label={`${cat} render in lists`}
                    type="checkbox"
                    checked={setting.renderInLists}
                    onChange={(event) => handleCategorySettingToggle(cat, 'renderInLists', event.target.checked)}
                  />
                  <span>Render in lists</span>
                </label>
                <label className="category-setting-toggle" htmlFor={`category-${cat}-show-title`}>
                  <input
                    id={`category-${cat}-show-title`}
                    aria-label={`${cat} show titles`}
                    type="checkbox"
                    checked={setting.showTitle}
                    onChange={(event) => handleCategorySettingToggle(cat, 'showTitle', event.target.checked)}
                  />
                  <span>Show titles</span>
                </label>
              </div>
              {!isProtected && (
              <button
                className="category-remove"
                onClick={() => handleRemoveCategory(cat)}
                title={`Remove "${cat}" category`}
              >
                ✕
              </button>
              )}
            </div>
            );
          })}
        </div>

        <div className="category-add-form">
          <input
            type="text"
            placeholder="New category name..."
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
            Add Category
          </button>
        </div>

        <div className="setting-actions">
          <button className="secondary" onClick={handleResetCategories}>
            Reset to Defaults
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
        showToast.success('System prompt saved');
      } else {
        showToast.error('Failed to save system prompt');
      }
    } catch (error) {
      console.error('Failed to save system prompt:', error);
      showToast.error('Failed to save system prompt');
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
        showToast.success('System prompt reset to default');
      }
    } catch (error) {
      console.error('Failed to reset system prompt:', error);
      showToast.error('Failed to reset system prompt');
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
        showToast.success('API key saved and validated');
      } else {
        showToast.error('Invalid API key');
      }
    } catch (error) {
      console.error('Failed to save API key:', error);
      showToast.error('Failed to save API key');
    }
  };

  const handleModelChange = async (modelId: string) => {
    try {
      const result = await window.electronAPI?.chat.setDefaultModel(modelId);
      if (result?.success) {
        setSelectedModel(modelId);
        showToast.success('Default model updated');
      }
    } catch (error) {
      console.error('Failed to set model:', error);
      showToast.error('Failed to set default model');
    }
  };

  const renderAISettings = () => (
    <SettingSection
      id="settings-section-ai"
      title="AI Assistant"
      description="Configure the AI chat assistant that helps you manage your blog content."
      hidden={!sectionHasMatches(aiKeywords)}
    >
      <SettingRow
        id="ai-api-key"
        label="OpenCode API Key"
        description="Your API key for the OpenCode Zen gateway. Required to use AI features."
      >
        <div className="setting-input-group">
          {aiHasApiKey ? (
            <>
              <input
                id="ai-api-key"
                type="text"
                value={aiApiKeyMasked}
                disabled
                placeholder="API key configured"
              />
              <span className="setting-status-badge success">✓ Configured</span>
            </>
          ) : (
            <>
              <input
                id="ai-api-key"
                type="password"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="Enter your API key..."
              />
              <button className="primary" onClick={handleSaveApiKey} disabled={!newApiKey.trim()}>
                Save Key
              </button>
            </>
          )}
        </div>
        {aiHasApiKey && (
          <div className="setting-inline-action">
            <button className="text-button" onClick={() => { setAiHasApiKey(false); setAiApiKeyMasked(''); }}>
              Change API Key
            </button>
          </div>
        )}
      </SettingRow>

      <SettingRow
        id="ai-model"
        label="Default Model"
        description="The AI model to use for new chat conversations."
      >
        <select
          id="ai-model"
          value={selectedModel}
          onChange={(e) => handleModelChange(e.target.value)}
          disabled={!aiHasApiKey}
        >
          {availableModels.length === 0 && <option value="">No models available</option>}
          {availableModels.map(model => (
            <option key={model.id} value={model.id}>{model.name}</option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        id="ai-system-prompt"
        label="System Prompt"
        description="Instructions given to the AI at the start of each conversation. This defines how the assistant behaves and what tools it knows about."
      >
        <textarea
          id="ai-system-prompt"
          value={aiSystemPrompt}
          onChange={(e) => {
            setAiSystemPrompt(e.target.value);
            setAiSystemPromptModified(true);
          }}
          placeholder="Enter system instructions for the AI assistant..."
          rows={12}
          className="system-prompt-textarea"
        />
        <div className="setting-actions">
          <button
            className="primary"
            onClick={handleSaveSystemPrompt}
            disabled={!aiSystemPromptModified}
          >
            Save Prompt
          </button>
          <button className="secondary" onClick={handleResetSystemPrompt}>
            Reset to Default
          </button>
        </div>
      </SettingRow>
    </SettingSection>
  );

  const renderPublishingSettings = () => (
    <>
      <SettingSection
        id="settings-section-publishing"
        title="FTP Publishing"
        description="Configure FTP credentials for publishing your blog to a web server."
        hidden={!sectionHasMatches(publishingKeywords)}
      >
        <SettingRow
          id="ftp-host"
          label="Host"
          description="The FTP server hostname or IP address."
        >
          <input
            id="ftp-host"
            type="text"
            placeholder="ftp.example.com"
            value={credentials.ftpHost}
            onChange={(e) => setCredentials({ ...credentials, ftpHost: e.target.value })}
          />
        </SettingRow>

        <SettingRow
          id="ftp-user"
          label="Username"
          description="Your FTP account username."
        >
          <input
            id="ftp-user"
            type="text"
            placeholder="ftp-user"
            value={credentials.ftpUser}
            onChange={(e) => setCredentials({ ...credentials, ftpUser: e.target.value })}
          />
        </SettingRow>

        <SettingRow
          id="ftp-password"
          label="Password"
          description="Your FTP account password."
        >
          <div className="setting-input-group">
            <input
              id="ftp-password"
              type={showSecrets ? 'text' : 'password'}
              placeholder="Password"
              value={credentials.ftpPassword}
              onChange={(e) => setCredentials({ ...credentials, ftpPassword: e.target.value })}
            />
            <button
              className="setting-toggle-visibility"
              onClick={() => setShowSecrets(!showSecrets)}
              title={showSecrets ? 'Hide password' : 'Show password'}
            >
              {showSecrets ? '🔒' : '👁'}
            </button>
          </div>
        </SettingRow>

        <div className="setting-actions">
          <button className="primary" onClick={handleSavePublishing}>Save</button>
          <button className="secondary danger" onClick={() => handleClearCredentials('ftp')}>Clear</button>
        </div>
      </SettingSection>

      <SettingSection
        title="SSH Publishing"
        description="Configure SSH credentials for secure deployment to your server."
        hidden={!sectionHasMatches(publishingKeywords)}
      >
        <SettingRow
          id="ssh-host"
          label="Host"
          description="The SSH server hostname or IP address."
        >
          <input
            id="ssh-host"
            type="text"
            placeholder="server.example.com"
            value={credentials.sshHost}
            onChange={(e) => setCredentials({ ...credentials, sshHost: e.target.value })}
          />
        </SettingRow>

        <SettingRow
          id="ssh-user"
          label="Username"
          description="Your SSH account username."
        >
          <input
            id="ssh-user"
            type="text"
            placeholder="ssh-user"
            value={credentials.sshUser}
            onChange={(e) => setCredentials({ ...credentials, sshUser: e.target.value })}
          />
        </SettingRow>

        <SettingRow
          id="ssh-keypath"
          label="SSH Key Path"
          description="Path to your SSH private key file."
        >
          <input
            id="ssh-keypath"
            type="text"
            placeholder="~/.ssh/id_rsa"
            value={credentials.sshKeyPath}
            onChange={(e) => setCredentials({ ...credentials, sshKeyPath: e.target.value })}
          />
        </SettingRow>

        <div className="setting-actions">
          <button className="primary" onClick={handleSavePublishing}>Save</button>
          <button className="secondary danger" onClick={() => handleClearCredentials('ssh')}>Clear</button>
        </div>
      </SettingSection>
    </>
  );

  const renderDataSettings = () => (
    <>
      <SettingSection
        id="settings-section-data"
        title="Database Maintenance"
        description="Rebuild the local database index from source files. Useful if post or media files were edited externally."
        hidden={!sectionHasMatches(dataKeywords)}
      >
        <SettingRow
          id="rebuild-posts"
          label="Rebuild Posts Database"
          description="Re-scan all post markdown files and rebuild the database index."
        >
          <button
            className="secondary"
            onClick={async () => {
              showToast.loading('Rebuilding posts database...');
              try {
                await window.electronAPI?.posts.rebuildFromFiles();
                const postsResult = await window.electronAPI?.posts.getAll({ limit: 500, offset: 0 });
                if (postsResult) {
                  useAppStore.getState().setPosts(postsResult.items, postsResult.hasMore, postsResult.total);
                }
                showToast.dismiss();
                showToast.success('Posts database rebuilt');
              } catch {
                showToast.dismiss();
                showToast.error('Failed to rebuild posts database');
              }
            }}
          >
            Rebuild Posts
          </button>
        </SettingRow>

        <SettingRow
          id="rebuild-media"
          label="Rebuild Media Database"
          description="Re-scan all media files and sidecar metadata. Regenerates missing entries."
        >
          <button
            className="secondary"
            onClick={async () => {
              showToast.loading('Rebuilding media database...');
              try {
                await window.electronAPI?.media.rebuildFromFiles();
                const media = await window.electronAPI?.media.getAll();
                if (media) {
                  useAppStore.getState().setMedia(media as any[]);
                }
                showToast.dismiss();
                showToast.success('Media database rebuilt');
              } catch {
                showToast.dismiss();
                showToast.error('Failed to rebuild media database');
              }
            }}
          >
            Rebuild Media
          </button>
        </SettingRow>

        <SettingRow
          id="rebuild-links"
          label="Rebuild Post Links"
          description="Re-scan all posts and rebuild the internal link graph between posts."
        >
          <button
            className="secondary"
            onClick={async () => {
              showToast.loading('Rebuilding post links...');
              try {
                await window.electronAPI?.posts.rebuildLinks();
                showToast.dismiss();
                showToast.success('Post links rebuilt');
              } catch {
                showToast.dismiss();
                showToast.error('Failed to rebuild post links');
              }
            }}
          >
            Rebuild Links
          </button>
        </SettingRow>

        <SettingRow
          id="regenerate-thumbnails"
          label="Regenerate Thumbnails"
          description="Generate missing thumbnails for all images. Useful after importing media externally."
        >
          <button
            className="secondary"
            onClick={async () => {
              showToast.loading('Generating thumbnails...');
              try {
                const result = await window.electronAPI?.media.regenerateMissingThumbnails();
                showToast.dismiss();
                if (result && result.generated > 0) {
                  showToast.success(`Generated ${result.generated} thumbnails`);
                } else if (result && result.processed === 0) {
                  showToast.success('All thumbnails already exist');
                } else {
                  showToast.success('Thumbnail generation complete');
                }
              } catch {
                showToast.dismiss();
                showToast.error('Failed to generate thumbnails');
              }
            }}
          >
            Generate Thumbnails
          </button>
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="File System"
        description="Access project data files and directories."
        hidden={!sectionHasMatches(dataKeywords)}
      >
        <SettingRow
          id="open-data"
          label="Open Data Folder"
          description="Open the project data folder containing posts, media, and database files."
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
            Open Folder
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
    sectionHasMatches(publishingKeywords) ||
    sectionHasMatches(dataKeywords);

  return (
    <div className="settings-view">
      {/* Header with search */}
      <div className="settings-header">
        <h2>Settings</h2>
        <div className="settings-search">
          <span className="settings-search-icon"><SearchIcon /></span>
          <input
            type="text"
            placeholder="Search settings..."
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
            {renderPublishingSettings()}
            {renderDataSettings()}
          </>
        ) : (
          <div className="settings-no-results">
            <p>No settings found matching "{searchQuery}"</p>
            <button onClick={() => setSearchQuery('')}>Clear search</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsView;
