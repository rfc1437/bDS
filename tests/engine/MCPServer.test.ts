import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MCPServer, type MCPServerDependencies } from '../../src/main/engine/MCPServer';

// Mock all engine singletons
vi.mock('../../src/main/engine/PostEngine', () => ({
  getPostEngine: vi.fn(),
}));
vi.mock('../../src/main/engine/MediaEngine', () => ({
  getMediaEngine: vi.fn(),
}));
vi.mock('../../src/main/engine/ScriptEngine', () => ({
  getScriptEngine: vi.fn(),
}));
vi.mock('../../src/main/engine/TemplateEngine', () => ({
  getTemplateEngine: vi.fn(),
}));
vi.mock('../../src/main/engine/MetaEngine', () => ({
  getMetaEngine: vi.fn(),
}));
vi.mock('../../src/main/engine/PostMediaEngine', () => ({
  getPostMediaEngine: vi.fn(),
}));
vi.mock('../../src/main/engine/TagEngine', () => ({
  getTagEngine: vi.fn(),
}));

function createMockPostEngine() {
  return {
    getAllPosts: vi.fn().mockResolvedValue({ items: [], hasMore: false, total: 0 }),
    getPost: vi.fn().mockResolvedValue(null),
    searchPosts: vi.fn().mockResolvedValue([]),
    createPost: vi.fn().mockResolvedValue({
      id: 'post-1', title: 'Test', slug: 'test', content: '', status: 'draft',
      tags: [], categories: [], createdAt: new Date(), updatedAt: new Date(),
    }),
    updatePost: vi.fn().mockResolvedValue(null),
    publishPost: vi.fn().mockResolvedValue(null),
    deletePost: vi.fn().mockResolvedValue(true),
    getTagsWithCounts: vi.fn().mockResolvedValue([]),
    getCategoriesWithCounts: vi.fn().mockResolvedValue([]),
    getBlogStats: vi.fn().mockResolvedValue({
      totalPosts: 0, draftCount: 0, publishedCount: 0, archivedCount: 0,
      oldestPostDate: null, newestPostDate: null, postsPerYear: [], tagCount: 0, categoryCount: 0,
    }),
    getLinkedBy: vi.fn().mockResolvedValue([]),
    getLinksTo: vi.fn().mockResolvedValue([]),
    getPostsFiltered: vi.fn().mockResolvedValue([]),
  };
}

function createMockMediaEngine() {
  return {
    getAllMedia: vi.fn().mockResolvedValue([]),
    getMedia: vi.fn().mockResolvedValue(null),
    updateMedia: vi.fn().mockResolvedValue(null),
    getThumbnailDataUrl: vi.fn().mockResolvedValue(null),
  };
}

function createMockScriptEngine() {
  return {
    createScript: vi.fn().mockResolvedValue({
      id: 'script-1', title: 'Test', slug: 'test', kind: 'macro',
      entrypoint: 'main.py', content: '', enabled: true, version: 1,
      filePath: '/test', createdAt: new Date(), updatedAt: new Date(),
    }),
  };
}

function createMockTemplateEngine() {
  return {
    createTemplate: vi.fn().mockResolvedValue({
      id: 'tpl-1', title: 'Test', slug: 'test', kind: 'post',
      enabled: true, version: 1, filePath: '/test', content: '',
      createdAt: new Date(), updatedAt: new Date(),
    }),
  };
}

function createMockMetaEngine() {
  return {
    getProjectMetadata: vi.fn().mockResolvedValue(null),
  };
}

function createMockPostMediaEngine() {
  return {
    getLinkedMediaDataForPost: vi.fn().mockResolvedValue([]),
    getLinkedPostsForMedia: vi.fn().mockResolvedValue([]),
  };
}

function createMockTagEngine() {
  return {
    getTagsWithCounts: vi.fn().mockResolvedValue([]),
  };
}

