import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { Dropbox } from 'dropbox';
import type { FSWatcher } from 'chokidar';

type ChokidarWatchFn = (paths: string | readonly string[], options?: Record<string, unknown>) => FSWatcher;

let _chokidarWatch: ChokidarWatchFn | null = null;
async function getChokidarWatch(): Promise<ChokidarWatchFn> {
  if (!_chokidarWatch) {
    const chokidar = await import('chokidar');
    _chokidarWatch = chokidar.watch as unknown as ChokidarWatchFn;
  }
  return _chokidarWatch;
}

// ============================================
// Types & Interfaces
// ============================================

export interface DropboxSyncConfig {
  accessToken?: string;
  refreshToken?: string;
  appKey: string;
  appSecret?: string;
  syncEnabled: boolean;
  syncInterval: number; // seconds between remote polls
  localPostsDir: string;
  localMediaDir: string;
  remoteBasePath?: string; // e.g., '/bds' or '' for app folder root
}

export type DropboxSyncStatus = 'idle' | 'syncing' | 'watching' | 'error' | 'unauthorized';

export type ConflictResolution = 'local-wins' | 'remote-wins' | 'manual';

export interface DropboxConflict {
  id: string;
  localPath: string;
  remotePath: string;
  localModified: Date;
  remoteModified: Date;
  localHash: string;
  remoteHash: string;
}

export interface DropboxRemoteChange {
  tag: 'file' | 'folder' | 'deleted';
  name: string;
  pathLower: string;
  contentHash?: string;
  serverModified?: string;
  size?: number;
}

export interface DropboxChangesResult {
  entries: DropboxRemoteChange[];
  cursor: string;
  hasMore: boolean;
}

export interface FileUploadResult {
  remotePath: string;
  contentHash: string;
  serverModified: string;
  size: number;
}

export interface FileDownloadResult {
  localPath: string;
  remotePath: string;
  contentHash: string;
  serverModified: string;
  size: number;
}

export interface FileSyncResult {
  success: boolean;
  uploaded: number;
  downloaded: number;
  deleted: number;
  conflicts: number;
  errors: string[];
}

// ============================================
// DropboxSyncEngine
// ============================================

export class DropboxSyncEngine extends EventEmitter {
  private status: DropboxSyncStatus = 'idle';
  private config: DropboxSyncConfig | null = null;
  private dropboxClient: Dropbox;
  private watchFn: ChokidarWatchFn | null;
  private watcher: FSWatcher | null = null;
  private pollIntervalId: NodeJS.Timeout | null = null;
  private pendingConflicts: Map<string, DropboxConflict> = new Map();
  private cursor: string | null = null;
  private lastSyncTime: Date | null = null;
  private isSyncing = false;

  // Debounce tracking for local file changes
  private pendingUploads: Map<string, NodeJS.Timeout> = new Map();
  private uploadDebounceMs = 1000;

  // Track files we wrote ourselves (to ignore watcher events)
  private recentDownloads: Set<string> = new Set();

  constructor(dropboxClient?: Dropbox, watchFn?: ChokidarWatchFn) {
    super();
    this.dropboxClient = dropboxClient || new Dropbox({});
    this.watchFn = watchFn || null;
  }

  private async getWatchFn(): Promise<ChokidarWatchFn> {
    if (!this.watchFn) {
      this.watchFn = await getChokidarWatch();
    }
    return this.watchFn;
  }

  // ============================================
  // Status & Configuration
  // ============================================

  getStatus(): DropboxSyncStatus {
    return this.status;
  }

  isConfigured(): boolean {
    return this.config !== null && !!this.config.accessToken;
  }

  getRemoteBasePath(): string {
    return this.config?.remoteBasePath ?? '';
  }

  async configure(config: DropboxSyncConfig): Promise<void> {
    this.config = {
      ...config,
      remoteBasePath: config.remoteBasePath ?? '',
    };

    // Update the Dropbox client with new auth if using default client
    if (config.accessToken) {
      // Re-initialize client would happen here for real SDK usage
    }

    this.emit('configured', this.config);
  }

  // ============================================
  // Path Mapping
  // ============================================

