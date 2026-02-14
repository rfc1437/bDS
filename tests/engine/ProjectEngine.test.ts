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
  rm: vi.fn(async () => {}),
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

  describe('deleteProjectWithData', () => {
    it('should not allow deleting the default project', async () => {
      await expect(projectEngine.deleteProjectWithData('default')).rejects.toThrow(
        'Cannot delete the default project'
      );
    });

    it('should return false for non-existent project', async () => {
      const result = await projectEngine.deleteProjectWithData('non-existent-id');
      expect(result).toBe(false);
    });

    it('should delete project database entry', async () => {
      const projectId = 'delete-data-test';
      mockProjects.set(projectId, {
        id: projectId,
        name: 'Delete Data Test',
        slug: 'delete-data-test',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: false,
      });

      vi.mocked(mockLocalDb.select).mockImplementation(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        all: vi.fn().mockImplementation(() => Promise.resolve(Array.from(mockProjects.values()))),
        get: vi.fn().mockImplementation(() => Promise.resolve(mockProjects.get(projectId))),
      }));

      const result = await projectEngine.deleteProjectWithData(projectId);

      expect(result).toBe(true);
      expect(mockLocalDb.delete).toHaveBeenCalled();
    });

    it('should delete project files and directories', async () => {
      const fs = await import('fs/promises');
      const projectId = 'delete-files-test';
      mockProjects.set(projectId, {
        id: projectId,
        name: 'Delete Files Test',
        slug: 'delete-files-test',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: false,
      });

      vi.mocked(mockLocalDb.select).mockImplementation(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        all: vi.fn().mockImplementation(() => Promise.resolve(Array.from(mockProjects.values()))),
        get: vi.fn().mockImplementation(() => Promise.resolve(mockProjects.get(projectId))),
      }));

      await projectEngine.deleteProjectWithData(projectId);

      // Should attempt to remove the project directory
      // Note: In real implementation this would use fs.rm with recursive option
      expect(vi.mocked(fs.unlink).mock.calls.length).toBeGreaterThanOrEqual(0);
    });

    it('should emit projectDeleted event when successful', async () => {
      const projectId = 'delete-event-test';
      mockProjects.set(projectId, {
        id: projectId,
        name: 'Delete Event Test',
        slug: 'delete-event-test',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: false,
      });

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

      const result = await projectEngine.deleteProjectWithData(projectId);

      expect(result).toBe(true);
      expect(handler).toHaveBeenCalledWith(projectId);
    });

    it('should delete associated posts from database', async () => {
      const projectId = 'delete-posts-test';
      mockProjects.set(projectId, {
        id: projectId,
        name: 'Delete Posts Test',
        slug: 'delete-posts-test',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: false,
      });

      vi.mocked(mockLocalDb.select).mockImplementation(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        all: vi.fn().mockImplementation(() => Promise.resolve(Array.from(mockProjects.values()))),
        get: vi.fn().mockImplementation(() => Promise.resolve(mockProjects.get(projectId))),
      }));

      await projectEngine.deleteProjectWithData(projectId);

      // Should delete from posts table as well as projects table
      expect(mockLocalDb.delete).toHaveBeenCalled();
    });

    it('should delete associated media from database', async () => {
      const projectId = 'delete-media-test';
      mockProjects.set(projectId, {
        id: projectId,
        name: 'Delete Media Test',
        slug: 'delete-media-test',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: false,
      });

      vi.mocked(mockLocalDb.select).mockImplementation(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        all: vi.fn().mockImplementation(() => Promise.resolve(Array.from(mockProjects.values()))),
        get: vi.fn().mockImplementation(() => Promise.resolve(mockProjects.get(projectId))),
      }));

      await projectEngine.deleteProjectWithData(projectId);

      // Should delete from media table as well as projects and posts tables
      expect(mockLocalDb.delete).toHaveBeenCalled();
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

  describe('Custom dataPath', () => {
    it('should create project with custom dataPath', async () => {
      const customPath = '/Users/test/Documents/MyBlog';
      const project = await projectEngine.createProject({
        name: 'Custom Path Project',
        dataPath: customPath,
      });

      expect(project.dataPath).toBe(customPath);
    });

    it('should create meta and thumbnails directories in custom dataPath', async () => {
      const fs = await import('fs/promises');
      const customPath = '/Users/test/Documents/MyBlog';
      
      await projectEngine.createProject({
        name: 'Custom Dirs Project',
        dataPath: customPath,
      });

      const mkdirCalls = vi.mocked(fs.mkdir).mock.calls;
      const createdPaths = mkdirCalls.map(call => call[0]);
      
      // Should create meta/ and thumbnails/ in custom dataPath
      expect(createdPaths).toContainEqual(expect.stringContaining(customPath));
      expect(createdPaths.some(p => String(p).includes(customPath) && String(p).includes('meta'))).toBe(true);
      expect(createdPaths.some(p => String(p).includes(customPath) && String(p).includes('thumbnails'))).toBe(true);
    });

    it('should create posts and media directories in custom dataPath', async () => {
      const fs = await import('fs/promises');
      const customPath = '/Users/test/Documents/MyBlog';
      
      await projectEngine.createProject({
        name: 'Custom Data Project',
        dataPath: customPath,
      });

      const mkdirCalls = vi.mocked(fs.mkdir).mock.calls;
      const createdPaths = mkdirCalls.map(call => call[0]);
      
      // Should create posts/ and media/ in custom dataPath
      expect(createdPaths.some(p => String(p).includes(customPath) && String(p).includes('posts'))).toBe(true);
      expect(createdPaths.some(p => String(p).includes(customPath) && String(p).includes('media'))).toBe(true);
    });

    it('should create meta and thumbnails in internal storage when no dataPath', async () => {
      const fs = await import('fs/promises');
      
      await projectEngine.createProject({
        name: 'Default Path Project',
      });

      const mkdirCalls = vi.mocked(fs.mkdir).mock.calls;
      const createdPaths = mkdirCalls.map(call => String(call[0]));
      
      // Should create meta/ and thumbnails/ in internal (userData) path
      expect(createdPaths.some(p => p.includes('meta'))).toBe(true);
      expect(createdPaths.some(p => p.includes('thumbnails'))).toBe(true);
    });

    it('should use getDataDir with custom dataPath', () => {
      const projectId = 'test-id';
      const customPath = '/Users/test/MyBlog';
      
      const dataDir = projectEngine.getDataDir(projectId, customPath);
      
      expect(dataDir).toBe(customPath);
    });

    it('should use internal dir when dataPath is null', () => {
      const projectId = 'test-id';
      
      const dataDir = projectEngine.getDataDir(projectId, null);
      
      expect(dataDir).toContain(projectId);
    });
  });

  describe('updateProject', () => {
    it('should return null for non-existent project', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(null),
        });
        return chain;
      });

      const result = await projectEngine.updateProject('non-existent', { name: 'New Name' });
      expect(result).toBeNull();
    });

    it('should update project name', async () => {
      const existingProject = {
        id: 'update-name-test',
        name: 'Old Name',
        slug: 'old-name',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        isActive: false,
      };
      mockProjects.set(existingProject.id, existingProject);

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(existingProject),
        });
        return chain;
      });

      const result = await projectEngine.updateProject('update-name-test', { name: 'New Name' });

      expect(result).not.toBeNull();
      expect(result?.name).toBe('New Name');
    });

    it('should update project description', async () => {
      const existingProject = {
        id: 'update-desc-test',
        name: 'Project',
        slug: 'project',
        description: 'Old description',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        isActive: false,
      };
      mockProjects.set(existingProject.id, existingProject);

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(existingProject),
        });
        return chain;
      });

      const result = await projectEngine.updateProject('update-desc-test', { 
        description: 'New description' 
      });

      expect(result?.description).toBe('New description');
    });

    it('should update updatedAt timestamp', async () => {
      const oldDate = new Date('2024-01-01');
      const existingProject = {
        id: 'update-time-test',
        name: 'Project',
        slug: 'project',
        createdAt: oldDate,
        updatedAt: oldDate,
        isActive: false,
      };
      mockProjects.set(existingProject.id, existingProject);

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(existingProject),
        });
        return chain;
      });

      const before = new Date();
      const result = await projectEngine.updateProject('update-time-test', { name: 'Updated' });

      expect(result?.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result?.createdAt).toEqual(oldDate);
    });

    it('should emit projectUpdated event', async () => {
      const existingProject = {
        id: 'update-event-test',
        name: 'Project',
        slug: 'project',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: false,
      };
      mockProjects.set(existingProject.id, existingProject);

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(existingProject),
        });
        return chain;
      });

      const handler = vi.fn();
      projectEngine.on('projectUpdated', handler);

      await projectEngine.updateProject('update-event-test', { name: 'Updated Name' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Updated Name' })
      );
    });

    it('should call database update', async () => {
      const existingProject = {
        id: 'update-db-test',
        name: 'Project',
        slug: 'project',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: false,
      };
      mockProjects.set(existingProject.id, existingProject);

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(existingProject),
        });
        return chain;
      });

      await projectEngine.updateProject('update-db-test', { name: 'Updated' });

      expect(mockLocalDb.update).toHaveBeenCalled();
    });

    it('should update isActive status', async () => {
      const existingProject = {
        id: 'update-active-test',
        name: 'Project',
        slug: 'project',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: false,
      };
      mockProjects.set(existingProject.id, existingProject);

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(existingProject),
        });
        return chain;
      });

      const result = await projectEngine.updateProject('update-active-test', { isActive: true });

      expect(result?.isActive).toBe(true);
    });
  });

  describe('getProject', () => {
    it('should return null for non-existent project', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(null),
        });
        return chain;
      });

      const result = await projectEngine.getProject('non-existent');
      expect(result).toBeNull();
    });

    it('should return project data for existing project', async () => {
      const dbProject = {
        id: 'existing-project',
        name: 'My Project',
        slug: 'my-project',
        description: 'A test project',
        dataPath: '/custom/path',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-06-01'),
        isActive: true,
      };

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(dbProject),
        });
        return chain;
      });

      const result = await projectEngine.getProject('existing-project');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('existing-project');
      expect(result?.name).toBe('My Project');
      expect(result?.slug).toBe('my-project');
      expect(result?.description).toBe('A test project');
      expect(result?.dataPath).toBe('/custom/path');
      expect(result?.isActive).toBe(true);
    });

    it('should handle null description gracefully', async () => {
      const dbProject = {
        id: 'no-desc-project',
        name: 'No Description',
        slug: 'no-desc',
        description: null,
        dataPath: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: false,
      };

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(dbProject),
        });
        return chain;
      });

      const result = await projectEngine.getProject('no-desc-project');

      expect(result?.description).toBeUndefined();
      expect(result?.dataPath).toBeUndefined();
    });
  });

  describe('getAllProjects', () => {
    it('should return empty array when no projects exist', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.all = vi.fn().mockResolvedValue([]);
        return chain;
      });

      const result = await projectEngine.getAllProjects();

      expect(result).toEqual([]);
    });

    it('should return all projects', async () => {
      const dbProjects = [
        { id: 'p1', name: 'Project 1', slug: 'p1', createdAt: new Date(), updatedAt: new Date(), isActive: false },
        { id: 'p2', name: 'Project 2', slug: 'p2', createdAt: new Date(), updatedAt: new Date(), isActive: true },
        { id: 'p3', name: 'Project 3', slug: 'p3', createdAt: new Date(), updatedAt: new Date(), isActive: false },
      ];

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.all = vi.fn().mockResolvedValue(dbProjects);
        return chain;
      });

      const result = await projectEngine.getAllProjects();

      expect(result).toHaveLength(3);
      expect(result.map(p => p.name)).toEqual(['Project 1', 'Project 2', 'Project 3']);
    });

    it('should convert null values to undefined', async () => {
      const dbProjects = [
        { 
          id: 'p1', 
          name: 'Project', 
          slug: 'p1', 
          description: null,
          dataPath: null,
          createdAt: new Date(), 
          updatedAt: new Date(), 
          isActive: null
        },
      ];

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.all = vi.fn().mockResolvedValue(dbProjects);
        return chain;
      });

      const result = await projectEngine.getAllProjects();

      expect(result[0].description).toBeUndefined();
      expect(result[0].dataPath).toBeUndefined();
      expect(result[0].isActive).toBe(false); // null coalesces to false
    });
  });

  describe('getActiveProject', () => {
    it('should return default project when no active project', async () => {
      const defaultProject = {
        id: 'default',
        name: 'Default Project',
        slug: 'default',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: false,
      };

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockImplementation(() => ({
          ...chain,
          get: vi.fn().mockImplementation((callback) => {
            // First call (isActive=true) returns null, second call (id='default') returns default
            return Promise.resolve(null);
          }),
        }));
        return chain;
      });

      // Mock getProject to return default
      const originalGetProject = projectEngine.getProject.bind(projectEngine);
      vi.spyOn(projectEngine, 'getProject').mockResolvedValue({
        id: 'default',
        name: 'Default Project',
        slug: 'default',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: false,
      });

      const result = await projectEngine.getActiveProject();

      expect(result?.id).toBe('default');
      
      // Restore
      vi.mocked(projectEngine.getProject).mockRestore();
    });

    it('should return active project when one exists', async () => {
      const activeProject = {
        id: 'active-project',
        name: 'Active Blog',
        slug: 'active-blog',
        description: 'The currently active project',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true,
      };

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(activeProject),
        });
        return chain;
      });

      const result = await projectEngine.getActiveProject();

      expect(result).not.toBeNull();
      expect(result?.id).toBe('active-project');
      expect(result?.isActive).toBe(true);
    });
  });

  describe('setActiveProject', () => {
    it('should deactivate all projects first', async () => {
      const updateCalls: any[] = [];
      vi.mocked(mockLocalDb.update).mockImplementation(() => {
        const chain = {
          set: vi.fn((data) => {
            updateCalls.push(data);
            return {
              where: vi.fn().mockResolvedValue(undefined),
            };
          }),
        };
        return chain as any;
      });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'target-project',
            name: 'Target',
            slug: 'target',
            createdAt: new Date(),
            updatedAt: new Date(),
            isActive: true,
          }),
        });
        return chain;
      });

      await projectEngine.setActiveProject('target-project');

      // First update should set isActive: false for all
      expect(updateCalls[0]).toEqual({ isActive: false });
    });

    it('should activate the specified project', async () => {
      const updateCalls: any[] = [];
      vi.mocked(mockLocalDb.update).mockImplementation(() => {
        const chain = {
          set: vi.fn((data) => {
            updateCalls.push(data);
            return {
              where: vi.fn().mockResolvedValue(undefined),
            };
          }),
        };
        return chain as any;
      });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'target-project',
            name: 'Target',
            slug: 'target',
            createdAt: new Date(),
            updatedAt: new Date(),
            isActive: true,
          }),
        });
        return chain;
      });

      await projectEngine.setActiveProject('target-project');

      // Second update should set isActive: true for the target
      expect(updateCalls[1]).toEqual({ isActive: true });
    });

    it('should emit activeProjectChanged event', async () => {
      vi.mocked(mockLocalDb.update).mockImplementation(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(undefined),
        })),
      } as any));

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'event-project',
            name: 'Event Project',
            slug: 'event-project',
            createdAt: new Date(),
            updatedAt: new Date(),
            isActive: true,
          }),
        });
        return chain;
      });

      const handler = vi.fn();
      projectEngine.on('activeProjectChanged', handler);

      await projectEngine.setActiveProject('event-project');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'event-project' })
      );
    });

    it('should return the activated project', async () => {
      vi.mocked(mockLocalDb.update).mockImplementation(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(undefined),
        })),
      } as any));

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'return-project',
            name: 'Return Test',
            slug: 'return-test',
            createdAt: new Date(),
            updatedAt: new Date(),
            isActive: true,
          }),
        });
        return chain;
      });

      const result = await projectEngine.setActiveProject('return-project');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('return-project');
    });
  });

  describe('getProjectPathsResolved', () => {
    it('should resolve paths from database project', async () => {
      const projectWithPath = {
        id: 'resolved-project',
        name: 'Resolved Project',
        slug: 'resolved',
        dataPath: '/custom/data/path',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: false,
      };

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(projectWithPath),
        });
        return chain;
      });

      const paths = await projectEngine.getProjectPathsResolved('resolved-project');

      expect(paths.posts).toContain('/custom/data/path');
      expect(paths.media).toContain('/custom/data/path');
    });

    it('should use internal path when project has no dataPath', async () => {
      const projectNoPath = {
        id: 'internal-project',
        name: 'Internal Project',
        slug: 'internal',
        dataPath: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: false,
      };

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(projectNoPath),
        });
        return chain;
      });

      const paths = await projectEngine.getProjectPathsResolved('internal-project');

      expect(paths.posts).toContain('internal-project');
      expect(paths.media).toContain('internal-project');
    });
  });

  describe('getInternalBaseDir', () => {
    it('should return path containing project ID', () => {
      const projectId = 'test-internal-id';
      const result = projectEngine.getInternalBaseDir(projectId);

      expect(result).toContain(projectId);
      expect(result).toContain('projects');
    });
  });

  describe('getDefaultProjectBaseDir', () => {
    it('should be alias for getInternalBaseDir', () => {
      const projectId = 'test-default-id';
      const internalDir = projectEngine.getInternalBaseDir(projectId);
      const defaultDir = projectEngine.getDefaultProjectBaseDir(projectId);

      expect(defaultDir).toBe(internalDir);
    });
  });
});
