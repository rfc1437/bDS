import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { createServer as createHttpServer, type Server } from 'http';
import { z } from 'zod';
import { buildAmbiguityHints, enrichWithLinks, executeCheckTerm } from './ai/blog-tools';
import { ProposalStore, type ProposalType } from './ProposalStore';
import {
  reviewPostHtml,
  reviewScriptHtml,
  reviewTemplateHtml,
  reviewMetadataHtml,
} from './mcp-views';
import type {
  PostData,
  PostFilter,
  SearchResult,
  PaginatedResult,
  PaginationOptions,
} from './PostEngine';
import type { MediaData } from './MediaEngine';
import type { CreateScriptInput, ScriptData, ScriptValidationResult } from './ScriptEngine';
import type { CreateTemplateInput, TemplateData, TemplateValidationResult } from './TemplateEngine';
import type { ProjectMetadata } from './MetaEngine';
import type { PostMediaLinkData } from './PostMediaEngine';
import type { TagWithCount } from './TagEngine';

// ── Pagination helpers ─────────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 50;

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64url');
}

export function decodeCursor(cursor: string): number {
  try {
    const offset = parseInt(Buffer.from(cursor, 'base64url').toString(), 10);
    return Number.isNaN(offset) || offset < 0 ? 0 : offset;
  } catch {
    return 0;
  }
}

// ── Dependency contracts ──────────────────────────────────────────────

interface PostEngineContract {
  getAllPosts: (options?: PaginationOptions) => Promise<PaginatedResult<PostData>>;
  getPost: (id: string) => Promise<PostData | null>;
  searchPosts: (query: string) => Promise<SearchResult[]>;
  searchPostsFiltered: (query: string, filter: PostFilter, pagination?: PaginationOptions) => Promise<PostData[]>;
  createPost: (data: Partial<PostData>) => Promise<PostData>;
  updatePost: (id: string, data: Partial<PostData>) => Promise<PostData | null>;
  publishPost: (id: string) => Promise<PostData | null>;
  deletePost: (id: string) => Promise<boolean>;
  getTagsWithCounts: () => Promise<Array<{ tag: string; count: number }>>;
  getCategoriesWithCounts: () => Promise<Array<{ category: string; count: number }>>;
  getBlogStats: () => Promise<{
    totalPosts: number;
    draftCount: number;
    publishedCount: number;
    archivedCount: number;
    oldestPostDate: Date | null;
    newestPostDate: Date | null;
    postsPerYear: Record<number, number>;
    tagCount: number;
    categoryCount: number;
  }>;
  getLinkedBy: (postId: string) => Promise<Array<{ id: string; title: string; slug: string }>>;
  getLinksTo: (postId: string) => Promise<Array<{ id: string; title: string; slug: string }>>;
  getPostsFiltered: (filter: PostFilter) => Promise<PostData[]>;
}

interface MediaEngineContract {
  getAllMedia: () => Promise<MediaData[]>;
  getMedia: (id: string) => Promise<MediaData | null>;
  updateMedia: (id: string, data: Partial<MediaData>) => Promise<MediaData | null>;
  getThumbnailDataUrl: (mediaId: string, size: 'small' | 'medium' | 'large') => Promise<string | null>;
}

interface ScriptEngineContract {
  createDraftScript: (input: CreateScriptInput) => Promise<ScriptData>;
  publishScript: (id: string) => Promise<ScriptData | null>;
  deleteDraftScript: (id: string) => Promise<boolean>;
  validateScript: (content: string) => Promise<ScriptValidationResult>;
}

interface TemplateEngineContract {
  createDraftTemplate: (input: CreateTemplateInput) => Promise<TemplateData>;
  publishTemplate: (id: string) => Promise<TemplateData | null>;
  deleteDraftTemplate: (id: string) => Promise<boolean>;
  validateTemplate: (content: string) => Promise<TemplateValidationResult>;
}

interface MetaEngineContract {
  getProjectMetadata: () => Promise<ProjectMetadata | null>;
}

