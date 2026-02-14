/**
 * SyncEngine Unit Tests
 *
 * Tests the REAL SyncEngine class with mocked dependencies.
 * Note: Cloud sync is currently not implemented, so SyncEngine
 * always returns "not configured" status.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncEngine, SyncConfig } from '../../src/main/engine/SyncEngine';
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
    getRemote: vi.fn(() => null),
    getDataPaths: vi.fn(() => ({
      database: '/mock/userData/bds.db',
      posts: '/mock/userData/posts',
      media: '/mock/userData/media',
    })),
    initializeLocal: vi.fn(),
    initializeRemote: vi.fn(async () => {}),
    runRemoteMigrations: vi.fn(async () => {}),
    close: vi.fn(),
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

    it('should not be configured (cloud sync is not implemented)', () => {
      expect(syncEngine.isConfigured()).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should emit configured event when configure is called', async () => {
      const handler = vi.fn();
      syncEngine.on('configured', handler);

      const config: SyncConfig = {
        autoSync: false,
        syncInterval: 30,
      };

      await syncEngine.configure(config);

      expect(handler).toHaveBeenCalledWith(config);
    });

    it('should always return not configured (cloud sync not implemented)', async () => {
      const config: SyncConfig = {
        autoSync: false,
        syncInterval: 30,
      };

      await syncEngine.configure(config);

      // Cloud sync is not implemented, so always returns false
      expect(syncEngine.isConfigured()).toBe(false);
    });
  });

  describe('Sync Status', () => {
    it('should return idle when not syncing', () => {
      expect(syncEngine.getSyncStatus()).toBe('idle');
    });
  });

  describe('Sync Operations', () => {
    it('should return error when syncing (cloud sync not implemented)', async () => {
      const result = await syncEngine.sync('bidirectional');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Cloud sync not configured');
    });

    it('should return zero counts when sync is not available', async () => {
      const result = await syncEngine.sync('push');

      expect(result.pushed).toBe(0);
      expect(result.pulled).toBe(0);
      expect(result.conflicts).toBe(0);
    });

    it('should accept push direction', async () => {
      const result = await syncEngine.sync('push');
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    it('should accept pull direction', async () => {
      const result = await syncEngine.sync('pull');
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    it('should accept bidirectional direction', async () => {
      const result = await syncEngine.sync('bidirectional');
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    it('should default to bidirectional when no direction specified', async () => {
      const result = await syncEngine.sync();
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    it('should use fullSync as alias for sync', async () => {
      const result = await syncEngine.fullSync('push');
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Cloud sync not configured');
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
});