/** Create stable mock instances that are returned by getter functions */
function createDependencies() {
  const mockPostEngine = createMockPostEngine();
  const mockMediaEngine = createMockMediaEngine();
  const mockScriptEngine = createMockScriptEngine();
  const mockTemplateEngine = createMockTemplateEngine();
  const mockMetaEngine = createMockMetaEngine();
  const mockPostMediaEngine = createMockPostMediaEngine();
  const mockTagEngine = createMockTagEngine();

  const deps: MCPServerDependencies = {
    getPostEngine: () => mockPostEngine,
    getMediaEngine: () => mockMediaEngine,
    getScriptEngine: () => mockScriptEngine,
    getTemplateEngine: () => mockTemplateEngine,
    getMetaEngine: () => mockMetaEngine,
    getPostMediaEngine: () => mockPostMediaEngine,
    getTagEngine: () => mockTagEngine,
  };

  return { deps, mockPostEngine, mockMediaEngine, mockScriptEngine, mockTemplateEngine, mockMetaEngine, mockPostMediaEngine, mockTagEngine };
}

/** Helper: check if a key exists in an McpServer internal registry (plain object) */
function hasRegistered(mcpServer: unknown, registry: string, name: string): boolean {
  const obj = (mcpServer as Record<string, Record<string, unknown>>)[registry];
  return obj != null && name in obj;
}

