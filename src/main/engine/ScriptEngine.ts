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

export type GitScriptFileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface GitScriptFileChange {
  status: GitScriptFileChangeStatus;
  path: string;
  previousPath?: string;
}

export interface ScriptReconcileResult {
  created: number;
  updated: number;
  deleted: number;
  processedFiles: number;
}

interface ParsedScriptFile {
  metadata: {
    id?: string;
    projectId?: string;
    slug?: string;
    title?: string;
    kind?: string;
    entrypoint?: string;
    enabled?: boolean;
    version?: number;
    createdAt?: string;
    updatedAt?: string;
  };
  body: string;
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

  async rebuildDatabaseFromFiles(): Promise<void> {
    const db = getDatabase().getLocal();
    const scriptsDir = this.getScriptsDir();

    await db.delete(scripts).where(eq(scripts.projectId, this.currentProjectId));

    const pythonFiles = await this.scanScriptFiles(scriptsDir);
    if (pythonFiles.length === 0) {
      this.emit('scriptsRebuilt');
      return;
    }

    const usedIds = new Set<string>();
    const insertedRows: Script[] = [];

    for (const filePath of pythonFiles) {
      const parsed = await this.readScriptFileWithMetadata(filePath);
      if (!parsed) {
        continue;
      }

      const desiredSlug = this.normalizeSlug(parsed.metadata.slug || path.basename(filePath, '.py'));
      const slug = this.ensureUniqueSlug(desiredSlug, insertedRows);

      const desiredId = typeof parsed.metadata.id === 'string' && parsed.metadata.id.trim().length > 0
        ? parsed.metadata.id.trim()
        : uuidv4();
      const id = usedIds.has(desiredId) ? uuidv4() : desiredId;

      const now = new Date();
      const row: NewScript = {
        id,
        projectId: this.currentProjectId,
        slug,
        title: this.normalizeTitle(parsed.metadata.title, slug),
        kind: this.normalizeKind(parsed.metadata.kind),
        entrypoint: this.normalizeEntrypoint(parsed.metadata.entrypoint),
        enabled: this.normalizeEnabled(parsed.metadata.enabled),
        version: this.normalizeVersion(parsed.metadata.version),
        filePath,
        createdAt: this.normalizeDate(parsed.metadata.createdAt, now),
        updatedAt: this.normalizeDate(parsed.metadata.updatedAt, now),
      };

      await db.insert(scripts).values(row);
      insertedRows.push(row as Script);
      usedIds.add(id);
    }

    this.emit('scriptsRebuilt');
  }

