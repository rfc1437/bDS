/**
 * Tests for markdown escape utility functions
 * Validates that macro syntax is properly unescaped after Milkdown serialization
 */

import { describe, it, expect } from 'vitest';
import { unescapeMacroSyntax } from '../../../src/renderer/utils/markdownEscape';

describe('unescapeMacroSyntax', () => {
  describe('bracket unescaping', () => {
    it('should unescape brackets in macro syntax', () => {
      const input = '\\[\\[gallery\\]\\]';
      const expected = '[[gallery]]';
      expect(unescapeMacroSyntax(input)).toBe(expected);
    });

    it('should unescape brackets with parameters', () => {
      const input = '\\[\\[gallery id="123"\\]\\]';
      const expected = '[[gallery id="123"]]';
      expect(unescapeMacroSyntax(input)).toBe(expected);
    });

    it('should handle single escaped brackets that are not part of macros', () => {
      const input = 'Array access: arr\\[0\\]';
      const expected = 'Array access: arr[0]';
      expect(unescapeMacroSyntax(input)).toBe(expected);
    });
  });

  describe('underscore unescaping inside macros', () => {
    it('should unescape underscores in macro names', () => {
      const input = '[[photo\\_gallery]]';
      const expected = '[[photo_gallery]]';
      expect(unescapeMacroSyntax(input)).toBe(expected);
    });

    it('should unescape underscores in macro parameters', () => {
      const input = '[[gallery archive\\_id="photo\\_collection"]]';
      const expected = '[[gallery archive_id="photo_collection"]]';
      expect(unescapeMacroSyntax(input)).toBe(expected);
    });

    it('should handle multiple underscores in macro', () => {
      const input = '[[my\\_custom\\_macro\\_name param\\_one="value\\_one"]]';
      const expected = '[[my_custom_macro_name param_one="value_one"]]';
      expect(unescapeMacroSyntax(input)).toBe(expected);
    });

    it('should NOT unescape underscores outside of macros', () => {
      // Outside macros, escaped underscores should remain escaped 
      // as they may be intentional escaping for emphasis prevention
      const input = 'some\\_text with [[photo\\_gallery]] more\\_text';
      const expected = 'some\\_text with [[photo_gallery]] more\\_text';
      expect(unescapeMacroSyntax(input)).toBe(expected);
    });
  });

  describe('combined escaping', () => {
    it('should handle both escaped brackets and underscores', () => {
      const input = '\\[\\[photo\\_gallery archive\\_id="123"\\]\\]';
      const expected = '[[photo_gallery archive_id="123"]]';
      expect(unescapeMacroSyntax(input)).toBe(expected);
    });

    it('should handle macro in middle of text', () => {
      const input = 'Check out this \\[\\[photo\\_gallery\\]\\] for more photos.';
      const expected = 'Check out this [[photo_gallery]] for more photos.';
      expect(unescapeMacroSyntax(input)).toBe(expected);
    });

    it('should handle multiple macros in text', () => {
      const input = '\\[\\[photo\\_gallery\\]\\] and \\[\\[video\\_player id="1"\\]\\]';
      const expected = '[[photo_gallery]] and [[video_player id="1"]]';
      expect(unescapeMacroSyntax(input)).toBe(expected);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(unescapeMacroSyntax('')).toBe('');
    });

    it('should handle string with no escaping', () => {
      const input = '[[gallery]] plain text';
      expect(unescapeMacroSyntax(input)).toBe(input);
    });

    it('should handle macros that are already properly formatted', () => {
      const input = '[[photo_gallery id="123"]]';
      expect(unescapeMacroSyntax(input)).toBe(input);
    });

    it('should handle incomplete macro syntax', () => {
      const input = '\\[\\[incomplete';
      const expected = '[[incomplete';
      expect(unescapeMacroSyntax(input)).toBe(expected);
    });
  });
});
