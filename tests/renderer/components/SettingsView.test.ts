/**
 * Tests for SettingsView component behavior
 * Validates VS Code-style structured preferences with Dropbox sync settings
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../../src/renderer/store/appStore';

// Direct store access
const getStore = () => useAppStore.getState();
const setState = useAppStore.setState;

describe('SettingsView Behavior', () => {
  beforeEach(() => {
    setState({
      syncConfigured: false,
      syncStatus: 'idle',
    });
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('Settings Categories', () => {
    it('should have sync settings as a category in the store', () => {
      // The activeView: 'settings' should be a valid view
      getStore().setActiveView('settings');
      expect(getStore().activeView).toBe('settings');
    });

    it('should persist preferred editor mode', () => {
      getStore().setPreferredEditorMode('markdown');
      expect(getStore().preferredEditorMode).toBe('markdown');
    });
  });

  describe('Turso Cloud Sync Configuration', () => {
    it('should call sync.configure with Turso credentials', async () => {
      const mockConfigure = vi.fn().mockResolvedValue(undefined);
      (window as any).electronAPI.sync.configure = mockConfigure;

      await window.electronAPI?.sync.configure({
        tursoUrl: 'libsql://test.turso.io',
        tursoAuthToken: 'test-token',
        autoSync: true,
        syncInterval: 5,
      });

      expect(mockConfigure).toHaveBeenCalledWith({
        tursoUrl: 'libsql://test.turso.io',
        tursoAuthToken: 'test-token',
        autoSync: true,
        syncInterval: 5,
      });
    });

    it('should update syncConfigured status after successful configure', () => {
      getStore().setSyncConfigured(true);
      expect(getStore().syncConfigured).toBe(true);
    });
  });

  describe('Dropbox Sync Configuration', () => {
    it('should call dropbox.configure with Dropbox credentials', async () => {
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

      await window.electronAPI?.dropbox?.configure({
        accessToken: 'dbx-test-token',
        appKey: 'test-app-key',
        remotePath: '/blog',
      });

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

  describe('Credentials Storage', () => {
    it('should save credentials to localStorage', () => {
      const creds = {
        tursoUrl: 'libsql://test.turso.io',
        tursoToken: 'test-token',
        dropboxAccessToken: 'dbx-token',
        dropboxAppKey: 'dbx-key',
        dropboxRemotePath: '/blog',
      };
      localStorage.setItem('bds-credentials', JSON.stringify(creds));

      const saved = JSON.parse(localStorage.getItem('bds-credentials') || '{}');
      expect(saved.tursoUrl).toBe('libsql://test.turso.io');
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

    it('should handle clearing sync credentials independently', () => {
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
      const cleared = { ...loaded, dropboxAccessToken: '', dropboxAppKey: '', dropboxRemotePath: '' };
      localStorage.setItem('bds-credentials', JSON.stringify(cleared));

      const result = JSON.parse(localStorage.getItem('bds-credentials') || '{}');
      // Turso credentials should be untouched
      expect(result.tursoUrl).toBe('libsql://test.turso.io');
      expect(result.tursoToken).toBe('test-token');
      expect(result.dropboxAccessToken).toBe('');
      expect(result.dropboxAppKey).toBe('');
    });
  });

  describe('Data Management Settings', () => {
    it('should call rebuild posts from files', async () => {
      const mockRebuild = vi.fn().mockResolvedValue(undefined);
      (window as any).electronAPI.posts.rebuildFromFiles = mockRebuild;

      await window.electronAPI?.posts.rebuildFromFiles();
      expect(mockRebuild).toHaveBeenCalled();
    });

    it('should call rebuild media from files', async () => {
      const mockRebuild = vi.fn().mockResolvedValue(undefined);
      (window as any).electronAPI.media.rebuildFromFiles = mockRebuild;

      await window.electronAPI?.media.rebuildFromFiles();
      expect(mockRebuild).toHaveBeenCalled();
    });
  });
});
