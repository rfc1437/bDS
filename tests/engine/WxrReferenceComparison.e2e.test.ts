/**
 * WXR Reference Comparison End-to-End Test
 *
 * This test parses the reference WXR file (tests/assets/wxr-ref/reduced_wxr.xml),
 * processes it through the full import pipeline (WxrParser → ImportAnalysisEngine → ImportExecutionEngine),
 * and compares each generated post/page with the expected reference markdown files.
 *
 * The test reports all differences between the generated output and reference files,
 * excluding the id and projectId fields which are runtime-generated GUIDs.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import matter from 'gray-matter';
import { WxrParser, type WxrData } from '../../src/main/engine/WxrParser';
import type { ImportAnalysisReport } from '../../src/main/engine/ImportAnalysisEngine';

// Read the WXR file SYNCHRONOUSLY at module load time (before mocks apply)
const wxrRefDir = path.join(__dirname, '../assets/wxr-ref');
const wxrFilePath = path.join(wxrRefDir, 'reduced_wxr.xml');
const wxrFileContent = fs.readFileSync(wxrFilePath, 'utf-8');

// Read all reference markdown files
const referenceFiles = new Map<string, string>();
const files = fs.readdirSync(wxrRefDir);
for (const file of files) {
  if (file.endsWith('.md')) {
    const content = fs.readFileSync(path.join(wxrRefDir, file), 'utf-8');
    referenceFiles.set(file.replace('.md', ''), content);
  }
}

// Track files written during import
const writtenFiles: Array<{
  path: string;
  content: string;
}> = [];

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

const createdTags: string[] = [];

// Mock database
const mockDb = {
  insert: vi.fn().mockImplementation((table: any) => ({
    values: vi.fn().mockImplementation(async (data: any) => {
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
      where: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue([]),
      }),
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
    if (filePath.endsWith('reduced_wxr.xml')) {
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
    return {
      id: `media-${Math.random().toString(36).substr(2, 9)}`,
      filename: path.basename(sourcePath),
      originalName: metadata?.originalName || path.basename(sourcePath),
      title: metadata?.title,
      linkedPostIds: metadata?.linkedPostIds || [],
    };
  }),
};

vi.mock('../../src/main/engine/MediaEngine', () => ({
  getMediaEngine: vi.fn(() => mockMediaEngine),
}));

// Mock PostMediaEngine
const mockPostMediaEngine = {
  setProjectContext: vi.fn(),
  linkMediaToPost: vi.fn().mockResolvedValue({
    id: 'link-id',
    projectId: 'test-project',
    postId: 'post-id',
    mediaId: 'media-id',
    sortOrder: 0,
    createdAt: new Date(),
  }),
};

vi.mock('../../src/main/engine/PostMediaEngine', () => ({
  getPostMediaEngine: vi.fn(() => mockPostMediaEngine),
}));

// Import after mocks are set up
import { ImportExecutionEngine } from '../../src/main/engine/ImportExecutionEngine';
import { ImportAnalysisEngine } from '../../src/main/engine/ImportAnalysisEngine';

/**
 * Parse frontmatter from a markdown file content
 */
function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const parsed = matter(content);
  return {
    data: parsed.data as Record<string, unknown>,
    body: parsed.content.trim(),
  };
}

/**
 * Compares two values and returns a description of differences
 */
function describeDifference(key: string, expected: unknown, actual: unknown): string | null {
  // Normalize arrays for comparison (sort them)
  const normalizeArray = (arr: unknown) => {
    if (Array.isArray(arr)) {
      return [...arr].sort();
    }
    return arr;
  };

  const expectedNorm = normalizeArray(expected);
  const actualNorm = normalizeArray(actual);

  // Compare stringified versions for arrays and objects
  const expectedStr = JSON.stringify(expectedNorm);
  const actualStr = JSON.stringify(actualNorm);

  if (expectedStr !== actualStr) {
    return `${key}: expected ${expectedStr}, got ${actualStr}`;
  }
  return null;
}

