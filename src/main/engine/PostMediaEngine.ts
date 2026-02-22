/**
 * PostMediaEngine
 * 
 * Manages the relationship between posts and media files.
 * Handles linking, unlinking, ordering, and querying post-media associations.
 * 
 * Data is persisted in two places:
 * 1. postMedia junction table in the database (for querying)
 * 2. linkedPostIds field in media sidecar files (source of truth for rebuild)
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, asc } from 'drizzle-orm';
import { getDatabase } from '../database';
import { postMedia, PostMediaLink, NewPostMediaLink } from '../database/schema';
import { getMediaEngine, MediaData } from './MediaEngine';

export interface PostMediaLinkData {
  id: string;
  projectId: string;
  postId: string;
  mediaId: string;
  sortOrder: number;
  createdAt: Date;
}

// Singleton instance
let postMediaEngineInstance: PostMediaEngine | null = null;

export class PostMediaEngine extends EventEmitter {
  private currentProjectId: string = 'default';

  constructor() {
    super();
  }

  private getDb() {
    return getDatabase().getLocal();
  }

  private getUniqueMediaIds(mediaIds: string[]): string[] {
    return Array.from(new Set(mediaIds));
  }

  private async addPostToMediaSidecar(mediaId: string, postId: string): Promise<void> {
    const media = await getMediaEngine().getMedia(mediaId);
    if (!media) {
      return;
    }

    const linkedPostIds = media.linkedPostIds || [];
    if (linkedPostIds.includes(postId)) {
      return;
    }

    await getMediaEngine().updateMedia(mediaId, {
      linkedPostIds: [...linkedPostIds, postId],
    });
  }

  private async removePostFromMediaSidecar(mediaId: string, postId: string): Promise<void> {
    const media = await getMediaEngine().getMedia(mediaId);
    if (!media) {
      return;
    }

    const linkedPostIds = (media.linkedPostIds || []).filter(id => id !== postId);
    await getMediaEngine().updateMedia(mediaId, { linkedPostIds });
  }

  private createLinkData(link: NewPostMediaLink): PostMediaLinkData {
    return {
      id: link.id,
      projectId: link.projectId,
      postId: link.postId,
      mediaId: link.mediaId,
      sortOrder: link.sortOrder ?? 0,
      createdAt: link.createdAt,
    };
  }

  private async createPostMediaLink(postId: string, mediaId: string, sortOrder: number, createdAt: Date): Promise<PostMediaLinkData> {
    const db = this.getDb();

    const link: NewPostMediaLink = {
      id: uuidv4(),
      projectId: this.currentProjectId,
      postId,
      mediaId,
      sortOrder,
      createdAt,
    };

    await db.insert(postMedia).values(link);
    await this.addPostToMediaSidecar(mediaId, postId);

    return this.createLinkData(link);
  }

  private async getLinkState(postId: string): Promise<{
    existingByMediaId: Map<string, PostMediaLinkData>;
    nextSortOrder: number;
  }> {
    const existingLinks = await this.getLinkedMediaForPost(postId);
    const existingByMediaId = new Map(existingLinks.map((link) => [link.mediaId, link]));
    const maxSortOrder = existingLinks.length > 0
      ? Math.max(...existingLinks.map((link) => link.sortOrder))
      : -1;

    return {
      existingByMediaId,
      nextSortOrder: maxSortOrder + 1,
    };
  }

  private async tryLinkMediaToPost(
    postId: string,
    mediaId: string,
    state: {
      existingByMediaId: Map<string, PostMediaLinkData>;
      nextSortOrder: number;
    },
    createdAt: Date
  ): Promise<{ linked: true; link: PostMediaLinkData } | { linked: false; existing: PostMediaLinkData }> {
    const existing = state.existingByMediaId.get(mediaId);
    if (existing) {
      return { linked: false, existing };
    }

    const link = await this.createPostMediaLink(postId, mediaId, state.nextSortOrder, createdAt);
    state.nextSortOrder++;
    state.existingByMediaId.set(mediaId, link);

    return { linked: true, link };
  }

  private async unlinkMediaFromPostCore(postId: string, mediaId: string): Promise<void> {
    await this.removePostMediaLink(postId, mediaId);
  }

  private async removePostMediaLink(postId: string, mediaId: string): Promise<void> {
    const db = this.getDb();

    await db.delete(postMedia).where(
      and(
        eq(postMedia.postId, postId),
        eq(postMedia.mediaId, mediaId)
      )
    );

    await this.removePostFromMediaSidecar(mediaId, postId);
  }

  /**
   * Set the current project context
   */
  setProjectContext(projectId: string): void {
    if (this.currentProjectId === projectId) {
      return;
    }

    this.currentProjectId = projectId;
    console.log(`[PostMediaEngine] setProjectContext: projectId=${projectId}`);
  }

  /**
   * Link a media file to a post
   */
  async linkMediaToPost(postId: string, mediaId: string): Promise<PostMediaLinkData> {
    const state = await this.getLinkState(postId);
    const result = await this.tryLinkMediaToPost(postId, mediaId, state, new Date());

    if (!result.linked) {
      return result.existing;
    }

    const linkData = result.link;

    this.emit('mediaLinked', linkData);
    return linkData;
  }

  /**
   * Unlink a media file from a post
   */
  async unlinkMediaFromPost(postId: string, mediaId: string): Promise<void> {
    await this.unlinkMediaFromPostCore(postId, mediaId);

    this.emit('mediaUnlinked', { postId, mediaId });
  }

  /**
   * Batch link multiple media files to a post.
   * Only emits a single event at the end instead of per-item events.
   * Skips media that are already linked.
   */
  async linkManyToPost(postId: string, mediaIds: string[]): Promise<{ linked: string[]; skipped: string[] }> {
    const linked: string[] = [];
    const skipped: string[] = [];
    const uniqueMediaIds = this.getUniqueMediaIds(mediaIds);

    const state = await this.getLinkState(postId);
    const now = new Date();

    for (const mediaId of uniqueMediaIds) {
      const result = await this.tryLinkMediaToPost(postId, mediaId, state, now);
      if (!result.linked) {
        skipped.push(mediaId);
        continue;
      }

      linked.push(mediaId);
    }

    // Emit a single batch event instead of per-item events
    if (linked.length > 0) {
      this.emit('mediaBatchLinked', { postId, mediaIds: linked });
    }

    return { linked, skipped };
  }

  /**
   * Batch unlink multiple media files from a post.
   * Only emits a single event at the end instead of per-item events.
   */
  async unlinkManyFromPost(postId: string, mediaIds: string[]): Promise<{ unlinked: string[] }> {
    const unlinked: string[] = [];
    const uniqueMediaIds = this.getUniqueMediaIds(mediaIds);

    for (const mediaId of uniqueMediaIds) {
      await this.unlinkMediaFromPostCore(postId, mediaId);

      unlinked.push(mediaId);
    }

    // Emit a single batch event instead of per-item events
    if (unlinked.length > 0) {
      this.emit('mediaBatchUnlinked', { postId, mediaIds: unlinked });
    }

    return { unlinked };
  }

  /**
   * Get all media linked to a post, ordered by sortOrder
   */
  async getLinkedMediaForPost(postId: string): Promise<PostMediaLinkData[]> {
    const db = this.getDb();

    const links = await db
      .select()
      .from(postMedia)
      .where(
        and(
          eq(postMedia.projectId, this.currentProjectId),
          eq(postMedia.postId, postId)
        )
      )
      .orderBy(asc(postMedia.sortOrder));

    return links.map(this.mapToLinkData);
  }

  /**
   * Get all posts linked to a media file
   */
  async getLinkedPostsForMedia(mediaId: string): Promise<PostMediaLinkData[]> {
    const db = this.getDb();

    const links = await db
      .select()
      .from(postMedia)
      .where(
        and(
          eq(postMedia.projectId, this.currentProjectId),
          eq(postMedia.mediaId, mediaId)
        )
      );

    return links.map(this.mapToLinkData);
  }

  /**
   * Reorder media within a post
   * @param postId The post ID
   * @param mediaIds Array of media IDs in the new desired order
   */
  async reorderMediaForPost(postId: string, mediaIds: string[]): Promise<void> {
    const db = this.getDb();

    // Update each media's sortOrder based on its position in the array
    for (let i = 0; i < mediaIds.length; i++) {
      await db.update(postMedia)
        .set({ sortOrder: i })
        .where(
          and(
            eq(postMedia.postId, postId),
            eq(postMedia.mediaId, mediaIds[i])
          )
        );
    }

    this.emit('mediaReordered', { postId, mediaIds });
  }

  /**
   * Rebuild the junction table from media sidecar files.
   * This is called during rebuild operations when the database needs to be
   * reconstructed from filesystem source of truth.
   */
  async rebuildFromSidecars(): Promise<void> {
    const db = this.getDb();

    console.log('[PostMediaEngine] Rebuilding post-media links from sidecars...');

    // Clear existing links for this project
    await db.delete(postMedia).where(eq(postMedia.projectId, this.currentProjectId));

    // Get all media with their linkedPostIds
    const allMedia = await getMediaEngine().getAllMedia();
    
    let linksCreated = 0;
    for (const media of allMedia) {
      const linkedPostIds = media.linkedPostIds || [];
      
      for (let i = 0; i < linkedPostIds.length; i++) {
        const postId = linkedPostIds[i];
        const linkId = uuidv4();
        
        await db.insert(postMedia).values({
          id: linkId,
          projectId: this.currentProjectId,
          postId,
          mediaId: media.id,
          sortOrder: i, // Preserve order from sidecar
          createdAt: new Date(),
        });
        
        linksCreated++;
      }
    }

    console.log(`[PostMediaEngine] Rebuilt ${linksCreated} post-media links`);
    this.emit('rebuilt', { linksCreated });
  }

  /**
   * Import media from a file path and link it to a post.
   * This is a convenience method that combines import + link.
   */
  async importMediaForPost(postId: string, sourcePath: string): Promise<PostMediaLinkData> {
    // Import the media file
    const importedMedia = await getMediaEngine().importMedia(sourcePath);
    
    // Link it to the post
    return this.linkMediaToPost(postId, importedMedia.id);
  }

  /**
   * Get linked media with full media data
   */
  async getLinkedMediaDataForPost(postId: string): Promise<Array<PostMediaLinkData & { media: MediaData }>> {
    const links = await this.getLinkedMediaForPost(postId);
    
    const result: Array<PostMediaLinkData & { media: MediaData }> = [];
    for (const link of links) {
      const media = await getMediaEngine().getMedia(link.mediaId);
      if (media) {
        result.push({ ...link, media });
      }
    }
    
    return result;
  }

  /**
   * Check if a media is linked to a post
   */
  async isMediaLinkedToPost(postId: string, mediaId: string): Promise<boolean> {
    const db = this.getDb();

    const link = await db
      .select()
      .from(postMedia)
      .where(
        and(
          eq(postMedia.postId, postId),
          eq(postMedia.mediaId, mediaId)
        )
      )
      .limit(1);

    return link.length > 0;
  }

  /**
   * Map database row to PostMediaLinkData
   */
  private mapToLinkData(row: PostMediaLink): PostMediaLinkData {
    return {
      id: row.id,
      projectId: row.projectId,
      postId: row.postId,
      mediaId: row.mediaId,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
    };
  }
}

/**
 * Get the singleton PostMediaEngine instance
 */
export function getPostMediaEngine(): PostMediaEngine {
  if (!postMediaEngineInstance) {
    postMediaEngineInstance = new PostMediaEngine();
  }
  return postMediaEngineInstance;
}

// Export singleton for convenience
export const postMediaEngine = getPostMediaEngine();
