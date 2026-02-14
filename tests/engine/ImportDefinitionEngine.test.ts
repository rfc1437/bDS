/**
 * ImportDefinitionEngine Unit Tests
 *
 * Tests the REAL ImportDefinitionEngine class with mocked database.
 * Following TDD best practices: mock external dependencies, test real implementation.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Store for mock data
const mockDefinitions = new Map<string, any>();

// Create chainable mock for Drizzle ORM that is thenable (can be awaited)
function createSelectChain(getData: () => any[]) {
  const chain: any = {
    from: vi.fn().mockImplementation(() => chain),
    where: vi.fn().mockImplementation(() => chain),
    orderBy: vi.fn().mockImplementation(() => chain),
    limit: vi.fn().mockImplementation(() => chain),
    // Make the chain thenable so it can be awaited directly
    then: (resolve: (value: any[]) => void, reject?: (reason: any) => void) => {
      return Promise.resolve(getData()).then(resolve, reject);
    },
  };
  return chain;
}

// Track what data Drizzle queries should return
let mockDrizzleSelectResults: any[][] = [];

const mockLocalDb = {
  select: vi.fn(() => createSelectChain(() => mockDrizzleSelectResults.shift() || [])),
  insert: vi.fn(() => ({
    values: vi.fn((data: any) => {
      if (data && data.id) {
        mockDefinitions.set(data.id, {
          id: data.id,
          projectId: data.projectId,
          name: data.name,
          wxrFilePath: data.wxrFilePath,
          uploadsFolderPath: data.uploadsFolderPath,
          lastAnalysisResult: data.lastAnalysisResult,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
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

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

import { ImportDefinitionEngine } from '../../src/main/engine/ImportDefinitionEngine';

describe('ImportDefinitionEngine', () => {
  let engine: ImportDefinitionEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDefinitions.clear();
    mockDrizzleSelectResults = [];
    engine = new ImportDefinitionEngine();
    engine.setProjectContext('test-project');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create a new instance', () => {
      expect(engine).toBeDefined();
      expect(engine).toBeInstanceOf(ImportDefinitionEngine);
    });
  });

  describe('setProjectContext', () => {
    it('should set and return the current project ID', () => {
      engine.setProjectContext('project-abc');
      expect(engine.getProjectContext()).toBe('project-abc');
    });
  });

  describe('createDefinition', () => {
    it('should create a definition with default name', async () => {
      const def = await engine.createDefinition();

      expect(def).toBeDefined();
      expect(def.id).toMatch(/^import_/);
      expect(def.name).toBe('Untitled Import');
      expect(def.projectId).toBe('test-project');
      expect(def.wxrFilePath).toBeNull();
      expect(def.uploadsFolderPath).toBeNull();
      expect(def.lastAnalysisResult).toBeNull();
      expect(def.createdAt).toBeDefined();
      expect(def.updatedAt).toBeDefined();
    });

    it('should create a definition with custom name', async () => {
      const def = await engine.createDefinition('My WordPress Blog');

      expect(def.name).toBe('My WordPress Blog');
    });

    it('should insert into the database', async () => {
      await engine.createDefinition('Test Import');

      expect(mockLocalDb.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDefinition', () => {
    it('should return a definition by ID', async () => {
      const created = await engine.createDefinition('My Import');
      // Set up mock to return the created definition
      mockDrizzleSelectResults = [[{
        id: created.id,
        projectId: 'test-project',
        name: 'My Import',
        wxrFilePath: null,
        uploadsFolderPath: null,
        lastAnalysisResult: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }]];

      const def = await engine.getDefinition(created.id);

      expect(def).toBeDefined();
      expect(def!.id).toBe(created.id);
      expect(def!.name).toBe('My Import');
    });

    it('should return null for non-existent ID', async () => {
      mockDrizzleSelectResults = [[]];
      const def = await engine.getDefinition('non-existent-id');

      expect(def).toBeNull();
    });

    it('should not return definitions from other projects', async () => {
      const created = await engine.createDefinition('My Import');
      engine.setProjectContext('other-project');
      mockDrizzleSelectResults = [[]]; // would be filtered by project

      const def = await engine.getDefinition(created.id);

      expect(def).toBeNull();
    });

    it('should parse lastAnalysisResult JSON', async () => {
      const created = await engine.createDefinition('My Import');
      // Set up mock to return the definition with analysis result
      mockDrizzleSelectResults = [[{
        id: created.id,
        projectId: 'test-project',
        name: 'My Import',
        wxrFilePath: null,
        uploadsFolderPath: null,
        lastAnalysisResult: JSON.stringify({ posts: { total: 5 } }),
        createdAt: new Date(),
        updatedAt: new Date(),
      }]];

      const def = await engine.getDefinition(created.id);

      expect(def!.lastAnalysisResult).toEqual({ posts: { total: 5 } });
    });
  });

  describe('getAllForProject', () => {
    it('should return empty array when no definitions exist', async () => {
      mockDrizzleSelectResults = [[]];
      const defs = await engine.getAllForProject();

      expect(defs).toEqual([]);
    });

    it('should return all definitions for the current project', async () => {
      await engine.createDefinition('Import 1');
      await engine.createDefinition('Import 2');
      // Mock returning both definitions
      mockDrizzleSelectResults = [[
        { id: 'id1', projectId: 'test-project', name: 'Import 1', wxrFilePath: null, uploadsFolderPath: null, lastAnalysisResult: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 'id2', projectId: 'test-project', name: 'Import 2', wxrFilePath: null, uploadsFolderPath: null, lastAnalysisResult: null, createdAt: new Date(), updatedAt: new Date() },
      ]];

      const defs = await engine.getAllForProject();

      expect(defs).toHaveLength(2);
    });

    it('should not include definitions from other projects', async () => {
      await engine.createDefinition('Import A');
      engine.setProjectContext('other-project');
      await engine.createDefinition('Import B');
      engine.setProjectContext('test-project');
      // Mock returning only the test-project definition
      mockDrizzleSelectResults = [[
        { id: 'id1', projectId: 'test-project', name: 'Import A', wxrFilePath: null, uploadsFolderPath: null, lastAnalysisResult: null, createdAt: new Date(), updatedAt: new Date() },
      ]];

      const defs = await engine.getAllForProject();

      expect(defs).toHaveLength(1);
      expect(defs[0].name).toBe('Import A');
    });

    it('should return definitions ordered by updatedAt DESC', async () => {
      const olderDate = new Date('2024-01-01');
      const newerDate = new Date('2024-02-01');
      mockDrizzleSelectResults = [[
        { id: 'id2', projectId: 'test-project', name: 'Newer', wxrFilePath: null, uploadsFolderPath: null, lastAnalysisResult: null, createdAt: newerDate, updatedAt: newerDate },
        { id: 'id1', projectId: 'test-project', name: 'Older', wxrFilePath: null, uploadsFolderPath: null, lastAnalysisResult: null, createdAt: olderDate, updatedAt: olderDate },
      ]];

      const defs = await engine.getAllForProject();

      expect(defs[0].name).toBe('Newer');
      expect(defs[1].name).toBe('Older');
    });
  });

  describe('updateDefinition', () => {
    it('should update the name', async () => {
      const created = await engine.createDefinition('Old Name');
      // First call for getDefinition check, second for returning updated data
      mockDrizzleSelectResults = [
        [{ // getDefinition call inside updateDefinition
          id: created.id,
          projectId: 'test-project',
          name: 'Old Name',
          wxrFilePath: null,
          uploadsFolderPath: null,
          lastAnalysisResult: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
        [{ // return after update
          id: created.id,
          projectId: 'test-project',
          name: 'New Name',
          wxrFilePath: null,
          uploadsFolderPath: null,
          lastAnalysisResult: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
      ];

      const updated = await engine.updateDefinition(created.id, { name: 'New Name' });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe('New Name');
    });

    it('should update wxrFilePath', async () => {
      const created = await engine.createDefinition('Test');
      // First call for check, second for returning updated data
      mockDrizzleSelectResults = [
        [{ // getDefinition check
          id: created.id,
          projectId: 'test-project',
          name: 'Test',
          wxrFilePath: null,
          uploadsFolderPath: null,
          lastAnalysisResult: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
        [{ // return after update
          id: created.id,
          projectId: 'test-project',
          name: 'Test',
          wxrFilePath: '/path/to/export.xml',
          uploadsFolderPath: null,
          lastAnalysisResult: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
      ];

      const updated = await engine.updateDefinition(created.id, { wxrFilePath: '/path/to/export.xml' });

      expect(updated!.wxrFilePath).toBe('/path/to/export.xml');
    });

    it('should update uploadsFolderPath', async () => {
      const created = await engine.createDefinition('Test');
      mockDrizzleSelectResults = [
        [{ // getDefinition check
          id: created.id,
          projectId: 'test-project',
          name: 'Test',
          wxrFilePath: null,
          uploadsFolderPath: null,
          lastAnalysisResult: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
        [{ // return after update
          id: created.id,
          projectId: 'test-project',
          name: 'Test',
          wxrFilePath: null,
          uploadsFolderPath: '/path/to/uploads',
          lastAnalysisResult: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
      ];

      const updated = await engine.updateDefinition(created.id, { uploadsFolderPath: '/path/to/uploads' });

      expect(updated!.uploadsFolderPath).toBe('/path/to/uploads');
    });

    it('should update lastAnalysisResult as JSON', async () => {
      const created = await engine.createDefinition('Test');
      const report = { posts: { total: 10, new: 5 } };
      mockDrizzleSelectResults = [
        [{ // getDefinition check
          id: created.id,
          projectId: 'test-project',
          name: 'Test',
          wxrFilePath: null,
          uploadsFolderPath: null,
          lastAnalysisResult: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
        [{ // return after update
          id: created.id,
          projectId: 'test-project',
          name: 'Test',
          wxrFilePath: null,
          uploadsFolderPath: null,
          lastAnalysisResult: JSON.stringify(report),
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
      ];

      const updated = await engine.updateDefinition(created.id, { lastAnalysisResult: JSON.stringify(report) });

      expect(updated).toBeDefined();
    });

    it('should return null for non-existent definition', async () => {
      mockDrizzleSelectResults = [[]];
      const updated = await engine.updateDefinition('non-existent', { name: 'Test' });

      expect(updated).toBeNull();
    });

    it('should not update definitions from other projects', async () => {
      const created = await engine.createDefinition('Test');
      engine.setProjectContext('other-project');
      mockDrizzleSelectResults = [[]]; // Would be filtered by project

      const updated = await engine.updateDefinition(created.id, { name: 'Hacked' });

      expect(updated).toBeNull();
    });
  });

  describe('deleteDefinition', () => {
    it('should delete an existing definition', async () => {
      const created = await engine.createDefinition('To Delete');
      mockDrizzleSelectResults = [[{
        id: created.id,
        projectId: 'test-project',
        name: 'To Delete',
        wxrFilePath: null,
        uploadsFolderPath: null,
        lastAnalysisResult: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }]];

      const result = await engine.deleteDefinition(created.id);

      expect(result).toBe(true);
    });

    it('should return false for non-existent definition', async () => {
      mockDrizzleSelectResults = [[]];
      const result = await engine.deleteDefinition('non-existent');

      expect(result).toBe(false);
    });

    it('should not delete definitions from other projects', async () => {
      const created = await engine.createDefinition('Test');
      engine.setProjectContext('other-project');
      mockDrizzleSelectResults = [[]]; // Would be filtered by project

      const result = await engine.deleteDefinition(created.id);

      expect(result).toBe(false);
    });

    it('should remove the definition from the database', async () => {
      const created = await engine.createDefinition('Test');
      // First call returns the definition for delete
      mockDrizzleSelectResults = [[{
        id: created.id,
        projectId: 'test-project',
        name: 'Test',
        wxrFilePath: null,
        uploadsFolderPath: null,
        lastAnalysisResult: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }]];
      await engine.deleteDefinition(created.id);
      
      // Second call returns empty for get
      mockDrizzleSelectResults = [[]];
      const def = await engine.getDefinition(created.id);
      expect(def).toBeNull();
    });
  });
});
