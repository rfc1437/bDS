import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { readFile } from 'node:fs/promises';
import { marked } from 'marked';
import { getMetaEngine, type ProjectMetadata } from './MetaEngine';
import { getPostEngine, type PostData, type PostFilter } from './PostEngine';
import { getProjectEngine } from './ProjectEngine';

interface ActiveProjectContext {
  projectId: string;
  dataDir?: string;
}

interface PostEngineContract {
  getPostsFiltered: (filter: PostFilter) => Promise<PostData[]>;
  getPost: (id: string) => Promise<PostData | null>;
  setProjectContext: (projectId: string, dataDir?: string) => void;
}

interface MetaEngineContract {
  getProjectMetadata: () => Promise<ProjectMetadata | null>;
  setProjectContext: (projectId: string, dataDir?: string) => void;
}

interface PreviewServerDependencies {
  postEngine: PostEngineContract;
  settingsEngine: MetaEngineContract;
  getActiveProjectContext: () => Promise<ActiveProjectContext>;
}

const DEFAULT_MAX_POSTS_PER_PAGE = 50;
const MIN_MAX_POSTS_PER_PAGE = 1;
const MAX_MAX_POSTS_PER_PAGE = 500;

const PREVIEW_ASSETS = {
  'pico.min.css': {
    modulePath: '@picocss/pico/css/pico.min.css',
    contentType: 'text/css; charset=utf-8',
  },
  'lightbox.min.css': {
    modulePath: 'lightbox2/dist/css/lightbox.min.css',
    contentType: 'text/css; charset=utf-8',
  },
  'lightbox.min.js': {
    modulePath: 'lightbox2/dist/js/lightbox-plus-jquery.min.js',
    contentType: 'application/javascript; charset=utf-8',
  },
} as const;

function clampMaxPostsPerPage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_POSTS_PER_PAGE;
  }

  const normalized = Math.floor(value);
  if (normalized < MIN_MAX_POSTS_PER_PAGE) return DEFAULT_MAX_POSTS_PER_PAGE;
  if (normalized > MAX_MAX_POSTS_PER_PAGE) return MAX_MAX_POSTS_PER_PAGE;
  return normalized;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseMacroParams(paramString: string | undefined): Record<string, string> {
  if (!paramString) return {};

  const params: Record<string, string> = {};
  const regex = /(\w+)=(?:["']([^"']*?)["']|([^\s\]]+))/g;
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(paramString)) !== null) {
    params[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }

  return params;
}

function renderMacro(name: string, params: Record<string, string>, postId: string): string {
  if (name === 'youtube') {
    const id = escapeHtml(params.id || '');
    const title = escapeHtml(params.title || 'YouTube video');
    if (!id) return '';
    return `<div class="macro-youtube"><iframe src="https://www.youtube.com/embed/${id}?rel=0" title="${title}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  }

  if (name === 'vimeo') {
    const id = escapeHtml(params.id || '');
    const title = escapeHtml(params.title || 'Vimeo video');
    if (!id) return '';
    return `<div class="macro-vimeo"><iframe src="https://player.vimeo.com/video/${id}" title="${title}" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }

  if (name === 'gallery') {
    const columns = escapeHtml(params.columns || '3');
    const caption = params.caption ? `<figcaption>${escapeHtml(params.caption)}</figcaption>` : '';
    return `<div class="macro-gallery" data-post-id="${escapeHtml(postId)}" data-columns="${columns}"><div>Gallery preview is not interactive yet.</div>${caption}</div>`;
  }

  if (name === 'photo_archive') {
    const year = params.year ? ` data-year="${escapeHtml(params.year)}"` : '';
    const month = params.month ? ` data-month="${escapeHtml(params.month)}"` : '';
    return `<div class="macro-photo-archive"${year}${month}><div>Photo archive preview is not interactive yet.</div></div>`;
  }

  return '';
}

async function renderPostHtml(post: PostData): Promise<string> {
  const withMacros = post.content.replace(/\[\[(\w+)(?:\s+([^\]]+))?\]\]/g, (_match, macroName: string, rawParams: string | undefined) => {
    const params = parseMacroParams(rawParams);
    return renderMacro(macroName.toLowerCase(), params, post.id);
  });

  const markdownHtml = await marked.parse(withMacros, { async: true, gfm: true, breaks: false });
  return `<div class="post">${markdownHtml}</div>`;
}

