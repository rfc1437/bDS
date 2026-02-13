/**
 * ImportAnalysisEngine Unit Tests
 *
 * Tests the REAL ImportAnalysisEngine class with mocked dependencies.
 * Following TDD: mock database and filesystem, test real analysis logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImportAnalysisEngine } from '../../src/main/engine/ImportAnalysisEngine';
import type { ImportAnalysisReport, AnalyzedPost, AnalyzedMedia } from '../../src/main/engine/ImportAnalysisEngine';
import type { WxrData, WxrPost, WxrMedia, WxrSiteInfo } from '../../src/main/engine/WxrParser';
import crypto from 'crypto';

// Mock data stores
const mockPostRows: any[] = [];
const mockMediaRows: any[] = [];
const mockTagRows: any[] = [];

function createSelectChain() {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => {
      // Return appropriate data based on the table being queried
      return Promise.resolve([]);
    }),
    get: vi.fn().mockImplementation(() => Promise.resolve(undefined)),
  };
}

const mockLocalDb = {
  select: vi.fn(() => {
    const chain = createSelectChain();
    // The chain.all will be overridden per test
    return chain;
  }),
};

// Mock the database module
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => mockLocalDb),
  })),
}));

// Mock fs/promises for media file reading
const mockFileBuffers = new Map<string, Buffer>();
vi.mock('fs/promises', () => ({
  readFile: vi.fn(async (path: string) => {
    const buffer = mockFileBuffers.get(path.replace(/\\/g, '/'));
    if (!buffer) {
      const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
      (error as any).code = 'ENOENT';
      throw error;
    }
    return buffer;
  }),
  stat: vi.fn(async (path: string) => {
    const buffer = mockFileBuffers.get(path.replace(/\\/g, '/'));
    if (!buffer) {
      const error = new Error(`ENOENT: no such file or directory, stat '${path}'`);
      (error as any).code = 'ENOENT';
      throw error;
    }
    return { size: buffer.length };
  }),
  access: vi.fn(async (path: string) => {
    const normalizedPath = path.replace(/\\/g, '/');
    if (!mockFileBuffers.has(normalizedPath)) {
      const error = new Error(`ENOENT`);
      (error as any).code = 'ENOENT';
      throw error;
    }
  }),
}));

// Helper to create a WxrPost
function createWxrPost(overrides: Partial<WxrPost> = {}): WxrPost {
  return {
    wpId: 1,
    title: 'Test Post',
    slug: 'test-post',
    content: '<p>Test content</p>',
    excerpt: '',
    pubDate: new Date('2024-01-15'),
    creator: 'admin',
    status: 'publish',
    postType: 'post',
    categories: [],
    tags: [],
    ...overrides,
  };
}

// Helper to create a WxrMedia
function createWxrMedia(overrides: Partial<WxrMedia> = {}): WxrMedia {
  return {
    wpId: 100,
    title: 'test-image',
    url: 'https://example.com/wp-content/uploads/2024/01/test.jpg',
    filename: 'test.jpg',
    relativePath: '2024/01/test.jpg',
    pubDate: null,
    parentId: 0,
    mimeType: 'image/jpeg',
    description: '',
    ...overrides,
  };
}

// Helper to create WxrData
function createWxrData(overrides: Partial<WxrData> = {}): WxrData {
  return {
    site: {
      title: 'Test Blog',
      link: 'https://example.com',
      description: 'A test blog',
      language: 'en',
    },
    posts: [],
    pages: [],
    media: [],
    categories: [],
    tags: [],
    ...overrides,
  };
}

// Helper to compute expected MD5 hash (same algo as PostEngine)
function md5(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

describe('ImportAnalysisEngine', () => {
  let engine: ImportAnalysisEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPostRows.length = 0;
    mockMediaRows.length = 0;
    mockTagRows.length = 0;
    mockFileBuffers.clear();
    engine = new ImportAnalysisEngine();
    engine.setProjectContext('test-project');
  });

  describe('analyzeWxr - posts', () => {
    it('should classify a post as new when slug and hash do not exist in DB', async () => {
      // DB has no existing posts
      setupDbReturns([], [], []);

      const wxrData = createWxrData({
        posts: [createWxrPost({ slug: 'new-post', content: '<p>New content</p>' })],
      });

      const report = await engine.analyzeWxr(wxrData, '/path/to/export.xml');

      expect(report.posts.total).toBe(1);
      expect(report.posts.new).toBe(1);
      expect(report.posts.items[0].status).toBe('new');
    });

    it('should classify a post as update when slug AND hash match', async () => {
      // The engine converts HTML to markdown then hashes it
      // <p>Existing content</p> -> "Existing content\n" in turndown (approx)
      // We need to compute what turndown gives us and hash that
      const markdownContent = 'Existing content';
      const hash = md5(markdownContent);

      setupDbReturns([
        { id: 'existing-1', slug: 'existing-post', title: 'Existing Post', checksum: hash },
      ], [], []);

      const wxrData = createWxrData({
        posts: [createWxrPost({ slug: 'existing-post', content: '<p>Existing content</p>' })],
      });

      const report = await engine.analyzeWxr(wxrData, '/path/to/export.xml');

      expect(report.posts.total).toBe(1);
      expect(report.posts.updates).toBe(1);
      expect(report.posts.items[0].status).toBe('update');
      expect(report.posts.items[0].existingPost?.id).toBe('existing-1');
    });

    it('should classify a post as conflict when slug matches but hash differs', async () => {
      setupDbReturns([
        { id: 'existing-1', slug: 'my-post', title: 'My Post', checksum: 'different-hash' },
      ], [], []);

      const wxrData = createWxrData({
        posts: [createWxrPost({ slug: 'my-post', content: '<p>Changed content</p>' })],
      });

      const report = await engine.analyzeWxr(wxrData, '/path/to/export.xml');

      expect(report.posts.total).toBe(1);
      expect(report.posts.conflicts).toBe(1);
      expect(report.posts.items[0].status).toBe('conflict');
      expect(report.posts.items[0].existingPost?.id).toBe('existing-1');
    });

    it('should classify a post as content-duplicate when hash matches but slug differs', async () => {
      const markdownContent = 'Same content here';
      const hash = md5(markdownContent);

      setupDbReturns([
        { id: 'other-post', slug: 'different-slug', title: 'Different Title', checksum: hash },
      ], [], []);

      const wxrData = createWxrData({
        posts: [createWxrPost({ slug: 'my-original-slug', content: '<p>Same content here</p>' })],
      });

      const report = await engine.analyzeWxr(wxrData, '/path/to/export.xml');

      expect(report.posts.total).toBe(1);
      expect(report.posts.contentDuplicates).toBe(1);
      expect(report.posts.items[0].status).toBe('content-duplicate');
      expect(report.posts.items[0].existingPost?.id).toBe('other-post');
    });

    it('should analyze multiple posts with mixed statuses', async () => {
      const existingContent = 'Unchanged content';
      const existingHash = md5(existingContent);

      setupDbReturns([
        { id: 'post-1', slug: 'unchanged', title: 'Unchanged', checksum: existingHash },
        { id: 'post-2', slug: 'modified', title: 'Modified', checksum: 'old-hash' },
      ], [], []);

      const wxrData = createWxrData({
        posts: [
          createWxrPost({ slug: 'unchanged', content: '<p>Unchanged content</p>' }),
          createWxrPost({ slug: 'modified', content: '<p>New modified content</p>' }),
          createWxrPost({ slug: 'brand-new', content: '<p>Brand new post</p>' }),
        ],
      });

      const report = await engine.analyzeWxr(wxrData, '/test.xml');

      expect(report.posts.total).toBe(3);
      expect(report.posts.updates).toBe(1);
      expect(report.posts.conflicts).toBe(1);
      expect(report.posts.new).toBe(1);
    });

    it('should include markdown preview in analyzed posts', async () => {
      setupDbReturns([], [], []);

      const wxrData = createWxrData({
        posts: [createWxrPost({ content: '<p>This is a preview of the <strong>content</strong>.</p>' })],
      });

      const report = await engine.analyzeWxr(wxrData, '/test.xml');

      const item = report.posts.items[0];
      expect(item.markdownPreview).toBeTruthy();
      expect(item.markdownPreview.length).toBeGreaterThan(0);
      expect(item.markdownPreview.length).toBeLessThanOrEqual(200);
    });

    it('should compute content hash from markdown conversion of HTML', async () => {
      setupDbReturns([], [], []);

      const wxrData = createWxrData({
        posts: [createWxrPost({ content: '<p>Hello world</p>' })],
      });

      const report = await engine.analyzeWxr(wxrData, '/test.xml');

      const item = report.posts.items[0];
      expect(item.contentHash).toBeTruthy();
      // Hash should be MD5 of the markdown conversion
      expect(item.contentHash).toMatch(/^[a-f0-9]{32}$/);
    });
  });

  describe('analyzeWxr - pages', () => {
    it('should analyze pages separately from posts', async () => {
      setupDbReturns([], [], []);

      const wxrData = createWxrData({
        posts: [createWxrPost({ slug: 'post-1' })],
        pages: [createWxrPost({ slug: 'about', postType: 'page' })],
      });

      const report = await engine.analyzeWxr(wxrData, '/test.xml');

      expect(report.posts.total).toBe(1);
      expect(report.pages.total).toBe(1);
      expect(report.pages.items[0].wxrPost.slug).toBe('about');
    });
  });

  describe('analyzeWxr - media', () => {
    it('should classify media as new when filename not in DB and file exists in uploads', async () => {
      setupDbReturns([], [], []);
      const fileBuffer = Buffer.from('fake image data');
      mockFileBuffers.set('/uploads/2024/01/photo.jpg', fileBuffer);

      const wxrData = createWxrData({
        media: [createWxrMedia({
          filename: 'photo.jpg',
          relativePath: '2024/01/photo.jpg',
        })],
      });

      const report = await engine.analyzeWxr(wxrData, '/test.xml', '/uploads');

      expect(report.media.total).toBe(1);
      expect(report.media.new).toBe(1);
      expect(report.media.items[0].status).toBe('new');
      expect(report.media.items[0].fileHash).toBeTruthy();
    });

    it('should classify media as update when filename matches AND hash matches', async () => {
      const fileBuffer = Buffer.from('same file data');
      const fileHash = md5(fileBuffer.toString('binary'));
      mockFileBuffers.set('/uploads/2024/01/logo.png', fileBuffer);

      setupDbReturns([], [
        { id: 'media-1', originalName: 'logo.png', checksum: fileHash },
      ], []);

      const wxrData = createWxrData({
        media: [createWxrMedia({
          filename: 'logo.png',
          relativePath: '2024/01/logo.png',
        })],
      });

      const report = await engine.analyzeWxr(wxrData, '/test.xml', '/uploads');

      expect(report.media.total).toBe(1);
      expect(report.media.updates).toBe(1);
      expect(report.media.items[0].status).toBe('update');
      expect(report.media.items[0].existingMedia?.id).toBe('media-1');
    });

    it('should classify media as conflict when filename matches but hash differs', async () => {
      const fileBuffer = Buffer.from('new file data');
      mockFileBuffers.set('/uploads/2024/01/logo.png', fileBuffer);

      setupDbReturns([], [
        { id: 'media-1', originalName: 'logo.png', checksum: 'old-hash-value' },
      ], []);

      const wxrData = createWxrData({
        media: [createWxrMedia({
          filename: 'logo.png',
          relativePath: '2024/01/logo.png',
        })],
      });

      const report = await engine.analyzeWxr(wxrData, '/test.xml', '/uploads');

      expect(report.media.total).toBe(1);
      expect(report.media.conflicts).toBe(1);
      expect(report.media.items[0].status).toBe('conflict');
    });

    it('should classify media as content-duplicate when hash matches but filename differs', async () => {
      const fileBuffer = Buffer.from('duplicate content');
      const fileHash = md5(fileBuffer.toString('binary'));
      mockFileBuffers.set('/uploads/2024/01/new-name.jpg', fileBuffer);

      setupDbReturns([], [
        { id: 'media-1', originalName: 'old-name.jpg', checksum: fileHash },
      ], []);

      const wxrData = createWxrData({
        media: [createWxrMedia({
          filename: 'new-name.jpg',
          relativePath: '2024/01/new-name.jpg',
        })],
      });

      const report = await engine.analyzeWxr(wxrData, '/test.xml', '/uploads');

      expect(report.media.total).toBe(1);
      expect(report.media.contentDuplicates).toBe(1);
      expect(report.media.items[0].status).toBe('content-duplicate');
    });

    it('should mark media as missing when file not found in uploads folder', async () => {
      setupDbReturns([], [], []);
      // No file added to mockFileBuffers

      const wxrData = createWxrData({
        media: [createWxrMedia({
          filename: 'missing.jpg',
          relativePath: '2024/01/missing.jpg',
        })],
      });

      const report = await engine.analyzeWxr(wxrData, '/test.xml', '/uploads');

      expect(report.media.total).toBe(1);
      expect(report.media.missing).toBe(1);
      expect(report.media.items[0].status).toBe('missing');
      expect(report.media.items[0].fileHash).toBeNull();
    });

    it('should handle media analysis without uploads folder (all missing)', async () => {
      setupDbReturns([], [], []);

      const wxrData = createWxrData({
        media: [createWxrMedia({ filename: 'test.jpg' })],
      });

      // No uploads folder provided
      const report = await engine.analyzeWxr(wxrData, '/test.xml');

      expect(report.media.total).toBe(1);
      expect(report.media.missing).toBe(1);
      expect(report.media.items[0].status).toBe('missing');
    });
  });

  describe('analyzeWxr - categories and tags', () => {
    it('should check existing categories against project tags', async () => {
      setupDbReturns([], [], [
        { name: 'Technology' },
      ]);

      const wxrData = createWxrData({
        categories: [
          { name: 'Technology', slug: 'technology', parent: '' },
          { name: 'Science', slug: 'science', parent: '' },
        ],
      });

      const report = await engine.analyzeWxr(wxrData, '/test.xml');

      expect(report.categories).toHaveLength(2);
      expect(report.categories[0].existsInProject).toBe(true);
      expect(report.categories[1].existsInProject).toBe(false);
    });

    it('should check existing tags against project tags', async () => {
      setupDbReturns([], [], [
        { name: 'javascript' },
      ]);

      const wxrData = createWxrData({
        tags: [
          { name: 'javascript', slug: 'javascript' },
          { name: 'python', slug: 'python' },
        ],
      });

      const report = await engine.analyzeWxr(wxrData, '/test.xml');

      expect(report.tags).toHaveLength(2);
      expect(report.tags[0].existsInProject).toBe(true);
      expect(report.tags[1].existsInProject).toBe(false);
    });
  });

  describe('analyzeWxr - report metadata', () => {
    it('should include source file and site info in report', async () => {
      setupDbReturns([], [], []);

      const wxrData = createWxrData({
        site: {
          title: 'My Blog',
          link: 'https://myblog.com',
          description: 'A great blog',
          language: 'de-DE',
        },
      });

      const report = await engine.analyzeWxr(wxrData, '/exports/myblog.xml');

      expect(report.sourceFile).toBe('/exports/myblog.xml');
      expect(report.site.title).toBe('My Blog');
      expect(report.site.link).toBe('https://myblog.com');
      expect(report.analyzedAt).toBeInstanceOf(Date);
    });

    it('should correctly count all post statuses', async () => {
      const contentA = 'Content A';
      const hashA = md5(contentA);

      setupDbReturns([
        { id: 'p1', slug: 'update-me', title: 'Update Me', checksum: hashA },
        { id: 'p2', slug: 'conflict-me', title: 'Conflict Me', checksum: 'old-hash' },
      ], [], []);

      const wxrData = createWxrData({
        posts: [
          createWxrPost({ slug: 'update-me', content: '<p>Content A</p>' }),
          createWxrPost({ slug: 'conflict-me', content: '<p>Different content</p>' }),
          createWxrPost({ slug: 'new-one', content: '<p>Brand new</p>' }),
          createWxrPost({ slug: 'another-new', content: '<p>Also new</p>' }),
        ],
      });

      const report = await engine.analyzeWxr(wxrData, '/test.xml');

      expect(report.posts.total).toBe(4);
      expect(report.posts.updates).toBe(1);
      expect(report.posts.conflicts).toBe(1);
      expect(report.posts.new).toBe(2);
      expect(report.posts.contentDuplicates).toBe(0);
    });
  });
});

/**
 * Helper to set up mock DB return values.
 * Uses a counter-based approach to return different data for different queries.
 */
let dbQueryCount = 0;
function setupDbReturns(
  existingPosts: Array<{ id: string; slug: string; title: string; checksum: string }>,
  existingMedia: Array<{ id: string; originalName: string; checksum: string }>,
  existingTags: Array<{ name: string }>,
) {
  dbQueryCount = 0;
  mockLocalDb.select.mockImplementation(() => {
    const currentQuery = dbQueryCount++;
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          all: vi.fn().mockImplementation(() => {
            if (currentQuery === 0) return Promise.resolve(existingPosts);
            if (currentQuery === 1) return Promise.resolve(existingMedia);
            if (currentQuery === 2) return Promise.resolve(existingTags);
            return Promise.resolve([]);
          }),
        }),
      }),
    };
  });
}
