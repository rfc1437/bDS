import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';

// ── Chokidar mock ────────────────────────────────────────────────────────────

interface MockFSWatcher {
  on: MockedFunction<(event: string, handler: () => void) => MockFSWatcher>;
  close: MockedFunction<() => Promise<void>>;
}

let mockWatcher: MockFSWatcher;
let capturedWatchPaths: string[] = [];
let capturedWatchOptions: Record<string, unknown> = {};

vi.mock('chokidar', () => ({
  default: {
    watch: (paths: string[], options: Record<string, unknown>) => {
      capturedWatchPaths = paths;
      capturedWatchOptions = options;
      return mockWatcher;
    },
  },
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  NotificationWatcher,
  type WatchableEngines,
} from '../../src/main/engine/NotificationWatcher';

// ── DB mock helpers ─────────────────────────────────────────────────────────

type MockDb = {
  select: MockedFunction<() => {
    from: (table: unknown) => { where: MockedFunction<() => Promise<unknown[]>> };
  }>;
  update: MockedFunction<(table: unknown) => {
    set: (values: unknown) => { where: MockedFunction<() => Promise<void>> };
  }>;
  delete: MockedFunction<(table: unknown) => { where: MockedFunction<() => Promise<void>> }>;
};

function makeSelectChain(rows: unknown[]): ReturnType<MockDb['select']> {
  const whereSelect = vi.fn().mockResolvedValue(rows);
  return {
    from: (_table: unknown) => ({ where: whereSelect }),
  };
}

function makeUpdateChain(): ReturnType<MockDb['update']> {
  const whereUpdate = vi.fn().mockResolvedValue(undefined);
  return {
    set: (_values: unknown) => ({ where: whereUpdate }),
  };
}

function makeDeleteChain(): ReturnType<MockDb['delete']> {
  return { where: vi.fn().mockResolvedValue(undefined) };
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('NotificationWatcher', () => {
  const DB_PATH = '/home/user/.config/bDS/bds.db';

  let db: MockDb;
  let engines: WatchableEngines;
  let mockSend: MockedFunction<(channel: string, payload: unknown) => void>;
  let mainWindow: { webContents: { send: typeof mockSend } };
  let watcher: NotificationWatcher;

  beforeEach(() => {
    vi.useFakeTimers();

    mockWatcher = {
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    capturedWatchPaths = [];
    capturedWatchOptions = {};

    db = {
      select: vi.fn().mockReturnValue(makeSelectChain([])),
      update: vi.fn().mockReturnValue(makeUpdateChain()),
      delete: vi.fn().mockReturnValue(makeDeleteChain()),
    };

    engines = {
      post: { invalidate: vi.fn() },
      media: { invalidate: vi.fn() },
      script: { invalidate: vi.fn() },
      template: { invalidate: vi.fn() },
    };

    mockSend = vi.fn();
    mainWindow = { webContents: { send: mockSend } };

    watcher = new NotificationWatcher(DB_PATH, db as any, engines, mainWindow as any, 100);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── start() ───────────────────────────────────────────────────────────────

  describe('start()', () => {
    it('watches both db and wal paths', () => {
      watcher.start();
      expect(capturedWatchPaths).toEqual([DB_PATH, `${DB_PATH}-wal`]);
    });

    it('sets persistent:false and ignoreInitial:true', () => {
      watcher.start();
      expect(capturedWatchOptions.persistent).toBe(false);
      expect(capturedWatchOptions.ignoreInitial).toBe(true);
    });

    it('registers change and add handlers', () => {
      watcher.start();
      const events = mockWatcher.on.mock.calls.map((c) => c[0]);
      expect(events).toContain('change');
      expect(events).toContain('add');
    });

    it('debounces rapid file-change events', async () => {
      watcher.start();
      const changeHandler = mockWatcher.on.mock.calls.find((c) => c[0] === 'change')![1];

      db.select.mockReturnValue(makeSelectChain([]));

      changeHandler();
      changeHandler();
      changeHandler();

      expect(db.select).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);

      // Only one process() call despite three change events
      expect(db.select).toHaveBeenCalledTimes(1);
    });
  });

  // ── process() ─────────────────────────────────────────────────────────────

  describe('process()', () => {
    async function triggerProcess(rows: unknown[] = []): Promise<void> {
      db.select.mockReturnValue(makeSelectChain(rows));
      watcher.start();
      const changeHandler = mockWatcher.on.mock.calls.find((c) => c[0] === 'change')![1];
      changeHandler();
      await vi.advanceTimersByTimeAsync(100);
    }

    it('queries db_notifications for unprocessed CLI rows', async () => {
      await triggerProcess([]);
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('calls invalidate on the matching engine for each row', async () => {
      const rows = [
        { id: 1, entity: 'post', entityId: 'p1', action: 'created', fromCli: 1, seenAt: null, createdAt: Date.now() },
        { id: 2, entity: 'media', entityId: 'm1', action: 'updated', fromCli: 1, seenAt: null, createdAt: Date.now() },
      ];
      await triggerProcess(rows);

      expect(engines.post.invalidate).toHaveBeenCalledWith('p1');
      expect(engines.media.invalidate).toHaveBeenCalledWith('m1');
    });

    it('sends entity:changed IPC event for each row', async () => {
      const rows = [
        { id: 1, entity: 'post', entityId: 'p1', action: 'created', fromCli: 1, seenAt: null, createdAt: Date.now() },
        { id: 2, entity: 'script', entityId: 's1', action: 'deleted', fromCli: 1, seenAt: null, createdAt: Date.now() },
      ];
      await triggerProcess(rows);

      expect(mockSend).toHaveBeenCalledWith('entity:changed', {
        entity: 'post',
        entityId: 'p1',
        action: 'created',
      });
      expect(mockSend).toHaveBeenCalledWith('entity:changed', {
        entity: 'script',
        entityId: 's1',
        action: 'deleted',
      });
    });

    it('stamps seenAt on each processed row', async () => {
      const rows = [
        { id: 42, entity: 'post', entityId: 'p1', action: 'updated', fromCli: 1, seenAt: null, createdAt: Date.now() },
      ];
      db.select.mockReturnValue(makeSelectChain(rows));
      const updateChain = makeUpdateChain();
      db.update.mockReturnValue(updateChain);

      watcher.start();
      const changeHandler = mockWatcher.on.mock.calls.find((c) => c[0] === 'change')![1];
      changeHandler();
      await vi.advanceTimersByTimeAsync(100);

      expect(db.update).toHaveBeenCalledTimes(1);
    });

    it('prunes old seen rows (>1h) and old unprocessed rows (>24h)', async () => {
      await triggerProcess([]);
      // delete is called twice: once for seenAt > 1h, once for unprocessed > 24h
      expect(db.delete).toHaveBeenCalledTimes(2);
    });

    it('skips unknown entity types gracefully', async () => {
      const rows = [
        { id: 1, entity: 'unknown_entity', entityId: 'x1', action: 'created', fromCli: 1, seenAt: null, createdAt: Date.now() },
      ];
      await expect(triggerProcess(rows)).resolves.not.toThrow();
      // No IPC send for unknown entities, but the watcher finishes without error
    });
  });

  // ── stop() ────────────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('closes the file watcher', () => {
      watcher.start();
      watcher.stop();
      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it('cancels a pending debounce timer', async () => {
      watcher.start();
      const changeHandler = mockWatcher.on.mock.calls.find((c) => c[0] === 'change')![1];
      changeHandler();

      watcher.stop();
      await vi.advanceTimersByTimeAsync(200);

      // process() must NOT have run after stop
      expect(db.select).not.toHaveBeenCalled();
    });

    it('does not throw if called before start()', () => {
      expect(() => watcher.stop()).not.toThrow();
    });
  });
});
