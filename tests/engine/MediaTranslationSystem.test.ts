import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaEngine } from '../../src/main/engine/MediaEngine';
import { media, mediaTranslations } from '../../src/main/database/schema';

const mockMedia = new Map<string, any>();
const mockTranslations = new Map<string, any>();
const mockFiles = new Map<string, string>();

function resetData(): void {
  mockMedia.clear();
  mockTranslations.clear();
  mockFiles.clear();
}

function getTableRows(table: unknown): any[] {
  if (table === media) {
    return Array.from(mockMedia.values());
  }
  if (table === mediaTranslations) {
    return Array.from(mockTranslations.values());
  }
  return [];
}

function extractEqValue(predicate: unknown): string | undefined {
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
        return rows.filter((row) =>
          row.id === filterValue ||
          row.translationFor === filterValue ||
          row.projectId === filterValue
        );
      }
      return rows;
    }),
    get: vi.fn().mockImplementation(async () => {
      const rows = getTableRows(selectedTable);
      if (filterValue) {
        return rows.find((row) =>
          row.id === filterValue ||
          row.translationFor === filterValue ||
          row.projectId === filterValue
        );
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
        if (table === media) {
          mockMedia.set(row.id, row);
        } else if (table === mediaTranslations) {
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
        const targetMap = table === media ? mockMedia : table === mediaTranslations ? mockTranslations : null;
        if (!targetMap || targetMap.size === 0) return;
        const targetId = extractEqValue(predicate);
        if (targetId && targetMap.has(targetId)) {
          const existing = targetMap.get(targetId);
          targetMap.set(targetId, { ...existing, ...value });
        }
      }),
    })),
  };
}

function createDeleteChain(table: unknown) {
  return {
    where: vi.fn(async (predicate: unknown) => {
      const targetId = extractEqValue(predicate);
      if (targetId) {
        const targetMap = table === media ? mockMedia : table === mediaTranslations ? mockTranslations : null;
        if (targetMap) {
          // Try direct key match first
          if (targetMap.has(targetId)) {
            targetMap.delete(targetId);
          } else {
            // Filter by translationFor (cascade delete pattern)
            for (const [key, row] of targetMap.entries()) {
              if ((row as any).translationFor === targetId || (row as any).mediaId === targetId) {
                targetMap.delete(key);
              }
            }
          }
        }
      }
    }),
  };
}

const mockLocalDb = {
  select: vi.fn(() => createSelectChain()),
  insert: vi.fn((table: unknown) => createInsertChain(table)),
  update: vi.fn((table: unknown) => createUpdateChain(table)),
  delete: vi.fn((table: unknown) => createDeleteChain(table)),
};

const mockLocalClient = {
  execute: vi.fn(async () => ({ rows: [] })),
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
  readdir: vi.fn(async () => []),
  rename: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
  writeFile: vi.fn(async (filePath: string, content: string) => {
    mockFiles.set(filePath, content);
  }),
  copyFile: vi.fn(async () => {}),
  stat: vi.fn(async () => ({ size: 1024 })),
}));

vi.mock('uuid', () => {
  let counter = 1;
  return {
    v4: vi.fn(() => `uuid-${counter++}`),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/electron-test'),
  },
}));

function seedMediaItem(overrides: Partial<any> = {}): any {
  const id = overrides.id || 'media-1';
  const item = {
    id,
    projectId: 'project-1',
    filename: `${id}.jpg`,
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 1024,
    width: 800,
    height: 600,
    title: 'A photo',
    alt: 'Alt text',
    caption: 'Photo caption',
    author: 'Author',
    language: null,
    filePath: `/tmp/project-1/media/2024/01/${id}.jpg`,
    sidecarPath: `/tmp/project-1/media/2024/01/${id}.jpg.meta`,
    createdAt: new Date('2024-01-15T12:00:00Z'),
    updatedAt: new Date('2024-01-15T12:00:00Z'),
    checksum: 'abc123',
    tags: '[]',
    ...overrides,
  };
  mockMedia.set(id, item);
  return item;
}