function getPageHtml(content: string, title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/assets/pico.min.css" />
    <link rel="stylesheet" href="/assets/lightbox.min.css" />
    <style>
      :root { color-scheme: light dark; }
      body { max-width: 960px; margin: 0 auto; padding: 2rem 1rem 4rem; }
      main { display: grid; gap: 1rem; }
      .post { border: 1px solid var(--muted-border-color); padding: 1rem; background: var(--card-background-color); }
      .post iframe { width: 100%; min-height: 20rem; }
      .macro-gallery, .macro-photo-archive { border: 1px dashed var(--muted-border-color); padding: .75rem; }
    </style>
    <script defer src="/assets/lightbox.min.js"></script>
  </head>
  <body>
    <main>
      ${content}
    </main>
  </body>
</html>`;
}

export class PreviewServer {
  private readonly postEngine: PostEngineContract;
  private readonly settingsEngine: MetaEngineContract;
  private readonly getActiveProjectContext: () => Promise<ActiveProjectContext>;
  private server: Server | null = null;
  private port: number | null = null;

  constructor(dependencies?: Partial<PreviewServerDependencies>) {
    this.postEngine = dependencies?.postEngine ?? getPostEngine();
    this.settingsEngine = dependencies?.settingsEngine ?? getMetaEngine();
    this.getActiveProjectContext = dependencies?.getActiveProjectContext ?? (async () => {
      const projectEngine = getProjectEngine();
      const activeProject = await projectEngine.getActiveProject();
      const projectId = activeProject?.id ?? 'default';
      const dataDir = projectEngine.getDataDir(projectId, activeProject?.dataPath);
      return { projectId, dataDir };
    });
  }

  async start(preferredPort = 0): Promise<number> {
    if (this.server && this.port !== null) {
      return this.port;
    }

    this.server = createServer(async (req, res) => {
      await this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Preview server was not created'));
        return;
      }

      this.server.once('error', reject);
      this.server.listen(preferredPort, '127.0.0.1', () => {
        this.server?.off('error', reject);
        resolve();
      });
    });

    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to get preview server address');
    }

    this.port = address.port;
    return this.port;
  }

  async stop(): Promise<void> {
    if (!this.server) {
      this.port = null;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.server = null;
    this.port = null;
  }

  getBaseUrl(): string {
    if (this.port === null) {
      throw new Error('Preview server not started');
    }
    return `http://127.0.0.1:${this.port}`;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const remoteAddress = req.socket.remoteAddress;
    const isLocal = remoteAddress === '127.0.0.1'
      || remoteAddress === '::1'
      || remoteAddress === '::ffff:127.0.0.1';

    if (!isLocal) {
      this.respond(res, 403, 'Forbidden');
      return;
    }

    if ((req.method || 'GET').toUpperCase() !== 'GET') {
      this.respond(res, 405, 'Method Not Allowed');
      return;
    }

    try {
      const context = await this.getActiveProjectContext();
      this.postEngine.setProjectContext(context.projectId, context.dataDir);
      this.settingsEngine.setProjectContext(context.projectId, context.dataDir);

      const metadata = await this.settingsEngine.getProjectMetadata();
      const maxPostsPerPage = clampMaxPostsPerPage(metadata?.maxPostsPerPage);

      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(requestUrl.pathname.replace(/\/+$/, '') || '/');

      const asset = await this.resolveAsset(pathname);
      if (asset) {
        this.respondAsset(res, asset.contentType, asset.body);
        return;
      }

      const result = await this.resolveRoute(pathname, maxPostsPerPage);
      if (!result) {
        this.respond(res, 404, 'Not Found');
        return;
      }

      this.respond(res, 200, getPageHtml(result, 'Blog Preview'));
    } catch (error) {
      console.error('[PreviewServer] Request failed:', error);
      this.respond(res, 500, 'Internal Server Error');
    }
  }

  private async resolveRoute(pathname: string, maxPostsPerPage: number): Promise<string | null> {
    if (pathname === '/') {
      const posts = await this.loadPublishedPosts({ status: 'published' }, maxPostsPerPage);
      return this.renderPostList(posts);
    }

    const tagMatch = pathname.match(/^\/tag\/([^/]+)$/);
    if (tagMatch) {
      const tag = tagMatch[1];
      const posts = await this.loadPublishedPosts({ status: 'published', tags: [tag] }, maxPostsPerPage);
      return this.renderPostList(posts);
    }

    const categoryMatch = pathname.match(/^\/category\/([^/]+)$/);
    if (categoryMatch) {
      const category = categoryMatch[1];
      const posts = await this.loadPublishedPosts({ status: 'published', categories: [category] }, maxPostsPerPage);
      return this.renderPostList(posts);
    }

    const daySlugMatch = pathname.match(/^\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/([^/]+)$/);
    if (daySlugMatch) {
      const year = Number(daySlugMatch[1]);
      const month = Number(daySlugMatch[2]);
      const day = Number(daySlugMatch[3]);
      const slug = daySlugMatch[4];
      const posts = await this.loadPostsForDay(year, month, day, maxPostsPerPage);
      const post = posts.find((candidate) => candidate.slug === slug) || null;
      if (!post) return null;
      return this.renderPostList([post]);
    }

    const dayMatch = pathname.match(/^\/(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (dayMatch) {
      const year = Number(dayMatch[1]);
      const month = Number(dayMatch[2]);
      const day = Number(dayMatch[3]);
      const posts = await this.loadPostsForDay(year, month, day, maxPostsPerPage);
      return this.renderPostList(posts);
    }

    const monthMatch = pathname.match(/^\/(\d{4})\/(\d{1,2})$/);
    if (monthMatch) {
      const year = Number(monthMatch[1]);
      const month = Number(monthMatch[2]);
      if (month < 1 || month > 12) return null;
      const posts = await this.loadPublishedPosts({ status: 'published', year, month: month - 1 }, maxPostsPerPage);
      return this.renderPostList(posts);
    }

    const yearMatch = pathname.match(/^\/(\d{4})$/);
    if (yearMatch) {
      const year = Number(yearMatch[1]);
      const posts = await this.loadPublishedPosts({ status: 'published', year }, maxPostsPerPage);
      return this.renderPostList(posts);
    }

    const pageSlugMatch = pathname.match(/^\/([^/]+)$/);
    if (pageSlugMatch) {
      const slug = pageSlugMatch[1];
      const pages = await this.loadPublishedPosts({ status: 'published', categories: ['page'] }, maxPostsPerPage);
      const page = pages.find((candidate) => candidate.slug === slug) || null;
      if (!page) return null;
      return this.renderPostList([page]);
    }

    return null;
  }

  private async loadPostsForDay(year: number, month: number, day: number, maxPostsPerPage: number): Promise<PostData[]> {
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return [];
    }

    const startDate = new Date(year, month - 1, day, 0, 0, 0, 0);
    const endDate = new Date(year, month - 1, day, 23, 59, 59, 999);

    const posts = await this.loadPublishedPosts({
      status: 'published',
      startDate,
      endDate,
    }, maxPostsPerPage);

    return posts.filter((post) => {
      const createdAt = post.createdAt;
      return createdAt.getFullYear() === year
        && createdAt.getMonth() === month - 1
        && createdAt.getDate() === day;
    });
  }

  private async loadPublishedPosts(filter: PostFilter, maxPostsPerPage: number): Promise<PostData[]> {
    const posts = await this.postEngine.getPostsFiltered(filter);
    const limited = posts.slice(0, maxPostsPerPage);

    const withContent = await Promise.all(
      limited.map(async (post) => {
        const fullPost = await this.postEngine.getPost(post.id);
        return fullPost ?? post;
      })
    );

    return withContent;
  }

  private async renderPostList(posts: PostData[]): Promise<string> {
    const rendered = await Promise.all(posts.map((post) => renderPostHtml(post)));
    return rendered.join('\n');
  }

  private async resolveAsset(pathname: string): Promise<{ contentType: string; body: Buffer } | null> {
    const match = pathname.match(/^\/assets\/([^/]+)$/);
    if (!match) return null;

    const assetName = match[1] as keyof typeof PREVIEW_ASSETS;
    const assetDefinition = PREVIEW_ASSETS[assetName];
    if (!assetDefinition) return null;

    try {
      const absolutePath = require.resolve(assetDefinition.modulePath);
      const body = await readFile(absolutePath);
      return {
        contentType: assetDefinition.contentType,
        body,
      };
    } catch (error) {
      console.error(`[PreviewServer] Failed to read local asset: ${assetDefinition.modulePath}`, error);
      return null;
    }
  }

  private respond(res: ServerResponse, status: number, body: string): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  }

  private respondAsset(res: ServerResponse, contentType: string, body: Buffer): void {
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  }
}
