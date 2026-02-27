import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemplateEngine } from '../../src/main/engine/TemplateEngine';

const mockTemplates = new Map<string, any>();
const mockFiles = new Map<string, string>();

function createSelectChain() {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => Promise.resolve(Array.from(mockTemplates.values()))),
    get: vi.fn().mockImplementation(() => Promise.resolve(undefined)),
  };
}

function createDrizzleMock() {
  return {
    select: vi.fn(() => createSelectChain()),
    insert: vi.fn(() => ({
      values: vi.fn((data: any) => {
        mockTemplates.set(data.id, data);
        return Promise.resolve();
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((updates: any) => ({
        where: vi.fn(async () => {
          for (const [templateId, existing] of mockTemplates.entries()) {
            mockTemplates.set(templateId, { ...existing, ...updates });
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
    mockFiles.clear();
    (globalThis as any).__mockTemplateFiles = mockFiles;
    vi.mocked(mockLocalDb.select).mockImplementation(() => createSelectChain());

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

    const deleted = await templateEngine.deleteTemplate(created.id);

    expect(deleted).toBe(true);
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
});
