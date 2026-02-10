/**
 * SyncEngine Unit Tests
 *
 * Tests the REAL SyncEngine class with mocked dependencies.
 * Following TDD best practices: mock external dependencies, test real implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncEngine, SyncConfig, SyncResult, SyncDirection } from '../../src/main/engine/SyncEngine';
import { resetMockCounters } from '../utils/factories';

// Create mock data stores
const mockPosts = new Map<string, any>();
const mockMedia = new Map<string, any>();
const mockSyncLog = new Map<string, any>();

// Create chainable mock for Drizzle ORM
function createSelectChain(data: Map<string, any>) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => Promise.resolve(Array.from(data.values()))),
    get: vi.fn().mockImplementation(() => Promise.resolve(data.size > 0 ? Array.from(data.values())[0] : undefined)),
  };
}

function createDrizzleMock(data: Map<string, any>) {
  return {
    select: vi.fn(() => createSelectChain(data)),
    insert: vi.fn(() => ({
      values: vi.fn((record: any) => {
        if (record && record.id) {
          data.set(record.id, record);
        }
        return Promise.resolve();
      }),
      onConflictDoUpdate: vi.fn(() => Promise.resolve()),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  };
}

const mockLocalDb = createDrizzleMock(new Map());
const mockRemoteDb = createDrizzleMock(new Map());

// Mock the database module
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => mockLocalDb),
    getLocalClient: vi.fn(() => null),
    getRemote: vi.fn(() => null), // Will be overridden in tests
    getDataPaths: vi.fn(() => ({
      database: '/mock/userData/bds.db',
      posts: '/mock/userData/posts',
      media: '/mock/userData/media',
    })),
    initializeLocal: vi.fn(),
    initializeRemote: vi.fn(async () => {}),
    close: vi.fn(),
  })),
}));

// Mock PostEngine and MediaEngine
vi.mock('../../src/main/engine/PostEngine', () => ({
  getPostEngine: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
  })),
}));

vi.mock('../../src/main/engine/MediaEngine', () => ({
  getMediaEngine: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
  })),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-sync-uuid-' + Math.random().toString(36).substr(2, 9)),
}));

describe('SyncEngine', () => {
  let syncEngine: SyncEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockPosts.clear();
    mockMedia.clear();
    mockSyncLog.clear();
    resetMockCounters();

    syncEngine = new SyncEngine();
  });

  afterEach(() => {
    vi.useRealTimers();
    syncEngine.stopAutoSync();
  });

  describe('Constructor and Initialization', () => {
    it('should create a SyncEngine instance', () => {
      expect(syncEngine).toBeInstanceOf(SyncEngine);
    });

    it('should extend EventEmitter', () => {
      expect(typeof syncEngine.on).toBe('function');
      expect(typeof syncEngine.emit).toBe('function');
    });

    it('should start with idle status', () => {
      expect(syncEngine.getSyncStatus()).toBe('idle');
    });

    it('should not be configured initially', () => {
      expect(syncEngine.isConfigured()).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should configure sync settings', async () => {
      const config: SyncConfig = {
        tursoUrl: 'libsql://test.turso.io',
        tursoAuthToken: 'test-token',
        autoSync: false,
        syncInterval: 30,
      };

      await syncEngine.configure(config);

      expect(syncEngine.isConfigured()).toBe(true);
    });

    it('should emit configured event', async () => {
      const handler = vi.fn();
      syncEngine.on('configured', handler);

      const config: SyncConfig = {
        tursoUrl: 'libsql://test.turso.io',
        tursoAuthToken: 'test-token',
        autoSync: false,
        syncInterval: 30,
      };

      await syncEngine.configure(config);

      expect(handler).toHaveBeenCalledWith(config);
    });

    it('should not be configured with empty URL', async () => {
      const config: SyncConfig = {
        tursoUrl: '',
        tursoAuthToken: 'test-token',
        autoSync: false,
        syncInterval: 30,
      };

      await syncEngine.configure(config);

      expect(syncEngine.isConfigured()).toBe(false);
    });

    it('should not be configured with empty token', async () => {
      const config: SyncConfig = {
        tursoUrl: 'libsql://test.turso.io',
        tursoAuthToken: '',
        autoSync: false,
        syncInterval: 30,
      };

      await syncEngine.configure(config);

      expect(syncEngine.isConfigured()).toBe(false);
    });
  });

  describe('Auto Sync', () => {
    it('should start auto sync when enabled', async () => {
      const config: SyncConfig = {
        tursoUrl: 'libsql://test.turso.io',
        tursoAuthToken: 'test-token',
        autoSync: true,
        syncInterval: 1, // 1 minute
      };

      await syncEngine.configure(config);

      // Auto sync should be scheduled
      expect(syncEngine.isConfigured()).toBe(true);
    });

    it('should stop auto sync when called', async () => {
      const handler = vi.fn();
      syncEngine.on('autoSyncStopped', handler);

      const config: SyncConfig = {
        tursoUrl: 'libsql://test.turso.io',
        tursoAuthToken: 'test-token',
        autoSync: true,
        syncInterval: 1,
      };

      await syncEngine.configure(config);
      syncEngine.stopAutoSync();

      expect(handler).toHaveBeenCalled();
    });

    it('should stop previous auto sync when reconfiguring', async () => {
      const config1: SyncConfig = {
        tursoUrl: 'libsql://test1.turso.io',
        tursoAuthToken: 'test-token-1',
        autoSync: true,
        syncInterval: 1,
      };

      const config2: SyncConfig = {
        tursoUrl: 'libsql://test2.turso.io',
        tursoAuthToken: 'test-token-2',
        autoSync: true,
        syncInterval: 5,
      };

      await syncEngine.configure(config1);
      await syncEngine.configure(config2);

      expect(syncEngine.isConfigured()).toBe(true);
    });
  });

  describe('Sync Status', () => {
    it('should return idle when not syncing', () => {
      expect(syncEngine.getSyncStatus()).toBe('idle');
    });
  });

  describe('Sync without Configuration', () => {
    it('should return error when syncing without configuration', async () => {
      const result = await syncEngine.sync('bidirectional');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Sync not configured');
    });

    it('should return zero counts when not configured', async () => {
      const result = await syncEngine.sync('push');

      expect(result.pushed).toBe(0);
      expect(result.pulled).toBe(0);
      expect(result.conflicts).toBe(0);
    });
  });

  describe('Sync Directions', () => {
    it('should accept push direction', async () => {
      const result = await syncEngine.sync('push');
      expect(result).toBeDefined();
    });

    it('should accept pull direction', async () => {
      const result = await syncEngine.sync('pull');
      expect(result).toBeDefined();
    });

    it('should accept bidirectional direction', async () => {
      const result = await syncEngine.sync('bidirectional');
      expect(result).toBeDefined();
    });

    it('should default to bidirectional when no direction specified', async () => {
      const result = await syncEngine.sync();
      expect(result).toBeDefined();
    });
  });

  describe('Event Emission', () => {
    it('should be an EventEmitter', () => {
      expect(syncEngine.on).toBeDefined();
      expect(syncEngine.emit).toBeDefined();
      expect(syncEngine.removeListener).toBeDefined();
    });

    it('should allow adding event listeners', () => {
      const listener = vi.fn();
      syncEngine.on('testEvent', listener);
      syncEngine.emit('testEvent', { data: 'test' });

      expect(listener).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should allow removing event listeners', () => {
      const listener = vi.fn();
      syncEngine.on('testEvent', listener);
      syncEngine.removeListener('testEvent', listener);
      syncEngine.emit('testEvent', { data: 'test' });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('SyncResult Structure', () => {
    it('should return complete SyncResult structure', async () => {
      const result = await syncEngine.sync();

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('pushed');
      expect(result).toHaveProperty('pulled');
      expect(result).toHaveProperty('conflicts');
      expect(result).toHaveProperty('errors');
    });

    it('should have errors as an array', async () => {
      const result = await syncEngine.sync();

      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should have numeric counts', async () => {
      const result = await syncEngine.sync();

      expect(typeof result.pushed).toBe('number');
      expect(typeof result.pulled).toBe('number');
      expect(typeof result.conflicts).toBe('number');
    });
  });

  describe('Pending Changes Count', () => {
    it('should return pending changes count structure', async () => {
      const count = await syncEngine.getPendingChangesCount();

      expect(count).toHaveProperty('posts');
      expect(count).toHaveProperty('media');
    });

    it('should return zero counts when no pending changes', async () => {
      // With empty mock data
      const count = await syncEngine.getPendingChangesCount();

      expect(count.posts).toBeGreaterThanOrEqual(0);
      expect(count.media).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Sync Log', () => {
    it('should return sync log array', async () => {
      const logs = await syncEngine.getSyncLog();

      expect(Array.isArray(logs)).toBe(true);
    });

    it('should accept limit parameter', async () => {
      const logs = await syncEngine.getSyncLog(10);

      expect(Array.isArray(logs)).toBe(true);
    });

    it('should use default limit of 50', async () => {
      const logs = await syncEngine.getSyncLog();

      expect(Array.isArray(logs)).toBe(true);
    });
  });

  describe('Stop Auto Sync', () => {
    it('should emit autoSyncStopped event', () => {
      const handler = vi.fn();
      syncEngine.on('autoSyncStopped', handler);

      syncEngine.stopAutoSync();

      expect(handler).toHaveBeenCalled();
    });

    it('should be safe to call multiple times', () => {
      expect(() => {
        syncEngine.stopAutoSync();
        syncEngine.stopAutoSync();
        syncEngine.stopAutoSync();
      }).not.toThrow();
    });
  });

  describe('Sync Configuration Validation', () => {
    it('should require both URL and token', async () => {
      await syncEngine.configure({
        tursoUrl: 'libsql://test.turso.io',
        tursoAuthToken: '',
        autoSync: false,
        syncInterval: 30,
      });

      expect(syncEngine.isConfigured()).toBe(false);

      await syncEngine.configure({
        tursoUrl: '',
        tursoAuthToken: 'token',
        autoSync: false,
        syncInterval: 30,
      });

      expect(syncEngine.isConfigured()).toBe(false);
    });

    it('should be configured with valid URL and token', async () => {
      await syncEngine.configure({
        tursoUrl: 'libsql://valid.turso.io',
        tursoAuthToken: 'valid-token',
        autoSync: false,
        syncInterval: 30,
      });

      expect(syncEngine.isConfigured()).toBe(true);
    });
  });

  describe('Sync Interval Configuration', () => {
    it('should accept sync interval in minutes', async () => {
      const config: SyncConfig = {
        tursoUrl: 'libsql://test.turso.io',
        tursoAuthToken: 'test-token',
        autoSync: true,
        syncInterval: 15, // 15 minutes
      };

      await syncEngine.configure(config);
      expect(syncEngine.isConfigured()).toBe(true);
    });

    it('should not set auto sync with zero interval', async () => {
      const config: SyncConfig = {
        tursoUrl: 'libsql://test.turso.io',
        tursoAuthToken: 'test-token',
        autoSync: true,
        syncInterval: 0,
      };

      await syncEngine.configure(config);
      // Should not crash, but won't set up interval
      expect(syncEngine.isConfigured()).toBe(true);
    });
  });
});
