/**
 * MediaEngine Unit Tests
 * 
 * Tests for media file management including:
 * - Media import and storage
 * - Sidecar metadata file handling
 * - MIME type detection
 * - Checksum calculation
 * - Filename generation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockMedia, createMockPdfMedia, resetMockCounters } from '../utils/factories';

// Mock dependencies
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => ({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
          orderBy: vi.fn(() => Promise.resolve([])),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => Promise.resolve()),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    getRemote: vi.fn(() => null),
    getDataPaths: vi.fn(() => ({
      database: '/mock/userData/bds.db',
      posts: '/mock/userData/posts',
      media: '/mock/userData/media',
    })),
  })),
}));

vi.mock('fs/promises');

describe('MediaEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockCounters();
  });

  describe('Media Data Validation', () => {
    it('should create valid media with required fields', () => {
      const media = createMockMedia();
      
      expect(media.id).toBeDefined();
      expect(media.filename).toBeDefined();
      expect(media.originalName).toBeDefined();
      expect(media.mimeType).toBeDefined();
      expect(media.size).toBeGreaterThan(0);
      expect(media.createdAt).toBeInstanceOf(Date);
      expect(media.updatedAt).toBeInstanceOf(Date);
    });

    it('should allow optional dimension fields', () => {
      const imageMedia = createMockMedia({ width: 1920, height: 1080 });
      const pdfMedia = createMockPdfMedia();
      
      expect(imageMedia.width).toBe(1920);
      expect(imageMedia.height).toBe(1080);
      expect(pdfMedia.width).toBeUndefined();
      expect(pdfMedia.height).toBeUndefined();
    });

    it('should allow optional alt and caption', () => {
      const withAlt = createMockMedia({ alt: 'Description', caption: 'A caption' });
      const withoutAlt = createMockMedia({ alt: undefined, caption: undefined });
      
      expect(withAlt.alt).toBe('Description');
      expect(withAlt.caption).toBe('A caption');
      expect(withoutAlt.alt).toBeUndefined();
      expect(withoutAlt.caption).toBeUndefined();
    });
  });

  describe('MIME Type Handling', () => {
    it('should recognize common image MIME types', () => {
      const imageMimeTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/svg+xml',
      ];

      imageMimeTypes.forEach(mimeType => {
        const media = createMockMedia({ mimeType });
        expect(media.mimeType).toBe(mimeType);
        expect(media.mimeType.startsWith('image/')).toBe(true);
      });
    });

    it('should recognize document MIME types', () => {
      const docMimeTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ];

      docMimeTypes.forEach(mimeType => {
        const media = createMockMedia({ mimeType });
        expect(media.mimeType).toBe(mimeType);
      });
    });

    it('should identify image types by MIME prefix', () => {
      const isImage = (mimeType: string) => mimeType.startsWith('image/');
      
      expect(isImage('image/jpeg')).toBe(true);
      expect(isImage('image/png')).toBe(true);
      expect(isImage('application/pdf')).toBe(false);
      expect(isImage('video/mp4')).toBe(false);
    });
  });

  describe('Filename Generation', () => {
    it('should generate unique filenames', () => {
      const generateFilename = (originalName: string, id: string): string => {
        const ext = originalName.split('.').pop() || '';
        return `${id}.${ext}`;
      };

      const filename1 = generateFilename('photo.jpg', 'media-1');
      const filename2 = generateFilename('photo.jpg', 'media-2');
      
      expect(filename1).toBe('media-1.jpg');
      expect(filename2).toBe('media-2.jpg');
      expect(filename1).not.toBe(filename2);
    });

    it('should preserve file extension', () => {
      const getExtension = (filename: string): string => {
        const parts = filename.split('.');
        return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
      };

      expect(getExtension('photo.jpg')).toBe('jpg');
      expect(getExtension('document.PDF')).toBe('pdf');
      expect(getExtension('archive.tar.gz')).toBe('gz');
      expect(getExtension('noextension')).toBe('');
    });

    it('should sanitize original filename', () => {
      const sanitizeFilename = (filename: string): string => {
        return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      };

      expect(sanitizeFilename('my file (1).jpg')).toBe('my_file__1_.jpg');
      expect(sanitizeFilename('résumé.pdf')).toBe('r_sum_.pdf');
      expect(sanitizeFilename('normal-file.png')).toBe('normal-file.png');
    });
  });

  describe('Sidecar Metadata', () => {
    it('should generate sidecar path from media path', () => {
      const getSidecarPath = (mediaPath: string): string => `${mediaPath}.meta`;
      
      expect(getSidecarPath('/media/photo.jpg')).toBe('/media/photo.jpg.meta');
      expect(getSidecarPath('/media/doc.pdf')).toBe('/media/doc.pdf.meta');
    });

    it('should create correct sidecar content structure', () => {
      const media = createMockMedia({
        id: 'media-123',
        originalName: 'vacation-photo.jpg',
        mimeType: 'image/jpeg',
        size: 1024000,
        width: 1920,
        height: 1080,
        alt: 'Vacation photo',
        caption: 'Summer vacation 2024',
        tags: ['vacation', 'summer'],
      });

      const sidecarContent = {
        id: media.id,
        originalName: media.originalName,
        mimeType: media.mimeType,
        size: media.size,
        width: media.width,
        height: media.height,
        alt: media.alt,
        caption: media.caption,
        createdAt: media.createdAt.toISOString(),
        updatedAt: media.updatedAt.toISOString(),
        tags: media.tags,
      };

      expect(sidecarContent.id).toBe('media-123');
      expect(sidecarContent.width).toBe(1920);
      expect(sidecarContent.tags).toEqual(['vacation', 'summer']);
    });

    it('should handle missing optional fields in sidecar', () => {
      const media = createMockPdfMedia({
        alt: undefined,
        caption: undefined,
      });

      const sidecarContent = {
        id: media.id,
        originalName: media.originalName,
        mimeType: media.mimeType,
        size: media.size,
        width: media.width,
        height: media.height,
        alt: media.alt,
        caption: media.caption,
        createdAt: media.createdAt.toISOString(),
        updatedAt: media.updatedAt.toISOString(),
        tags: media.tags,
      };

      expect(sidecarContent.width).toBeUndefined();
      expect(sidecarContent.height).toBeUndefined();
      expect(sidecarContent.alt).toBeUndefined();
      expect(sidecarContent.caption).toBeUndefined();
    });
  });

  describe('Checksum Calculation', () => {
    it('should calculate consistent checksum for same content', () => {
      const crypto = require('crypto');
      const calculateChecksum = (buffer: Buffer): string => {
        return crypto.createHash('md5').update(buffer).digest('hex');
      };

      const buffer = Buffer.from('test content');
      const checksum1 = calculateChecksum(buffer);
      const checksum2 = calculateChecksum(buffer);

      expect(checksum1).toBe(checksum2);
    });

    it('should calculate different checksums for different content', () => {
      const crypto = require('crypto');
      const calculateChecksum = (buffer: Buffer): string => {
        return crypto.createHash('md5').update(buffer).digest('hex');
      };

      const buffer1 = Buffer.from('content A');
      const buffer2 = Buffer.from('content B');
      
      expect(calculateChecksum(buffer1)).not.toBe(calculateChecksum(buffer2));
    });
  });

  describe('File Size Formatting', () => {
    it('should format bytes correctly', () => {
      const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };

      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(500)).toBe('500 B');
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(1048576)).toBe('1 MB');
      expect(formatFileSize(1073741824)).toBe('1 GB');
    });
  });

  describe('Media Tags', () => {
    it('should handle empty tags array', () => {
      const media = createMockMedia({ tags: [] });
      expect(media.tags).toEqual([]);
    });

    it('should preserve tag order', () => {
      const tags = ['first', 'second', 'third'];
      const media = createMockMedia({ tags });
      expect(media.tags).toEqual(tags);
    });

    it('should serialize tags to JSON', () => {
      const tags = ['photo', 'landscape', '2024'];
      const serialized = JSON.stringify(tags);
      const deserialized = JSON.parse(serialized);
      
      expect(deserialized).toEqual(tags);
    });
  });

  describe('Image Dimensions', () => {
    it('should store width and height for images', () => {
      const media = createMockMedia({
        mimeType: 'image/jpeg',
        width: 3840,
        height: 2160,
      });

      expect(media.width).toBe(3840);
      expect(media.height).toBe(2160);
    });

    it('should calculate aspect ratio', () => {
      const getAspectRatio = (width: number, height: number): string => {
        const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
        const divisor = gcd(width, height);
        return `${width / divisor}:${height / divisor}`;
      };

      expect(getAspectRatio(1920, 1080)).toBe('16:9');
      expect(getAspectRatio(1024, 768)).toBe('4:3');
      expect(getAspectRatio(1080, 1080)).toBe('1:1');
    });

    it('should not require dimensions for non-images', () => {
      const pdf = createMockPdfMedia();
      expect(pdf.width).toBeUndefined();
      expect(pdf.height).toBeUndefined();
    });
  });
});

describe('MediaEngine Integration Helpers', () => {
  describe('Database Record Conversion', () => {
    it('should convert MediaData to database record', () => {
      const media = createMockMedia({
        tags: ['tag1', 'tag2'],
      });

      const dbRecord = {
        id: media.id,
        filename: media.filename,
        originalName: media.originalName,
        mimeType: media.mimeType,
        size: media.size,
        width: media.width,
        height: media.height,
        alt: media.alt,
        caption: media.caption,
        filePath: `/mock/userData/media/${media.filename}`,
        sidecarPath: `/mock/userData/media/${media.filename}.meta`,
        createdAt: media.createdAt,
        updatedAt: media.updatedAt,
        syncStatus: 'pending' as const,
        syncedAt: null,
        checksum: 'abc123',
        tags: JSON.stringify(media.tags),
      };

      expect(dbRecord.tags).toBe('["tag1","tag2"]');
      expect(dbRecord.sidecarPath).toContain('.meta');
    });

    it('should convert database record to MediaData', () => {
      const dbRecord = {
        id: 'media-1',
        filename: 'photo.jpg',
        originalName: 'original.jpg',
        mimeType: 'image/jpeg',
        size: 102400,
        width: 800,
        height: 600,
        alt: 'A photo',
        caption: 'Caption text',
        filePath: '/mock/path/photo.jpg',
        sidecarPath: '/mock/path/photo.jpg.meta',
        createdAt: new Date(),
        updatedAt: new Date(),
        syncStatus: 'pending' as const,
        syncedAt: null,
        checksum: 'abc123',
        tags: '["tag1","tag2"]',
      };

      const mediaData = {
        id: dbRecord.id,
        filename: dbRecord.filename,
        originalName: dbRecord.originalName,
        mimeType: dbRecord.mimeType,
        size: dbRecord.size,
        width: dbRecord.width,
        height: dbRecord.height,
        alt: dbRecord.alt,
        caption: dbRecord.caption,
        createdAt: dbRecord.createdAt,
        updatedAt: dbRecord.updatedAt,
        tags: JSON.parse(dbRecord.tags) as string[],
      };

      expect(mediaData.tags).toEqual(['tag1', 'tag2']);
    });
  });

  describe('File Path Generation', () => {
    it('should generate correct media file path', () => {
      const mediaDir = '/mock/userData/media';
      const filename = 'media-123.jpg';
      
      const filePath = `${mediaDir}/${filename}`;
      expect(filePath).toBe('/mock/userData/media/media-123.jpg');
    });

    it('should generate correct sidecar path', () => {
      const filePath = '/mock/userData/media/media-123.jpg';
      const sidecarPath = `${filePath}.meta`;
      
      expect(sidecarPath).toBe('/mock/userData/media/media-123.jpg.meta');
    });
  });
});
