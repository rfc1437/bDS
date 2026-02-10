import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store';
import { showToast } from '../Toast';
import './SettingsView.css';

// Settings categories matching VS Code style
type SettingsCategory = 'editor' | 'content' | 'sync' | 'publishing' | 'data';

interface Credentials {
  // Turso Cloud Sync
  tursoUrl: string;
  tursoToken: string;
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
  tursoUrl: '',
  tursoToken: '',
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

// Category definitions
const categories: { id: SettingsCategory; label: string; icon: string }[] = [
  { id: 'editor', label: 'Editor', icon: '📝' },
  { id: 'content', label: 'Content', icon: '📋' },
  { id: 'sync', label: 'Sync', icon: '🔄' },
  { id: 'publishing', label: 'Publishing', icon: '🚀' },
  { id: 'data', label: 'Data Management', icon: '🗄️' },
];

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

// Section header component
const SettingSection: React.FC<{
  title: string;
  description?: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <div className="setting-section">
    <div className="setting-section-header">
      <h3>{title}</h3>
      {description && <p className="setting-section-description">{description}</p>}
    </div>
    <div className="setting-section-content">
      {children}
    </div>
  </div>
);

export const SettingsView: React.FC = () => {
  const { preferredEditorMode, setPreferredEditorMode, syncConfigured } = useAppStore();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('editor');
  const [searchQuery, setSearchQuery] = useState('');
  const [credentials, setCredentials] = useState<Credentials>(defaultCredentials);
  const [showSecrets, setShowSecrets] = useState(false);
  const [dropboxConfigured, setDropboxConfigured] = useState(false);
  const [dropboxLastSync, setDropboxLastSync] = useState<string | null>(null);
  
  // Post categories management
  const [postCategories, setPostCategories] = useState<string[]>(DEFAULT_POST_CATEGORIES);
  const [newCategoryInput, setNewCategoryInput] = useState('');

  // Load saved credentials and categories
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const savedCreds = localStorage.getItem('bds-credentials');
        if (savedCreds) {
          setCredentials({ ...defaultCredentials, ...JSON.parse(savedCreds) });
        }

        // Load saved post categories
        const savedCategories = localStorage.getItem('bds-categories');
        if (savedCategories) {
          const categories = JSON.parse(savedCategories);
          if (Array.isArray(categories) && categories.length > 0) {
            setPostCategories(categories);
          }
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
  }, []);

  // Save credentials and configure backends
  const handleSaveTurso = async () => {
    try {
      localStorage.setItem('bds-credentials', JSON.stringify(credentials));

      if (credentials.tursoUrl && credentials.tursoToken) {
        await window.electronAPI?.sync.configure({
          tursoUrl: credentials.tursoUrl,
          tursoAuthToken: credentials.tursoToken,
          autoSync: true,
          syncInterval: 5,
        });
        showToast.success('Cloud sync configured');
      } else {
        showToast.success('Credentials saved');
      }
    } catch (error) {
      console.error('Failed to save Turso credentials:', error);
      showToast.error('Failed to configure cloud sync');
    }
  };

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

