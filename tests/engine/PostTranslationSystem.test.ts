import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import { PostEngine } from '../../src/main/engine/PostEngine';
import { posts, postTranslations } from '../../src/main/database/schema';

const mockPosts = new Map<string, any>();
const mockTranslations = new Map<string, any>();
const mockFiles = new Map<string, string>();
const mockExecuteArgs: Array<{ sql: string; args: any[] }> = [];

const mockDeletedTranslationIds: string[] = [];

function resetData(): void {
  mockPosts.clear();
  mockTranslations.clear();
  mockFiles.clear();
  mockExecuteArgs.length = 0;
  mockDeletedTranslationIds.length = 0;
}

function getTableRows(table: unknown): any[] {
  if (table === posts) {
    return Array.from(mockPosts.values());
  }
  if (table === postTranslations) {
    return Array.from(mockTranslations.values());
  }
  return [];
}

function extractEqValue(predicate: unknown): string | undefined {
  // Drizzle eq() creates a BinaryOperator whose queryChunks contain a Param with the value.
  const chunks = (predicate as any)?.queryChunks;
  if (!Array.isArray(chunks)) return undefined;
  for (const chunk of chunks) {
    if (chunk?.value !== undefined && typeof chunk.value === 'string') {
      return chunk.value;
    }
  }
  return undefined;
}

function createSelectChain() {
  let selectedTable: unknown;
  let filterValue: string | undefined;

  return {
    from: vi.fn().mockImplementation(function from(table: unknown) {
      selectedTable = table;
      return this;
    }),
    where: vi.fn().mockImplementation(function where(predicate: unknown) {
      filterValue = extractEqValue(predicate);
      return this;
    }),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(async () => {
      const rows = getTableRows(selectedTable);
      if (filterValue) {
        return rows.filter((row) => row.id === filterValue || row.translationFor === filterValue || row.projectId === filterValue);
      }
      return rows;
    }),
    get: vi.fn().mockImplementation(async () => {
      const rows = getTableRows(selectedTable);
      if (filterValue) {
        return rows.find((row) => row.id === filterValue || row.translationFor === filterValue || row.projectId === filterValue);
      }
      return rows[0];
    }),
  };
}

function createInsertChain(table: unknown) {
  return {
    values: vi.fn(async (value: any) => {
      const rows = Array.isArray(value) ? value : [value];
      for (const row of rows) {
        if (table === posts) {
          mockPosts.set(row.id, row);
        } else if (table === postTranslations) {
          mockTranslations.set(row.id, row);
        }
      }
    }),
  };
}

function createUpdateChain(table: unknown) {
  return {
    set: vi.fn().mockImplementation((value: Record<string, unknown>) => ({
      where: vi.fn(async (predicate: unknown) => {
        const targetMap = table === posts ? mockPosts : table === postTranslations ? mockTranslations : null;
        if (!targetMap || targetMap.size === 0) {
          return;
        }
        const targetId = extractEqValue(predicate);
        if (targetId && targetMap.has(targetId)) {
          const existing = targetMap.get(targetId);
          targetMap.set(targetId, { ...existing, ...value });
        } else {
          // Fallback: update the first entry (preserves old behaviour for edge cases)
          const [firstKey] = targetMap.keys();
          const existing = targetMap.get(firstKey);
          targetMap.set(firstKey, { ...existing, ...value });
        }
      }),
    })),
  };
}

const mockLocalDb = {
  select: vi.fn(() => createSelectChain()),
  insert: vi.fn((table: unknown) => createInsertChain(table)),
  update: vi.fn((table: unknown) => createUpdateChain(table)),
  delete: vi.fn((table: unknown) => ({
    where: vi.fn(async (predicate: unknown) => {
      const targetId = extractEqValue(predicate);
      if (targetId) {
        const targetMap = table === posts ? mockPosts : table === postTranslations ? mockTranslations : null;
        if (targetMap) {
          mockDeletedTranslationIds.push(targetId);
          targetMap.delete(targetId);
        }
      }
    }),
  })),
};