  /**
   * Map a local filesystem path to a remote Dropbox path.
   * Returns null if the path doesn't fall under posts or media directories.
   */
  localToRemotePath(localPath: string): string | null {
    if (!this.config) return null;

    const normalizedLocal = localPath.replace(/\\/g, '/');
    const postsDir = this.config.localPostsDir.replace(/\\/g, '/');
    const mediaDir = this.config.localMediaDir.replace(/\\/g, '/');
    const basePath = this.config.remoteBasePath ?? '';

    if (normalizedLocal.startsWith(postsDir)) {
      const relativePath = normalizedLocal.slice(postsDir.length);
      return `${basePath}/posts${relativePath}`;
    }

    if (normalizedLocal.startsWith(mediaDir)) {
      const relativePath = normalizedLocal.slice(mediaDir.length);
      return `${basePath}/media${relativePath}`;
    }

    return null;
  }

  /**
   * Map a remote Dropbox path to a local filesystem path.
   * Returns null if the path doesn't match posts or media remote paths.
   */
  remoteToLocalPath(remotePath: string): string | null {
    if (!this.config) return null;

    const basePath = this.config.remoteBasePath ?? '';
    const postsPrefix = `${basePath}/posts`;
    const mediaPrefix = `${basePath}/media`;

    if (remotePath.startsWith(postsPrefix)) {
      const relativePath = remotePath.slice(postsPrefix.length);
      return `${this.config.localPostsDir}${relativePath}`;
    }

    if (remotePath.startsWith(mediaPrefix)) {
      const relativePath = remotePath.slice(mediaPrefix.length);
      return `${this.config.localMediaDir}${relativePath}`;
    }

    return null;
  }

  // ============================================
  // File Upload
  // ============================================

  async uploadFile(localPath: string): Promise<FileUploadResult> {
    const remotePath = this.localToRemotePath(localPath);
    if (!remotePath) {
      throw new Error('Cannot map local path to remote path');
    }

    let content: Buffer;
    try {
      content = await fs.readFile(localPath) as Buffer;
    } catch (error) {
      throw error;
    }

    try {
      const response = await this.dropboxClient.filesUpload({
        path: remotePath,
        contents: content,
        mode: { '.tag': 'overwrite' },
        autorename: false,
      });

      const result: FileUploadResult = {
        remotePath: response.result.path_lower || remotePath,
        contentHash: (response.result as any).content_hash || '',
        serverModified: (response.result as any).server_modified || new Date().toISOString(),
        size: (response.result as any).size || content.length,
      };

      this.emit('fileUploaded', {
        localPath,
        remotePath: result.remotePath,
        contentHash: result.contentHash,
      });

      return result;
    } catch (error: any) {
      if (error?.status === 401) {
        this.emit('authError', error);
      }
      throw error;
    }
  }

  // ============================================
  // File Download
  // ============================================

  async downloadFile(remotePath: string): Promise<FileDownloadResult> {
    const localPath = this.remoteToLocalPath(remotePath);
    if (!localPath) {
      throw new Error('Cannot map remote path to local path');
    }

    const response = await this.dropboxClient.filesDownload({ path: remotePath });
    const result = response.result as any;
    const content: Buffer = result.fileBinary;

    // Ensure the target directory exists
    const dir = path.dirname(localPath);
    await fs.mkdir(dir, { recursive: true });

    // Mark as our own write so the watcher ignores it
    this.recentDownloads.add(localPath);
    setTimeout(() => this.recentDownloads.delete(localPath), 2000);

    await fs.writeFile(localPath, content);

    const downloadResult: FileDownloadResult = {
      localPath,
      remotePath,
      contentHash: result.content_hash || '',
      serverModified: result.server_modified || new Date().toISOString(),
      size: result.size || content.length,
    };

    this.emit('fileDownloaded', downloadResult);

    return downloadResult;
  }

  // ============================================
  // File Deletion (Remote)
  // ============================================

  async deleteRemoteFile(remotePath: string): Promise<void> {
    try {
      await this.dropboxClient.filesDeleteV2({ path: remotePath });
      this.emit('fileDeleted', { remotePath });
    } catch (error: any) {
      // If the file is already gone, that's fine
      const isNotFound =
        error?.error?.['.tag'] === 'path_lookup' ||
        error?.error?.path_lookup?.['.tag'] === 'not_found';
      if (!isNotFound) {
        throw error;
      }
    }
  }

  // ============================================
  // Delta Sync (Cursor-based)
  // ============================================

  async getLatestCursor(): Promise<string> {
    const basePath = this.config?.remoteBasePath ?? '';
    const response = await this.dropboxClient.filesListFolderGetLatestCursor({
      path: basePath,
      recursive: true,
      include_deleted: true,
    } as any);

    return response.result.cursor;
  }

