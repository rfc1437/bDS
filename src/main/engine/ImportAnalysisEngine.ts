import crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import TurndownService from 'turndown';
import { getDatabase } from '../database';
import { posts, media, tags } from '../database/schema';
import { eq } from 'drizzle-orm';
import type { WxrData, WxrPost, WxrMedia, WxrSiteInfo, WxrCategory, WxrTag } from './WxrParser';
import { getMacroConfigMap, type MacroConfig } from '../config/macroConfig';

export type PostAnalysisStatus = 'new' | 'update' | 'conflict' | 'content-duplicate';
export type MediaAnalysisStatus = 'new' | 'update' | 'conflict' | 'content-duplicate' | 'missing';

/** How to resolve a slug conflict during import */
export type ImportConflictResolution = 'ignore' | 'overwrite' | 'import';

export interface AnalyzedPost {
  wxrPost: WxrPost;
  status: PostAnalysisStatus;
  contentHash: string;
  markdownPreview: string;
  /** How to resolve conflict (only relevant when status is 'conflict'). Default is 'ignore'. */
  conflictResolution?: ImportConflictResolution;
  existingPost?: {
    id: string;
    title: string;
    slug: string;
    checksum: string | null;
    /** Date the existing post was created/published */
    pubDate: string | null;
    /** Excerpt from existing post */
    excerpt: string | null;
    /** Author of the existing post */
    author: string | null;
    /** Tags of the existing post */
    tags: string[];
    /** Categories of the existing post */
    categories: string[];
  };
}

export interface AnalyzedMedia {
  wxrMedia: WxrMedia;
  status: MediaAnalysisStatus;
  fileHash: string | null;
  existingMedia?: {
    id: string;
    originalName: string;
    checksum: string | null;
  };
}

export interface AnalyzedCategory {
  name: string;
  slug: string;
  existsInProject: boolean;
  mappedTo?: string; // When set, indicates this item should be mapped to the given name on import
}

export interface AnalyzedTag {
  name: string;
  slug: string;
  existsInProject: boolean;
  mappedTo?: string; // When set, indicates this item should be mapped to the given name on import
}

/** Validation status for a macro usage */
export type MacroValidationStatus = 'valid' | 'invalid' | 'unknown';

/** A single unique usage pattern of a macro */
export interface MacroUsage {
  /** The parameters used in this particular usage */
  params: Record<string, string>;
  /** How many times this exact parameter combination was used */
  count: number;
  /** Whether this usage is valid according to our macro definition */
  validationStatus: MacroValidationStatus;
  /** Error message if validation failed */
  validationError?: string;
  /** Serialized params for deduplication */
  paramsKey: string;
}

/** A discovered macro from the import content */
export interface DiscoveredMacro {
  /** The macro name (lowercase) */
  name: string;
  /** Whether this macro maps to an internal definition */
  mapped: boolean;
  /** Total number of times this macro appears across all content */
  totalCount: number;
  /** Unique usages with different parameters */
  usages: MacroUsage[];
  /** Slugs of posts/pages where this macro is used */
  postSlugs: string[];
}

/** Summary of macro analysis */
export interface MacroAnalysisSummary {
  /** Total unique macros discovered */
  total: number;
  /** Number of macros that map to internal definitions */
  mappedCount: number;
  /** Number of macros that don't map to internal definitions */
  unmappedCount: number;
  /** All discovered macros with their usages */
  discovered: DiscoveredMacro[];
}

/** Minimal interface for macro definition validation */
export interface MacroDefinitionLike {
  name: string;
  validate?: (params: Record<string, string>) => string | undefined;
}

export interface ImportAnalysisReport {
  sourceFile: string;
  site: WxrSiteInfo;
  analyzedAt: Date;
  posts: {
    total: number;
    new: number;
    updates: number;
    conflicts: number;
    contentDuplicates: number;
    items: AnalyzedPost[];
  };
  pages: {
    total: number;
    new: number;
    updates: number;
    conflicts: number;
    contentDuplicates: number;
    items: AnalyzedPost[];
  };
  media: {
    total: number;
    new: number;
    updates: number;
    conflicts: number;
    contentDuplicates: number;
    missing: number;
    items: AnalyzedMedia[];
  };
  categories: AnalyzedCategory[];
  tags: AnalyzedTag[];
  macros: MacroAnalysisSummary;
}