const mockLocalClient = {
  execute: vi.fn(async (query: { sql: string; args: any[] }) => {
    mockExecuteArgs.push(query);
    return { rows: [] };
  }),
};

vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => mockLocalDb),
    getLocalClient: vi.fn(() => mockLocalClient),
  })),
}));

vi.mock('fs/promises', () => ({
  access: vi.fn(async (filePath: string) => {
    if (!mockFiles.has(filePath)) {
      const error = new Error('ENOENT');
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      throw error;
    }
  }),
  mkdir: vi.fn(async () => {}),
  readFile: vi.fn(async (filePath: string) => {
    const content = mockFiles.get(filePath);
    if (content == null) {
      const error = new Error('ENOENT');
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      throw error;
    }
    return content;
  }),
  readdir: vi.fn(async (dirPath: string, options?: { withFileTypes?: boolean }) => {
    const normalizedDir = dirPath.replace(/\\/g, '/').replace(/\/$/, '');
    const childMap = new Map<string, { isDirectory: boolean }>();

    for (const filePath of mockFiles.keys()) {
      const normalizedFile = filePath.replace(/\\/g, '/');
      if (!normalizedFile.startsWith(`${normalizedDir}/`)) {
        continue;
      }

      const remainder = normalizedFile.slice(normalizedDir.length + 1);
      if (!remainder) {
        continue;
      }

      const [firstSegment, ...rest] = remainder.split('/');
      childMap.set(firstSegment, { isDirectory: rest.length > 0 });
    }

    if (!options?.withFileTypes) {
      return Array.from(childMap.keys());
    }

    return Array.from(childMap.entries()).map(([name, entry]) => ({
      name,
      isDirectory: () => entry.isDirectory,
      isFile: () => !entry.isDirectory,
    }));
  }),
  rename: vi.fn(async (from: string, to: string) => {
    const content = mockFiles.get(from);
    if (content != null) {
      mockFiles.set(to, content);
      mockFiles.delete(from);
    }
  }),
  unlink: vi.fn(async (filePath: string) => {
    mockFiles.delete(filePath);
  }),
  writeFile: vi.fn(async (filePath: string, content: string) => {
    mockFiles.set(filePath, content);
  }),
}));

vi.mock('uuid', () => {
  let counter = 1;
  return {
    v4: vi.fn(() => `uuid-${counter++}`),
  };
});

