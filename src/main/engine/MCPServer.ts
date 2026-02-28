import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { createServer as createHttpServer, type Server } from 'http';
import { z } from 'zod';
import { ProposalStore, type ProposalType } from './ProposalStore';
import {
  reviewPostHtml,
  reviewScriptHtml,
  reviewTemplateHtml,
  reviewMetadataHtml,
} from './mcp-views';

// ── Dependency contracts ──────────────────────────────────────────────

interface PostEngineContract {
  getAllPosts: (options?: { limit?: number; offset?: number }) => Promise<{ items: Array<Record<string, unknown>>; hasMore: boolean; total: number }>;
  getPost: (id: string) => Promise<Record<string, unknown> | null>;
  searchPosts: (query: string) => Promise<Array<{ id: string; title: string; slug: string; excerpt?: string }>>;
  createPost: (data: Record<string, unknown>) => Promise<Record<string, unknown>>;
  updatePost: (id: string, data: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  publishPost: (id: string) => Promise<Record<string, unknown> | null>;
  deletePost: (id: string) => Promise<boolean>;
  getTagsWithCounts: () => Promise<Array<{ tag: string; count: number }>>;
  getCategoriesWithCounts: () => Promise<Array<{ category: string; count: number }>>;
  getBlogStats: () => Promise<Record<string, unknown>>;
  getLinkedBy: (postId: string) => Promise<Array<{ id: string; title: string; slug: string }>>;
  getLinksTo: (postId: string) => Promise<Array<{ id: string; title: string; slug: string }>>;
  getPostsFiltered: (filter: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
}

interface MediaEngineContract {
  getAllMedia: () => Promise<Array<Record<string, unknown>>>;
  getMedia: (id: string) => Promise<Record<string, unknown> | null>;
  updateMedia: (id: string, data: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
}

interface ScriptEngineContract {
  createScript: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

interface TemplateEngineContract {
  createTemplate: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

interface MetaEngineContract {
  getProjectMetadata: () => Promise<Record<string, unknown> | null>;
}

interface PostMediaEngineContract {
  getLinkedMediaDataForPost: (postId: string) => Promise<Array<Record<string, unknown>>>;
  getLinkedPostsForMedia: (mediaId: string) => Promise<Array<Record<string, unknown>>>;
}

interface TagEngineContract {
  getTagsWithCounts: () => Promise<Array<Record<string, unknown>>>;
}

export interface MCPServerDependencies {
  getPostEngine: () => PostEngineContract;
  getMediaEngine: () => MediaEngineContract;
  getScriptEngine: () => ScriptEngineContract;
  getTemplateEngine: () => TemplateEngineContract;
  getMetaEngine: () => MetaEngineContract;
  getPostMediaEngine: () => PostMediaEngineContract;
  getTagEngine: () => TagEngineContract;
}

// ── MCPServer engine ──────────────────────────────────────────────────

export class MCPServer {
  readonly proposalStore: ProposalStore;
  private readonly deps: MCPServerDependencies;
  private httpServer: Server | null = null;
  private port: number | null = null;

  constructor(deps: MCPServerDependencies) {
    this.deps = deps;
    this.proposalStore = new ProposalStore();
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
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
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

  // ── Accept / Discard ────────────────────────────────────────────────

  async acceptProposal(proposalId: string): Promise<{ success: boolean; message: string }> {
    const proposal = this.proposalStore.get(proposalId);
    if (!proposal) {
      return { success: false, message: `Proposal ${proposalId} not found.` };
    }

    try {
      switch (proposal.type) {
        case 'draftPost': {
          const postId = proposal.data.postId as string;
          await this.deps.getPostEngine().publishPost(postId);
          break;
        }
        case 'proposeScript': {
          await this.deps.getScriptEngine().createScript(proposal.data);
          break;
        }
        case 'proposeTemplate': {
          await this.deps.getTemplateEngine().createTemplate(proposal.data);
          break;
        }
        case 'proposeMediaMetadata': {
          const mediaId = proposal.data.mediaId as string;
          const changes = proposal.data.changes as Record<string, unknown>;
          await this.deps.getMediaEngine().updateMedia(mediaId, changes);
          break;
        }
        case 'proposePostMetadata': {
          const postId = proposal.data.postId as string;
          const changes = proposal.data.changes as Record<string, unknown>;
          await this.deps.getPostEngine().updatePost(postId, changes);
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
        const postId = proposal.data.postId as string;
        await this.deps.getPostEngine().deletePost(postId);
      }
      this.proposalStore.remove(proposalId);
      return { success: true, message: `Proposal ${proposalId} discarded.` };
    } catch (error) {
      return { success: false, message: `Failed to discard proposal: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // ── Resource registration ──────────────────────────────────────────

  private registerResources(server: McpServer): void {
    server.registerResource('posts', 'bds://posts', { description: 'All blog posts' }, async () => {
      const result = await this.deps.getPostEngine().getAllPosts();
      return { contents: [{ uri: 'bds://posts', mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('media', 'bds://media', { description: 'All media files' }, async () => {
      const result = await this.deps.getMediaEngine().getAllMedia();
      return { contents: [{ uri: 'bds://media', mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('tags', 'bds://tags', { description: 'Tags with post counts' }, async () => {
      const result = await this.deps.getPostEngine().getTagsWithCounts();
      return { contents: [{ uri: 'bds://tags', mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('categories', 'bds://categories', { description: 'Categories with post counts' }, async () => {
      const result = await this.deps.getPostEngine().getCategoriesWithCounts();
      return { contents: [{ uri: 'bds://categories', mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('stats', 'bds://stats', { description: 'Blog statistics' }, async () => {
      const result = await this.deps.getPostEngine().getBlogStats();
      return { contents: [{ uri: 'bds://stats', mimeType: 'application/json', text: JSON.stringify(result) }] };
    });
  }

  private registerResourceTemplates(server: McpServer): void {
    server.registerResource('post', new ResourceTemplate('bds://posts/{id}', { list: undefined }), { description: 'A single post by ID' }, async (uri, { id }) => {
      const result = await this.deps.getPostEngine().getPost(id as string);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('media-item', new ResourceTemplate('bds://media/{id}', { list: undefined }), { description: 'A single media item by ID' }, async (uri, { id }) => {
      const result = await this.deps.getMediaEngine().getMedia(id as string);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('post-backlinks', new ResourceTemplate('bds://posts/{id}/backlinks', { list: undefined }), { description: 'Posts linking to this post' }, async (uri, { id }) => {
      const result = await this.deps.getPostEngine().getLinkedBy(id as string);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('post-outlinks', new ResourceTemplate('bds://posts/{id}/outlinks', { list: undefined }), { description: 'Posts this post links to' }, async (uri, { id }) => {
      const result = await this.deps.getPostEngine().getLinksTo(id as string);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('post-media', new ResourceTemplate('bds://posts/{id}/media', { list: undefined }), { description: 'Media linked to a post' }, async (uri, { id }) => {
      const result = await this.deps.getPostMediaEngine().getLinkedMediaDataForPost(id as string);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(result) }] };
    });

    server.registerResource('media-posts', new ResourceTemplate('bds://media/{id}/posts', { list: undefined }), { description: 'Posts linked to a media item' }, async (uri, { id }) => {
      const result = await this.deps.getPostMediaEngine().getLinkedPostsForMedia(id as string);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(result) }] };
    });
  }

  // ── Tool registration ──────────────────────────────────────────────

  private registerReadTools(server: McpServer): void {
    server.registerTool('search_posts', {
      title: 'Search Posts',
      description: 'Search blog posts by query, category, tags, or date range.',
      inputSchema: {
        query: z.string().optional().describe('Full-text search query'),
        category: z.string().optional().describe('Filter by category'),
        tags: z.array(z.string()).optional().describe('Filter by tags'),
        year: z.number().optional().describe('Filter by year'),
        month: z.number().optional().describe('Filter by month (1-12)'),
        status: z.enum(['draft', 'published', 'archived']).optional().describe('Filter by status'),
        offset: z.number().optional().describe('Pagination offset'),
        limit: z.number().optional().describe('Max results to return'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async (args) => {
      if (args.query) {
        const results = await this.deps.getPostEngine().searchPosts(args.query);
        return { content: [{ type: 'text' as const, text: JSON.stringify(results) }] };
      }
      const filter: Record<string, unknown> = {};
      if (args.category) filter.categories = [args.category];
      if (args.tags) filter.tags = args.tags;
      if (args.year) filter.year = args.year;
      if (args.month) filter.month = args.month;
      if (args.status) filter.status = args.status;
      const results = await this.deps.getPostEngine().getPostsFiltered(filter);
      return { content: [{ type: 'text' as const, text: JSON.stringify(results) }] };
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
      _meta: { ui: { resourceUri: 'ui://bds/review-post' } },
    }, async (args: { title: string; content: string; excerpt?: string; tags?: string[]; categories?: string[]; author?: string }) => {
      const post = await this.deps.getPostEngine().createPost({
        title: args.title,
        content: args.content,
        excerpt: args.excerpt,
        tags: args.tags ?? [],
        categories: args.categories ?? [],
        author: args.author,
        status: 'draft',
      });
      const proposalId = this.proposalStore.create('draftPost', { postId: (post as Record<string, unknown>).id });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ proposalId, post }) }],
      };
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
      _meta: { ui: { resourceUri: 'ui://bds/review-script' } },
    }, async (args: { title: string; kind: 'macro' | 'utility' | 'transform'; content: string; entrypoint?: string }) => {
      const proposalId = this.proposalStore.create('proposeScript', {
        title: args.title,
        kind: args.kind,
        content: args.content,
        entrypoint: args.entrypoint,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ proposalId, preview: { title: args.title, kind: args.kind, contentLength: args.content.length } }) }],
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
      _meta: { ui: { resourceUri: 'ui://bds/review-template' } },
    }, async (args: { title: string; kind: 'post' | 'list' | 'not-found' | 'partial'; content: string }) => {
      const proposalId = this.proposalStore.create('proposeTemplate', {
        title: args.title,
        kind: args.kind,
        content: args.content,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ proposalId, preview: { title: args.title, kind: args.kind, contentLength: args.content.length } }) }],
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
      _meta: { ui: { resourceUri: 'ui://bds/review-metadata' } },
    }, async (args: { mediaId: string; alt?: string; caption?: string; title?: string; tags?: string[] }) => {
      const { mediaId, ...changes } = args;
      const current = await this.deps.getMediaEngine().getMedia(mediaId);
      const proposalId = this.proposalStore.create('proposeMediaMetadata', {
        mediaId,
        changes,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ proposalId, current, proposed: changes }) }],
      };
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
      _meta: { ui: { resourceUri: 'ui://bds/review-metadata' } },
    }, async (args: { postId: string; title?: string; excerpt?: string; tags?: string[]; categories?: string[] }) => {
      const { postId, ...changes } = args;
      const current = await this.deps.getPostEngine().getPost(postId);
      const proposalId = this.proposalStore.create('proposePostMetadata', {
        postId,
        changes,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ proposalId, current, proposed: changes }) }],
      };
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
    server.registerTool('accept_proposal', {
      title: 'Accept Proposal',
      description: 'Accept a pending proposal, committing the proposed change.',
      inputSchema: {
        proposalId: z.string().describe('ID of the proposal to accept'),
      },
      annotations: { idempotentHint: true },
    }, async (args) => {
      const result = await this.acceptProposal(args.proposalId);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    });

    server.registerTool('discard_proposal', {
      title: 'Discard Proposal',
      description: 'Discard a pending proposal, rolling back any draft changes.',
      inputSchema: {
        proposalId: z.string().describe('ID of the proposal to discard'),
      },
      annotations: { idempotentHint: true },
    }, async (args) => {
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

// ── Singleton ───────────────────────────────────────────────────────

let mcpServerInstance: MCPServer | null = null;

export function getMCPServer(deps?: MCPServerDependencies): MCPServer {
  if (!mcpServerInstance) {
    if (!deps) {
      // Import singletons lazily to avoid circular deps
      const { getPostEngine } = require('./PostEngine');
      const { getMediaEngine } = require('./MediaEngine');
      const { getScriptEngine } = require('./ScriptEngine');
      const { getTemplateEngine } = require('./TemplateEngine');
      const { getMetaEngine } = require('./MetaEngine');
      const { getPostMediaEngine } = require('./PostMediaEngine');
      const { getTagEngine } = require('./TagEngine');
      deps = {
        getPostEngine, getMediaEngine, getScriptEngine,
        getTemplateEngine, getMetaEngine, getPostMediaEngine, getTagEngine,
      };
    }
    mcpServerInstance = new MCPServer(deps);
  }
  return mcpServerInstance;
}

export function resetMCPServer(): void {
  mcpServerInstance = null;
}