  async getRemoteChanges(cursor: string): Promise<DropboxChangesResult> {
    const response = await this.dropboxClient.filesListFolderContinue({ cursor });
    const result = response.result;

    const entries: DropboxRemoteChange[] = result.entries.map((entry: any) => ({
      tag: entry['.tag'] as 'file' | 'folder' | 'deleted',
      name: entry.name,
      pathLower: entry.path_lower,
      contentHash: entry.content_hash,
      serverModified: entry.server_modified,
      size: entry.size,
    }));

    return {
      entries,
      cursor: result.cursor,
      hasMore: result.has_more,
    };
  }

  /**
   * Fetch all remote changes, following pagination automatically.
   */
  async getAllRemoteChanges(cursor: string): Promise<DropboxChangesResult> {
    const allEntries: DropboxRemoteChange[] = [];
    let currentCursor = cursor;
    let hasMore = true;

    while (hasMore) {
      const changes = await this.getRemoteChanges(currentCursor);
      allEntries.push(...changes.entries);
      currentCursor = changes.cursor;
      hasMore = changes.hasMore;
    }

    return {
      entries: allEntries,
      cursor: currentCursor,
      hasMore: false,
    };
  }

  // ============================================
  // Full Sync Operation
  // ============================================

  async syncAll(): Promise<FileSyncResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        uploaded: 0,
        downloaded: 0,
        deleted: 0,
        conflicts: 0,
        errors: ['Dropbox sync not configured'],
      };
    }

    if (this.isSyncing) {
      return {
        success: false,
        uploaded: 0,
        downloaded: 0,
        deleted: 0,
        conflicts: 0,
        errors: ['Sync already in progress'],
      };
    }

    this.isSyncing = true;
    this.status = 'syncing';
    this.emit('syncStarted');

    const result: FileSyncResult = {
      success: true,
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      conflicts: 0,
      errors: [],
    };

    try {
      // Phase 1: Get remote state
      let remoteFiles: Map<string, DropboxRemoteChange>;
      try {
        remoteFiles = await this.listRemoteFiles();
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        result.success = false;
        result.errors.push(`Failed to list remote files: ${msg}`);
        this.status = 'error';
        this.emit('syncFailed', msg);
        return result;
      }

      // Phase 2: Get local state
      const localFiles = await this.listLocalFiles();

      // Phase 3: Compare and sync
      // Files only on remote → download
      for (const [remotePath, remoteEntry] of remoteFiles) {
        const localPath = this.remoteToLocalPath(remotePath);
        if (!localPath) continue;

        if (!localFiles.has(localPath)) {
          try {
            await this.downloadFile(remotePath);
            result.downloaded++;
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            result.errors.push(`Download failed ${remotePath}: ${msg}`);
          }
        }
      }

      // Files only on local → upload
      for (const [localPath] of localFiles) {
        const remotePath = this.localToRemotePath(localPath);
        if (!remotePath) continue;

        if (!remoteFiles.has(remotePath)) {
          try {
            await this.uploadFile(localPath);
            result.uploaded++;
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            result.errors.push(`Upload failed ${localPath}: ${msg}`);
          }
        }
      }

      // Files on both → compare hashes, handle conflicts
      for (const [remotePath, remoteEntry] of remoteFiles) {
        const localPath = this.remoteToLocalPath(remotePath);
        if (!localPath || !localFiles.has(localPath)) continue;

        const localInfo = localFiles.get(localPath)!;
        const localContent = await fs.readFile(localPath) as Buffer;
        const localHash = this.calculateContentHash(localContent);

        if (remoteEntry.contentHash && localHash !== remoteEntry.contentHash) {
          // Both modified → conflict
          const conflict = this.createConflict(localPath, remotePath, {
            localModified: localInfo.mtime,
            remoteModified: remoteEntry.serverModified
              ? new Date(remoteEntry.serverModified)
              : new Date(),
            localHash,
            remoteHash: remoteEntry.contentHash,
          });
          this.addPendingConflict(conflict);
          result.conflicts++;
        }
      }

      // Update cursor
      try {
        const newCursor = await this.getLatestCursor();
        this.cursor = newCursor;
      } catch {
        // Non-fatal: cursor update failure doesn't invalidate the sync
      }

      this.lastSyncTime = new Date();
      this.status = 'idle';
      this.emit('syncCompleted', result);

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      result.success = false;
      result.errors.push(msg);
      this.status = 'error';
      this.emit('syncFailed', msg);
      return result;
    } finally {
      this.isSyncing = false;
    }
  }

  // ============================================
  // List Remote Files
  // ============================================

  private async listRemoteFiles(): Promise<Map<string, DropboxRemoteChange>> {
    const files = new Map<string, DropboxRemoteChange>();
    const basePath = this.config?.remoteBasePath ?? '';

    const response = await this.dropboxClient.filesListFolder({
      path: basePath,
      recursive: true,
      include_deleted: false,
    } as any);

    for (const entry of response.result.entries as any[]) {
      if (entry['.tag'] === 'file') {
        files.set(entry.path_lower, {
          tag: 'file',
          name: entry.name,
          pathLower: entry.path_lower,
          contentHash: entry.content_hash,
          serverModified: entry.server_modified,
          size: entry.size,
        });
      }
    }

    let cursor = response.result.cursor;
    let hasMore = response.result.has_more;

    while (hasMore) {
      const continueResponse = await this.dropboxClient.filesListFolderContinue({ cursor });
      for (const entry of continueResponse.result.entries as any[]) {
        if (entry['.tag'] === 'file') {
          files.set(entry.path_lower, {
            tag: 'file',
            name: entry.name,
            pathLower: entry.path_lower,
            contentHash: entry.content_hash,
            serverModified: entry.server_modified,
            size: entry.size,
          });
        }
      }
      cursor = continueResponse.result.cursor;
      hasMore = continueResponse.result.has_more;
    }

    return files;
  }

  // ============================================
  // List Local Files
  // ============================================

  private async listLocalFiles(): Promise<Map<string, { mtime: Date; size: number }>> {
    const files = new Map<string, { mtime: Date; size: number }>();

    if (!this.config) return files;

    const dirs = [this.config.localPostsDir, this.config.localMediaDir];

    for (const dir of dirs) {
      try {
        await this.walkDirectory(dir, files);
      } catch {
        // Directory may not exist yet
      }
    }

    return files;
  }

  private async walkDirectory(
    dir: string,
    files: Map<string, { mtime: Date; size: number }>
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir) as unknown as string[];
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isFile()) {
          files.set(fullPath.replace(/\\/g, '/'), {
            mtime: stat.mtime,
            size: stat.size,
          });
        } else if (stat.isDirectory()) {
          await this.walkDirectory(fullPath, files);
        }
      } catch {
        // Skip files we can't stat
      }
    }
  }

  // ============================================
  // Conflict Management
  // ============================================

  createConflict(
    localPath: string,
    remotePath: string,
    details: {
      localModified: Date;
      remoteModified: Date;
      localHash: string;
      remoteHash: string;
    }
  ): DropboxConflict {
    const conflict: DropboxConflict = {
      id: uuidv4(),
      localPath,
      remotePath,
      localModified: details.localModified,
      remoteModified: details.remoteModified,
      localHash: details.localHash,
      remoteHash: details.remoteHash,
    };

    this.emit('conflictDetected', conflict);
    return conflict;
  }

  async resolveConflict(
    conflict: DropboxConflict,
    resolution: ConflictResolution
  ): Promise<void> {
    if (resolution === 'local-wins') {
      // Upload local version to overwrite remote
      await this.uploadFile(conflict.localPath);
    } else if (resolution === 'remote-wins') {
      // Download remote version to overwrite local
      await this.downloadFile(conflict.remotePath);
    }
    // 'manual' resolution is handled by the UI

    this.removePendingConflict(conflict.id);
    this.emit('conflictResolved', conflict, resolution);
  }

  addPendingConflict(conflict: DropboxConflict): void {
    this.pendingConflicts.set(conflict.id, conflict);
  }

  removePendingConflict(id: string): void {
    this.pendingConflicts.delete(id);
  }

  getPendingConflicts(): DropboxConflict[] {
    return Array.from(this.pendingConflicts.values());
  }

  clearPendingConflicts(): void {
    this.pendingConflicts.clear();
  }

  // ============================================
  // Content Hash (Dropbox-compatible)
  // ============================================

  /**
   * Calculate a content hash for a buffer.
   * Uses SHA-256 of 4 MB blocks, then SHA-256 of the concatenated block hashes,
   * matching Dropbox's content_hash algorithm.
   */
  calculateContentHash(content: Buffer): string {
    const BLOCK_SIZE = 4 * 1024 * 1024; // 4 MB
    const blockHashes: Buffer[] = [];

    for (let offset = 0; offset < content.length; offset += BLOCK_SIZE) {
      const block = content.subarray(offset, Math.min(offset + BLOCK_SIZE, content.length));
      const hash = crypto.createHash('sha256').update(block).digest();
      blockHashes.push(hash);
    }

    // Handle empty file
    if (blockHashes.length === 0) {
      blockHashes.push(crypto.createHash('sha256').update(Buffer.alloc(0)).digest());
    }

    const concatenated = Buffer.concat(blockHashes);
    return crypto.createHash('sha256').update(concatenated).digest('hex');
  }

  // ============================================
  // Local File Watching
  // ============================================

  async startWatching(): Promise<void> {
    if (!this.config) return;

    const watchPaths = [
      this.config.localPostsDir,
      this.config.localMediaDir,
    ];

    const watchFn = await this.getWatchFn();
    this.watcher = watchFn(watchPaths, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher
      .on('add', (filePath: string) => this.handleLocalFileChange(filePath, 'add'))
      .on('change', (filePath: string) => this.handleLocalFileChange(filePath, 'change'))
      .on('unlink', (filePath: string) => this.handleLocalFileUnlink(filePath));

    this.status = 'watching';
    this.emit('watchStarted');
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    // Clear any pending upload debounces
    for (const timeout of this.pendingUploads.values()) {
      clearTimeout(timeout);
    }
    this.pendingUploads.clear();

    if (this.status === 'watching') {
      this.status = 'idle';
    }
    this.emit('watchStopped');
  }

  private handleLocalFileChange(filePath: string, event: 'add' | 'change'): void {
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Skip files we just downloaded from Dropbox
    if (this.recentDownloads.has(normalizedPath)) {
      return;
    }

    // Debounce uploads to avoid rapid successive uploads
    if (this.pendingUploads.has(normalizedPath)) {
      clearTimeout(this.pendingUploads.get(normalizedPath)!);
    }

    const timeout = setTimeout(async () => {
      this.pendingUploads.delete(normalizedPath);
      try {
        await this.uploadFile(normalizedPath);
        this.emit('localFileChanged', { path: normalizedPath, event });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        this.emit('uploadError', { path: normalizedPath, error: msg });
      }
    }, this.uploadDebounceMs);

    this.pendingUploads.set(normalizedPath, timeout);
  }

  private async handleLocalFileUnlink(filePath: string): Promise<void> {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const remotePath = this.localToRemotePath(normalizedPath);

    if (remotePath) {
      try {
        await this.deleteRemoteFile(remotePath);
        this.emit('localFileDeleted', { localPath: normalizedPath, remotePath });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        this.emit('deleteError', { path: normalizedPath, error: msg });
      }
    }
  }

  // ============================================
  // Remote Polling
  // ============================================

  startPolling(): void {
    if (this.pollIntervalId) return;

    const intervalMs = (this.config?.syncInterval ?? 60) * 1000;

    this.pollIntervalId = setInterval(async () => {
      await this.pollRemoteChanges();
    }, intervalMs);

    this.emit('pollingStarted');
  }

  stopPolling(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    this.emit('pollingStopped');
  }

  isPolling(): boolean {
    return this.pollIntervalId !== null;
  }

  private async pollRemoteChanges(): Promise<void> {
    if (!this.cursor) {
      try {
        this.cursor = await this.getLatestCursor();
      } catch {
        return;
      }
    }

    try {
      const changes = await this.getAllRemoteChanges(this.cursor);
      this.cursor = changes.cursor;

      for (const entry of changes.entries) {
        if (entry.tag === 'file') {
          try {
            await this.downloadFile(entry.pathLower);
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            this.emit('downloadError', { path: entry.pathLower, error: msg });
          }
        } else if (entry.tag === 'deleted') {
          const localPath = this.remoteToLocalPath(entry.pathLower);
          if (localPath) {
            try {
              await fs.unlink(localPath);
              this.emit('remoteFileDeleted', { remotePath: entry.pathLower, localPath });
            } catch {
              // File may already be deleted locally
            }
          }
        }
      }

      if (changes.entries.length > 0) {
        this.emit('remoteChangesApplied', { count: changes.entries.length });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.emit('pollError', { error: msg });
    }
  }

  // ============================================
  // Sync State
  // ============================================

  getCursor(): string | null {
    return this.cursor;
  }

  setCursor(cursor: string): void {
    this.cursor = cursor;
  }

  getLastSyncTime(): Date | null {
    return this.lastSyncTime;
  }

  setLastSyncTime(time: Date): void {
    this.lastSyncTime = time;
  }
}

// ============================================
// Singleton
// ============================================

let dropboxSyncEngine: DropboxSyncEngine | null = null;

export function getDropboxSyncEngine(): DropboxSyncEngine {
  if (!dropboxSyncEngine) {
    dropboxSyncEngine = new DropboxSyncEngine();
  }
  return dropboxSyncEngine;
}
