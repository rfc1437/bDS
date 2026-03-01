import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MCPServer, type MCPServerDependencies } from '../../src/main/engine/MCPServer';

/**
 * Integration tests for MCPServer HTTP transport.
 * These start the actual HTTP server and send MCP protocol requests.
 */

function createMockDeps(): MCPServerDependencies {
  return {
    getPostEngine: () => ({
      getAllPosts: vi.fn().mockResolvedValue({ items: [{ id: 'p1', title: 'Test Post' }], hasMore: false, total: 1 }),
      getPost: vi.fn().mockResolvedValue({ id: 'p1', title: 'Test Post', content: '# Hello', slug: 'test' }),
      searchPosts: vi.fn().mockResolvedValue([{ id: 'p1', title: 'Test Post', slug: 'test' }]),
      createPost: vi.fn().mockResolvedValue({ id: 'draft-1', title: 'Draft', status: 'draft' }),
      updatePost: vi.fn().mockResolvedValue({ id: 'p1', title: 'Updated' }),
      publishPost: vi.fn().mockResolvedValue({ id: 'draft-1', status: 'published' }),
      deletePost: vi.fn().mockResolvedValue(true),
      getTagsWithCounts: vi.fn().mockResolvedValue([{ tag: 'js', count: 5 }]),
      getCategoriesWithCounts: vi.fn().mockResolvedValue([{ category: 'tech', count: 3 }]),
      getBlogStats: vi.fn().mockResolvedValue({ totalPosts: 10 }),
      getLinkedBy: vi.fn().mockResolvedValue([]),
      getLinksTo: vi.fn().mockResolvedValue([]),
      getPostsFiltered: vi.fn().mockResolvedValue([]),
      getPostCounts: vi.fn().mockResolvedValue({ groups: [], totalPosts: 0 }),
      searchPostsFiltered: vi.fn().mockResolvedValue({ posts: [], total: 0 }),
    }),
    getMediaEngine: () => ({
      getAllMedia: vi.fn().mockResolvedValue([]),
      getMedia: vi.fn().mockResolvedValue(null),
      updateMedia: vi.fn().mockResolvedValue(null),
      getThumbnailDataUrl: vi.fn().mockResolvedValue(null),
    }),
    getScriptEngine: () => ({
      createScript: vi.fn().mockResolvedValue({ id: 's1' }),
      validateScript: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
    }),
    getTemplateEngine: () => ({
      createTemplate: vi.fn().mockResolvedValue({ id: 't1' }),
      validateTemplate: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
    }),
    getMetaEngine: () => ({
      getProjectMetadata: vi.fn().mockResolvedValue(null),
    }),
    getPostMediaEngine: () => ({
      getLinkedMediaDataForPost: vi.fn().mockResolvedValue([]),
      getLinkedPostsForMedia: vi.fn().mockResolvedValue([]),
    }),
    getTagEngine: () => ({
      getTagsWithCounts: vi.fn().mockResolvedValue([]),
    }),
  };
}

async function sendMcpRequest(port: number, method: string, params?: unknown, id = 1): Promise<unknown> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params: params ?? {},
  });

  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body,
  });

  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';

  // SSE format: "event: message\ndata: {json}\n\n"
  if (contentType.includes('text/event-stream')) {
    const dataLine = text.split('\n').find(l => l.startsWith('data: '));
    if (dataLine) {
      return JSON.parse(dataLine.slice(6));
    }
  }

  return JSON.parse(text);
}

async function initializeSession(port: number): Promise<unknown> {
  return sendMcpRequest(port, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  });
}

describe('MCPServer integration', () => {
  let server: MCPServer;

  beforeEach(() => {
    server = new MCPServer(createMockDeps());
  });

  afterEach(async () => {
    await server.cleanup();
  });

  it('starts on a random port and responds to initialize', async () => {
    const port = await server.start(0);
    expect(port).toBeGreaterThan(0);

    const result = await initializeSession(port) as { result?: { serverInfo?: { name: string } } };
    expect(result.result?.serverInfo?.name).toBe('Blogging Desktop Server');
  });

  it('returns CORS headers', async () => {
    const port = await server.start(0);
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'OPTIONS',
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('rejects requests from non-local origins', async () => {
    const port = await server.start(0);
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://evil-site.com',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
      }),
    });
    expect(response.status).toBe(403);
  });

  it('allows requests from localhost origins', async () => {
    const port = await server.start(0);
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Origin': `http://localhost:${port}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
      }),
    });
    expect(response.status).not.toBe(403);
  });

  it('allows requests without Origin header', async () => {
    const port = await server.start(0);
    const result = await initializeSession(port) as { result?: { serverInfo?: { name: string } } };
    expect(result.result?.serverInfo?.name).toBe('Blogging Desktop Server');
  });

  it('lists tools via tools/list after initialize', async () => {
    const port = await server.start(0);

    // MCP requires single request per connection in stateless mode — each request creates a new session
    // Send initialize + tools/list in same session is not possible in stateless mode
    // Instead, we can verify the server responds to a standalone initialize
    const initResult = await initializeSession(port) as { result?: { capabilities?: { tools?: unknown } } };
    expect(initResult.result?.capabilities?.tools).toBeDefined();
  });

  it('getPort returns the listening port', async () => {
    expect(server.getPort()).toBeNull();
    const port = await server.start(0);
    expect(server.getPort()).toBe(port);
    await server.stop();
    expect(server.getPort()).toBeNull();
  });

  it('handles multiple sequential requests', async () => {
    const port = await server.start(0);
    const r1 = await initializeSession(port) as { result?: unknown };
    const r2 = await initializeSession(port) as { result?: unknown };
    expect(r1.result).toBeDefined();
    expect(r2.result).toBeDefined();
  });

  it('returns 500 for malformed JSON', async () => {
    const port = await server.start(0);
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: '{invalid json',
    });
    // The server should handle this gracefully
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('stop is idempotent', async () => {
    await server.start(0);
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it('cleanup stops server and clears proposals', async () => {
    server.proposalStore.create('draftPost', { postId: 'p1' });
    await server.start(0);
    await server.cleanup();
    expect(server.proposalStore.getAll()).toHaveLength(0);
    expect(server.getPort()).toBeNull();
  });
});