describe('MCPServer', () => {
  let server: MCPServer;
  let deps: MCPServerDependencies;
  let mockPostEngine: ReturnType<typeof createMockPostEngine>;
  let mockMediaEngine: ReturnType<typeof createMockMediaEngine>;
  let mockScriptEngine: ReturnType<typeof createMockScriptEngine>;
  let mockTemplateEngine: ReturnType<typeof createMockTemplateEngine>;
  let mockPostMediaEngine: ReturnType<typeof createMockPostMediaEngine>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = createDependencies();
    deps = mocks.deps;
    mockPostEngine = mocks.mockPostEngine;
    mockMediaEngine = mocks.mockMediaEngine;
    mockScriptEngine = mocks.mockScriptEngine;
    mockTemplateEngine = mocks.mockTemplateEngine;
    mockPostMediaEngine = mocks.mockPostMediaEngine;
    server = new MCPServer(deps);
  });

  describe('constructor', () => {
    it('creates an MCPServer instance', () => {
      expect(server).toBeInstanceOf(MCPServer);
    });
  });

  describe('createMcpServer', () => {
    it('creates an McpServer with registered tools', () => {
      const mcpServer = server.createMcpServer();
      expect(mcpServer).toBeDefined();
    });
  });

  describe('proposal store', () => {
    it('exposes the proposal store', () => {
      expect(server.proposalStore).toBeDefined();
    });
  });

  describe('registered tools', () => {
    it('registers search_posts tool', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredTools', 'search_posts')).toBe(true);
    });

    it('registers draft_post tool', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredTools', 'draft_post')).toBe(true);
    });

    it('registers propose_script tool', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredTools', 'propose_script')).toBe(true);
    });

    it('registers propose_template tool', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredTools', 'propose_template')).toBe(true);
    });

    it('registers propose_media_metadata tool', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredTools', 'propose_media_metadata')).toBe(true);
    });

    it('registers propose_post_metadata tool', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredTools', 'propose_post_metadata')).toBe(true);
    });

    it('registers accept_proposal tool', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredTools', 'accept_proposal')).toBe(true);
    });

    it('registers discard_proposal tool', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredTools', 'discard_proposal')).toBe(true);
    });
  });

  describe('registered resources', () => {
    it('registers bds://posts resource', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredResources', 'bds://posts')).toBe(true);
    });

    it('registers bds://media resource', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredResources', 'bds://media')).toBe(true);
    });

    it('registers bds://tags resource', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredResources', 'bds://tags')).toBe(true);
    });

    it('registers bds://categories resource', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredResources', 'bds://categories')).toBe(true);
    });

    it('registers bds://stats resource', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredResources', 'bds://stats')).toBe(true);
    });
  });

  describe('registered resource templates', () => {
    it('registers post resource template', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredResourceTemplates', 'post')).toBe(true);
    });

    it('registers media-item resource template', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredResourceTemplates', 'media-item')).toBe(true);
    });

    it('registers post-backlinks resource template', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredResourceTemplates', 'post-backlinks')).toBe(true);
    });

    it('registers post-outlinks resource template', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredResourceTemplates', 'post-outlinks')).toBe(true);
    });

    it('registers post-media resource template', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredResourceTemplates', 'post-media')).toBe(true);
    });

    it('registers media-posts resource template', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredResourceTemplates', 'media-posts')).toBe(true);
    });

    it('registers media-image resource template', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredResourceTemplates', 'media-image')).toBe(true);
    });
  });

  describe('registered prompts', () => {
    it('registers draft-blog-post prompt', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredPrompts', 'draft-blog-post')).toBe(true);
    });

    it('registers improve-media-metadata prompt', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredPrompts', 'improve-media-metadata')).toBe(true);
    });

    it('registers content-audit prompt', () => {
      const mcpServer = server.createMcpServer();
      expect(hasRegistered(mcpServer, '_registeredPrompts', 'content-audit')).toBe(true);
    });
  });

  describe('start and stop', () => {
    it('starts the server and returns a port', async () => {
      const port = await server.start(0);
      expect(port).toBeGreaterThan(0);
      await server.stop();
    });

    it('stop is idempotent', async () => {
      await server.start(0);
      await server.stop();
      await expect(server.stop()).resolves.toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('cleans up proposals and stops the server', async () => {
      server.proposalStore.create('draftPost', { postId: 'test' });
      await server.start(0);
      await server.cleanup();
      expect(server.proposalStore.getAll()).toHaveLength(0);
    });
  });

  describe('accept_proposal', () => {
    it('accepts a draftPost proposal by publishing', async () => {
      mockPostEngine.publishPost.mockResolvedValue({
        id: 'post-1', title: 'Test', slug: 'test', content: '', status: 'published',
        tags: [], categories: [], createdAt: new Date(), updatedAt: new Date(), publishedAt: new Date(),
      });

      const proposalId = server.proposalStore.create('draftPost', { postId: 'post-1' });
      const result = await server.acceptProposal(proposalId);
      expect(result.success).toBe(true);
      expect(mockPostEngine.publishPost).toHaveBeenCalledWith('post-1');
      expect(server.proposalStore.get(proposalId)).toBeUndefined();
    });

    it('accepts a proposeScript proposal by creating script', async () => {
      const proposalId = server.proposalStore.create('proposeScript', {
        title: 'My Script', kind: 'macro', content: 'print("hello")',
      });
      const result = await server.acceptProposal(proposalId);
      expect(result.success).toBe(true);
      expect(mockScriptEngine.createScript).toHaveBeenCalledWith({
        title: 'My Script', kind: 'macro', content: 'print("hello")',
      });
      expect(server.proposalStore.get(proposalId)).toBeUndefined();
    });

    it('accepts a proposeTemplate proposal by creating template', async () => {
      const proposalId = server.proposalStore.create('proposeTemplate', {
        title: 'My Template', kind: 'post', content: '<h1>{{ title }}</h1>',
      });
      const result = await server.acceptProposal(proposalId);
      expect(result.success).toBe(true);
      expect(mockTemplateEngine.createTemplate).toHaveBeenCalledWith({
        title: 'My Template', kind: 'post', content: '<h1>{{ title }}</h1>',
      });
    });

    it('accepts a proposeMediaMetadata proposal by updating media', async () => {
      mockMediaEngine.updateMedia.mockResolvedValue({ id: 'media-1' });
      const proposalId = server.proposalStore.create('proposeMediaMetadata', {
        mediaId: 'media-1', changes: { alt: 'New alt text' },
      });
      const result = await server.acceptProposal(proposalId);
      expect(result.success).toBe(true);
      expect(mockMediaEngine.updateMedia).toHaveBeenCalledWith('media-1', { alt: 'New alt text' });
    });

    it('accepts a proposePostMetadata proposal by updating post', async () => {
      mockPostEngine.updatePost.mockResolvedValue({ id: 'post-1' });
      const proposalId = server.proposalStore.create('proposePostMetadata', {
        postId: 'post-1', changes: { title: 'Updated Title' },
      });
      const result = await server.acceptProposal(proposalId);
      expect(result.success).toBe(true);
      expect(mockPostEngine.updatePost).toHaveBeenCalledWith('post-1', { title: 'Updated Title' });
    });

    it('returns failure for non-existent proposal', async () => {
      const result = await server.acceptProposal('non-existent');
      expect(result.success).toBe(false);
    });
  });

  describe('discard_proposal', () => {
    it('discards a draftPost proposal by deleting the post', async () => {
      const proposalId = server.proposalStore.create('draftPost', { postId: 'post-1' });
      const result = await server.discardProposal(proposalId);
      expect(result.success).toBe(true);
      expect(mockPostEngine.deletePost).toHaveBeenCalledWith('post-1');
      expect(server.proposalStore.get(proposalId)).toBeUndefined();
    });

    it('discards a proposeScript proposal by removing from store', async () => {
      const proposalId = server.proposalStore.create('proposeScript', { title: 'Script' });
      const result = await server.discardProposal(proposalId);
      expect(result.success).toBe(true);
      expect(server.proposalStore.get(proposalId)).toBeUndefined();
    });

    it('returns failure for non-existent proposal', async () => {
      const result = await server.discardProposal('non-existent');
      expect(result.success).toBe(false);
    });
  });

  // ── Tool annotations ────────────────────────────────────────────────

  describe('tool annotations', () => {
    function getToolAnnotations(toolName: string): Record<string, unknown> | undefined {
      const mcpServer = server.createMcpServer();
      const tool = (mcpServer as Record<string, Record<string, { annotations?: Record<string, unknown> }>>)._registeredTools[toolName];
      return tool?.annotations;
    }

    it('search_posts has readOnlyHint true', () => {
      const annotations = getToolAnnotations('search_posts');
      expect(annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
    });

    it('draft_post has readOnlyHint false, destructiveHint false', () => {
      const annotations = getToolAnnotations('draft_post');
      expect(annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    });

    it('propose_script has readOnlyHint false, destructiveHint false', () => {
      const annotations = getToolAnnotations('propose_script');
      expect(annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    });

    it('propose_template has readOnlyHint false, destructiveHint false', () => {
      const annotations = getToolAnnotations('propose_template');
      expect(annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    });

    it('propose_media_metadata has readOnlyHint false, destructiveHint false', () => {
      const annotations = getToolAnnotations('propose_media_metadata');
      expect(annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    });

    it('propose_post_metadata has readOnlyHint false, destructiveHint false', () => {
      const annotations = getToolAnnotations('propose_post_metadata');
      expect(annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    });

    it('accept_proposal has readOnlyHint false, destructiveHint false, idempotentHint true', () => {
      const annotations = getToolAnnotations('accept_proposal');
      expect(annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    });

    it('discard_proposal has readOnlyHint false, destructiveHint true, idempotentHint true', () => {
      const annotations = getToolAnnotations('discard_proposal');
      expect(annotations).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    });
  });

  // ── Resource handler behavior ───────────────────────────────────────

  describe('resource handlers', () => {
    function getResource(mcpServer: unknown, uri: string) {
      return (mcpServer as Record<string, Record<string, { readCallback: (...args: unknown[]) => Promise<unknown> }>>)._registeredResources[uri];
    }

    function getResourceTemplate(mcpServer: unknown, name: string) {
      return (mcpServer as Record<string, Record<string, { readCallback: (...args: unknown[]) => Promise<unknown> }>>)._registeredResourceTemplates[name];
    }

    it('bds://posts calls getAllPosts and returns JSON', async () => {
      const postsData = { items: [{ id: 'p1', title: 'Hello' }], hasMore: false, total: 1 };
      mockPostEngine.getAllPosts.mockResolvedValue(postsData);
      const mcpServer = server.createMcpServer();
      const resource = getResource(mcpServer, 'bds://posts');
      const result = await resource.readCallback(new URL('bds://posts'), {}) as { contents: Array<{ text: string }> };
      expect(mockPostEngine.getAllPosts).toHaveBeenCalled();
      expect(JSON.parse(result.contents[0].text)).toEqual(postsData);
    });

    it('bds://stats calls getBlogStats and returns JSON', async () => {
      const stats = { totalPosts: 42 };
      mockPostEngine.getBlogStats.mockResolvedValue(stats);
      const mcpServer = server.createMcpServer();
      const resource = getResource(mcpServer, 'bds://stats');
      const result = await resource.readCallback(new URL('bds://stats'), {}) as { contents: Array<{ text: string }> };
      expect(JSON.parse(result.contents[0].text)).toEqual(stats);
    });

    it('bds://posts/{id} calls getPost with correct id', async () => {
      const post = { id: 'post-1', title: 'Test' };
      mockPostEngine.getPost.mockResolvedValue(post);
      const mcpServer = server.createMcpServer();
      const tpl = getResourceTemplate(mcpServer, 'post');
      const result = await tpl.readCallback(new URL('bds://posts/post-1'), { id: 'post-1' }, {}) as { contents: Array<{ text: string }> };
      expect(mockPostEngine.getPost).toHaveBeenCalledWith('post-1');
      expect(JSON.parse(result.contents[0].text)).toEqual(post);
    });

    it('bds://posts/{id}/media calls getLinkedMediaDataForPost', async () => {
      const linkedMedia = [{ id: 'm1', filename: 'photo.jpg' }];
      mockPostMediaEngine.getLinkedMediaDataForPost.mockResolvedValue(linkedMedia);
      const mcpServer = server.createMcpServer();
      const tpl = getResourceTemplate(mcpServer, 'post-media');
      const result = await tpl.readCallback(new URL('bds://posts/p1/media'), { id: 'p1' }, {}) as { contents: Array<{ text: string }> };
      expect(mockPostMediaEngine.getLinkedMediaDataForPost).toHaveBeenCalledWith('p1');
      expect(JSON.parse(result.contents[0].text)).toEqual(linkedMedia);
    });

    it('bds://media/{id}/image returns thumbnail blob for images', async () => {
      mockMediaEngine.getMedia.mockResolvedValue({ id: 'img-1', mimeType: 'image/jpeg', filename: 'photo.jpg' });
      mockMediaEngine.getThumbnailDataUrl.mockResolvedValue('data:image/webp;base64,AAAA');
      const mcpServer = server.createMcpServer();
      const tpl = getResourceTemplate(mcpServer, 'media-image');
      const result = await tpl.readCallback(new URL('bds://media/img-1/image'), { id: 'img-1' }, {}) as { contents: Array<{ mimeType: string; blob: string }> };
      expect(mockMediaEngine.getThumbnailDataUrl).toHaveBeenCalledWith('img-1', 'medium');
      expect(result.contents[0].mimeType).toBe('image/webp');
      expect(result.contents[0].blob).toBe('AAAA');
    });

    it('bds://media/{id}/image returns text error for non-images', async () => {
      mockMediaEngine.getMedia.mockResolvedValue({ id: 'doc-1', mimeType: 'application/pdf', filename: 'doc.pdf' });
      const mcpServer = server.createMcpServer();
      const tpl = getResourceTemplate(mcpServer, 'media-image');
      const result = await tpl.readCallback(new URL('bds://media/doc-1/image'), { id: 'doc-1' }, {}) as { contents: Array<{ mimeType: string; text: string }> };
      expect(result.contents[0].mimeType).toBe('text/plain');
      expect(result.contents[0].text).toContain('Not an image');
    });

    it('bds://media/{id}/image returns text error when thumbnail unavailable', async () => {
      mockMediaEngine.getMedia.mockResolvedValue({ id: 'img-2', mimeType: 'image/png', filename: 'pic.png' });
      mockMediaEngine.getThumbnailDataUrl.mockResolvedValue(null);
      const mcpServer = server.createMcpServer();
      const tpl = getResourceTemplate(mcpServer, 'media-image');
      const result = await tpl.readCallback(new URL('bds://media/img-2/image'), { id: 'img-2' }, {}) as { contents: Array<{ mimeType: string; text: string }> };
      expect(result.contents[0].text).toContain('Thumbnail not available');
    });
  });

  // ── Tool handler behavior ──────────────────────────────────────────

  describe('tool handlers', () => {
    function getTool(mcpServer: unknown, name: string) {
      return (mcpServer as Record<string, Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>>)._registeredTools[name];
    }

    it('search_posts with query only calls searchPosts', async () => {
      const searchResults = [{ id: 'p1', title: 'Found', slug: 'found' }];
      mockPostEngine.searchPosts.mockResolvedValue(searchResults);
      const mcpServer = server.createMcpServer();
      const tool = getTool(mcpServer, 'search_posts');
      const result = await tool.handler({ query: 'test' }, {}) as { content: Array<{ text: string }> };
      expect(mockPostEngine.searchPosts).toHaveBeenCalledWith('test');
      expect(JSON.parse(result.content[0].text)).toEqual(searchResults);
    });

    it('search_posts with filters only calls getPostsFiltered', async () => {
      const filtered = [{ id: 'p2', title: 'Filtered' }];
      mockPostEngine.getPostsFiltered.mockResolvedValue(filtered);
      const mcpServer = server.createMcpServer();
      const tool = getTool(mcpServer, 'search_posts');
      const result = await tool.handler({ category: 'tech', status: 'published' }, {}) as { content: Array<{ text: string }> };
      expect(mockPostEngine.getPostsFiltered).toHaveBeenCalledWith({ categories: ['tech'], status: 'published' });
      expect(JSON.parse(result.content[0].text)).toEqual(filtered);
    });

    it('search_posts with query + filters uses getPostsFiltered and client-side text filter', async () => {
      const allFiltered = [
        { id: 'p1', title: 'TypeScript Guide', content: 'Learn TS', excerpt: '' },
        { id: 'p2', title: 'Python Guide', content: 'Learn Python', excerpt: '' },
      ];
      mockPostEngine.getPostsFiltered.mockResolvedValue(allFiltered);
      const mcpServer = server.createMcpServer();
      const tool = getTool(mcpServer, 'search_posts');
      const result = await tool.handler({ query: 'typescript', category: 'tech' }, {}) as { content: Array<{ text: string }> };
      expect(mockPostEngine.getPostsFiltered).toHaveBeenCalled();
      expect(mockPostEngine.searchPosts).not.toHaveBeenCalled();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].title).toBe('TypeScript Guide');
    });

    it('draft_post creates a draft and stores proposal', async () => {
      const createdPost = { id: 'new-post', title: 'Draft Title', status: 'draft' };
      mockPostEngine.createPost.mockResolvedValue(createdPost);
      const mcpServer = server.createMcpServer();
      const tool = getTool(mcpServer, 'draft_post');
      const result = await tool.handler({ title: 'Draft Title', content: '# Hello' }, {}) as { content: Array<{ text: string }> };
      expect(mockPostEngine.createPost).toHaveBeenCalledWith(expect.objectContaining({ title: 'Draft Title', content: '# Hello', status: 'draft' }));
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.proposalId).toBeTruthy();
      expect(parsed.post).toEqual(createdPost);
      // Verify proposal is in the store
      const proposal = server.proposalStore.get(parsed.proposalId);
      expect(proposal).toBeDefined();
      expect(proposal!.type).toBe('draftPost');
      expect(proposal!.data.postId).toBe('new-post');
    });

    it('propose_script stores proposal in ProposalStore', async () => {
      const mcpServer = server.createMcpServer();
      const tool = getTool(mcpServer, 'propose_script');
      const result = await tool.handler({ title: 'My Script', kind: 'macro', content: 'print("hi")' }, {}) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.proposalId).toBeTruthy();
      const proposal = server.proposalStore.get(parsed.proposalId);
      expect(proposal).toBeDefined();
      expect(proposal!.type).toBe('proposeScript');
      expect(proposal!.data.content).toBe('print("hi")');
    });

    it('propose_media_metadata loads current media and stores proposal', async () => {
      const currentMedia = { id: 'img-1', alt: 'Old alt', title: 'Old title' };
      mockMediaEngine.getMedia.mockResolvedValue(currentMedia);
      const mcpServer = server.createMcpServer();
      const tool = getTool(mcpServer, 'propose_media_metadata');
      const result = await tool.handler({ mediaId: 'img-1', alt: 'New alt' }, {}) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.current).toEqual(currentMedia);
      expect(parsed.proposed).toEqual({ alt: 'New alt' });
      const proposal = server.proposalStore.get(parsed.proposalId);
      expect(proposal!.type).toBe('proposeMediaMetadata');
      expect(proposal!.data.mediaId).toBe('img-1');
    });

    it('propose_post_metadata loads current post and stores proposal', async () => {
      const currentPost = { id: 'post-1', title: 'Old Title', excerpt: 'Old excerpt' };
      mockPostEngine.getPost.mockResolvedValue(currentPost);
      const mcpServer = server.createMcpServer();
      const tool = getTool(mcpServer, 'propose_post_metadata');
      const result = await tool.handler({ postId: 'post-1', title: 'New Title' }, {}) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.current).toEqual(currentPost);
      expect(parsed.proposed).toEqual({ title: 'New Title' });
      const proposal = server.proposalStore.get(parsed.proposalId);
      expect(proposal!.type).toBe('proposePostMetadata');
    });
  });

  // ── Prompt handler behavior ────────────────────────────────────────

  describe('prompt handlers', () => {
    function getPrompt(mcpServer: unknown, name: string) {
      return (mcpServer as Record<string, Record<string, { callback: (...args: unknown[]) => Promise<unknown> }>>)._registeredPrompts[name];
    }

    it('draft-blog-post returns messages with topic', async () => {
      const mcpServer = server.createMcpServer();
      const prompt = getPrompt(mcpServer, 'draft-blog-post');
      const result = await prompt.callback({ topic: 'AI Safety' }, {}) as { messages: Array<{ role: string; content: { type: string; text: string } }> };
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content.text).toContain('AI Safety');
      expect(result.messages[0].content.text).toContain('draft_post');
    });

    it('improve-media-metadata returns messages with scope', async () => {
      const mcpServer = server.createMcpServer();
      const prompt = getPrompt(mcpServer, 'improve-media-metadata');
      const result = await prompt.callback({ scope: 'missing-alt' }, {}) as { messages: Array<{ role: string; content: { type: string; text: string } }> };
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content.text).toContain('missing alt text');
    });

    it('content-audit returns messages with category', async () => {
      const mcpServer = server.createMcpServer();
      const prompt = getPrompt(mcpServer, 'content-audit');
      const result = await prompt.callback({ category: 'tech' }, {}) as { messages: Array<{ role: string; content: { type: string; text: string } }> };
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content.text).toContain('tech');
    });

    it('content-audit without category reviews all posts', async () => {
      const mcpServer = server.createMcpServer();
      const prompt = getPrompt(mcpServer, 'content-audit');
      const result = await prompt.callback({}, {}) as { messages: Array<{ role: string; content: { type: string; text: string } }> };
      expect(result.messages[0].content.text).toContain('all posts');
    });
  });
});
