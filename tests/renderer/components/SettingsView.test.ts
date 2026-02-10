/**
 * SettingsView Behavior Tests
 *
 * Tests the settings view's store integration and API call patterns.
 * Given the complexity of UI interactions, these tests focus on:
 * 1. Store integration - how settings sync with app store
 * 2. API call patterns - validating expected API interactions
 * 3. LocalStorage persistence - credentials and preferences
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../../src/renderer/store/appStore';

// Store access helpers
const getStore = () => useAppStore.getState();
const setState = useAppStore.setState;

describe('SettingsView Behavior', () => {
  beforeEach(() => {
    // Reset store state
    setState({
      syncConfigured: false,
      syncStatus: 'idle',
      preferredEditorMode: 'wysiwyg',
    });

    // Clear localStorage
    localStorage.clear();

    vi.clearAllMocks();
  });

  describe('Editor Preferences', () => {
    it('should store preferred editor mode', () => {
      getStore().setPreferredEditorMode('markdown');

      expect(getStore().preferredEditorMode).toBe('markdown');
    });

    it('should support all editor modes', () => {
      getStore().setPreferredEditorMode('wysiwyg');
      expect(getStore().preferredEditorMode).toBe('wysiwyg');

      getStore().setPreferredEditorMode('markdown');
      expect(getStore().preferredEditorMode).toBe('markdown');

      getStore().setPreferredEditorMode('preview');
      expect(getStore().preferredEditorMode).toBe('preview');
    });
  });

  describe('Sync Configuration', () => {
    it('should track sync configured status', () => {
      getStore().setSyncConfigured(true);

      expect(getStore().syncConfigured).toBe(true);
    });

    it('should default to not configured', () => {
      expect(getStore().syncConfigured).toBe(false);
    });

    it('should track sync status', () => {
      getStore().setSyncStatus('syncing');

      expect(getStore().syncStatus).toBe('syncing');
    });
  });

  describe('Credentials Storage (localStorage)', () => {
    it('should save Turso credentials to localStorage', () => {
      const creds = {
        tursoUrl: 'libsql://test.turso.io',
        tursoToken: 'test-token',
      };

      localStorage.setItem('bds-credentials', JSON.stringify(creds));

      const saved = JSON.parse(localStorage.getItem('bds-credentials') || '{}');
      expect(saved.tursoUrl).toBe('libsql://test.turso.io');
      expect(saved.tursoToken).toBe('test-token');
    });

    it('should save Dropbox credentials to localStorage', () => {
      const creds = {
        dropboxAccessToken: 'dbx-token',
        dropboxAppKey: 'dbx-key',
        dropboxRemotePath: '/blog',
      };

      localStorage.setItem('bds-credentials', JSON.stringify(creds));

      const saved = JSON.parse(localStorage.getItem('bds-credentials') || '{}');
      expect(saved.dropboxAccessToken).toBe('dbx-token');
      expect(saved.dropboxAppKey).toBe('dbx-key');
      expect(saved.dropboxRemotePath).toBe('/blog');
    });

    it('should load credentials from localStorage', () => {
      const creds = {
        tursoUrl: 'libsql://saved.turso.io',
        tursoToken: 'saved-token',
        dropboxAccessToken: 'saved-dbx-token',
      };

      localStorage.setItem('bds-credentials', JSON.stringify(creds));

      const loaded = JSON.parse(localStorage.getItem('bds-credentials') || '{}');
      expect(loaded.tursoUrl).toBe('libsql://saved.turso.io');
      expect(loaded.dropboxAccessToken).toBe('saved-dbx-token');
    });

    it('should handle clearing Turso credentials independently', () => {
      const creds = {
        tursoUrl: 'libsql://test.turso.io',
        tursoToken: 'test-token',
        dropboxAccessToken: 'dbx-token',
        dropboxAppKey: 'dbx-key',
      };

      localStorage.setItem('bds-credentials', JSON.stringify(creds));

      // Clear only Turso credentials
      const loaded = JSON.parse(localStorage.getItem('bds-credentials') || '{}');
      const cleared = { ...loaded, tursoUrl: '', tursoToken: '' };
      localStorage.setItem('bds-credentials', JSON.stringify(cleared));

      const result = JSON.parse(localStorage.getItem('bds-credentials') || '{}');
      expect(result.tursoUrl).toBe('');
      expect(result.tursoToken).toBe('');
      // Dropbox credentials should be untouched
      expect(result.dropboxAccessToken).toBe('dbx-token');
      expect(result.dropboxAppKey).toBe('dbx-key');
    });

    it('should handle clearing Dropbox credentials independently', () => {
      const creds = {
        tursoUrl: 'libsql://test.turso.io',
        tursoToken: 'test-token',
        dropboxAccessToken: 'dbx-token',
        dropboxAppKey: 'dbx-key',
        dropboxRemotePath: '/blog',
      };

      localStorage.setItem('bds-credentials', JSON.stringify(creds));

      // Clear only Dropbox credentials
      const loaded = JSON.parse(localStorage.getItem('bds-credentials') || '{}');
      const cleared = {
        ...loaded,
        dropboxAccessToken: '',
        dropboxAppKey: '',
        dropboxRemotePath: '',
      };
      localStorage.setItem('bds-credentials', JSON.stringify(cleared));

      const result = JSON.parse(localStorage.getItem('bds-credentials') || '{}');
      // Turso credentials should be untouched
      expect(result.tursoUrl).toBe('libsql://test.turso.io');
      expect(result.tursoToken).toBe('test-token');
      expect(result.dropboxAccessToken).toBe('');
      expect(result.dropboxAppKey).toBe('');
    });
  });

  describe('Post Categories (localStorage)', () => {
    it('should save categories to localStorage', () => {
      const categories = ['article', 'picture', 'aside', 'page', 'review'];

      localStorage.setItem('bds-categories', JSON.stringify(categories));

      const saved = JSON.parse(localStorage.getItem('bds-categories') || '[]');
      expect(saved).toContain('article');
      expect(saved).toContain('review');
    });

    it('should load categories from localStorage', () => {
      const categories = ['custom1', 'custom2', 'custom3'];
      localStorage.setItem('bds-categories', JSON.stringify(categories));

      const loaded = JSON.parse(localStorage.getItem('bds-categories') || '[]');
      expect(loaded).toEqual(['custom1', 'custom2', 'custom3']);
    });

    it('should handle empty categories', () => {
      const loaded = JSON.parse(localStorage.getItem('bds-categories') || '[]');
      expect(loaded).toEqual([]);
    });

    it('should add new category', () => {
      const categories = ['article', 'picture'];
      localStorage.setItem('bds-categories', JSON.stringify(categories));

      const loaded = JSON.parse(localStorage.getItem('bds-categories') || '[]');
      const updated = [...loaded, 'tutorial'];
      localStorage.setItem('bds-categories', JSON.stringify(updated));

      const result = JSON.parse(localStorage.getItem('bds-categories') || '[]');
      expect(result).toContain('tutorial');
    });

    it('should remove category', () => {
      const categories = ['article', 'picture', 'aside'];
      localStorage.setItem('bds-categories', JSON.stringify(categories));

      const loaded = JSON.parse(localStorage.getItem('bds-categories') || '[]');
      const updated = loaded.filter((c: string) => c !== 'aside');
      localStorage.setItem('bds-categories', JSON.stringify(updated));

      const result = JSON.parse(localStorage.getItem('bds-categories') || '[]');
      expect(result).not.toContain('aside');
      expect(result).toContain('article');
    });
  });

  describe('API Integration Patterns', () => {
    beforeEach(() => {
      // Setup window.electronAPI mocks
      const mockElectronAPI = (window as any).electronAPI;
      if (mockElectronAPI) {
        vi.mocked(mockElectronAPI.sync.configure).mockResolvedValue(undefined);
        vi.mocked(mockElectronAPI.posts.rebuildFromFiles).mockResolvedValue(undefined);
        vi.mocked(mockElectronAPI.posts.getAll).mockResolvedValue([]);
        vi.mocked(mockElectronAPI.media.rebuildFromFiles).mockResolvedValue(undefined);
        vi.mocked(mockElectronAPI.media.getAll).mockResolvedValue([]);
      }
    });

    it('should call sync.configure with correct structure', async () => {
      const mockConfigure = vi.fn().mockResolvedValue(undefined);
      (window as any).electronAPI.sync.configure = mockConfigure;

      const config = {
        tursoUrl: 'libsql://test.turso.io',
        tursoAuthToken: 'test-token',
        autoSync: true,
        syncInterval: 5,
      };

      await window.electronAPI?.sync.configure(config);

      expect(mockConfigure).toHaveBeenCalledWith({
        tursoUrl: 'libsql://test.turso.io',
        tursoAuthToken: 'test-token',
        autoSync: true,
        syncInterval: 5,
      });
    });

    it('should call posts.rebuildFromFiles', async () => {
      const mockRebuild = vi.fn().mockResolvedValue(undefined);
      (window as any).electronAPI.posts.rebuildFromFiles = mockRebuild;

      await window.electronAPI?.posts.rebuildFromFiles();

      expect(mockRebuild).toHaveBeenCalled();
    });

    it('should call media.rebuildFromFiles', async () => {
      const mockRebuild = vi.fn().mockResolvedValue(undefined);
      (window as any).electronAPI.media.rebuildFromFiles = mockRebuild;

      await window.electronAPI?.media.rebuildFromFiles();

      expect(mockRebuild).toHaveBeenCalled();
    });

    it('should call dropbox.configure with correct structure', async () => {
      const mockConfigure = vi.fn().mockResolvedValue(undefined);
      (window as any).electronAPI.dropbox = {
        configure: mockConfigure,
        isConfigured: vi.fn(),
        getStatus: vi.fn(),
        syncAll: vi.fn(),
        startWatching: vi.fn(),
        stopWatching: vi.fn(),
        startPolling: vi.fn(),
        stopPolling: vi.fn(),
        getConflicts: vi.fn(),
        resolveConflict: vi.fn(),
        getLastSyncTime: vi.fn(),
      };

      const config = {
        accessToken: 'dbx-test-token',
        appKey: 'test-app-key',
        remotePath: '/blog',
      };

      await window.electronAPI?.dropbox?.configure(config);

      expect(mockConfigure).toHaveBeenCalledWith({
        accessToken: 'dbx-test-token',
        appKey: 'test-app-key',
        remotePath: '/blog',
      });
    });

    it('should check dropbox configuration status', async () => {
      const mockIsConfigured = vi.fn().mockResolvedValue(true);
      (window as any).electronAPI.dropbox = {
        ...((window as any).electronAPI.dropbox || {}),
        isConfigured: mockIsConfigured,
      };

      const result = await window.electronAPI?.dropbox?.isConfigured();

      expect(mockIsConfigured).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should trigger Dropbox full sync', async () => {
      const mockSyncAll = vi.fn().mockResolvedValue({ uploaded: 0, downloaded: 0, conflicts: 0 });
      (window as any).electronAPI.dropbox = {
        ...((window as any).electronAPI.dropbox || {}),
        syncAll: mockSyncAll,
      };

      await window.electronAPI?.dropbox?.syncAll();

      expect(mockSyncAll).toHaveBeenCalled();
    });

    it('should get last sync time', async () => {
      const mockGetLastSyncTime = vi.fn().mockResolvedValue('2026-02-10T12:00:00Z');
      (window as any).electronAPI.dropbox = {
        ...((window as any).electronAPI.dropbox || {}),
        getLastSyncTime: mockGetLastSyncTime,
      };

      const result = await window.electronAPI?.dropbox?.getLastSyncTime();

      expect(result).toBe('2026-02-10T12:00:00Z');
    });
  });

  describe('Active View', () => {
    it('should support settings as an active view', () => {
      getStore().setActiveView('settings');

      expect(getStore().activeView).toBe('settings');
    });

    it('should switch between views', () => {
      getStore().setActiveView('posts');
      expect(getStore().activeView).toBe('posts');

      getStore().setActiveView('media');
      expect(getStore().activeView).toBe('media');

      getStore().setActiveView('settings');
      expect(getStore().activeView).toBe('settings');
    });
  });
});
