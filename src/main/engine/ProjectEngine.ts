import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import { eq } from 'drizzle-orm';
import { app } from 'electron';
import { getDatabase } from '../database';
import { projects, posts, media, Project, NewProject } from '../database/schema';

export interface ProjectData {
  id: string;
  name: string;
  slug: string;
  description?: string;
  dataPath?: string; // Custom path for project data (undefined = default)
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}

export class ProjectEngine extends EventEmitter {
  constructor() {
    super();
  }

  private assertDeletableProject(id: string): void {
    if (id === 'default') {
      throw new Error('Cannot delete the default project');
    }
  }

  private mapDbProjectToProjectData(dbProject: Project): ProjectData {
    return {
      id: dbProject.id,
      name: dbProject.name,
      slug: dbProject.slug,
      description: dbProject.description || undefined,
      dataPath: dbProject.dataPath || undefined,
      createdAt: dbProject.createdAt,
      updatedAt: dbProject.updatedAt,
      isActive: dbProject.isActive ?? false,
    };
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Get the internal base directory for a project (always in userData).
   * This is where meta, thumbnails, tags, and project.json live.
   */
  getInternalBaseDir(projectId: string): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'projects', projectId);
  }

  /**
   * Get the data directory for posts and media.
   * If a custom dataPath is set, posts/media live there; otherwise in the internal dir.
   */
  getDataDir(projectId: string, dataPath?: string | null): string {
    if (dataPath) {
      return dataPath;
    }
    return this.getInternalBaseDir(projectId);
  }

  /**
   * Alias kept for backward compatibility — returns the internal base dir.
   */
  getDefaultProjectBaseDir(projectId: string): string {
    return this.getInternalBaseDir(projectId);
  }

  private async ensureProjectDirectories(projectId: string, dataPath?: string | null): Promise<void> {
    // Determine base directory for all project data:
    // - If custom dataPath is provided, all project data lives there (allows cloud storage backup)
    // - If no dataPath (default project), use internal userData storage
    const dataDir = this.getDataDir(projectId, dataPath);

    // Create all project directories in the data directory
    await fs.mkdir(path.join(dataDir, 'posts'), { recursive: true });
    await fs.mkdir(path.join(dataDir, 'media'), { recursive: true });
    await fs.mkdir(path.join(dataDir, 'meta'), { recursive: true });
    await fs.mkdir(path.join(dataDir, 'thumbnails'), { recursive: true });
    await fs.mkdir(path.join(dataDir, 'templates'), { recursive: true });
  }

  private async copyStarterTemplates(projectId: string, dataPath?: string | null): Promise<void> {
    const dataDir = this.getDataDir(projectId, dataPath);
    const destDir = path.join(dataDir, 'templates');

    // Resolve the bundled templates directory
    const bundledRoots = [
      path.resolve(__dirname, 'templates'),
      path.resolve(process.cwd(), 'dist', 'main', 'engine', 'templates'),
      path.resolve(process.cwd(), 'src', 'main', 'engine', 'templates'),
    ];

    if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
      bundledRoots.unshift(path.resolve(process.resourcesPath, 'templates'));
    }

    let sourceDir: string | null = null;
    for (const root of bundledRoots) {
      try {
        const stat = await fs.stat(root);
        if (stat.isDirectory()) {
          sourceDir = root;
          break;
        }
      } catch {
        // Directory doesn't exist, try next
      }
    }

    if (!sourceDir) {
      return;
    }

    try {
      await this.copyDirectoryRecursive(sourceDir, destDir);
    } catch (error) {
      console.error('[ProjectEngine] Failed to copy starter templates:', error);
    }
  }

  private async copyDirectoryRecursive(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectoryRecursive(srcPath, destPath);
      } else if (entry.name.endsWith('.liquid')) {
        try {
          await fs.access(destPath);
          // File already exists, skip
        } catch {
          await fs.copyFile(srcPath, destPath);
        }
      }
    }
  }

  async createProject(data: { name: string; description?: string; slug?: string; dataPath?: string }): Promise<ProjectData> {
    const db = getDatabase().getLocal();
    const now = new Date();
    const id = uuidv4();
    const slug = data.slug || this.generateSlug(data.name);

    // Ensure unique slug
    let finalSlug = slug;
    let counter = 1;
    const existing = await db.select().from(projects).all();
    const existingSlugs = new Set(existing.map(p => p.slug));
    while (existingSlugs.has(finalSlug)) {
      finalSlug = `${slug}-${counter}`;
      counter++;
    }

    const project: ProjectData = {
      id,
      name: data.name,
      slug: finalSlug,
      description: data.description,
      dataPath: data.dataPath,
      createdAt: now,
      updatedAt: now,
      isActive: false,
    };

    // Create directories using project ID (not slug)
    await this.ensureProjectDirectories(id, data.dataPath);

    // Copy bundled templates as starter templates
    await this.copyStarterTemplates(id, data.dataPath);

    // Insert into database
    const dbProject: NewProject = {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      dataPath: project.dataPath,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      isActive: project.isActive,
    };

    await db.insert(projects).values(dbProject);

    this.emit('projectCreated', project);
    return project;
  }

  async updateProject(id: string, data: Partial<Omit<ProjectData, 'id' | 'createdAt'>>): Promise<ProjectData | null> {
    const db = getDatabase().getLocal();
    const existing = await db.select().from(projects).where(eq(projects.id, id)).get();

    if (!existing) {
      return null;
    }

    const now = new Date();
    const updated = {
      ...existing,
      ...data,
      updatedAt: now,
    };

    await db.update(projects)
      .set({
        name: updated.name,
        slug: updated.slug,
        description: updated.description,
        dataPath: updated.dataPath,
        updatedAt: updated.updatedAt,
        isActive: updated.isActive,
      })
      .where(eq(projects.id, id));

    const result: ProjectData = {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      description: updated.description || undefined,
      dataPath: updated.dataPath || undefined,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      isActive: updated.isActive ?? false,
    };

    this.emit('projectUpdated', result);
    return result;
  }

  async deleteProject(id: string): Promise<boolean> {
    this.assertDeletableProject(id);

    const db = getDatabase().getLocal();
    const existing = await db.select().from(projects).where(eq(projects.id, id)).get();

    if (!existing) {
      return false;
    }

    // TODO: Optionally delete project files (posts, media)
    // For safety, we'll leave them in place

    await db.delete(projects).where(eq(projects.id, id));

    this.emit('projectDeleted', id);
    return true;
  }

  async deleteProjectWithData(id: string): Promise<boolean> {
    this.assertDeletableProject(id);

    const db = getDatabase().getLocal();
    const existing = await db.select().from(projects).where(eq(projects.id, id)).get();

    if (!existing) {
      return false;
    }

    // Delete associated posts from database
    await db.delete(posts).where(eq(posts.projectId, id));

    // Delete associated media from database
    await db.delete(media).where(eq(media.projectId, id));

    // Delete the internal project directory (meta, thumbnails, and posts/media if stored internally).
    // If a custom dataPath is set, external posts/media are NOT deleted — the user manages that storage.
    const internalDir = this.getInternalBaseDir(id);
    try {
      await fs.rm(internalDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Could not delete internal project directory for ${id}:`, error);
    }

    // Delete project from database
    await db.delete(projects).where(eq(projects.id, id));

    this.emit('projectDeleted', id);
    return true;
  }

  async getProject(id: string): Promise<ProjectData | null> {
    const db = getDatabase().getLocal();
    const dbProject = await db.select().from(projects).where(eq(projects.id, id)).get();

    if (!dbProject) {
      return null;
    }

    return this.mapDbProjectToProjectData(dbProject);
  }

  async getAllProjects(): Promise<ProjectData[]> {
    const db = getDatabase().getLocal();
    const dbProjects = await db.select().from(projects).all();

    return dbProjects.map(p => this.mapDbProjectToProjectData(p));
  }

  async getActiveProject(): Promise<ProjectData | null> {
    const db = getDatabase().getLocal();
    const dbProject = await db.select().from(projects).where(eq(projects.isActive, true)).get();

    if (!dbProject) {
      // Return default if no active project
      return this.getProject('default');
    }

    return this.mapDbProjectToProjectData(dbProject);
  }

  async setActiveProject(id: string): Promise<ProjectData | null> {
    const db = getDatabase().getLocal();

    // Deactivate all projects
    await db.update(projects).set({ isActive: false });

    // Activate the selected project
    await db.update(projects)
      .set({ isActive: true })
      .where(eq(projects.id, id));

    const project = await this.getProject(id);
    if (project) {
      this.emit('activeProjectChanged', project);
    }
    return project;
  }

  getProjectPaths(projectId: string, dataPath?: string | null): { posts: string; media: string } {
    const dataDir = this.getDataDir(projectId, dataPath);
    return {
      posts: path.join(dataDir, 'posts'),
      media: path.join(dataDir, 'media'),
    };
  }

  /**
   * Get project paths by looking up the project's dataPath from the database.
   */
  async getProjectPathsResolved(projectId: string): Promise<{ posts: string; media: string }> {
    const project = await this.getProject(projectId);
    return this.getProjectPaths(projectId, project?.dataPath);
  }
}