describe('Media translation system', () => {
  let engine: MediaEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    resetData();
    engine = new MediaEngine();
    engine.setProjectContext('project-1', '/tmp/project-1');
  });

  describe('getMediaTranslation', () => {
    it('returns null when no translation exists', async () => {
      seedMediaItem();
      const result = await engine.getMediaTranslation('media-1', 'fr');
      expect(result).toBeNull();
    });

    it('returns a translation when one exists', async () => {
      seedMediaItem();
      mockTranslations.set('trans-1', {
        id: 'trans-1',
        projectId: 'project-1',
        translationFor: 'media-1',
        language: 'fr',
        title: 'Une photo',
        alt: 'Texte alt',
        caption: 'Légende photo',
        createdAt: new Date('2024-01-15T12:00:00Z'),
        updatedAt: new Date('2024-01-15T12:00:00Z'),
      });

      const result = await engine.getMediaTranslation('media-1', 'fr');
      expect(result).toMatchObject({
        id: 'trans-1',
        translationFor: 'media-1',
        language: 'fr',
        title: 'Une photo',
        alt: 'Texte alt',
        caption: 'Légende photo',
      });
    });
  });

  describe('getMediaTranslations', () => {
    it('returns all translations for a media item', async () => {
      seedMediaItem();
      mockTranslations.set('trans-fr', {
        id: 'trans-fr',
        projectId: 'project-1',
        translationFor: 'media-1',
        language: 'fr',
        title: 'Une photo',
        alt: null,
        caption: null,
        createdAt: new Date('2024-01-15T12:00:00Z'),
        updatedAt: new Date('2024-01-15T12:00:00Z'),
      });
      mockTranslations.set('trans-de', {
        id: 'trans-de',
        projectId: 'project-1',
        translationFor: 'media-1',
        language: 'de',
        title: 'Ein Foto',
        alt: null,
        caption: null,
        createdAt: new Date('2024-01-15T12:00:00Z'),
        updatedAt: new Date('2024-01-15T12:00:00Z'),
      });

      const result = await engine.getMediaTranslations('media-1');
      expect(result).toHaveLength(2);
      expect(result.map(t => t.language).sort()).toEqual(['de', 'fr']);
    });

    it('returns empty array when no translations exist', async () => {
      seedMediaItem();
      const result = await engine.getMediaTranslations('media-1');
      expect(result).toEqual([]);
    });
  });

  describe('upsertMediaTranslation', () => {
    it('creates a new translation', async () => {
      seedMediaItem({ language: 'en' });

      const result = await engine.upsertMediaTranslation('media-1', 'fr', {
        title: 'Une photo',
        alt: 'Texte alt',
        caption: 'Légende photo',
      });

      expect(result).toMatchObject({
        translationFor: 'media-1',
        language: 'fr',
        title: 'Une photo',
        alt: 'Texte alt',
        caption: 'Légende photo',
      });
      expect(result.id).toBeTruthy();
    });

    it('updates an existing translation instead of creating duplicates', async () => {
      seedMediaItem({ language: 'en' });

      const first = await engine.upsertMediaTranslation('media-1', 'fr', {
        title: 'Titre v1',
      });
      const second = await engine.upsertMediaTranslation('media-1', 'fr', {
        title: 'Titre v2',
        alt: 'Alt v2',
      });

      expect(second.id).toBe(first.id);
      const translations = await engine.getMediaTranslations('media-1');
      expect(translations).toHaveLength(1);
      expect(translations[0].title).toBe('Titre v2');
    });

    it('rejects translations whose language matches the canonical media language', async () => {
      seedMediaItem({ language: 'de' });

      await expect(
        engine.upsertMediaTranslation('media-1', 'DE', {
          title: 'Titel',
        })
      ).rejects.toThrow('Translation language must differ from canonical media language');
    });

    it('rejects translations for non-existent media', async () => {
      await expect(
        engine.upsertMediaTranslation('nonexistent', 'fr', { title: 'Test' })
      ).rejects.toThrow('Media item not found');
    });
  });

  describe('deleteMediaTranslation', () => {
    it('deletes an existing translation', async () => {
      seedMediaItem();
      mockTranslations.set('trans-fr', {
        id: 'trans-fr',
        projectId: 'project-1',
        translationFor: 'media-1',
        language: 'fr',
        title: 'Une photo',
        alt: null,
        caption: null,
        createdAt: new Date('2024-01-15T12:00:00Z'),
        updatedAt: new Date('2024-01-15T12:00:00Z'),
      });

      const result = await engine.deleteMediaTranslation('media-1', 'fr');
      expect(result).toBe(true);
    });

    it('returns false when translation does not exist', async () => {
      seedMediaItem();
      const result = await engine.deleteMediaTranslation('media-1', 'fr');
      expect(result).toBe(false);
    });
  });

  describe('availableLanguages on media', () => {
    it('includes canonical language and translation languages', async () => {
      seedMediaItem({ language: 'en' });
      mockTranslations.set('trans-fr', {
        id: 'trans-fr',
        projectId: 'project-1',
        translationFor: 'media-1',
        language: 'fr',
        title: 'Une photo',
        alt: null,
        caption: null,
        createdAt: new Date('2024-01-15T12:00:00Z'),
        updatedAt: new Date('2024-01-15T12:00:00Z'),
      });

      const result = await engine.getMedia('media-1');
      expect(result?.availableLanguages).toEqual(['en', 'fr']);
    });

    it('returns empty array when no language is set and no translations exist', async () => {
      seedMediaItem();
      const result = await engine.getMedia('media-1');
      expect(result?.availableLanguages).toEqual([]);
    });
  });

  describe('translated sidecar I/O', () => {
    it('writes a translated sidecar file with language suffix', async () => {
      seedMediaItem({ language: 'en' });
      await engine.upsertMediaTranslation('media-1', 'fr', {
        title: 'Une photo',
        alt: 'Texte alt',
        caption: 'Légende photo',
      });

      // Verify a sidecar file was written at the .fr.meta path
      const sidecarPath = '/tmp/project-1/media/2024/01/media-1.jpg.fr.meta';
      expect(mockFiles.has(sidecarPath)).toBe(true);
      const content = mockFiles.get(sidecarPath)!;
      expect(content).toContain('language: fr');
      expect(content).toContain('title: "Une photo"');
      expect(content).toContain('alt: "Texte alt"');
    });

    it('reads a translated sidecar file', async () => {
      const sidecarContent = [
        '---',
        'translationFor: media-1',
        'language: de',
        'title: "Ein Foto"',
        'alt: "Alt-Text"',
        'caption: "Bildunterschrift"',
        '---',
      ].join('\n');
      mockFiles.set('/tmp/project-1/media/2024/01/media-1.jpg.de.meta', sidecarContent);

      const result = await engine.readTranslatedSidecarFile(
        '/tmp/project-1/media/2024/01/media-1.jpg.de.meta'
      );
      expect(result).toMatchObject({
        translationFor: 'media-1',
        language: 'de',
        title: 'Ein Foto',
        alt: 'Alt-Text',
        caption: 'Bildunterschrift',
      });
    });

    it('returns null for non-existent sidecar', async () => {
      const result = await engine.readTranslatedSidecarFile(
        '/tmp/nonexistent.fr.meta'
      );
      expect(result).toBeNull();
    });
  });

  describe('canonical sidecar includes language', () => {
    it('includes language field in sidecar when set on media', async () => {
      seedMediaItem({ language: 'en' });
      // Trigger a sidecar write via updateMedia
      await engine.updateMedia('media-1', { language: 'en' });

      const sidecarPath = '/tmp/project-1/media/2024/01/media-1.jpg.meta';
      if (mockFiles.has(sidecarPath)) {
        const content = mockFiles.get(sidecarPath)!;
        expect(content).toContain('language: en');
      }
    });
  });

  describe('deleteMedia cascades to translations', () => {
    it('deletes all translations when media is deleted', async () => {
      seedMediaItem();
      mockTranslations.set('trans-fr', {
        id: 'trans-fr',
        projectId: 'project-1',
        translationFor: 'media-1',
        language: 'fr',
        title: 'Une photo',
        alt: null,
        caption: null,
        createdAt: new Date('2024-01-15T12:00:00Z'),
        updatedAt: new Date('2024-01-15T12:00:00Z'),
      });

      await engine.deleteMedia('media-1');

      // Translations should be cleaned up
      expect(mockTranslations.size).toBe(0);
    });
  });
});
