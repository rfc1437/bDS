import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../store';
import { showToast } from '../Toast';
import './SettingsView.css';

// Export category IDs for sidebar navigation
export type SettingsCategory = 'project' | 'editor' | 'content' | 'ai' | 'sync' | 'publishing' | 'data';

// Scroll to a settings section by category ID
export const scrollToSettingsSection = (category: SettingsCategory) => {
  const element = document.getElementById(`settings-section-${category}`);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

// Settings categories

interface Credentials {
  // Dropbox File Sync
  dropboxAccessToken: string;
  dropboxAppKey: string;
  dropboxRemotePath: string;
  // FTP Publishing
  ftpHost: string;
  ftpUser: string;
  ftpPassword: string;
  // SSH Publishing
  sshHost: string;
  sshUser: string;
  sshKeyPath: string;
}

const defaultCredentials: Credentials = {
  dropboxAccessToken: '',
  dropboxAppKey: '',
  dropboxRemotePath: '/blog',
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
  const { preferredEditorMode, setPreferredEditorMode, activeProject, setActiveProject } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [credentials, setCredentials] = useState<Credentials>(defaultCredentials);
  const [showSecrets, setShowSecrets] = useState(false);
  const [dropboxConfigured, setDropboxConfigured] = useState(false);
  const [dropboxLastSync, setDropboxLastSync] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Project settings
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');

  // Post categories management
  const [postCategories, setPostCategories] = useState<string[]>(DEFAULT_POST_CATEGORIES);
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
        } else {
          // Initialize with defaults if no categories exist
          setPostCategories(DEFAULT_POST_CATEGORIES);
        }

        // Load AI settings
        try {
          const promptResult = await window.electronAPI?.chat.getSystemPrompt();
          if (promptResult?.success && promptResult.prompt) {
            setAiSystemPrompt(promptResult.prompt);
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

        // Check Dropbox status
        const dbxConfigured = await window.electronAPI?.dropbox?.isConfigured();
        setDropboxConfigured(dbxConfigured || false);
        
        if (dbxConfigured) {
          const lastSync = await window.electronAPI?.dropbox?.getLastSyncTime();
          setDropboxLastSync(lastSync || null);
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    };
    loadSettings();
  }, [activeProject?.id]); // Reload when project changes

  const handleSaveDropbox = async () => {
    try {
      localStorage.setItem('bds-credentials', JSON.stringify(credentials));

      if (credentials.dropboxAccessToken && credentials.dropboxAppKey) {
        await window.electronAPI?.dropbox?.configure({
          accessToken: credentials.dropboxAccessToken,
          appKey: credentials.dropboxAppKey,
          remotePath: credentials.dropboxRemotePath || '/blog',
        });
        setDropboxConfigured(true);
        showToast.success('Dropbox sync configured');
      } else {
        showToast.success('Credentials saved');
      }
    } catch (error) {
      console.error('Failed to save Dropbox credentials:', error);
      showToast.error('Failed to configure Dropbox sync');
    }
  };

  const handleSavePublishing = async () => {
    try {
      localStorage.setItem('bds-credentials', JSON.stringify(credentials));
      showToast.success('Publishing credentials saved');
    } catch (error) {
      console.error('Failed to save publishing credentials:', error);
      showToast.error('Failed to save credentials');
    }
  };

  const handleClearCredentials = (type: 'dropbox' | 'ftp' | 'ssh') => {
    const newCreds = { ...credentials };
    switch (type) {
      case 'dropbox':
        newCreds.dropboxAccessToken = '';
        newCreds.dropboxAppKey = '';
        newCreds.dropboxRemotePath = '/blog';
        break;
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

  const handleDropboxSync = async () => {
    try {
      showToast.loading('Starting Dropbox sync...');
      await window.electronAPI?.dropbox?.syncAll();
      showToast.dismiss();
      showToast.success('Dropbox sync completed');
      const lastSync = await window.electronAPI?.dropbox?.getLastSyncTime();
      setDropboxLastSync(lastSync || null);
    } catch (error) {
      showToast.dismiss();
      showToast.error('Dropbox sync failed');
    }
  };

  const handleTestDropboxConnection = async () => {
    showToast.loading('Testing Dropbox connection...');
    try {
      const status = await window.electronAPI?.dropbox?.getStatus();
      showToast.dismiss();
      if (status) {
        showToast.success('Dropbox connection active');
      } else {
        showToast.error('Dropbox connection failed');
      }
    } catch {
      showToast.dismiss();
      showToast.error('Dropbox connection failed');
    }
  };

  // Save project settings
  const handleSaveProject = async () => {
    if (!activeProject) return;
    try {
      const updated = await window.electronAPI?.projects.update(activeProject.id, {
        name: projectName.trim() || activeProject.name,
        description: projectDescription.trim(),
      });
      if (updated) {
        setActiveProject(updated as any);
        useAppStore.getState().updateProject(activeProject.id, updated as any);
      }
      showToast.success('Project settings saved');
    } catch (error) {
      console.error('Failed to save project settings:', error);
      showToast.error('Failed to save project settings');
    }
  };

  // Keywords for each section for search filtering
  const projectKeywords = ['project', 'name', 'description', 'blog', 'site'];
  const editorKeywords = ['editor', 'mode', 'wysiwyg', 'markdown', 'preview', 'visual'];
  const contentKeywords = ['content', 'categories', 'post', 'article', 'picture', 'aside', 'page'];
  const aiKeywords = ['ai', 'assistant', 'chat', 'model', 'prompt', 'system', 'api', 'key', 'claude', 'gpt', 'opencode'];
  const syncKeywords = ['sync', 'dropbox', 'file', 'backup', 'token', 'remote'];
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
      showToast.success('Categories reset to defaults');
    } catch (error) {
      console.error('Failed to reset categories:', error);
      showToast.error('Failed to reset categories');
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
            return (
            <div key={cat} className="category-item">
              <span className="category-name">{cat}{isProtected && ' (standard)'}</span>
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
      if (result?.prompt) {
        setAiSystemPrompt(result.prompt);
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

  const renderSyncSettings = () => (
    <>
      <SettingSection
        id="settings-section-sync"
        title="File Sync — Dropbox"
        description="Synchronize your blog files (posts and media) to Dropbox for backup and cross-device access."
        hidden={!sectionHasMatches(syncKeywords)}
      >
        <SettingRow
          id="dropbox-token"
          label="Access Token"
          description="Your Dropbox API access token. Generate one from the Dropbox App Console."
        >
          <div className="setting-input-group">
            <input
              id="dropbox-token"
              type={showSecrets ? 'text' : 'password'}
              placeholder="Your Dropbox access token"
              value={credentials.dropboxAccessToken}
              onChange={(e) => setCredentials({ ...credentials, dropboxAccessToken: e.target.value })}
            />
            <button
              className="setting-toggle-visibility"
              onClick={() => setShowSecrets(!showSecrets)}
              title={showSecrets ? 'Hide secrets' : 'Show secrets'}
            >
              {showSecrets ? '🔒' : '👁'}
            </button>
          </div>
        </SettingRow>

        <SettingRow
          id="dropbox-appkey"
          label="App Key"
          description="The App Key from your Dropbox developer application."
        >
          <input
            id="dropbox-appkey"
            type="text"
            placeholder="Your Dropbox App Key"
            value={credentials.dropboxAppKey}
            onChange={(e) => setCredentials({ ...credentials, dropboxAppKey: e.target.value })}
          />
        </SettingRow>

        <SettingRow
          id="dropbox-path"
          label="Remote Path"
          description="The folder path in Dropbox where blog files will be synced. Default: /blog"
        >
          <input
            id="dropbox-path"
            type="text"
            placeholder="/blog"
            value={credentials.dropboxRemotePath}
            onChange={(e) => setCredentials({ ...credentials, dropboxRemotePath: e.target.value })}
          />
        </SettingRow>

        <div className="setting-actions">
          <button className="primary" onClick={handleSaveDropbox}>
            {dropboxConfigured ? 'Update Configuration' : 'Enable Dropbox Sync'}
          </button>
          <button className="secondary" onClick={handleTestDropboxConnection}>
            Test Connection
          </button>
          {dropboxConfigured && (
            <button className="secondary" onClick={handleDropboxSync}>
              Sync Now
            </button>
          )}
          <button className="secondary danger" onClick={() => handleClearCredentials('dropbox')}>
            Clear
          </button>
        </div>

        {dropboxConfigured && (
          <div className="setting-status success">
            <span className="status-icon">✓</span>
            <span>
              Dropbox sync is configured
              {dropboxLastSync && (
                <span className="status-detail"> · Last sync: {new Date(dropboxLastSync).toLocaleString()}</span>
              )}
            </span>
          </div>
        )}
      </SettingSection>
    </>
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
          <input
            id="ftp-password"
            type={showSecrets ? 'text' : 'password'}
            placeholder="Password"
            value={credentials.ftpPassword}
            onChange={(e) => setCredentials({ ...credentials, ftpPassword: e.target.value })}
          />
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
    sectionHasMatches(syncKeywords) ||
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
            {renderSyncSettings()}
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
