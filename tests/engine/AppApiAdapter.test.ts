import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppApiAdapter } from '../../src/main/engine/AppApiAdapter';

const { mockProjectEngine, mockDatabase, mockReadFile } = vi.hoisted(() => ({
  mockProjectEngine: {
    getActiveProject: vi.fn().mockResolvedValue({ id: 'p1', dataPath: '/projects/blog' }),
    getProjectPaths: vi.fn().mockReturnValue({ posts: '/projects/blog/posts', media: '/projects/blog/media' }),
    getDefaultProjectBaseDir: vi.fn().mockResolvedValue('/home/user/bDS/p1'),
  },
  mockDatabase: {
    getDbPath: vi.fn(() => '/data/bds.db'),
  },
  mockReadFile: vi.fn(),
}));

vi.mock('../../src/main/engine/ProjectEngine', () => ({
  getProjectEngine: () => mockProjectEngine,
}));

vi.mock('../../src/main/database', () => ({
  getDatabase: () => mockDatabase,
}));

vi.mock('electron', () => ({
  app: { getLocale: () => 'en-US' },
}));

vi.mock('fs/promises', () => ({
  default: { readFile: mockReadFile },
  readFile: mockReadFile,
}));

describe('AppApiAdapter', () => {
  let adapter: AppApiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectEngine.getActiveProject.mockResolvedValue({ id: 'p1', dataPath: '/projects/blog' });
    mockProjectEngine.getProjectPaths.mockReturnValue({ posts: '/projects/blog/posts', media: '/projects/blog/media' });
    mockProjectEngine.getDefaultProjectBaseDir.mockResolvedValue('/home/user/bDS/p1');
    adapter = new AppApiAdapter(mockProjectEngine as any);
  });

  it('getDataPaths returns database, posts, and media paths', async () => {
    const result = await adapter.getDataPaths();
    expect(result).toEqual({
      database: '/data/bds.db',
      posts: '/projects/blog/posts',
      media: '/projects/blog/media',
    });
  });

  it('getSystemLanguage returns electron app locale', async () => {
    const result = await adapter.getSystemLanguage();
    expect(result).toBe('en-US');
  });

  it('getDefaultProjectPath delegates to ProjectEngine', async () => {
    const result = await adapter.getDefaultProjectPath('p1');
    expect(mockProjectEngine.getDefaultProjectBaseDir).toHaveBeenCalledWith('p1');
    expect(result).toBe('/home/user/bDS/p1');
  });

  it('readProjectMetadata returns metadata from project.json', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ name: 'My Blog', description: 'Test', publicUrl: 'https://blog.example.com', mainLanguage: 'en', dataPath: '/secret' }),
    );

    const result = await adapter.readProjectMetadata('/projects/blog');
    expect(result).toEqual({
      name: 'My Blog',
      description: 'Test',
      publicUrl: 'https://blog.example.com',
      mainLanguage: 'en',
    });
    // dataPath should be excluded
    expect(result).not.toHaveProperty('dataPath');
  });

  it('readProjectMetadata returns null when file does not exist', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await adapter.readProjectMetadata('/nonexistent');
    expect(result).toBeNull();
  });
});
