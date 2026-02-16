import { DOMParser } from '@xmldom/xmldom';
import * as fs from 'fs/promises';

export interface WxrSiteInfo {
  title: string;
  link: string;
  description: string;
  language: string;
}

export interface WxrPost {
  wpId: number;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  pubDate: Date | null;
  postDate: Date | null;
  postModified: Date | null;
  creator: string;
  status: string;
  postType: string;
  categories: string[];
  tags: string[];
}

export interface WxrMedia {
  wpId: number;
  title: string;
  url: string;
  filename: string;
  relativePath: string;
  pubDate: Date | null;
  parentId: number;
  mimeType: string;
  description: string;
}

export interface WxrCategory {
  name: string;
  slug: string;
  parent: string;
}

export interface WxrTag {
  name: string;
  slug: string;
}

export interface WxrData {
  site: WxrSiteInfo;
  posts: WxrPost[];
  pages: WxrPost[];
  media: WxrMedia[];
  categories: WxrCategory[];
  tags: WxrTag[];
}

// WordPress namespace URIs
const NS = {
  wp: 'http://wordpress.org/export/1.2/',
  content: 'http://purl.org/rss/1.0/modules/content/',
  excerpt: 'http://wordpress.org/export/1.2/excerpt/',
  dc: 'http://purl.org/dc/elements/1.1/',
};

// Common MIME types by file extension
const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: 'application/zip',
};

export class WxrParser {

  private parsePubDate(item: Element): Date | null {
    const pubDateStr = this.getDirectChildText(item, 'pubDate');
    if (!pubDateStr) {
      return null;
    }

    const parsed = new Date(pubDateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  private parseItemBase(item: Element): {
    wpId: number;
    title: string;
    slug: string;
    content: string;
    excerpt: string;
    pubDate: Date | null;
    creator: string;
    status: string;
    postType: string;
  } {
    return {
      wpId: parseInt(this.getElementText(item, 'post_id', NS.wp) || '0', 10),
      title: this.getDirectChildText(item, 'title'),
      slug: this.getElementText(item, 'post_name', NS.wp),
      content: this.getElementText(item, 'encoded', NS.content),
      excerpt: this.getElementText(item, 'encoded', NS.excerpt),
      pubDate: this.parsePubDate(item),
      creator: this.getElementText(item, 'creator', NS.dc),
      status: this.getElementText(item, 'status', NS.wp),
      postType: this.getElementText(item, 'post_type', NS.wp),
    };
  }

  async parseFile(filePath: string): Promise<WxrData> {
    const content = await fs.readFile(filePath, 'utf-8');
    return this.parseXml(content);
  }

  parseXml(xmlContent: string): WxrData {
    const doc = new DOMParser().parseFromString(xmlContent, 'text/xml');
    const channel = doc.getElementsByTagName('channel')[0];

    if (!channel) {
      throw new Error('Invalid WXR file: no <channel> element found');
    }

    const site = this.parseSiteInfo(channel);
    const categories = this.parseChannelCategories(channel);
    const tags = this.parseChannelTags(channel);

    const posts: WxrPost[] = [];
    const pages: WxrPost[] = [];
    const media: WxrMedia[] = [];

    const items = channel.getElementsByTagName('item');
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const postType = this.getElementText(item, 'post_type', NS.wp);

      if (postType === 'attachment') {
        media.push(this.parseMediaItem(item));
      } else if (postType === 'page') {
        pages.push(this.parsePostItem(item));
      } else {
        // 'post' and any other custom post types
        posts.push(this.parsePostItem(item));
      }
    }

    return { site, posts, pages, media, categories, tags };
  }

  private parseSiteInfo(channel: Element): WxrSiteInfo {
    return {
      title: this.getDirectChildText(channel, 'title'),
      link: this.getDirectChildText(channel, 'link'),
      description: this.getDirectChildText(channel, 'description'),
      language: this.getDirectChildText(channel, 'language'),
    };
  }

  private parseChannelCategories(channel: Element): WxrCategory[] {
    const categories: WxrCategory[] = [];
    const elements = channel.getElementsByTagNameNS(NS.wp, 'category');

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      // Only process direct children of channel (not item-level category elements)
      if (el.parentNode !== channel) continue;

      categories.push({
        name: this.getElementText(el, 'cat_name', NS.wp),
        slug: this.getElementText(el, 'category_nicename', NS.wp),
        parent: this.getElementText(el, 'category_parent', NS.wp),
      });
    }

    return categories;
  }

