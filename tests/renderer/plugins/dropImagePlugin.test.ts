/**
 * Tests for the drop image plugin validation logic.
 */
import { describe, it, expect } from 'vitest';
import { hasImageFiles, SUPPORTED_IMAGE_EXTENSIONS } from '../../../src/renderer/plugins/dropImagePlugin';

function makeFile(name: string): File {
  return new File([''], name, { type: 'application/octet-stream' });
}

describe('dropImagePlugin', () => {
  describe('SUPPORTED_IMAGE_EXTENSIONS', () => {
    it('should include common image formats', () => {
      expect(SUPPORTED_IMAGE_EXTENSIONS.has('jpg')).toBe(true);
      expect(SUPPORTED_IMAGE_EXTENSIONS.has('jpeg')).toBe(true);
      expect(SUPPORTED_IMAGE_EXTENSIONS.has('png')).toBe(true);
      expect(SUPPORTED_IMAGE_EXTENSIONS.has('gif')).toBe(true);
      expect(SUPPORTED_IMAGE_EXTENSIONS.has('webp')).toBe(true);
      expect(SUPPORTED_IMAGE_EXTENSIONS.has('svg')).toBe(true);
      expect(SUPPORTED_IMAGE_EXTENSIONS.has('bmp')).toBe(true);
    });

    it('should not include non-image formats', () => {
      expect(SUPPORTED_IMAGE_EXTENSIONS.has('pdf')).toBe(false);
      expect(SUPPORTED_IMAGE_EXTENSIONS.has('txt')).toBe(false);
      expect(SUPPORTED_IMAGE_EXTENSIONS.has('mp4')).toBe(false);
    });
  });

  describe('hasImageFiles', () => {
    it('should return true for a single image file', () => {
      expect(hasImageFiles([makeFile('photo.jpg')])).toBe(true);
      expect(hasImageFiles([makeFile('image.PNG')])).toBe(true);
      expect(hasImageFiles([makeFile('graphic.webp')])).toBe(true);
    });

    it('should return true for multiple image files', () => {
      expect(hasImageFiles([makeFile('a.jpg'), makeFile('b.png'), makeFile('c.gif')])).toBe(true);
    });

    it('should return false for non-image files', () => {
      expect(hasImageFiles([makeFile('document.pdf')])).toBe(false);
      expect(hasImageFiles([makeFile('readme.txt')])).toBe(false);
    });

    it('should return false when mixed with non-image files', () => {
      expect(hasImageFiles([makeFile('photo.jpg'), makeFile('doc.pdf')])).toBe(false);
    });

    it('should return false for empty list', () => {
      expect(hasImageFiles([])).toBe(false);
    });

    it('should return false for null-ish input', () => {
      expect(hasImageFiles(null as unknown as File[])).toBe(false);
      expect(hasImageFiles(undefined as unknown as File[])).toBe(false);
    });
  });
});
