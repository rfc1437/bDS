/**
 * Tests for photo_archive hydration logic
 * 
 * Tests the actual hydration path used by Editor.tsx to verify
 * that year/month parameters correctly filter images.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import photoArchiveMacro from '../../../src/renderer/macros/definitions/photo_archive';
import { parseMacros, getMacro, registerMacro, clearMacros } from '../../../src/renderer/macros/registry';

/**
 * Replicate the exact markdownToHtml and renderMacroSync from Editor.tsx
 */
function renderMacroSync(name: string, params: Record<string, string>, postId?: string): string {
  const macro = getMacro(name);
  if (!macro) {
    return `<span class="macro-error">Unknown macro: ${name}</span>`;
  }
  try {
    const result = macro.render(params, { postId, isPreview: true });
    if (result instanceof Promise) {
      return `<div class="macro-loading">Loading ${name}...</div>`;
    }
    return result;
  } catch (e) {
    return `<span class="macro-error">Error rendering ${name}</span>`;
  }
}

function markdownToHtml(markdown: string, postId?: string): string {
  const macros = parseMacros(markdown);
  let result = markdown;
  
  // Replace macros from end to start to preserve positions
  for (let i = macros.length - 1; i >= 0; i--) {
    const macro = macros[i];
    const rendered = renderMacroSync(macro.name, macro.params, postId);
    result = result.slice(0, macro.start) + rendered + result.slice(macro.end);
  }
  
  return result;
}

// Mock media data: 6 months in 2020, 6 months in 2019, 1 image per month
function createMockMediaDatabase() {
  const media: Array<{
    id: string;
    originalName: string;
    mimeType: string;
    createdAt: Date;
  }> = [];

  // 2020: January through June (6 months)
  for (let month = 0; month < 6; month++) {
    media.push({
      id: `img-2020-${month + 1}`,
      originalName: `photo-2020-${month + 1}.jpg`,
      mimeType: 'image/jpeg',
      createdAt: new Date(Date.UTC(2020, month, 15)),
    });
  }

  // 2019: July through December (6 months)
  for (let month = 6; month < 12; month++) {
    media.push({
      id: `img-2019-${month + 1}`,
      originalName: `photo-2019-${month + 1}.jpg`,
      mimeType: 'image/jpeg',
      createdAt: new Date(Date.UTC(2019, month, 15)),
    });
  }

  return media;
}

// Simulate the media.filter API behavior from MediaEngine
function createMockMediaFilter(allMedia: ReturnType<typeof createMockMediaDatabase>) {
  return async (filter: { year?: number; month?: number }) => {
    let result = [...allMedia];

    if (filter.year !== undefined) {
      const startOfYear = new Date(Date.UTC(filter.year, 0, 1));
      const endOfYear = new Date(Date.UTC(filter.year + 1, 0, 1));
      result = result.filter(m => m.createdAt >= startOfYear && m.createdAt < endOfYear);
    }

    if (filter.month !== undefined && filter.year !== undefined) {
      const startOfMonth = new Date(Date.UTC(filter.year, filter.month, 1));
      const endOfMonth = new Date(Date.UTC(filter.year, filter.month + 1, 1));
      result = result.filter(m => m.createdAt >= startOfMonth && m.createdAt < endOfMonth);
    }

    return result;
  };
}

// Extract the core hydration logic to test it
type ImageData = { id: string; originalName: string; mimeType: string; createdAt?: Date };

interface ArchiveResult {
  mode: 'single-month' | 'full-year' | 'recent';
  year?: number;
  month?: number;
  images?: ImageData[];
  monthlyImages?: Map<string | number, ImageData[]>;
  totalImages: number;
  monthCount: number;
}

/**
 * Simulates the hydration logic from Editor.tsx doHydratePhotoArchive
 */
