import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { and, desc, eq } from 'drizzle-orm';
import { Liquid } from 'liquidjs';
import { getDatabase } from '../database';
import { posts, tags, templates, type NewTemplate, type Template } from '../database/schema';
import { CliNotifier, NoopNotifier } from './CliNotifier';

export type TemplateKind = 'post' | 'list' | 'not-found' | 'partial';

export interface TemplateData {
  id: string;
  projectId: string;
  slug: string;
  title: string;
  kind: TemplateKind;
  enabled: boolean;
  version: number;
  filePath: string;
  content: string;
  status: 'draft' | 'published';
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTemplateInput {
  title: string;
  kind: TemplateKind;
  content: string;
  slug?: string;
  enabled?: boolean;
}

export interface UpdateTemplateInput {
  title?: string;
  kind?: TemplateKind;
  content?: string;
  slug?: string;
  enabled?: boolean;
}

export type GitTemplateFileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface GitTemplateFileChange {
  status: GitTemplateFileChangeStatus;
  path: string;
  previousPath?: string;
}

export interface TemplateReconcileResult {
  created: number;
  updated: number;
  deleted: number;
  processedFiles: number;
}

export interface TemplateValidationResult {
  valid: boolean;
  errors: string[];
}

export interface TemplateDeleteResult {
  deleted: boolean;
  references?: { postIds: string[]; tagIds: string[] };
}

interface ParsedTemplateFile {
  metadata: {
    id?: string;
    projectId?: string;
    slug?: string;
    title?: string;
    kind?: string;
    enabled?: boolean;
    version?: number;
    createdAt?: string;
    updatedAt?: string;
  };
  body: string;
}

export class TemplateEngine extends EventEmitter {
  private currentProjectId = 'default';
  private dataDir: string | null = null;
  private readonly notifier: CliNotifier;

  constructor(notifier: CliNotifier = new NoopNotifier()) {
    super();
    this.notifier = notifier;
  }

  /** No persistent cache — no-op for watcher compat. */
  invalidate(_entityId?: string): void {}

  setProjectContext(projectId: string, dataDir?: string): void {
    this.currentProjectId = projectId;
    this.dataDir = dataDir || null;
  }

  getProjectContext(): string {
    return this.currentProjectId;
  }

  getTemplatesDirectory(): string {
    return this.getTemplatesDir();
  }

  async createTemplate(input: CreateTemplateInput): Promise<TemplateData> {
    const now = new Date();
    const allTemplates = await this.getAllTemplateRows();
    const desiredSlug = this.normalizeSlug(input.slug || input.title || 'template');
    const uniqueSlug = this.ensureUniqueSlug(desiredSlug, allTemplates);
    const templateId = uuidv4();
    const filePath = this.getTemplateFilePath(uniqueSlug);

    const row: NewTemplate = {
      id: templateId,
      projectId: this.currentProjectId,
      slug: uniqueSlug,
      title: input.title,
      kind: input.kind,
      enabled: input.enabled ?? true,
      version: 1,
      filePath,
      createdAt: now,
      updatedAt: now,
    };

    await fs.mkdir(this.getTemplatesDir(), { recursive: true });
    await fs.writeFile(filePath, this.serializeTemplateFile(row as Template, input.content), 'utf-8');

    await getDatabase().getLocal().insert(templates).values(row);

    const created = await this.toTemplateData(row as Template);
    this.emit('templateCreated', created);
    await this.notifier.notify('template', created.id, 'created');
    return created;
  }

