# Chapter 3: MCP Server — Agent-Assisted Content Creation

## Summary

Run a standalone MCP server on its own port (default 4124). External AI agents connect via Streamable HTTP at `/mcp`. Read access is open; writes go through user-reviewable proposals with MCP App review UIs powered by `@modelcontextprotocol/ext-apps`.

## Dependencies

- `@modelcontextprotocol/sdk` (v1.27+) — `McpServer`, `StreamableHTTPServerTransport`, `createMcpExpressApp`
- `@modelcontextprotocol/ext-apps` (v1.1+) — `registerAppTool`, `registerAppResource`, `RESOURCE_MIME_TYPE` for interactive review UIs rendered inline in compliant hosts (Claude, ChatGPT, VS Code, etc.)
- `express` / `cors` — pulled in transitively by the SDK; used by `createMcpExpressApp`

zod v4 already in project satisfies peer dep requirements.

## Architecture

```
PreviewServer (HTTP on 127.0.0.1:4123)      ← unchanged
  └── /* → Blog preview routes

MCPServer (HTTP on 127.0.0.1:4124)           ← NEW, standalone
  └── /mcp → Streamable HTTP (POST + GET/DELETE)
       ├── tools, resources, prompts
       └── ui:// resources → MCP App review Views (via ext-apps)
```

The MCP SDK provides `StreamableHTTPServerTransport` for HTTP handling. We use Node's `http.createServer` directly with stateless mode (new `McpServer` per request) to avoid session management complexity and the Express dependency.

`MCPServer` is a new engine class that owns the `McpServer` factory, tool/resource/prompt registration, and the `ProposalStore`. It runs independently of PreviewServer.

## Implementation Steps

### Step 1: Install deps
```
npm install @modelcontextprotocol/sdk @modelcontextprotocol/ext-apps
```

### Step 2: ProposalStore (`src/main/engine/ProposalStore.ts`)
- `Map<string, Proposal>` with TTL (30 min default)
- `create(type, data) → id`, `get(id)`, `remove(id)`, `cleanup()`
- Draft posts tracked by mapping proposalId → 'draftPost' (actual data in DB)
- Periodic cleanup via `setInterval`

### Step 3: MCPServer engine (`src/main/engine/MCPServer.ts`)
- Constructor: inject engine getters (PostEngine, MediaEngine, ScriptEngine, TemplateEngine, MetaEngine, PostMediaEngine, TagEngine)
- `createServer()` → factory that instantiates a fresh `McpServer` and registers all tools/resources/prompts (stateless mode — one per request)
- `start(port)` → uses `http.createServer` + `StreamableHTTPServerTransport` in stateless mode, listens on `127.0.0.1:port`, validates Origin header
- `stop()` → close HTTP server
- `cleanup()` → discard proposals, stop intervals, stop server
- Singleton pattern with `getMCPServer()` getter

### Step 4: Resources (read-only data)
Register MCP resources mapping to existing engine methods:

| Resource URI | Engine Method |
|---|---|
| `bds://posts` | PostEngine.getAllPosts() |
| `bds://posts/{id}` | PostEngine.getPost(id) |
| `bds://media` | MediaEngine.getAllMedia() |
| `bds://media/{id}` | MediaEngine.getMedia(id) |
| `bds://tags` | PostEngine.getTagsWithCounts() |
| `bds://categories` | PostEngine.getCategoriesWithCounts() |
| `bds://stats` | PostEngine.getBlogStats() + MediaEngine |
| `bds://posts/{id}/backlinks` | PostEngine.getLinkedBy(id) |
| `bds://posts/{id}/outlinks` | PostEngine.getLinksTo(id) |
| `bds://posts/{id}/media` | PostMediaEngine.getLinkedMediaDataForPost(id) |
| `bds://media/{id}/posts` | PostMediaEngine.getLinkedPostsForMedia(id) |
| `bds://media/{id}/image` | MediaEngine.getThumbnailDataUrl(id, 'medium') |

### Step 5: Read tools
- `search_posts` — annotations: `{ readOnlyHint: true, openWorldHint: false }`
  - Wraps PostEngine.searchPosts() with filter args (query, category, tags, year/month, offset, limit)

### Step 6: Proposal tools (with MCP App Views)
Each proposal tool uses `registerAppTool` from `@modelcontextprotocol/ext-apps/server` to link the tool to a `ui://` resource. The host renders the review View inline.

Each review View is a bundled HTML page (built with Vite `vite-plugin-singlefile` into a single self-contained HTML) that uses the `App` class from `@modelcontextprotocol/ext-apps` for bidirectional communication with the host.