async function hydratePhotoArchive(
  dataAttrs: { recent?: string; year?: string; month?: string },
  mediaFilter: (filter: { year?: number; month?: number }) => Promise<ImageData[]>
): Promise<ArchiveResult> {
  const { recent: recentStr, year: yearStr, month: monthStr } = dataAttrs;

  if (recentStr) {
    // Recent mode: get last N months with images
    const recentCount = parseInt(recentStr, 10) || 10;

    // Fetch all images (no filter)
    const allMedia = await mediaFilter({});
    const allImages = allMedia.filter(m => m.mimeType?.startsWith('image/'));

    // Group by year-month and sort by most recent
    const monthlyMap = new Map<string, ImageData[]>();
    for (const img of allImages) {
      if (!img.createdAt) continue;
      const date = new Date(img.createdAt);
      const year = date.getFullYear();
      const month = date.getMonth() + 1; // 1-based
      const key = `${year}-${String(month).padStart(2, '0')}`; // e.g. "2024-06"

      if (!monthlyMap.has(key)) {
        monthlyMap.set(key, []);
      }
      monthlyMap.get(key)!.push(img);
    }

    // Sort by key descending (newest first) and take top N
    const sortedKeys = Array.from(monthlyMap.keys()).sort().reverse().slice(0, recentCount);
    const recentMonthlyImages = new Map<string, ImageData[]>();

    for (const key of sortedKeys) {
      recentMonthlyImages.set(key, monthlyMap.get(key)!);
    }

    const totalImages = Array.from(recentMonthlyImages.values()).reduce((sum, imgs) => sum + imgs.length, 0);
    return {
      mode: 'recent',
      monthlyImages: recentMonthlyImages,
      totalImages,
      monthCount: recentMonthlyImages.size,
    };

  } else if (yearStr) {
    const year = parseInt(yearStr, 10);
    const month = monthStr ? parseInt(monthStr, 10) : undefined;

    if (month !== undefined) {
      // Single month view
      const mediaItems = await mediaFilter({
        year,
        month: month - 1, // API uses 0-based month
      });
      const images = mediaItems.filter(m => m.mimeType?.startsWith('image/'));

      return {
        mode: 'single-month',
        year,
        month,
        images,
        totalImages: images.length,
        monthCount: images.length > 0 ? 1 : 0,
      };
    } else {
      // Full year view - collect all months
      const monthlyImages = new Map<number, ImageData[]>();

      for (let m = 0; m < 12; m++) {
        const mediaItems = await mediaFilter({
          year,
          month: m,
        });
        const images = mediaItems.filter(item => item.mimeType?.startsWith('image/'));

        if (images.length > 0) {
          monthlyImages.set(m + 1, images); // Store with 1-based month key
        }
      }

      const totalImages = Array.from(monthlyImages.values()).reduce((sum, imgs) => sum + imgs.length, 0);
      return {
        mode: 'full-year',
        year,
        monthlyImages,
        totalImages,
        monthCount: monthlyImages.size,
      };
    }
  }

  throw new Error('No valid data attributes provided');
}