  async updateTemplate(id: string, updates: UpdateTemplateInput): Promise<TemplateData | null> {
    const existing = await this.getTemplateRow(id);
    if (!existing) {
      return null;
    }

    const allTemplates = await this.getAllTemplateRows();
    const desiredSlug = typeof updates.slug === 'string'
      ? this.normalizeSlug(updates.slug)
      : typeof updates.title === 'string'
        ? this.normalizeSlug(updates.title)
        : existing.slug;
    const nextSlug = this.ensureUniqueSlug(desiredSlug, allTemplates, existing.id);
    const nextFilePath = this.getTemplateFilePath(nextSlug);
    const now = new Date();

    const nextTitle = updates.title ?? existing.title;
    const nextKind = updates.kind ?? existing.kind;
    const nextEnabled = updates.enabled ?? existing.enabled;
    const nextVersion = existing.version + 1;
    const nextContent = typeof updates.content === 'string'
      ? updates.content
      : await this.readTemplateBody(existing.filePath);

    const nextRow = {
      ...existing,
      title: nextTitle,
      slug: nextSlug,
      kind: nextKind,
      enabled: nextEnabled,
      filePath: nextFilePath,
      version: nextVersion,
      updatedAt: now,
    };

    const dbUpdates = {
      title: nextTitle,
      slug: nextSlug,
      kind: nextKind,
      enabled: nextEnabled,
      filePath: nextFilePath,
      version: nextVersion,
      updatedAt: now,
    };

    // DB-first: update the database row before touching the filesystem
    await getDatabase().getLocal()
      .update(templates)
      .set(dbUpdates)
      .where(and(eq(templates.id, existing.id), eq(templates.projectId, this.currentProjectId)));

    try {
      if (existing.filePath !== nextFilePath) {
        await fs.mkdir(this.getTemplatesDir(), { recursive: true });
        await fs.rename(existing.filePath, nextFilePath);
      }

      await fs.writeFile(nextFilePath, this.serializeTemplateFile(nextRow, nextContent), 'utf-8');
    } catch (fileError) {
      // Roll back the DB row to previous values on file operation failure
      await getDatabase().getLocal()
        .update(templates)
        .set({
          title: existing.title,
          slug: existing.slug,
          kind: existing.kind,
          enabled: existing.enabled,
          filePath: existing.filePath,
          version: existing.version,
          updatedAt: existing.updatedAt,
        })
        .where(and(eq(templates.id, existing.id), eq(templates.projectId, this.currentProjectId)));
      throw fileError;
    }

    // Cascade slug updates to referencing posts and tags
    if (existing.slug !== nextSlug) {
      await getDatabase().getLocal()
        .update(posts)
        .set({ templateSlug: nextSlug })
        .where(and(eq(posts.templateSlug, existing.slug), eq(posts.projectId, this.currentProjectId)));
      await getDatabase().getLocal()
        .update(tags)
        .set({ postTemplateSlug: nextSlug })
        .where(and(eq(tags.postTemplateSlug, existing.slug), eq(tags.projectId, this.currentProjectId)));
    }

    const updatedRow = await this.getTemplateRow(existing.id);
    if (!updatedRow) {
      return null;
    }

    const updated = await this.toTemplateData(updatedRow);
    this.emit('templateUpdated', updated);
    await this.notifier.notify('template', updated.id, 'updated');
    return updated;
  }

