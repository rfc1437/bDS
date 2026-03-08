import { describe, expect, it, vi } from 'vitest';
import { createAndFocusPost } from '../../../src/renderer/navigation/postCreation';

describe('postCreation', () => {
  it('creates a post, focuses it, and optionally ensures posts sidebar', async () => {
    const createPost = vi.fn().mockResolvedValue({ id: 'post-1' });
    const setSelectedPost = vi.fn();
    const ensurePostsSidebar = vi.fn();

    const result = await createAndFocusPost({
      createPost,
      setSelectedPost,
      ensurePostsSidebar,
    });

    expect(createPost).toHaveBeenCalledWith({
      title: '',
      content: '',
      tags: [],
      categories: [],
    });
    expect(setSelectedPost).toHaveBeenCalledWith('post-1');
    expect(ensurePostsSidebar).toHaveBeenCalledTimes(1);
    expect(result).toBe('post-1');
  });

  it('returns null and does not focus when create returns nullish', async () => {
    const createPost = vi.fn().mockResolvedValue(null);
    const setSelectedPost = vi.fn();
    const ensurePostsSidebar = vi.fn();

    const result = await createAndFocusPost({
      createPost,
      setSelectedPost,
      ensurePostsSidebar,
    });

    expect(setSelectedPost).not.toHaveBeenCalled();
    expect(ensurePostsSidebar).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('passes provided categories to createPost', async () => {
    const createPost = vi.fn().mockResolvedValue({ id: 'page-1' });
    const setSelectedPost = vi.fn();

    await createAndFocusPost({
      createPost,
      setSelectedPost,
      categories: ['page'],
    });

    expect(createPost).toHaveBeenCalledWith({
      title: '',
      content: '',
      tags: [],
      categories: ['page'],
    });
  });

  it('returns null and reports errors', async () => {
    const createPost = vi.fn().mockRejectedValue(new Error('fail'));
    const setSelectedPost = vi.fn();
    const onError = vi.fn();

    const result = await createAndFocusPost({
      createPost,
      setSelectedPost,
      onError,
    });

    expect(setSelectedPost).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });
});