describe('photo_archive hydration', () => {
  let mockMedia: ReturnType<typeof createMockMediaDatabase>;
  let mockMediaFilter: ReturnType<typeof createMockMediaFilter>;

  beforeEach(() => {
    mockMedia = createMockMediaDatabase();
    mockMediaFilter = createMockMediaFilter(mockMedia);
  });

  describe('mock database setup', () => {
    it('should have 12 images total', () => {
      expect(mockMedia).toHaveLength(12);
    });

    it('should have 6 images in 2020 (Jan-Jun)', async () => {
      const images2020 = await mockMediaFilter({ year: 2020 });
      expect(images2020).toHaveLength(6);
    });

    it('should have 6 images in 2019 (Jul-Dec)', async () => {
      const images2019 = await mockMediaFilter({ year: 2019 });
      expect(images2019).toHaveLength(6);
    });

    it('should have 1 image in Feb 2020', async () => {
      const imagesFeb2020 = await mockMediaFilter({ year: 2020, month: 1 }); // 0-based month
      expect(imagesFeb2020).toHaveLength(1);
    });
  });

  describe('recent mode (no parameters)', () => {
    it('should return 10 months of images when data-recent="10"', async () => {
      const result = await hydratePhotoArchive(
        { recent: '10' },
        mockMediaFilter
      );

      expect(result.mode).toBe('recent');
      // We have 12 months total, but recent=10 should give us 10 months
      expect(result.monthCount).toBe(10);
      expect(result.totalImages).toBe(10);
    });

    it('should return months sorted newest first', async () => {
      const result = await hydratePhotoArchive(
        { recent: '10' },
        mockMediaFilter
      );

      const monthKeys = Array.from(result.monthlyImages!.keys()) as string[];
      // First should be 2020-06, last should be 2019-09 (skipping Jul, Aug of 2019)
      expect(monthKeys[0]).toBe('2020-06');
      expect(monthKeys[monthKeys.length - 1]).toBe('2019-09');
    });
  });

  describe('year mode (year parameter only)', () => {
    it('should return only 2019 images when year="2019"', async () => {
      const result = await hydratePhotoArchive(
        { year: '2019' },
        mockMediaFilter
      );

      expect(result.mode).toBe('full-year');
      expect(result.year).toBe(2019);
      expect(result.totalImages).toBe(6);
      expect(result.monthCount).toBe(6);
    });

    it('should return only 2020 images when year="2020"', async () => {
      const result = await hydratePhotoArchive(
        { year: '2020' },
        mockMediaFilter
      );

      expect(result.mode).toBe('full-year');
      expect(result.year).toBe(2020);
      expect(result.totalImages).toBe(6);
      expect(result.monthCount).toBe(6);
    });

    it('should NOT use recent mode when year is provided', async () => {
      const result = await hydratePhotoArchive(
        { year: '2019' },
        mockMediaFilter
      );

      // Should be full-year, NOT recent
      expect(result.mode).toBe('full-year');
      expect(result.mode).not.toBe('recent');
    });
  });

  describe('year+month mode', () => {
    it('should return 1 image for Feb 2020', async () => {
      const result = await hydratePhotoArchive(
        { year: '2020', month: '2' },
        mockMediaFilter
      );

      expect(result.mode).toBe('single-month');
      expect(result.year).toBe(2020);
      expect(result.month).toBe(2);
      expect(result.totalImages).toBe(1);
    });

    it('should return 0 images for a month with no images', async () => {
      const result = await hydratePhotoArchive(
        { year: '2020', month: '12' }, // December 2020 has no images
        mockMediaFilter
      );

      expect(result.mode).toBe('single-month');
      expect(result.totalImages).toBe(0);
    });
  });

  describe('full flow: macro render → DOM → hydration', () => {
    /**
     * Helper to extract data attributes from rendered macro HTML
     */
    function extractDataAttrsFromMacroHtml(html: string): { recent?: string; year?: string; month?: string } {
      const dom = new JSDOM(html);
      const el = dom.window.document.querySelector('.macro-photo-archive');
      if (!el) throw new Error('No .macro-photo-archive element found in HTML');
      
      return {
        recent: el.getAttribute('data-recent') || undefined,
        year: el.getAttribute('data-year') || undefined,
        month: el.getAttribute('data-month') || undefined,
      };
    }

    it('should render data-recent when no params and hydrate to recent mode', async () => {
      // Render macro with no parameters
      const html = photoArchiveMacro.render({}, { postId: 'test-post', isPreview: true });
      
      // Extract data attributes
      const dataAttrs = extractDataAttrsFromMacroHtml(html);
      
      // Should have data-recent, NOT data-year
      expect(dataAttrs.recent).toBe('10');
      expect(dataAttrs.year).toBeUndefined();
      
      // Hydrate using these attributes
      const result = await hydratePhotoArchive(dataAttrs, mockMediaFilter);
      expect(result.mode).toBe('recent');
      expect(result.monthCount).toBe(10);
    });

    it('should render data-year when year param given and hydrate to full-year mode', async () => {
      // Render macro with year="2019"
      const html = photoArchiveMacro.render({ year: '2019' }, { postId: 'test-post', isPreview: true });
      
      // Extract data attributes
      const dataAttrs = extractDataAttrsFromMacroHtml(html);
      
      // Should have data-year, NOT data-recent
      expect(dataAttrs.year).toBe('2019');
      expect(dataAttrs.recent).toBeUndefined();
      
      // Hydrate using these attributes
      const result = await hydratePhotoArchive(dataAttrs, mockMediaFilter);
      expect(result.mode).toBe('full-year');
      expect(result.year).toBe(2019);
      expect(result.totalImages).toBe(6);
    });

    it('should render data-year and data-month when both params given', async () => {
      // Render macro with year="2020" month="2"
      const html = photoArchiveMacro.render({ year: '2020', month: '2' }, { postId: 'test-post', isPreview: true });
      
      // Extract data attributes
      const dataAttrs = extractDataAttrsFromMacroHtml(html);
      
      // Should have data-year and data-month, NOT data-recent
      expect(dataAttrs.year).toBe('2020');
      expect(dataAttrs.month).toBe('2');
      expect(dataAttrs.recent).toBeUndefined();
      
      // Hydrate using these attributes
      const result = await hydratePhotoArchive(dataAttrs, mockMediaFilter);
      expect(result.mode).toBe('single-month');
      expect(result.year).toBe(2020);
      expect(result.month).toBe(2);
      expect(result.totalImages).toBe(1);
    });

    it('BUG: year="2020" should NOT load recent images', async () => {
      // This test verifies the bug the user reported
      const htmlWithYear = photoArchiveMacro.render({ year: '2020' }, { postId: 'test-post', isPreview: true });
      const htmlWithoutYear = photoArchiveMacro.render({}, { postId: 'test-post', isPreview: true });
      
      const attrsWithYear = extractDataAttrsFromMacroHtml(htmlWithYear);
      const attrsWithoutYear = extractDataAttrsFromMacroHtml(htmlWithoutYear);
      
      // The attributes MUST be different
      expect(attrsWithYear).not.toEqual(attrsWithoutYear);
      
      // With year: should have data-year, NOT data-recent
      expect(attrsWithYear.year).toBe('2020');
      expect(attrsWithYear.recent).toBeUndefined();
      
      // Without year: should have data-recent, NOT data-year
      expect(attrsWithoutYear.recent).toBe('10');
      expect(attrsWithoutYear.year).toBeUndefined();
      
      // Hydrate both and verify different results
      const resultWithYear = await hydratePhotoArchive(attrsWithYear, mockMediaFilter);
      const resultWithoutYear = await hydratePhotoArchive(attrsWithoutYear, mockMediaFilter);
      
      // With year=2020: should have 6 images (Jan-Jun 2020)
      expect(resultWithYear.mode).toBe('full-year');
      expect(resultWithYear.totalImages).toBe(6);
      
      // Without year: should have 10 images (recent 10 months)
      expect(resultWithoutYear.mode).toBe('recent');
      expect(resultWithoutYear.totalImages).toBe(10);
    });
  });

  describe('full flow from markdown: parseMacros → render → hydrate', () => {
    beforeEach(() => {
      clearMacros();
      registerMacro(photoArchiveMacro);
    });

    /**
     * Helper to extract data attributes from rendered macro HTML
     */
    function extractDataAttrsFromMacroHtml(html: string): { recent?: string; year?: string; month?: string } {
      const dom = new JSDOM(html);
      const el = dom.window.document.querySelector('.macro-photo-archive');
      if (!el) throw new Error('No .macro-photo-archive element found in HTML');
      
      return {
        recent: el.getAttribute('data-recent') || undefined,
        year: el.getAttribute('data-year') || undefined,
        month: el.getAttribute('data-month') || undefined,
      };
    }

    /**
     * Simulates what Editor.tsx does: parse markdown → render macros → extract attrs → hydrate
     */
    async function fullFlowFromMarkdown(markdown: string): Promise<ArchiveResult> {
      // Step 1: Parse macros from markdown (like parseMacros in registry.ts)
      const macros = parseMacros(markdown);
      expect(macros.length).toBeGreaterThan(0);
      
      const macro = macros[0];
      expect(macro.name).toBe('photo_archive');
      
      // Step 2: Get macro definition and render (like renderMacroSync in Editor.tsx)
      const definition = getMacro(macro.name);
      expect(definition).toBeDefined();
      
      const html = definition!.render(macro.params, { postId: 'test-post', isPreview: true });
      
      // Step 3: Parse HTML and extract data attributes (like querySelector in hydratePhotoArchive)
      const dataAttrs = extractDataAttrsFromMacroHtml(html);
      
      // Step 4: Hydrate using the extracted attributes
      return hydratePhotoArchive(dataAttrs, mockMediaFilter);
    }

    it('[[photo_archive]] should load recent 10 months', async () => {
      const result = await fullFlowFromMarkdown('Some text [[photo_archive]] more text');
      
      expect(result.mode).toBe('recent');
      expect(result.monthCount).toBe(10);
      expect(result.totalImages).toBe(10);
    });

    it('[[photo_archive year="2020"]] should load only 2020 images', async () => {
      const result = await fullFlowFromMarkdown('Some text [[photo_archive year="2020"]] more text');
      
      expect(result.mode).toBe('full-year');
      expect(result.year).toBe(2020);
      expect(result.totalImages).toBe(6);
      expect(result.monthCount).toBe(6);
    });

    it('[[photo_archive year="2019"]] should load only 2019 images', async () => {
      const result = await fullFlowFromMarkdown('Some text [[photo_archive year="2019"]] more text');
      
      expect(result.mode).toBe('full-year');
      expect(result.year).toBe(2019);
      expect(result.totalImages).toBe(6);
      expect(result.monthCount).toBe(6);
    });

    it('[[photo_archive year="2020" month="2"]] should load only Feb 2020', async () => {
      const result = await fullFlowFromMarkdown('Some text [[photo_archive year="2020" month="2"]] more text');
      
      expect(result.mode).toBe('single-month');
      expect(result.year).toBe(2020);
      expect(result.month).toBe(2);
      expect(result.totalImages).toBe(1);
    });

    it('BUG REPRO: params should be correctly parsed from markdown', () => {
      // Step 1: Parse macros with year parameter
      const macrosWithYear = parseMacros('[[photo_archive year="2020"]]');
      expect(macrosWithYear).toHaveLength(1);
      expect(macrosWithYear[0].params).toEqual({ year: '2020' });
      
      // Step 2: Parse macros without parameters
      const macrosWithoutParams = parseMacros('[[photo_archive]]');
      expect(macrosWithoutParams).toHaveLength(1);
      expect(macrosWithoutParams[0].params).toEqual({});
      
      // Step 3: Verify the params are DIFFERENT
      expect(macrosWithYear[0].params).not.toEqual(macrosWithoutParams[0].params);
    });
  });

  describe('Editor.tsx markdownToHtml exact flow', () => {
    beforeEach(() => {
      clearMacros();
      registerMacro(photoArchiveMacro);
    });

    it('USER BUG: [[photo_archive year=2016]] (unquoted) should NOT produce data-recent', () => {
      // This is the EXACT user scenario - unquoted parameter value
      const markdown = '[[photo_archive year=2016]]';
      
      // Step 1: Parse macros
      const macros = parseMacros(markdown);
      console.log('Parsed macros (unquoted):', JSON.stringify(macros, null, 2));
      expect(macros).toHaveLength(1);
      // BUG: This fails because PARAM_REGEX only matches quoted values
      expect(macros[0].params.year).toBe('2016');
      
      // Step 2: Render via markdownToHtml
      const html = markdownToHtml(markdown, 'test-post');
      console.log('Rendered HTML (unquoted):', html);
      
      // Step 3: Check the HTML does NOT have data-recent
      expect(html).not.toContain('data-recent=');
      expect(html).toContain('data-year="2016"');
    });

    it('USER BUG: [[photo_archive year="2016"]] (quoted) should NOT produce data-recent', () => {
      // This is the EXACT user scenario
      const markdown = '[[photo_archive year="2016"]]';
      
      // Step 1: Parse macros
      const macros = parseMacros(markdown);
      console.log('Parsed macros:', JSON.stringify(macros, null, 2));
      expect(macros).toHaveLength(1);
      expect(macros[0].params.year).toBe('2016');
      
      // Step 2: Render via markdownToHtml
      const html = markdownToHtml(markdown, 'test-post');
      console.log('Rendered HTML:', html);
      
      // Step 3: Check the HTML does NOT have data-recent
      expect(html).not.toContain('data-recent=');
      expect(html).toContain('data-year="2016"');
    });

    it('markdownToHtml with [[photo_archive]] produces data-recent', () => {
      const html = markdownToHtml('Test [[photo_archive]] end', 'post-123');
      
      expect(html).toContain('data-recent="10"');
      expect(html).not.toContain('data-year=');
    });

    it('markdownToHtml with [[photo_archive year="2020"]] produces data-year', () => {
      const html = markdownToHtml('Test [[photo_archive year="2020"]] end', 'post-123');
      
      expect(html).toContain('data-year="2020"');
      expect(html).not.toContain('data-recent=');
    });

    it('markdownToHtml with [[photo_archive year="2020" month="2"]] produces both', () => {
      const html = markdownToHtml('Test [[photo_archive year="2020" month="2"]] end', 'post-123');
      
      expect(html).toContain('data-year="2020"');
      expect(html).toContain('data-month="2"');
      expect(html).not.toContain('data-recent=');
    });

    it('CRITICAL BUG TEST: verify params flow correctly through markdownToHtml', () => {
      // This tests the exact code path in Editor.tsx
      const markdown = 'Content with [[photo_archive year="2019"]] macro';
      
      // 1. parseMacros should extract params correctly
      const macros = parseMacros(markdown);
      expect(macros[0].params.year).toBe('2019');
      
      // 2. markdownToHtml should produce correct HTML
      const html = markdownToHtml(markdown, 'test-post');
      
      // 3. HTML should have data-year, NOT data-recent
      const dom = new JSDOM(html);
      const el = dom.window.document.querySelector('.macro-photo-archive');
      
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-year')).toBe('2019');
      expect(el!.getAttribute('data-recent')).toBeNull();
    });
  });
});
