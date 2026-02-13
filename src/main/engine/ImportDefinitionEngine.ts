/**
 * ImportDefinitionEngine - CRUD for WXR import definitions
 *
 * Manages persisted import configurations (name, WXR file path, uploads folder,
 * last analysis result) stored in the import_definitions table.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database';

export interface ImportDefinitionData {
  id: string;
  projectId: string;
  name: string;
  wxrFilePath: string | null;
  uploadsFolderPath: string | null;
  lastAnalysisResult: unknown | null;
  createdAt: string;
  updatedAt: string;
}

export class ImportDefinitionEngine {
  private currentProjectId: string = 'default';

  private getClient() {
    const client = getDatabase().getLocalClient();
    if (!client) {
      throw new Error('Database not initialized');
    }
    return client;
  }

  setProjectContext(projectId: string): void {
    this.currentProjectId = projectId;
  }

  getProjectContext(): string {
    return this.currentProjectId;
  }

  async createDefinition(name?: string): Promise<ImportDefinitionData> {
    const client = this.getClient();
    const id = `import_${uuidv4()}`;
    const now = Date.now();
    const defName = name || 'Untitled Import';

    await client.execute({
      sql: `INSERT INTO import_definitions (id, project_id, name, wxr_file_path, uploads_folder_path, last_analysis_result, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, this.currentProjectId, defName, null, null, null, now, now],
    });

    return {
      id,
      projectId: this.currentProjectId,
      name: defName,
      wxrFilePath: null,
      uploadsFolderPath: null,
      lastAnalysisResult: null,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
  }

  async getDefinition(id: string): Promise<ImportDefinitionData | null> {
    const client = this.getClient();
    const result = await client.execute({
      sql: `SELECT * FROM import_definitions WHERE id = ? AND project_id = ?`,
      args: [id, this.currentProjectId],
    });

    if (result.rows.length === 0) return null;

    return this.rowToData(result.rows[0] as any);
  }

  async getAllForProject(): Promise<ImportDefinitionData[]> {
    const client = this.getClient();
    const result = await client.execute({
      sql: `SELECT * FROM import_definitions WHERE project_id = ? ORDER BY updated_at DESC`,
      args: [this.currentProjectId],
    });

    return result.rows.map((row: any) => this.rowToData(row));
  }

  async updateDefinition(
    id: string,
    updates: Partial<Pick<ImportDefinitionData, 'name' | 'wxrFilePath' | 'uploadsFolderPath' | 'lastAnalysisResult'>>
  ): Promise<ImportDefinitionData | null> {
    // Check existence and ownership
    const existing = await this.getDefinition(id);
    if (!existing) return null;

    const setClauses: string[] = [];
    const args: any[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      args.push(updates.name);
    }
    if (updates.wxrFilePath !== undefined) {
      setClauses.push('wxr_file_path = ?');
      args.push(updates.wxrFilePath);
    }
    if (updates.uploadsFolderPath !== undefined) {
      setClauses.push('uploads_folder_path = ?');
      args.push(updates.uploadsFolderPath);
    }
    if (updates.lastAnalysisResult !== undefined) {
      setClauses.push('last_analysis_result = ?');
      args.push(typeof updates.lastAnalysisResult === 'string'
        ? updates.lastAnalysisResult
        : JSON.stringify(updates.lastAnalysisResult));
    }

    if (setClauses.length === 0) return existing;

    const now = Date.now();
    setClauses.push('updated_at = ?');
    args.push(now);

    // WHERE clause args
    args.push(id, this.currentProjectId);

    const client = this.getClient();
    await client.execute({
      sql: `UPDATE import_definitions SET ${setClauses.join(', ')} WHERE id = ? AND project_id = ?`,
      args,
    });

    return this.getDefinition(id);
  }

  async deleteDefinition(id: string): Promise<boolean> {
    // Check existence and ownership
    const existing = await this.getDefinition(id);
    if (!existing) return false;

    const client = this.getClient();
    await client.execute({
      sql: `DELETE FROM import_definitions WHERE id = ? AND project_id = ?`,
      args: [id, this.currentProjectId],
    });

    return true;
  }

  private rowToData(row: any): ImportDefinitionData {
    let parsedResult: unknown | null = null;
    if (row.last_analysis_result) {
      try {
        parsedResult = JSON.parse(row.last_analysis_result);
      } catch {
        parsedResult = row.last_analysis_result;
      }
    }

    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      wxrFilePath: row.wxr_file_path ?? null,
      uploadsFolderPath: row.uploads_folder_path ?? null,
      lastAnalysisResult: parsedResult,
      createdAt: typeof row.created_at === 'number'
        ? new Date(row.created_at).toISOString()
        : row.created_at,
      updatedAt: typeof row.updated_at === 'number'
        ? new Date(row.updated_at).toISOString()
        : row.updated_at,
    };
  }
}
