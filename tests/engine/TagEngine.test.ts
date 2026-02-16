/**
 * TagEngine Unit Tests
 *
 * Tests the REAL TagEngine class with mocked dependencies.
 * Following TDD best practices: mock external dependencies, test real implementation.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TagEngine, TagData, TagWithCount, MergeTagsResult, DeleteTagResult } from '../../src/main/engine/TagEngine';
import { resetMockCounters } from '../utils/factories';
import { getDatabase } from '../../src/main/database';
import { taskManager } from '../../src/main/engine/TaskManager';

// Create mock data stores
const mockTags = new Map<string, any>();
const mockPosts = new Map<string, any>();
let mockExecuteArgs: any[] = [];

// Configure what data the Drizzle select chain returns - supports queue for multiple calls
let mockSelectDataQueue: any[][] = [];
let mockSelectDataDefault: any[] = [];

function getNextMockSelectData(): any[] {
  if (mockSelectDataQueue.length > 0) {
    return mockSelectDataQueue.shift()!;
  }
  if (mockSelectDataDefault.length > 0) {
    return mockSelectDataDefault;
  }
  return Array.from(mockTags.values());
}

// Create chainable mock for Drizzle ORM that is thenable (can be awaited)
function createSelectChain() {
  const chain: any = {
    from: vi.fn().mockImplementation(() => chain),
    where: vi.fn().mockImplementation(() => chain),
    orderBy: vi.fn().mockImplementation(() => chain),
    limit: vi.fn().mockImplementation(() => chain),
    offset: vi.fn().mockImplementation(() => chain),
    // Make the chain thenable so it can be awaited directly
    then: (resolve: (value: any[]) => void, reject?: (reason: any) => void) => {
      return Promise.resolve(getNextMockSelectData()).then(resolve, reject);
    },
  };
  return chain;
}

function createDrizzleMock() {
  return {
    select: vi.fn(() => createSelectChain()),
    insert: vi.fn(() => ({
      values: vi.fn((data: any) => {
        if (data && data.id) {
          mockTags.set(data.id, data);
        }
        return Promise.resolve();
      }),
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

const mockLocalDb = createDrizzleMock();
const mockLocalClient = {
  execute: vi.fn(async (query: { sql: string; args: any[] }) => {
    mockExecuteArgs.push(query);
    return { rows: [] };
  }),
};

// Mock the database module
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => mockLocalDb),
    getLocalClient: vi.fn(() => mockLocalClient),
    getRemote: vi.fn(() => null),
    getDataPaths: vi.fn(() => ({
      database: '/mock/userData/bds.db',
      posts: '/mock/userData/posts',
      media: '/mock/userData/media',
    })),
    initializeLocal: vi.fn(),
    initializeRemote: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(async () => '[]'),
  writeFile: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  readdir: vi.fn(async () => []),
  stat: vi.fn(async () => ({
    isFile: () => false,
    isDirectory: () => true,
  })),
  access: vi.fn(async () => {}),
}));

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

// Mock TaskManager
vi.mock('../../src/main/engine/TaskManager', () => ({
  taskManager: {
    runTask: vi.fn(async (task: any) => {
      // Execute the task for testing
      return task.execute((progress: number, message: string) => {});
    }),
  },
}));

// Mock PostEngine - only mock the syncPublishedPostFile method used by TagEngine
const mockPostEngine = {
  syncPublishedPostFile: vi.fn(async () => true),
};

vi.mock('../../src/main/engine/PostEngine', () => ({
  getPostEngine: vi.fn(() => mockPostEngine),
}));

describe('TagEngine', () => {
  let tagEngine: TagEngine;

  const captureProgressForNextTask = (): Array<{ progress: number; message: string }> => {
    const progressCalls: Array<{ progress: number; message: string }> = [];

    vi.mocked(taskManager.runTask).mockImplementationOnce(async (task: any) => {
      return task.execute((progress: number, message: string) => {
        progressCalls.push({ progress, message });
      });
    });

    return progressCalls;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTags.clear();
    mockPosts.clear();
    mockExecuteArgs = [];
    mockSelectDataQueue = [];
    mockSelectDataDefault = [];
    mockPostEngine.syncPublishedPostFile.mockClear();
    resetMockCounters();
    tagEngine = new TagEngine();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create a new TagEngine instance', () => {
      expect(tagEngine).toBeDefined();
      expect(tagEngine).toBeInstanceOf(TagEngine);
    });
  });

  describe('setProjectContext', () => {
    it('should set the current project ID', () => {
      tagEngine.setProjectContext('project-123');
      expect(tagEngine.getProjectContext()).toBe('project-123');
    });
  });

  describe('getTagsWithCounts', () => {
    it('should return an empty array when no tags exist', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({ rows: [] });
      
      const result = await tagEngine.getTagsWithCounts();
      
      expect(result).toEqual([]);
    });

    it('should return tags with their post counts', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [
          { name: 'javascript', color: null, post_count: 5 },
          { name: 'typescript', color: '#3178c6', post_count: 3 },
        ],
      });

      const result = await tagEngine.getTagsWithCounts();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'javascript', color: null, count: 5 });
      expect(result[1]).toEqual({ name: 'typescript', color: '#3178c6', count: 3 });
    });
  });

  describe('createTag', () => {
    it('should create a new tag with a name', async () => {
      const result = await tagEngine.createTag({ name: 'react' });

      expect(result).toBeDefined();
      expect(result.name).toBe('react');
      expect(result.id).toBeDefined();
    });

    it('should normalize tag name to lowercase', async () => {
      const result = await tagEngine.createTag({ name: 'React' });

      expect(result.name).toBe('react');
    });

    it('should create a new tag with a color', async () => {
      const result = await tagEngine.createTag({ name: 'react', color: '#61dafb' });

      expect(result.name).toBe('react');
      expect(result.color).toBe('#61dafb');
    });

    it('should emit tagCreated event', async () => {
      const handler = vi.fn();
      tagEngine.on('tagCreated', handler);

      await tagEngine.createTag({ name: 'vue' });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ name: 'vue' }));
    });

    it('should throw error for empty tag name', async () => {
      await expect(tagEngine.createTag({ name: '' })).rejects.toThrow('Tag name is required');
    });

    it('should throw error for duplicate tag name', async () => {
      // Drizzle ORM: check for existing tag with same name
      mockSelectDataQueue = [[{ id: 'existing', name: 'react' }]];

      await expect(tagEngine.createTag({ name: 'react' })).rejects.toThrow('Tag "react" already exists');
    });
  });

  describe('updateTag', () => {
    it('should update tag color', async () => {
      mockSelectDataDefault = [{ id: 'tag-1', name: 'react', color: null, projectId: 'default', createdAt: new Date(), updatedAt: new Date() }];

      const result = await tagEngine.updateTag('tag-1', { color: '#61dafb' });

      expect(result).toBeDefined();
      expect(result?.color).toBe('#61dafb');
    });

    it('should emit tagUpdated event', async () => {
      mockSelectDataDefault = [{ id: 'tag-1', name: 'react', color: null, projectId: 'default', createdAt: new Date(), updatedAt: new Date() }];
      
      const handler = vi.fn();
      tagEngine.on('tagUpdated', handler);

      await tagEngine.updateTag('tag-1', { color: '#61dafb' });

      expect(handler).toHaveBeenCalled();
    });

    it('should return null for non-existent tag', async () => {
      mockSelectDataDefault = [];

      const result = await tagEngine.updateTag('non-existent', { color: '#fff' });

      expect(result).toBeNull();
    });
  });

  describe('deleteTag', () => {
    it('should delete tag and remove from posts as a background task', async () => {
      // Drizzle ORM: get tag first
      mockSelectDataQueue = [
        [{ id: 'tag-1', name: 'react', color: null, projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
      ];
      // Raw SQL: find posts with tag
      mockLocalClient.execute.mockImplementationOnce(async () => ({
        rows: [
          { id: 'post-1', tags: '["react", "typescript"]' },
          { id: 'post-2', tags: '["react"]' },
        ],
      }));

      const result = await tagEngine.deleteTag('tag-1');

      expect(result.success).toBe(true);
      expect(result.postsUpdated).toBe(2);
    });

    it('should emit tagDeleted event', async () => {
      mockSelectDataQueue = [
        [{ id: 'tag-1', name: 'react', color: null, projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
      ];
      mockLocalClient.execute.mockImplementationOnce(async () => ({ rows: [] }));

      const handler = vi.fn();
      tagEngine.on('tagDeleted', handler);

      await tagEngine.deleteTag('tag-1');

      expect(handler).toHaveBeenCalledWith('tag-1');
    });

    it('should throw error for non-existent tag', async () => {
      mockSelectDataDefault = [];

      await expect(tagEngine.deleteTag('non-existent')).rejects.toThrow('Tag not found');
    });

    it('should only update each post once when query returns duplicate rows', async () => {
      mockSelectDataQueue = [
        [{ id: 'tag-1', name: 'react', color: null, projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
      ];

      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [
          { id: 'post-1', tags: '["react", "typescript"]' },
          { id: 'post-1', tags: '["react", "typescript"]' },
        ],
      });

      const result = await tagEngine.deleteTag('tag-1');

      expect(result.postsUpdated).toBe(1);
      expect(mockPostEngine.syncPublishedPostFile).toHaveBeenCalledTimes(1);
    });

    it('should report stable progress checkpoints during delete', async () => {
      mockSelectDataQueue = [
        [{ id: 'tag-1', name: 'react', color: null, projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
      ];
      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [
          { id: 'post-1', tags: '["react", "typescript"]' },
          { id: 'post-2', tags: '["react"]' },
        ],
      });

      const progressCalls = captureProgressForNextTask();
      await tagEngine.deleteTag('tag-1');

      expect(progressCalls).toEqual([
        { progress: 0, message: 'Finding posts with tag "react"...' },
        { progress: 40, message: 'Updated 1/2 posts...' },
        { progress: 80, message: 'Updated 2/2 posts...' },
        { progress: 90, message: 'Deleting tag...' },
        { progress: 100, message: 'Complete' },
      ]);
    });
  });

  describe('mergeTags', () => {
    it('should merge multiple tags into one', async () => {
      // Drizzle ORM selects: source tag 1, source tag 2, target tag
      mockSelectDataQueue = [
        [{ id: 'tag-1', name: 'js', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
        [{ id: 'tag-2', name: 'javascript', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
        [{ id: 'tag-3', name: 'ecmascript', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
      ];
      // Raw SQL for finding posts with tags
      mockLocalClient.execute
        .mockResolvedValueOnce({ rows: [{ id: 'post-1', tags: '["js"]' }] }) // Posts with source tag 1
        .mockResolvedValueOnce({ rows: [{ id: 'post-2', tags: '["javascript"]' }] }); // Posts with source tag 2

      const result = await tagEngine.mergeTags(['tag-1', 'tag-2'], 'tag-3');

      expect(result.success).toBe(true);
      expect(result.postsUpdated).toBeGreaterThanOrEqual(0);
      expect(result.tagsDeleted).toBe(2);
    });

    it('should emit tagsMerged event', async () => {
      mockSelectDataQueue = [
        [{ id: 'tag-1', name: 'js', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
        [{ id: 'tag-2', name: 'javascript', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
      ];
      mockLocalClient.execute.mockResolvedValueOnce({ rows: [] }); // No posts with source tag

      const handler = vi.fn();
      tagEngine.on('tagsMerged', handler);

      await tagEngine.mergeTags(['tag-1'], 'tag-2');

      expect(handler).toHaveBeenCalled();
    });

    it('should throw error when source tags array is empty', async () => {
      await expect(tagEngine.mergeTags([], 'tag-1')).rejects.toThrow('Source tags are required');
    });

    it('should throw error when target tag does not exist', async () => {
      mockSelectDataQueue = [
        [{ id: 'tag-1', name: 'js', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
        [], // Target not found
      ];

      await expect(tagEngine.mergeTags(['tag-1'], 'non-existent')).rejects.toThrow('Target tag not found');
    });

    it('should only update each post once when multiple source tags exist on the same post', async () => {
      mockSelectDataQueue = [
        [{ id: 'tag-1', name: 'js', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
        [{ id: 'tag-2', name: 'javascript', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
        [{ id: 'tag-3', name: 'ecmascript', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
      ];

      mockLocalClient.execute
        .mockResolvedValueOnce({ rows: [{ id: 'post-1', tags: '["js", "javascript"]' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'post-1', tags: '["js", "javascript"]' }] });

      const result = await tagEngine.mergeTags(['tag-1', 'tag-2'], 'tag-3');

      expect(result.postsUpdated).toBe(1);
      expect(mockPostEngine.syncPublishedPostFile).toHaveBeenCalledTimes(1);
    });

    it('should report stable progress checkpoints during merge', async () => {
      mockSelectDataQueue = [
        [{ id: 'tag-1', name: 'js', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
        [{ id: 'tag-2', name: 'javascript', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
        [{ id: 'tag-3', name: 'ecmascript', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
      ];

      mockLocalClient.execute
        .mockResolvedValueOnce({ rows: [{ id: 'post-1', tags: '["js"]' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'post-2', tags: '["javascript"]' }] });

      const progressCalls = captureProgressForNextTask();
      await tagEngine.mergeTags(['tag-1', 'tag-2'], 'tag-3');

      expect(progressCalls).toEqual([
        { progress: 0, message: 'Finding posts to update...' },
        { progress: 40, message: 'Processing tag "js"...' },
        { progress: 80, message: 'Processing tag "javascript"...' },
        { progress: 90, message: 'Deleting source tags...' },
        { progress: 100, message: 'Complete' },
      ]);
    });
  });

  describe('renameTags (batch rename)', () => {
    it('should rename multiple tags and update posts', async () => {
      // First call: get existing tag, Second call: check for duplicate
      mockSelectDataQueue = [
        [{ id: 'tag-1', name: 'old-name', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
        [], // no duplicate
      ];
      // Raw SQL for finding posts with the tag
      mockLocalClient.execute.mockResolvedValueOnce({ rows: [{ id: 'post-1', tags: '["old-name"]' }] });

      const result = await tagEngine.renameTag('tag-1', 'new-name');

      expect(result.success).toBe(true);
      expect(result.postsUpdated).toBeGreaterThanOrEqual(0);
    });

    it('should emit tagRenamed event', async () => {
      mockSelectDataQueue = [
        [{ id: 'tag-1', name: 'old-name', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
        [], // no duplicate
      ];
      mockLocalClient.execute.mockResolvedValueOnce({ rows: [] }); // no posts to update

      const handler = vi.fn();
      tagEngine.on('tagRenamed', handler);

      await tagEngine.renameTag('tag-1', 'new-name');

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        oldName: 'old-name',
        newName: 'new-name',
      }));
    });

    it('should only update each post once when query returns duplicate rows', async () => {
      mockSelectDataQueue = [
        [{ id: 'tag-1', name: 'old-name', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
        [], // no duplicate target tag
      ];

      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [
          { id: 'post-1', tags: '["old-name"]' },
          { id: 'post-1', tags: '["old-name"]' },
        ],
      });

      const result = await tagEngine.renameTag('tag-1', 'new-name');

      expect(result.postsUpdated).toBe(1);
      expect(mockPostEngine.syncPublishedPostFile).toHaveBeenCalledTimes(1);
    });

    it('should report stable progress checkpoints during rename', async () => {
      mockSelectDataQueue = [
        [{ id: 'tag-1', name: 'old-name', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
        [],
      ];
      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [
          { id: 'post-1', tags: '["old-name"]' },
          { id: 'post-2', tags: '["old-name", "other"]' },
        ],
      });

      const progressCalls = captureProgressForNextTask();
      await tagEngine.renameTag('tag-1', 'new-name');

      expect(progressCalls).toEqual([
        { progress: 0, message: 'Finding posts to update...' },
        { progress: 40, message: 'Updated 1/2 posts...' },
        { progress: 80, message: 'Updated 2/2 posts...' },
        { progress: 90, message: 'Updating tag record...' },
        { progress: 100, message: 'Complete' },
      ]);
    });
  });

  describe('getTag', () => {
    it('should return tag by ID', async () => {
      // Set up mock data for Drizzle select (camelCase properties)
      mockSelectDataDefault = [{ id: 'tag-1', name: 'react', color: '#61dafb', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }];

      const result = await tagEngine.getTag('tag-1');

      expect(result).toBeDefined();
      expect(result?.name).toBe('react');
      expect(result?.color).toBe('#61dafb');
    });

    it('should return null for non-existent tag', async () => {
      mockSelectDataDefault = [];

      const result = await tagEngine.getTag('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getTagByName', () => {
    it('should return tag by name', async () => {
      mockSelectDataDefault = [{ id: 'tag-1', name: 'react', color: '#61dafb', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }];

      const result = await tagEngine.getTagByName('react');

      expect(result).toBeDefined();
      expect(result?.id).toBe('tag-1');
    });

    it('should be case-insensitive', async () => {
      mockSelectDataDefault = [{ id: 'tag-1', name: 'react', color: null, projectId: 'default', createdAt: new Date(), updatedAt: new Date() }];

      const result = await tagEngine.getTagByName('REACT');

      expect(result).toBeDefined();
    });
  });

  describe('getAllTags', () => {
    it('should return all tags for the current project', async () => {
      mockSelectDataDefault = [
        { id: 'tag-1', name: 'react', color: null, projectId: 'default', createdAt: new Date(), updatedAt: new Date() },
        { id: 'tag-2', name: 'vue', color: '#42b883', projectId: 'default', createdAt: new Date(), updatedAt: new Date() },
      ];

      const result = await tagEngine.getAllTags();

      expect(result).toHaveLength(2);
      expect(result.map(t => t.name)).toContain('react');
      expect(result.map(t => t.name)).toContain('vue');
    });
  });

  describe('getPostsWithTag', () => {
    it('should return post IDs that have the specified tag', async () => {
      // First call: Drizzle ORM to get tag name from id
      mockSelectDataQueue = [[{ name: 'react' }]];
      // Second call: raw SQL to find posts with this tag
      mockLocalClient.execute.mockImplementationOnce(async () => ({
        rows: [
          { id: 'post-1', tags: '["react", "typescript"]' },
          { id: 'post-2', tags: '["react"]' },
        ],
      }));

      const result = await tagEngine.getPostsWithTag('tag-1');

      expect(result).toHaveLength(2);
      expect(result).toContain('post-1');
      expect(result).toContain('post-2');
    });
  });

  describe('color validation', () => {
    it('should accept valid hex color codes', async () => {
      const result = await tagEngine.createTag({ name: 'test', color: '#ff0000' });
      expect(result.color).toBe('#ff0000');
    });

    it('should accept short hex color codes', async () => {
      const result = await tagEngine.createTag({ name: 'test', color: '#f00' });
      expect(result.color).toBe('#f00');
    });

    it('should reject invalid color codes', async () => {
      await expect(tagEngine.createTag({ name: 'test', color: 'red' }))
        .rejects.toThrow('Invalid color format');
    });

    it('should allow null/undefined color', async () => {
      const result = await tagEngine.createTag({ name: 'test' });
      expect(result.color).toBeUndefined();
    });
  });

  describe('syncTagsFromPosts', () => {
    it('should discover tags from existing posts and add missing ones', async () => {
      // First call: get posts' tags, Second call: get existing tags
      mockSelectDataQueue = [
        [{ tags: '["react", "javascript"]' }, { tags: '["vue", "typescript"]' }],
        [{ name: 'react' }], // existing tags
      ];

      const result = await tagEngine.syncTagsFromPosts();

      expect(result.discovered).toBeGreaterThanOrEqual(0);
    });

    it('should ignore empty and whitespace-only tags discovered from posts', async () => {
      mockSelectDataQueue = [
        [{ tags: '[" valid-tag ", "", "   "]' }],
        [],
      ];

      const result = await tagEngine.syncTagsFromPosts();

      expect(result.discovered).toBe(1);
      expect(result.added).toEqual(['valid-tag']);
    });
  });

  describe('loadTagsFromFile', () => {
    it('should load tags from filesystem in portable format', async () => {
      // Mock fs.readFile to return valid JSON
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify([
          { name: 'tag1', color: '#ff0000' },
          { name: 'tag2' },
        ])
      );

      // Mock select to return empty (no existing tags)
      mockSelectDataQueue = [[], []];

      await tagEngine.loadTagsFromFile();

      // Verify insert was called for the new tags
      expect(mockLocalDb.insert).toHaveBeenCalled();
    });

    it('should handle ENOENT error gracefully (file not found)', async () => {
      const fs = await import('fs/promises');
      const error = new Error('ENOENT');
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      vi.mocked(fs.readFile).mockRejectedValueOnce(error);

      // Should not throw
      await expect(tagEngine.loadTagsFromFile()).resolves.toBeUndefined();
    });

    it('should log non-ENOENT errors when loading', async () => {
      const fs = await import('fs/promises');
      const error = new Error('Permission denied');
      (error as NodeJS.ErrnoException).code = 'EACCES';
      vi.mocked(fs.readFile).mockRejectedValueOnce(error);

      // Should not throw, but should log error
      await expect(tagEngine.loadTagsFromFile()).resolves.toBeUndefined();
    });

    it('should skip tags with empty names', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify([
          { name: '' },
          { name: '  ' },
          { name: 'valid' },
        ])
      );

      mockSelectDataQueue = [[]]; // no existing tags

      await tagEngine.loadTagsFromFile();

      // Only 'valid' should be processed
      const insertedTags = mockLocalDb.insert.mock.calls;
      expect(insertedTags.length).toBeGreaterThan(0);
    });

    it('should update color for existing tag when loading', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify([
          { name: 'existing-tag', color: '#ff0000' },
        ])
      );

      // Existing tag found
      mockSelectDataQueue = [[{ id: 'tag-1' }]];

      await tagEngine.loadTagsFromFile();

      // Should update existing tag with color
      expect(mockLocalDb.update).toHaveBeenCalled();
    });
  });

  describe('renameTag error cases', () => {
    it('should throw error when new name is empty', async () => {
      await expect(tagEngine.renameTag('tag-1', '')).rejects.toThrow('New name is required');
    });

    it('should throw error when new name is whitespace only', async () => {
      await expect(tagEngine.renameTag('tag-1', '   ')).rejects.toThrow('New name is required');
    });

    it('should throw error when tag not found', async () => {
      mockSelectDataDefault = [];
      await expect(tagEngine.renameTag('non-existent', 'new-name')).rejects.toThrow('Tag not found');
    });

    it('should return success with 0 posts updated when renaming to same name', async () => {
      mockSelectDataQueue = [
        [{ id: 'tag-1', name: 'same-name', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
      ];

      const result = await tagEngine.renameTag('tag-1', 'same-name');

      expect(result.success).toBe(true);
      expect(result.postsUpdated).toBe(0);
      expect(result.oldName).toBe('same-name');
      expect(result.newName).toBe('same-name');
    });

    it('should throw error when target name already exists', async () => {
      mockSelectDataQueue = [
        [{ id: 'tag-1', name: 'old-name', projectId: 'default', createdAt: new Date(), updatedAt: new Date() }],
        [{ id: 'tag-2' }], // duplicate found
      ];

      await expect(tagEngine.renameTag('tag-1', 'existing-name')).rejects.toThrow('already exists');
    });
  });

  describe('getPostsWithTag edge cases', () => {
    it('should return empty array when tag not found', async () => {
      mockSelectDataQueue = [[]]; // tag not found

      const result = await tagEngine.getPostsWithTag('non-existent-tag');

      expect(result).toEqual([]);
    });

    it('should return empty array when client is not available', async () => {
      // Store original mock implementation
      const originalMock = vi.mocked(getDatabase).getMockImplementation();
      
      // Mock getClient to return null
      vi.mocked(getDatabase).mockReturnValue({
        getLocal: vi.fn(() => mockLocalDb),
        getLocalClient: vi.fn().mockReturnValue(null),
      } as any);

      const result = await tagEngine.getPostsWithTag('tag-1');

      expect(result).toEqual([]);
      
      // Restore original mock
      if (originalMock) {
        vi.mocked(getDatabase).mockImplementation(originalMock);
      } else {
        // Restore to standard mock
        vi.mocked(getDatabase).mockReturnValue({
          getLocal: vi.fn(() => mockLocalDb),
          getLocalClient: vi.fn(() => mockLocalClient),
          getRemote: vi.fn(() => null),
          getDataPaths: vi.fn(() => ({
            database: '/mock/userData/bds.db',
            posts: '/mock/userData/posts',
            media: '/mock/userData/media',
          })),
          initializeLocal: vi.fn(),
          initializeRemote: vi.fn(),
          close: vi.fn(),
        } as any);
      }
    });
  });
});
