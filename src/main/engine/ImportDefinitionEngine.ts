/**
 * ImportDefinitionEngine - CRUD for WXR import definitions
 *
 * Manages persisted import configurations (name, WXR file path, uploads folder,
 * last analysis result) stored in the import_definitions table.
 */

import { v4 as uuidv4 } from 'uuid';
import { eq, and, desc } from 'drizzle-orm';
import { getDatabase } from '../database';
import { importDefinitions } from '../database/schema';

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

  private getDb() {
    return getDatabase().getLocal();
  }

  setProjectContext(projectId: string): void {
    this.currentProjectId = projectId;
  }

  getProjectContext(): string {
    return this.currentProjectId;
  }

  async createDefinition(name?: string): Promise<ImportDefinitionData> {
    const db = this.getDb();
    const id = `import_${uuidv4()}`;
    const now = new Date();
    const defName = name || 'Untitled Import';

    await db.insert(importDefinitions).values({
      id,
      projectId: this.currentProjectId,
      name: defName,
      wxrFilePath: null,
      uploadsFolderPath: null,
      lastAnalysisResult: null,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      projectId: this.currentProjectId,
      name: defName,
      wxrFilePath: null,
      uploadsFolderPath: null,
      lastAnalysisResult: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async getDefinition(id: string): Promise<ImportDefinitionData | null> {
    const db = this.getDb();

    const rows = await db
      .select()
      .from(importDefinitions)
      .where(and(
        eq(importDefinitions.id, id),
        eq(importDefinitions.projectId, this.currentProjectId)
      ));

    if (rows.length === 0) return null;

    return this.rowToData(rows[0]);
  }

  async getAllForProject(): Promise<ImportDefinitionData[]> {
    const db = this.getDb();

    const rows = await db
      .select()
      .from(importDefinitions)
      .where(eq(importDefinitions.projectId, this.currentProjectId))
      .orderBy(desc(importDefinitions.updatedAt));

    return rows.map(row => this.rowToData(row));
  }

  async updateDefinition(
    id: string,
    updates: Partial<Pick<ImportDefinitionData, 'name' | 'wxrFilePath' | 'uploadsFolderPath' | 'lastAnalysisResult'>>
  ): Promise<ImportDefinitionData | null> {
    // Check existence and ownership
    const existing = await this.getDefinition(id);
    if (!existing) return null;

    const db = this.getDb();

    // Build update object
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (updates.name !== undefined) {
      updateData.name = updates.name;
    }
    if (updates.wxrFilePath !== undefined) {
      updateData.wxrFilePath = updates.wxrFilePath;
    }
    if (updates.uploadsFolderPath !== undefined) {
      updateData.uploadsFolderPath = updates.uploadsFolderPath;
    }
    if (updates.lastAnalysisResult !== undefined) {
      updateData.lastAnalysisResult = typeof updates.lastAnalysisResult === 'string'
        ? updates.lastAnalysisResult
        : JSON.stringify(updates.lastAnalysisResult);
    }

    await db
      .update(importDefinitions)
      .set(updateData)
      .where(and(
        eq(importDefinitions.id, id),
        eq(importDefinitions.projectId, this.currentProjectId)
      ));

    return this.getDefinition(id);
  }

  async deleteDefinition(id: string): Promise<boolean> {
    // Check existence and ownership
    const existing = await this.getDefinition(id);
    if (!existing) return false;

    const db = this.getDb();

    await db
      .delete(importDefinitions)
      .where(and(
        eq(importDefinitions.id, id),
        eq(importDefinitions.projectId, this.currentProjectId)
      ));

    return true;
  }

  private rowToData(row: typeof importDefinitions.$inferSelect): ImportDefinitionData {
    let parsedResult: unknown | null = null;
    if (row.lastAnalysisResult) {
      try {
        parsedResult = JSON.parse(row.lastAnalysisResult);
      } catch {
        parsedResult = row.lastAnalysisResult;
      }
    }

    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      wxrFilePath: row.wxrFilePath ?? null,
      uploadsFolderPath: row.uploadsFolderPath ?? null,
      lastAnalysisResult: parsedResult,
      createdAt: row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt as unknown as number).toISOString(),
      updatedAt: row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : new Date(row.updatedAt as unknown as number).toISOString(),
    };
  }
}
