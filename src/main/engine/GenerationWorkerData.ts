/**
 * Serialization types and utilities for passing data to generation worker threads.
 *
 * Worker threads cannot receive non-serializable objects (Date, Map, etc.) via
 * the structured-clone algorithm used by workerData / postMessage. This module
 * provides a thin serialization layer that converts Dates to ISO strings and
 * Maps to arrays-of-tuples so the data survives the boundary.
 */
import type { PostData } from './PostEngine';
import type { MediaData } from './MediaEngine';
import type { CategoryMetadata, BlogGenerationOptions, BlogGenerationSection } from './BlogGenerationEngine';
import type { CategoryRenderSettings } from './PageRenderer';
import type { MenuDocument } from './MenuEngine';
import type { PicoThemeName } from '../shared/picoThemes';

// ---------------------------------------------------------------------------
// Serialized post (Dates → ISO strings)
// ---------------------------------------------------------------------------

export interface SerializedPostData {
  id: string;
  projectId: string;
  title: string;
  slug: string;
  excerpt?: string;
  content: string;
  status: 'draft' | 'published' | 'archived';
  author?: string;
  language?: string;
  doNotTranslate?: boolean;
  templateSlug?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  tags: string[];
  categories: string[];
  availableLanguages: string[];
  translationSourceSlug?: string;
  translationCanonicalLanguage?: string;
  translationFilePath?: string;
  /** Absolute file path for canonical posts (for lazy content loading in workers). */
  filePath?: string;
}

// ---------------------------------------------------------------------------
// Serialized media item (only what generation needs)
// ---------------------------------------------------------------------------

export interface SerializedMediaData {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  title?: string;
  alt?: string;
  caption?: string;
  author?: string;
  language?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  linkedPostIds?: string[];
  availableLanguages: string[];
}

// ---------------------------------------------------------------------------
// Serialized options (stripped to what the worker actually uses)
// ---------------------------------------------------------------------------

export interface SerializedBlogGenerationOptions {
  projectId: string;
  projectName: string;
  projectDescription?: string;
  dataDir: string;
  baseUrl: string;
  language?: string;
  blogLanguages?: string[];
  picoTheme?: PicoThemeName;
  categoryMetadata?: Record<string, CategoryMetadata>;
  categorySettings?: Record<string, CategoryRenderSettings>;
  menu?: MenuDocument;
}

// ---------------------------------------------------------------------------
// Worker task — everything a worker needs to process one section
// ---------------------------------------------------------------------------

export interface GenerationWorkerTask {
  taskId: string;
  section: BlogGenerationSection;

  /** Posts relevant to this task (single: chunk, others: all list posts). */
  posts: SerializedPostData[];

  /**
   * All published route posts — used by the route renderer for slug lookups,
   * canonical path building, and backlink resolution.
   */
  lookupPosts: SerializedPostData[];

  /** Media items for canonical media path building. */
  mediaItems: SerializedMediaData[];

  /** Pre-resolved backlinks map: postId → linked-by entries. */
  backlinksMap: Record<string, Array<{ id: string; title: string; slug: string }>>;

  options: SerializedBlogGenerationOptions;
  maxPostsPerPage: number;
  htmlDir: string;

  /** Pre-loaded hash map as [relativePath, contentHash] tuples. */
  hashMapEntries: Array<[string, string]>;

  /** Post file paths for lazy content loading: [postId, absoluteFilePath] tuples. */
  postFilePathEntries: Array<[string, string]>;

  /** Post-media links: [postId, [{mediaId, sortOrder}]] tuples for gallery/album macros. */
  postMediaLinksEntries: Array<[string, Array<{ mediaId: string; sortOrder: number }>]>;

  /** Language prefix for subtree generation, e.g. "/fr". */
  languagePrefix?: string;

  /** The project's actual main language (for href_prefix computation in subtree rendering). */
  mainLanguage?: string;

  // -- Section-specific data (category / tag / date) -----------------------

  allCategories?: string[];
  allTags?: string[];

  /** Serialized Maps as arrays of tuples. */
  yearsEntries?: Array<[number, string]>;
  yearMonthsEntries?: Array<[string, string]>;
  yearMonthDaysEntries?: Array<[string, string]>;

  /** Pre-built post index (avoids rebuilding in each worker). */
  postsByCategoryEntries?: Array<[string, SerializedPostData[]]>;
  postsByTagEntries?: Array<[string, SerializedPostData[]]>;
  postsByYearEntries?: Array<[number, SerializedPostData[]]>;
  postsByYearMonthEntries?: Array<[string, SerializedPostData[]]>;
  postsByYearMonthDayEntries?: Array<[string, SerializedPostData[]]>;
}

// ---------------------------------------------------------------------------
// Messages between main thread and worker
// ---------------------------------------------------------------------------

export interface WorkerProgressMessage {
  type: 'progress';
  taskId: string;
  message: string;
}

export interface WorkerResultMessage {
  type: 'result';
  taskId: string;
  pagesGenerated: number;
  /** Hash updates accumulated during generation, to be written by the main thread. */
  hashUpdates: Array<{ relativePath: string; hash: string }>;
}

export interface WorkerErrorMessage {
  type: 'error';
  taskId: string;
  error: string;
}

export type WorkerOutboundMessage =
  | WorkerProgressMessage
  | WorkerResultMessage
  | WorkerErrorMessage;

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