  async reconcileScriptsFromGitChanges(projectPath: string, changes: GitScriptFileChange[]): Promise<ScriptReconcileResult> {
    const db = getDatabase().getLocal();
    const normalizedProjectPath = path.resolve(projectPath);

    const relevantChanges = changes.filter((change) => {
      if (!this.isPythonScriptPath(change.path)) {
        return false;
      }
      if (change.status === 'renamed' && change.previousPath && !this.isPythonScriptPath(change.previousPath) && !this.isPythonScriptPath(change.path)) {
        return false;
      }
      return true;
    });

    if (relevantChanges.length === 0) {
      return { created: 0, updated: 0, deleted: 0, processedFiles: 0 };
    }

    const scriptRows = await this.getAllScriptRows();
    const scriptsByPath = new Map<string, Script>();
    for (const row of scriptRows) {
      scriptsByPath.set(this.normalizePathForCompare(row.filePath), row);
    }

    let created = 0;
    let updated = 0;
    let deleted = 0;
    let processedFiles = 0;

    for (const change of relevantChanges) {
      const absolutePath = this.normalizePathForCompare(path.resolve(normalizedProjectPath, change.path));
      const previousAbsolutePath = change.previousPath
        ? this.normalizePathForCompare(path.resolve(normalizedProjectPath, change.previousPath))
        : null;

      if (change.status === 'deleted') {
        const existing = scriptsByPath.get(absolutePath);
        if (!existing) {
          continue;
        }

        await db.delete(scripts).where(and(eq(scripts.id, existing.id), eq(scripts.projectId, this.currentProjectId)));
        scriptsByPath.delete(absolutePath);
        this.emit('scriptDeleted', existing.id);
        deleted += 1;
        processedFiles += 1;
        continue;
      }

      let existing = previousAbsolutePath
        ? (scriptsByPath.get(previousAbsolutePath) || scriptsByPath.get(absolutePath))
        : scriptsByPath.get(absolutePath);

      const parsed = await this.readScriptFileWithMetadata(absolutePath);
      if (!parsed) {
        continue;
      }

      const allRows = await this.getAllScriptRows();
      const parsedId = typeof parsed.metadata.id === 'string' ? parsed.metadata.id.trim() : '';
      if (!existing && parsedId.length > 0) {
        const byId = allRows.find((row) => row.id === parsedId);
        if (byId) {
          existing = byId;
        }
      }
      const desiredSlug = this.normalizeSlug(parsed.metadata.slug || path.basename(absolutePath, '.py'));
      const slug = this.ensureUniqueSlug(desiredSlug, allRows, existing?.id);

      if (existing) {
        const updateNow = new Date();
        const nextRow = {
          title: this.normalizeTitle(parsed.metadata.title, slug, existing.title),
          slug,
          kind: this.normalizeKind(parsed.metadata.kind, existing.kind),
          entrypoint: this.normalizeEntrypoint(parsed.metadata.entrypoint, existing.entrypoint),
          enabled: this.normalizeEnabled(parsed.metadata.enabled, existing.enabled),
          version: this.normalizeVersion(parsed.metadata.version, existing.version),
          filePath: absolutePath,
          createdAt: this.normalizeDate(parsed.metadata.createdAt, existing.createdAt),
          updatedAt: this.normalizeDate(parsed.metadata.updatedAt, updateNow),
        };

        await db.update(scripts)
          .set(nextRow)
          .where(and(eq(scripts.id, existing.id), eq(scripts.projectId, this.currentProjectId)));

        const updatedRow = await this.getScriptRow(existing.id);
        if (updatedRow) {
          const updatedScript = await this.toScriptData(updatedRow);
          this.emit('scriptUpdated', updatedScript);
        }

        if (previousAbsolutePath) {
          scriptsByPath.delete(previousAbsolutePath);
        }
        scriptsByPath.set(absolutePath, {
          ...existing,
          ...nextRow,
        });
        updated += 1;
        processedFiles += 1;
        continue;
      }

      const desiredId = typeof parsed.metadata.id === 'string' && parsed.metadata.id.trim().length > 0
        ? parsed.metadata.id.trim()
        : uuidv4();
      const idExists = allRows.some((row) => row.id === desiredId);
      const rowId = idExists ? uuidv4() : desiredId;
      const now = new Date();

      const newRow: NewScript = {
        id: rowId,
        projectId: this.currentProjectId,
        slug,
        title: this.normalizeTitle(parsed.metadata.title, slug),
        kind: this.normalizeKind(parsed.metadata.kind),
        entrypoint: this.normalizeEntrypoint(parsed.metadata.entrypoint),
        enabled: this.normalizeEnabled(parsed.metadata.enabled),
        version: this.normalizeVersion(parsed.metadata.version),
        filePath: absolutePath,
        createdAt: this.normalizeDate(parsed.metadata.createdAt, now),
        updatedAt: this.normalizeDate(parsed.metadata.updatedAt, now),
      };

      await db.insert(scripts).values(newRow);

      const createdRow = await this.getScriptRow(newRow.id);
      if (createdRow) {
        const createdScript = await this.toScriptData(createdRow);
        this.emit('scriptCreated', createdScript);
      }

      scriptsByPath.set(absolutePath, newRow as Script);
      created += 1;
      processedFiles += 1;
    }

    return {
      created,
      updated,
      deleted,
      processedFiles,
    };
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

  private normalizePathForCompare(filePath: string): string {
    return path.resolve(filePath).replace(/\\/g, '/');
  }

  private isPythonScriptPath(value: string): boolean {
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
    return normalized.startsWith('scripts/') && path.extname(normalized).toLowerCase() === '.py';
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

  private parseScriptFile(rawContent: string): ParsedScriptFile {
    const frontmatterDocstringPattern = /^(?:"""|''')\r?\n---\r?\n([\s\S]*?)\r?\n---\r?\n(?:"""|''')\r?\n?/;
    const match = rawContent.match(frontmatterDocstringPattern);
    if (!match) {
      return {
        metadata: {},
        body: rawContent,
      };
    }

    const metadataLines = (match[1] || '').split(/\r?\n/);
    const metadata: ParsedScriptFile['metadata'] = {};

    for (const rawLine of metadataLines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const separatorIndex = line.indexOf(':');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const valueRaw = line.slice(separatorIndex + 1).trim();
      const value = this.parseYamlScalar(valueRaw);

      if (key === 'enabled') {
        if (typeof value === 'boolean') {
          metadata.enabled = value;
        }
        continue;
      }

      if (key === 'version') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          metadata.version = parsed;
        }
        continue;
      }

      if (
        key === 'id' ||
        key === 'projectId' ||
        key === 'slug' ||
        key === 'title' ||
        key === 'kind' ||
        key === 'entrypoint' ||
        key === 'createdAt' ||
        key === 'updatedAt'
      ) {
        if (typeof value === 'string') {
          metadata[key] = value;
        }
      }
    }

    return {
      metadata,
      body: rawContent.replace(frontmatterDocstringPattern, ''),
    };
  }

  private parseYamlScalar(valueRaw: string): string | number | boolean {
    if ((valueRaw.startsWith('"') && valueRaw.endsWith('"')) || (valueRaw.startsWith("'") && valueRaw.endsWith("'"))) {
      return valueRaw.slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }

    if (valueRaw === 'true') {
      return true;
    }

    if (valueRaw === 'false') {
      return false;
    }

    const numeric = Number(valueRaw);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }

    return valueRaw;
  }

  private normalizeKind(kind: string | undefined, fallback: ScriptKind = 'utility'): ScriptKind {
    if (kind === 'macro' || kind === 'utility' || kind === 'transform') {
      return kind;
    }
    return fallback;
  }

  private normalizeEntrypoint(entrypoint: string | undefined, fallback = 'render'): string {
    if (typeof entrypoint === 'string' && entrypoint.trim().length > 0) {
      return entrypoint.trim();
    }
    return fallback;
  }

  private normalizeEnabled(enabled: boolean | undefined, fallback = true): boolean {
    if (typeof enabled === 'boolean') {
      return enabled;
    }
    return fallback;
  }

  private normalizeVersion(version: number | undefined, fallback = 1): number {
    if (typeof version === 'number' && Number.isFinite(version) && version > 0) {
      return Math.floor(version);
    }
    return fallback;
  }

  private normalizeDate(value: string | undefined, fallback: Date): Date {
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return fallback;
  }

  private normalizeTitle(title: string | undefined, slug: string, fallback?: string): string {
    if (typeof title === 'string' && title.trim().length > 0) {
      return title.trim();
    }
    if (typeof fallback === 'string' && fallback.trim().length > 0) {
      return fallback.trim();
    }
    return slug;
  }

  private async scanScriptFiles(dir: string): Promise<string[]> {
    const results: string[] = [];

    const scan = async (currentDir: string): Promise<void> => {
      let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await scan(fullPath);
          continue;
        }

        if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.py') {
          results.push(fullPath);
        }
      }
    };

    await scan(dir);
    return results;
  }

  private async readScriptFileWithMetadata(filePath: string): Promise<ParsedScriptFile | null> {
    try {
      const rawContent = await fs.readFile(filePath, 'utf-8');
      return this.parseScriptFile(rawContent);
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code !== 'ENOENT') {
        throw error;
      }
      return null;
    }
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
