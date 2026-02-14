/**
 * Tests for the photo_archive Macro
 * 
 * This macro creates a photo gallery organized by year and month,
 * dynamically loading images from the media library based on their creation date.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { clearMacros, getMacro, registerMacro } from '../../../src/renderer/macros/registry';
import type { MacroParams, MacroRenderContext } from '../../../src/renderer/macros/types';
import photoArchiveMacro from '../../../src/renderer/macros/definitions/photo_archive';

describe('photo_archive macro', () => {
  beforeEach(() => {
    clearMacros();
    // Re-register the macro for each test
    registerMacro(photoArchiveMacro);
  });

  describe('validation', () => {
    it('should accept no parameters (recent mode)', () => {
      const macro = getMacro('photo_archive');
      
      expect(macro).toBeDefined();
      const error = macro!.validate?.({});
      expect(error).toBeUndefined();
    });

    it('should reject non-numeric year', () => {
      const macro = getMacro('photo_archive');
      
      const error = macro!.validate?.({ year: 'abc' });
      expect(error).toBe('Year must be a valid 4-digit year (e.g., 2024)');
    });

    it('should reject year out of range', () => {
      const macro = getMacro('photo_archive');
      
      const error = macro!.validate?.({ year: '999' });
      expect(error).toBe('Year must be a valid 4-digit year (e.g., 2024)');
    });

    it('should accept valid year only', () => {
      const macro = getMacro('photo_archive');
      
      const error = macro!.validate?.({ year: '2024' });
      expect(error).toBeUndefined();
    });

    it('should reject invalid month', () => {
      const macro = getMacro('photo_archive');
      
      const error = macro!.validate?.({ year: '2024', month: '13' });
      expect(error).toBe('Month must be a number between 1 and 12');
    });

    it('should reject month of zero', () => {
      const macro = getMacro('photo_archive');
      
      const error = macro!.validate?.({ year: '2024', month: '0' });
      expect(error).toBe('Month must be a number between 1 and 12');
    });

    it('should accept valid year and month', () => {
      const macro = getMacro('photo_archive');
      
      const error = macro!.validate?.({ year: '2024', month: '6' });
      expect(error).toBeUndefined();
    });
  });

  describe('editorPreview', () => {
    it('should show year-only preview when no month', () => {
      const macro = getMacro('photo_archive');
      
      const preview = macro!.editorPreview?.({ year: '2024' });
      expect(preview).toBe('📅 Photo Archive: 2024');
    });

    it('should show year and month in preview', () => {
      const macro = getMacro('photo_archive');
      
      const preview = macro!.editorPreview?.({ year: '2024', month: '6' });
      expect(preview).toBe('📅 Photo Archive: June 2024');
    });

    it('should handle all months correctly', () => {
      const macro = getMacro('photo_archive');
      
      const months = [
        { month: '1', expected: 'January' },
        { month: '2', expected: 'February' },
        { month: '3', expected: 'March' },
        { month: '4', expected: 'April' },
        { month: '5', expected: 'May' },
        { month: '6', expected: 'June' },
        { month: '7', expected: 'July' },
        { month: '8', expected: 'August' },
        { month: '9', expected: 'September' },
        { month: '10', expected: 'October' },
        { month: '11', expected: 'November' },
        { month: '12', expected: 'December' },
      ];

      for (const { month, expected } of months) {
        const preview = macro!.editorPreview?.({ year: '2024', month });
        expect(preview).toContain(expected);
      }
    });
  });

  describe('render - year only', () => {
    it('should render wrapper with year data attribute', () => {
      const macro = getMacro('photo_archive');
      const context: MacroRenderContext = { isPreview: true, postId: 'test-post-id' };
      
      const html = macro!.render({ year: '2024' }, context);
      
      expect(html).toContain('data-year="2024"');
      expect(html).toContain('macro-photo-archive');
    });

    it('should not include month attribute when only year provided', () => {
      const macro = getMacro('photo_archive');
      const context: MacroRenderContext = { isPreview: true, postId: 'test-post-id' };
      
      const html = macro!.render({ year: '2024' }, context);
      
      expect(html).not.toContain('data-month=');
    });

    it('should include post-id data attribute when available', () => {
      const macro = getMacro('photo_archive');
      const context: MacroRenderContext = { isPreview: true, postId: 'post-123' };
      
      const html = macro!.render({ year: '2024' }, context);
      
      expect(html).toContain('data-post-id="post-123"');
    });

    it('should include loading placeholder', () => {
      const macro = getMacro('photo_archive');
      const context: MacroRenderContext = { isPreview: true, postId: 'test-post-id' };
      
      const html = macro!.render({ year: '2024' }, context);
      
      expect(html).toContain('photo-archive-loading');
      expect(html).toContain('Loading photo archive');
    });
  });

  describe('render - year and month', () => {
    it('should render with both year and month data attributes', () => {
      const macro = getMacro('photo_archive');
      const context: MacroRenderContext = { isPreview: true, postId: 'test-post-id' };
      
      const html = macro!.render({ year: '2024', month: '6' }, context);
      
      expect(html).toContain('data-year="2024"');
      expect(html).toContain('data-month="6"');
    });

    it('should have single-month class when month specified', () => {
      const macro = getMacro('photo_archive');
      const context: MacroRenderContext = { isPreview: true, postId: 'test-post-id' };
      
      const html = macro!.render({ year: '2024', month: '6' }, context);
      
      expect(html).toContain('photo-archive-single-month');
    });
  });

  describe('render - no parameters (recent mode)', () => {
    it('should accept no parameters', () => {
      const macro = getMacro('photo_archive');
      
      const error = macro!.validate?.({});
      expect(error).toBeUndefined();
    });

    it('should render with data-recent attribute when no params', () => {
      const macro = getMacro('photo_archive');
      const context: MacroRenderContext = { isPreview: true, postId: 'test-post-id' };
      
      const html = macro!.render({}, context);
      
      expect(html).toContain('data-recent="10"');
      expect(html).not.toContain('data-year=');
    });

    it('should have recent-months class when no params', () => {
      const macro = getMacro('photo_archive');
      const context: MacroRenderContext = { isPreview: true, postId: 'test-post-id' };
      
      const html = macro!.render({}, context);
      
      expect(html).toContain('photo-archive-recent-months');
    });

    it('should show appropriate loading message for recent mode', () => {
      const macro = getMacro('photo_archive');
      const context: MacroRenderContext = { isPreview: true, postId: 'test-post-id' };
      
      const html = macro!.render({}, context);
      
      expect(html).toContain('Loading recent photos');
    });

    it('should show recent photos preview', () => {
      const macro = getMacro('photo_archive');
      
      const preview = macro!.editorPreview?.({});
      expect(preview).toBe('📅 Photo Archive: Recent');
    });

    it('should include post-id data attribute in recent mode', () => {
      const macro = getMacro('photo_archive');
      const context: MacroRenderContext = { isPreview: true, postId: 'post-123' };
      
      const html = macro!.render({}, context);
      
      expect(html).toContain('data-post-id="post-123"');
    });
  });

  describe('self-registration', () => {
    it('should self-register on import', () => {
      const macro = getMacro('photo_archive');
      expect(macro).toBeDefined();
      expect(macro!.name).toBe('photo_archive');
    });

    it('should have proper description', () => {
      const macro = getMacro('photo_archive');
      expect(macro!.description).toContain('photo');
      expect(macro!.description.toLowerCase()).toContain('archive');
    });
  });
});
