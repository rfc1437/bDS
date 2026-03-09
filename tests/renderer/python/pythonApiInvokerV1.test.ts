import { afterEach, describe, expect, it, vi } from 'vitest';
import { invokePythonApiMethodV1 } from '../../../src/renderer/python/pythonApiInvokerV1';

describe('invokePythonApiMethodV1', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invokes posts.get via electronAPI with validated args', async () => {
    const getPost = vi.fn().mockResolvedValue({ id: 'p1', title: 'Post 1' });

    vi.stubGlobal('window', {
      electronAPI: {
        posts: {
          get: getPost,
        },
      },
    });

    await expect(invokePythonApiMethodV1('posts.get', { postId: 'p1' })).resolves.toEqual({
      id: 'p1',
      title: 'Post 1',
    });
    expect(getPost).toHaveBeenCalledWith('p1');
  });

  it('invokes methods from multiple namespaces via contract metadata', async () => {
    const searchPosts = vi.fn().mockResolvedValue([{ id: 'p1', title: 'Hit' }]);
    const getProjectMetadata = vi.fn().mockResolvedValue({ name: 'My Project' });
    const getAllProjects = vi.fn().mockResolvedValue([{ id: 'prj-1', name: 'Main' }]);
    const getAllPosts = vi.fn().mockResolvedValue({ items: [], hasMore: false, total: 0 });

    vi.stubGlobal('window', {
      electronAPI: {
        projects: {
          getAll: getAllProjects,
        },
        posts: {
          search: searchPosts,
          getAll: getAllPosts,
        },
        meta: {
          getProjectMetadata,
        },
      },
    });

    await expect(invokePythonApiMethodV1('projects.getAll', {})).resolves.toEqual([{ id: 'prj-1', name: 'Main' }]);
    await expect(invokePythonApiMethodV1('posts.getAll', { options: { limit: 10, offset: 5 } })).resolves.toEqual({ items: [], hasMore: false, total: 0 });
    await expect(invokePythonApiMethodV1('posts.search', { query: 'hit' })).resolves.toEqual([{ id: 'p1', title: 'Hit' }]);
    await expect(invokePythonApiMethodV1('meta.getProjectMetadata', {})).resolves.toEqual({ name: 'My Project' });
    expect(getAllProjects).toHaveBeenCalledWith();
    expect(getAllPosts).toHaveBeenCalledWith({ limit: 10, offset: 5 });
    expect(searchPosts).toHaveBeenCalledWith('hit');
    expect(getProjectMetadata).toHaveBeenCalledWith();
  });

  it('invokes chat.translatePost via electronAPI with validated args', async () => {
    const translatePost = vi.fn().mockResolvedValue({
      success: true,
      translation: { id: 'tr-1', language: 'de' },
    });

    vi.stubGlobal('window', {
      electronAPI: {
        chat: {
          translatePost,
        },
      },
    });

    await expect(invokePythonApiMethodV1('chat.translatePost', { postId: 'p1', targetLanguage: 'de' })).resolves.toEqual({
      success: true,
      translation: { id: 'tr-1', language: 'de' },
    });
    expect(translatePost).toHaveBeenCalledWith('p1', 'de');
  });

  it('rejects unknown methods and malformed args', async () => {
    vi.stubGlobal('window', {
      electronAPI: {
        posts: {
          get: vi.fn(),
          search: vi.fn(),
          getAll: vi.fn(),
        },
        projects: {
          getAll: vi.fn(),
        },
        meta: {
          getProjectMetadata: vi.fn(),
        },
      },
    });

    await expect(invokePythonApiMethodV1('posts.unknown', {})).rejects.toThrow('Unsupported Python API method');
    await expect(invokePythonApiMethodV1('posts.get', {})).rejects.toThrow('posts.get requires string arg postId');
    await expect(invokePythonApiMethodV1('posts.search', { query: 1 })).rejects.toThrow('posts.search requires string arg query');
    await expect(invokePythonApiMethodV1('posts.getAll', { options: 1 })).rejects.toThrow('posts.getAll requires object arg options');
  });
});