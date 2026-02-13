/**
 * ImportDefinitionEngine Unit Tests
 *
 * Tests the REAL ImportDefinitionEngine class with mocked database.
 * Following TDD best practices: mock external dependencies, test real implementation.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Store for mock data
const mockDefinitions = new Map<string, any>();

const mockLocalClient = {
  execute: vi.fn(async (query: { sql: string; args: any[] }) => {
    const sql = query.sql.trim();

    // INSERT
    if (sql.startsWith('INSERT')) {
      const row = {
        id: query.args[0],
        project_id: query.args[1],
        name: query.args[2],
        wxr_file_path: query.args[3] ?? null,
        uploads_folder_path: query.args[4] ?? null,
        last_analysis_result: query.args[5] ?? null,
        created_at: query.args[6],
        updated_at: query.args[7],
      };
      mockDefinitions.set(row.id, row);
      return { rows: [] };
    }

    // SELECT by id
    if (sql.startsWith('SELECT') && sql.includes('WHERE id = ?') && sql.includes('project_id = ?')) {
      const id = query.args[0];
      const projectId = query.args[1];
      const def = mockDefinitions.get(id);
      if (def && def.project_id === projectId) {
        return { rows: [def] };
      }
      return { rows: [] };
    }

    // SELECT all for project
    if (sql.startsWith('SELECT') && sql.includes('WHERE project_id = ?') && sql.includes('ORDER BY')) {
      const projectId = query.args[0];
      const rows = Array.from(mockDefinitions.values())
        .filter(d => d.project_id === projectId)
        .sort((a, b) => b.updated_at - a.updated_at);
      return { rows };
    }

    // UPDATE
    if (sql.startsWith('UPDATE')) {
      // Find the id in args (last two args are id and project_id in WHERE)
      const id = query.args[query.args.length - 2];
      const projectId = query.args[query.args.length - 1];
      const def = mockDefinitions.get(id);
      if (def && def.project_id === projectId) {
        // Apply updates based on the SET clause
        // Parse set fields from the sql
        const setMatch = sql.match(/SET (.+?) WHERE/);
        if (setMatch) {
          const setParts = setMatch[1].split(', ');
          let argIdx = 0;
          for (const part of setParts) {
            const field = part.split(' = ')[0].trim();
            def[field] = query.args[argIdx];
            argIdx++;
          }
        }
        return { rowsAffected: 1, rows: [] };
      }
      return { rowsAffected: 0, rows: [] };
    }

    // DELETE
    if (sql.startsWith('DELETE')) {
      const id = query.args[0];
      const projectId = query.args[1];
      const def = mockDefinitions.get(id);
      if (def && def.project_id === projectId) {
        mockDefinitions.delete(id);
        return { rowsAffected: 1, rows: [] };
      }
      return { rowsAffected: 0, rows: [] };
    }

    return { rows: [] };
  }),
};

// Mock the database module
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => null),
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

      expect(mockLocalClient.execute).toHaveBeenCalledTimes(1);
      const call = mockLocalClient.execute.mock.calls[0][0];
      expect(call.sql).toContain('INSERT INTO import_definitions');
      expect(call.args[2]).toBe('Test Import');
    });
  });

  describe('getDefinition', () => {
    it('should return a definition by ID', async () => {
      const created = await engine.createDefinition('My Import');
      mockLocalClient.execute.mockClear();

      const def = await engine.getDefinition(created.id);

      expect(def).toBeDefined();
      expect(def!.id).toBe(created.id);
      expect(def!.name).toBe('My Import');
    });

    it('should return null for non-existent ID', async () => {
      const def = await engine.getDefinition('non-existent-id');

      expect(def).toBeNull();
    });

    it('should not return definitions from other projects', async () => {
      const created = await engine.createDefinition('My Import');
      engine.setProjectContext('other-project');

      const def = await engine.getDefinition(created.id);

      expect(def).toBeNull();
    });

    it('should parse lastAnalysisResult JSON', async () => {
      const created = await engine.createDefinition('My Import');
      // Manually set analysis result in mock store
      const storedDef = mockDefinitions.get(created.id);
      storedDef.last_analysis_result = JSON.stringify({ posts: { total: 5 } });

      const def = await engine.getDefinition(created.id);

      expect(def!.lastAnalysisResult).toEqual({ posts: { total: 5 } });
    });
  });

  describe('getAllForProject', () => {
    it('should return empty array when no definitions exist', async () => {
      const defs = await engine.getAllForProject();

      expect(defs).toEqual([]);
    });

    it('should return all definitions for the current project', async () => {
      await engine.createDefinition('Import 1');
      await engine.createDefinition('Import 2');

      const defs = await engine.getAllForProject();

      expect(defs).toHaveLength(2);
    });

    it('should not include definitions from other projects', async () => {
      await engine.createDefinition('Import A');
      engine.setProjectContext('other-project');
      await engine.createDefinition('Import B');
      engine.setProjectContext('test-project');

      const defs = await engine.getAllForProject();

      expect(defs).toHaveLength(1);
      expect(defs[0].name).toBe('Import A');
    });

    it('should return definitions ordered by updatedAt DESC', async () => {
      await engine.createDefinition('Older');
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      await engine.createDefinition('Newer');

      const defs = await engine.getAllForProject();

      expect(defs[0].name).toBe('Newer');
      expect(defs[1].name).toBe('Older');
    });
  });

  describe('updateDefinition', () => {
    it('should update the name', async () => {
      const created = await engine.createDefinition('Old Name');

      const updated = await engine.updateDefinition(created.id, { name: 'New Name' });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe('New Name');
    });

    it('should update wxrFilePath', async () => {
      const created = await engine.createDefinition('Test');

      const updated = await engine.updateDefinition(created.id, { wxrFilePath: '/path/to/export.xml' });

      expect(updated!.wxrFilePath).toBe('/path/to/export.xml');
    });

    it('should update uploadsFolderPath', async () => {
      const created = await engine.createDefinition('Test');

      const updated = await engine.updateDefinition(created.id, { uploadsFolderPath: '/path/to/uploads' });

      expect(updated!.uploadsFolderPath).toBe('/path/to/uploads');
    });

    it('should update lastAnalysisResult as JSON', async () => {
      const created = await engine.createDefinition('Test');
      const report = { posts: { total: 10, new: 5 } };

      const updated = await engine.updateDefinition(created.id, { lastAnalysisResult: JSON.stringify(report) });

      expect(updated).toBeDefined();
    });

    it('should return null for non-existent definition', async () => {
      const updated = await engine.updateDefinition('non-existent', { name: 'Test' });

      expect(updated).toBeNull();
    });

    it('should not update definitions from other projects', async () => {
      const created = await engine.createDefinition('Test');
      engine.setProjectContext('other-project');

      const updated = await engine.updateDefinition(created.id, { name: 'Hacked' });

      expect(updated).toBeNull();
    });
  });

  describe('deleteDefinition', () => {
    it('should delete an existing definition', async () => {
      const created = await engine.createDefinition('To Delete');

      const result = await engine.deleteDefinition(created.id);

      expect(result).toBe(true);
    });

    it('should return false for non-existent definition', async () => {
      const result = await engine.deleteDefinition('non-existent');

      expect(result).toBe(false);
    });

    it('should not delete definitions from other projects', async () => {
      const created = await engine.createDefinition('Test');
      engine.setProjectContext('other-project');

      const result = await engine.deleteDefinition(created.id);

      expect(result).toBe(false);
    });

    it('should remove the definition from the database', async () => {
      const created = await engine.createDefinition('Test');
      await engine.deleteDefinition(created.id);

      const def = await engine.getDefinition(created.id);
      expect(def).toBeNull();
    });
  });
});