describe('Post translation system', () => {
  let engine: PostEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    resetData();
    engine = new PostEngine();
    engine.setProjectContext('project-1', '/tmp/project-1');
  });

  it('keeps canonical reads separate while exposing availableLanguages from translations', async () => {
    const source = await engine.createPost({
      title: 'Hello world',
      language: 'en',
      content: 'Canonical content',
      status: 'draft',
    });

    await engine.upsertPostTranslation(source.id, 'fr', {
      title: 'Bonjour le monde',
      excerpt: 'Resume',
      content: 'Contenu traduit',
    });

    const canonical = await engine.getPost(source.id);
    const bySlug = await engine.getPostBySlug(source.slug);
    const translation = await engine.getPostTranslation(source.id, 'fr');
    const translations = await engine.getPostTranslations(source.id);

    expect(canonical?.title).toBe('Hello world');
    expect(canonical?.availableLanguages).toEqual(['en', 'fr']);
    expect(bySlug?.id).toBe(source.id);
    expect(translation).toMatchObject({
      translationFor: source.id,
      language: 'fr',
      title: 'Bonjour le monde',
      content: 'Contenu traduit',
      status: 'draft',
    });
    expect(translations.map((item) => item.language)).toEqual(['fr']);
  });

  it('updates an existing translation instead of creating duplicates for the same language', async () => {
    const source = await engine.createPost({
      title: 'Hello world',
      language: 'en',
      content: 'Canonical content',
    });

    const first = await engine.upsertPostTranslation(source.id, 'fr', {
      title: 'Bonjour',
      content: 'Version 1',
    });
    const second = await engine.upsertPostTranslation(source.id, 'fr', {
      title: 'Salut',
      content: 'Version 2',
    });

    const translations = await engine.getPostTranslations(source.id);

    expect(second.id).toBe(first.id);
    expect(translations).toHaveLength(1);
    expect(translations[0]).toMatchObject({ title: 'Salut', content: 'Version 2' });
  });

  it('rejects translations whose language matches the canonical post language', async () => {
    const source = await engine.createPost({
      title: 'Hello world',
      language: 'de',
      content: 'Canonical content',
    });

    await expect(engine.upsertPostTranslation(source.id, 'DE', {
      title: 'Hallo Welt',
      content: 'Ungueltige Uebersetzung',
    })).rejects.toThrow('Translation language must differ from canonical post language');

    expect(await engine.getPostTranslation(source.id, 'de')).toBeNull();
    expect(await engine.getPostTranslations(source.id)).toEqual([]);
  });

  it('ignores stored translation rows whose language matches the canonical post language', async () => {
    const source = await engine.createPost({
      title: 'Hello world',
      language: 'en',
      content: 'Canonical content',
    });

    mockTranslations.set('translation-invalid', {
      id: 'translation-invalid',
      projectId: 'project-1',
      translationFor: source.id,
      language: 'en',
      title: 'Hello world duplicate',
      excerpt: null,
      content: 'Duplicate canonical content',
      status: 'draft',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      publishedAt: null,
      filePath: '',
      checksum: 'checksum-invalid',
    });

    mockTranslations.set('translation-fr', {
      id: 'translation-fr',
      projectId: 'project-1',
      translationFor: source.id,
      language: 'fr',
      title: 'Bonjour le monde',
      excerpt: null,
      content: 'Contenu traduit',
      status: 'draft',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      publishedAt: null,
      filePath: '',
      checksum: 'checksum-fr',
    });

    const canonical = await engine.getPost(source.id);
    const byCanonicalLanguage = await engine.getPostTranslation(source.id, 'en');
    const translations = await engine.getPostTranslations(source.id);

    expect(canonical?.availableLanguages).toEqual(['en', 'fr']);
    expect(byCanonicalLanguage).toBeNull();
    expect(translations.map((item) => item.language)).toEqual(['fr']);
  });

  it('skips orphan translation files whose language matches the canonical post language', async () => {
    const source = await engine.createPost({
      title: 'Hello world',
      language: 'de',
      content: 'Canonical content',
    });
    const filePath = '/tmp/project-1/posts/2024/01/hello-world.de.md';

    mockFiles.set(filePath, `---\ntranslationFor: ${source.id}\nlanguage: de\ntitle: Hallo Welt\n---\nInvalid translation`);

    const imported = await engine.importOrphanTranslationFile(filePath);

    expect(imported).toBeNull();
    expect(await engine.getPostTranslations(source.id)).toEqual([]);
  });

  it('reports invalid translation rows and filesystem files in validateTranslations', async () => {
    const source = await engine.createPost({
      title: 'Hello world',
      language: 'de',
      content: 'Canonical content',
      status: 'published',
    });

    mockTranslations.set('translation-invalid-db', {
      id: 'translation-invalid-db',
      projectId: 'project-1',
      translationFor: source.id,
      language: 'de',
      title: 'Hallo Welt',
      excerpt: null,
      content: 'Invalid db translation',
      status: 'draft',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      publishedAt: null,
      filePath: '/tmp/project-1/posts/2024/01/hello-world.de.md',
      checksum: 'checksum-invalid-db',
    });

    mockTranslations.set('translation-valid-db', {
      id: 'translation-valid-db',
      projectId: 'project-1',
      translationFor: source.id,
      language: 'fr',
      title: 'Bonjour le monde',
      excerpt: null,
      content: 'Valid translation',
      status: 'draft',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      publishedAt: null,
      filePath: '',
      checksum: 'checksum-valid-db',
    });

    mockFiles.set('/tmp/project-1/posts/2024/01/hello-world.de.md', `---\ntranslationFor: ${source.id}\nlanguage: de\ntitle: Hallo Welt\n---\nInvalid filesystem translation`);
    mockFiles.set('/tmp/project-1/posts/2024/01/hello-world.fr.md', `---\ntranslationFor: ${source.id}\nlanguage: fr\ntitle: Bonjour le monde\n---\nValid filesystem translation`);
    mockFiles.set('/tmp/project-1/posts/2024/01/orphan.it.md', '---\ntranslationFor: missing-post\nlanguage: it\ntitle: Ciao\n---\nOrphan translation');

    const report = await engine.validateTranslations();

    expect(report.checkedDatabaseRowCount).toBe(2);
    expect(report.checkedFilesystemFileCount).toBe(3);
    expect(report.invalidDatabaseRows).toEqual([
      expect.objectContaining({
        issue: 'same-language-as-canonical',
        translationId: 'translation-invalid-db',
        translationFor: source.id,
        canonicalLanguage: 'de',
        translationLanguage: 'de',
      }),
    ]);
    expect(report.invalidFilesystemFiles).toEqual([
      expect.objectContaining({
        issue: 'same-language-as-canonical',
        translationFor: source.id,
        canonicalLanguage: 'de',
        translationLanguage: 'de',
        filePath: '/tmp/project-1/posts/2024/01/hello-world.de.md',
      }),
      expect.objectContaining({
        issue: 'missing-source-post',
        translationFor: 'missing-post',
        translationLanguage: 'it',
        filePath: '/tmp/project-1/posts/2024/01/orphan.it.md',
      }),
    ]);
  });

    it('validates translation files by frontmatter even when the filename does not look like a translation', async () => {
      const source = await engine.createPost({
        title: 'Hallo Welt',
        language: 'de',
        content: 'Kanonischer Inhalt',
      });

      mockFiles.set('/tmp/project-1/posts/2024/01/hallo-welt-copy.md', `---\ntranslationFor: ${source.id}\nlanguage: de\ntitle: Hallo Welt Kopie\n---\nInvalid filesystem translation`);

      const report = await engine.validateTranslations();

      expect(report.checkedFilesystemFileCount).toBe(1);
      expect(report.invalidFilesystemFiles).toEqual([
        expect.objectContaining({
          issue: 'same-language-as-canonical',
          translationFor: source.id,
          canonicalLanguage: 'de',
          translationLanguage: 'de',
          filePath: '/tmp/project-1/posts/2024/01/hallo-welt-copy.md',
        }),
      ]);
    });

  it('moves the source post back to draft when translation text changes', async () => {
    const source = await engine.createPost({
      title: 'Hello world',
      language: 'en',
      content: 'Canonical content',
    });

    await engine.publishPost(source.id);

    await engine.upsertPostTranslation(source.id, 'fr', {
      title: 'Bonjour',
      content: 'Version 1',
    });

    const updatedSource = await engine.getPost(source.id);
    const translation = await engine.getPostTranslation(source.id, 'fr');

    expect(updatedSource?.status).toBe('draft');
    expect(updatedSource?.content.trim()).toBe('Canonical content');
    expect(translation?.status).toBe('draft');
    expect(Array.from(mockFiles.keys()).some((filePath) => filePath.endsWith('/hello-world.fr.md'))).toBe(false);
  });

  it('updates FTS index when drafting the source post during translation upsert', async () => {
    const source = await engine.createPost({
      title: 'Hello world',
      language: 'en',
      content: 'Canonical content',
    });

    await engine.publishPost(source.id);

    // Clear args so we only see what upsertPostTranslation does
    mockExecuteArgs.length = 0;

    await engine.upsertPostTranslation(source.id, 'fr', {
      title: 'Bonjour',
      content: 'Contenu traduit',
    });

    // sourceShouldDraft fires → must refresh FTS for the source post
    const ftsDeleteForSource = mockExecuteArgs.find(
      (q) => q.sql.includes('DELETE FROM posts_fts') && q.args[0] === source.id,
    );
    const ftsInsertForSource = mockExecuteArgs.find(
      (q) => q.sql.includes('INSERT INTO posts_fts') && q.args[0] === source.id,
    );
    expect(ftsDeleteForSource).toBeDefined();
    expect(ftsInsertForSource).toBeDefined();
  });

  it('does not draft the source when translation is auto-published', async () => {
    const source = await engine.createPost({
      title: 'Hello world',
      language: 'en',
      content: 'Canonical content',
    });

    await engine.publishPost(source.id);

    await engine.upsertPostTranslation(source.id, 'fr', {
      title: 'Bonjour',
      content: 'Contenu traduit',
      status: 'published',
    });

    const updatedSource = await engine.getPost(source.id);
    const translation = await engine.getPostTranslation(source.id, 'fr');

    expect(updatedSource?.status).toBe('published');
    expect(translation?.status).toBe('published');
    expect(translation?.publishedAt).toBeDefined();
  });

  it('publishes canonical and available translations together when the post is published', async () => {
    const source = await engine.createPost({
      title: 'Hello world',
      language: 'en',
      content: 'Canonical content',
    });

    await engine.upsertPostTranslation(source.id, 'fr', {
      title: 'Bonjour le monde',
      excerpt: 'Resume',
      content: 'Contenu traduit',
    });

    const publishedPost = await engine.publishPost(source.id);
    const publishedTranslation = await engine.getPostTranslation(source.id, 'fr');
    const frenchPosts = await engine.getPostsFiltered({ language: 'fr' });
    const missingSpanish = await engine.getPostsFiltered({ missingTranslationLanguage: 'es' });

    expect(publishedPost?.status).toBe('published');
    expect(publishedTranslation?.status).toBe('published');
    expect(publishedTranslation?.filePath.endsWith('/hello-world.fr.md')).toBe(true);
    expect(Array.from(mockFiles.keys()).some((filePath) => filePath.endsWith('/hello-world.fr.md'))).toBe(true);
    expect(frenchPosts.map((post) => post.id)).toContain(source.id);
    expect(missingSpanish.map((post) => post.id)).toContain(source.id);
  });

  describe('mainLanguage fallback for posts without explicit language', () => {
    it('rejects translations matching mainLanguage when the post has no explicit language', async () => {
      engine.setMainLanguage('de');
      const source = await engine.createPost({
        title: 'Hello world',
        content: 'Canonical content',
      });

      await expect(engine.upsertPostTranslation(source.id, 'de', {
        title: 'Hallo Welt',
        content: 'Deutsche Uebersetzung',
      })).rejects.toThrow('Translation language must differ from canonical post language');
    });

    it('allows translations in a different language when mainLanguage is set and post has no explicit language', async () => {
      engine.setMainLanguage('de');
      const source = await engine.createPost({
        title: 'Hello world',
        content: 'Canonical content',
      });

      const translation = await engine.upsertPostTranslation(source.id, 'en', {
        title: 'Hello world',
        content: 'English translation',
      });

      expect(translation.language).toBe('en');
    });

    it('reports same-language-as-canonical for DB rows matching mainLanguage fallback', async () => {
      engine.setMainLanguage('de');
      const source = await engine.createPost({
        title: 'Hello world',
        content: 'Canonical content',
        status: 'published',
      });

      mockTranslations.set('translation-de', {
        id: 'translation-de',
        projectId: 'project-1',
        translationFor: source.id,
        language: 'de',
        title: 'Hallo Welt',
        excerpt: null,
        content: 'Deutsche Uebersetzung',
        status: 'draft',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        publishedAt: null,
        filePath: '',
        checksum: 'checksum-de',
      });

      const report = await engine.validateTranslations();

      expect(report.invalidDatabaseRows).toEqual([
        expect.objectContaining({
          issue: 'same-language-as-canonical',
          translationFor: source.id,
          canonicalLanguage: 'de',
          translationLanguage: 'de',
        }),
      ]);
    });

    it('reports same-language-as-canonical for filesystem files matching mainLanguage fallback', async () => {
      engine.setMainLanguage('de');
      const source = await engine.createPost({
        title: 'Hello world',
        content: 'Canonical content',
        status: 'published',
      });

      mockFiles.set(`/tmp/project-1/posts/2024/01/hello-world.de.md`, `---\ntranslationFor: ${source.id}\nlanguage: de\ntitle: Hallo Welt\n---\nDeutsche Uebersetzung`);

      const report = await engine.validateTranslations();

      expect(report.invalidFilesystemFiles).toEqual([
        expect.objectContaining({
          issue: 'same-language-as-canonical',
          translationFor: source.id,
          canonicalLanguage: 'de',
          translationLanguage: 'de',
        }),
      ]);
    });

    it('skips orphan translation files matching mainLanguage fallback', async () => {
      engine.setMainLanguage('de');
      const source = await engine.createPost({
        title: 'Hello world',
        content: 'Canonical content',
      });
      const filePath = '/tmp/project-1/posts/2024/01/hello-world.de.md';
      mockFiles.set(filePath, `---\ntranslationFor: ${source.id}\nlanguage: de\ntitle: Hallo Welt\n---\nDeutsche Uebersetzung`);

      const imported = await engine.importOrphanTranslationFile(filePath);

      expect(imported).toBeNull();
    });

    it('returns null for getPostTranslation when language matches mainLanguage fallback', async () => {
      engine.setMainLanguage('de');
      const source = await engine.createPost({
        title: 'Hello world',
        content: 'Canonical content',
      });

      mockTranslations.set('translation-de', {
        id: 'translation-de',
        projectId: 'project-1',
        translationFor: source.id,
        language: 'de',
        title: 'Hallo Welt',
        excerpt: null,
        content: 'Deutsche Uebersetzung',
        status: 'draft',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        publishedAt: null,
        filePath: '',
        checksum: 'checksum-de',
      });

      expect(await engine.getPostTranslation(source.id, 'de')).toBeNull();
    });

    it('filters out mainLanguage-matching rows from getPostTranslations', async () => {
      engine.setMainLanguage('de');
      const source = await engine.createPost({
        title: 'Hello world',
        content: 'Canonical content',
      });

      mockTranslations.set('translation-de', {
        id: 'translation-de',
        projectId: 'project-1',
        translationFor: source.id,
        language: 'de',
        title: 'Hallo Welt',
        excerpt: null,
        content: 'Deutsche Uebersetzung',
        status: 'draft',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        publishedAt: null,
        filePath: '',
        checksum: 'checksum-de',
      });

      mockTranslations.set('translation-en', {
        id: 'translation-en',
        projectId: 'project-1',
        translationFor: source.id,
        language: 'en',
        title: 'Hello world EN',
        excerpt: null,
        content: 'English translation',
        status: 'draft',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        publishedAt: null,
        filePath: '',
        checksum: 'checksum-en',
      });

      const translations = await engine.getPostTranslations(source.id);
      expect(translations.map((t) => t.language)).toEqual(['en']);
    });

    it('explicit post language takes precedence over mainLanguage', async () => {
      engine.setMainLanguage('de');
      const source = await engine.createPost({
        title: 'Hello world',
        language: 'en',
        content: 'Canonical content',
      });

      // Should reject 'en' because the post explicitly has language 'en'
      await expect(engine.upsertPostTranslation(source.id, 'en', {
        title: 'Hello world',
        content: 'English duplicate',
      })).rejects.toThrow('Translation language must differ from canonical post language');

      // Should allow 'de' because the post is explicitly English, not German
      const translation = await engine.upsertPostTranslation(source.id, 'de', {
        title: 'Hallo Welt',
        content: 'Deutsche Uebersetzung',
      });
      expect(translation.language).toBe('de');
    });
  });

  describe('fixInvalidTranslations', () => {
    it('deletes invalid DB translation rows by translationId', async () => {
      const report = {
        checkedDatabaseRowCount: 2,
        checkedFilesystemFileCount: 0,
        invalidDatabaseRows: [
          {
            issue: 'same-language-as-canonical' as const,
            translationId: 'translation-bad-1',
            translationFor: 'post-1',
            canonicalLanguage: 'de',
            translationLanguage: 'de',
            title: 'Hallo Welt',
          },
          {
            issue: 'missing-source-post' as const,
            translationId: 'translation-bad-2',
            translationFor: 'missing-post',
            translationLanguage: 'en',
            title: 'Orphan',
          },
        ],
        invalidFilesystemFiles: [],
      };

      const result = await engine.fixInvalidTranslations(report);

      expect(result.deletedDatabaseRows).toBe(2);
      expect(result.deletedFiles).toBe(0);
      expect(mockLocalDb.delete).toHaveBeenCalledTimes(2);
    });

    it('deletes invalid translation files from disk', async () => {
      const filePath1 = '/tmp/project-1/posts/2024/01/hello.de.md';
      const filePath2 = '/tmp/project-1/posts/2024/01/orphan.it.md';
      mockFiles.set(filePath1, 'content1');
      mockFiles.set(filePath2, 'content2');

      const report = {
        checkedDatabaseRowCount: 0,
        checkedFilesystemFileCount: 2,
        invalidDatabaseRows: [],
        invalidFilesystemFiles: [
          {
            issue: 'same-language-as-canonical' as const,
            translationFor: 'post-1',
            canonicalLanguage: 'de',
            translationLanguage: 'de',
            title: 'Hallo Welt',
            filePath: filePath1,
          },
          {
            issue: 'missing-source-post' as const,
            translationFor: 'missing-post',
            translationLanguage: 'it',
            title: 'Orphan',
            filePath: filePath2,
          },
        ],
      };

      const result = await engine.fixInvalidTranslations(report);

      expect(result.deletedDatabaseRows).toBe(0);
      expect(result.deletedFiles).toBe(2);
      expect(fs.unlink).toHaveBeenCalledWith(filePath1);
      expect(fs.unlink).toHaveBeenCalledWith(filePath2);
    });

    it('handles mixed DB rows and filesystem files', async () => {
      const filePath = '/tmp/project-1/posts/2024/01/hello.de.md';
      mockFiles.set(filePath, 'content');

      const report = {
        checkedDatabaseRowCount: 1,
        checkedFilesystemFileCount: 1,
        invalidDatabaseRows: [
          {
            issue: 'same-language-as-canonical' as const,
            translationId: 'translation-bad-1',
            translationFor: 'post-1',
            canonicalLanguage: 'de',
            translationLanguage: 'de',
            title: 'Hallo Welt',
            filePath,
          },
        ],
        invalidFilesystemFiles: [
          {
            issue: 'same-language-as-canonical' as const,
            translationFor: 'post-1',
            canonicalLanguage: 'de',
            translationLanguage: 'de',
            title: 'Hallo Welt',
            filePath,
          },
        ],
      };

      const result = await engine.fixInvalidTranslations(report);

      expect(result.deletedDatabaseRows).toBe(1);
      expect(result.deletedFiles).toBe(1);
    });

    it('skips DB rows without a translationId', async () => {
      const report = {
        checkedDatabaseRowCount: 1,
        checkedFilesystemFileCount: 0,
        invalidDatabaseRows: [
          {
            issue: 'missing-source-post' as const,
            translationFor: 'missing-post',
            translationLanguage: 'en',
            title: 'No ID',
          },
        ],
        invalidFilesystemFiles: [],
      };

      const result = await engine.fixInvalidTranslations(report);

      expect(result.deletedDatabaseRows).toBe(0);
      expect(mockLocalDb.delete).not.toHaveBeenCalled();
    });

    it('skips filesystem entries without a filePath', async () => {
      const report = {
        checkedDatabaseRowCount: 0,
        checkedFilesystemFileCount: 1,
        invalidDatabaseRows: [],
        invalidFilesystemFiles: [
          {
            issue: 'missing-source-post' as const,
            translationFor: 'missing-post',
            translationLanguage: 'en',
            title: 'No path',
          },
        ],
      };

      const result = await engine.fixInvalidTranslations(report);

      expect(result.deletedFiles).toBe(0);
      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it('continues when a file delete fails', async () => {
      const filePath1 = '/tmp/project-1/posts/2024/01/missing.de.md';
      const filePath2 = '/tmp/project-1/posts/2024/01/exists.fr.md';
      mockFiles.set(filePath2, 'content');

      // Make unlink throw for filePath1 to simulate a real fs error
      const originalUnlink = (fs.unlink as ReturnType<typeof vi.fn>).getMockImplementation()!;
      (fs.unlink as ReturnType<typeof vi.fn>).mockImplementation(async (p: string) => {
        if (p === filePath1) {
          throw new Error('ENOENT');
        }
        return originalUnlink(p);
      });

      const report = {
        checkedDatabaseRowCount: 0,
        checkedFilesystemFileCount: 2,
        invalidDatabaseRows: [],
        invalidFilesystemFiles: [
          {
            issue: 'same-language-as-canonical' as const,
            translationFor: 'post-1',
            canonicalLanguage: 'de',
            translationLanguage: 'de',
            filePath: filePath1,
          },
          {
            issue: 'same-language-as-canonical' as const,
            translationFor: 'post-1',
            canonicalLanguage: 'de',
            translationLanguage: 'de',
            filePath: filePath2,
          },
        ],
      };

      const result = await engine.fixInvalidTranslations(report);

      // filePath1 failed (ENOENT), filePath2 succeeded
      expect(result.deletedFiles).toBe(1);
      expect(fs.unlink).toHaveBeenCalledTimes(2);
    });

    it('deletes the correct translation IDs from the database', async () => {
      mockTranslations.set('translation-bad-1', {
        id: 'translation-bad-1',
        projectId: 'project-1',
        translationFor: 'post-1',
        language: 'de',
      });

      const report = {
        checkedDatabaseRowCount: 1,
        checkedFilesystemFileCount: 0,
        invalidDatabaseRows: [
          {
            issue: 'same-language-as-canonical' as const,
            translationId: 'translation-bad-1',
            translationFor: 'post-1',
            canonicalLanguage: 'de',
            translationLanguage: 'de',
            title: 'Hallo Welt',
          },
        ],
        invalidFilesystemFiles: [],
      };

      await engine.fixInvalidTranslations(report);

      expect(mockDeletedTranslationIds).toContain('translation-bad-1');
      expect(mockTranslations.has('translation-bad-1')).toBe(false);
    });
  });

  it('throws when upserting a translation for a non-existent source post', async () => {
    await expect(engine.upsertPostTranslation('non-existent-id', 'fr', {
      title: 'Bonjour',
      content: 'Contenu',
    })).rejects.toThrow('Source post not found');
  });

  it('supports multiple translations on the same post', async () => {
    const source = await engine.createPost({
      title: 'Hello world',
      language: 'en',
      content: 'Canonical content',
    });

    const fr = await engine.upsertPostTranslation(source.id, 'fr', {
      title: 'Bonjour le monde',
      content: 'Contenu traduit',
    });

    const de = await engine.upsertPostTranslation(source.id, 'de', {
      title: 'Hallo Welt',
      content: 'Ubersetzter Inhalt',
    });

    expect(fr.language).toBe('fr');
    expect(de.language).toBe('de');
    expect(fr.id).not.toBe(de.id);

    const translations = await engine.getPostTranslations(source.id);
    expect(translations.map((t) => t.language).sort()).toEqual(['de', 'fr']);

    const canonical = await engine.getPost(source.id);
    expect(canonical?.availableLanguages?.sort()).toEqual(['de', 'en', 'fr']);
  });
});