| Tool | Action | `ui://` Resource | Accept | Discard |
|---|---|---|---|---|
| `draft_post` | PostEngine.createPost(draft) | `ui://bds/review-post` | publishPost() | deletePost() |
| `propose_script` | Store in ProposalStore | `ui://bds/review-script` | ScriptEngine.createScript() | remove from store |
| `propose_template` | Store in ProposalStore | `ui://bds/review-template` | TemplateEngine.createTemplate() | remove from store |
| `propose_media_metadata` | Store diff in ProposalStore | `ui://bds/review-metadata` | MediaEngine.updateMedia() | remove from store |
| `propose_post_metadata` | Store diff in ProposalStore | `ui://bds/review-metadata` | PostEngine.updatePost() | remove from store |

Resource registration uses `registerAppResource` from `@modelcontextprotocol/ext-apps/server`. Each resource returns a bundled HTML string with `mimeType: RESOURCE_MIME_TYPE`.

### Step 7: Accept/discard tools
- `accept_proposal({ proposalId })` — dispatch by type, commit change
- `discard_proposal({ proposalId })` — dispatch by type, clean up
- Registered via `registerAppTool` with `visibility: ["app"]` (app-only, hidden from agent LLM)
- Annotations: idempotentHint: true

### Step 8: MCP Prompts
- `draft-blog-post(topic?, category?)` — structured prompt guiding agent to read context and draft
- `improve-media-metadata(scope)` — guide agent to review media and propose alt/caption
- `content-audit(category?)` — guide agent to review posts for quality

### Step 9: MCP App Review Views (`src/main/mcp-apps/`)
Four View HTML pages, each using vanilla JS + `App` class from `@modelcontextprotocol/ext-apps`:

- `review-post.html` — title, metadata, rendered markdown, word count; accept/discard buttons call `app.callServerTool()` → `accept_proposal`/`discard_proposal`
- `review-script.html` — title, syntax-highlighted Python, validation status
- `review-template.html` — title, kind badge, syntax-highlighted Liquid, validation
- `review-metadata.html` — side-by-side diff (current vs proposed)

Each View:
1. Receives tool result data from host via `app.ontoolresult`
2. Renders focused review interface
3. On accept/discard: calls `app.callServerTool({ name: 'accept_proposal' | 'discard_proposal', arguments: { proposalId } })`
4. Updates UI to show outcome

Build step: Review Views are inline HTML template strings in `mcp-views.ts` — no separate build step needed.

### Step 10: Lifecycle in main.ts
- MCPServer starts independently alongside PreviewServer during app init
- On `before-quit`: call `MCPServer.cleanup()` (stops server + discards proposals)

### Step 11: Update TODO.md
- Remove stdio references per user request
- Mark standalone server approach in the doc

### Step 12: Tests (TDD per CLAUDE.md)
Each step above is preceded by failing tests:

- **ProposalStore**: create/get/remove, TTL expiry, cleanup
- **MCPServer tools**: tool definitions (names, schemas, annotations)
- **MCPServer resources**: URI resolution, data returned
- **MCPServer prompts**: message structure, arguments
- **Accept/discard**: draft_post→accept publishes, propose_script→discard removes
- **Integration**: HTTP POST to `http://127.0.0.1:{port}/mcp`, tool call, response format
- **Review Views**: `registerAppResource` returns valid HTML with `RESOURCE_MIME_TYPE`

## Key Files

| File | Purpose |
|---|---|
| `src/main/engine/ProposalStore.ts` | NEW — in-memory proposal storage |
| `src/main/engine/MCPServer.ts` | NEW — standalone MCP server engine |
| `src/main/engine/mcp-views.ts` | NEW — inline review View HTML templates |
| `tests/engine/mcp-views.test.ts` | NEW |
| `src/main/main.ts` | MODIFY — start/cleanup MCPServer |
| `tests/engine/ProposalStore.test.ts` | NEW |
| `tests/engine/MCPServer.test.ts` | NEW |
| `tests/engine/MCPServer.integration.test.ts` | NEW |
| `TODO.md` | MODIFY — remove stdio, update transport section |

## Verification

1. `npm test` — all tests pass (new + existing)
2. `npm run build` — clean build
3. Manual: start app, connect Claude Code or curl to `http://127.0.0.1:4124/mcp` with MCP protocol, verify tool listing and resource reading
4. Manual: call `draft_post` tool, verify draft created, review View renders inline in host, accept publishes post

## Unresolved Questions

None — scope is clear: standalone HTTP server on port 4124, MCP App Views via `@modelcontextprotocol/ext-apps`, no settings UI.