interface PostMediaEngineContract {
  getLinkedMediaDataForPost: (postId: string) => Promise<Array<PostMediaLinkData & { media: MediaData }>>;
  getLinkedPostsForMedia: (mediaId: string) => Promise<PostMediaLinkData[]>;
}

interface TagEngineContract {
  getTagsWithCounts: () => Promise<TagWithCount[]>;
}

export interface MCPServerDependencies {
  postEngine: PostEngineContract;
  mediaEngine: MediaEngineContract;
  scriptEngine: ScriptEngineContract;
  templateEngine: TemplateEngineContract;
  metaEngine: MetaEngineContract;
  postMediaEngine: PostMediaEngineContract;
  tagEngine: TagEngineContract;
}

/**
 * Maps each proposal type to the shape of its stored data.
 * Used to recover type safety when reading from the generic ProposalStore.
 */
export interface ProposalDataMap {
  draftPost: { postId: string };
  proposeScript: { scriptId: string };
  proposeTemplate: { templateId: string };
  proposeMediaMetadata: { mediaId: string; changes: Partial<MediaData> };
  proposePostMetadata: { postId: string; changes: Partial<PostData> };
}

/** Type-safe accessor for proposal data (bridges the generic ProposalStore). */
function proposalData<T extends keyof ProposalDataMap>(proposal: { data: Record<string, unknown> }): ProposalDataMap[T] {
  return proposal.data as unknown as ProposalDataMap[T];
}

// ── MCPServer engine ──────────────────────────────────────────────────

export class MCPServer {
  readonly proposalStore: ProposalStore;
  private readonly deps: MCPServerDependencies;
  private httpServer: Server | null = null;
  private port: number | null = null;

  constructor(deps: MCPServerDependencies, opts?: { proposalTtlMs?: number }) {
    this.deps = deps;
    this.proposalStore = new ProposalStore(
      opts?.proposalTtlMs,
      (proposal) => {
        // Clean up draft DB rows on TTL expiry
        if (proposal.type === 'proposeScript') {
          const { scriptId } = proposalData<'proposeScript'>(proposal);
          this.deps.scriptEngine.deleteDraftScript(scriptId).catch(() => {});
        } else if (proposal.type === 'proposeTemplate') {
          const { templateId } = proposalData<'proposeTemplate'>(proposal);
          this.deps.templateEngine.deleteDraftTemplate(templateId).catch(() => {});
        }
      },
    );
  }

  /** Create a fresh McpServer with all tools/resources/prompts registered (stateless — one per request). */
  createMcpServer(): McpServer {
    const server = new McpServer({
      name: 'Blogging Desktop Server',
      version: '1.0.0',
    });

    this.registerResources(server);
    this.registerResourceTemplates(server);
    this.registerReadTools(server);
    this.registerProposalTools(server);
    this.registerAcceptDiscardTools(server);
    this.registerPrompts(server);

    return server;
  }

  // ── Server lifecycle ────────────────────────────────────────────────