  async getTemplateReferences(slug: string): Promise<{ postIds: string[]; tagIds: string[] }> {
    const db = getDatabase().getLocal();
    const referencingPosts = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.templateSlug, slug), eq(posts.projectId, this.currentProjectId)))
      .all();
    const referencingTags = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.postTemplateSlug, slug), eq(tags.projectId, this.currentProjectId)))
      .all();
    return {
      postIds: referencingPosts.map((row) => row.id),
      tagIds: referencingTags.map((row) => row.id),
    };
  }

  async deleteTemplate(id: string, options?: { force?: boolean }): Promise<TemplateDeleteResult> {
    const existing = await this.getTemplateRow(id);
    if (!existing) {
      return { deleted: false };
    }

    const refs = await this.getTemplateReferences(existing.slug);
    const hasReferences = refs.postIds.length > 0 || refs.tagIds.length > 0;

    if (hasReferences && !options?.force) {
      return { deleted: false, references: refs };
    }

    if (hasReferences && options?.force) {
      const db = getDatabase().getLocal();
      await db
        .update(posts)
        .set({ templateSlug: null })
        .where(and(eq(posts.templateSlug, existing.slug), eq(posts.projectId, this.currentProjectId)));
      await db
        .update(tags)
        .set({ postTemplateSlug: null })
        .where(and(eq(tags.postTemplateSlug, existing.slug), eq(tags.projectId, this.currentProjectId)));
    }

    await getDatabase().getLocal()
      .delete(templates)
      .where(and(eq(templates.id, existing.id), eq(templates.projectId, this.currentProjectId)));

    try {
      await fs.unlink(existing.filePath);
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code !== 'ENOENT') {
        throw error;
      }
    }

    this.emit('templateDeleted', id);
    await this.notifier.notify('template', id, 'deleted');
    return { deleted: true };
  }

  async getTemplate(id: string): Promise<TemplateData | null> {
    const row = await this.getTemplateRow(id);
    if (!row) {
      return null;
    }
    return this.toTemplateData(row);
  }

  async getAllTemplates(): Promise<TemplateData[]> {
    const rows = await this.getAllTemplateRows();
    return Promise.all(rows.map((item) => this.toTemplateData(item)));
  }

  async getEnabledTemplatesByKind(kind: TemplateKind): Promise<TemplateData[]> {
    const rows = await this.getAllTemplateRows();
    const kindRows = rows.filter((row) => row.kind === kind && row.enabled);
    return Promise.all(kindRows.map((item) => this.toTemplateData(item)));
  }

  async getTemplateBySlug(slug: string): Promise<TemplateData | null> {
    const normalizedSlug = slug.toLowerCase();
    const rows = await this.getAllTemplateRows();
    const match = rows.find(
      (row) => row.enabled && row.slug.toLowerCase() === normalizedSlug,
    );
    if (!match) {
      return null;
    }
    return this.toTemplateData(match);
  }

  async validateTemplate(content: string): Promise<TemplateValidationResult> {
    try {
      const liquid = new Liquid({ strictVariables: false, strictFilters: false });
      await liquid.parse(content);
      return { valid: true, errors: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { valid: false, errors: [message] };
    }
  }

  async rebuildDatabaseFromFiles(): Promise<void> {
    const db = getDatabase().getLocal();
    const templatesDir = this.getTemplatesDir();

    await db.delete(templates).where(eq(templates.projectId, this.currentProjectId));

    const liquidFiles = await this.scanTemplateFiles(templatesDir);
    if (liquidFiles.length === 0) {
      this.emit('templatesRebuilt');
      return;
    }

    const usedIds = new Set<string>();
    const insertedRows: Template[] = [];

    for (const filePath of liquidFiles) {
      const parsed = await this.readTemplateFileWithMetadata(filePath);
      if (!parsed) {
        continue;
      }

      const desiredSlug = this.normalizeSlug(parsed.metadata.slug || path.basename(filePath, '.liquid'));
      const slug = this.ensureUniqueSlug(desiredSlug, insertedRows);

      const desiredId = typeof parsed.metadata.id === 'string' && parsed.metadata.id.trim().length > 0
        ? parsed.metadata.id.trim()
        : uuidv4();
      const id = usedIds.has(desiredId) ? uuidv4() : desiredId;

      const now = new Date();
      const row: NewTemplate = {
        id,
        projectId: this.currentProjectId,
        slug,
        title: this.normalizeTitle(parsed.metadata.title, slug),
        kind: this.normalizeKind(parsed.metadata.kind),
        enabled: this.normalizeEnabled(parsed.metadata.enabled),
        version: this.normalizeVersion(parsed.metadata.version),
        filePath,
        createdAt: this.normalizeDate(parsed.metadata.createdAt, now),
        updatedAt: this.normalizeDate(parsed.metadata.updatedAt, now),
      };

      await db.insert(templates).values(row);
      insertedRows.push(row as Template);
      usedIds.add(id);
    }

    this.emit('templatesRebuilt');
  }

  async reconcileTemplatesFromGitChanges(projectPath: string, changes: GitTemplateFileChange[]): Promise<TemplateReconcileResult> {
    const db = getDatabase().getLocal();
    const normalizedProjectPath = path.resolve(projectPath);

    const relevantChanges = changes.filter((change) => {
      if (!this.isLiquidTemplatePath(change.path)) {
        return false;
      }
      if (change.status === 'renamed' && change.previousPath && !this.isLiquidTemplatePath(change.previousPath) && !this.isLiquidTemplatePath(change.path)) {
        return false;
      }
      return true;
    });

    if (relevantChanges.length === 0) {
      return { created: 0, updated: 0, deleted: 0, processedFiles: 0 };
    }

    const templateRows = await this.getAllTemplateRows();
    const templatesByPath = new Map<string, Template>();
    for (const row of templateRows) {
      templatesByPath.set(this.normalizePathForCompare(row.filePath), row);
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
        const existing = templatesByPath.get(absolutePath);
        if (!existing) {
          continue;
        }

        await db.delete(templates).where(and(eq(templates.id, existing.id), eq(templates.projectId, this.currentProjectId)));
        templatesByPath.delete(absolutePath);
        this.emit('templateDeleted', existing.id);
        deleted += 1;
        processedFiles += 1;
        continue;
      }

      let existing = previousAbsolutePath
        ? (templatesByPath.get(previousAbsolutePath) || templatesByPath.get(absolutePath))
        : templatesByPath.get(absolutePath);

      const parsed = await this.readTemplateFileWithMetadata(absolutePath);
      if (!parsed) {
        continue;
      }

      const allRows = await this.getAllTemplateRows();
      const parsedId = typeof parsed.metadata.id === 'string' ? parsed.metadata.id.trim() : '';
      if (!existing && parsedId.length > 0) {
        const byId = allRows.find((row) => row.id === parsedId);
        if (byId) {
          existing = byId;
        }
      }
      const desiredSlug = this.normalizeSlug(parsed.metadata.slug || path.basename(absolutePath, '.liquid'));
      const slug = this.ensureUniqueSlug(desiredSlug, allRows, existing?.id);

      if (existing) {
        const updateNow = new Date();
        const nextRow = {
          title: this.normalizeTitle(parsed.metadata.title, slug, existing.title),
          slug,
          kind: this.normalizeKind(parsed.metadata.kind, existing.kind),
          enabled: this.normalizeEnabled(parsed.metadata.enabled, existing.enabled),
          version: this.normalizeVersion(parsed.metadata.version, existing.version),
          filePath: absolutePath,
          createdAt: this.normalizeDate(parsed.metadata.createdAt, existing.createdAt),
          updatedAt: this.normalizeDate(parsed.metadata.updatedAt, updateNow),
        };

        await db.update(templates)
          .set(nextRow)
          .where(and(eq(templates.id, existing.id), eq(templates.projectId, this.currentProjectId)));

        const updatedRow = await this.getTemplateRow(existing.id);
        if (updatedRow) {
          const updatedTemplate = await this.toTemplateData(updatedRow);
          this.emit('templateUpdated', updatedTemplate);
        }

        if (previousAbsolutePath) {
          templatesByPath.delete(previousAbsolutePath);
        }
        templatesByPath.set(absolutePath, {
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

      const newRow: NewTemplate = {
        id: rowId,
        projectId: this.currentProjectId,
        slug,
        title: this.normalizeTitle(parsed.metadata.title, slug),
        kind: this.normalizeKind(parsed.metadata.kind),
        enabled: this.normalizeEnabled(parsed.metadata.enabled),
        version: this.normalizeVersion(parsed.metadata.version),
        filePath: absolutePath,
        createdAt: this.normalizeDate(parsed.metadata.createdAt, now),
        updatedAt: this.normalizeDate(parsed.metadata.updatedAt, now),
      };

      await db.insert(templates).values(newRow);

      const createdRow = await this.getTemplateRow(newRow.id);
      if (createdRow) {
        const createdTemplate = await this.toTemplateData(createdRow);
        this.emit('templateCreated', createdTemplate);
      }

      templatesByPath.set(absolutePath, newRow as Template);
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

  private async getTemplateRow(id: string): Promise<Template | null> {
    const rows = await this.getAllTemplateRows();
    return rows.find((item) => item.id === id) || null;
  }

  private async getAllTemplateRows(): Promise<Template[]> {
    return getDatabase().getLocal()
      .select()
      .from(templates)
      .where(eq(templates.projectId, this.currentProjectId))
      .orderBy(desc(templates.updatedAt))
      .all();
  }

  private async toTemplateData(row: Template): Promise<TemplateData> {
    // Draft templates store content in the DB; published templates read from disk.
    const content = row.status === 'draft' && row.content != null
      ? row.content
      : await this.readTemplateBody(row.filePath);

    return {
      id: row.id,
      projectId: row.projectId,
      slug: row.slug,
      title: row.title,
      kind: row.kind,
      enabled: row.enabled,
      version: row.version,
      filePath: row.filePath,
      content,
      status: (row.status as 'draft' | 'published') ?? 'published',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ── Draft lifecycle ────────────────────────────────────────────────────────

  /** Create a template DB row with status='draft'; no file is written. */
  async createDraftTemplate(data: CreateTemplateInput): Promise<TemplateData> {
    const now = new Date();
    const allTemplates = await this.getAllTemplateRows();
    const desiredSlug = this.normalizeSlug(data.slug || data.title || 'template');
    const uniqueSlug = this.ensureUniqueSlug(desiredSlug, allTemplates);
    const templateId = uuidv4();
    const filePath = this.getTemplateFilePath(uniqueSlug); // path reserved but not yet written

    const row: NewTemplate = {
      id: templateId,
      projectId: this.currentProjectId,
      slug: uniqueSlug,
      title: data.title,
      kind: data.kind,
      enabled: data.enabled ?? true,
      version: 1,
      filePath,
      status: 'draft',
      content: data.content,
      createdAt: now,
      updatedAt: now,
    };

    await getDatabase().getLocal().insert(templates).values(row);
    const created = await this.toTemplateData(row as Template);
    this.emit('templateCreated', created);
    return created;
  }

  /** Publish a draft template: write file to disk, set status='published', clear DB content. */
  async publishTemplate(id: string): Promise<TemplateData | null> {
    const existing = await this.getTemplateRow(id);
    if (!existing) return null;

    const content = existing.status === 'draft' && existing.content != null
      ? existing.content
      : await this.readTemplateBody(existing.filePath);

    await fs.mkdir(this.getTemplatesDir(), { recursive: true });
    await fs.writeFile(existing.filePath, this.serializeTemplateFile(existing, content), 'utf-8');

    const now = new Date();
    await getDatabase().getLocal()
      .update(templates)
      .set({ status: 'published', content: null, updatedAt: now })
      .where(eq(templates.id, id));

    const updatedRow = await this.getTemplateRow(id);
    if (!updatedRow) return null;
    const result = await this.toTemplateData(updatedRow);
    this.emit('templateUpdated', result);
    await this.notifier.notify('template', id, 'updated');
    return result;
  }

  /** Delete a draft template (only if status='draft'). Returns false if not found or already published. */
  async deleteDraftTemplate(id: string): Promise<boolean> {
    const existing = await this.getTemplateRow(id);
    if (!existing || existing.status !== 'draft') return false;

    await getDatabase().getLocal()
      .delete(templates)
      .where(and(eq(templates.id, id), eq(templates.projectId, this.currentProjectId)));

    this.emit('templateDeleted', id);
    await this.notifier.notify('template', id, 'deleted');
    return true;
  }

  private getDataDir(): string {
    if (this.dataDir) {
      return this.dataDir;
    }

    return path.join(app.getPath('userData'), 'projects', this.currentProjectId);
  }

  private getTemplatesDir(): string {
    return path.join(this.getDataDir(), 'templates');
  }

  private getTemplateFilePath(slug: string): string {
    return path.join(this.getTemplatesDir(), `${slug}.liquid`);
  }

  private normalizePathForCompare(filePath: string): string {
    return path.resolve(filePath).replace(/\\/g, '/');
  }

  private isLiquidTemplatePath(value: string): boolean {
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
    return normalized.startsWith('templates/') && path.extname(normalized).toLowerCase() === '.liquid';
  }

  private normalizeSlug(value: string): string {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return normalized || 'template';
  }

  private ensureUniqueSlug(slug: string, rows: Template[], excludeId?: string): string {
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

  private serializeTemplateFile(row: Pick<Template, 'id' | 'projectId' | 'slug' | 'title' | 'kind' | 'enabled' | 'version' | 'createdAt' | 'updatedAt'>, content: string): string {
    const lines = [
      '---',
      `id: ${this.toYamlString(row.id)}`,
      `projectId: ${this.toYamlString(row.projectId)}`,
      `slug: ${this.toYamlString(row.slug)}`,
      `title: ${this.toYamlString(row.title)}`,
      `kind: ${this.toYamlString(row.kind)}`,
      `enabled: ${row.enabled ? 'true' : 'false'}`,
      `version: ${row.version}`,
      `createdAt: ${this.toYamlString(row.createdAt.toISOString())}`,
      `updatedAt: ${this.toYamlString(row.updatedAt.toISOString())}`,
      '---',
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

  private parseTemplateBody(rawContent: string): string {
    const frontmatterPattern = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
    if (!frontmatterPattern.test(rawContent)) {
      return rawContent;
    }

    return rawContent.replace(frontmatterPattern, '');
  }

  private parseTemplateFile(rawContent: string): ParsedTemplateFile {
    const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
    const match = rawContent.match(frontmatterPattern);
    if (!match) {
      return {
        metadata: {},
        body: rawContent,
      };
    }

    const metadataLines = (match[1] || '').split(/\r?\n/);
    const metadata: ParsedTemplateFile['metadata'] = {};

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
      body: rawContent.replace(frontmatterPattern, ''),
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

  private normalizeKind(kind: string | undefined, fallback: TemplateKind = 'post'): TemplateKind {
    if (kind === 'post' || kind === 'list' || kind === 'not-found' || kind === 'partial') {
      return kind;
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

  private async scanTemplateFiles(dir: string): Promise<string[]> {
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

        if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.liquid') {
          results.push(fullPath);
        }
      }
    };

    await scan(dir);
    return results;
  }

  private async readTemplateFileWithMetadata(filePath: string): Promise<ParsedTemplateFile | null> {
    try {
      const rawContent = await fs.readFile(filePath, 'utf-8');
      return this.parseTemplateFile(rawContent);
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code !== 'ENOENT') {
        throw error;
      }
      return null;
    }
  }

  private async readTemplateBody(filePath: string): Promise<string> {
    try {
      const rawContent = await fs.readFile(filePath, 'utf-8');
      return this.parseTemplateBody(rawContent);
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code !== 'ENOENT') {
        throw error;
      }
      return '';
    }
  }
}


