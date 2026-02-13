import crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import TurndownService from 'turndown';
import { getDatabase } from '../database';
import { posts, media, tags } from '../database/schema';
import { eq } from 'drizzle-orm';
import type { WxrData, WxrPost, WxrMedia, WxrSiteInfo, WxrCategory, WxrTag } from './WxrParser';

export type PostAnalysisStatus = 'new' | 'update' | 'conflict' | 'content-duplicate';
export type MediaAnalysisStatus = 'new' | 'update' | 'conflict' | 'content-duplicate' | 'missing';

export interface AnalyzedPost {
  wxrPost: WxrPost;
  status: PostAnalysisStatus;
  contentHash: string;
  markdownPreview: string;
  existingPost?: {
    id: string;
    title: string;
    slug: string;
    checksum: string | null;
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
}

export class ImportAnalysisEngine {
  private currentProjectId: string = '';
  private turndown: TurndownService;
  
  // Progress callback for reporting analysis steps
  onProgress?: (step: string, detail?: string) => void;

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
  }

  setProjectContext(projectId: string): void {
    this.currentProjectId = projectId;
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

    return {
      sourceFile,
      site: wxrData.site,
      analyzedAt: new Date(),
      posts: this.summarizePostAnalysis(analyzedPosts),
      pages: this.summarizePostAnalysis(analyzedPages),
      media: this.summarizeMediaAnalysis(analyzedMedia),
      categories: analyzedCategories,
      tags: analyzedTags,
    };
  }

  private analyzePostItems(
    wxrPosts: WxrPost[],
    slugToPost: Map<string, { id: string; slug: string; title: string; checksum: string | null }>,
    checksumToPost: Map<string, { id: string; slug: string; title: string; checksum: string | null }>,
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
        existingPost = {
          id: existingBySlug.id,
          title: existingBySlug.title,
          slug: existingBySlug.slug,
          checksum: existingBySlug.checksum,
        };
      } else if (existingByHash) {
        status = 'content-duplicate';
        existingPost = {
          id: existingByHash.id,
          title: existingByHash.title,
          slug: existingByHash.slug,
          checksum: existingByHash.checksum,
        };
      } else {
        status = 'new';
      }

      return { wxrPost, status, contentHash, markdownPreview, existingPost };
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
    return this.turndown.turndown(html);
  }

  private calculateChecksum(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }
}
