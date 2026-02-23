import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { and, desc, eq } from 'drizzle-orm';
import { getDatabase } from '../database';
import { scripts, type NewScript, type Script } from '../database/schema';

export type ScriptKind = 'macro' | 'utility' | 'transform';

export interface ScriptData {
  id: string;
  projectId: string;
  slug: string;
  title: string;
  kind: ScriptKind;
  entrypoint: string;
  enabled: boolean;
  version: number;
  filePath: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScriptInput {
  title: string;
  kind: ScriptKind;
  content: string;
  slug?: string;
  entrypoint?: string;
  enabled?: boolean;
}

export interface UpdateScriptInput {
  title?: string;
  kind?: ScriptKind;
  content?: string;
  slug?: string;
  entrypoint?: string;
  enabled?: boolean;
}

export class ScriptEngine extends EventEmitter {
  private currentProjectId = 'default';
  private dataDir: string | null = null;

  setProjectContext(projectId: string, dataDir?: string): void {
    this.currentProjectId = projectId;
    this.dataDir = dataDir || null;
  }

  getProjectContext(): string {
    return this.currentProjectId;
  }

  async createScript(input: CreateScriptInput): Promise<ScriptData> {
    const now = new Date();
    const allScripts = await this.getAllScriptRows();
    const desiredSlug = this.normalizeSlug(input.slug || input.title || 'script');
    const uniqueSlug = this.ensureUniqueSlug(desiredSlug, allScripts);
    const scriptId = uuidv4();
    const filePath = this.getScriptFilePath(uniqueSlug);

    const row: NewScript = {
      id: scriptId,
      projectId: this.currentProjectId,
      slug: uniqueSlug,
      title: input.title,
      kind: input.kind,
      entrypoint: input.entrypoint || 'render',
      enabled: input.enabled ?? true,
      version: 1,
      filePath,
      createdAt: now,
      updatedAt: now,
    };

    await fs.mkdir(this.getScriptsDir(), { recursive: true });
    await fs.writeFile(filePath, this.serializeScriptFile(row as Script, input.content), 'utf-8');

    await getDatabase().getLocal().insert(scripts).values(row);

    const created = await this.toScriptData(row as Script);
    this.emit('scriptCreated', created);
    return created;
  }

  async updateScript(id: string, updates: UpdateScriptInput): Promise<ScriptData | null> {
    const existing = await this.getScriptRow(id);
    if (!existing) {
      return null;
    }

    const allScripts = await this.getAllScriptRows();
    const desiredSlug = typeof updates.slug === 'string'
      ? this.normalizeSlug(updates.slug)
      : typeof updates.title === 'string'
        ? this.normalizeSlug(updates.title)
        : existing.slug;
    const nextSlug = this.ensureUniqueSlug(desiredSlug, allScripts, existing.id);
    const nextFilePath = this.getScriptFilePath(nextSlug);
    const now = new Date();

    if (existing.filePath !== nextFilePath) {
      await fs.mkdir(this.getScriptsDir(), { recursive: true });
      await fs.rename(existing.filePath, nextFilePath);
    }

    const nextTitle = updates.title ?? existing.title;
    const nextKind = updates.kind ?? existing.kind;
    const nextEntrypoint = updates.entrypoint ?? existing.entrypoint;
    const nextEnabled = updates.enabled ?? existing.enabled;
    const nextVersion = existing.version + 1;
    const nextContent = typeof updates.content === 'string'
      ? updates.content
      : await this.readScriptBody(nextFilePath);

    const nextRow = {
      ...existing,
      title: nextTitle,
      slug: nextSlug,
      kind: nextKind,
      entrypoint: nextEntrypoint,
      enabled: nextEnabled,
      filePath: nextFilePath,
      version: nextVersion,
      updatedAt: now,
    };

    await fs.writeFile(nextFilePath, this.serializeScriptFile(nextRow, nextContent), 'utf-8');

    await getDatabase().getLocal()
      .update(scripts)
      .set({
        title: nextTitle,
        slug: nextSlug,
        kind: nextKind,
        entrypoint: nextEntrypoint,
        enabled: nextEnabled,
        filePath: nextFilePath,
        version: nextVersion,
        updatedAt: now,
      })
      .where(and(eq(scripts.id, existing.id), eq(scripts.projectId, this.currentProjectId)));

    const updatedRow = await this.getScriptRow(existing.id);
    if (!updatedRow) {
      return null;
    }

    const updated = await this.toScriptData(updatedRow);
    this.emit('scriptUpdated', updated);
    return updated;
  }

