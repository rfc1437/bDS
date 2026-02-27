import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { TagsView } from '../../../src/renderer/components/TagsView/TagsView';

describe('TagsView subscriptions', () => {
  beforeEach(() => {
    const onMock = vi.fn((_channel: string, _callback: (...args: unknown[]) => void) => vi.fn());

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      tags: {
        getWithCounts: vi.fn().mockResolvedValue([]),
        getAll: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        rename: vi.fn(),
        merge: vi.fn(),
        syncFromPosts: vi.fn(),
      },
      templates: {
        getEnabledByKind: vi.fn().mockResolvedValue([]),
      },
      on: onMock,
    };
  });

  it('subscribes to tag refresh events including updates and unsubscribes on unmount', async () => {
    const unsubscribeSpies = [vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const onMock = vi
      .fn()
      .mockImplementationOnce(() => unsubscribeSpies[0])
      .mockImplementationOnce(() => unsubscribeSpies[1])
      .mockImplementationOnce(() => unsubscribeSpies[2])
      .mockImplementationOnce(() => unsubscribeSpies[3])
      .mockImplementationOnce(() => unsubscribeSpies[4]);

    (window as any).electronAPI.on = onMock;

    const { unmount } = render(<TagsView />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onMock).toHaveBeenCalledTimes(5);

    expect(onMock.mock.calls.map((call) => call[0]).sort()).toEqual([
      'tag:created',
      'tag:deleted',
      'tag:renamed',
      'tag:updated',
      'tags:merged',
    ]);

    unmount();

    unsubscribeSpies.forEach((spy) => {
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