export function serializePostData(post: PostData): SerializedPostData {
  const serialized: SerializedPostData = {
    id: post.id,
    projectId: post.projectId,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    content: post.content ?? '',
    status: post.status,
    author: post.author,
    language: post.language,
    doNotTranslate: post.doNotTranslate,
    templateSlug: post.templateSlug,
    createdAt: post.createdAt instanceof Date ? post.createdAt.toISOString() : String(post.createdAt),
    updatedAt: post.updatedAt instanceof Date ? post.updatedAt.toISOString() : String(post.updatedAt),
    publishedAt: post.publishedAt instanceof Date ? post.publishedAt.toISOString() : post.publishedAt ? String(post.publishedAt) : undefined,
    tags: post.tags ?? [],
    categories: post.categories ?? [],
    availableLanguages: post.availableLanguages ?? [],
  };

  // Preserve translation variant fields if present
  const variant = post as PostData & {
    translationSourceSlug?: string;
    translationCanonicalLanguage?: string;
    translationFilePath?: string;
  };
  if (variant.translationSourceSlug) serialized.translationSourceSlug = variant.translationSourceSlug;
  if (variant.translationCanonicalLanguage) serialized.translationCanonicalLanguage = variant.translationCanonicalLanguage;
  if (variant.translationFilePath) serialized.translationFilePath = variant.translationFilePath;

  return serialized;
}

export function deserializePostData(serialized: SerializedPostData): PostData {
  const post: PostData = {
    id: serialized.id,
    projectId: serialized.projectId,
    title: serialized.title,
    slug: serialized.slug,
    excerpt: serialized.excerpt,
    content: serialized.content ?? '',
    status: serialized.status,
    author: serialized.author,
    language: serialized.language,
    doNotTranslate: serialized.doNotTranslate,
    templateSlug: serialized.templateSlug,
    createdAt: new Date(serialized.createdAt),
    updatedAt: new Date(serialized.updatedAt),
    publishedAt: serialized.publishedAt ? new Date(serialized.publishedAt) : undefined,
    tags: serialized.tags ?? [],
    categories: serialized.categories ?? [],
    availableLanguages: serialized.availableLanguages ?? [],
  };

  // Re-attach translation variant fields
  if (serialized.translationSourceSlug) {
    (post as any).translationSourceSlug = serialized.translationSourceSlug;
  }
  if (serialized.translationCanonicalLanguage) {
    (post as any).translationCanonicalLanguage = serialized.translationCanonicalLanguage;
  }
  if (serialized.translationFilePath) {
    (post as any).translationFilePath = serialized.translationFilePath;
  }

  return post;
}

export function serializeMediaItem(media: MediaData): SerializedMediaData {
  return {
    id: media.id,
    filename: media.filename,
    originalName: media.originalName,
    mimeType: media.mimeType,
    size: media.size,
    width: media.width,
    height: media.height,
    title: media.title,
    alt: media.alt,
    caption: media.caption,
    author: media.author,
    language: media.language,
    createdAt: media.createdAt instanceof Date ? media.createdAt.toISOString() : String(media.createdAt),
    updatedAt: media.updatedAt instanceof Date ? media.updatedAt.toISOString() : String(media.updatedAt),
    tags: media.tags ?? [],
    linkedPostIds: media.linkedPostIds,
    availableLanguages: media.availableLanguages ?? [],
  };
}

export function deserializeMediaItem(serialized: SerializedMediaData): MediaData {
  return {
    id: serialized.id,
    filename: serialized.filename,
    originalName: serialized.originalName,
    mimeType: serialized.mimeType,
    size: serialized.size,
    width: serialized.width,
    height: serialized.height,
    title: serialized.title,
    alt: serialized.alt,
    caption: serialized.caption,
    author: serialized.author,
    language: serialized.language,
    createdAt: new Date(serialized.createdAt),
    updatedAt: new Date(serialized.updatedAt),
    tags: serialized.tags ?? [],
    linkedPostIds: serialized.linkedPostIds,
    availableLanguages: serialized.availableLanguages ?? [],
  };
}

export function serializeBlogGenerationOptions(options: BlogGenerationOptions): SerializedBlogGenerationOptions {
  return {
    projectId: options.projectId,
    projectName: options.projectName,
    projectDescription: options.projectDescription,
    dataDir: options.dataDir,
    baseUrl: options.baseUrl,
    language: options.language,
    blogLanguages: options.blogLanguages,
    picoTheme: options.picoTheme,
    categoryMetadata: options.categoryMetadata,
    categorySettings: options.categorySettings,
    menu: options.menu,
  };
}

/** Serialize a Map<K, PostData[]> to an array of [K, SerializedPostData[]] tuples. */
export function serializePostMap<K extends string | number>(map: Map<K, PostData[]>): Array<[K, SerializedPostData[]]> {
  return Array.from(map.entries()).map(([key, posts]) => [key, posts.map(serializePostData)]);
}

/** Deserialize an array of [K, SerializedPostData[]] tuples to a Map<K, PostData[]>. */
export function deserializePostMap<K extends string | number>(entries: Array<[K, SerializedPostData[]]>): Map<K, PostData[]> {
  return new Map(entries.map(([key, posts]) => [key, posts.map(deserializePostData)]));
}

/** Serialize a Map<K, Date> to an array of [K, string] tuples. */
export function serializeDateMap<K extends string | number>(map: Map<K, Date>): Array<[K, string]> {
  return Array.from(map.entries()).map(([key, date]) => [key, date.toISOString()]);
}

/** Deserialize an array of [K, string] tuples to a Map<K, Date>. */
export function deserializeDateMap<K extends string | number>(entries: Array<[K, string]>): Map<K, Date> {
  return new Map(entries.map(([key, iso]) => [key, new Date(iso)]));
}