  async deleteScript(id: string): Promise<boolean> {
    const existing = await this.getScriptRow(id);
    if (!existing) {
      return false;
    }

    await getDatabase().getLocal()
      .delete(scripts)
      .where(and(eq(scripts.id, existing.id), eq(scripts.projectId, this.currentProjectId)));

    try {
      await fs.unlink(existing.filePath);
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code !== 'ENOENT') {
        throw error;
      }
    }

    this.emit('scriptDeleted', id);
    return true;
  }

  async getScript(id: string): Promise<ScriptData | null> {
    const row = await this.getScriptRow(id);
    if (!row) {
      return null;
    }
    return this.toScriptData(row);
  }

  async getAllScripts(): Promise<ScriptData[]> {
    const rows = await this.getAllScriptRows();
    return Promise.all(rows.map((item) => this.toScriptData(item)));
  }

  private async getScriptRow(id: string): Promise<Script | null> {
    const rows = await this.getAllScriptRows();
    return rows.find((item) => item.id === id) || null;
  }

  private async getAllScriptRows(): Promise<Script[]> {
    return getDatabase().getLocal()
      .select()
      .from(scripts)
      .where(eq(scripts.projectId, this.currentProjectId))
      .orderBy(desc(scripts.updatedAt))
      .all();
  }

  private async toScriptData(row: Script): Promise<ScriptData> {
    const content = await this.readScriptBody(row.filePath);

    return {
      id: row.id,
      projectId: row.projectId,
      slug: row.slug,
      title: row.title,
      kind: row.kind,
      entrypoint: row.entrypoint,
      enabled: row.enabled,
      version: row.version,
      filePath: row.filePath,
      content,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private getDataDir(): string {
    if (this.dataDir) {
      return this.dataDir;
    }

    return path.join(app.getPath('userData'), 'projects', this.currentProjectId);
  }

  private getScriptsDir(): string {
    return path.join(this.getDataDir(), 'scripts');
  }

  private getScriptFilePath(slug: string): string {
    return path.join(this.getScriptsDir(), `${slug}.py`);
  }

  private normalizeSlug(value: string): string {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return normalized || 'script';
  }

  private ensureUniqueSlug(slug: string, rows: Script[], excludeId?: string): string {
    const baseSlug = slug;
    const taken = new Set(
      rows
        .filter((item) => item.id !== excludeId)
        .map((item) => item.slug)
    );

    if (!taken.has(baseSlug)) {
      return baseSlug;
    }

    let suffix = 2;
    while (taken.has(`${baseSlug}_${suffix}`)) {
      suffix += 1;
    }

    return `${baseSlug}_${suffix}`;
  }

  private serializeScriptFile(row: Pick<Script, 'id' | 'projectId' | 'slug' | 'title' | 'kind' | 'entrypoint' | 'enabled' | 'version' | 'createdAt' | 'updatedAt'>, content: string): string {
    const lines = [
      '"""',
      '---',
      `id: ${this.toYamlString(row.id)}`,
      `projectId: ${this.toYamlString(row.projectId)}`,
      `slug: ${this.toYamlString(row.slug)}`,
      `title: ${this.toYamlString(row.title)}`,
      `kind: ${this.toYamlString(row.kind)}`,
      `entrypoint: ${this.toYamlString(row.entrypoint)}`,
      `enabled: ${row.enabled ? 'true' : 'false'}`,
      `version: ${row.version}`,
      `createdAt: ${this.toYamlString(row.createdAt.toISOString())}`,
      `updatedAt: ${this.toYamlString(row.updatedAt.toISOString())}`,
      '---',
      '"""',
      content,
    ];

    return lines.join('\n');
  }

  private toYamlString(value: string): string {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    return `"${escaped}"`;
  }

  private parseScriptBody(rawContent: string): string {
    const frontmatterDocstringPattern = /^(?:"""|''')\r?\n---\r?\n[\s\S]*?\r?\n---\r?\n(?:"""|''')\r?\n?/;
    if (!frontmatterDocstringPattern.test(rawContent)) {
      return rawContent;
    }

    return rawContent.replace(frontmatterDocstringPattern, '');
  }

  private async readScriptBody(filePath: string): Promise<string> {
    try {
      const rawContent = await fs.readFile(filePath, 'utf-8');
      return this.parseScriptBody(rawContent);
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code !== 'ENOENT') {
        throw error;
      }
      return '';
    }
  }
}

let scriptEngineInstance: ScriptEngine | null = null;

export function getScriptEngine(): ScriptEngine {
  if (!scriptEngineInstance) {
    scriptEngineInstance = new ScriptEngine();
  }
  return scriptEngineInstance;
}
