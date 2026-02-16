import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { TagInput } from '../../../src/renderer/components/TagInput/TagInput';

describe('TagInput subscriptions', () => {
  beforeEach(() => {
    const onMock = vi.fn((_channel: string, _callback: (...args: unknown[]) => void) => vi.fn());

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      tags: {
        getAll: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      on: onMock,
    };
  });

  it('subscribes to tag refresh events on mount and unsubscribes on unmount', async () => {
    const unsubscribeSpies = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const onMock = vi
      .fn()
      .mockImplementationOnce(() => unsubscribeSpies[0])
      .mockImplementationOnce(() => unsubscribeSpies[1])
      .mockImplementationOnce(() => unsubscribeSpies[2])
      .mockImplementationOnce(() => unsubscribeSpies[3]);

    (window as any).electronAPI.on = onMock;

    const { unmount } = render(<TagInput value={[]} onChange={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(onMock).toHaveBeenCalledTimes(4);

    expect(onMock.mock.calls.map((call) => call[0])).toEqual([
      'tag:created',
      'tag:deleted',
      'tag:renamed',
      'tags:merged',
    ]);

    unmount();

    unsubscribeSpies.forEach((spy) => {
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
