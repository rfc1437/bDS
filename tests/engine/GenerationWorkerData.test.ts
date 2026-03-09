import { describe, expect, it } from 'vitest';
import {
  serializePostData,
  deserializePostData,
  serializeMediaItem,
  deserializeMediaItem,
  serializeBlogGenerationOptions,
  serializePostMap,
  deserializePostMap,
  serializeDateMap,
  deserializeDateMap,
} from '../../src/main/engine/GenerationWorkerData';
import type { PostData } from '../../src/main/engine/PostEngine';

function makePost(overrides: Partial<PostData> & { id: string; slug: string }): PostData {
  return {
    projectId: 'proj-1',
    title: overrides.slug,
    excerpt: 'short',
    content: `body of ${overrides.slug}`,
    status: 'published',
    createdAt: new Date('2025-06-15T12:00:00Z'),
    updatedAt: new Date('2025-06-15T14:00:00Z'),
    tags: ['a', 'b'],
    categories: ['article'],
    availableLanguages: ['en'],
    ...overrides,
  };
}

describe('PostData serialization', () => {
  it('round-trips a basic post', () => {
    const post = makePost({ id: '1', slug: 'hello' });
    const serialized = serializePostData(post);
    const deserialized = deserializePostData(serialized);

    expect(deserialized.id).toBe('1');
    expect(deserialized.slug).toBe('hello');
    expect(deserialized.createdAt).toBeInstanceOf(Date);
    expect(deserialized.createdAt.toISOString()).toBe('2025-06-15T12:00:00.000Z');
    expect(deserialized.updatedAt).toBeInstanceOf(Date);
    expect(deserialized.tags).toEqual(['a', 'b']);
    expect(deserialized.categories).toEqual(['article']);
    expect(deserialized.content).toBe('body of hello');
  });

  it('round-trips publishedAt', () => {
    const post = makePost({ id: '2', slug: 'pub', publishedAt: new Date('2025-07-01T00:00:00Z') });
    const result = deserializePostData(serializePostData(post));
    expect(result.publishedAt).toBeInstanceOf(Date);
    expect(result.publishedAt?.toISOString()).toBe('2025-07-01T00:00:00.000Z');
  });

  it('round-trips undefined publishedAt', () => {
    const post = makePost({ id: '3', slug: 'nopub' });
    const result = deserializePostData(serializePostData(post));
    expect(result.publishedAt).toBeUndefined();
  });

  it('preserves translation variant fields', () => {
    const post = makePost({ id: '4', slug: 'hello.fr' });
    (post as any).translationSourceSlug = 'hello';
    (post as any).translationCanonicalLanguage = 'en';
    (post as any).translationFilePath = '/data/translations/hello.fr.md';

    const result = deserializePostData(serializePostData(post));
    expect((result as any).translationSourceSlug).toBe('hello');
    expect((result as any).translationCanonicalLanguage).toBe('en');
    expect((result as any).translationFilePath).toBe('/data/translations/hello.fr.md');
  });

  it('handles post with Date already as string (defensive)', () => {
    const post = makePost({ id: '5', slug: 'strdate' });
    (post as any).createdAt = '2025-01-01T00:00:00.000Z';
    const serialized = serializePostData(post);
    expect(serialized.createdAt).toBe('2025-01-01T00:00:00.000Z');

    const deserialized = deserializePostData(serialized);
    expect(deserialized.createdAt).toBeInstanceOf(Date);
  });
});