  private parseChannelTags(channel: Element): WxrTag[] {
    const tags: WxrTag[] = [];
    const elements = channel.getElementsByTagNameNS(NS.wp, 'tag');

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (el.parentNode !== channel) continue;

      tags.push({
        name: this.getElementText(el, 'tag_name', NS.wp),
        slug: this.getElementText(el, 'tag_slug', NS.wp),
      });
    }

    return tags;
  }

  private parsePostItem(item: Element): WxrPost {
    const base = this.parseItemBase(item);
    const categories: string[] = [];
    const tags: string[] = [];

    // Item-level <category> elements (no namespace)
    const catElements = item.getElementsByTagName('category');
    for (let i = 0; i < catElements.length; i++) {
      const el = catElements[i];
      // Only direct children of item
      if (el.parentNode !== item) continue;
      const domain = el.getAttribute('domain');
      const text = this.getTextContent(el);
      if (domain === 'category' && text) {
        categories.push(text);
      } else if (domain === 'post_tag' && text) {
        tags.push(text);
      }
    }

    // Parse WordPress local post date (wp:post_date)
    const postDateStr = this.getElementText(item, 'post_date', NS.wp);
    let postDate: Date | null = null;
    if (postDateStr) {
      const parsed = new Date(postDateStr.replace(' ', 'T') + 'Z');
      if (!isNaN(parsed.getTime())) {
        postDate = parsed;
      }
    }

    // Parse WordPress local modification date (wp:post_modified)
    const postModifiedStr = this.getElementText(item, 'post_modified', NS.wp);
    let postModified: Date | null = null;
    if (postModifiedStr) {
      const parsed = new Date(postModifiedStr.replace(' ', 'T') + 'Z');
      if (!isNaN(parsed.getTime())) {
        postModified = parsed;
      }
    }

    return {
      wpId: base.wpId,
      title: base.title,
      slug: base.slug,
      content: base.content,
      excerpt: base.excerpt,
      pubDate: base.pubDate,
      postDate,
      postModified,
      creator: base.creator,
      status: base.status,
      postType: base.postType,
      categories,
      tags,
    };
  }

  private parseMediaItem(item: Element): WxrMedia {
    const base = this.parseItemBase(item);
    const url = this.getElementText(item, 'attachment_url', NS.wp);
    const filename = this.extractFilename(url);
    const relativePath = this.extractRelativePath(url);

    return {
      wpId: base.wpId,
      title: base.title,
      url,
      filename,
      relativePath,
      pubDate: base.pubDate,
      parentId: parseInt(this.getElementText(item, 'post_parent', NS.wp) || '0', 10),
      mimeType: this.inferMimeType(filename),
      description: base.content,
    };
  }

  private extractFilename(url: string): string {
    if (!url) return '';
    try {
      const pathname = new URL(url).pathname;
      return pathname.split('/').pop() || '';
    } catch {
      return url.split('/').pop() || '';
    }
  }

  private extractRelativePath(url: string): string {
    if (!url) return '';
    // Extract path after wp-content/uploads/
    const marker = 'wp-content/uploads/';
    const idx = url.indexOf(marker);
    if (idx !== -1) {
      return url.substring(idx + marker.length);
    }
    // Fallback: return filename only
    return this.extractFilename(url);
  }

  private inferMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return EXT_TO_MIME[ext] || 'application/octet-stream';
  }

  /** Get text content of a namespaced child element */
  private getElementText(parent: Element, localName: string, nsUri: string): string {
    const elements = parent.getElementsByTagNameNS(nsUri, localName);
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      // Find first one that is either a direct child or a grandchild (for nested structures)
      if (el.parentNode === parent || el.parentNode?.parentNode === parent) {
        return this.getTextContent(el);
      }
    }
    return '';
  }

  /** Get text content of a direct child element (no namespace) */
  private getDirectChildText(parent: Element, tagName: string): string {
    const children = parent.childNodes;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.nodeType === 1 && (child as Element).localName === tagName) {
        return this.getTextContent(child as Element);
      }
    }
    return '';
  }

  /** Safely extract text content, handling CDATA sections */
  private getTextContent(el: Element): string {
    let text = '';
    const children = el.childNodes;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.nodeType === 3 || child.nodeType === 4) {
        // Text node or CDATA section
        text += child.nodeValue || '';
      }
    }
    return text;
  }
}
