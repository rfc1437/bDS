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

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = createDependencies();
    deps = mocks.deps;
    mockPostEngine = mocks.mockPostEngine;
    mockMediaEngine = mocks.mockMediaEngine;
    mockScriptEngine = mocks.mockScriptEngine;
    mockTemplateEngine = mocks.mockTemplateEngine;
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
});
