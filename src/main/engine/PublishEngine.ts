import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { Client as scpClient, type ScpClient } from 'node-scp';
import rsync from 'rsyncwrapper';

export interface PublishCredentials {
  sshHost: string;
  sshUser: string;
  sshRemotePath: string;
  sshMode: 'scp' | 'rsync';
}

export interface PublishResult {
  htmlFilesUploaded: number;
  thumbnailFilesUploaded: number;
  mediaFilesUploaded: number;
  filesSkipped: number;
}

type ProgressCallback = (progress: number, message: string) => void;

/** Files with these extensions are excluded from media uploads (metadata sidecars). */
const META_EXTENSION = '.meta';

export class PublishEngine extends EventEmitter {
  private projectId: string | null = null;
  private dataDir: string | null = null;

  constructor() {
    super();
  }

  setProjectContext(projectId: string, dataDir: string): void {
    this.projectId = projectId;
    this.dataDir = dataDir;
  }

  async uploadSite(
    credentials: PublishCredentials,
    onProgress: ProgressCallback,
  ): Promise<PublishResult> {
    if (!this.dataDir || !this.projectId) {
      throw new Error('No project context set');
    }
    this.validateCredentials(credentials);

    const htmlDir = path.join(this.dataDir, 'html');
    const thumbnailsDir = path.join(this.dataDir, 'thumbnails');
    const mediaDir = path.join(this.dataDir, 'media');

    // Verify the generated site exists
    await this.ensureDirectoryExists(htmlDir, 'Generated site not found. Please render the site first.');

    const result: PublishResult = {
      htmlFilesUploaded: 0,
      thumbnailFilesUploaded: 0,
      mediaFilesUploaded: 0,
      filesSkipped: 0,
    };

    if (credentials.sshMode === 'rsync') {
      await this.uploadViaRsync(credentials, htmlDir, thumbnailsDir, mediaDir, result, onProgress);
    } else {
      await this.uploadViaScp(credentials, htmlDir, thumbnailsDir, mediaDir, result, onProgress);
    }

    onProgress(100, 'Upload complete');
    return result;
  }

  // ── SCP mode ──────────────────────────────────────────────────────────────

  private async uploadViaScp(
    credentials: PublishCredentials,
    htmlDir: string,
    thumbnailsDir: string,
    mediaDir: string,
    result: PublishResult,
    onProgress: ProgressCallback,
  ): Promise<void> {
    const client = await scpClient({
      host: credentials.sshHost,
      username: credentials.sshUser,
      agent: process.env.SSH_AUTH_SOCK,
    });

    try {
      // Phase 1: html/ → remote root (0–33%)
      onProgress(0, 'Uploading HTML files...');
      const htmlResult = await this.scpUploadDirectory(
        client,
        htmlDir,
        credentials.sshRemotePath,
        (p, msg) => onProgress(Math.round(p * 0.33), msg),
      );
      result.htmlFilesUploaded = htmlResult.uploaded;
      result.filesSkipped += htmlResult.skipped;

      // Phase 2: thumbnails/ → remote/thumbnails/ (33–66%)
      onProgress(33, 'Uploading thumbnails...');
      if (await this.directoryExists(thumbnailsDir)) {
        const thumbResult = await this.scpUploadDirectory(
          client,
          thumbnailsDir,
          path.posix.join(credentials.sshRemotePath, 'thumbnails'),
          (p, msg) => onProgress(33 + Math.round(p * 0.33), msg),
        );
        result.thumbnailFilesUploaded = thumbResult.uploaded;
        result.filesSkipped += thumbResult.skipped;
      }

      // Phase 3: media/ → remote/media/ (66–99%), excluding .meta files
      onProgress(66, 'Uploading media files...');
      if (await this.directoryExists(mediaDir)) {
        const mediaResult = await this.scpUploadDirectory(
          client,
          mediaDir,
          path.posix.join(credentials.sshRemotePath, 'media'),
          (p, msg) => onProgress(66 + Math.round(p * 0.33), msg),
          (name) => !name.endsWith(META_EXTENSION),
        );
        result.mediaFilesUploaded = mediaResult.uploaded;
        result.filesSkipped += mediaResult.skipped;
      }
    } finally {
      client.close();
    }
  }

  /**
   * Recursively upload a local directory to a remote path via SCP/SFTP.
   * Only uploads files that are newer than the remote version.
   */
  private async scpUploadDirectory(
    client: ScpClient,
    localDir: string,
    remoteDir: string,
    onProgress: ProgressCallback,
    fileFilter?: (name: string) => boolean,
  ): Promise<{ uploaded: number; skipped: number }> {
    // Collect all files first for progress tracking
    const files = await this.collectFiles(localDir, '', fileFilter);
    let uploaded = 0;
    let skipped = 0;

    if (files.length === 0) {
      onProgress(100, 'No files to upload');
      return { uploaded: 0, skipped: 0 };
    }

    // Ensure remote directory exists
    await this.scpEnsureDir(client, remoteDir);

    // Track created directories to avoid redundant mkdir calls
    const createdDirs = new Set<string>();

    for (let i = 0; i < files.length; i++) {
      const relativePath = files[i];
      const localPath = path.join(localDir, relativePath);
      const remotePath = path.posix.join(remoteDir, relativePath.split(path.sep).join('/'));

      // Ensure parent directory exists on remote
      const remoteParent = path.posix.dirname(remotePath);
      if (!createdDirs.has(remoteParent)) {
        await this.scpEnsureDir(client, remoteParent);
        createdDirs.add(remoteParent);
      }

      // Check if we need to upload (compare mtime)
      const localStat = await fs.stat(localPath);
      const needsUpload = await this.scpNeedsUpload(client, remotePath, localStat.mtimeMs);

      if (needsUpload) {
        await client.uploadFile(localPath, remotePath);
        uploaded++;
      } else {
        skipped++;
      }

      const progress = ((i + 1) / files.length) * 100;
      onProgress(progress, `${uploaded} uploaded, ${skipped} skipped (${i + 1}/${files.length})`);
    }

    return { uploaded, skipped };
  }