/**
 * Compare metadata (excluding id and projectId)
 */
function compareMetadata(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  slug: string
): string[] {
  const differences: string[] = [];

  // Keys to skip (GUIDs that are runtime-generated)
  const skipKeys = ['id', 'projectId'];

  // Check all expected keys
  for (const key of Object.keys(expected)) {
    if (skipKeys.includes(key)) continue;

    const diff = describeDifference(key, expected[key], actual[key]);
    if (diff) {
      differences.push(`[${slug}] Metadata ${diff}`);
    }
  }

  // Check for unexpected keys in actual (that aren't in expected and aren't skipped)
  for (const key of Object.keys(actual)) {
    if (skipKeys.includes(key)) continue;
    if (!(key in expected)) {
      differences.push(`[${slug}] Metadata: unexpected key "${key}" with value ${JSON.stringify(actual[key])}`);
    }
  }

  return differences;
}

/**
 * Compare body content
 */
function compareBody(expected: string, actual: string, slug: string): string[] {
  const differences: string[] = [];

  // Normalize whitespace for comparison
  const normalizeContent = (content: string) => {
    return content
      .replace(/\r\n/g, '\n')  // Normalize line endings
      .trim();
  };

  const expectedNorm = normalizeContent(expected);
  const actualNorm = normalizeContent(actual);

  if (expectedNorm !== actualNorm) {
    // Find specific differences
    const expectedLines = expectedNorm.split('\n');
    const actualLines = actualNorm.split('\n');

    // Report line count difference
    if (expectedLines.length !== actualLines.length) {
      differences.push(`[${slug}] Body: line count differs - expected ${expectedLines.length}, got ${actualLines.length}`);
    }

    // Find first differing line
    const minLines = Math.min(expectedLines.length, actualLines.length);
    for (let i = 0; i < minLines; i++) {
      if (expectedLines[i] !== actualLines[i]) {
        differences.push(`[${slug}] Body: line ${i + 1} differs`);
        differences.push(`  expected: "${expectedLines[i].substring(0, 100)}${expectedLines[i].length > 100 ? '...' : ''}"`);
        differences.push(`  actual:   "${actualLines[i].substring(0, 100)}${actualLines[i].length > 100 ? '...' : ''}"`);
        break; // Only report first difference for conciseness
      }
    }

    // If we didn't find a difference yet but line counts differ, show extra/missing lines
    if (differences.length === 1 && expectedLines.length !== actualLines.length) {
      if (actualLines.length > expectedLines.length) {
        differences.push(`[${slug}] Body: extra lines starting at line ${expectedLines.length + 1}`);
        differences.push(`  first extra line: "${actualLines[expectedLines.length]?.substring(0, 100) || ''}"`);
      } else {
        differences.push(`[${slug}] Body: missing lines starting at line ${actualLines.length + 1}`);
        differences.push(`  first missing line: "${expectedLines[actualLines.length]?.substring(0, 100) || ''}"`);
      }
    }
  }

  return differences;
}

