import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import { eq } from 'drizzle-orm';
import { app } from 'electron';
import { getDatabase } from '../database';
import { projects, Project, NewProject } from '../database/schema';

export interface ProjectData {
  id: string;
  name: string;
  slug: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}

export class ProjectEngine extends EventEmitter {
  constructor() {
    super();
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private async ensureProjectDirectories(projectId: string): Promise<void> {
    const userDataPath = app.getPath('userData');
    const projectDir = path.join(userDataPath, 'projects', projectId);
    const postsDir = path.join(projectDir, 'posts');
    const mediaDir = path.join(projectDir, 'media');

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(postsDir, { recursive: true });
    await fs.mkdir(mediaDir, { recursive: true });
  }

  async createProject(data: { name: string; description?: string; slug?: string }): Promise<ProjectData> {
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
      createdAt: now,
      updatedAt: now,
      isActive: false,
    };

    // Create directories using project ID (not slug)
    await this.ensureProjectDirectories(id);

    // Insert into database
    const dbProject: NewProject = {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
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
        updatedAt: updated.updatedAt,
        isActive: updated.isActive,
      })
      .where(eq(projects.id, id));

    const result: ProjectData = {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      description: updated.description || undefined,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      isActive: updated.isActive ?? false,
    };

    this.emit('projectUpdated', result);
    return result;
  }

  async deleteProject(id: string): Promise<boolean> {
    // Prevent deleting the default project
    if (id === 'default') {
      throw new Error('Cannot delete the default project');
    }

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

  async getProject(id: string): Promise<ProjectData | null> {
    const db = getDatabase().getLocal();
    const dbProject = await db.select().from(projects).where(eq(projects.id, id)).get();

    if (!dbProject) {
      return null;
    }

    return {
      id: dbProject.id,
      name: dbProject.name,
      slug: dbProject.slug,
      description: dbProject.description || undefined,
      createdAt: dbProject.createdAt,
      updatedAt: dbProject.updatedAt,
      isActive: dbProject.isActive ?? false,
    };
  }

  async getAllProjects(): Promise<ProjectData[]> {
    const db = getDatabase().getLocal();
    const dbProjects = await db.select().from(projects).all();

    return dbProjects.map(p => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description || undefined,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      isActive: p.isActive ?? false,
    }));
  }

  async getActiveProject(): Promise<ProjectData | null> {
    const db = getDatabase().getLocal();
    const dbProject = await db.select().from(projects).where(eq(projects.isActive, true)).get();

    if (!dbProject) {
      // Return default if no active project
      return this.getProject('default');
    }

    return {
      id: dbProject.id,
      name: dbProject.name,
      slug: dbProject.slug,
      description: dbProject.description || undefined,
      createdAt: dbProject.createdAt,
      updatedAt: dbProject.updatedAt,
      isActive: dbProject.isActive ?? false,
    };
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

  getProjectPaths(projectId: string): { posts: string; media: string } {
    const userDataPath = app.getPath('userData');
    return {
      posts: path.join(userDataPath, 'projects', projectId, 'posts'),
      media: path.join(userDataPath, 'projects', projectId, 'media'),
    };
  }
}

// Singleton instance
let projectEngine: ProjectEngine | null = null;

export function getProjectEngine(): ProjectEngine {
  if (!projectEngine) {
    projectEngine = new ProjectEngine();
  }
  return projectEngine;
}
