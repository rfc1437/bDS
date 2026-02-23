import { describe, expect, it } from 'vitest';
import {
  buildBlogmarkTransformOutputEntries,
  buildBlogmarkTransformToastNotifications,
  parseBlogmarkCreatedEventPayload,
} from '../../../src/renderer/navigation/blogmarkTransformOutput';

describe('parseBlogmarkCreatedEventPayload', () => {
  it('parses legacy payload shape where event value is the post itself', () => {
    const payload = parseBlogmarkCreatedEventPayload({ id: 'post-1', title: 'Legacy post' });

    expect(payload).toEqual({
      post: { id: 'post-1', title: 'Legacy post' },
      transform: undefined,
    });
  });

  it('parses new payload shape with post and transform metadata', () => {
    const payload = parseBlogmarkCreatedEventPayload({
      post: { id: 'post-2', title: 'With transforms' },
      transform: {
        appliedScriptIds: ['a', 'b'],
        errors: [{ scriptId: 'c', scriptSlug: 'c', message: 'boom' }],
        toasts: ['done'],
      },
    });

    expect(payload).toEqual({
      post: { id: 'post-2', title: 'With transforms' },
      transform: {
        appliedScriptIds: ['a', 'b'],
        errors: [{ scriptId: 'c', scriptSlug: 'c', message: 'boom' }],
        toasts: ['done'],
      },
    });
  });
});

describe('buildBlogmarkTransformOutputEntries', () => {
  const t = (key: string, values?: Record<string, string | number>) => {
    if (key === 'app.blogmark.transforms.summary') {
      return `summary:${values?.applied}:${values?.failed}`;
    }
    if (key === 'app.blogmark.transforms.appliedList') {
      return `applied:${values?.scripts}`;
    }
    if (key === 'app.blogmark.transforms.failed') {
      return `failed:${values?.script}:${values?.message}`;
    }
    if (key === 'app.blogmark.transforms.toast') {
      return `toast:${values?.message}`;
    }
    if (key === 'app.blogmark.transforms.errorToast') {
      return `error-toast:${values?.count}`;
    }
    return key;
  };

  it('returns empty list when no transform info is provided', () => {
    expect(buildBlogmarkTransformOutputEntries(undefined, t)).toEqual([]);
  });

  it('returns summary and applied list entries for successful transforms', () => {
    const entries = buildBlogmarkTransformOutputEntries(
      {
        appliedScriptIds: ['alpha', 'beta'],
        errors: [],
        toasts: [],
      },
      t,
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]?.kind).toBe('result');
    expect(entries[0]?.message).toBe('summary:2:0');
    expect(entries[1]?.kind).toBe('result');
    expect(entries[1]?.message).toBe('applied:alpha, beta');
  });

  it('returns one error entry per failed transform', () => {
    const entries = buildBlogmarkTransformOutputEntries(
      {
        appliedScriptIds: ['alpha'],
        errors: [
          { scriptId: 'broken', scriptSlug: 'broken_slug', message: 'boom' },
          { scriptId: 'bad', scriptSlug: 'bad_slug', message: 'invalid output' },
        ],
        toasts: ['Step finished'],
      },
      t,
    );

    expect(entries).toHaveLength(5);
    expect(entries[0]?.message).toBe('summary:1:2');
    expect(entries[1]?.message).toBe('applied:alpha');
    expect(entries[2]?.kind).toBe('result');
    expect(entries[2]?.message).toBe('toast:Step finished');
    expect(entries[3]?.kind).toBe('error');
    expect(entries[3]?.message).toBe('failed:broken_slug:boom');
    expect(entries[4]?.kind).toBe('error');
    expect(entries[4]?.message).toBe('failed:bad_slug:invalid output');
  });
});

describe('buildBlogmarkTransformToastNotifications', () => {
  const t = (key: string, values?: Record<string, string | number>) => {
    if (key === 'app.blogmark.transforms.errorToast') {
      return `error-toast:${values?.count}`;
    }
    return key;
  };

  it('returns toast notifications for script toasts and aggregated errors', () => {
    const notifications = buildBlogmarkTransformToastNotifications({
      appliedScriptIds: ['alpha'],
      toasts: ['Saved one item'],
      errors: [{ scriptId: 'broken', scriptSlug: 'broken_slug', message: 'boom' }],
    }, t);

    expect(notifications).toEqual([
      { kind: 'success', message: 'Saved one item' },
      { kind: 'error', message: 'error-toast:1' },
    ]);
  });
});
