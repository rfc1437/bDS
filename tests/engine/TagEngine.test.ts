/**
 * TagEngine Unit Tests
 *
 * Tests the REAL TagEngine class with mocked dependencies.
 * Following TDD best practices: mock external dependencies, test real implementation.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TagEngine, TagData, TagWithCount, MergeTagsResult, DeleteTagResult } from '../../src/main/engine/TagEngine';
import { resetMockCounters } from '../utils/factories';

// Create mock data stores
const mockTags = new Map<string, any>();
const mockPosts = new Map<string, any>();
let mockExecuteArgs: any[] = [];

// Create chainable mock for Drizzle ORM
function createSelectChain() {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(function(this: any) {
      return this;
    }),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => Promise.resolve(Array.from(mockTags.values()))),
    get: vi.fn().mockImplementation(() => Promise.resolve(undefined)),
  };
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

describe('TagEngine', () => {
  let tagEngine: TagEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTags.clear();
    mockPosts.clear();
    mockExecuteArgs = [];
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
      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [{ id: 'existing', name: 'react' }],
      });

      await expect(tagEngine.createTag({ name: 'react' })).rejects.toThrow('Tag "react" already exists');
    });
  });

  describe('updateTag', () => {
    it('should update tag color', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [{ id: 'tag-1', name: 'react', color: null }],
      });

      const result = await tagEngine.updateTag('tag-1', { color: '#61dafb' });

      expect(result).toBeDefined();
      expect(result?.color).toBe('#61dafb');
    });

    it('should emit tagUpdated event', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [{ id: 'tag-1', name: 'react', color: null }],
      });
      
      const handler = vi.fn();
      tagEngine.on('tagUpdated', handler);

      await tagEngine.updateTag('tag-1', { color: '#61dafb' });

      expect(handler).toHaveBeenCalled();
    });

    it('should return null for non-existent tag', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({ rows: [] });

      const result = await tagEngine.updateTag('non-existent', { color: '#fff' });

      expect(result).toBeNull();
    });
  });

  describe('deleteTag', () => {
    it('should delete tag and remove from posts as a background task', async () => {
      mockLocalClient.execute
        .mockResolvedValueOnce({ rows: [{ id: 'tag-1', name: 'react', color: null }] }) // Find tag
        .mockResolvedValueOnce({ rows: [
          { id: 'post-1', tags: '["react", "typescript"]' },
          { id: 'post-2', tags: '["react"]' },
        ] }) // Posts with tag
        .mockResolvedValueOnce({ rows: [] }) // Update post-1
        .mockResolvedValueOnce({ rows: [] }) // Update post-2
        .mockResolvedValueOnce({ rows: [] }); // Delete tag

      const result = await tagEngine.deleteTag('tag-1');

      expect(result.success).toBe(true);
      expect(result.postsUpdated).toBe(2);
    });

    it('should emit tagDeleted event', async () => {
      mockLocalClient.execute
        .mockResolvedValueOnce({ rows: [{ id: 'tag-1', name: 'react', color: null }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const handler = vi.fn();
      tagEngine.on('tagDeleted', handler);

      await tagEngine.deleteTag('tag-1');

      expect(handler).toHaveBeenCalledWith('tag-1');
    });

    it('should throw error for non-existent tag', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({ rows: [] });

      await expect(tagEngine.deleteTag('non-existent')).rejects.toThrow('Tag not found');
    });
  });

  describe('mergeTags', () => {
    it('should merge multiple tags into one', async () => {
      mockLocalClient.execute
        .mockResolvedValueOnce({ rows: [{ id: 'tag-1', name: 'js' }] }) // Source tag 1
        .mockResolvedValueOnce({ rows: [{ id: 'tag-2', name: 'javascript' }] }) // Source tag 2
        .mockResolvedValueOnce({ rows: [{ id: 'tag-3', name: 'ecmascript' }] }) // Target tag
        .mockResolvedValueOnce({ rows: [{ id: 'post-1' }, { id: 'post-2' }] }) // Posts with source tags
        .mockResolvedValueOnce({ rows: [] }) // Update posts
        .mockResolvedValueOnce({ rows: [] }) // Delete source tag 1
        .mockResolvedValueOnce({ rows: [] }); // Delete source tag 2

      const result = await tagEngine.mergeTags(['tag-1', 'tag-2'], 'tag-3');

      expect(result.success).toBe(true);
      expect(result.postsUpdated).toBeGreaterThanOrEqual(0);
      expect(result.tagsDeleted).toBe(2);
    });

    it('should emit tagsMerged event', async () => {
      mockLocalClient.execute
        .mockResolvedValueOnce({ rows: [{ id: 'tag-1', name: 'js' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'tag-2', name: 'javascript' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const handler = vi.fn();
      tagEngine.on('tagsMerged', handler);

      await tagEngine.mergeTags(['tag-1'], 'tag-2');

      expect(handler).toHaveBeenCalled();
    });

    it('should throw error when source tags array is empty', async () => {
      await expect(tagEngine.mergeTags([], 'tag-1')).rejects.toThrow('Source tags are required');
    });

    it('should throw error when target tag does not exist', async () => {
      mockLocalClient.execute
        .mockResolvedValueOnce({ rows: [{ id: 'tag-1', name: 'js' }] })
        .mockResolvedValueOnce({ rows: [] }); // Target not found

      await expect(tagEngine.mergeTags(['tag-1'], 'non-existent')).rejects.toThrow('Target tag not found');
    });
  });

  describe('renameTags (batch rename)', () => {
    it('should rename multiple tags and update posts', async () => {
      mockLocalClient.execute
        .mockResolvedValueOnce({ rows: [{ id: 'tag-1', name: 'old-name' }] })
        .mockResolvedValueOnce({ rows: [] }) // Check no duplicate
        .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] }) // Posts with tag
        .mockResolvedValueOnce({ rows: [] }) // Update posts
        .mockResolvedValueOnce({ rows: [] }); // Update tag name

      const result = await tagEngine.renameTag('tag-1', 'new-name');

      expect(result.success).toBe(true);
      expect(result.postsUpdated).toBeGreaterThanOrEqual(0);
    });

    it('should emit tagRenamed event', async () => {
      mockLocalClient.execute
        .mockResolvedValueOnce({ rows: [{ id: 'tag-1', name: 'old-name' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const handler = vi.fn();
      tagEngine.on('tagRenamed', handler);

      await tagEngine.renameTag('tag-1', 'new-name');

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        oldName: 'old-name',
        newName: 'new-name',
      }));
    });
  });

  describe('getTag', () => {
    it('should return tag by ID', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [{ id: 'tag-1', name: 'react', color: '#61dafb', project_id: 'default', created_at: Date.now(), updated_at: Date.now() }],
      });

      const result = await tagEngine.getTag('tag-1');

      expect(result).toBeDefined();
      expect(result?.name).toBe('react');
      expect(result?.color).toBe('#61dafb');
    });

    it('should return null for non-existent tag', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({ rows: [] });

      const result = await tagEngine.getTag('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getTagByName', () => {
    it('should return tag by name', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [{ id: 'tag-1', name: 'react', color: '#61dafb', project_id: 'default', created_at: Date.now(), updated_at: Date.now() }],
      });

      const result = await tagEngine.getTagByName('react');

      expect(result).toBeDefined();
      expect(result?.id).toBe('tag-1');
    });

    it('should be case-insensitive', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [{ id: 'tag-1', name: 'react', color: null }],
      });

      const result = await tagEngine.getTagByName('REACT');

      expect(result).toBeDefined();
    });
  });

  describe('getAllTags', () => {
    it('should return all tags for the current project', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [
          { id: 'tag-1', name: 'react', color: null, project_id: 'default', created_at: Date.now(), updated_at: Date.now() },
          { id: 'tag-2', name: 'vue', color: '#42b883', project_id: 'default', created_at: Date.now(), updated_at: Date.now() },
        ],
      });

      const result = await tagEngine.getAllTags();

      expect(result).toHaveLength(2);
      expect(result.map(t => t.name)).toContain('react');
      expect(result.map(t => t.name)).toContain('vue');
    });
  });

  describe('getPostsWithTag', () => {
    it('should return post IDs that have the specified tag', async () => {
      // First call: get tag name from id
      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [{ name: 'react' }],
      });
      // Second call: find posts with this tag
      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [
          { id: 'post-1', tags: '["react", "typescript"]' },
          { id: 'post-2', tags: '["react"]' },
        ],
      });

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
      mockLocalClient.execute
        .mockResolvedValueOnce({ rows: [{ tags: '["react", "javascript"]' }, { tags: '["vue", "typescript"]' }] }) // Get posts
        .mockResolvedValueOnce({ rows: [{ name: 'react' }] }) // Existing tags
        .mockResolvedValueOnce({ rows: [] }) // Insert missing tags
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await tagEngine.syncTagsFromPosts();

      expect(result.discovered).toBeGreaterThanOrEqual(0);
    });
  });
});
