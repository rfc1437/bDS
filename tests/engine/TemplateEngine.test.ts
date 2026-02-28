import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemplateEngine } from '../../src/main/engine/TemplateEngine';
import { posts, tags, templates } from '../../src/main/database/schema';

const mockTemplates = new Map<string, any>();
const mockPosts = new Map<string, any>();
const mockTags = new Map<string, any>();
const mockFiles = new Map<string, string>();

function createSelectChain(dataSource: () => any[]) {
  return {
    from: vi.fn(function (this: any, table: any) {
      if (table === posts) {
        this.all = vi.fn(() => Promise.resolve(Array.from(mockPosts.values())));
      } else if (table === tags) {
        this.all = vi.fn(() => Promise.resolve(Array.from(mockTags.values())));
      }
      return this;
    }),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => Promise.resolve(dataSource())),
    get: vi.fn().mockImplementation(() => Promise.resolve(undefined)),
  };
}

function createDrizzleMock() {
  return {
    select: vi.fn(() => createSelectChain(() => Array.from(mockTemplates.values()))),
    insert: vi.fn(() => ({
      values: vi.fn((data: any) => {
        mockTemplates.set(data.id, data);
        return Promise.resolve();
      }),
    })),
    update: vi.fn((table?: any) => ({
      set: vi.fn((updates: any) => ({
        where: vi.fn(async () => {
          if (table === posts) {
            for (const [postId, existing] of mockPosts.entries()) {
              mockPosts.set(postId, { ...existing, ...updates });
            }
          } else if (table === tags) {
            for (const [tagId, existing] of mockTags.entries()) {
              mockTags.set(tagId, { ...existing, ...updates });
            }
          } else {
            for (const [templateId, existing] of mockTemplates.entries()) {
              mockTemplates.set(templateId, { ...existing, ...updates });
            }
          }
        }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => {
        mockTemplates.clear();
        return Promise.resolve();
      }),
    })),
  };
}

const mockLocalDb = createDrizzleMock();

vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => mockLocalDb),
  })),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-template-id'),
}));

vi.mock('fs/promises', () => ({
  readdir: vi.fn(async (dirPath: string, options?: { withFileTypes?: boolean }) => {
    if (options?.withFileTypes) {
      const files = Array.from((globalThis as any).__mockTemplateFiles.keys()) as string[];
      const names = files
        .filter((filePath) => filePath.startsWith(`${dirPath}/`))
        .map((filePath) => filePath.slice(dirPath.length + 1))
        .filter((name) => !name.includes('/'));

      return names.map((name) => ({
        name,
        isDirectory: () => false,
        isFile: () => true,
      }));
    }

    return [];
  }),
  readFile: vi.fn(async (filePath: string) => {
    const value = (globalThis as any).__mockTemplateFiles.get(filePath);
    if (typeof value !== 'string') {
      const error = new Error('ENOENT');
      (error as any).code = 'ENOENT';
      throw error;
    }
    return value;
  }),
  writeFile: vi.fn(async (filePath: string, content: string) => {
    (globalThis as any).__mockTemplateFiles.set(filePath, content);
  }),
  unlink: vi.fn(async (filePath: string) => {
    (globalThis as any).__mockTemplateFiles.delete(filePath);
  }),
  rename: vi.fn(async (fromPath: string, toPath: string) => {
    const files = (globalThis as any).__mockTemplateFiles;
    const content = files.get(fromPath);
    files.delete(fromPath);
    files.set(toPath, content);
  }),
  mkdir: vi.fn(async () => {}),
}));

