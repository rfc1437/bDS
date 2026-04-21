import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
export type SettingsCategory = 'project' | 'editor' | 'content' | 'ai' | 'technology' | 'publishing' | 'data' | 'mcp';

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
  postTemplateSlug?: string;
  listTemplateSlug?: string;
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

/** Small component that shows the MCP server port or "Not running". */
const MCPStatusBadge: React.FC = () => {
  const { t } = useI18n();
  const [port, setPort] = React.useState<number | null>(null);

  React.useEffect(() => {
    window.electronAPI?.mcp?.getPort().then(setPort).catch(() => setPort(null));
  }, []);

  return (
    <span className={`badge ${port ? 'badge-success' : 'badge-secondary'}`}>
      {port ? t('settings.mcp.portRunning', { port: String(port) }) : t('settings.mcp.portStopped')}
    </span>
  );
};

/** Button to add/remove bDS MCP server to/from an agent's config. */
const MCPAgentButton: React.FC<{ agentId: string; agentLabel: string }> = ({ agentId, agentLabel }) => {
  const { t } = useI18n();
  const [configured, setConfigured] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    window.electronAPI?.mcp?.isConfigured(agentId).then(setConfigured).catch(() => setConfigured(false));
  }, [agentId]);

  if (configured) {
    return (
      <button
        className="secondary danger"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          try {
            const result = await window.electronAPI?.mcp?.removeFromAgentConfig(agentId);
            if (result?.success) {
              showToast.success(t('settings.toast.mcpConfigRemoveSuccess', { agent: agentLabel }));
              setConfigured(false);
            } else {
              showToast.error(t('settings.toast.mcpConfigRemoveFailed', { agent: agentLabel, error: result?.error ?? 'Unknown error' }));
            }
          } catch {
            showToast.error(t('settings.toast.mcpConfigRemoveFailed', { agent: agentLabel, error: 'Unexpected error' }));
          } finally {
            setLoading(false);
          }
        }}
      >
        {t('settings.mcp.removeFromAgent', { agent: agentLabel })}
      </button>
    );
  }

  return (
    <button
      className="secondary"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          const result = await window.electronAPI?.mcp?.addToAgentConfig(agentId);
          if (result?.success) {
            showToast.success(t('settings.toast.mcpConfigSuccess', { agent: agentLabel }));
            setConfigured(true);
          } else {
            showToast.error(t('settings.toast.mcpConfigFailed', { agent: agentLabel, error: result?.error ?? 'Unknown error' }));
          }
        } catch {
          showToast.error(t('settings.toast.mcpConfigFailed', { agent: agentLabel, error: 'Unexpected error' }));
        } finally {
          setLoading(false);
        }
      }}
    >
      {t('settings.mcp.addToAgent', { agent: agentLabel })}
    </button>
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
  const [projectBlogLanguages, setProjectBlogLanguages] = useState<string[]>([]);
  const [projectMaxPostsPerPage, setProjectMaxPostsPerPage] = useState(50);
  const [projectBlogmarkCategory, setProjectBlogmarkCategory] = useState('article');
  const [projectPythonRuntimeMode, setProjectPythonRuntimeMode] = useState<'webworker' | 'main-thread'>('webworker');
  const [semanticSimilarityEnabled, setSemanticSimilarityEnabled] = useState(false);

  // Post categories management
  const [postCategories, setPostCategories] = useState<string[]>(DEFAULT_POST_CATEGORIES);
  const [categoryMetadata, setCategoryMetadata] = useState<Record<string, CategoryMetadata>>(DEFAULT_CATEGORY_METADATA);
  const [newCategoryInput, setNewCategoryInput] = useState('');

  // Available templates for category dropdowns
  const [postTemplates, setPostTemplates] = useState<Array<{ slug: string; title: string }>>([]);
  const [listTemplates, setListTemplates] = useState<Array<{ slug: string; title: string }>>([]);

  // AI Assistant settings
  const [aiSystemPrompt, setAiSystemPrompt] = useState('');
  const [aiSystemPromptModified, setAiSystemPromptModified] = useState(false);
  const [aiApiKeyMasked, setAiApiKeyMasked] = useState('');
  const [aiHasApiKey, setAiHasApiKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [aiHasMistralKey, setAiHasMistralKey] = useState(false);
  const [aiMistralKeyMasked, setAiMistralKeyMasked] = useState('');
  const [newMistralKey, setNewMistralKey] = useState('');
  const [ollamaEnabled, setOllamaEnabled] = useState(false);
  const [ollamaCapabilities, setOllamaCapabilities] = useState<Record<string, { tools: boolean; vision: boolean }>>({});
  const [ollamaModels, setOllamaModels] = useState<{id: string; name: string}[]>([]);
  const [lmstudioEnabled, setLmstudioEnabled] = useState(false);
  const [lmstudioCapabilities, setLmstudioCapabilities] = useState<Record<string, { tools: boolean; vision: boolean }>>({});
  const [lmstudioModels, setLmstudioModels] = useState<{id: string; name: string}[]>([]);
  const [genericOpenAIEnabled, setGenericOpenAIEnabled] = useState(false);
  const [genericOpenAIBaseURL, setGenericOpenAIBaseURL] = useState('');
  const [genericOpenAIApiKeyMasked, setGenericOpenAIApiKeyMasked] = useState('');
  const [hasGenericOpenAIApiKey, setHasGenericOpenAIApiKey] = useState(false);
  const [newGenericOpenAIApiKey, setNewGenericOpenAIApiKey] = useState('');
  const [genericOpenAIModels, setGenericOpenAIModels] = useState<{id: string; name: string}[]>([]);
  const [genericOpenAICapabilities, setGenericOpenAICapabilities] = useState<Record<string, { tools: boolean; vision: boolean }>>({});
  const [offlineModeEnabled, setOfflineModeEnabled] = useState(false);
  const [offlineChatModel, setOfflineChatModel] = useState('');
  const [offlineTitleModel, setOfflineTitleModel] = useState('');
  const [offlineImageAnalysisModel, setOfflineImageAnalysisModel] = useState('');
  const [knownLocalModels, setKnownLocalModels] = useState<{id: string; name: string; provider?: string; vision?: boolean}[]>([]);
  const [titleModel, setTitleModel] = useState('claude-haiku-4-5');
  const [imageAnalysisModel, setImageAnalysisModel] = useState('claude-sonnet-4-5');
  const [availableModels, setAvailableModels] = useState<{id: string; name: string; provider?: string; vision?: boolean}[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [modelCatalog, setModelCatalog] = useState<Map<string, {
    maxOutputTokens: number | null;
    contextWindow: number | null;
    inputPrice: number | null;
    outputPrice: number | null;
  }>>(new Map());
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);

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

        const incomingSemanticSimilarity = (metadata as { semanticSimilarityEnabled?: unknown } | null)?.semanticSimilarityEnabled;
        setSemanticSimilarityEnabled(incomingSemanticSimilarity === true);

        const incomingBlogLanguages = (metadata as { blogLanguages?: unknown } | null)?.blogLanguages;
        setProjectBlogLanguages(Array.isArray(incomingBlogLanguages)
          ? incomingBlogLanguages.filter((l): l is string => typeof l === 'string')
          : []);

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
                postTemplateSlug: typeof (settings as any)?.postTemplateSlug === 'string' ? (settings as any).postTemplateSlug : undefined,
                listTemplateSlug: typeof (settings as any)?.listTemplateSlug === 'string' ? (settings as any).listTemplateSlug : undefined,
              };
            }
          }
          return merged;
        });
      });
    }
  }, [activeProject]);

  // Load available templates for category dropdowns
  useEffect(() => {
    if (activeProject) {
      window.electronAPI?.templates.getEnabledByKind('post').then((templates) => {
        setPostTemplates(templates.map((t) => ({ slug: t.slug, title: t.title })));
      });
      window.electronAPI?.templates.getEnabledByKind('list').then((templates) => {
        setListTemplates(templates.map((t) => ({ slug: t.slug, title: t.title })));
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

          // Load Mistral API key status
          const mistralKeyResult = await window.electronAPI?.chat.getMistralApiKey();
          if (mistralKeyResult) {
            setAiHasMistralKey(mistralKeyResult.hasKey);
            setAiMistralKeyMasked(mistralKeyResult.maskedKey || '');
          }

          // Load Ollama enabled state
          const ollamaState = await window.electronAPI?.chat.getOllamaEnabled();
          setOllamaEnabled(!!ollamaState);

          // Load Ollama model capabilities and models list
          if (ollamaState) {
            const [caps, models] = await Promise.all([
              window.electronAPI?.chat.getOllamaModelCapabilities(),
              window.electronAPI?.chat.getOllamaModels(),
            ]);
            if (caps) setOllamaCapabilities(caps);
            if (models) setOllamaModels(models.map(m => ({ id: m.id, name: m.name })));
          }

          // Load LM Studio enabled state
          const lmstudioState = await window.electronAPI?.chat.getLmstudioEnabled();
          setLmstudioEnabled(!!lmstudioState);

          // Load LM Studio model capabilities and models list
          if (lmstudioState) {
            const [lmCaps, lmModels] = await Promise.all([
              window.electronAPI?.chat.getLmstudioModelCapabilities(),
              window.electronAPI?.chat.getLmstudioModels(),
            ]);
            if (lmCaps) setLmstudioCapabilities(lmCaps);
            if (lmModels) setLmstudioModels(lmModels.map(m => ({ id: m.id, name: m.name })));
          }

          // Load generic OpenAI enabled state
          const genericOpenAIState = await window.electronAPI?.chat.getGenericOpenAIEnabled();
          setGenericOpenAIEnabled(!!genericOpenAIState);

          // Load generic OpenAI base URL
          const genericOpenAIBaseURLResult = await window.electronAPI?.chat.getGenericOpenAIBaseURL();
          if (genericOpenAIBaseURLResult) {
            setGenericOpenAIBaseURL(genericOpenAIBaseURLResult);
          }

          // Load generic OpenAI API key status
          const genericOpenAIApiKeyResult = await window.electronAPI?.chat.getGenericOpenAIApiKey();
          if (genericOpenAIApiKeyResult) {
            setHasGenericOpenAIApiKey(genericOpenAIApiKeyResult.hasKey);
            setGenericOpenAIApiKeyMasked(genericOpenAIApiKeyResult.maskedKey || '');
          }

          // Load generic OpenAI model capabilities and models list
          if (genericOpenAIState) {
            const [genCaps, genModels] = await Promise.all([
              window.electronAPI?.chat.getGenericOpenAIModelCapabilities(),
              window.electronAPI?.chat.getGenericOpenAIModels(),
            ]);
            if (genCaps) setGenericOpenAICapabilities(genCaps);
            if (genModels) setGenericOpenAIModels(genModels.map(m => ({ id: m.id, name: m.name })));
          }

          // Load per-purpose model preferences
          const titleModelResult = await window.electronAPI?.chat.getTitleModel();
          if (titleModelResult?.success && titleModelResult.modelId) {
            setTitleModel(titleModelResult.modelId);
          }
          const imageModelResult = await window.electronAPI?.chat.getImageAnalysisModel();
          if (imageModelResult?.success && imageModelResult.modelId) {
            setImageAnalysisModel(imageModelResult.modelId);
          }

          // Load offline mode preferences
          const offlineState = await window.electronAPI?.chat.getOfflineMode();
          setOfflineModeEnabled(!!offlineState);
          const offlineChat = await window.electronAPI?.chat.getOfflineChatModel();
          if (offlineChat?.success && offlineChat.modelId) setOfflineChatModel(offlineChat.modelId);
          const offlineTitle = await window.electronAPI?.chat.getOfflineTitleModel();
          if (offlineTitle?.success && offlineTitle.modelId) setOfflineTitleModel(offlineTitle.modelId);
          const offlineImage = await window.electronAPI?.chat.getOfflineImageAnalysisModel();
          if (offlineImage?.success && offlineImage.modelId) setOfflineImageAnalysisModel(offlineImage.modelId);

          // Load known local models (persisted, no network needed)
          try {
            const locals = await window.electronAPI?.chat.getKnownLocalModels();
            if (locals && locals.length > 0) setKnownLocalModels(locals);
          } catch { /* ignore */ }

          // Load model catalog metadata
          const catalogResult = await window.electronAPI?.chat.getModelCatalog();
          if (catalogResult?.success && catalogResult.entries) {
            const map = new Map<string, { maxOutputTokens: number | null; contextWindow: number | null; inputPrice: number | null; outputPrice: number | null }>();
            for (const entry of catalogResult.entries) {
              map.set(entry.id, {
                maxOutputTokens: entry.maxOutputTokens,
                contextWindow: entry.contextWindow,
                inputPrice: entry.inputPrice,
                outputPrice: entry.outputPrice,
              });
            }
            setModelCatalog(map);
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
          semanticSimilarityEnabled,
          blogLanguages: projectBlogLanguages.length > 0 ? projectBlogLanguages : undefined,
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
  const aiKeywords = ['ai', 'assistant', 'chat', 'model', 'prompt', 'system', 'api', 'key', 'claude', 'gpt', 'opencode', 'ollama', 'lmstudio', 'lm studio', 'local'];
  const technologyKeywords = ['technology', 'python', 'runtime', 'worker', 'webworker', 'main thread', 'execution', 'semantic', 'similarity', 'embedding', 'ai', 'search', 'duplicate'];
  const publishingKeywords = ['publishing', 'ssh', 'deploy', 'server', 'host', 'upload', 'scp', 'rsync'];
  const dataKeywords = ['data', 'database', 'rebuild', 'maintenance', 'posts', 'media', 'scripts', 'links', 'folder', 'filesystem'];
  const mcpKeywords = ['mcp', 'server', 'agent', 'claude', 'copilot', 'gemini', 'opencode', 'model context protocol', 'coding', 'configuration'];

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
        id="project-blog-languages"
        label={t('settings.project.blogLanguagesLabel')}
        description={t('settings.project.blogLanguagesDescription')}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {SUPPORTED_RENDER_LANGUAGES.map((language) => {
            const isMain = language === projectMainLanguage;
            const isChecked = isMain || projectBlogLanguages.includes(language);
            return (
              <label key={language} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', opacity: isMain ? 0.7 : 1 }}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={isMain}
                  onChange={(e) => {
                    if (isMain) return;
                    setProjectBlogLanguages((prev) =>
                      e.target.checked
                        ? [...prev.filter((l) => l !== language), language]
                        : prev.filter((l) => l !== language),
                    );
                  }}
                />
                {t(RENDER_LANGUAGE_LABEL_KEY[language])}
              </label>
            );
          })}
        </div>
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

  const handleCategoryTemplateChange = async (
    category: string,
    field: 'postTemplateSlug' | 'listTemplateSlug',
    value: string,
  ) => {
    const nextCategoryMetadata: Record<string, CategoryMetadata> = {
      ...categoryMetadata,
      [category]: {
        ...(categoryMetadata[category] || { renderInLists: true, showTitle: true, title: category }),
        [field]: value || undefined,
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
                <th>{t('settings.content.postTemplateColumn')}</th>
                <th>{t('settings.content.listTemplateColumn')}</th>
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
                    <td>
                      <select
                        value={metadata.postTemplateSlug || ''}
                        onChange={(event) => handleCategoryTemplateChange(cat, 'postTemplateSlug', event.target.value)}
                        aria-label={t('settings.content.postTemplateAria', { category: cat })}
                      >
                        <option value="">{t('editor.field.templateDefault')}</option>
                        {postTemplates.map((tpl) => (
                          <option key={tpl.slug} value={tpl.slug}>{tpl.title}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={metadata.listTemplateSlug || ''}
                        onChange={(event) => handleCategoryTemplateChange(cat, 'listTemplateSlug', event.target.value)}
                        aria-label={t('settings.content.listTemplateAria', { category: cat })}
                      >
                        <option value="">{t('editor.field.templateDefault')}</option>
                        {listTemplates.map((tpl) => (
                          <option key={tpl.slug} value={tpl.slug}>{tpl.title}</option>
                        ))}
                      </select>
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

        // Refresh models after key change
        const modelsResult = await window.electronAPI?.chat.getAvailableModels();
        if (modelsResult?.success && modelsResult.models) {
          setAvailableModels(modelsResult.models);
          setSelectedModel(modelsResult.selectedModel || '');
        }
      } else {
        showToast.error(t('settings.toast.apiKeyInvalid'));
      }
    } catch (error) {
      console.error('Failed to save API key:', error);
      showToast.error(t('settings.toast.apiKeySaveFailed'));
    }
  };

  const handleSaveMistralApiKey = async () => {
    if (!newMistralKey.trim()) return;
    try {
      const validateResult = await window.electronAPI?.chat.validateMistralApiKey(newMistralKey.trim());
      if (validateResult?.isValid) {
        await window.electronAPI?.chat.setMistralApiKey(newMistralKey.trim());
        setAiHasMistralKey(true);
        setAiMistralKeyMasked('•'.repeat(Math.max(0, newMistralKey.length - 4)) + newMistralKey.slice(-4));
        setNewMistralKey('');
        showToast.success(t('settings.toast.apiKeySaved'));

        // Refresh models after key change
        const modelsResult = await window.electronAPI?.chat.getAvailableModels();
        if (modelsResult?.success && modelsResult.models) {
          setAvailableModels(modelsResult.models);
          setSelectedModel(modelsResult.selectedModel || '');
        }
      } else {
        showToast.error(t('settings.toast.apiKeyInvalid'));
      }
    } catch (error) {
      console.error('Failed to save Mistral API key:', error);
      showToast.error(t('settings.toast.apiKeySaveFailed'));
    }
  };

  const handleOllamaToggle = async (enabled: boolean) => {
    try {
      const result = await window.electronAPI?.chat.setOllamaEnabled(enabled);
      if (result?.success) {
        setOllamaEnabled(enabled);
        showToast.success(t(enabled ? 'settings.toast.ollamaEnabled' : 'settings.toast.ollamaDisabled'));

        // Refresh models after toggle
        const modelsResult = await window.electronAPI?.chat.getAvailableModels();
        if (modelsResult?.success && modelsResult.models) {
          setAvailableModels(modelsResult.models);
          setSelectedModel(modelsResult.selectedModel || '');
        }

        // Load Ollama models and capabilities when enabling
        if (enabled) {
          const [caps, ollamaModelsList] = await Promise.all([
            window.electronAPI?.chat.getOllamaModelCapabilities(),
            window.electronAPI?.chat.getOllamaModels(),
          ]);
          if (caps) setOllamaCapabilities(caps);
          if (ollamaModelsList) setOllamaModels(ollamaModelsList.map(m => ({ id: m.id, name: m.name })));
        } else {
          setOllamaModels([]);
        }
      }
    } catch (error) {
      console.error('Failed to toggle Ollama:', error);
    }
  };

  const handleOllamaCapabilityToggle = async (modelId: string, field: 'tools' | 'vision', value: boolean) => {
    const current = ollamaCapabilities[modelId] ?? { tools: false, vision: false };
    const updated = { ...current, [field]: value };
    try {
      const result = await window.electronAPI?.chat.setOllamaModelCapabilities(modelId, updated);
      if (result?.success) {
        setOllamaCapabilities(prev => ({ ...prev, [modelId]: updated }));
        // Refresh available models to reflect vision change
        const modelsResult = await window.electronAPI?.chat.getAvailableModels();
        if (modelsResult?.success && modelsResult.models) {
          setAvailableModels(modelsResult.models);
        }
      }
    } catch (error) {
      console.error('Failed to update Ollama model capabilities:', error);
    }
  };

  const handleLmstudioToggle = async (enabled: boolean) => {
    try {
      const result = await window.electronAPI?.chat.setLmstudioEnabled(enabled);
      if (result?.success) {
        setLmstudioEnabled(enabled);
        showToast.success(t(enabled ? 'settings.toast.lmstudioEnabled' : 'settings.toast.lmstudioDisabled'));

        // Refresh models after toggle
        const modelsResult = await window.electronAPI?.chat.getAvailableModels();
        if (modelsResult?.success && modelsResult.models) {
          setAvailableModels(modelsResult.models);
          setSelectedModel(modelsResult.selectedModel || '');
        }

        // Load LM Studio models and capabilities when enabling
        if (enabled) {
          const [caps, lmstudioModelsList] = await Promise.all([
            window.electronAPI?.chat.getLmstudioModelCapabilities(),
            window.electronAPI?.chat.getLmstudioModels(),
          ]);
          if (caps) setLmstudioCapabilities(caps);
          if (lmstudioModelsList) setLmstudioModels(lmstudioModelsList.map(m => ({ id: m.id, name: m.name })));
        } else {
          setLmstudioModels([]);
        }
      }
    } catch (error) {
      console.error('Failed to toggle LM Studio:', error);
    }
  };

  const handleLmstudioCapabilityToggle = async (modelId: string, field: 'tools' | 'vision', value: boolean) => {
    const current = lmstudioCapabilities[modelId] ?? { tools: false, vision: false };
    const updated = { ...current, [field]: value };
    try {
      const result = await window.electronAPI?.chat.setLmstudioModelCapabilities(modelId, updated);
      if (result?.success) {
        setLmstudioCapabilities(prev => ({ ...prev, [modelId]: updated }));
        // Refresh available models to reflect vision change
        const modelsResult = await window.electronAPI?.chat.getAvailableModels();
        if (modelsResult?.success && modelsResult.models) {
          setAvailableModels(modelsResult.models);
        }
      }
    } catch (error) {
      console.error('Failed to update LM Studio model capabilities:', error);
    }
  };

  // Generic OpenAI handlers
  const handleGenericOpenAIToggle = async (enabled: boolean) => {
    try {
      const result = await window.electronAPI?.chat.setGenericOpenAIEnabled(enabled);
      if (result?.success) {
        setGenericOpenAIEnabled(enabled);
        showToast.success(t(enabled ? 'settings.toast.genericOpenAIEnabled' : 'settings.toast.genericOpenAIDisabled'));

        // Refresh models after toggle
        const modelsResult = await window.electronAPI?.chat.getAvailableModels();
        if (modelsResult?.success && modelsResult.models) {
          setAvailableModels(modelsResult.models);
          setSelectedModel(modelsResult.selectedModel || '');
        }

        // Load generic OpenAI models and capabilities when enabling
        if (enabled) {
          const [caps, genModelsList] = await Promise.all([
            window.electronAPI?.chat.getGenericOpenAIModelCapabilities(),
            window.electronAPI?.chat.getGenericOpenAIModels(),
          ]);
          if (caps) setGenericOpenAICapabilities(caps);
          if (genModelsList) setGenericOpenAIModels(genModelsList.map(m => ({ id: m.id, name: m.name })));
        } else {
          setGenericOpenAIModels([]);
        }
      }
    } catch (error) {
      console.error('Failed to toggle generic OpenAI:', error);
    }
  };

  const handleSaveGenericOpenAIBaseURL = async () => {
    try {
      const result = await window.electronAPI?.chat.setGenericOpenAIBaseURL(genericOpenAIBaseURL);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to save generic OpenAI base URL');
      }
      const storedBaseURL = await window.electronAPI?.chat.getGenericOpenAIBaseURL();
      if (typeof storedBaseURL === 'string') {
        setGenericOpenAIBaseURL(storedBaseURL);
      }
      showToast.success(t('settings.toast.genericOpenAISettingsSaved'));
    } catch (error) {
      console.error('Failed to save generic OpenAI base URL:', error);
      showToast.error(t('settings.toast.genericOpenAISettingsSaveFailed'));
    }
  };

  const handleSaveGenericOpenAIApiKey = async () => {
    if (!newGenericOpenAIApiKey.trim()) return;
    try {
      const trimmedKey = newGenericOpenAIApiKey.trim();
      const result = await window.electronAPI?.chat.setGenericOpenAIApiKey(trimmedKey);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to save generic OpenAI API key');
      }
      setHasGenericOpenAIApiKey(true);
      setGenericOpenAIApiKeyMasked('•'.repeat(Math.max(0, trimmedKey.length - 4)) + trimmedKey.slice(-4));
      setNewGenericOpenAIApiKey('');
      showToast.success(t('settings.toast.apiKeySaved'));

      // Refresh models after key change
      const modelsResult = await window.electronAPI?.chat.getAvailableModels();
      if (modelsResult?.success && modelsResult.models) {
        setAvailableModels(modelsResult.models);
        setSelectedModel(modelsResult.selectedModel || '');
      }
    } catch (error) {
      console.error('Failed to save generic OpenAI API key:', error);
      showToast.error(t('settings.toast.apiKeySaveFailed'));
    }
  };

  const handleGenericOpenAICapabilityToggle = async (modelId: string, field: 'tools' | 'vision', value: boolean) => {
    const current = genericOpenAICapabilities[modelId] ?? { tools: false, vision: false };
    const updated = { ...current, [field]: value };
    try {
      const result = await window.electronAPI?.chat.setGenericOpenAIModelCapabilities(modelId, updated);
      if (result?.success) {
        setGenericOpenAICapabilities(prev => ({ ...prev, [modelId]: updated }));
        // Refresh available models to reflect vision change
        const modelsResult = await window.electronAPI?.chat.getAvailableModels();
        if (modelsResult?.success && modelsResult.models) {
          setAvailableModels(modelsResult.models);
        }
      }
    } catch (error) {
      console.error('Failed to update generic OpenAI model capabilities:', error);
    }
  };

  const handleTitleModelChange = async (modelId: string) => {
    try {
      const result = await window.electronAPI?.chat.setTitleModel(modelId);
      if (result?.success) {
        setTitleModel(modelId);
      }
    } catch (error) {
      console.error('Failed to set title model:', error);
    }
  };

  const handleImageAnalysisModelChange = async (modelId: string) => {
    try {
      const result = await window.electronAPI?.chat.setImageAnalysisModel(modelId);
      if (result?.success) {
        setImageAnalysisModel(modelId);
      }
    } catch (error) {
      console.error('Failed to set image analysis model:', error);
    }
  };

  const handleOfflineToggle = async (enabled: boolean) => {
    try {
      const result = await window.electronAPI?.chat.setOfflineMode(enabled);
      if (result?.success) {
        setOfflineModeEnabled(enabled);
        showToast.success(t(enabled ? 'settings.toast.offlineEnabled' : 'settings.toast.offlineDisabled'));
      }
    } catch (error) {
      console.error('Failed to toggle offline mode:', error);
    }
  };

  const handleOfflineChatModelChange = async (modelId: string) => {
    try {
      const result = await window.electronAPI?.chat.setOfflineChatModel(modelId);
      if (result?.success) setOfflineChatModel(modelId);
    } catch (error) {
      console.error('Failed to set offline chat model:', error);
    }
  };

  const handleOfflineTitleModelChange = async (modelId: string) => {
    try {
      const result = await window.electronAPI?.chat.setOfflineTitleModel(modelId);
      if (result?.success) setOfflineTitleModel(modelId);
    } catch (error) {
      console.error('Failed to set offline title model:', error);
    }
  };

  const handleOfflineImageAnalysisModelChange = async (modelId: string) => {
    try {
      const result = await window.electronAPI?.chat.setOfflineImageAnalysisModel(modelId);
      if (result?.success) setOfflineImageAnalysisModel(modelId);
    } catch (error) {
      console.error('Failed to set offline image analysis model:', error);
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

  const handleRefreshModelCatalog = async () => {
    setRefreshingCatalog(true);
    try {
      const result = await window.electronAPI?.chat.refreshModelCatalog();
      if (result?.success) {
        if (result.notModified) {
          showToast.success(t('settings.toast.modelCatalogUpToDate'));
        } else {
          showToast.success(t('settings.toast.modelCatalogRefreshed', { count: String(result.modelsUpdated) }));
        }
        // Reload catalog data
        const catalogResult = await window.electronAPI?.chat.getModelCatalog();
        if (catalogResult?.success && catalogResult.entries) {
          const map = new Map<string, { maxOutputTokens: number | null; contextWindow: number | null; inputPrice: number | null; outputPrice: number | null }>();
          for (const entry of catalogResult.entries) {
            map.set(entry.id, {
              maxOutputTokens: entry.maxOutputTokens,
              contextWindow: entry.contextWindow,
              inputPrice: entry.inputPrice,
              outputPrice: entry.outputPrice,
            });
          }
          setModelCatalog(map);
        }
      } else {
        showToast.error(t('settings.toast.modelCatalogRefreshFailed'));
      }
    } catch (error) {
      console.error('Failed to refresh model catalog:', error);
      showToast.error(t('settings.toast.modelCatalogRefreshFailed'));
    } finally {
      setRefreshingCatalog(false);
    }
  };

  // Group models by provider for optgroup display
  const groupModelsByProvider = useCallback((models: typeof availableModels) => {
    const groups: Record<string, typeof availableModels> = {};
    for (const model of models) {
      const provider = model.provider || 'other';
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(model);
    }
    return groups;
  }, []);

  const groupedModels = useMemo(() => groupModelsByProvider(availableModels), [availableModels, groupModelsByProvider]);

  // Vision-capable models only (for image analysis model selector)
  const groupedVisionModels = useMemo(
    () => groupModelsByProvider(availableModels.filter(m => m.vision)),
    [availableModels, groupModelsByProvider]
  );

  // Local-only models (for offline / airplane mode selectors)
  // Prefer knownLocalModels (persisted, always available) over filtering availableModels (needs network)
  const localModelSource = useMemo(() => {
    const fromAvailable = availableModels.filter(m => m.provider === 'ollama' || m.provider === 'lmstudio');
    return fromAvailable.length > 0 ? fromAvailable : knownLocalModels;
  }, [availableModels, knownLocalModels]);
  const groupedLocalModels = useMemo(
    () => groupModelsByProvider(localModelSource),
    [localModelSource, groupModelsByProvider]
  );
  const groupedLocalVisionModels = useMemo(
    () => groupModelsByProvider(localModelSource.filter(m => m.vision)),
    [localModelSource, groupModelsByProvider]
  );

  const providerLabel = (provider: string) => {
    if (provider === 'anthropic' || provider === 'openai' || provider === 'google' || provider === 'other') return t('settings.ai.providerOpenCode');
    if (provider === 'mistral') return t('settings.ai.providerMistral');
    if (provider === 'ollama') return t('settings.ai.providerOllama');
    if (provider === 'lmstudio') return t('settings.ai.providerLmstudio');
    if (provider === 'generic-openai') return t('settings.ai.providerGenericOpenAI');
    return provider;
  };

  // Render a model <select> with optgroup by provider
  const renderModelSelect = (id: string, value: string, onChange: (v: string) => void, disabled?: boolean, groups?: Record<string, typeof availableModels>) => {
    const modelGroups = groups || groupedModels;
    const modelList = Object.values(modelGroups).flat();
    return (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {modelList.length === 0 && <option value="">{t('settings.ai.noModels')}</option>}
        {Object.entries(modelGroups).map(([provider, models]) => (
          <optgroup key={provider} label={providerLabel(provider)}>
            {models.map(model => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
    );
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
        id="ai-mistral-key"
        label={t('settings.ai.mistralApiKeyLabel')}
        description={t('settings.ai.mistralApiKeyDescription')}
      >
        <div className="setting-input-group">
          {aiHasMistralKey ? (
            <>
              <input
                id="ai-mistral-key"
                type="text"
                value={aiMistralKeyMasked}
                disabled
                placeholder={t('settings.ai.mistralApiKeyConfigured')}
              />
              <span className="setting-status-badge success">{t('settings.ai.configured')}</span>
            </>
          ) : (
            <>
              <input
                id="ai-mistral-key"
                type="password"
                value={newMistralKey}
                onChange={(e) => setNewMistralKey(e.target.value)}
                placeholder={t('chat.apiKeyPlaceholder')}
              />
              <button className="primary" onClick={handleSaveMistralApiKey} disabled={!newMistralKey.trim()}>
                {t('chat.apiKeySave')}
              </button>
            </>
          )}
        </div>
        {aiHasMistralKey && (
          <div className="setting-inline-action">
            <button className="text-button" onClick={() => { setAiHasMistralKey(false); setAiMistralKeyMasked(''); }}>
              {t('settings.ai.changeMistralApiKey')}
            </button>
          </div>
        )}
      </SettingRow>

      <SettingRow
        id="ai-ollama"
        label={t('settings.ai.ollamaLabel')}
        description={t('settings.ai.ollamaDescription')}
      >
        <div className="setting-input-group">
          <label className="toggle-label">
            <input
              id="ai-ollama"
              type="checkbox"
              checked={ollamaEnabled}
              onChange={(e) => handleOllamaToggle(e.target.checked)}
            />
            {t('settings.ai.ollamaEnable')}
          </label>
          {ollamaEnabled && (
            <span className="setting-status-badge success">{t('settings.ai.configured')}</span>
          )}
        </div>
        {ollamaEnabled && ollamaModels.length > 0 && (
          <div className="ollama-model-capabilities">
            <small className="setting-description">{t('settings.ai.ollamaCapabilitiesDescription')}</small>
            <table className="ollama-caps-table">
              <thead>
                <tr>
                  <th>{t('settings.ai.ollamaCapModel')}</th>
                  <th>{t('settings.ai.ollamaCapTools')}</th>
                  <th>{t('settings.ai.ollamaCapVision')}</th>
                </tr>
              </thead>
              <tbody>
                {ollamaModels.map(m => {
                  const caps = ollamaCapabilities[m.id] ?? { tools: false, vision: false };
                  return (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={caps.tools}
                          onChange={(e) => handleOllamaCapabilityToggle(m.id, 'tools', e.target.checked)}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={caps.vision}
                          onChange={(e) => handleOllamaCapabilityToggle(m.id, 'vision', e.target.checked)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SettingRow>

      <SettingRow
        id="ai-lmstudio"
        label={t('settings.ai.lmstudioLabel')}
        description={t('settings.ai.lmstudioDescription')}
      >
        <div className="setting-input-group">
          <label className="toggle-label">
            <input
              id="ai-lmstudio"
              type="checkbox"
              checked={lmstudioEnabled}
              onChange={(e) => handleLmstudioToggle(e.target.checked)}
            />
            {t('settings.ai.lmstudioEnable')}
          </label>
          {lmstudioEnabled && (
            <span className="setting-status-badge success">{t('settings.ai.configured')}</span>
          )}
        </div>
        {lmstudioEnabled && lmstudioModels.length > 0 && (
          <div className="lmstudio-model-capabilities">
            <small className="setting-description">{t('settings.ai.lmstudioCapabilitiesDescription')}</small>
            <table className="lmstudio-caps-table">
              <thead>
                <tr>
                  <th>{t('settings.ai.lmstudioCapModel')}</th>
                  <th>{t('settings.ai.lmstudioCapTools')}</th>
                  <th>{t('settings.ai.lmstudioCapVision')}</th>
                </tr>
              </thead>
              <tbody>
                {lmstudioModels.map(m => {
                  const caps = lmstudioCapabilities[m.id] ?? { tools: false, vision: false };
                  return (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={caps.tools}
                          onChange={(e) => handleLmstudioCapabilityToggle(m.id, 'tools', e.target.checked)}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={caps.vision}
                          onChange={(e) => handleLmstudioCapabilityToggle(m.id, 'vision', e.target.checked)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SettingRow>

      <SettingRow
        id="ai-generic-openai"
        label={t('settings.ai.genericOpenAILabel')}
        description={t('settings.ai.genericOpenOIDescription')}
      >
        <div className="setting-input-group">
          <label className="toggle-label">
            <input
              id="ai-generic-openai"
              type="checkbox"
              checked={genericOpenAIEnabled}
              onChange={(e) => handleGenericOpenAIToggle(e.target.checked)}
            />
            {t('settings.ai.genericOpenAIEnable')}
          </label>
          {genericOpenAIEnabled && (
            <span className="setting-status-badge success">{t('settings.ai.configured')}</span>
          )}
        </div>
        {genericOpenAIEnabled && (
          <div className="generic-openai-settings">
            <div className="setting-field">
              <label htmlFor="ai-generic-openai-base-url">{t('settings.ai.genericOpenAIBaseUrlLabel')}</label>
              <small className="setting-description">{t('settings.ai.genericOpenAIBaseUrlDescription')}</small>
              <input
                id="ai-generic-openai-base-url"
                type="text"
                value={genericOpenAIBaseURL}
                onChange={(e) => setGenericOpenAIBaseURL(e.target.value)}
                placeholder="https://api.example.com/v1"
              />
              <button className="secondary" onClick={handleSaveGenericOpenAIBaseURL}>
                {t('common.save')}
              </button>
            </div>
            <div className="setting-field">
              <label htmlFor="ai-generic-openai-api-key">{t('settings.ai.genericOpenAIApiKeyLabel')}</label>
              <small className="setting-description">{t('settings.ai.genericOpenAIApiKeyDescription')}</small>
              {hasGenericOpenAIApiKey ? (
                <>
                  <input
                    id="ai-generic-openai-api-key"
                    type="text"
                    value={genericOpenAIApiKeyMasked}
                    disabled
                    placeholder={t('settings.ai.genericOpenAIApiKeyConfigured')}
                  />
                  <span className="setting-status-badge success">{t('settings.ai.configured')}</span>
                  <div className="setting-inline-action">
                    <button className="text-button" onClick={() => { setHasGenericOpenAIApiKey(false); setGenericOpenAIApiKeyMasked(''); }}>
                      {t('settings.ai.changeApiKey')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <input
                    id="ai-generic-openai-api-key"
                    type="password"
                    value={newGenericOpenAIApiKey}
                    onChange={(e) => setNewGenericOpenAIApiKey(e.target.value)}
                    placeholder={t('chat.apiKeyPlaceholder')}
                  />
                  <button className="primary" onClick={handleSaveGenericOpenAIApiKey} disabled={!newGenericOpenAIApiKey.trim()}>
                    {t('chat.apiKeySave')}
                  </button>
                </>
              )}
            </div>
            {genericOpenAIEnabled && genericOpenAIModels.length > 0 && (
              <div className="generic-openai-model-capabilities">
                <small className="setting-description">{t('settings.ai.genericOpenAICapabilitiesDescription')}</small>
                <table className="generic-openai-caps-table">
                  <thead>
                    <tr>
                      <th>{t('settings.ai.genericOpenAICapModel')}</th>
                      <th>{t('settings.ai.genericOpenAICapTools')}</th>
                      <th>{t('settings.ai.genericOpenAICapVision')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {genericOpenAIModels.map(m => {
                      const caps = genericOpenAICapabilities[m.id] ?? { tools: false, vision: false };
                      return (
                        <tr key={m.id}>
                          <td>{m.name}</td>
                          <td>
                            <input
                              type="checkbox"
                              checked={caps.tools}
                              onChange={(e) => handleGenericOpenAICapabilityToggle(m.id, 'tools', e.target.checked)}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={caps.vision}
                              onChange={(e) => handleGenericOpenAICapabilityToggle(m.id, 'vision', e.target.checked)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </SettingRow>

      <SettingRow
        id="ai-offline"
        label={t('settings.ai.offlineLabel')}
        description={t('settings.ai.offlineDescription')}
      >
        <div className="setting-input-group">
          <label className="toggle-label">
            <input
              id="ai-offline"
              type="checkbox"
              checked={offlineModeEnabled}
              onChange={(e) => handleOfflineToggle(e.target.checked)}
              disabled={!ollamaEnabled && !lmstudioEnabled}
            />
            {t('settings.ai.offlineEnable')}
          </label>
          {offlineModeEnabled && (
            <span className="setting-status-badge success">{t('settings.ai.configured')}</span>
          )}
        </div>
        {!ollamaEnabled && !lmstudioEnabled && (
          <small className="setting-description">{t('settings.ai.offlineNoLocalProviders')}</small>
        )}
        {offlineModeEnabled && (ollamaEnabled || lmstudioEnabled) && (
          <div className="offline-model-preferences">
            <div className="setting-field">
              <label htmlFor="ai-offline-chat-model">{t('settings.ai.offlineChatModel')}</label>
              <small className="setting-description">{t('settings.ai.offlineChatModelDescription')}</small>
              {renderModelSelect('ai-offline-chat-model', offlineChatModel, handleOfflineChatModelChange, false, groupedLocalModels)}
            </div>
            <div className="setting-field">
              <label htmlFor="ai-offline-title-model">{t('settings.ai.offlineTitleModel')}</label>
              <small className="setting-description">{t('settings.ai.offlineTitleModelDescription')}</small>
              {renderModelSelect('ai-offline-title-model', offlineTitleModel, handleOfflineTitleModelChange, false, groupedLocalModels)}
            </div>
            <div className="setting-field">
              <label htmlFor="ai-offline-image-model">{t('settings.ai.offlineImageAnalysisModel')}</label>
              <small className="setting-description">{t('settings.ai.offlineImageAnalysisModelDescription')}</small>
              {renderModelSelect('ai-offline-image-model', offlineImageAnalysisModel, handleOfflineImageAnalysisModelChange, false, groupedLocalVisionModels)}
            </div>
          </div>
        )}
      </SettingRow>

      <SettingRow
        id="ai-model"
        label={t('settings.ai.defaultModelLabel')}
        description={t('settings.ai.defaultModelDescription')}
      >
        <div className="setting-input-group">
          {renderModelSelect('ai-model', selectedModel, handleModelChange, !aiHasApiKey && !aiHasMistralKey && !ollamaEnabled && !lmstudioEnabled)}
          <button
            className="secondary"
            onClick={handleRefreshModelCatalog}
            disabled={refreshingCatalog || (!aiHasApiKey && !aiHasMistralKey && !ollamaEnabled && !lmstudioEnabled)}
            title={t('settings.ai.refreshModelCatalog')}
          >
            {refreshingCatalog ? t('settings.ai.refreshing') : t('settings.ai.refreshModelCatalog')}
          </button>
        </div>
        {selectedModel && modelCatalog.has(selectedModel) && (() => {
          const info = modelCatalog.get(selectedModel)!;
          const parts: string[] = [];
          if (info.maxOutputTokens != null) {
            parts.push(`${t('settings.ai.modelInfoMaxOutput')}: ${info.maxOutputTokens.toLocaleString()} ${t('settings.ai.modelInfoTokens')}`);
          }
          if (info.contextWindow != null) {
            parts.push(`${t('settings.ai.modelInfoContext')}: ${info.contextWindow.toLocaleString()} ${t('settings.ai.modelInfoTokens')}`);
          }
          if (info.inputPrice != null) {
            parts.push(`${t('settings.ai.modelInfoInputPrice')}: $${info.inputPrice}${t('settings.ai.modelInfoPerMTok')}`);
          }
          if (info.outputPrice != null) {
            parts.push(`${t('settings.ai.modelInfoOutputPrice')}: $${info.outputPrice}${t('settings.ai.modelInfoPerMTok')}`);
          }
          return parts.length > 0 ? (
            <div className="model-catalog-info">{parts.join(' · ')}</div>
          ) : null;
        })()}
      </SettingRow>

      <SettingRow
        id="ai-title-model"
        label={t('settings.ai.titleModelLabel')}
        description={t('settings.ai.titleModelDescription')}
      >
        {renderModelSelect('ai-title-model', titleModel, handleTitleModelChange, !aiHasApiKey && !aiHasMistralKey && !ollamaEnabled && !lmstudioEnabled)}
      </SettingRow>

      <SettingRow
        id="ai-image-analysis-model"
        label={t('settings.ai.imageAnalysisModelLabel')}
        description={t('settings.ai.imageAnalysisModelDescription')}
      >
        {renderModelSelect('ai-image-analysis-model', imageAnalysisModel, handleImageAnalysisModelChange, !aiHasApiKey && !aiHasMistralKey && !ollamaEnabled && !lmstudioEnabled, groupedVisionModels)}
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

      <SettingRow
        id="semantic-similarity-enabled"
        label={t('settings.technology.semanticSimilarityLabel')}
        description={t('settings.technology.semanticSimilarityDescription')}
      >
        <input
          id="semantic-similarity-enabled"
          type="checkbox"
          checked={semanticSimilarityEnabled}
          onChange={(e) => {
            const checked = e.target.checked;
            setSemanticSimilarityEnabled(checked);
            window.electronAPI?.meta.updateProjectMetadata({ semanticSimilarityEnabled: checked }).catch(() => {});
          }}
        />
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

  const renderMCPSettings = () => {
    const agents = [
      { id: 'claude-code', label: 'Claude Code' },
      { id: 'claude-desktop', label: 'Claude Desktop' },
      { id: 'github-copilot', label: 'GitHub Copilot' },
      { id: 'gemini-cli', label: 'Gemini CLI' },
      { id: 'opencode', label: 'OpenCode' },
      { id: 'mistral-vibe', label: 'Mistral Vibe' },
      { id: 'openai-codex', label: 'OpenAI Codex' },
    ];

    return (
      <SettingSection
        id="settings-section-mcp"
        title={t('settings.mcp.title')}
        description={t('settings.mcp.description')}
        hidden={!sectionHasMatches(mcpKeywords)}
      >
        <SettingRow
          id="mcp-status"
          label={t('settings.mcp.statusLabel')}
          description={t('settings.mcp.statusDescription')}
        >
          <MCPStatusBadge />
        </SettingRow>

        {agents.map((agent) => (
          <SettingRow
            key={agent.id}
            id={`mcp-agent-${agent.id}`}
            label={t('settings.mcp.addToAgent', { agent: agent.label })}
            description=""
          >
            <MCPAgentButton agentId={agent.id} agentLabel={agent.label} />
          </SettingRow>
        ))}
      </SettingSection>
    );
  };

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
          id="rebuild-templates"
          label={t('settings.data.rebuildTemplatesLabel')}
          description={t('settings.data.rebuildTemplatesDescription')}
        >
          <button
            className="secondary"
            onClick={async () => {
              showToast.loading(t('settings.toast.rebuildTemplatesLoading'));
              try {
                await window.electronAPI?.templates.rebuildFromFiles();
                showToast.dismiss();
                showToast.success(t('settings.toast.rebuildTemplatesSuccess'));
              } catch {
                showToast.dismiss();
                showToast.error(t('settings.toast.rebuildTemplatesFailed'));
              }
            }}
          >
            {t('settings.data.rebuildTemplatesAction')}
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
    sectionHasMatches(dataKeywords) ||
    sectionHasMatches(mcpKeywords);

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
            {renderMCPSettings()}
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