export class ImportAnalysisEngine {
  private currentProjectId: string = '';
  private turndown: TurndownService;
  private macroDefinitions: Map<string, MacroDefinitionLike> = new Map();
  
  // Progress callback for reporting analysis steps
  onProgress?: (step: string, detail?: string) => void;

  // Regex to match WordPress shortcodes: [macroname param="val" param2='val2']
  // This matches single brackets (NOT double brackets like our internal format)
  // Uses negative lookbehind (?<!\[) and negative lookahead (?!\]) to exclude [[...]]
  private static readonly SHORTCODE_REGEX = /(?<!\[)\[(\w+)([^\]]*?)(?:\s*\/)?\](?!\])/g;
  
  // Regex to extract individual parameters from shortcode
  // Supports: key="value", key='value', and key=value (unquoted)
  private static readonly PARAM_REGEX = /(\w+)=(?:"([^"]*)"|'([^']*)'|([^\s\]"']+))/g;

  constructor() {
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

        // Derive alt text: prefer alt, then title, then filename
        let altText = imgAlt.trim();
        if (!altText) {
          altText = imgTitle.trim();
        }
        if (!altText) {
          // Extract filename from the image URL as last resort
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
    
    // Load macro definitions from shared config
    this.loadMacroConfigsFromShared();
  }

  /**
   * Load macro definitions from the shared macro config.
   * Called automatically in constructor.
   */
  private loadMacroConfigsFromShared(): void {
    try {
      const configs = getMacroConfigMap();
      // Convert MacroConfig to MacroDefinitionLike
      for (const [name, config] of configs) {
        this.macroDefinitions.set(name, {
          name: config.name,
          validate: config.validate,
        });
      }
    } catch (error) {
      // Config not available - macros will be marked as unmapped
      console.warn('Could not load macro configs:', error);
    }
  }

  setProjectContext(projectId: string): void {
    this.currentProjectId = projectId;
  }

  /**
   * Set macro definitions for mapping and validation.
   * This overrides the auto-loaded shared config. Useful for testing.
   * @param definitions Map of macro name (lowercase) to definition
   */
  setMacroDefinitions(definitions: Map<string, MacroDefinitionLike>): void {
    this.macroDefinitions = definitions;
  }

  async analyzeWxr(wxrData: WxrData, sourceFile: string, uploadsFolder?: string): Promise<ImportAnalysisReport> {
    const db = getDatabase().getLocal();

    this.onProgress?.('Loading existing posts...');
    
    // Fetch existing posts for this project
    const existingPosts = await db
      .select({
        id: posts.id,
        slug: posts.slug,
        title: posts.title,
        checksum: posts.checksum,
        excerpt: posts.excerpt,
        author: posts.author,
        publishedAt: posts.publishedAt,
        createdAt: posts.createdAt,
        status: posts.status,
        tags: posts.tags,
        categories: posts.categories,
      })
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId))
      .all();

    this.onProgress?.('Loading existing media...', `${existingPosts.length} posts in project`);
    
    // Fetch existing media for this project
    const existingMedia = await db
      .select({
        id: media.id,
        originalName: media.originalName,
        checksum: media.checksum,
      })
      .from(media)
      .where(eq(media.projectId, this.currentProjectId))
      .all();

    this.onProgress?.('Loading existing tags...', `${existingMedia.length} media in project`);
    
    // Fetch existing tags for this project
    const existingTags = await db
      .select({
        name: tags.name,
      })
      .from(tags)
      .where(eq(tags.projectId, this.currentProjectId))
      .all();

    // Build lookup maps for posts
    const slugToPost = new Map<string, typeof existingPosts[0]>();
    const checksumToPost = new Map<string, typeof existingPosts[0]>();
    for (const post of existingPosts) {
      slugToPost.set(post.slug, post);
      if (post.checksum) {
        checksumToPost.set(post.checksum, post);
      }
    }

    // Build lookup maps for media
    const nameToMedia = new Map<string, typeof existingMedia[0]>();
    const checksumToMedia = new Map<string, typeof existingMedia[0]>();
    for (const m of existingMedia) {
      nameToMedia.set(m.originalName.toLowerCase(), m);
      if (m.checksum) {
        checksumToMedia.set(m.checksum, m);
      }
    }

    // Build tag set
    const existingTagNames = new Set(existingTags.map(t => t.name.toLowerCase()));

    this.onProgress?.('Analyzing posts...', `${wxrData.posts.length} posts to analyze`);
    
    // Analyze posts
    const analyzedPosts = this.analyzePostItems(wxrData.posts, slugToPost, checksumToPost);

    this.onProgress?.('Analyzing pages...', `${wxrData.pages.length} pages to analyze`);

    const analyzedPages = this.analyzePostItems(wxrData.pages, slugToPost, checksumToPost);

    this.onProgress?.('Analyzing media files...', `${wxrData.media.length} media files to analyze`);
    
    // Analyze media
    const analyzedMedia = await this.analyzeMediaItems(wxrData.media, nameToMedia, checksumToMedia, uploadsFolder);

    this.onProgress?.('Processing categories and tags...');
    
    // Analyze categories
    const analyzedCategories: AnalyzedCategory[] = wxrData.categories.map(cat => ({
      name: cat.name,
      slug: cat.slug,
      existsInProject: existingTagNames.has(cat.name.toLowerCase()),
    }));

    // Analyze tags
    const analyzedTags: AnalyzedTag[] = wxrData.tags.map(tag => ({
      name: tag.name,
      slug: tag.slug,
      existsInProject: existingTagNames.has(tag.name.toLowerCase()),
    }));

    this.onProgress?.('Discovering macros...');
    
    // Analyze macros from posts and pages content
    const macroAnalysis = this.analyzeMacros([...wxrData.posts, ...wxrData.pages]);

    return {
      sourceFile,
      site: wxrData.site,
      analyzedAt: new Date(),
      posts: this.summarizePostAnalysis(analyzedPosts),
      pages: this.summarizePostAnalysis(analyzedPages),
      media: this.summarizeMediaAnalysis(analyzedMedia),
      categories: analyzedCategories,
      tags: analyzedTags,
      macros: macroAnalysis,
    };
  }

  private analyzePostItems(
    wxrPosts: WxrPost[],
    slugToPost: Map<string, { id: string; slug: string; title: string; checksum: string | null; excerpt: string | null; author: string | null; publishedAt: Date | null; createdAt: Date; status: string; tags: string | null; categories: string | null }>,
    checksumToPost: Map<string, { id: string; slug: string; title: string; checksum: string | null; excerpt: string | null; author: string | null; publishedAt: Date | null; createdAt: Date; status: string; tags: string | null; categories: string | null }>,
  ): AnalyzedPost[] {
    return wxrPosts.map(wxrPost => {
      const markdown = this.convertToMarkdown(wxrPost.content);
      const contentHash = this.calculateChecksum(markdown);
      const markdownPreview = markdown.substring(0, 200);

      const existingBySlug = slugToPost.get(wxrPost.slug);
      const existingByHash = checksumToPost.get(contentHash);

      let status: PostAnalysisStatus;
      let existingPost: AnalyzedPost['existingPost'];

      if (existingBySlug) {
        if (existingBySlug.checksum === contentHash) {
          status = 'update';
        } else {
          status = 'conflict';
        }
        const existingDate = existingBySlug.publishedAt || existingBySlug.createdAt;
        const existingTags = existingBySlug.tags ? JSON.parse(existingBySlug.tags) : [];
        const existingCategories = existingBySlug.categories ? JSON.parse(existingBySlug.categories) : [];
        existingPost = {
          id: existingBySlug.id,
          title: existingBySlug.title,
          slug: existingBySlug.slug,
          checksum: existingBySlug.checksum,
          pubDate: existingDate ? existingDate.toISOString() : null,
          excerpt: existingBySlug.excerpt,
          author: existingBySlug.author,
          tags: existingTags,
          categories: existingCategories,
        };
      } else if (existingByHash) {
        status = 'content-duplicate';
        const existingDate = existingByHash.publishedAt || existingByHash.createdAt;
        const existingTagsByHash = existingByHash.tags ? JSON.parse(existingByHash.tags) : [];
        const existingCategoriesByHash = existingByHash.categories ? JSON.parse(existingByHash.categories) : [];
        existingPost = {
          id: existingByHash.id,
          title: existingByHash.title,
          slug: existingByHash.slug,
          checksum: existingByHash.checksum,
          pubDate: existingDate ? existingDate.toISOString() : null,
          excerpt: existingByHash.excerpt,
          author: existingByHash.author,
          tags: existingTagsByHash,
          categories: existingCategoriesByHash,
        };
      } else {
        status = 'new';
      }

      // For conflicts, default resolution is 'ignore'
      const conflictResolution = status === 'conflict' ? 'ignore' as const : undefined;

      return { wxrPost, status, contentHash, markdownPreview, existingPost, conflictResolution };
    });
  }

  private async analyzeMediaItems(
    wxrMediaItems: WxrMedia[],
    nameToMedia: Map<string, { id: string; originalName: string; checksum: string | null }>,
    checksumToMedia: Map<string, { id: string; originalName: string; checksum: string | null }>,
    uploadsFolder?: string,
  ): Promise<AnalyzedMedia[]> {
    const results: AnalyzedMedia[] = [];

    for (const wxrMedia of wxrMediaItems) {
      let fileHash: string | null = null;
      let fileFound = false;

      // Try to read the actual file from the uploads folder
      if (uploadsFolder) {
        try {
          const filePath = path.join(uploadsFolder, wxrMedia.relativePath);
          const buffer = await fs.readFile(filePath);
          fileHash = this.calculateChecksum(buffer.toString('binary'));
          fileFound = true;
        } catch {
          // File not found in uploads folder
        }
      }

      if (!fileFound) {
        results.push({
          wxrMedia,
          status: 'missing',
          fileHash: null,
        });
        continue;
      }

      const existingByName = nameToMedia.get(wxrMedia.filename.toLowerCase());
      const existingByHash = fileHash ? checksumToMedia.get(fileHash) : undefined;

      let status: MediaAnalysisStatus;
      let existingMedia: AnalyzedMedia['existingMedia'];

      if (existingByName) {
        if (fileHash && existingByName.checksum === fileHash) {
          status = 'update';
        } else {
          status = 'conflict';
        }
        existingMedia = {
          id: existingByName.id,
          originalName: existingByName.originalName,
          checksum: existingByName.checksum,
        };
      } else if (existingByHash) {
        status = 'content-duplicate';
        existingMedia = {
          id: existingByHash.id,
          originalName: existingByHash.originalName,
          checksum: existingByHash.checksum,
        };
      } else {
        status = 'new';
      }

      results.push({ wxrMedia, status, fileHash, existingMedia });
    }

    return results;
  }

  private summarizePostAnalysis(items: AnalyzedPost[]): ImportAnalysisReport['posts'] {
    return {
      total: items.length,
      new: items.filter(i => i.status === 'new').length,
      updates: items.filter(i => i.status === 'update').length,
      conflicts: items.filter(i => i.status === 'conflict').length,
      contentDuplicates: items.filter(i => i.status === 'content-duplicate').length,
      items,
    };
  }

  private summarizeMediaAnalysis(items: AnalyzedMedia[]): ImportAnalysisReport['media'] {
    return {
      total: items.length,
      new: items.filter(i => i.status === 'new').length,
      updates: items.filter(i => i.status === 'update').length,
      conflicts: items.filter(i => i.status === 'conflict').length,
      contentDuplicates: items.filter(i => i.status === 'content-duplicate').length,
      missing: items.filter(i => i.status === 'missing').length,
      items,
    };
  }

  private convertToMarkdown(html: string): string {
    if (!html || !html.trim()) return '';
    // Preprocess: Convert newlines within text to <br> tags to preserve line breaks
    const preprocessed = this.preserveLineBreaks(html);
    return this.turndown.turndown(preprocessed);
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

  private calculateChecksum(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Analyze macros (WordPress shortcodes) from post/page content.
   * Discovers all shortcodes, aggregates their usages, and validates against definitions.
   */
  private analyzeMacros(posts: WxrPost[]): MacroAnalysisSummary {
    // Map of macro name -> discovered macro data
    const macroMap = new Map<string, {
      name: string;
      totalCount: number;
      usages: Map<string, { params: Record<string, string>; count: number }>;
      postSlugs: Set<string>;
    }>();

    // Process each post/page
    for (const post of posts) {
      if (!post.content) continue;
      
      const shortcodes = this.parseShortcodes(post.content);
      
      for (const shortcode of shortcodes) {
        const name = shortcode.name.toLowerCase();
        
        let macroData = macroMap.get(name);
        if (!macroData) {
          macroData = {
            name,
            totalCount: 0,
            usages: new Map(),
            postSlugs: new Set(),
          };
          macroMap.set(name, macroData);
        }
        
        macroData.totalCount++;
        macroData.postSlugs.add(post.slug);
        
        // Create a key for this parameter combination
        const paramsKey = this.serializeParams(shortcode.params);
        const existingUsage = macroData.usages.get(paramsKey);
        if (existingUsage) {
          existingUsage.count++;
        } else {
          macroData.usages.set(paramsKey, { params: shortcode.params, count: 1 });
        }
      }
    }

    // Convert to final format with validation
    const discovered: DiscoveredMacro[] = [];
    
    for (const macroData of macroMap.values()) {
      const definition = this.macroDefinitions.get(macroData.name);
      const mapped = definition !== undefined;
      
      const usages: MacroUsage[] = [];
      for (const [paramsKey, usage] of macroData.usages) {
        let validationStatus: MacroValidationStatus = 'unknown';
        let validationError: string | undefined;
        
        if (mapped && definition) {
          if (definition.validate) {
            const error = definition.validate(usage.params);
            if (error) {
              validationStatus = 'invalid';
              validationError = error;
            } else {
              validationStatus = 'valid';
            }
          } else {
            // Macro is mapped but has no validation - consider valid
            validationStatus = 'valid';
          }
        }
        
        usages.push({
          params: usage.params,
          count: usage.count,
          validationStatus,
          validationError,
          paramsKey,
        });
      }
      
      discovered.push({
        name: macroData.name,
        mapped,
        totalCount: macroData.totalCount,
        usages,
        postSlugs: Array.from(macroData.postSlugs),
      });
    }

    // Sort discovered macros by name
    discovered.sort((a, b) => a.name.localeCompare(b.name));

    return {
      total: discovered.length,
      mappedCount: discovered.filter(m => m.mapped).length,
      unmappedCount: discovered.filter(m => !m.mapped).length,
      discovered,
    };
  }

  /**
   * Parse WordPress shortcodes from content.
   * Returns array of { name, params } for each shortcode found.
   */
  private parseShortcodes(content: string): Array<{ name: string; params: Record<string, string> }> {
    const shortcodes: Array<{ name: string; params: Record<string, string> }> = [];
    
    // Reset regex lastIndex
    ImportAnalysisEngine.SHORTCODE_REGEX.lastIndex = 0;
    
    let match;
    while ((match = ImportAnalysisEngine.SHORTCODE_REGEX.exec(content)) !== null) {
      const name = match[1];
      const paramString = match[2] || '';
      const params = this.parseShortcodeParams(paramString);
      
      shortcodes.push({ name, params });
    }
    
    return shortcodes;
  }

  /**
   * Parse parameters from a shortcode parameter string.
   * Supports: key="value", key='value', and key=value (unquoted)
   */
  private parseShortcodeParams(paramString: string): Record<string, string> {
    const params: Record<string, string> = {};
    
    // Reset regex lastIndex
    ImportAnalysisEngine.PARAM_REGEX.lastIndex = 0;
    
    let match;
    while ((match = ImportAnalysisEngine.PARAM_REGEX.exec(paramString)) !== null) {
      const key = match[1];
      // Value is in group 2 (double-quoted), 3 (single-quoted), or 4 (unquoted)
      const value = match[2] ?? match[3] ?? match[4] ?? '';
      params[key] = value;
    }
    
    return params;
  }

  /**
   * Serialize params to a stable string for deduplication.
   */
  private serializeParams(params: Record<string, string>): string {
    const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(sorted);
  }
}