describe('TemplateEngine', () => {
  let templateEngine: TemplateEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTemplates.clear();
    mockPosts.clear();
    mockTags.clear();
    mockFiles.clear();
    (globalThis as any).__mockTemplateFiles = mockFiles;
    vi.mocked(mockLocalDb.select).mockImplementation(() => createSelectChain(() => Array.from(mockTemplates.values())));

    templateEngine = new TemplateEngine();
    templateEngine.setProjectContext('default', '/mock/userData/projects/default');
  });

  it('creates template metadata and liquid file', async () => {
    const created = await templateEngine.createTemplate({
      title: 'Custom Post Layout',
      kind: 'post',
      content: '<main>\n  <article>{{ post.content | markdown }}</article>\n</main>',
    });

    expect(created.slug).toBe('custom_post_layout');
    expect(mockTemplates.has(created.id)).toBe(true);
    const persistedFile = mockFiles.get('/mock/userData/projects/default/templates/custom_post_layout.liquid') || '';
    expect(persistedFile).toContain('---');
    expect(persistedFile).toContain('title: "Custom Post Layout"');
    expect(persistedFile).toContain('kind: "post"');
    expect(persistedFile).toContain('<article>');
    expect(created.content).toBe('<main>\n  <article>{{ post.content | markdown }}</article>\n</main>');
  });

  it('updates template metadata and file content', async () => {
    const created = await templateEngine.createTemplate({
      title: 'Custom Post Layout',
      kind: 'post',
      content: '<main><article>Original</article></main>',
    });

    const updated = await templateEngine.updateTemplate(created.id, {
      title: 'Updated Post Layout',
      content: '<main><article>Updated</article></main>',
    });

    expect(updated?.slug).toBe('updated_post_layout');
    expect(mockFiles.get('/mock/userData/projects/default/templates/updated_post_layout.liquid')).toContain('Updated');
  });

  it('appends underscore numeric suffix for duplicate slugs', async () => {
    const first = await templateEngine.createTemplate({
      title: 'Custom Post',
      kind: 'post',
      content: '<main>First</main>',
    });

    vi.mocked((await import('uuid')).v4)
      .mockReturnValueOnce('mock-template-id-2');

    const second = await templateEngine.createTemplate({
      title: 'Custom Post',
      kind: 'post',
      content: '<main>Second</main>',
    });

    expect(first.slug).toBe('custom_post');
    expect(second.slug).toBe('custom_post_2');
    expect(mockFiles.get('/mock/userData/projects/default/templates/custom_post_2.liquid')).toContain('Second');
  });

  it('deletes template metadata and liquid file', async () => {
    const created = await templateEngine.createTemplate({
      title: 'Delete Me',
      kind: 'partial',
      content: '<footer>Footer</footer>',
    });

    const result = await templateEngine.deleteTemplate(created.id);

    expect(result).toEqual({ deleted: true });
    expect(mockTemplates.has(created.id)).toBe(false);
    expect(mockFiles.has('/mock/userData/projects/default/templates/delete_me.liquid')).toBe(false);
  });

  it('keeps template content clean when file contains YAML frontmatter', async () => {
    const created = await templateEngine.createTemplate({
      title: 'Metadata Test',
      kind: 'list',
      content: '<main>{{ day_blocks }}</main>',
    });

    const loaded = await templateEngine.getTemplate(created.id);

    expect(loaded?.content).toBe('<main>{{ day_blocks }}</main>');
    expect(loaded?.title).toBe('Metadata Test');
    expect(loaded?.kind).toBe('list');
  });

  it('rebuilds templates from filesystem and applies external file metadata', async () => {
    const templatePath = '/mock/userData/projects/default/templates/external_post.liquid';
    mockFiles.set(templatePath, [
      '---',
      'id: "external-template-id"',
      'projectId: "default"',
      'slug: "external_post"',
      'title: "External Post Layout"',
      'kind: "post"',
      'enabled: false',
      'version: 3',
      'createdAt: "2026-02-20T10:00:00.000Z"',
      'updatedAt: "2026-02-21T11:00:00.000Z"',
      '---',
      '<main><article>{{ post.content | markdown }}</article></main>',
    ].join('\n'));

    await templateEngine.rebuildDatabaseFromFiles();

    const all = await templateEngine.getAllTemplates();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('external-template-id');
    expect(all[0].slug).toBe('external_post');
    expect(all[0].kind).toBe('post');
    expect(all[0].enabled).toBe(false);
    expect(all[0].version).toBe(3);
    expect(all[0].title).toBe('External Post Layout');
    expect(all[0].content).toContain('<article>');
  });

  it('reconciles git changes for templates (modify/add/delete)', async () => {
    const created = await templateEngine.createTemplate({
      title: 'Custom Post',
      kind: 'post',
      content: '<main>Original</main>',
    });

    const existingPath = '/repo/templates/custom_post.liquid';
    mockFiles.set(existingPath, [
      '---',
      `id: "${created.id}"`,
      'projectId: "default"',
      'slug: "custom_post"',
      'title: "Custom Post Updated Outside"',
      'kind: "post"',
      'enabled: true',
      'version: 8',
      'createdAt: "2026-02-20T10:00:00.000Z"',
      'updatedAt: "2026-02-21T11:00:00.000Z"',
      '---',
      '<main>Updated Outside</main>',
    ].join('\n'));

    const addedPath = '/repo/templates/new_list.liquid';
    mockFiles.set(addedPath, [
      '---',
      'id: "added-template-id"',
      'projectId: "default"',
      'slug: "new_list"',
      'title: "New List Layout"',
      'kind: "list"',
      'enabled: true',
      'version: 1',
      'createdAt: "2026-02-22T10:00:00.000Z"',
      'updatedAt: "2026-02-22T11:00:00.000Z"',
      '---',
      '<main>{{ day_blocks }}</main>',
    ].join('\n'));

    const result = await templateEngine.reconcileTemplatesFromGitChanges('/repo', [
      { status: 'modified', path: 'templates/custom_post.liquid' },
      { status: 'added', path: 'templates/new_list.liquid' },
      { status: 'deleted', path: 'templates/custom_post.liquid' },
    ]);

    expect(result.updated).toBe(1);
    expect(result.created).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.processedFiles).toBe(3);
  });

  describe('template kind queries', () => {
    it('getEnabledTemplatesByKind returns only enabled templates of specified kind', async () => {
      await templateEngine.createTemplate({
        title: 'Post Template',
        kind: 'post',
        content: '<main>Post</main>',
        enabled: true,
      });

      vi.mocked((await import('uuid')).v4).mockReturnValueOnce('mock-template-id-2');

      await templateEngine.createTemplate({
        title: 'List Template',
        kind: 'list',
        content: '<main>List</main>',
        enabled: true,
      });

      vi.mocked((await import('uuid')).v4).mockReturnValueOnce('mock-template-id-3');

      await templateEngine.createTemplate({
        title: 'Disabled Post',
        kind: 'post',
        content: '<main>Disabled</main>',
        enabled: false,
      });

      const postTemplates = await templateEngine.getEnabledTemplatesByKind('post');
      expect(postTemplates).toHaveLength(1);
      expect(postTemplates[0].kind).toBe('post');
      expect(postTemplates[0].enabled).toBe(true);
      expect(postTemplates[0].title).toBe('Post Template');
    });
  });

  describe('template validation', () => {
    it('validates correct liquid syntax', async () => {
      const result = await templateEngine.validateTemplate('<main>{{ post.title }}</main>');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('reports invalid liquid syntax', async () => {
      const result = await templateEngine.validateTemplate('<main>{% if unclosed %}</main>');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('template slug normalization', () => {
    it('normalizes slugs to lowercase with underscores', async () => {
      const created = await templateEngine.createTemplate({
        title: 'My Custom Layout!',
        kind: 'post',
        content: '<main>test</main>',
      });

      expect(created.slug).toBe('my_custom_layout');
    });

    it('uses slug from input when provided', async () => {
      const created = await templateEngine.createTemplate({
        title: 'Custom Post Layout',
        kind: 'post',
        content: '<main>test</main>',
        slug: 'my-custom-slug',
      });

      expect(created.slug).toBe('my_custom_slug');
    });
  });

  describe('getTemplateBySlug', () => {
    it('retrieves an enabled template by exact slug', async () => {
      await templateEngine.createTemplate({
        title: 'Custom Post',
        kind: 'post',
        content: '<main>Post</main>',
        enabled: true,
      });

      const found = await templateEngine.getTemplateBySlug('custom_post');
      expect(found).not.toBeNull();
      expect(found?.slug).toBe('custom_post');
      expect(found?.title).toBe('Custom Post');
    });

    it('matches slugs case-insensitively', async () => {
      await templateEngine.createTemplate({
        title: 'Custom Post',
        kind: 'post',
        content: '<main>Post</main>',
        enabled: true,
      });

      const found = await templateEngine.getTemplateBySlug('CUSTOM_POST');
      expect(found).not.toBeNull();
      expect(found?.slug).toBe('custom_post');
    });

    it('returns null for non-existent slug', async () => {
      const found = await templateEngine.getTemplateBySlug('does_not_exist');
      expect(found).toBeNull();
    });

    it('does not return disabled templates', async () => {
      await templateEngine.createTemplate({
        title: 'Disabled Template',
        kind: 'post',
        content: '<main>Disabled</main>',
        enabled: false,
      });

      const found = await templateEngine.getTemplateBySlug('disabled_template');
      expect(found).toBeNull();
    });
  });

  describe('referential integrity', () => {
    it('getTemplateReferences returns empty arrays when no references exist', async () => {
      const refs = await templateEngine.getTemplateReferences('custom_post');
      expect(refs).toEqual({ postIds: [], tagIds: [] });
    });

    it('getTemplateReferences returns referencing post and tag IDs', async () => {
      mockPosts.set('post-1', { id: 'post-1', projectId: 'default', templateSlug: 'custom_post' });
      mockTags.set('tag-1', { id: 'tag-1', projectId: 'default', postTemplateSlug: 'custom_post' });

      const refs = await templateEngine.getTemplateReferences('custom_post');
      expect(refs.postIds).toContain('post-1');
      expect(refs.tagIds).toContain('tag-1');
    });

    it('deleteTemplate blocks deletion when references exist and force is not set', async () => {
      const created = await templateEngine.createTemplate({
        title: 'Referenced Template',
        kind: 'post',
        content: '<main>Referenced</main>',
      });

      mockPosts.set('post-1', { id: 'post-1', projectId: 'default', templateSlug: created.slug });

      const result = await templateEngine.deleteTemplate(created.id);

      expect(result.deleted).toBe(false);
      expect(result.references?.postIds).toContain('post-1');
      expect(mockTemplates.has(created.id)).toBe(true);
    });

    it('deleteTemplate with force clears references and deletes', async () => {
      const created = await templateEngine.createTemplate({
        title: 'Force Delete',
        kind: 'post',
        content: '<main>Force</main>',
      });

      mockPosts.set('post-1', { id: 'post-1', projectId: 'default', templateSlug: created.slug });
      mockTags.set('tag-1', { id: 'tag-1', projectId: 'default', postTemplateSlug: created.slug });

      const result = await templateEngine.deleteTemplate(created.id, { force: true });

      expect(result.deleted).toBe(true);
      expect(mockTemplates.has(created.id)).toBe(false);
      expect(mockPosts.get('post-1').templateSlug).toBeNull();
      expect(mockTags.get('tag-1').postTemplateSlug).toBeNull();
    });
  });

  describe('slug cascade on rename', () => {
    it('cascades slug changes to posts.templateSlug on template rename', async () => {
      const created = await templateEngine.createTemplate({
        title: 'Original Name',
        kind: 'post',
        content: '<main>Content</main>',
      });

      mockPosts.set('post-1', { id: 'post-1', projectId: 'default', templateSlug: created.slug });

      await templateEngine.updateTemplate(created.id, { title: 'Renamed Template' });

      expect(mockPosts.get('post-1').templateSlug).toBe('renamed_template');
    });

    it('cascades slug changes to tags.postTemplateSlug on template rename', async () => {
      const created = await templateEngine.createTemplate({
        title: 'Original Name',
        kind: 'post',
        content: '<main>Content</main>',
      });

      mockTags.set('tag-1', { id: 'tag-1', projectId: 'default', postTemplateSlug: created.slug });

      await templateEngine.updateTemplate(created.id, { title: 'Renamed Template' });

      expect(mockTags.get('tag-1').postTemplateSlug).toBe('renamed_template');
    });
  });

  describe('race condition protection', () => {
    it('rolls back DB on file operation failure during update', async () => {
      const created = await templateEngine.createTemplate({
        title: 'Rollback Test',
        kind: 'post',
        content: '<main>Original</main>',
      });

      const originalSlug = created.slug;
      const originalTitle = created.title;

      // Make fs.rename throw to simulate file operation failure
      const fsModule = await import('fs/promises');
      vi.mocked(fsModule.rename).mockRejectedValueOnce(new Error('EPERM'));

      await expect(
        templateEngine.updateTemplate(created.id, { title: 'Should Fail' }),
      ).rejects.toThrow('EPERM');

      // DB should have been rolled back to original values
      const row = mockTemplates.get(created.id);
      expect(row.slug).toBe(originalSlug);
      expect(row.title).toBe(originalTitle);
    });
  });

  describe('draft lifecycle', () => {
    it('createDraftTemplate inserts a row with status draft and content in DB', async () => {
      const created = await templateEngine.createDraftTemplate({
        title: 'Draft Post Layout',
        kind: 'post',
        content: '<main>{{ post.title }}</main>',
      });

      expect(created.status).toBe('draft');
      expect(created.content).toBe('<main>{{ post.title }}</main>');
      expect(created.slug).toBe('draft_post_layout');
      expect(mockTemplates.has(created.id)).toBe(true);

      const row = mockTemplates.get(created.id);
      expect(row.status).toBe('draft');
      expect(row.content).toBe('<main>{{ post.title }}</main>');
    });

    it('createDraftTemplate does not write a file to disk', async () => {
      const fsModule = await import('fs/promises');
      vi.mocked(fsModule.writeFile).mockClear();

      await templateEngine.createDraftTemplate({
        title: 'No File Draft',
        kind: 'list',
        content: '<main>{{ day_blocks }}</main>',
      });

      expect(fsModule.writeFile).not.toHaveBeenCalled();
    });

    it('createDraftTemplate generates a unique slug', async () => {
      await templateEngine.createDraftTemplate({
        title: 'Unique Slug',
        kind: 'post',
        content: '<main>first</main>',
      });

      vi.mocked((await import('uuid')).v4).mockReturnValueOnce('mock-template-id-2');

      const second = await templateEngine.createDraftTemplate({
        title: 'Unique Slug',
        kind: 'post',
        content: '<main>second</main>',
      });

      expect(second.slug).toBe('unique_slug_2');
    });

    it('publishTemplate writes file and sets status to published', async () => {
      const draft = await templateEngine.createDraftTemplate({
        title: 'Publish Me',
        kind: 'post',
        content: '<main>{{ post.content }}</main>',
      });

      const published = await templateEngine.publishTemplate(draft.id);

      expect(published).not.toBeNull();
      expect(published!.status).toBe('published');

      const row = mockTemplates.get(draft.id);
      expect(row.status).toBe('published');
      expect(row.content).toBeNull();

      const fileContent = mockFiles.get(draft.filePath);
      expect(fileContent).toBeDefined();
      expect(fileContent).toContain('title: "Publish Me"');
      expect(fileContent).toContain('{{ post.content }}');
    });

    it('publishTemplate returns null for non-existent template', async () => {
      const result = await templateEngine.publishTemplate('nonexistent-id');
      expect(result).toBeNull();
    });

    it('publishTemplate calls notifier with updated action', async () => {
      const mockNotifier = { notify: vi.fn().mockResolvedValue(undefined) };
      const notifiedEngine = new TemplateEngine(mockNotifier);
      notifiedEngine.setProjectContext('default', '/mock/userData/projects/default');

      const draft = await notifiedEngine.createDraftTemplate({
        title: 'Notified Publish',
        kind: 'post',
        content: '<main>notify</main>',
      });

      await notifiedEngine.publishTemplate(draft.id);

      expect(mockNotifier.notify).toHaveBeenCalledWith('template', draft.id, 'updated');
    });

    it('deleteDraftTemplate removes a draft row from the database', async () => {
      const draft = await templateEngine.createDraftTemplate({
        title: 'Delete Draft',
        kind: 'partial',
        content: '<footer>draft</footer>',
      });

      const deleted = await templateEngine.deleteDraftTemplate(draft.id);

      expect(deleted).toBe(true);
      expect(mockTemplates.size).toBe(0);
    });

    it('deleteDraftTemplate returns false for non-existent template', async () => {
      const result = await templateEngine.deleteDraftTemplate('no-such-id');
      expect(result).toBe(false);
    });

    it('deleteDraftTemplate returns false for published templates', async () => {
      const created = await templateEngine.createTemplate({
        title: 'Published Template',
        kind: 'post',
        content: '<main>published</main>',
      });

      const result = await templateEngine.deleteDraftTemplate(created.id);
      expect(result).toBe(false);
    });

    it('deleteDraftTemplate calls notifier with deleted action', async () => {
      const mockNotifier = { notify: vi.fn().mockResolvedValue(undefined) };
      const notifiedEngine = new TemplateEngine(mockNotifier);
      notifiedEngine.setProjectContext('default', '/mock/userData/projects/default');

      const draft = await notifiedEngine.createDraftTemplate({
        title: 'Notified Delete',
        kind: 'partial',
        content: '<footer>notify</footer>',
      });

      await notifiedEngine.deleteDraftTemplate(draft.id);

      expect(mockNotifier.notify).toHaveBeenCalledWith('template', draft.id, 'deleted');
    });
  });
});