  /**
   * Check if a local file is newer than the remote file.
   * Returns true if upload is needed.
   */
  private async scpNeedsUpload(
    client: ScpClient,
    remotePath: string,
    localMtimeMs: number,
  ): Promise<boolean> {
    try {
      const remoteStat = await client.stat(remotePath);
      // SSH2 Stats.mtime is in seconds, localMtimeMs is in milliseconds
      const remoteMtimeMs = remoteStat.mtime * 1000;
      return localMtimeMs > remoteMtimeMs;
    } catch {
      // File doesn't exist on remote → needs upload
      return true;
    }
  }

  private async scpEnsureDir(client: ScpClient, remoteDir: string): Promise<void> {
    try {
      await client.mkdir(remoteDir, undefined, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }

  // ── rsync mode ────────────────────────────────────────────────────────────

  private async uploadViaRsync(
    credentials: PublishCredentials,
    htmlDir: string,
    thumbnailsDir: string,
    mediaDir: string,
    result: PublishResult,
    onProgress: ProgressCallback,
  ): Promise<void> {
    const remoteDest = `${credentials.sshUser}@${credentials.sshHost}:${credentials.sshRemotePath}`;

    // Phase 1: html/ → remote root (0–33%)
    onProgress(0, 'Syncing HTML files via rsync...');
    const htmlCount = await this.rsyncDirectory(
      htmlDir + '/',
      remoteDest + '/',
    );
    result.htmlFilesUploaded = htmlCount;
    onProgress(33, 'HTML sync complete');

    // Phase 2: thumbnails/ → remote/thumbnails/ (33–66%)
    if (await this.directoryExists(thumbnailsDir)) {
      onProgress(33, 'Syncing thumbnails via rsync...');
      const thumbCount = await this.rsyncDirectory(
        thumbnailsDir + '/',
        remoteDest + '/thumbnails/',
      );
      result.thumbnailFilesUploaded = thumbCount;
    }
    onProgress(66, 'Thumbnails sync complete');

    // Phase 3: media/ → remote/media/ (66–99%), excluding .meta files
    if (await this.directoryExists(mediaDir)) {
      onProgress(66, 'Syncing media files via rsync...');
      const mediaCount = await this.rsyncDirectory(
        mediaDir + '/',
        remoteDest + '/media/',
        ['*.meta'],
      );
      result.mediaFilesUploaded = mediaCount;
    }
    onProgress(99, 'Media sync complete');
  }

  /**
   * Run rsync for a directory with incremental (--update --times) and recursive transfer.
   * Returns estimated file count from stdout.
   */
  private rsyncDirectory(
    src: string,
    dest: string,
    exclude?: string[],
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      rsync(
        {
          src,
          dest,
          ssh: true,
          recursive: true,
          times: true,
          args: ['--update', '--compress'],
          exclude: exclude || [],
        },
        (error, stdout, _stderr, _cmd) => {
          if (error) {
            reject(error);
          } else {
            // Count uploaded files from rsync stdout (each transferred file gets a line)
            const lines = stdout.trim().split('\n').filter((l: string) => l.length > 0);
            resolve(lines.length);
          }
        },
      );
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Recursively collect all file paths relative to baseDir, with optional filter.
   */
  private async collectFiles(
    baseDir: string,
    prefix: string,
    filter?: (name: string) => boolean,
  ): Promise<string[]> {
    const files: string[] = [];
    let entries;
    try {
      entries = await fs.readdir(baseDir, { withFileTypes: true });
    } catch {
      return files;
    }

    for (const entry of entries) {
      const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        const subFiles = await this.collectFiles(
          path.join(baseDir, entry.name),
          relativePath,
          filter,
        );
        files.push(...subFiles);
      } else if (entry.isFile()) {
        if (!filter || filter(entry.name)) {
          files.push(relativePath);
        }
      }
    }

    return files;
  }

  private validateCredentials(credentials: PublishCredentials): void {
    if (!credentials.sshHost?.trim()) {
      throw new Error('SSH host is required');
    }
    if (!credentials.sshUser?.trim()) {
      throw new Error('SSH user is required');
    }
    if (!credentials.sshRemotePath?.trim()) {
      throw new Error('Remote path is required');
    }
  }

  private async ensureDirectoryExists(dirPath: string, errorMessage: string): Promise<void> {
    try {
      await fs.access(dirPath, fsConstants.F_OK);
    } catch {
      throw new Error(errorMessage);
    }
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      await fs.access(dirPath, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton
let publishEngine: PublishEngine | null = null;

export function getPublishEngine(): PublishEngine {
  if (!publishEngine) {
    publishEngine = new PublishEngine();
  }
  return publishEngine;
}