describe('MediaItem serialization', () => {
  it('round-trips a media item with all fields', () => {
    const media = {
      id: 'm1',
      filename: 'photo.webp',
      originalName: 'My Photo.webp',
      mimeType: 'image/webp',
      size: 54321,
      width: 1920,
      height: 1080,
      title: 'Sunset',
      alt: 'A beautiful sunset',
      caption: 'Taken at the beach',
      author: 'Bob',
      language: 'en',
      createdAt: new Date('2025-03-01T10:00:00Z'),
      updatedAt: new Date('2025-03-02T10:00:00Z'),
      tags: ['nature', 'sunset'],
      linkedPostIds: ['p1', 'p2'],
      availableLanguages: ['en', 'de'],
    };
    const serialized = serializeMediaItem(media);
    expect(serialized.createdAt).toBe('2025-03-01T10:00:00.000Z');
    expect(serialized.updatedAt).toBe('2025-03-02T10:00:00.000Z');
    expect(serialized.mimeType).toBe('image/webp');
    expect(serialized.size).toBe(54321);
    expect(serialized.width).toBe(1920);
    expect(serialized.title).toBe('Sunset');
    expect(serialized.tags).toEqual(['nature', 'sunset']);
    expect(serialized.linkedPostIds).toEqual(['p1', 'p2']);

    const deserialized = deserializeMediaItem(serialized);
    expect(deserialized.createdAt).toBeInstanceOf(Date);
    expect(deserialized.updatedAt).toBeInstanceOf(Date);
    expect(deserialized.filename).toBe('photo.webp');
    expect(deserialized.originalName).toBe('My Photo.webp');
    expect(deserialized.mimeType).toBe('image/webp');
    expect(deserialized.size).toBe(54321);
    expect(deserialized.width).toBe(1920);
    expect(deserialized.height).toBe(1080);
    expect(deserialized.title).toBe('Sunset');
    expect(deserialized.alt).toBe('A beautiful sunset');
    expect(deserialized.caption).toBe('Taken at the beach');
    expect(deserialized.author).toBe('Bob');
    expect(deserialized.language).toBe('en');
    expect(deserialized.tags).toEqual(['nature', 'sunset']);
    expect(deserialized.linkedPostIds).toEqual(['p1', 'p2']);
    expect(deserialized.availableLanguages).toEqual(['en', 'de']);
  });

  it('round-trips a media item with minimal fields', () => {
    const media = {
      id: 'm2',
      filename: 'doc.pdf',
      originalName: 'Document.pdf',
      mimeType: 'application/pdf',
      size: 999,
      createdAt: new Date('2025-04-01T00:00:00Z'),
      updatedAt: new Date('2025-04-01T00:00:00Z'),
      tags: [],
      availableLanguages: [],
    };
    const deserialized = deserializeMediaItem(serializeMediaItem(media));
    expect(deserialized.mimeType).toBe('application/pdf');
    expect(deserialized.width).toBeUndefined();
    expect(deserialized.title).toBeUndefined();
    expect(deserialized.linkedPostIds).toBeUndefined();
    expect(deserialized.tags).toEqual([]);
  });
});

describe('BlogGenerationOptions serialization', () => {
  it('strips fields not needed by worker', () => {
    const serialized = serializeBlogGenerationOptions({
      projectId: 'p1',
      projectName: 'My Blog',
      projectDescription: 'A blog',
      dataDir: '/data',
      baseUrl: 'https://example.com',
      language: 'en',
      blogLanguages: ['en', 'fr'],
      pageTitle: 'My Blog',
      maxPostsPerPage: 50,
      picoTheme: undefined,
      sections: ['single'],
    });

    expect(serialized.projectId).toBe('p1');
    expect(serialized.baseUrl).toBe('https://example.com');
    expect(serialized.blogLanguages).toEqual(['en', 'fr']);
    // pageTitle, maxPostsPerPage, sections are not in serialized
    expect((serialized as any).sections).toBeUndefined();
  });
});

describe('PostMap serialization', () => {
  it('round-trips a Map<string, PostData[]>', () => {
    const post1 = makePost({ id: '1', slug: 'a' });
    const post2 = makePost({ id: '2', slug: 'b' });
    const map = new Map<string, PostData[]>([
      ['tag-js', [post1, post2]],
      ['tag-py', [post2]],
    ]);

    const serialized = serializePostMap(map);
    expect(serialized).toHaveLength(2);
    expect(serialized[0][0]).toBe('tag-js');
    expect(serialized[0][1]).toHaveLength(2);

    const deserialized = deserializePostMap(serialized);
    expect(deserialized.size).toBe(2);
    expect(deserialized.get('tag-js')).toHaveLength(2);
    expect(deserialized.get('tag-js')![0].createdAt).toBeInstanceOf(Date);
  });

  it('round-trips a Map<number, PostData[]>', () => {
    const post1 = makePost({ id: '1', slug: 'a' });
    const map = new Map<number, PostData[]>([
      [2025, [post1]],
    ]);

    const serialized = serializePostMap(map);
    const deserialized = deserializePostMap(serialized);
    expect(deserialized.get(2025)).toHaveLength(1);
  });
});

describe('DateMap serialization', () => {
  it('round-trips a Map<number, Date>', () => {
    const map = new Map<number, Date>([
      [2024, new Date('2024-01-01')],
      [2025, new Date('2025-01-01')],
    ]);

    const serialized = serializeDateMap(map);
    expect(serialized).toHaveLength(2);
    expect(typeof serialized[0][1]).toBe('string');

    const deserialized = deserializeDateMap(serialized);
    expect(deserialized.size).toBe(2);
    expect(deserialized.get(2024)).toBeInstanceOf(Date);
    expect(deserialized.get(2025)).toBeInstanceOf(Date);
  });

  it('round-trips a Map<string, Date>', () => {
    const map = new Map<string, Date>([
      ['2025/01', new Date('2025-01-15')],
    ]);

    const serialized = serializeDateMap(map);
    const deserialized = deserializeDateMap(serialized);
    expect(deserialized.get('2025/01')).toBeInstanceOf(Date);
  });
});
