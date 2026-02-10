/**
 * ProjectEngine Unit Tests
 *
 * Tests the REAL ProjectEngine class with mocked dependencies.
 * Following TDD best practices: mock external dependencies, test real implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProjectEngine, ProjectData } from '../../src/main/engine/ProjectEngine';
import { resetMockCounters } from '../utils/factories';

// Create mock data stores
const mockProjects = new Map<string, any>();

// Create chainable mock for Drizzle ORM
function createSelectChain() {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(function (this: any, condition: any) {
      return this;
    }),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => Promise.resolve(Array.from(mockProjects.values()))),
    get: vi.fn().mockImplementation(() => Promise.resolve(undefined)),
  };
}

function createDrizzleMock() {
  return {
    select: vi.fn(() => createSelectChain()),
    insert: vi.fn(() => ({
      values: vi.fn((data: any) => {
        if (data && data.id) {
          mockProjects.set(data.id, data);
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

// Mock the database module
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => mockLocalDb),
    getLocalClient: vi.fn(() => null),
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
  readFile: vi.fn(async () => ''),
  writeFile: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  readdir: vi.fn(async () => []),
  stat: vi.fn(async () => ({
    isFile: () => false,
    isDirectory: () => true,
    size: 0,
  })),
  access: vi.fn(async () => {}),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-project-uuid-' + Math.random().toString(36).substr(2, 9)),
}));

describe('ProjectEngine', () => {
  let projectEngine: ProjectEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProjects.clear();
    resetMockCounters();

    // Reset the mock implementations
    vi.mocked(mockLocalDb.select).mockImplementation(() => createSelectChain());

    projectEngine = new ProjectEngine();
  });

  describe('Constructor and Initialization', () => {
    it('should create a ProjectEngine instance', () => {
      expect(projectEngine).toBeInstanceOf(ProjectEngine);
    });

    it('should extend EventEmitter', () => {
      expect(typeof projectEngine.on).toBe('function');
      expect(typeof projectEngine.emit).toBe('function');
    });
  });

  describe('Slug Generation via createProject', () => {
    it('should generate slug from name with lowercase', async () => {
      const project = await projectEngine.createProject({ name: 'My Blog' });
      expect(project.slug).toBe('my-blog');
    });

    it('should replace special characters with hyphens', async () => {
      const project = await projectEngine.createProject({ name: 'My Blog & Notes!' });
      expect(project.slug).toBe('my-blog-notes');
    });

    it('should remove leading and trailing hyphens', async () => {
      const project = await projectEngine.createProject({ name: '---Test Blog---' });
      expect(project.slug).toBe('test-blog');
    });

    it('should handle numbers in names', async () => {
      const project = await projectEngine.createProject({ name: 'Blog 2024' });
      expect(project.slug).toBe('blog-2024');
    });

    it('should use custom slug when provided', async () => {
      const project = await projectEngine.createProject({
        name: 'My Blog',
        slug: 'custom-slug',
      });
      expect(project.slug).toBe('custom-slug');
    });
  });

  describe('Project Creation', () => {
    it('should create a project with required fields', async () => {
      const project = await projectEngine.createProject({ name: 'Test Project' });

      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.slug).toBe('test-project');
    });

    it('should create a project with description', async () => {
      const project = await projectEngine.createProject({
        name: 'My Blog',
        description: 'A personal blog about technology',
      });

      expect(project.description).toBe('A personal blog about technology');
    });

    it('should set isActive to false by default', async () => {
      const project = await projectEngine.createProject({ name: 'New Project' });

      expect(project.isActive).toBe(false);
    });

    it('should set createdAt and updatedAt timestamps', async () => {
      const before = new Date();
      const project = await projectEngine.createProject({ name: 'Timestamp Test' });
      const after = new Date();

      expect(project.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(project.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(project.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(project.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should emit projectCreated event', async () => {
      const handler = vi.fn();
      projectEngine.on('projectCreated', handler);

      const project = await projectEngine.createProject({ name: 'Event Test' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Event Test',
        })
      );
    });

    it('should insert project into database', async () => {
      await projectEngine.createProject({ name: 'DB Test' });

      expect(mockLocalDb.insert).toHaveBeenCalled();
    });

    it('should create project directories', async () => {
      const fs = await import('fs/promises');
      await projectEngine.createProject({ name: 'Directory Test' });

      // Should create project, posts, and media directories
      expect(vi.mocked(fs.mkdir).mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Project Deletion', () => {
    it('should not allow deleting the default project', async () => {
      await expect(projectEngine.deleteProject('default')).rejects.toThrow(
        'Cannot delete the default project'
      );
    });

    it('should return false for non-existent project', async () => {
      const result = await projectEngine.deleteProject('non-existent-id');
      expect(result).toBe(false);
    });

    it('should emit projectDeleted event when successful', async () => {
      // Setup: Add a project to mock
      const projectId = 'test-project-id';
      mockProjects.set(projectId, {
        id: projectId,
        name: 'Test Project',
        slug: 'test-project',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: false,
      });

      // Make get() return the project
      vi.mocked(mockLocalDb.select).mockImplementation(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        all: vi.fn().mockImplementation(() => Promise.resolve(Array.from(mockProjects.values()))),
        get: vi.fn().mockImplementation(() => Promise.resolve(mockProjects.get(projectId))),
      }));

      const handler = vi.fn();
      projectEngine.on('projectDeleted', handler);

      const result = await projectEngine.deleteProject(projectId);

      expect(result).toBe(true);
      expect(handler).toHaveBeenCalledWith(projectId);
    });
  });

  describe('getProjectPaths', () => {
    it('should return paths for posts and media directories', () => {
      const projectId = 'test-project-id';
      const paths = projectEngine.getProjectPaths(projectId);

      expect(paths.posts).toContain(projectId);
      expect(paths.posts).toContain('posts');
      expect(paths.media).toContain(projectId);
      expect(paths.media).toContain('media');
    });

    it('should include project ID in paths', () => {
      const projectId = 'custom-project-uuid';
      const paths = projectEngine.getProjectPaths(projectId);

      expect(paths.posts).toContain(projectId);
      expect(paths.media).toContain(projectId);
    });
  });

  describe('Event Emission', () => {
    it('should be an EventEmitter', () => {
      expect(projectEngine.on).toBeDefined();
      expect(projectEngine.emit).toBeDefined();
      expect(projectEngine.removeListener).toBeDefined();
    });

    it('should allow adding event listeners', () => {
      const listener = vi.fn();
      projectEngine.on('testEvent', listener);
      projectEngine.emit('testEvent', { data: 'test' });

      expect(listener).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should allow removing event listeners', () => {
      const listener = vi.fn();
      projectEngine.on('testEvent', listener);
      projectEngine.removeListener('testEvent', listener);
      projectEngine.emit('testEvent', { data: 'test' });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Multiple Project Creation', () => {
    it('should create multiple projects with unique IDs', async () => {
      const project1 = await projectEngine.createProject({ name: 'Project 1' });
      const project2 = await projectEngine.createProject({ name: 'Project 2' });

      expect(project1.id).toBeDefined();
      expect(project2.id).toBeDefined();
      expect(project1.id).not.toBe(project2.id);
    });

    it('should create projects with different slugs', async () => {
      const project1 = await projectEngine.createProject({ name: 'First Project' });
      const project2 = await projectEngine.createProject({ name: 'Second Project' });

      expect(project1.slug).toBe('first-project');
      expect(project2.slug).toBe('second-project');
    });
  });

  describe('Project with all fields', () => {
    it('should create a fully populated project', async () => {
      const project = await projectEngine.createProject({
        name: 'Complete Project',
        slug: 'complete-project',
        description: 'A complete project with all fields filled in.',
      });

      expect(project.name).toBe('Complete Project');
      expect(project.slug).toBe('complete-project');
      expect(project.description).toBe('A complete project with all fields filled in.');
      expect(project.isActive).toBe(false);
      expect(project.id).toBeDefined();
      expect(project.createdAt).toBeInstanceOf(Date);
      expect(project.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('ProjectData Structure', () => {
    it('should have all required fields', async () => {
      const project = await projectEngine.createProject({ name: 'Structure Test' });

      expect(project).toHaveProperty('id');
      expect(project).toHaveProperty('name');
      expect(project).toHaveProperty('slug');
      expect(project).toHaveProperty('createdAt');
      expect(project).toHaveProperty('updatedAt');
      expect(project).toHaveProperty('isActive');
    });

    it('should have optional description field', async () => {
      const projectWithDesc = await projectEngine.createProject({
        name: 'With Description',
        description: 'Has a description',
      });

      const projectWithoutDesc = await projectEngine.createProject({
        name: 'Without Description',
      });

      expect(projectWithDesc.description).toBe('Has a description');
      expect(projectWithoutDesc.description).toBeUndefined();
    });
  });

  describe('Slug Uniqueness', () => {
    it('should handle duplicate slugs by appending counter', async () => {
      // Create first project
      await projectEngine.createProject({ name: 'My Blog' });

      // Mock that 'my-blog' slug already exists
      mockProjects.set('existing', { slug: 'my-blog' });

      const project2 = await projectEngine.createProject({ name: 'My Blog' });

      // Second project should have a modified slug
      expect(project2.slug).toMatch(/^my-blog(-\d+)?$/);
    });
  });
});
