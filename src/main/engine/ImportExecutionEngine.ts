/**
 * ImportExecutionEngine - Executes WXR import based on analysis results
 *
 * Handles the 4-phase import process:
 * 1. Create new tags/categories
 * 2. Import posts (handling conflicts correctly)
 * 3. Import media (with post linkage)
 * 4. Import pages (as posts with "page" category)
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import matter from 'gray-matter';
import { app } from 'electron';
import TurndownService from 'turndown';
import { getDatabase } from '../database';
import { posts, media, NewPost, NewMedia } from '../database/schema';
import { eq } from 'drizzle-orm';
import { getTagEngine } from './TagEngine';
import { getPostEngine, PostData } from './PostEngine';
import { getMediaEngine, MediaData } from './MediaEngine';
import type {
  ImportAnalysisReport,
  AnalyzedPost,
  AnalyzedMedia,
  AnalyzedCategory,
  AnalyzedTag,
  ImportConflictResolution,
} from './ImportAnalysisEngine';
import type { WxrPost, WxrMedia } from './WxrParser';

export interface ImportExecutionOptions {
  /** Path to the WordPress uploads folder for media files */
  uploadsFolder?: string;
  /** Progress callback */
  onProgress?: (phase: string, current: number, total: number, detail?: string) => void;
}

export interface ImportExecutionResult {
  success: boolean;
  tags: {
    created: number;
    skipped: number;
  };
  posts: {
    imported: number;
    skipped: number;
    errors: number;
  };
  media: {
    imported: number;
    skipped: number;
    errors: number;
  };
  pages: {
    imported: number;
    skipped: number;
    errors: number;
  };
  /** Mapping from WordPress post ID to our post GUID */
  wpIdToPostId: Map<number, string>;
  errors: string[];
}

// Regex to match WordPress shortcodes: [macroname ...] but NOT [[macroname ...]]
const WP_SHORTCODE_REGEX = /(?<!\[)\[(\w+)([^\]]*?)(?:\s*\/)?\](?!\])/g;

export class ImportExecutionEngine extends EventEmitter {
  private currentProjectId: string = 'default';
  private dataDir: string | null = null;
  private turndown: TurndownService;

