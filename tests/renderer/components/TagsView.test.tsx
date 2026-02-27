import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, screen, fireEvent } from '@testing-library/react';
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

describe('TagsView template dropdown', () => {
  beforeEach(() => {
    const onMock = vi.fn((_channel: string, _callback: (...args: unknown[]) => void) => vi.fn());

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      tags: {
        getWithCounts: vi.fn().mockResolvedValue([
          { name: 'javascript', count: 5 },
        ]),
        getAll: vi.fn().mockResolvedValue([
          { id: 'tag-1', name: 'javascript', color: null, postTemplateSlug: null },
        ]),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
        rename: vi.fn(),
        merge: vi.fn(),
        syncFromPosts: vi.fn(),
      },
      templates: {
        getEnabledByKind: vi.fn().mockResolvedValue([
          { slug: 'custom_post', title: 'Custom Post' },
        ]),
      },
      on: onMock,
    };
  });

  it('loads post templates and shows them in tag edit dropdown', async () => {
    render(<TagsView />);

    // Wait for tags to load and click the tag to select it
    const tagButton = await screen.findByText('javascript');
    fireEvent.click(tagButton);

    // Click the edit button to enter edit mode
    const editButton = await screen.findByRole('button', { name: /edit/i });
    fireEvent.click(editButton);

    // Verify template dropdown appears with the loaded template
    await vi.waitFor(() => {
      const label = screen.getByText('Post Template');
      const fieldDiv = label.closest('.tagsview-field')!;
      const select = fieldDiv.querySelector('select')!;
      const options = Array.from(select.querySelectorAll('option'));
      const optionTexts = options.map((o) => o.textContent);
      expect(optionTexts).toContain('Custom Post');
    });
  });

  it('saves tag template selection via update IPC call', async () => {
    const updateMock = vi.fn().mockResolvedValue(undefined);
    (window as any).electronAPI.tags.update = updateMock;

    render(<TagsView />);

    // Select the tag
    const tagButton = await screen.findByText('javascript');
    fireEvent.click(tagButton);

    // Enter edit mode
    const editButton = await screen.findByRole('button', { name: /edit/i });
    fireEvent.click(editButton);

    // Wait for template dropdown to populate
    await vi.waitFor(() => {
      const label = screen.getByText('Post Template');
      const fieldDiv = label.closest('.tagsview-field')!;
      const select = fieldDiv.querySelector('select')!;
      const options = Array.from(select.querySelectorAll('option'));
      expect(options.map((o) => o.textContent)).toContain('Custom Post');
    });

    // Select a template
    const label = screen.getByText('Post Template');
    const fieldDiv = label.closest('.tagsview-field')!;
    const templateSelect = fieldDiv.querySelector('select')!;
    fireEvent.change(templateSelect, { target: { value: 'custom_post' } });

    // Save
    const saveButton = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveButton);

    await vi.waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        'tag-1',
        expect.objectContaining({
          postTemplateSlug: 'custom_post',
        }),
      );
    });
  });
});
