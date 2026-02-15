/**
 * ImportExecutionEngine End-to-End Tests
 *
 * Comprehensive tests that parse a real WXR file and verify the complete import process.
 * Uses tests/assets/import-test-cases.wxr as the source test data.
 *
 * Test Categories:
 * 1. HTML to Markdown Conversion - verifies proper transformation of all HTML elements
 * 2. Shortcode/Macro Conversion - verifies [shortcode] → [[shortcode]] transformation
 * 3. Tag/Category Mapping - verifies taxonomy resolution and creation
 * 4. Conflict Resolution - verifies ignore/overwrite/import behaviors
 * 5. Media Import - verifies media file handling with post linkage
 * 6. Page Import - verifies pages become posts with "page" category
 * 7. Other Post Types - verifies nav_menu_item, revision, wp_template are analyzed but not imported
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { WxrParser, type WxrData } from '../../src/main/engine/WxrParser';
import type {
  ImportAnalysisReport,
  AnalyzedPost,
  AnalyzedMedia,
  AnalyzedCategory,
  AnalyzedTag,
  PostAnalysisStatus,
  MediaAnalysisStatus,
} from '../../src/main/engine/ImportAnalysisEngine';
import type { WxrPost, WxrMedia } from '../../src/main/engine/WxrParser';

// Read the WXR file SYNCHRONOUSLY at module load time (before mocks apply)
const wxrFilePath = path.join(__dirname, '../assets/import-test-cases.wxr');
const wxrFileContent = fs.readFileSync(wxrFilePath, 'utf-8');

// Track all database inserts
const insertedPosts: Array<{
  id: string;
  projectId: string;
  title: string;
  slug: string;
  content: string | null;
  status: string;
  tags: string;
  categories: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
  author?: string;
}> = [];

const insertedMedia: Array<{
  id: string;
  linkedPostIds: string[];
  title?: string;
}> = [];

const createdTags: string[] = [];

// Track files written
const writtenFiles: Array<{
  path: string;
  content: string;
}> = [];

// Mock database that tracks inserts
const mockDb = {
  insert: vi.fn().mockImplementation((table: any) => ({
    values: vi.fn().mockImplementation(async (data: any) => {
      // Track based on data structure
      if (data && typeof data === 'object') {
        if ('slug' in data && 'title' in data) {
          insertedPosts.push(data);
        }
      }
      return data;
    }),
  })),
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  }),
};

const mockClient = {
  execute: vi.fn().mockResolvedValue({ rows: [] }),
};

// Mock modules
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => mockDb),
    getLocalClient: vi.fn(() => mockClient),
  })),
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockImplementation(async (filePath: string, content: string) => {
    writtenFiles.push({ path: filePath, content });
  }),
  copyFile: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 1024 }),
  readFile: vi.fn().mockImplementation(async (filePath: string) => {
    // Return the pre-loaded WXR content for the test file
    if (filePath.endsWith('import-test-cases.wxr')) {
      return wxrFileContent;
    }
    return Buffer.from('test data');
  }),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/user/data'),
  },
}));

let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: vi.fn(() => `test-uuid-${++uuidCounter}`),
}));

// Mock TagEngine
const mockTagEngine = {
  setProjectContext: vi.fn(),
  createTag: vi.fn().mockImplementation(async (input: { name: string }) => {
    createdTags.push(input.name.toLowerCase());
    return {
      id: `tag-${input.name}`,
      projectId: 'test-project',
      name: input.name.toLowerCase(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }),
  getAllTags: vi.fn().mockResolvedValue([]),
};

vi.mock('../../src/main/engine/TagEngine', () => ({
  getTagEngine: vi.fn(() => mockTagEngine),
}));

// Mock PostEngine
const mockPostEngine = {
  setProjectContext: vi.fn(),
  createPost: vi.fn(),
  publishPost: vi.fn(),
  isSlugAvailable: vi.fn().mockResolvedValue(true),
  generateUniqueSlug: vi.fn().mockImplementation(async (title: string) => {
    return `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-new`;
  }),
  updateFTSIndex: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../src/main/engine/PostEngine', () => ({
  getPostEngine: vi.fn(() => mockPostEngine),
}));

// Mock MediaEngine
const mockMediaEngine = {
  setProjectContext: vi.fn(),
  importMedia: vi.fn().mockImplementation(async (sourcePath: string, metadata?: any) => {
    const result = {
      id: `media-${Math.random().toString(36).substr(2, 9)}`,
      filename: path.basename(sourcePath),
      originalName: metadata?.originalName || path.basename(sourcePath),
      title: metadata?.title,
      linkedPostIds: metadata?.linkedPostIds || [],
    };
    insertedMedia.push(result);
    return result;
  }),
};

vi.mock('../../src/main/engine/MediaEngine', () => ({
  getMediaEngine: vi.fn(() => mockMediaEngine),
}));

// Import after mocks are set up
import { ImportExecutionEngine } from '../../src/main/engine/ImportExecutionEngine';

describe('ImportExecutionEngine E2E Tests', () => {
  let engine: ImportExecutionEngine;
  let wxrData: WxrData;

  beforeEach(async () => {
    // Reset all tracking arrays
    insertedPosts.length = 0;
    insertedMedia.length = 0;
    createdTags.length = 0;
    writtenFiles.length = 0;
    uuidCounter = 0;

    // Clear all mocks
    vi.clearAllMocks();

    // Create engine instance
    engine = new ImportExecutionEngine();
    engine.setProjectContext('test-project', '/mock/test/data');

    // Parse the WXR content (mocked readFile will return our pre-loaded content)
    const parser = new WxrParser();
    wxrData = await parser.parseFile(wxrFilePath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // SECTION 1: HTML TO MARKDOWN CONVERSION
  // ==========================================================================

  describe('HTML to Markdown Conversion', () => {
    /**
     * Creates a minimal analysis report for a single post for testing conversion
     */
    function createSinglePostReport(wxrPost: WxrPost): ImportAnalysisReport {
      return {
        wxrData: wxrData,
        posts: {
          total: 1,
          new: 1,
          update: 0,
          conflict: 0,
          items: [{
            wxrPost,
            status: 'new' as PostAnalysisStatus,
            contentHash: 'test-hash',
            markdownPreview: '',
          }],
        },
        pages: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        media: { total: 0, new: 0, update: 0, conflict: 0, missing: 0, items: [] },
        tags: [],
        categories: [],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };
    }

    it('should convert basic text formatting (bold, italic, strikethrough)', async () => {
      // Post 101: Basic Text Formatting
      const post = wxrData.posts.find(p => p.wpId === 101);
      expect(post).toBeDefined();

      const report = createSinglePostReport(post!);
      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);

      // Find the written file for this post
      const writtenFile = writtenFiles.find(f => f.path.includes('html-formatting-basic'));
      expect(writtenFile).toBeDefined();

      const content = writtenFile!.content;

      // Verify bold conversion: <strong> and <b> → **text**
      expect(content).toContain('**bold text**');
      expect(content).toContain('**another bold**');

      // Verify italic conversion: <em> and <i> → _text_ or *text*
      expect(content).toMatch(/_italic text_|\*italic text\*/);
      expect(content).toMatch(/_italic using i tag_|\*italic using i tag\*/);

      // Verify combined bold+italic (TurndownService outputs **_text_** or ***text***)
      expect(content).toMatch(/\*\*_bold and italic together_\*\*|\*\*\*bold and italic together\*\*\*/);

      // Note: TurndownService does NOT convert <del> and <s> to ~~ by default
      // The strikethrough text will appear as plain text
      expect(content).toContain('strikethrough text');
      expect(content).toContain('also this');
    });

    it('should convert headings (h1-h6) to ATX style', async () => {
      // Post 102: Headings
      const post = wxrData.posts.find(p => p.wpId === 102);
      expect(post).toBeDefined();

      const report = createSinglePostReport(post!);
      await engine.executeImport(report, {});

      const writtenFile = writtenFiles.find(f => f.path.includes('html-formatting-headings'));
      expect(writtenFile).toBeDefined();

      const content = writtenFile!.content;

      // Verify ATX-style headings
      expect(content).toContain('# Heading Level 1');
      expect(content).toContain('## Heading Level 2');
      expect(content).toContain('### Heading Level 3');
      expect(content).toContain('#### Heading Level 4');
      expect(content).toContain('##### Heading Level 5');
      expect(content).toContain('###### Heading Level 6');

      // Verify paragraphs between headings
      expect(content).toContain('Paragraph after h1');
      expect(content).toContain('Paragraph after h2');
    });

    it('should convert lists (ordered, unordered, nested)', async () => {
      // Post 103: Lists
      const post = wxrData.posts.find(p => p.wpId === 103);
      expect(post).toBeDefined();

      const report = createSinglePostReport(post!);
      await engine.executeImport(report, {});

      const writtenFile = writtenFiles.find(f => f.path.includes('html-formatting-lists'));
      expect(writtenFile).toBeDefined();

      const content = writtenFile!.content;

      // Verify unordered list items (- marker with possible spaces)
      expect(content).toMatch(/-\s+First item/);
      expect(content).toMatch(/-\s+Second item/);
      expect(content).toMatch(/-\s+Third item/);

      // Verify ordered list items
      expect(content).toMatch(/1\.\s+Step one/);
      expect(content).toMatch(/2\.\s+Step two/);
      expect(content).toMatch(/3\.\s+Step three/);

      // Verify nested list structure (indent varies)
      expect(content).toMatch(/-\s+Parent item/);
      expect(content).toMatch(/-\s+Another parent/);
      // Nested items should contain Child items somewhere in content
      expect(content).toContain('Child item 1');
      expect(content).toContain('Child item 2');
    });

    it('should convert links and images', async () => {
      // Post 104: Links and Images
      const post = wxrData.posts.find(p => p.wpId === 104);
      expect(post).toBeDefined();

      const report = createSinglePostReport(post!);
      await engine.executeImport(report, {});

      const writtenFile = writtenFiles.find(f => f.path.includes('html-formatting-links'));
      expect(writtenFile).toBeDefined();

      const content = writtenFile!.content;

      // Verify link conversion
      expect(content).toContain('[simple link](https://example.com)');
      expect(content).toMatch(/\[titled link\]\(https:\/\/example\.com.*\)/);

      // Verify image conversion
      expect(content).toContain('![Test image](https://example.com/image.jpg)');
      expect(content).toContain('![Photo](https://example.com/photo.png');

      // Verify linked image - should become a plain image (link is unwrapped)
      // The link href is not an image URL, so the image src is used
      expect(content).toContain('![Banner](https://example.com/banner.jpg)');
    });

    it('should convert code blocks (inline and fenced)', async () => {
      // Post 105: Code Blocks
      const post = wxrData.posts.find(p => p.wpId === 105);
      expect(post).toBeDefined();

      const report = createSinglePostReport(post!);
      await engine.executeImport(report, {});

      const writtenFile = writtenFiles.find(f => f.path.includes('html-formatting-code'));
      expect(writtenFile).toBeDefined();

      const content = writtenFile!.content;

      // Verify inline code
      expect(content).toContain('`const x = 10;`');

      // Verify fenced code block
      expect(content).toContain('```');
      expect(content).toContain('function hello()');
      expect(content).toContain('console.log("Hello World")');

      // Verify <pre> only block
      expect(content).toContain('Plain preformatted text');
    });

    it('should convert blockquotes', async () => {
      // Post 106: Blockquotes
      const post = wxrData.posts.find(p => p.wpId === 106);
      expect(post).toBeDefined();

      const report = createSinglePostReport(post!);
      await engine.executeImport(report, {});

      const writtenFile = writtenFiles.find(f => f.path.includes('html-formatting-quotes'));
      expect(writtenFile).toBeDefined();

      const content = writtenFile!.content;

      // Verify blockquote conversion
      expect(content).toContain('> The only way to do great work is to love what you do.');
      // Note: TurndownService escapes the dash, so it becomes \- or just text
      expect(content).toContain('Steve Jobs');

      // Verify nested blockquote (should have > > for inner quote)
      expect(content).toContain('> Outer quote');
      expect(content).toContain('> > Inner quote');
    });

    it('should convert linked images with empty alt to plain images with derived alt', async () => {
      // Post 107: Linked Images with empty/missing alt
      const post = wxrData.posts.find(p => p.wpId === 107);
      expect(post).toBeDefined();

      const report = createSinglePostReport(post!);
      await engine.executeImport(report, {});

      const writtenFile = writtenFiles.find(f => f.path.includes('html-formatting-linked-images'));
      expect(writtenFile).toBeDefined();

      const content = writtenFile!.content;

      // Linked image with empty alt should become a plain image with filename-derived alt
      // The link target is the full-size image, so use that for the image src
      expect(content).toContain('![full-size.png](http://example.com/wp-content/uploads/2020/03/full-size.png)');

      // Linked image with no alt attribute (link and image different)
      expect(content).toContain('![photo.jpg](http://example.com/gallery/photo.jpg)');

      // Linked image where link and src are the same
      expect(content).toContain('![photo.jpg](http://example.com/photo.jpg)');

      // Image with proper alt inside link should preserve the alt text
      expect(content).toContain('![Company Logo](http://example.com/logo.png)');

      // Image with title but empty alt should use title as alt text (title takes precedence over filename)
      expect(content).toContain('![Delicious Piroggen](http://example.com/wp-content/uploads/2020/03/dish.jpg');

      // Should NOT have empty image alt text (the broken pattern we're fixing)
      expect(content).not.toMatch(/!\[\]\([^)]+\)/);
    });

    it('should preserve line breaks in paragraph text', async () => {
      // Post 108: Line Breaks Preservation
      const post = wxrData.posts.find(p => p.wpId === 108);
      expect(post).toBeDefined();

      const report = createSinglePostReport(post!);
      await engine.executeImport(report, {});

      const writtenFile = writtenFiles.find(f => f.path.includes('html-formatting-line-breaks'));
      expect(writtenFile).toBeDefined();

      const content = writtenFile!.content;

      // Line breaks within paragraphs should be preserved as markdown line breaks
      // (either as two trailing spaces + newline, or as actual newlines)
      // The key is that "inside the text that should" appears on a separate line from 
      // "This paragraph has line breaks"
      expect(content).toMatch(/has line breaks\s*\n.*inside the text/);
      expect(content).toMatch(/inside the text that should\s*\n.*be preserved/);

      // Second paragraph should also preserve line breaks
      expect(content).toMatch(/another paragraph\s*\n.*with different content/);

      // Single line paragraph should remain intact
      expect(content).toContain('Single line paragraph for comparison.');
    });
  });

  // ==========================================================================
  // SECTION 2: SHORTCODE/MACRO CONVERSION
  // ==========================================================================

  describe('Shortcode to Macro Conversion', () => {
    function createSinglePostReport(wxrPost: WxrPost): ImportAnalysisReport {
      return {
        wxrData: wxrData,
        posts: {
          total: 1,
          new: 1,
          update: 0,
          conflict: 0,
          items: [{
            wxrPost,
            status: 'new' as PostAnalysisStatus,
            contentHash: 'test-hash',
            markdownPreview: '',
          }],
        },
        pages: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        media: { total: 0, new: 0, update: 0, conflict: 0, missing: 0, items: [] },
        tags: [],
        categories: [],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };
    }

    it('should convert [gallery] shortcode to [[gallery]] macro', async () => {
      // Post 201: Gallery Shortcode
      const post = wxrData.posts.find(p => p.wpId === 201);
      expect(post).toBeDefined();
      expect(post!.content).toContain('[gallery ids="1,2,3" columns="3"]');

      const report = createSinglePostReport(post!);
      await engine.executeImport(report, {});

      const writtenFile = writtenFiles.find(f => f.path.includes('shortcode-gallery'));
      expect(writtenFile).toBeDefined();

      const content = writtenFile!.content;

      // MUST be converted to double brackets
      expect(content).toContain('[[gallery ids="1,2,3" columns="3"]]');
      // MUST NOT contain single bracket version
      expect(content).not.toMatch(/(?<!\[)\[gallery/);
    });

    it('should convert [video] shortcode with attributes to [[video]] macro', async () => {
      // Post 202: Video Shortcode
      const post = wxrData.posts.find(p => p.wpId === 202);
      expect(post).toBeDefined();
      expect(post!.content).toContain('[video src="https://example.com/video.mp4"');

      const report = createSinglePostReport(post!);
      await engine.executeImport(report, {});

      const writtenFile = writtenFiles.find(f => f.path.includes('shortcode-video'));
      expect(writtenFile).toBeDefined();

      const content = writtenFile!.content;

      // MUST preserve all attributes in double-bracket format
      expect(content).toContain('[[video src="https://example.com/video.mp4" width="640" height="360"]]');
    });

    it('should convert multiple shortcodes in a single post', async () => {
      // Post 203: Multiple Shortcodes
      const post = wxrData.posts.find(p => p.wpId === 203);
      expect(post).toBeDefined();

      const report = createSinglePostReport(post!);
      await engine.executeImport(report, {});

      const writtenFile = writtenFiles.find(f => f.path.includes('shortcode-multiple'));
      expect(writtenFile).toBeDefined();

      const content = writtenFile!.content;

      // All shortcodes must be converted
      expect(content).toContain('[[audio src="https://example.com/podcast.mp3"]]');
      expect(content).toContain('[[gallery ids="10,20,30"]]');
      expect(content).toContain('[[embed]]');

      // None should remain as single brackets
      expect(content).not.toMatch(/(?<!\[)\[audio /);
      expect(content).not.toMatch(/(?<!\[)\[gallery /);
      expect(content).not.toMatch(/(?<!\[)\[embed\]/);
    });

    it('should convert self-closing shortcodes [shortcode /]', async () => {
      // Post 204: Self-Closing Shortcodes
      const post = wxrData.posts.find(p => p.wpId === 204);
      expect(post).toBeDefined();
      expect(post!.content).toContain('[divider /]');
      expect(post!.content).toContain('[spacer height="20" /]');

      const report = createSinglePostReport(post!);
      await engine.executeImport(report, {});

      const writtenFile = writtenFiles.find(f => f.path.includes('shortcode-selfclose'));
      expect(writtenFile).toBeDefined();

      const content = writtenFile!.content;

      // Self-closing shortcodes should be converted (removing the /)
      expect(content).toContain('[[divider]]');
      expect(content).toContain('[[spacer height="20"]]');
    });

    it('should NOT double-convert already bracketed [[macro]] content', async () => {
      // Post 205: Already Double-Bracketed
      const post = wxrData.posts.find(p => p.wpId === 205);
      expect(post).toBeDefined();
      // Original content has both formats
      expect(post!.content).toContain('[[gallery ids="1,2,3"]]');
      expect(post!.content).toContain('[video src="new.mp4"]');
      expect(post!.content).toContain('[[audio src="podcast.mp3"]]');

      const report = createSinglePostReport(post!);
      await engine.executeImport(report, {});

      const writtenFile = writtenFiles.find(f => f.path.includes('shortcode-already'));
      expect(writtenFile).toBeDefined();

      const content = writtenFile!.content;

      // Already-converted macros MUST remain as double brackets (not become [[[[...)
      expect(content).toContain('[[gallery ids="1,2,3"]]');
      expect(content).not.toContain('[[[');
      expect(content).not.toContain(']]]');

      // Single bracket shortcode MUST be converted
      expect(content).toContain('[[video src="new.mp4"]]');

      // Pre-existing double bracket MUST remain unchanged
      expect(content).toContain('[[audio src="podcast.mp3"]]');
    });
  });

  // ==========================================================================
  // SECTION 3: TAG AND CATEGORY MAPPING
  // ==========================================================================

  describe('Tag and Category Mapping', () => {
    it('should create new tags that do not exist in the project', async () => {
      // Post 201 has tag "React" which we'll mark as new
      const post = wxrData.posts.find(p => p.wpId === 201);
      expect(post).toBeDefined();
      expect(post!.tags).toContain('React');

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: {
          total: 1,
          new: 1,
          update: 0,
          conflict: 0,
          items: [{
            wxrPost: post!,
            status: 'new' as PostAnalysisStatus,
            contentHash: 'test-hash',
            markdownPreview: '',
          }],
        },
        pages: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        media: { total: 0, new: 0, update: 0, conflict: 0, missing: 0, items: [] },
        tags: [
          { name: 'React', slug: 'react', existsInProject: false },  // New tag
        ],
        categories: [
          { name: 'Technology', slug: 'technology', existsInProject: true },  // Existing
        ],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      const result = await engine.executeImport(report, {});

      // Tag "react" should have been created
      expect(createdTags).toContain('react');
      expect(result.tags.created).toBe(1);

      // The imported post should have the tag
      expect(insertedPosts.length).toBe(1);
      const postTags = JSON.parse(insertedPosts[0].tags);
      expect(postTags).toContain('react');
    });

    it('should map tags to existing project tags when mappedTo is set', async () => {
      // Post 203 has tag "nodejs" which we'll map to existing "node"
      const post = wxrData.posts.find(p => p.wpId === 203);
      expect(post).toBeDefined();
      expect(post!.tags).toContain('nodejs');
      expect(post!.tags).toContain('JavaScript');

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: {
          total: 1,
          new: 1,
          update: 0,
          conflict: 0,
          items: [{
            wxrPost: post!,
            status: 'new' as PostAnalysisStatus,
            contentHash: 'test-hash',
            markdownPreview: '',
          }],
        },
        pages: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        media: { total: 0, new: 0, update: 0, conflict: 0, missing: 0, items: [] },
        tags: [
          { name: 'nodejs', slug: 'nodejs', existsInProject: false, mappedTo: 'node' },  // Mapped
          { name: 'JavaScript', slug: 'javascript', existsInProject: true },  // Existing
        ],
        categories: [
          { name: 'Web Dev', slug: 'web-dev', existsInProject: false, mappedTo: 'web-development' },  // Mapped
        ],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      const result = await engine.executeImport(report, {});

      // Should NOT create "nodejs" tag (it's mapped)
      expect(createdTags).not.toContain('nodejs');
      // Should NOT create "node" either (it exists)
      expect(createdTags).not.toContain('node');

      // The imported post should use the mapped tag name
      expect(insertedPosts.length).toBe(1);
      const postTags = JSON.parse(insertedPosts[0].tags);
      expect(postTags).toContain('node');  // Mapped from "nodejs"
      expect(postTags).toContain('javascript');  // Existing

      // Category should also be mapped
      const postCategories = JSON.parse(insertedPosts[0].categories);
      expect(postCategories).toContain('web-development');  // Mapped from "Web Dev"
    });

    it('should skip existing tags and not try to create them', async () => {
      const post = wxrData.posts.find(p => p.wpId === 105);
      expect(post).toBeDefined();
      expect(post!.tags).toContain('JavaScript');
      expect(post!.tags).toContain('TypeScript');

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: {
          total: 1,
          new: 1,
          update: 0,
          conflict: 0,
          items: [{
            wxrPost: post!,
            status: 'new' as PostAnalysisStatus,
            contentHash: 'test-hash',
            markdownPreview: '',
          }],
        },
        pages: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        media: { total: 0, new: 0, update: 0, conflict: 0, missing: 0, items: [] },
        tags: [
          { name: 'JavaScript', slug: 'javascript', existsInProject: true },
          { name: 'TypeScript', slug: 'typescript', existsInProject: true },
        ],
        categories: [
          { name: 'Programming', slug: 'programming', existsInProject: true },
        ],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      const result = await engine.executeImport(report, {});

      // No tags should be created (all exist)
      expect(createdTags.length).toBe(0);
      expect(result.tags.created).toBe(0);
      expect(result.tags.skipped).toBe(3);  // 2 tags + 1 category

      // Post should still have the tags
      const postTags = JSON.parse(insertedPosts[0].tags);
      expect(postTags).toContain('javascript');
      expect(postTags).toContain('typescript');
    });
  });

  // ==========================================================================
  // SECTION 4: CONFLICT RESOLUTION
  // ==========================================================================

  describe('Conflict Resolution', () => {
    it('should SKIP import when conflict resolution is "ignore"', async () => {
      // Post 301: Conflict → Ignore
      const post = wxrData.posts.find(p => p.wpId === 301);
      expect(post).toBeDefined();
      expect(post!.slug).toBe('existing-post');

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: {
          total: 1,
          new: 0,
          update: 0,
          conflict: 1,
          items: [{
            wxrPost: post!,
            status: 'conflict' as PostAnalysisStatus,
            contentHash: 'test-hash',
            markdownPreview: '',
            conflictResolution: 'ignore',
            existingPost: {
              id: 'existing-post-id',
              title: 'Existing Post',
              slug: 'existing-post',
              checksum: 'old-hash',
              pubDate: '2023-01-01T00:00:00Z',
              excerpt: null,
              author: null,
              tags: [],
              categories: [],
            },
          }],
        },
        pages: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        media: { total: 0, new: 0, update: 0, conflict: 0, missing: 0, items: [] },
        tags: [],
        categories: [],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      const result = await engine.executeImport(report, {});

      // Post should be SKIPPED
      expect(result.posts.skipped).toBe(1);
      expect(result.posts.imported).toBe(0);

      // No post should be inserted
      expect(insertedPosts.length).toBe(0);

      // No file should be written for this post
      const writtenFile = writtenFiles.find(f => f.path.includes('existing-post'));
      expect(writtenFile).toBeUndefined();
    });

    it('should import as DRAFT when conflict resolution is "overwrite"', async () => {
      // Post 302: Conflict → Overwrite
      const post = wxrData.posts.find(p => p.wpId === 302);
      expect(post).toBeDefined();
      expect(post!.slug).toBe('overwrite-me');

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: {
          total: 1,
          new: 0,
          update: 0,
          conflict: 1,
          items: [{
            wxrPost: post!,
            status: 'conflict' as PostAnalysisStatus,
            contentHash: 'test-hash',
            markdownPreview: '',
            conflictResolution: 'overwrite',
            existingPost: {
              id: 'existing-overwrite-id',
              title: 'Original Post',
              slug: 'overwrite-me',
              checksum: 'old-hash',
              pubDate: '2023-01-01T00:00:00Z',
              excerpt: null,
              author: null,
              tags: [],
              categories: [],
            },
          }],
        },
        pages: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        media: { total: 0, new: 0, update: 0, conflict: 0, missing: 0, items: [] },
        tags: [
          { name: 'TypeScript', slug: 'typescript', existsInProject: true },
        ],
        categories: [
          { name: 'Programming', slug: 'programming', existsInProject: true },
        ],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      const result = await engine.executeImport(report, {});

      // Post should be IMPORTED
      expect(result.posts.imported).toBe(1);
      expect(result.posts.skipped).toBe(0);

      // Should insert exactly one post
      expect(insertedPosts.length).toBe(1);

      // The inserted post MUST be a DRAFT
      expect(insertedPosts[0].status).toBe('draft');

      // The slug should be preserved (same as conflict)
      expect(insertedPosts[0].slug).toBe('overwrite-me');

      // Draft posts store content in DB, not in file
      expect(insertedPosts[0].content).not.toBeNull();
      expect(insertedPosts[0].content).toContain('conflict resolution is "overwrite"');

      // No file should be written (draft = content in DB)
      const writtenFile = writtenFiles.find(f => f.path.includes('overwrite-me'));
      expect(writtenFile).toBeUndefined();
    });

    it('should import with NEW SLUG when conflict resolution is "import"', async () => {
      // Post 303: Conflict → Import (new slug)
      const post = wxrData.posts.find(p => p.wpId === 303);
      expect(post).toBeDefined();
      expect(post!.slug).toBe('duplicate-slug');

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: {
          total: 1,
          new: 0,
          update: 0,
          conflict: 1,
          items: [{
            wxrPost: post!,
            status: 'conflict' as PostAnalysisStatus,
            contentHash: 'test-hash',
            markdownPreview: '',
            conflictResolution: 'import',
            existingPost: {
              id: 'existing-duplicate-id',
              title: 'Duplicate Post',
              slug: 'duplicate-slug',
              checksum: 'old-hash',
              pubDate: '2023-01-01T00:00:00Z',
              excerpt: null,
              author: null,
              tags: [],
              categories: [],
            },
          }],
        },
        pages: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        media: { total: 0, new: 0, update: 0, conflict: 0, missing: 0, items: [] },
        tags: [],
        categories: [
          { name: 'Web Dev', slug: 'web-dev', existsInProject: true },
        ],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      const result = await engine.executeImport(report, {});

      // Post should be IMPORTED
      expect(result.posts.imported).toBe(1);

      // Should insert exactly one post
      expect(insertedPosts.length).toBe(1);

      // The inserted post should be PUBLISHED (not draft)
      expect(insertedPosts[0].status).toBe('published');

      // The slug must be DIFFERENT from the original (new unique slug)
      expect(insertedPosts[0].slug).not.toBe('duplicate-slug');
      // The mock generates slug from title with "-new" suffix
      expect(insertedPosts[0].slug).toBe('conflict-test-import-as-new-new');

      // Published post should have file written
      const writtenFile = writtenFiles.find(f => f.path.includes('conflict-test-import-as-new-new'));
      expect(writtenFile).toBeDefined();
    });

    it('should preserve WordPress dates when importing', async () => {
      // Post 302 has specific dates we want to preserve
      const post = wxrData.posts.find(p => p.wpId === 302);
      expect(post).toBeDefined();

      // Verify the WXR dates are parsed correctly
      expect(post!.postDate).toBeInstanceOf(Date);
      expect(post!.postModified).toBeInstanceOf(Date);
      expect(post!.postDate!.toISOString()).toContain('2024-01-23');
      expect(post!.postModified!.toISOString()).toContain('2024-01-23');

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: {
          total: 1,
          new: 0,
          update: 0,
          conflict: 1,
          items: [{
            wxrPost: post!,
            status: 'conflict' as PostAnalysisStatus,
            contentHash: 'test-hash',
            markdownPreview: '',
            conflictResolution: 'overwrite',
            existingPost: {
              id: 'existing-id',
              title: 'Original',
              slug: 'overwrite-me',
              checksum: 'old',
              pubDate: null,
              excerpt: null,
              author: null,
              tags: [],
              categories: [],
            },
          }],
        },
        pages: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        media: { total: 0, new: 0, update: 0, conflict: 0, missing: 0, items: [] },
        tags: [],
        categories: [],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);

      // Dates should come from WXR postDate and postModified
      const createdAt = insertedPosts[0].createdAt;
      const updatedAt = insertedPosts[0].updatedAt;

      expect(createdAt).toBeInstanceOf(Date);
      expect(updatedAt).toBeInstanceOf(Date);

      // Created from postDate
      expect(createdAt.toISOString()).toContain('2024-01-23');
      // Updated from postModified
      expect(updatedAt.toISOString()).toContain('2024-01-23T15:30');
    });
  });

  // ==========================================================================
  // SECTION 5: MEDIA IMPORT
  // ==========================================================================

  describe('Media Import', () => {
    it('should import media and link to parent post via wpId mapping', async () => {
      // First import Post 201 (the parent of Media 401)
      const post = wxrData.posts.find(p => p.wpId === 201);
      const media = wxrData.media.find(m => m.wpId === 401);

      expect(post).toBeDefined();
      expect(media).toBeDefined();
      expect(media!.parentId).toBe(201);  // Media is attached to post 201

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: {
          total: 1,
          new: 1,
          update: 0,
          conflict: 0,
          items: [{
            wxrPost: post!,
            status: 'new' as PostAnalysisStatus,
            contentHash: 'test-hash',
            markdownPreview: '',
          }],
        },
        pages: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        media: {
          total: 1,
          new: 1,
          update: 0,
          conflict: 0,
          missing: 0,
          items: [{
            wxrMedia: media!,
            status: 'new' as MediaAnalysisStatus,
            fileHash: 'media-hash',
          }],
        },
        tags: [],
        categories: [],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      const result = await engine.executeImport(report, { uploadsFolder: '/mock/wp-content/uploads' });

      // Post should be imported
      expect(result.posts.imported).toBe(1);

      // Media should be imported
      expect(result.media.imported).toBe(1);

      // Verify wpId to postId mapping was created
      expect(result.wpIdToPostId.has(201)).toBe(true);

      // Media should be linked to the imported post
      expect(insertedMedia.length).toBe(1);
      expect(insertedMedia[0].linkedPostIds.length).toBe(1);
      expect(insertedMedia[0].linkedPostIds[0]).toBe(result.wpIdToPostId.get(201));
    });

    it('should import standalone media without parent link', async () => {
      // Media 402 has no parent (parentId = 0)
      const media = wxrData.media.find(m => m.wpId === 402);
      expect(media).toBeDefined();
      expect(media!.parentId).toBe(0);

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        pages: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        media: {
          total: 1,
          new: 1,
          update: 0,
          conflict: 0,
          missing: 0,
          items: [{
            wxrMedia: media!,
            status: 'new' as MediaAnalysisStatus,
            fileHash: 'media-hash',
          }],
        },
        tags: [],
        categories: [],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      const result = await engine.executeImport(report, { uploadsFolder: '/mock/wp-content/uploads' });

      expect(result.media.imported).toBe(1);

      // Should be imported with title from WXR title
      expect(insertedMedia.length).toBe(1);
      expect(insertedMedia[0].title).toBe('standalone-logo');

      // No linked posts (standalone)
      expect(insertedMedia[0].linkedPostIds.length).toBe(0);
    });

    it('should skip media when conflict resolution is "ignore"', async () => {
      // Media 403: Conflict ignore
      const media = wxrData.media.find(m => m.wpId === 403);
      expect(media).toBeDefined();

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        pages: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        media: {
          total: 1,
          new: 0,
          update: 0,
          conflict: 1,
          missing: 0,
          items: [{
            wxrMedia: media!,
            status: 'conflict' as MediaAnalysisStatus,
            fileHash: 'media-hash',
            conflictResolution: 'ignore',
            existingMedia: {
              id: 'existing-media-id',
              originalName: 'existing.jpg',
              checksum: 'existing-hash',
            },
          } as any],
        },
        tags: [],
        categories: [],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      const result = await engine.executeImport(report, { uploadsFolder: '/mock/wp-content/uploads' });

      // Media should be SKIPPED
      expect(result.media.skipped).toBe(1);
      expect(result.media.imported).toBe(0);

      // No media should be imported
      expect(insertedMedia.length).toBe(0);
    });

    it('should skip media when file is missing in uploads folder', async () => {
      // Media with status 'missing'
      const media = wxrData.media.find(m => m.wpId === 401);
      expect(media).toBeDefined();

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        pages: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        media: {
          total: 1,
          new: 0,
          update: 0,
          conflict: 0,
          missing: 1,
          items: [{
            wxrMedia: media!,
            status: 'missing' as MediaAnalysisStatus,
            fileHash: null,
          }],
        },
        tags: [],
        categories: [],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      const result = await engine.executeImport(report, { uploadsFolder: '/mock/wp-content/uploads' });

      // Media should be SKIPPED (missing)
      expect(result.media.skipped).toBe(1);
      expect(result.media.imported).toBe(0);
    });
  });

  // ==========================================================================
  // SECTION 6: PAGE IMPORT
  // ==========================================================================

  describe('Page Import', () => {
    it('should import pages as posts with "page" category', async () => {
      // Page 501: Standard page
      const page = wxrData.pages.find(p => p.wpId === 501);
      expect(page).toBeDefined();
      expect(page!.postType).toBe('page');

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        pages: {
          total: 1,
          new: 1,
          update: 0,
          conflict: 0,
          items: [{
            wxrPost: page!,
            status: 'new' as PostAnalysisStatus,
            contentHash: 'test-hash',
            markdownPreview: '',
          }],
        },
        media: { total: 0, new: 0, update: 0, conflict: 0, missing: 0, items: [] },
        tags: [],
        categories: [],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      const result = await engine.executeImport(report, {});

      expect(result.pages.imported).toBe(1);

      // Page should be inserted as a post
      expect(insertedPosts.length).toBe(1);
      expect(insertedPosts[0].title).toBe('About This Blog');

      // MUST have "page" category
      const categories = JSON.parse(insertedPosts[0].categories);
      expect(categories).toContain('page');

      // Verify content is converted to Markdown
      const writtenFile = writtenFiles.find(f => f.path.includes('about'));
      expect(writtenFile).toBeDefined();
      expect(writtenFile!.content).toContain('## About');
      expect(writtenFile!.content).toContain('Welcome to my blog. This is a page, not a post.');
    });

    it('should convert page HTML content and shortcodes', async () => {
      // Page 502: Page with complex HTML and shortcode
      const page = wxrData.pages.find(p => p.wpId === 502);
      expect(page).toBeDefined();
      expect(page!.content).toContain('[contact_form id="1"]');

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        pages: {
          total: 1,
          new: 1,
          update: 0,
          conflict: 0,
          items: [{
            wxrPost: page!,
            status: 'new' as PostAnalysisStatus,
            contentHash: 'test-hash',
            markdownPreview: '',
          }],
        },
        media: { total: 0, new: 0, update: 0, conflict: 0, missing: 0, items: [] },
        tags: [],
        categories: [],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      await engine.executeImport(report, {});

      const writtenFile = writtenFiles.find(f => f.path.includes('contact'));
      expect(writtenFile).toBeDefined();

      const content = writtenFile!.content;

      // HTML should be converted to Markdown
      expect(content).toContain('## Contact Us');
      expect(content).toContain('### Office Hours');

      // Links should be converted
      expect(content).toContain('[test@example.com](mailto:test@example.com)');
      expect(content).toContain('[@test](https://twitter.com/test)');

      // Lists should be converted (TurndownService uses multiple spaces after -)
      expect(content).toMatch(/-\s+Email:/);
      expect(content).toMatch(/-\s+Twitter:/);

      // Shortcode should be converted to macro (underscore may be escaped by TurndownService)
      expect(content).toMatch(/\[\[contact_?\\?_?form id="1"\]\]/);
    });

    it('should preserve page author information', async () => {
      // Page 502 has author "admin"
      const page = wxrData.pages.find(p => p.wpId === 502);
      expect(page).toBeDefined();
      expect(page!.creator).toBe('admin');

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        pages: {
          total: 1,
          new: 1,
          update: 0,
          conflict: 0,
          items: [{
            wxrPost: page!,
            status: 'new' as PostAnalysisStatus,
            contentHash: 'test-hash',
            markdownPreview: '',
          }],
        },
        media: { total: 0, new: 0, update: 0, conflict: 0, missing: 0, items: [] },
        tags: [],
        categories: [],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      expect(insertedPosts[0].author).toBe('admin');
    });
  });

  // ==========================================================================
  // SECTION 7: RESULT SUMMARY VERIFICATION
  // ==========================================================================

  describe('Result Summary Accuracy', () => {
    it('should return accurate counts for a mixed import', async () => {
      // Import multiple posts with different statuses
      const post1 = wxrData.posts.find(p => p.wpId === 101);  // New
      const post2 = wxrData.posts.find(p => p.wpId === 301);  // Conflict-ignore
      const post3 = wxrData.posts.find(p => p.wpId === 302);  // Conflict-overwrite
      const page = wxrData.pages.find(p => p.wpId === 501);   // New page
      const media = wxrData.media.find(m => m.wpId === 402);  // New media

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: {
          total: 3,
          new: 1,
          update: 0,
          conflict: 2,
          items: [
            {
              wxrPost: post1!,
              status: 'new' as PostAnalysisStatus,
              contentHash: 'hash1',
              markdownPreview: '',
            },
            {
              wxrPost: post2!,
              status: 'conflict' as PostAnalysisStatus,
              contentHash: 'hash2',
              markdownPreview: '',
              conflictResolution: 'ignore',
              existingPost: { id: 'e1', title: 'E1', slug: 'existing-post', checksum: null, pubDate: null, excerpt: null, author: null, tags: [], categories: [] },
            },
            {
              wxrPost: post3!,
              status: 'conflict' as PostAnalysisStatus,
              contentHash: 'hash3',
              markdownPreview: '',
              conflictResolution: 'overwrite',
              existingPost: { id: 'e2', title: 'E2', slug: 'overwrite-me', checksum: null, pubDate: null, excerpt: null, author: null, tags: [], categories: [] },
            },
          ],
        },
        pages: {
          total: 1,
          new: 1,
          update: 0,
          conflict: 0,
          items: [{
            wxrPost: page!,
            status: 'new' as PostAnalysisStatus,
            contentHash: 'hash4',
            markdownPreview: '',
          }],
        },
        media: {
          total: 1,
          new: 1,
          update: 0,
          conflict: 0,
          missing: 0,
          items: [{
            wxrMedia: media!,
            status: 'new' as MediaAnalysisStatus,
            fileHash: 'media-hash',
          }],
        },
        tags: [
          { name: 'NewTag', slug: 'newtag', existsInProject: false },
          { name: 'ExistingTag', slug: 'existingtag', existsInProject: true },
        ],
        categories: [
          { name: 'Technology', slug: 'technology', existsInProject: true },
        ],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      const result = await engine.executeImport(report, { uploadsFolder: '/mock/wp-content/uploads' });

      // Verify result accuracy
      expect(result.success).toBe(true);

      // Posts: 1 new imported, 1 ignore skipped, 1 overwrite imported
      expect(result.posts.imported).toBe(2);  // post1 + post3
      expect(result.posts.skipped).toBe(1);   // post2 (ignore)
      expect(result.posts.errors).toBe(0);

      // Pages: 1 imported
      expect(result.pages.imported).toBe(1);
      expect(result.pages.skipped).toBe(0);
      expect(result.pages.errors).toBe(0);

      // Media: 1 imported
      expect(result.media.imported).toBe(1);
      expect(result.media.skipped).toBe(0);
      expect(result.media.errors).toBe(0);

      // Tags: 1 created (NewTag), 2 skipped (ExistingTag + Technology category)
      expect(result.tags.created).toBe(1);
      expect(result.tags.skipped).toBe(2);

      // WpId mapping should have entries for imported posts
      expect(result.wpIdToPostId.size).toBeGreaterThanOrEqual(2);  // post1, post3
    });
  });

  // ==========================================================================
  // SECTION 7: OTHER POST TYPES (analyzed but not imported)
  // ==========================================================================

  describe('Other Post Types (analyzed but not imported)', () => {
    it('should include nav_menu_item, revision, and wp_template in WXR parsed data', () => {
      // Verify the WXR parser includes these in the posts array
      const navMenuItem = wxrData.posts.find(p => p.wpId === 601);
      const revision = wxrData.posts.find(p => p.wpId === 602);
      const wpTemplate = wxrData.posts.find(p => p.wpId === 603);

      expect(navMenuItem).toBeDefined();
      expect(navMenuItem!.postType).toBe('nav_menu_item');
      expect(navMenuItem!.title).toBe('Home Menu Link');

      expect(revision).toBeDefined();
      expect(revision!.postType).toBe('revision');
      expect(revision!.slug).toBe('101-revision-v1');

      expect(wpTemplate).toBeDefined();
      expect(wpTemplate!.postType).toBe('wp_template');
      expect(wpTemplate!.title).toBe('Single Post Template');
    });

    it('should include other post types in analysis report but skip them during import', async () => {
      // Find the "other" post types from parsed WXR
      const navMenuItem = wxrData.posts.find(p => p.wpId === 601)!;
      const revision = wxrData.posts.find(p => p.wpId === 602)!;
      const wpTemplate = wxrData.posts.find(p => p.wpId === 603)!;
      
      // Also include a regular post to verify it gets imported
      const regularPost = wxrData.posts.find(p => p.wpId === 101)!;

      // Create analysis report that includes both regular posts and "other" post types
      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: {
          total: 4,
          new: 4,
          update: 0,
          conflict: 0,
          items: [
            {
              wxrPost: regularPost,
              status: 'new' as PostAnalysisStatus,
              contentHash: 'hash1',
              markdownPreview: '',
            },
            {
              wxrPost: navMenuItem,
              status: 'new' as PostAnalysisStatus,
              contentHash: 'hash2',
              markdownPreview: '',
            },
            {
              wxrPost: revision,
              status: 'new' as PostAnalysisStatus,
              contentHash: 'hash3',
              markdownPreview: '',
            },
            {
              wxrPost: wpTemplate,
              status: 'new' as PostAnalysisStatus,
              contentHash: 'hash4',
              markdownPreview: '',
            },
          ],
        },
        pages: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        media: { total: 0, new: 0, update: 0, conflict: 0, missing: 0, items: [] },
        tags: [],
        categories: [],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      const result = await engine.executeImport(report, {});

      // Verify only the regular post was imported
      expect(result.posts.imported).toBe(1);
      
      // The 3 "other" post types should be skipped
      expect(result.posts.skipped).toBe(3);
      expect(result.posts.errors).toBe(0);

      // Verify only one post was actually written to database/filesystem
      expect(insertedPosts.length).toBe(1);
      expect(insertedPosts[0].slug).toBe('html-formatting-basic');

      // Verify no files were written for nav_menu_item, revision, or wp_template
      const writtenSlugs = writtenFiles.map(f => f.path);
      expect(writtenSlugs.some(p => p.includes('home-menu-link'))).toBe(false);
      expect(writtenSlugs.some(p => p.includes('101-revision-v1'))).toBe(false);
      expect(writtenSlugs.some(p => p.includes('single'))).toBe(false);
    });

    it('should correctly count skipped "other" types in result summary', async () => {
      // Test with only "other" post types to verify counting
      const navMenuItem = wxrData.posts.find(p => p.wpId === 601)!;
      const revision = wxrData.posts.find(p => p.wpId === 602)!;

      const report: ImportAnalysisReport = {
        wxrData: wxrData,
        posts: {
          total: 2,
          new: 2,
          update: 0,
          conflict: 0,
          items: [
            {
              wxrPost: navMenuItem,
              status: 'new' as PostAnalysisStatus,
              contentHash: 'hash1',
              markdownPreview: '',
            },
            {
              wxrPost: revision,
              status: 'new' as PostAnalysisStatus,
              contentHash: 'hash2',
              markdownPreview: '',
            },
          ],
        },
        pages: { total: 0, new: 0, update: 0, conflict: 0, items: [] },
        media: { total: 0, new: 0, update: 0, conflict: 0, missing: 0, items: [] },
        tags: [],
        categories: [],
        site: wxrData.site,
        macros: { totalUniqueMacros: 0, totalMacroUsages: 0, allMapped: true, macros: [] },
      };

      const result = await engine.executeImport(report, {});

      // All should be skipped, none imported
      expect(result.posts.imported).toBe(0);
      expect(result.posts.skipped).toBe(2);
      expect(result.posts.errors).toBe(0);
      expect(insertedPosts.length).toBe(0);
    });
  });
});