  constructor() {
    super();
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });

    // Custom rule for linked images: <a><img></a> -> ![alt](src)
    // This handles the common WordPress pattern of wrapping thumbnails in links to full-size images
    this.turndown.addRule('linkedImage', {
      filter: (node) => {
        // Match <a> tags that contain only an <img> (possibly with whitespace)
        if (node.nodeName !== 'A') return false;
        const children = Array.from(node.childNodes).filter(
          child => !(child.nodeType === 3 && !child.textContent?.trim())
        );
        return children.length === 1 && children[0].nodeName === 'IMG';
      },
      replacement: (_content, node) => {
        const anchor = node as HTMLAnchorElement;
        const img = anchor.querySelector('img');
        if (!img) return '';

        const href = anchor.getAttribute('href') || '';
        const imgSrc = img.getAttribute('src') || '';
        const imgAlt = img.getAttribute('alt') || '';
        const imgTitle = img.getAttribute('title') || '';

        // Check if the link href points to an image (common WordPress pattern for "click for larger")
        const imageExtensions = /\.(jpe?g|png|gif|webp|bmp|svg|tiff?)(\?.*)?$/i;
        const hrefIsImage = imageExtensions.test(href);

        // Determine which URL to use:
        // - If href is an image URL (WordPress "click for full-size" pattern), use the href
        // - Otherwise, use the original image src
        const imageUrl = hrefIsImage ? href : imgSrc;

        // Derive alt text: use image alt if not empty, otherwise extract filename from the URL
        let altText = imgAlt.trim();
        if (!altText) {
          // Extract filename from the image URL
          const urlPath = imageUrl.split('?')[0]; // Remove query string
          const filename = urlPath.split('/').pop() || '';
          altText = filename;
        }

        // Build the markdown image link
        if (imgTitle) {
          return `![${altText}](${imageUrl} "${imgTitle}")`;
        }
        return `![${altText}](${imageUrl})`;
      },
    });
  }

  setProjectContext(projectId: string, dataDir?: string): void {
    this.currentProjectId = projectId;
    this.dataDir = dataDir || null;
  }

  getProjectContext(): string {
    return this.currentProjectId;
  }

  private getBaseDir(): string {
    if (this.dataDir) return this.dataDir;
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'projects', this.currentProjectId);
  }

  private getPostsBaseDir(): string {
    return path.join(this.getBaseDir(), 'posts');
  }

  private getMediaBaseDir(): string {
    return path.join(this.getBaseDir(), 'media');
  }

  /**
   * Get the date-based directory for posts (posts/YYYY/MM/)
   */
  private getPostsDirForDate(date: Date): string {
    const baseDir = this.getPostsBaseDir();
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return path.join(baseDir, year, month);
  }

  /**
   * Get the date-based directory for media (media/YYYY/MM/)
   */
  private getMediaDirForDate(date: Date): string {
    const baseDir = this.getMediaBaseDir();
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return path.join(baseDir, year, month);
  }

  /**
   * Execute the full import process
   */
  async executeImport(
    report: ImportAnalysisReport,
    options: ImportExecutionOptions
  ): Promise<ImportExecutionResult> {
    const result: ImportExecutionResult = {
      success: true,
      tags: { created: 0, skipped: 0 },
      posts: { imported: 0, skipped: 0, errors: 0 },
      media: { imported: 0, skipped: 0, errors: 0 },
      pages: { imported: 0, skipped: 0, errors: 0 },
      wpIdToPostId: new Map(),
      errors: [],
    };

    const progress = options.onProgress || (() => {});

    try {
      // Build tag/category mappings
      const tagMapping = this.buildTaxonomyMapping(report.tags);
      const categoryMapping = this.buildTaxonomyMapping(report.categories);

      // Phase 1: Create new tags
      progress('tags', 0, report.tags.length + report.categories.length, 'Creating tags...');
      await this.executePhase1Tags(report, tagMapping, categoryMapping, result, progress);

      // Phase 2: Import posts
      progress('posts', 0, report.posts.items.length, 'Importing posts...');
      await this.executePhase2Posts(report, tagMapping, categoryMapping, result, options, progress);

      // Phase 3: Import media
      progress('media', 0, report.media.items.length, 'Importing media...');
      await this.executePhase3Media(report, result, options, progress);

      // Phase 4: Import pages
      progress('pages', 0, report.pages.items.length, 'Importing pages...');
      await this.executePhase4Pages(report, tagMapping, categoryMapping, result, options, progress);

      progress('complete', 1, 1, 'Import complete');
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    return result;
  }

  /**
   * Build a mapping from original taxonomy name to resolved name
   * - If existsInProject: use the name as-is (lowercase)
   * - If mappedTo: use the mappedTo value (lowercase)
   * - Otherwise: use the name and mark for creation
   */
  private buildTaxonomyMapping(
    items: Array<{ name: string; existsInProject: boolean; mappedTo?: string }>
  ): Map<string, { resolved: string; needsCreation: boolean }> {
    const mapping = new Map<string, { resolved: string; needsCreation: boolean }>();

    for (const item of items) {
      const key = item.name.toLowerCase();
      if (item.mappedTo) {
        // Mapped to existing tag
        mapping.set(key, { resolved: item.mappedTo.toLowerCase(), needsCreation: false });
      } else if (item.existsInProject) {
        // Already exists
        mapping.set(key, { resolved: key, needsCreation: false });
      } else {
        // New tag to create
        mapping.set(key, { resolved: key, needsCreation: true });
      }
    }

    return mapping;
  }

  /**
   * Phase 1: Create new tags and categories
   */
  private async executePhase1Tags(
    report: ImportAnalysisReport,
    tagMapping: Map<string, { resolved: string; needsCreation: boolean }>,
    categoryMapping: Map<string, { resolved: string; needsCreation: boolean }>,
    result: ImportExecutionResult,
    progress: (phase: string, current: number, total: number, detail?: string) => void
  ): Promise<void> {
    const tagEngine = getTagEngine();
    tagEngine.setProjectContext(this.currentProjectId);

    let current = 0;
    const total = report.tags.length + report.categories.length;

    // Create new tags
    for (const tag of report.tags) {
      current++;
      const mapping = tagMapping.get(tag.name.toLowerCase());
      
      if (mapping?.needsCreation) {
        try {
          await tagEngine.createTag({ name: mapping.resolved });
          result.tags.created++;
          progress('tags', current, total, `Created tag: ${mapping.resolved}`);
        } catch (error) {
          // Tag might already exist (race condition or duplicate in list)
          result.tags.skipped++;
        }
      } else {
        result.tags.skipped++;
      }
    }

    // Create new categories (as tags)
    for (const category of report.categories) {
      current++;
      const mapping = categoryMapping.get(category.name.toLowerCase());
      
      if (mapping?.needsCreation) {
        try {
          await tagEngine.createTag({ name: mapping.resolved });
          result.tags.created++;
          progress('tags', current, total, `Created category tag: ${mapping.resolved}`);
        } catch (error) {
          result.tags.skipped++;
        }
      } else {
        result.tags.skipped++;
      }
    }
  }

  /**
   * Phase 2: Import posts
   */
  private async executePhase2Posts(
    report: ImportAnalysisReport,
    tagMapping: Map<string, { resolved: string; needsCreation: boolean }>,
    categoryMapping: Map<string, { resolved: string; needsCreation: boolean }>,
    result: ImportExecutionResult,
    options: ImportExecutionOptions,
    progress: (phase: string, current: number, total: number, detail?: string) => void
  ): Promise<void> {
    // Filter to only actual posts (postType === 'post'), skip nav_menu_item, revision, etc.
    const postsToImport = report.posts.items.filter(item => item.wxrPost.postType === 'post');
    const total = postsToImport.length;

    // Count skipped "other" post types
    const skippedOther = report.posts.items.length - postsToImport.length;
    result.posts.skipped += skippedOther;

    for (let i = 0; i < postsToImport.length; i++) {
      const analyzed = postsToImport[i];
      progress('posts', i + 1, total, `Processing: ${analyzed.wxrPost.title}`);

      try {
        const imported = await this.importPost(analyzed, tagMapping, categoryMapping, result, options);
        if (imported) {
          result.posts.imported++;
        } else {
          result.posts.skipped++;
        }
      } catch (error) {
        result.posts.errors++;
        result.errors.push(`Failed to import post "${analyzed.wxrPost.title}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Import a single post
   */
  private async importPost(
    analyzed: AnalyzedPost,
    tagMapping: Map<string, { resolved: string; needsCreation: boolean }>,
    categoryMapping: Map<string, { resolved: string; needsCreation: boolean }>,
    result: ImportExecutionResult,
    options: ImportExecutionOptions
  ): Promise<boolean> {
    const wxrPost = analyzed.wxrPost;

    // Handle different analysis statuses
    if (analyzed.status === 'content-duplicate') {
      // Skip content duplicates
      return false;
    }

    if (analyzed.status === 'update') {
      // Skip updates (same content already exists)
      return false;
    }

    if (analyzed.status === 'conflict') {
      const resolution = analyzed.conflictResolution || 'ignore';
      
      if (resolution === 'ignore') {
        return false;
      }
      
      // Handle overwrite and import
      return await this.importPostWithConflict(analyzed, resolution, tagMapping, categoryMapping, result, options);
    }

    // New post - import it
    return await this.createImportedPost(analyzed, tagMapping, categoryMapping, result, options, 'published');
  }

  /**
   * Import a post that has a conflict
   */
  private async importPostWithConflict(
    analyzed: AnalyzedPost,
    resolution: ImportConflictResolution,
    tagMapping: Map<string, { resolved: string; needsCreation: boolean }>,
    categoryMapping: Map<string, { resolved: string; needsCreation: boolean }>,
    result: ImportExecutionResult,
    options: ImportExecutionOptions
  ): Promise<boolean> {
    const postEngine = getPostEngine();

    if (resolution === 'overwrite') {
      // Create as draft with the same slug (user needs to review and publish)
      return await this.createImportedPost(analyzed, tagMapping, categoryMapping, result, options, 'draft');
    }

    if (resolution === 'import') {
      // Create with a new unique slug
      const newSlug = await postEngine.generateUniqueSlug(analyzed.wxrPost.title);
      return await this.createImportedPost(analyzed, tagMapping, categoryMapping, result, options, 'published', newSlug);
    }

    return false;
  }

  /**
   * Create an imported post
   */
  private async createImportedPost(
    analyzed: AnalyzedPost,
    tagMapping: Map<string, { resolved: string; needsCreation: boolean }>,
    categoryMapping: Map<string, { resolved: string; needsCreation: boolean }>,
    result: ImportExecutionResult,
    options: ImportExecutionOptions,
    status: 'draft' | 'published',
    overrideSlug?: string
  ): Promise<boolean> {
    const wxrPost = analyzed.wxrPost;
    const db = getDatabase().getLocal();

    // Transform WordPress shortcodes [shortcode] to [[shortcode]] BEFORE markdown conversion
    // (TurndownService escapes brackets, so we must transform first)
    const contentWithShortcodes = this.transformShortcodes(wxrPost.content);

    // Convert HTML content to Markdown
    const transformedContent = this.convertToMarkdown(contentWithShortcodes);

    // Resolve tags
    const resolvedTags = this.resolveTaxonomy(wxrPost.tags, tagMapping);

    // Resolve categories
    const resolvedCategories = this.resolveTaxonomy(wxrPost.categories, categoryMapping);

    // Determine dates (dates may be strings after JSON serialization through IPC)
    const createdAt = this.toDate(wxrPost.postDate) || this.toDate(wxrPost.pubDate) || new Date();
    const updatedAt = this.toDate(wxrPost.postModified) || createdAt;
    const publishedAt = status === 'published' ? (this.toDate(wxrPost.pubDate) || createdAt) : undefined;

    // Generate post ID
    const postId = uuidv4();

    // Build post data
    const postData: PostData = {
      id: postId,
      projectId: this.currentProjectId,
      title: wxrPost.title,
      slug: overrideSlug || wxrPost.slug,
      excerpt: wxrPost.excerpt || undefined,
      content: transformedContent,
      status,
      author: wxrPost.creator || undefined,
      createdAt,
      updatedAt,
      publishedAt,
      tags: resolvedTags,
      categories: resolvedCategories,
    };

    // Write to filesystem first (for published posts)
    let filePath = '';
    if (status === 'published') {
      filePath = await this.writePostFile(postData);
    }

    // Calculate checksum
    const checksum = this.calculateChecksum(transformedContent);

    // Insert into database
    const dbPost: NewPost = {
      id: postData.id,
      projectId: postData.projectId,
      title: postData.title,
      slug: postData.slug,
      excerpt: postData.excerpt,
      content: status === 'draft' ? postData.content : null, // Draft content in DB, published in file
      status: postData.status,
      author: postData.author,
      createdAt: postData.createdAt,
      updatedAt: postData.updatedAt,
      publishedAt: postData.publishedAt,
      filePath,
      checksum,
      tags: JSON.stringify(postData.tags),
      categories: JSON.stringify(postData.categories),
    };

    await db.insert(posts).values(dbPost);

    // Update FTS index
    const postEngine = getPostEngine();
    await postEngine.updateFTSIndex(postData);

    // Track wpId to postId mapping
    result.wpIdToPostId.set(wxrPost.wpId, postId);

    return true;
  }

  /**
   * Write a post file to the filesystem
   */
  private async writePostFile(post: PostData): Promise<string> {
    const metadata: Record<string, unknown> = {
      id: post.id,
      projectId: post.projectId,
      title: post.title,
      slug: post.slug,
      status: post.status,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      tags: post.tags,
      categories: post.categories,
    };

    if (post.excerpt) metadata.excerpt = post.excerpt;
    if (post.author) metadata.author = post.author;
    if (post.publishedAt) metadata.publishedAt = post.publishedAt.toISOString();

    const postsDir = this.getPostsDirForDate(post.createdAt);
    await fs.mkdir(postsDir, { recursive: true });

    const fileContent = matter.stringify(post.content, metadata);
    const filePath = path.join(postsDir, `${post.slug}.md`);

    await fs.writeFile(filePath, fileContent, 'utf-8');
    return filePath;
  }

  /**
   * Phase 3: Import media files
   */
  private async executePhase3Media(
    report: ImportAnalysisReport,
    result: ImportExecutionResult,
    options: ImportExecutionOptions,
    progress: (phase: string, current: number, total: number, detail?: string) => void
  ): Promise<void> {
    const total = report.media.items.length;

    for (let i = 0; i < report.media.items.length; i++) {
      const analyzed = report.media.items[i];
      progress('media', i + 1, total, `Processing: ${analyzed.wxrMedia.filename}`);

      try {
        const imported = await this.importMediaFile(analyzed, result, options);
        if (imported) {
          result.media.imported++;
        } else {
          result.media.skipped++;
        }
      } catch (error) {
        result.media.errors++;
        result.errors.push(`Failed to import media "${analyzed.wxrMedia.filename}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Import a single media file
   */
  private async importMediaFile(
    analyzed: AnalyzedMedia,
    result: ImportExecutionResult,
    options: ImportExecutionOptions
  ): Promise<boolean> {
    const wxrMedia = analyzed.wxrMedia;

    // Skip missing files
    if (analyzed.status === 'missing') {
      return false;
    }

    // Skip content duplicates
    if (analyzed.status === 'content-duplicate') {
      return false;
    }

    // Handle conflicts
    if (analyzed.status === 'conflict') {
      const resolution = (analyzed as any).conflictResolution || 'ignore';
      if (resolution === 'ignore') {
        return false;
      }
      // For 'overwrite' or 'import', proceed with import
    }

    // Skip updates (same content already exists)
    if (analyzed.status === 'update') {
      return false;
    }

    // Build source path
    if (!options.uploadsFolder) {
      return false;
    }

    const sourcePath = path.join(options.uploadsFolder, wxrMedia.relativePath);

    // Check if file exists
    try {
      await fs.access(sourcePath);
    } catch {
      return false;
    }

    // Resolve parent post ID
    const linkedPostIds: string[] = [];
    if (wxrMedia.parentId && wxrMedia.parentId > 0) {
      const parentPostId = result.wpIdToPostId.get(wxrMedia.parentId);
      if (parentPostId) {
        linkedPostIds.push(parentPostId);
      }
    }

    // Determine creation date from WXR (may be string after JSON serialization)
    const createdAt = this.toDate(wxrMedia.pubDate) || new Date();

    // Import the media file
    const mediaEngine = getMediaEngine();
    await mediaEngine.importMedia(sourcePath, {
      title: wxrMedia.title || undefined,
      alt: wxrMedia.description || undefined,
      mimeType: wxrMedia.mimeType,
      tags: [],
      linkedPostIds,
      createdAt,
      updatedAt: createdAt,
    });

    return true;
  }

  /**
   * Phase 4: Import pages as posts with "page" category
   */
  private async executePhase4Pages(
    report: ImportAnalysisReport,
    tagMapping: Map<string, { resolved: string; needsCreation: boolean }>,
    categoryMapping: Map<string, { resolved: string; needsCreation: boolean }>,
    result: ImportExecutionResult,
    options: ImportExecutionOptions,
    progress: (phase: string, current: number, total: number, detail?: string) => void
  ): Promise<void> {
    const total = report.pages.items.length;

    // Ensure "page" category exists in mapping
    if (!categoryMapping.has('page')) {
      categoryMapping.set('page', { resolved: 'page', needsCreation: false });
    }

    for (let i = 0; i < report.pages.items.length; i++) {
      const analyzed = report.pages.items[i];
      const wxrPage = analyzed.wxrPost;
      
      // Add "page" to categories
      const modifiedWxrPost: WxrPost = {
        ...wxrPage,
        categories: [...wxrPage.categories, 'page'],
      };
      
      const modifiedAnalyzed: AnalyzedPost = {
        ...analyzed,
        wxrPost: modifiedWxrPost,
      };

      progress('pages', i + 1, total, `Processing: ${wxrPage.title}`);

      try {
        const imported = await this.importPost(modifiedAnalyzed, tagMapping, categoryMapping, result, options);
        if (imported) {
          result.pages.imported++;
        } else {
          result.pages.skipped++;
        }
      } catch (error) {
        result.pages.errors++;
        result.errors.push(`Failed to import page "${wxrPage.title}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Convert HTML to Markdown using Turndown
   */
  private convertToMarkdown(html: string): string {
    if (!html || !html.trim()) return '';

    // Preprocess: Convert newlines within text to <br> tags to preserve line breaks
    // This handles the common case where WordPress exports have line breaks in the XML
    // that should be preserved in markdown
    const preprocessed = this.preserveLineBreaks(html);

    let markdown = this.turndown.turndown(preprocessed);
    // Unescape double-bracket macros that TurndownService escaped
    // \[\[ becomes [[ and \]\] becomes ]]
    markdown = markdown.replace(/\\\[\\\[/g, '[[').replace(/\\\]\\\]/g, ']]');
    // Remove backslash escapes inside [[macro]] blocks (e.g. photo\_archive → photo_archive)
    markdown = markdown.replace(/\[\[([^\]]*?)\]\]/g, (_match, inner: string) => {
      return '[[' + inner.replace(/\\(.)/g, '$1') + ']]';
    });
    return markdown;
  }

  /**
   * Preserve line breaks in HTML content by converting \n to <br> tags
   * Only converts newlines that appear within meaningful text content,
   * not newlines that are just whitespace between tags
   */
  private preserveLineBreaks(html: string): string {
    // Convert newlines that appear within text content (between > and <)
    // But only if the text content has actual content before or after the newline
    return html.replace(/>([^<]+)</g, (_match, textContent: string) => {
      // Skip if the text content is only whitespace (just formatting between tags)
      if (!textContent.trim()) {
        return '>' + textContent + '<';
      }
      // Replace all newlines with <br> (the text has actual content)
      const preserved = textContent.replace(/\n/g, '<br>');
      return '>' + preserved + '<';
    });
  }

  /**
   * Transform WordPress shortcodes [shortcode] to [[shortcode]]
   */
  private transformShortcodes(content: string): string {
    return content.replace(WP_SHORTCODE_REGEX, '[[$1$2]]');
  }

  /**
   * Resolve taxonomy items using the mapping
   */
  private resolveTaxonomy(
    items: string[],
    mapping: Map<string, { resolved: string; needsCreation: boolean }>
  ): string[] {
    return items.map(item => {
      const key = item.toLowerCase();
      const mapped = mapping.get(key);
      return mapped ? mapped.resolved : key;
    });
  }

  /**
   * Safely convert a value to a Date object.
   * Handles Date objects, ISO strings (from JSON serialization), and null/undefined.
   */
  private toDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  /**
   * Calculate MD5 checksum of content
   */
  private calculateChecksum(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }
}

// Singleton instance
let importExecutionEngineInstance: ImportExecutionEngine | null = null;

export function getImportExecutionEngine(): ImportExecutionEngine {
  if (!importExecutionEngineInstance) {
    importExecutionEngineInstance = new ImportExecutionEngine();
  }
  return importExecutionEngineInstance;
}
