import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import { PostEngine } from '../../src/main/engine/PostEngine';
import { posts, postTranslations } from '../../src/main/database/schema';

const mockPosts = new Map<string, any>();
const mockTranslations = new Map<string, any>();
const mockFiles = new Map<string, string>();
const mockExecuteArgs: Array<{ sql: string; args: any[] }> = [];

function resetData(): void {
  mockPosts.clear();
  mockTranslations.clear();
  mockFiles.clear();
  mockExecuteArgs.length = 0;
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

function createSelectChain() {
  let selectedTable: unknown;

  return {
    from: vi.fn().mockImplementation(function from(table: unknown) {
      selectedTable = table;
      return this;
    }),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(async () => getTableRows(selectedTable)),
    get: vi.fn().mockImplementation(async () => getTableRows(selectedTable)[0]),
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
      where: vi.fn(async () => {
        const targetMap = table === posts ? mockPosts : table === postTranslations ? mockTranslations : null;
        if (!targetMap || targetMap.size === 0) {
          return;
        }
        const [firstKey] = targetMap.keys();
        const existing = targetMap.get(firstKey);
        targetMap.set(firstKey, { ...existing, ...value });
      }),
    })),
  };
}

const mockLocalDb = {
  select: vi.fn(() => createSelectChain()),
  insert: vi.fn((table: unknown) => createInsertChain(table)),
  update: vi.fn((table: unknown) => createUpdateChain(table)),
  delete: vi.fn(() => ({ where: vi.fn(async () => {}) })),
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

  it('publishes translations to source-slug.language.md files and filters posts by language availability', async () => {
    const source = await engine.createPost({
      title: 'Hello world',
      language: 'en',
      content: 'Canonical content',
    });

    await engine.publishPost(source.id);
    await engine.upsertPostTranslation(source.id, 'fr', {
      title: 'Bonjour le monde',
      excerpt: 'Resume',
      content: 'Contenu traduit',
    });

    const publishedTranslation = await engine.publishPostTranslation(source.id, 'fr');
    const frenchPosts = await engine.getPostsFiltered({ language: 'fr' });
    const missingSpanish = await engine.getPostsFiltered({ missingTranslationLanguage: 'es' });

    expect(publishedTranslation?.status).toBe('published');
    expect(publishedTranslation?.filePath.endsWith('/hello-world.fr.md')).toBe(true);
    expect(Array.from(mockFiles.keys()).some((filePath) => filePath.endsWith('/hello-world.fr.md'))).toBe(true);
    expect(frenchPosts.map((post) => post.id)).toContain(source.id);
    expect(missingSpanish.map((post) => post.id)).toContain(source.id);
  });
});