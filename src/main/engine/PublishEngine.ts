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

export interface DirectoryUploadResult {
  filesUploaded: number;
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

  // ── Public upload methods (one per directory, run as parallel tasks) ───

  /**
   * Upload html/ → remote root.
   * Requires html/ to exist (site must be rendered first).
   */
  async uploadHtml(
    credentials: PublishCredentials,
    onProgress: ProgressCallback,
  ): Promise<DirectoryUploadResult> {
    this.ensureProjectContext();
    this.validateCredentials(credentials);

    const htmlDir = path.join(this.dataDir!, 'html');
    await this.ensureDirectoryExists(htmlDir, 'Generated site not found. Please render the site first.');

    if (credentials.sshMode === 'rsync') {
      return this.rsyncDirectory(
        htmlDir + '/',
        this.rsyncDest(credentials, '/'),
        onProgress,
      );
    }
    return this.scpUploadDir(credentials, htmlDir, credentials.sshRemotePath, onProgress);
  }

  /**
   * Upload thumbnails/ → remote/thumbnails/.
   * Silently returns zero counts if thumbnails/ does not exist.
   */
  async uploadThumbnails(
    credentials: PublishCredentials,
    onProgress: ProgressCallback,
  ): Promise<DirectoryUploadResult> {
    this.ensureProjectContext();
    this.validateCredentials(credentials);

    const thumbnailsDir = path.join(this.dataDir!, 'thumbnails');
    if (!(await this.directoryExists(thumbnailsDir))) {
      onProgress(100, 'No thumbnails to upload');
      return { filesUploaded: 0, filesSkipped: 0 };
    }

    const remotePath = path.posix.join(credentials.sshRemotePath, 'thumbnails');
    if (credentials.sshMode === 'rsync') {
      return this.rsyncDirectory(
        thumbnailsDir + '/',
        this.rsyncDest(credentials, '/thumbnails/'),
        onProgress,
      );
    }
    return this.scpUploadDir(credentials, thumbnailsDir, remotePath, onProgress);
  }

  /**
   * Upload media/ → remote/media/, excluding .meta sidecar files.
   * Silently returns zero counts if media/ does not exist.
   */
  async uploadMedia(
    credentials: PublishCredentials,
    onProgress: ProgressCallback,
  ): Promise<DirectoryUploadResult> {
    this.ensureProjectContext();
    this.validateCredentials(credentials);

    const mediaDir = path.join(this.dataDir!, 'media');
    if (!(await this.directoryExists(mediaDir))) {
      onProgress(100, 'No media to upload');
      return { filesUploaded: 0, filesSkipped: 0 };
    }

    const remotePath = path.posix.join(credentials.sshRemotePath, 'media');
    if (credentials.sshMode === 'rsync') {
      return this.rsyncDirectory(
        mediaDir + '/',
        this.rsyncDest(credentials, '/media/'),
        onProgress,
        ['*.meta'],
      );
    }
    return this.scpUploadDir(
      credentials, mediaDir, remotePath, onProgress,
      (name) => !name.endsWith(META_EXTENSION),
    );
  }

  // ── SCP mode ──────────────────────────────────────────────────────────

  private async scpUploadDir(
    credentials: PublishCredentials,
    localDir: string,
    remoteDir: string,
    onProgress: ProgressCallback,
    fileFilter?: (name: string) => boolean,
  ): Promise<DirectoryUploadResult> {
    const client = await scpClient({
      host: credentials.sshHost,
      username: credentials.sshUser,
      agent: process.env.SSH_AUTH_SOCK,
    });

    try {
      const files = await this.collectFiles(localDir, '', fileFilter);
      let uploaded = 0;
      let skipped = 0;

      if (files.length === 0) {
        onProgress(100, 'No files to upload');
        return { filesUploaded: 0, filesSkipped: 0 };
      }

      await this.scpEnsureDir(client, remoteDir);
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
          const progress = Math.round(((i + 1) / files.length) * 100);
          onProgress(progress, `Uploaded ${relativePath} (${uploaded}/${files.length})`);
        } else {
          skipped++;
          const progress = Math.round(((i + 1) / files.length) * 100);
          onProgress(progress, `Skipped ${relativePath} (${i + 1}/${files.length})`);
        }
      }

      onProgress(100, `Done: ${uploaded} uploaded, ${skipped} unchanged`);
      return { filesUploaded: uploaded, filesSkipped: skipped };
    } finally {
      client.close();
    }
  }

  private async scpNeedsUpload(
    client: ScpClient,
    remotePath: string,
    localMtimeMs: number,
  ): Promise<boolean> {
    try {
      const remoteStat = await client.stat(remotePath);
      const remoteMtimeMs = remoteStat.mtime * 1000;
      return localMtimeMs > remoteMtimeMs;
    } catch {
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

  // ── rsync mode ────────────────────────────────────────────────────────

  private rsyncDest(credentials: PublishCredentials, suffix: string): string {
    return `${credentials.sshUser}@${credentials.sshHost}:${credentials.sshRemotePath}${suffix}`;
  }

  private rsyncDirectory(
    src: string,
    dest: string,
    onProgress: ProgressCallback,
    exclude?: string[],
  ): Promise<DirectoryUploadResult> {
    return new Promise((resolve, reject) => {
      onProgress(0, `Starting rsync → ${dest}`);
      let filesTransferred = 0;

      rsync(
        {
          src,
          dest,
          ssh: true,
          recursive: true,
          times: true,
          args: ['--update', '--compress', '--verbose'],
          exclude: exclude || [],
          onStdout: (data: string | Buffer) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              if (trimmed.startsWith('sending ')) continue;
              if (/\bbytes\b/.test(trimmed)) continue;
              if (/total size is/.test(trimmed)) continue;
              if (/speedup is/.test(trimmed)) continue;
              filesTransferred++;
              onProgress(
                Math.min(filesTransferred, 99),
                `${trimmed} → ${dest}`,
              );
            }
          },
        },
        (error, _stdout, _stderr, _cmd) => {
          if (error) {
            reject(error);
          } else {
            onProgress(100, `rsync complete: ${filesTransferred} files transferred`);
            resolve({ filesUploaded: filesTransferred, filesSkipped: 0 });
          }
        },
      );
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

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

  private ensureProjectContext(): void {
    if (!this.dataDir || !this.projectId) {
      throw new Error('No project context set');
    }
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