  async start(preferredPort = 4124): Promise<number> {
    if (this.httpServer && this.port !== null) {
      return this.port;
    }

    const app = createHttpServer(async (req, res) => {
      // Origin validation — reject requests from non-localhost origins
      // to prevent DNS rebinding attacks
      const origin = req.headers['origin'];
      if (origin) {
        try {
          const originUrl = new URL(origin);
          if (originUrl.hostname !== '127.0.0.1' && originUrl.hostname !== 'localhost') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden: non-local origin' }));
            return;
          }
        } catch {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden: invalid origin' }));
          return;
        }
      }

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', origin ?? 'http://127.0.0.1');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const mcpServer = this.createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });

      res.on('close', () => {
        transport.close().catch(() => {});
        mcpServer.close().catch(() => {});
      });

      try {
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, await parseBody(req));
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }));
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      app.once('error', reject);
      app.listen(preferredPort, '127.0.0.1', () => {
        app.off('error', reject);
        resolve();
      });
    });

    this.httpServer = app;
    const address = app.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to get MCP server address');
    }
    this.port = address.port;
    return this.port;
  }

  async stop(): Promise<void> {
    if (!this.httpServer) {
      this.port = null;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      if (!this.httpServer) { resolve(); return; }
      this.httpServer.close((error) => {
        if (error) { reject(error); return; }
        resolve();
      });
    });

    this.httpServer = null;
    this.port = null;
  }

  async cleanup(): Promise<void> {
    this.proposalStore.destroy();
    await this.stop();
  }

  getPort(): number | null {
    return this.port;
  }

  async startCli(): Promise<void> {
    const server = this.createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    await new Promise<void>((resolve) => {
      process.stdin.on('close', resolve);
    });
    await server.close();
  }

  // ── Accept / Discard ────────────────────────────────────────────────

  async acceptProposal(proposalId: string): Promise<{ success: boolean; message: string }> {
    const proposal = this.proposalStore.get(proposalId);
    if (!proposal) {
      return { success: false, message: `Proposal ${proposalId} not found.` };
    }

    try {
      switch (proposal.type) {
        case 'draftPost': {
          const { postId } = proposalData<'draftPost'>(proposal);
          await this.deps.postEngine.publishPost(postId);
          break;
        }
        case 'proposeScript': {
          const { scriptId } = proposalData<'proposeScript'>(proposal);
          await this.deps.scriptEngine.publishScript(scriptId);
          break;
        }
        case 'proposeTemplate': {
          const { templateId } = proposalData<'proposeTemplate'>(proposal);
          await this.deps.templateEngine.publishTemplate(templateId);
          break;
        }
        case 'proposeMediaMetadata': {
          const { mediaId, changes } = proposalData<'proposeMediaMetadata'>(proposal);
          await this.deps.mediaEngine.updateMedia(mediaId, changes);
          break;
        }
        case 'proposePostMetadata': {
          const { postId, changes } = proposalData<'proposePostMetadata'>(proposal);
          await this.deps.postEngine.updatePost(postId, changes);
          break;
        }
      }
      this.proposalStore.remove(proposalId);
      return { success: true, message: `Proposal ${proposalId} accepted.` };
    } catch (error) {
      return { success: false, message: `Failed to accept proposal: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async discardProposal(proposalId: string): Promise<{ success: boolean; message: string }> {
    const proposal = this.proposalStore.get(proposalId);
    if (!proposal) {
      return { success: false, message: `Proposal ${proposalId} not found.` };
    }

    try {
      if (proposal.type === 'draftPost') {
        const { postId } = proposalData<'draftPost'>(proposal);
        await this.deps.postEngine.deletePost(postId);
      } else if (proposal.type === 'proposeScript') {
        const { scriptId } = proposalData<'proposeScript'>(proposal);
        await this.deps.scriptEngine.deleteDraftScript(scriptId);
      } else if (proposal.type === 'proposeTemplate') {
        const { templateId } = proposalData<'proposeTemplate'>(proposal);
        await this.deps.templateEngine.deleteDraftTemplate(templateId);
      }
      this.proposalStore.remove(proposalId);
      return { success: true, message: `Proposal ${proposalId} discarded.` };
    } catch (error) {
      return { success: false, message: `Failed to discard proposal: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // ── Resource registration ──────────────────────────────────────────

  private registerResources(server: McpServer): void {
    server.registerResource('posts', 'bds://posts', { description: 'All blog posts (first page)' }, async () => {
      const result = await this.deps.postEngine.getAllPosts({ limit: DEFAULT_PAGE_SIZE });
      const response: Record<string, unknown> = { ...result };
      if (result.hasMore) {
        response.nextCursor = encodeCursor(DEFAULT_PAGE_SIZE);
      }
      return { contents: [{ uri: 'bds://posts', mimeType: 'application/json', text: JSON.stringify(response) }] };
    });

    server.registerResource('media', 'bds://media', { description: 'All media files (first page)' }, async () => {
      const allMedia = await this.deps.mediaEngine.getAllMedia();
      const items = allMedia.slice(0, DEFAULT_PAGE_SIZE);
      const total = allMedia.length;
      const hasMore = DEFAULT_PAGE_SIZE < total;
      const response: Record<string, unknown> = { items, total, hasMore };
      if (hasMore) {
        response.nextCursor = encodeCursor(DEFAULT_PAGE_SIZE);
      }
      return { contents: [{ uri: 'bds://media', mimeType: 'application/json', text: JSON.stringify(response) }] };
    });

    server.registerResource('tags', 'bds://tags', { description: 'Tags with post counts' }, async () => {
      const result = await this.deps.postEngine.getTagsWithCounts();
      return { contents: [{ uri: 'bds://tags', mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('categories', 'bds://categories', { description: 'Categories with post counts' }, async () => {
      const result = await this.deps.postEngine.getCategoriesWithCounts();
      return { contents: [{ uri: 'bds://categories', mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('stats', 'bds://stats', { description: 'Blog statistics' }, async () => {
      const result = await this.deps.postEngine.getBlogStats();
      return { contents: [{ uri: 'bds://stats', mimeType: 'application/json', text: JSON.stringify(result) }] };
    });
  }

  private registerResourceTemplates(server: McpServer): void {
    // ── Pagination templates ──
    server.registerResource('posts-page', new ResourceTemplate('bds://posts{?cursor}', { list: undefined }), { description: 'Paginated blog posts (use cursor from previous page)' }, async (uri, { cursor }) => {
      const offset = decodeCursor(cursor as string);
      const result = await this.deps.postEngine.getAllPosts({ limit: DEFAULT_PAGE_SIZE, offset });
      const response: Record<string, unknown> = { ...result };
      if (result.hasMore) {
        response.nextCursor = encodeCursor(offset + DEFAULT_PAGE_SIZE);
      }
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(response) }] };
    });

    server.registerResource('media-page', new ResourceTemplate('bds://media{?cursor}', { list: undefined }), { description: 'Paginated media files (use cursor from previous page)' }, async (uri, { cursor }) => {
      const offset = decodeCursor(cursor as string);
      const allMedia = await this.deps.mediaEngine.getAllMedia();
      const items = allMedia.slice(offset, offset + DEFAULT_PAGE_SIZE);
      const total = allMedia.length;
      const hasMore = offset + DEFAULT_PAGE_SIZE < total;
      const response: Record<string, unknown> = { items, total, hasMore };
      if (hasMore) {
        response.nextCursor = encodeCursor(offset + DEFAULT_PAGE_SIZE);
      }
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(response) }] };
    });

    // ── Entity templates ──
    server.registerResource('post', new ResourceTemplate('bds://posts/{id}', { list: undefined }), { description: 'A single post by ID' }, async (uri, { id }) => {
      const postId = id as string;
      const result = await this.deps.postEngine.getPost(postId);
      const [backlinks, linksTo] = await Promise.all([
        this.deps.postEngine.getLinkedBy(postId),
        this.deps.postEngine.getLinksTo(postId),
      ]);
      const enriched = {
        ...result,
        backlinks: backlinks.map(b => ({ id: b.id, title: b.title, slug: b.slug })),
        linksTo: linksTo.map(l => ({ id: l.id, title: l.title, slug: l.slug })),
      };
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(enriched) }] };
    });

    server.registerResource('media-item', new ResourceTemplate('bds://media/{id}', { list: undefined }), { description: 'A single media item by ID' }, async (uri, { id }) => {
      const result = await this.deps.mediaEngine.getMedia(id as string);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('post-backlinks', new ResourceTemplate('bds://posts/{id}/backlinks', { list: undefined }), { description: 'Posts linking to this post' }, async (uri, { id }) => {
      const result = await this.deps.postEngine.getLinkedBy(id as string);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('post-outlinks', new ResourceTemplate('bds://posts/{id}/outlinks', { list: undefined }), { description: 'Posts this post links to' }, async (uri, { id }) => {
      const result = await this.deps.postEngine.getLinksTo(id as string);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('post-media', new ResourceTemplate('bds://posts/{id}/media', { list: undefined }), { description: 'Media linked to a post' }, async (uri, { id }) => {
      const result = await this.deps.postMediaEngine.getLinkedMediaDataForPost(id as string);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('media-posts', new ResourceTemplate('bds://media/{id}/posts', { list: undefined }), { description: 'Posts linked to a media item' }, async (uri, { id }) => {
      const result = await this.deps.postMediaEngine.getLinkedPostsForMedia(id as string);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('media-image', new ResourceTemplate('bds://media/{id}/image', { list: undefined }), { description: 'Image thumbnail (medium size, base64 WebP) for visual context' }, async (uri, { id }) => {
      const mediaId = id as string;
      const media = await this.deps.mediaEngine.getMedia(mediaId);
      if (!media || !media.mimeType.startsWith('image/')) {
        return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'Not an image or media not found' }] };
      }
      const dataUrl = await this.deps.mediaEngine.getThumbnailDataUrl(mediaId, 'medium');
      if (!dataUrl) {
        return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'Thumbnail not available' }] };
      }
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      return {
        contents: [{ uri: uri.href, mimeType: 'image/webp', blob: base64Data }],
      };
    });
  }

  // ── Tool registration ──────────────────────────────────────────────

  private registerReadTools(server: McpServer): void {
    // ── check_term ──
    server.registerTool('check_term', {
      title: 'Check Term',
      description: 'Check whether a term exists as a category, tag, or both. Returns post counts for each. Useful for disambiguation before querying with search_posts.',
      inputSchema: {
        term: z.string().describe('The term to look up'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async (args) => {
      const result = await executeCheckTerm(args.term, this.deps.postEngine);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    });

    // ── search_posts ──
    server.registerTool('search_posts', {
      title: 'Search Posts',
      description: 'Search blog posts by query, category, tags, or date range. Each result includes backlinks (posts linking to it) and linksTo (posts it links to). Use check_term first if unsure whether a term is a category or tag. Also available as resources: bds://categories (categories with counts), bds://tags (tags with counts).',
      inputSchema: {
        query: z.string().optional().describe('Full-text search query'),
        category: z.string().optional().describe('Filter by category'),
        tags: z.array(z.string()).optional().describe('Filter by tags (all must match)'),
        year: z.number().optional().describe('Filter by year'),
        month: z.number().optional().describe('Filter by month (1-12). Requires year.'),
        status: z.enum(['draft', 'published', 'archived']).optional().describe('Filter by status'),
        offset: z.number().optional().describe('Pagination offset'),
        limit: z.number().optional().describe('Max results to return'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async (args) => {
      if (args.month && !args.year) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'month requires year. Example: year: 2025, month: 3' }) }],
          isError: true,
        };
      }

      const hasFilters = args.category || args.tags || args.year || args.month || args.status;
      const offset = args.offset ?? 0;
      const limit = args.limit ?? 50;

      if (args.query && !hasFilters) {
        const results = await this.deps.postEngine.searchPosts(args.query);
        const paginated = results.slice(offset, offset + limit);
        const enriched = await enrichWithLinks(paginated, this.deps.postEngine);
        return { content: [{ type: 'text' as const, text: JSON.stringify(enriched) }] };
      }

      const filter: PostFilter = {};
      if (args.category) filter.categories = [args.category];
      if (args.tags) filter.tags = args.tags;
      if (args.year) filter.year = args.year;
      if (args.month) filter.month = args.month;
      if (args.status) filter.status = args.status;

      let enriched;
      if (args.query && hasFilters) {
        const results = await this.deps.postEngine.searchPostsFiltered(args.query, filter, { offset, limit });
        enriched = await enrichWithLinks(results, this.deps.postEngine);
      } else {
        const results = await this.deps.postEngine.getPostsFiltered(filter);
        const paginated = results.slice(offset, offset + limit);
        enriched = await enrichWithLinks(paginated, this.deps.postEngine);
      }

      const content: Array<{ type: 'text'; text: string }> = [
        { type: 'text' as const, text: JSON.stringify(enriched) },
      ];
      const hintsList = await buildAmbiguityHints(this.deps.postEngine, args.category, args.tags);
      if (hintsList.length > 0) {
        content.push({ type: 'text' as const, text: hintsList.join(' ') });
      }
      return { content };
    });
  }

  private registerProposalTools(server: McpServer): void {
    // ── draft_post ──
    registerAppTool(server, 'draft_post', {
      title: 'Draft Post',
      description: 'Create a new draft blog post for review before publishing.',
      inputSchema: {
        title: z.string().describe('Post title'),
        content: z.string().describe('Post content in Markdown'),
        excerpt: z.string().optional().describe('Short excerpt/summary'),
        tags: z.array(z.string()).optional().describe('Tags for the post'),
        categories: z.array(z.string()).optional().describe('Categories for the post'),
        author: z.string().optional().describe('Post author name'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { ui: { resourceUri: 'ui://bds/review-post' } },
    }, async (args: { title: string; content: string; excerpt?: string; tags?: string[]; categories?: string[]; author?: string }) => {
      try {
        const post = await this.deps.postEngine.createPost({
          title: args.title,
          content: args.content,
          excerpt: args.excerpt,
          tags: args.tags ?? [],
          categories: args.categories ?? [],
          author: args.author,
          status: 'draft',
        });
        const proposalId = this.proposalStore.create('draftPost', { postId: post.id });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ proposalId, post }) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Failed to create draft: ${error instanceof Error ? error.message : String(error)}` }) }],
          isError: true,
        };
      }
    });

    // ── propose_script ──
    registerAppTool(server, 'propose_script', {
      title: 'Propose Script',
      description: 'Propose a new Python script (macro, utility, or transform) for review.',
      inputSchema: {
        title: z.string().describe('Script title'),
        kind: z.enum(['macro', 'utility', 'transform']).describe('Script type'),
        content: z.string().describe('Python source code'),
        entrypoint: z.string().optional().describe('Entry point function name'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { ui: { resourceUri: 'ui://bds/review-script' } },
    }, async (args: { title: string; kind: 'macro' | 'utility' | 'transform'; content: string; entrypoint?: string }) => {
      const validation = await this.deps.scriptEngine.validateScript(args.content);
      const draft = await this.deps.scriptEngine.createDraftScript({
        title: args.title,
        kind: args.kind,
        content: args.content,
        entrypoint: args.entrypoint,
      });
      const proposalId = this.proposalStore.create('proposeScript', { scriptId: draft.id });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ proposalId, preview: { title: args.title, kind: args.kind, contentLength: args.content.length, syntaxValid: validation.valid, syntaxErrors: validation.errors } }) }],
      };
    });

    // ── propose_template ──
    registerAppTool(server, 'propose_template', {
      title: 'Propose Template',
      description: 'Propose a new Liquid template for review.',
      inputSchema: {
        title: z.string().describe('Template title'),
        kind: z.enum(['post', 'list', 'not-found', 'partial']).describe('Template type'),
        content: z.string().describe('Liquid template content'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { ui: { resourceUri: 'ui://bds/review-template' } },
    }, async (args: { title: string; kind: 'post' | 'list' | 'not-found' | 'partial'; content: string }) => {
      const validation = await this.deps.templateEngine.validateTemplate(args.content);
      const draft = await this.deps.templateEngine.createDraftTemplate({
        title: args.title,
        kind: args.kind,
        content: args.content,
      });
      const proposalId = this.proposalStore.create('proposeTemplate', { templateId: draft.id });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ proposalId, preview: { title: args.title, kind: args.kind, contentLength: args.content.length, syntaxValid: validation.valid, syntaxErrors: validation.errors } }) }],
      };
    });

    // ── propose_media_metadata ──
    registerAppTool(server, 'propose_media_metadata', {
      title: 'Propose Media Metadata',
      description: 'Propose metadata changes for a media item (alt text, caption, title, tags).',
      inputSchema: {
        mediaId: z.string().describe('ID of the media item to update'),
        alt: z.string().optional().describe('New alt text'),
        caption: z.string().optional().describe('New caption'),
        title: z.string().optional().describe('New title'),
        tags: z.array(z.string()).optional().describe('New tags'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { ui: { resourceUri: 'ui://bds/review-metadata' } },
    }, async (args: { mediaId: string; alt?: string; caption?: string; title?: string; tags?: string[] }) => {
      try {
        const { mediaId, ...changes } = args;
        const current = await this.deps.mediaEngine.getMedia(mediaId);
        if (!current) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: `Media item ${mediaId} not found.` }) }],
            isError: true,
          };
        }
        const proposalId = this.proposalStore.create('proposeMediaMetadata', {
          mediaId,
          changes,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ proposalId, current, proposed: changes }) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Failed to propose media metadata: ${error instanceof Error ? error.message : String(error)}` }) }],
          isError: true,
        };
      }
    });

    // ── propose_post_metadata ──
    registerAppTool(server, 'propose_post_metadata', {
      title: 'Propose Post Metadata',
      description: 'Propose metadata changes for a post (title, excerpt, tags, categories).',
      inputSchema: {
        postId: z.string().describe('ID of the post to update'),
        title: z.string().optional().describe('New title'),
        excerpt: z.string().optional().describe('New excerpt'),
        tags: z.array(z.string()).optional().describe('New tags'),
        categories: z.array(z.string()).optional().describe('New categories'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { ui: { resourceUri: 'ui://bds/review-metadata' } },
    }, async (args: { postId: string; title?: string; excerpt?: string; tags?: string[]; categories?: string[] }) => {
      try {
        const { postId, ...changes } = args;
        const current = await this.deps.postEngine.getPost(postId);
        if (!current) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: `Post ${postId} not found.` }) }],
            isError: true,
          };
        }
        const proposalId = this.proposalStore.create('proposePostMetadata', {
          postId,
          changes,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ proposalId, current, proposed: changes }) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Failed to propose post metadata: ${error instanceof Error ? error.message : String(error)}` }) }],
          isError: true,
        };
      }
    });

    // ── Register ui:// resources for review Views ──
    this.registerReviewResources(server);
  }

  private registerReviewResources(server: McpServer): void {
    registerAppResource(server, 'Post Review', 'ui://bds/review-post', {
      description: 'Interactive review UI for draft posts',
    }, async () => ({
      contents: [{ uri: 'ui://bds/review-post', mimeType: RESOURCE_MIME_TYPE, text: reviewPostHtml() }],
    }));

    registerAppResource(server, 'Script Review', 'ui://bds/review-script', {
      description: 'Interactive review UI for proposed scripts',
    }, async () => ({
      contents: [{ uri: 'ui://bds/review-script', mimeType: RESOURCE_MIME_TYPE, text: reviewScriptHtml() }],
    }));

    registerAppResource(server, 'Template Review', 'ui://bds/review-template', {
      description: 'Interactive review UI for proposed templates',
    }, async () => ({
      contents: [{ uri: 'ui://bds/review-template', mimeType: RESOURCE_MIME_TYPE, text: reviewTemplateHtml() }],
    }));

    registerAppResource(server, 'Metadata Review', 'ui://bds/review-metadata', {
      description: 'Interactive review UI for proposed metadata changes',
    }, async () => ({
      contents: [{ uri: 'ui://bds/review-metadata', mimeType: RESOURCE_MIME_TYPE, text: reviewMetadataHtml() }],
    }));
  }

  private registerAcceptDiscardTools(server: McpServer): void {
    registerAppTool(server, 'accept_proposal', {
      title: 'Accept Proposal',
      description: 'Accept a pending proposal, committing the proposed change.',
      inputSchema: {
        proposalId: z.string().describe('ID of the proposal to accept'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: { ui: { visibility: ['app'] } },
    }, async (args: { proposalId: string }) => {
      const result = await this.acceptProposal(args.proposalId);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    });

    registerAppTool(server, 'discard_proposal', {
      title: 'Discard Proposal',
      description: 'Discard a pending proposal, rolling back any draft changes.',
      inputSchema: {
        proposalId: z.string().describe('ID of the proposal to discard'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      _meta: { ui: { visibility: ['app'] } },
    }, async (args: { proposalId: string }) => {
      const result = await this.discardProposal(args.proposalId);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    });
  }

  // ── Prompt registration ────────────────────────────────────────────

  private registerPrompts(server: McpServer): void {
    server.registerPrompt('draft-blog-post', {
      title: 'Draft Blog Post',
      description: 'Guides you through drafting a new blog post with proper structure and metadata.',
      argsSchema: {
        topic: z.string().optional().describe('Topic or title idea for the post'),
        category: z.string().optional().describe('Category to write for'),
      },
    }, async (args) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: buildDraftPostPrompt(args.topic, args.category),
        },
      }],
    }));

    server.registerPrompt('improve-media-metadata', {
      title: 'Improve Media Metadata',
      description: 'Guides you through reviewing and improving media metadata (alt text, captions).',
      argsSchema: {
        scope: z.enum(['all', 'missing-alt', 'missing-caption']).optional().describe('Which media items to review'),
      },
    }, async (args) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: buildMediaMetadataPrompt(args.scope),
        },
      }],
    }));

    server.registerPrompt('content-audit', {
      title: 'Content Audit',
      description: 'Guides you through auditing blog content for quality, SEO, and consistency.',
      argsSchema: {
        category: z.string().optional().describe('Category to audit (omit for all)'),
      },
    }, async (args) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: buildContentAuditPrompt(args.category),
        },
      }],
    }));
  }
}

// ── Prompt builders ─────────────────────────────────────────────────

function buildDraftPostPrompt(topic?: string, category?: string): string {
  const parts = [
    'You are helping draft a blog post for a Blogging Desktop Server instance.',
    '',
    'Steps:',
    '1. Read the existing content using the `bds://posts`, `bds://tags`, and `bds://categories` resources to understand the blog\'s style and topics.',
    '2. Draft a new post with a compelling title, well-structured Markdown content, appropriate tags and categories.',
    '3. Use the `draft_post` tool to create the draft for the user to review.',
    '',
  ];
  if (topic) parts.push(`Suggested topic: ${topic}`);
  if (category) parts.push(`Target category: ${category}`);
  parts.push('', 'Ensure the post matches the existing blog style and quality standards.');
  return parts.join('\n');
}

function buildMediaMetadataPrompt(scope?: string): string {
  const parts = [
    'You are helping improve media metadata in a Blogging Desktop Server instance.',
    '',
    'Steps:',
    '1. Read the `bds://media` resource to see all media items.',
    '2. Review each item\'s alt text, caption, and title.',
  ];
  if (scope === 'missing-alt') {
    parts.push('3. Focus on items that are missing alt text.');
  } else if (scope === 'missing-caption') {
    parts.push('3. Focus on items that are missing captions.');
  } else {
    parts.push('3. Review all items for completeness and quality.');
  }
  parts.push(
    '4. For each item that needs improvement, use `propose_media_metadata` to suggest changes.',
    '',
    'Write descriptive, accessible alt text and informative captions.',
  );
  return parts.join('\n');
}

function buildContentAuditPrompt(category?: string): string {
  const parts = [
    'You are helping audit blog content in a Blogging Desktop Server instance.',
    '',
    'Steps:',
    '1. Read the blog content using `bds://posts`, `bds://stats`, `bds://tags`, and `bds://categories` resources.',
  ];
  if (category) {
    parts.push(`2. Focus your audit on posts in the "${category}" category.`);
  } else {
    parts.push('2. Review all posts across all categories.');
  }
  parts.push(
    '3. Check for:',
    '   - Posts with missing or poor excerpts',
    '   - Inconsistent tagging or categorization',
    '   - Posts that could benefit from better titles',
    '   - Orphaned posts with no backlinks or outlinks',
    '4. Use `propose_post_metadata` for any metadata improvements you recommend.',
    '',
    'Provide a summary of your findings and the proposals you created.',
  );
  return parts.join('\n');
}

// ── Helpers ─────────────────────────────────────────────────────────

function parseBody(req: { on: (event: string, cb: (data: unknown) => void) => void }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: unknown) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(body ? JSON.parse(body) : undefined);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