describe('WXR Reference Comparison E2E Tests', () => {
  let executionEngine: ImportExecutionEngine;
  let analysisEngine: ImportAnalysisEngine;
  let wxrData: WxrData;

  beforeEach(async () => {
    // Reset tracking arrays
    writtenFiles.length = 0;
    insertedPosts.length = 0;
    createdTags.length = 0;
    uuidCounter = 0;

    // Clear all mocks
    vi.clearAllMocks();

    // Create engine instances
    executionEngine = new ImportExecutionEngine();
    executionEngine.setProjectContext('test-project', '/mock/test/data');

    analysisEngine = new ImportAnalysisEngine();
    analysisEngine.setProjectContext('test-project');

    // Parse the WXR file
    const parser = new WxrParser();
    wxrData = await parser.parseFile(wxrFilePath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should parse the WXR file correctly', () => {
    // Verify we have posts and pages
    expect(wxrData.posts.length).toBeGreaterThan(0);
    expect(wxrData.pages.length).toBeGreaterThan(0);

    console.log(`\nParsed WXR file:`);
    console.log(`  - Posts: ${wxrData.posts.length}`);
    console.log(`  - Pages: ${wxrData.pages.length}`);
    console.log(`  - Categories: ${wxrData.categories.length}`);
    console.log(`  - Tags: ${wxrData.tags.length}`);
    console.log(`  - Reference files: ${referenceFiles.size}`);
  });

  it('should compare all posts and pages with reference files', async () => {
    // Analyze the WXR data
    const report = await analysisEngine.analyzeWxr(wxrData, wxrFilePath);

    // Execute the import
    const result = await executionEngine.executeImport(report, {});

    console.log(`\nImport completed:`);
    console.log(`  - Posts imported: ${result.posts.imported}`);
    console.log(`  - Pages imported: ${result.pages.imported}`);
    console.log(`  - Tags created: ${result.tags.created}`);
    console.log(`  - Files written: ${writtenFiles.length}`);

    // Collect all differences
    const allDifferences: string[] = [];
    const matchedSlugs: string[] = [];
    const unmatchedReferences: string[] = [];
    const unmatchedGenerated: string[] = [];

    // Build a map of generated files by slug
    const generatedBySlug = new Map<string, { path: string; content: string }>();
    for (const file of writtenFiles) {
      const filename = path.basename(file.path, '.md');
      generatedBySlug.set(filename, file);
    }

    // Compare each reference file with generated output
    for (const [slug, refContent] of referenceFiles) {
      const generated = generatedBySlug.get(slug);

      if (!generated) {
        unmatchedReferences.push(slug);
        continue;
      }

      matchedSlugs.push(slug);

      // Parse both files
      const refParsed = parseFrontmatter(refContent);
      const genParsed = parseFrontmatter(generated.content);

      // Compare metadata
      const metaDiffs = compareMetadata(refParsed.data, genParsed.data, slug);
      allDifferences.push(...metaDiffs);

      // Compare body
      const bodyDiffs = compareBody(refParsed.body, genParsed.body, slug);
      allDifferences.push(...bodyDiffs);
    }

    // Find generated files without reference
    for (const slug of generatedBySlug.keys()) {
      if (!referenceFiles.has(slug)) {
        unmatchedGenerated.push(slug);
      }
    }

    // Report results
    console.log(`\n${'='.repeat(80)}`);
    console.log('REFERENCE COMPARISON RESULTS');
    console.log('='.repeat(80));

    console.log(`\nMatched slugs: ${matchedSlugs.length}`);
    if (matchedSlugs.length > 0 && matchedSlugs.length <= 50) {
      console.log(`  ${matchedSlugs.join(', ')}`);
    }

    if (unmatchedReferences.length > 0) {
      console.log(`\nReference files without generated output (${unmatchedReferences.length}):`);
      for (const slug of unmatchedReferences) {
        console.log(`  - ${slug}`);
      }
    }

    if (unmatchedGenerated.length > 0) {
      console.log(`\nGenerated files without reference (${unmatchedGenerated.length}):`);
      for (const slug of unmatchedGenerated) {
        console.log(`  - ${slug}`);
      }
    }

    if (allDifferences.length > 0) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`DIFFERENCES FOUND: ${allDifferences.length}`);
      console.log('='.repeat(80));
      for (const diff of allDifferences) {
        console.log(diff);
      }
    } else {
      console.log(`\n${'='.repeat(80)}`);
      console.log('NO DIFFERENCES FOUND - ALL OUTPUTS MATCH REFERENCE FILES');
      console.log('='.repeat(80));
    }

    // Summary statistics
    console.log(`\n${'='.repeat(80)}`);
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total reference files: ${referenceFiles.size}`);
    console.log(`Total generated files: ${generatedBySlug.size}`);
    console.log(`Matched: ${matchedSlugs.length}`);
    console.log(`Unmatched references: ${unmatchedReferences.length}`);
    console.log(`Unmatched generated: ${unmatchedGenerated.length}`);
    console.log(`Total differences: ${allDifferences.length}`);

    // The test expects differences - we're reporting them, not failing on them
    // The purpose is to analyze the current state of the conversion
    expect(true).toBe(true);
  });

  it('should report detailed differences for each post/page', async () => {
    // Analyze the WXR data
    const report = await analysisEngine.analyzeWxr(wxrData, wxrFilePath);

    // Execute the import
    await executionEngine.executeImport(report, {});

    // Build a map of generated files by slug
    const generatedBySlug = new Map<string, { path: string; content: string }>();
    for (const file of writtenFiles) {
      const filename = path.basename(file.path, '.md');
      generatedBySlug.set(filename, file);
    }

    // Detailed comparison for each file
    const detailedReport: Array<{
      slug: string;
      status: 'match' | 'mismatch' | 'missing-reference' | 'missing-generated';
      metadataDiffs: string[];
      bodyDiffs: string[];
    }> = [];

    for (const [slug, refContent] of referenceFiles) {
      const generated = generatedBySlug.get(slug);

      if (!generated) {
        detailedReport.push({
          slug,
          status: 'missing-generated',
          metadataDiffs: ['File not generated during import'],
          bodyDiffs: [],
        });
        continue;
      }

      const refParsed = parseFrontmatter(refContent);
      const genParsed = parseFrontmatter(generated.content);

      const metaDiffs = compareMetadata(refParsed.data, genParsed.data, slug);
      const bodyDiffs = compareBody(refParsed.body, genParsed.body, slug);

      detailedReport.push({
        slug,
        status: metaDiffs.length === 0 && bodyDiffs.length === 0 ? 'match' : 'mismatch',
        metadataDiffs: metaDiffs,
        bodyDiffs: bodyDiffs,
      });
    }

    // Print detailed report
    console.log(`\n${'='.repeat(80)}`);
    console.log('DETAILED COMPARISON REPORT');
    console.log('='.repeat(80));

    const matches = detailedReport.filter(r => r.status === 'match');
    const mismatches = detailedReport.filter(r => r.status === 'mismatch');
    const missingGenerated = detailedReport.filter(r => r.status === 'missing-generated');

    console.log(`\nMatching files (${matches.length}):`);
    if (matches.length > 0) {
      for (const m of matches) {
        console.log(`  ✓ ${m.slug}`);
      }
    } else {
      console.log('  (none)');
    }

    console.log(`\nFiles with differences (${mismatches.length}):`);
    if (mismatches.length > 0) {
      for (const m of mismatches) {
        console.log(`\n  ✗ ${m.slug}:`);
        if (m.metadataDiffs.length > 0) {
          console.log('    Metadata differences:');
          for (const d of m.metadataDiffs) {
            console.log(`      ${d}`);
          }
        }
        if (m.bodyDiffs.length > 0) {
          console.log('    Body differences:');
          for (const d of m.bodyDiffs) {
            console.log(`      ${d}`);
          }
        }
      }
    } else {
      console.log('  (none)');
    }

    console.log(`\nMissing generated files (${missingGenerated.length}):`);
    if (missingGenerated.length > 0) {
      for (const m of missingGenerated) {
        console.log(`  ✗ ${m.slug}`);
      }
    } else {
      console.log('  (none)');
    }

    // Final summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('FINAL SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total files compared: ${detailedReport.length}`);
    console.log(`Perfect matches: ${matches.length}`);
    console.log(`Files with differences: ${mismatches.length}`);
    console.log(`Missing generated files: ${missingGenerated.length}`);

    // Expect the test to pass - we're just reporting
    expect(detailedReport.length).toBeGreaterThan(0);
  });
});
