import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoopNotifier, DbNotifier, type NotifyEntity, type NotifyAction } from '../../src/main/engine/CliNotifier';
import { dbNotifications } from '../../src/main/database/schema';

describe('NoopNotifier', () => {
  it('resolves without side effects', async () => {
    const notifier = new NoopNotifier();
    await expect(notifier.notify('post', 'p-1', 'created')).resolves.toBeUndefined();
  });

  it('accepts every valid entity and action combination', async () => {
    const notifier = new NoopNotifier();
    const entities: NotifyEntity[] = ['post', 'media', 'script', 'template'];
    const actions: NotifyAction[] = ['created', 'updated', 'deleted'];

    for (const entity of entities) {
      for (const action of actions) {
        await expect(notifier.notify(entity, 'id-1', action)).resolves.toBeUndefined();
      }
    }
  });
});

describe('DbNotifier', () => {
  let valuesFn: ReturnType<typeof vi.fn>;
  let insertFn: ReturnType<typeof vi.fn>;
  let mockDb: { insert: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    valuesFn = vi.fn().mockResolvedValue(undefined);
    insertFn = vi.fn().mockReturnValue({ values: valuesFn });
    mockDb = { insert: insertFn };
  });

  it('inserts a notification row into db_notifications', async () => {
    const notifier = new DbNotifier(mockDb);
    const beforeMs = Date.now();

    await notifier.notify('post', 'post-42', 'created');

    expect(insertFn).toHaveBeenCalledWith(dbNotifications);
    expect(valuesFn).toHaveBeenCalledTimes(1);

    const row = valuesFn.mock.calls[0][0];
    expect(row.entity).toBe('post');
    expect(row.entityId).toBe('post-42');
    expect(row.action).toBe('created');
    expect(row.fromCli).toBe(1);
    expect(row.seenAt).toBeNull();
    expect(row.createdAt).toBeGreaterThanOrEqual(beforeMs);
    expect(row.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it('inserts distinct rows for consecutive calls', async () => {
    const notifier = new DbNotifier(mockDb);

    await notifier.notify('media', 'm-1', 'updated');
    await notifier.notify('script', 's-1', 'deleted');

    expect(valuesFn).toHaveBeenCalledTimes(2);
    expect(valuesFn.mock.calls[0][0].entity).toBe('media');
    expect(valuesFn.mock.calls[1][0].entity).toBe('script');
  });

  it('propagates database insertion errors', async () => {
    valuesFn.mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    const notifier = new DbNotifier(mockDb);

    await expect(notifier.notify('template', 't-1', 'created')).rejects.toThrow('SQLITE_BUSY');
  });
});
