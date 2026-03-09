/**
 * Shared utilities for reading and parsing post markdown files.
 * Used by PostEngine for editing.
 */

import * as fs from 'fs/promises';
import matter from 'gray-matter';

export interface PostFileData {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
  content: string;
  status: 'draft' | 'published' | 'archived';
  author?: string;
  language?: string;
  doNotTranslate?: boolean;
  templateSlug?: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
  tags: string[];
  categories: string[];
}

interface PostFileMetadata {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
  status: 'draft' | 'published' | 'archived';
  author?: string;
  language?: string;
  doNotTranslate?: boolean;
  templateSlug?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  tags?: string[];
  categories?: string[];
}

/**
 * Read and parse a post markdown file with YAML frontmatter.
 * @param filePath Absolute path to the .md file
 * @returns Parsed post data or null if file doesn't exist or can't be parsed
 */
export async function readPostFile(filePath: string): Promise<PostFileData | null> {
  try {
    // Check if file exists first to avoid noisy errors
    try {
      await fs.access(filePath);
    } catch {
      // File doesn't exist
      return null;
    }

    const fileContent = await fs.readFile(filePath, 'utf-8');
    const { data, content: body } = matter(fileContent);
    const metadata = data as PostFileMetadata;

    return {
      id: metadata.id,
      title: metadata.title,
      slug: metadata.slug,
      excerpt: metadata.excerpt,
      content: body,
      status: metadata.status,
      author: metadata.author,
      language: metadata.language || undefined,
      doNotTranslate: metadata.doNotTranslate === true,
      templateSlug: metadata.templateSlug || undefined,
      createdAt: new Date(metadata.createdAt),
      updatedAt: new Date(metadata.updatedAt),
      publishedAt: metadata.publishedAt ? new Date(metadata.publishedAt) : undefined,
      tags: metadata.tags || [],
      categories: metadata.categories || [],
    };
  } catch (error) {
    console.error(`Failed to parse post file: ${filePath}`, error);
    return null;
  }
}