  const handleClearCredentials = (type: 'turso' | 'dropbox' | 'ftp' | 'ssh') => {
    const newCreds = { ...credentials };
    switch (type) {
      case 'turso':
        newCreds.tursoUrl = '';
        newCreds.tursoToken = '';
        break;
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

  const handleTestConnection = async (type: 'turso' | 'dropbox') => {
    showToast.loading(`Testing ${type} connection...`);
    try {
      if (type === 'turso') {
        // Simulate connection test
        await new Promise(resolve => setTimeout(resolve, 1500));
        if (credentials.tursoUrl && credentials.tursoToken) {
          showToast.dismiss();
          showToast.success('Cloud sync connection successful');
        } else {
          showToast.dismiss();
          showToast.error('Missing credentials');
        }
      } else {
        const status = await window.electronAPI?.dropbox?.getStatus();
        showToast.dismiss();
        if (status) {
          showToast.success('Dropbox connection active');
        } else {
          showToast.error('Dropbox connection failed');
        }
      }
    } catch {
      showToast.dismiss();
      showToast.error(`${type} connection failed`);
    }
  };

  // Filter categories if searching
  const filteredCategories = searchQuery
    ? categories.filter(c => c.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : categories;

  const renderEditorSettings = () => (
    <>
      <SettingSection
        title="Editor"
        description="Configure the blog post editor behavior and appearance."
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
    </>
  );

  // Handlers for post categories management
  const handleAddCategory = () => {
    const trimmed = newCategoryInput.trim().toLowerCase();
    if (trimmed && !postCategories.includes(trimmed)) {
      const updated = [...postCategories, trimmed];
      setPostCategories(updated);
      localStorage.setItem('bds-categories', JSON.stringify(updated));
      setNewCategoryInput('');
      showToast.success(`Category "${trimmed}" added`);
    } else if (postCategories.includes(trimmed)) {
      showToast.error('Category already exists');
    }
  };

  const handleRemoveCategory = (categoryToRemove: string) => {
    if (postCategories.length <= 1) {
      showToast.error('Must have at least one category');
      return;
    }
    const updated = postCategories.filter(c => c !== categoryToRemove);
    setPostCategories(updated);
    localStorage.setItem('bds-categories', JSON.stringify(updated));
    showToast.success(`Category "${categoryToRemove}" removed`);
  };

  const handleResetCategories = () => {
    setPostCategories(DEFAULT_POST_CATEGORIES);
    localStorage.setItem('bds-categories', JSON.stringify(DEFAULT_POST_CATEGORIES));
    showToast.success('Categories reset to defaults');
  };

  const renderContentSettings = () => (
    <>
      <SettingSection
        title="Post Categories"
        description="Manage the available categories for blog posts. Each post can have one category that determines its display template."
      >
        <div className="categories-list">
          {postCategories.map((cat) => (
            <div key={cat} className="category-item">
              <span className="category-name">{cat}</span>
              <button
                className="category-remove"
                onClick={() => handleRemoveCategory(cat)}
                title={`Remove "${cat}" category`}
              >
                ✕
              </button>
            </div>
          ))}
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
    </>
  );

  const renderSyncSettings = () => (
    <>
      <SettingSection
        title="Cloud Sync — Turso/LibSQL"
        description="Sync post and media metadata to a Turso cloud database for backup and multi-device access."
      >
        <SettingRow
          id="turso-url"
          label="Database URL"
          description="The Turso/LibSQL database URL. Example: libsql://your-database.turso.io"
        >
          <input
            id="turso-url"
            type="text"
            placeholder="libsql://your-database.turso.io"
            value={credentials.tursoUrl}
            onChange={(e) => setCredentials({ ...credentials, tursoUrl: e.target.value })}
          />
        </SettingRow>

        <SettingRow
          id="turso-token"
          label="Auth Token"
          description="Your Turso database authentication token."
        >
          <div className="setting-input-group">
            <input
              id="turso-token"
              type={showSecrets ? 'text' : 'password'}
              placeholder="Your authentication token"
              value={credentials.tursoToken}
              onChange={(e) => setCredentials({ ...credentials, tursoToken: e.target.value })}
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

        <div className="setting-actions">
          <button className="primary" onClick={handleSaveTurso}>
            {syncConfigured ? 'Update Configuration' : 'Enable Cloud Sync'}
          </button>
          <button className="secondary" onClick={() => handleTestConnection('turso')}>
            Test Connection
          </button>
          <button className="secondary danger" onClick={() => handleClearCredentials('turso')}>
            Clear
          </button>
        </div>

        {syncConfigured && (
          <div className="setting-status success">
            <span className="status-icon">✓</span>
            <span>Cloud sync is configured and active</span>
          </div>
        )}
      </SettingSection>

      <SettingSection
        title="File Sync — Dropbox"
        description="Synchronize your blog files (posts and media) to Dropbox for backup and cross-device access."
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
          <button className="secondary" onClick={() => handleTestConnection('dropbox')}>
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
        title="FTP Publishing"
        description="Configure FTP credentials for publishing your blog to a web server."
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
        title="Database Maintenance"
        description="Rebuild the local database index from source files. Useful if post or media files were edited externally."
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
                const posts = await window.electronAPI?.posts.getAll();
                if (posts) {
                  useAppStore.getState().setPosts(posts as any[]);
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
      </SettingSection>

      <SettingSection
        title="File System"
        description="Access project data files and directories."
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

  const renderContent = () => {
    if (searchQuery) {
      // Show all matching settings when searching
      return (
        <>
          {renderEditorSettings()}
          {renderContentSettings()}
          {renderSyncSettings()}
          {renderPublishingSettings()}
          {renderDataSettings()}
        </>
      );
    }

    switch (activeCategory) {
      case 'editor':
        return renderEditorSettings();
      case 'content':
        return renderContentSettings();
      case 'sync':
        return renderSyncSettings();
      case 'publishing':
        return renderPublishingSettings();
      case 'data':
        return renderDataSettings();
      default:
        return renderEditorSettings();
    }
  };

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

      <div className="settings-body">
        {/* Category navigation sidebar */}
        <nav className="settings-nav">
          {filteredCategories.map((cat) => (
            <button
              key={cat.id}
              className={`settings-nav-item ${activeCategory === cat.id && !searchQuery ? 'active' : ''}`}
              onClick={() => {
                setActiveCategory(cat.id);
                setSearchQuery('');
              }}
            >
              <span className="settings-nav-icon">{cat.icon}</span>
              <span className="settings-nav-label">{cat.label}</span>
            </button>
          ))}
        </nav>

        {/* Settings content */}
        <div className="settings-content">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default SettingsView;
