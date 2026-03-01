# AI Integration Rewrite

## Goal

Delete `OpenCodeManager.ts` (2,745 lines) and `streaming.ts` (621 lines). Replace all AI plumbing with **Vercel AI SDK v6**. Multi-provider from day 1.

## Principles

- AI SDK owns all protocol work: streaming, retry, token tracking, message format, tool loop
- We own: tools, prompts, persistence, key management, A2UI, model catalog
- No provider-specific code in business logic — AI SDK abstracts providers
- Zod schemas shared between AI SDK `tool()` and MCP server — single source of truth
- Provider = configuration, not code. Adding Anthropic Direct or OpenAI Direct = adding a config entry

---

## Architecture

```
src/main/engine/
├── ai/
│   ├── providers.ts        # Provider registry, model resolution
│   ├── blog-tools.ts       # 16 data tools (shared with MCP)
│   ├── a2ui-tools.ts       # 7 render_* tools
│   ├── chat.ts             # sendMessage, abort, title gen (streamText)
│   └── tasks.ts            # One-shot: taxonomy, image analysis (generateText)
├── MCPServer.ts            # Imports blog-tools.ts — zero duplication
├── ChatEngine.ts           # Unchanged
├── ModelCatalogEngine.ts   # Unchanged
├── SecureKeyStore.ts       # Extended for multi-provider keys
└── a2ui/                   # Unchanged
```

### DELETE entirely

| File | Lines | Why |
|------|-------|-----|
| `OpenCodeManager.ts` | 2,745 | Replaced by `ai/` modules |
| `streaming.ts` | 621 | AI SDK providers handle all streaming |
| MCPServer duplicated tools | ~165 | Uses `blog-tools.ts` |
| **Total** | **~3,530** | |

---

## Provider System

### Dependencies

```
ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/mistral
```

### Provider types

| Provider | SDK package | baseURL | Models | Key |
|----------|-------------|---------|--------|-----|
| OpenCode (gateway) | `@ai-sdk/anthropic` + `@ai-sdk/openai` | Zen URLs | claude\*, gpt\*, gemini\*, o3\*, o4\* | OpenCode key |
| Mistral (direct) | `@ai-sdk/mistral` | default | mistral\*, codestral\*, pixtral\* | Mistral key |
| Anthropic (direct) | `@ai-sdk/anthropic` | default | claude\* | Anthropic key |
| OpenAI (direct) | `@ai-sdk/openai` | default | gpt\*, o3\*, o4\* | OpenAI key |

Start with OpenCode + Mistral. Adding direct Anthropic/OpenAI = registering a new provider entry, zero code changes.

### OpenCode is a gateway, not a provider

OpenCode Zen exposes two API-compatible endpoints behind one key:
- `https://opencode.ai/zen/v1/messages` — Anthropic Messages API
- `https://opencode.ai/zen/v1/chat/completions` — OpenAI Chat Completions API

We use standard `@ai-sdk/anthropic` and `@ai-sdk/openai` with `baseURL` override. No community provider needed — the existing one (`ai-sdk-provider-opencode-sdk`) wraps the OpenCode CLI, not Zen.

### `ai/providers.ts`

Uses `createProviderRegistry` + `customProvider` with `fallbackProvider`. Model IDs carry a provider prefix (`opencode:claude-sonnet-4-5`, `mistral:mistral-large-latest`) — the prefix IS the routing. No static model maps.

```ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createMistral } from '@ai-sdk/mistral';
import { createProviderRegistry, customProvider } from 'ai';

const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';

function createOpenCodeGateway(apiKey: string) {
  const anthropicProvider = createAnthropic({ baseURL: ZEN_BASE_URL, apiKey });
  // CRITICAL: .chat() = Chat Completions API. Default = Responses API (incompatible with Zen).
  const openaiProvider = createOpenAI({ baseURL: ZEN_BASE_URL, apiKey });

  return customProvider({
    fallbackProvider: {
      languageModel: (modelId: string) => {
        if (modelId.startsWith('claude')) return anthropicProvider(modelId);
        return openaiProvider.chat(modelId);  // .chat() required for Chat Completions
      },
    },
  });
}

function buildRegistry(keys: { opencode?: string; mistral?: string }) {
  const providers: Record<string, any> = {};

  if (keys.opencode) providers.opencode = createOpenCodeGateway(keys.opencode);
  if (keys.mistral) providers.mistral = createMistral({ apiKey: keys.mistral });
  // Future direct providers: just add more entries
  // if (keys.anthropic) providers.anthropic = createAnthropic({ apiKey: keys.anthropic });

  return createProviderRegistry(providers);
}

// Usage: registry.languageModel('opencode:claude-sonnet-4-5')
// Usage: registry.languageModel('mistral:mistral-large-latest')
```

Gateway (OpenCode) routes `claude*` → Anthropic Messages API, everything else → OpenAI Chat Completions API. Direct providers (Mistral) are 1:1. Adding a new provider = one config entry, zero code changes.

---

## Modules

### `ai/blog-tools.ts` — 16 data tools

Single source of truth. AI SDK `tool()` + Zod. Shared between chat and MCP.

```ts
export function createBlogTools(deps: BlogToolDeps) {
  return {
    check_term: tool({
      description: 'Check whether a term exists as a category, tag, or both',
      inputSchema: z.object({ term: z.string() }),
      execute: async ({ term }) => { /* PostEngine queries */ },
    }),
    search_posts: tool({ ... }),
    read_post: tool({ ... }),
    list_posts: tool({ ... }),
    get_media: tool({ ... }),
    list_media: tool({ ... }),
    update_post_metadata: tool({ ... }),
    update_media_metadata: tool({ ... }),
    list_tags: tool({ ... }),
    list_categories: tool({ ... }),
    get_blog_stats: tool({ ... }),
    view_image: tool({
      // Uses toModelOutput() for multimodal result — works across all providers
      inputSchema: z.object({ media_id: z.number(), size: z.enum(['small','medium','large']) }),
      execute: async ({ media_id, size }) => ({ base64, mediaType, caption }),
      toModelOutput: ({ output }) => ({
        type: 'content',
        value: [
          { type: 'image', data: output.base64, mediaType: output.mediaType },
          { type: 'text', text: output.caption },
        ],
      }),
    }),
    get_post_backlinks: tool({ ... }),
    get_post_outlinks: tool({ ... }),
    get_post_media: tool({ ... }),
    get_media_posts: tool({ ... }),
  };
}

// Shared helper consumed by both tools and MCP
export function buildAmbiguityHints(...): Promise<string[]> { ... }
```

MCPServer integration: `createBlogTools(deps)` → extract schemas + handlers → register as MCP tools. Zero duplication.

### `ai/a2ui-tools.ts` — 7 render tools

```ts
export function createA2UITools() {
  return {
    render_chart: tool({ ... }),
    render_table: tool({ ... }),
    render_form: tool({ ... }),
    render_card: tool({ ... }),
    render_metric: tool({ ... }),
    render_list: tool({ ... }),
    render_tabs: tool({ ... }),
  };
}
```

A2UI message dispatch happens in `chat.ts` via `experimental_onToolCallFinish` — the tool itself just returns `{ success: true }`.

### `ai/chat.ts` — ChatService

The core. One `streamText()` call replaces both `sendAnthropicMessage()` and `sendOpenAIMessage()`.

```ts
import { streamText, stepCountIs } from 'ai';

class ChatService {
  private abortControllers = new Map<string, AbortController>();
  private tokenUsage = new Map<string, TokenUsage>();

  constructor(
    private chatEngine: ChatEngine,
    private providers: ProviderRegistry,
    private blogTools: ReturnType<typeof createBlogTools>,
    private a2uiTools: ReturnType<typeof createA2UITools>,
  ) {}

  async sendMessage(conversationId: string, content: string, callbacks: StreamCallbacks) {
    const conv = await this.chatEngine.getConversation(conversationId);
    const model = this.providers.getModel(conv.model);
    const ac = new AbortController();
    this.abortControllers.set(conversationId, ac);

    const result = streamText({
      model,
      system: await this.buildSystemPrompt(conv),
      messages: await this.loadMessages(conversationId),
      tools: { ...this.blogTools, ...this.a2uiTools },
      maxRetries: 3,
      stopWhen: stepCountIs(10),
      abortSignal: ac.signal,

      // Anthropic: server-side context management (replaces truncateToTokenBudget)
      providerOptions: {
        anthropic: {
          cacheControl: { type: 'ephemeral' },   // cache system + tools
          contextManagement: {
            edits: [
              { type: 'clear_tool_uses_20250919', trigger: { type: 'input_tokens', value: 50000 },
                keep: { type: 'tool_uses', value: 5 }, clearToolInputs: true },
              { type: 'compact_20260112', trigger: { type: 'input_tokens', value: 80000 },
                instructions: 'Summarize preserving editorial decisions and tool results.' },
            ],
          },
        },
      },

      // Non-Anthropic: simple message window
      prepareStep: async ({ messages }) => {
        if (messages.length > 30) return { messages: [messages[0], ...messages.slice(-15)] };
        return {};
      },

      onChunk: ({ chunk }) => {
        if (chunk.type === 'text') callbacks.onDelta?.(chunk.text);
        if (chunk.type === 'reasoning') callbacks.onReasoning?.(chunk.text);
      },
      experimental_onToolCallFinish: ({ toolCall, output }) => {
        callbacks.onToolResult?.({ name: toolCall.toolName, result: output });
        if (isRenderTool(toolCall.toolName)) {
          const msg = generateFromToolCall(toolCall.toolName, toolCall.input);
          if (msg) callbacks.onA2UIMessage?.(msg);
        }
      },
      onStepFinish: ({ usage }) => {
        this.accumulateUsage(conversationId, usage);
        callbacks.onTokenUsage?.(this.tokenUsage.get(conversationId)!);
      },
    });

    // Persist — response.messages gives clean provider-agnostic format
    const messages = await result.response;
    await this.chatEngine.persistMessages(conversationId, messages.messages);
    this.abortControllers.delete(conversationId);
  }

  abort(conversationId: string) {
    this.abortControllers.get(conversationId)?.abort();
  }

  async generateTitle(conversationId: string) {
    const { text } = await generateText({
      model: this.providers.getModel(titleModel),
      system: 'Generate a concise title...',
      messages: await this.loadMessages(conversationId),
      maxTokens: 60,
    });
    await this.chatEngine.updateTitle(conversationId, text.trim());
  }
}
```

~80 lines replaces ~560 lines of provider-specific streaming code.

### `ai/tasks.ts` — One-shot tasks

```ts
class OneShotTasks {
  constructor(private providers: ProviderRegistry) {}

  async analyzeTaxonomy(items: TaxonomyItem[], modelId: string) {
    const { text } = await generateText({
      model: this.providers.getModel(modelId),
      system: TAXONOMY_SYSTEM_PROMPT,
      prompt: buildTaxonomyPrompt(items),
      maxTokens: 4096,
    });
    return parseTaxonomyResponse(text);
  }

  async analyzeMediaImage(imageBase64: string, mediaType: string, language: string, modelId: string) {
    const { text } = await generateText({
      model: this.providers.getModel(modelId),
      system: imageAnalysisPrompt(language),
      messages: [{
        role: 'user',
        content: [
          { type: 'image', image: imageBase64, mimeType: mediaType },
          { type: 'text', text: 'Analyze. Respond with JSON.' },
        ],
      }],
      maxTokens: 200,
    });
    return parseImageAnalysisResponse(text);
  }
}
```

---

## What Carries Over

Domain logic only — no AI protocol code survives.

| What | Source | Destination |
|------|--------|-------------|
| 16 blog tool execute functions | `OpenCodeManager.executeTool()` | `ai/blog-tools.ts` |
| 7 A2UI tool definitions | `OpenCodeManager.getToolDefinitions()` | `ai/a2ui-tools.ts` |
| System prompt construction | `OpenCodeManager.buildSystemPrompt()` | `ai/chat.ts` |
| One-shot prompts (taxonomy, image) | `OpenCodeManager.analyze*()` | `ai/tasks.ts` |
| A2UI generator + catalog | `a2ui/` | `a2ui/` (unchanged) |
| Conversation persistence | `ChatEngine` | `ChatEngine` (unchanged) |
| Model catalog | `ModelCatalogEngine` | `ModelCatalogEngine` (unchanged) |
| Key encryption | `SecureKeyStore` | `SecureKeyStore` (extended) |
| MCP proposal tools | `MCPServer` | `MCPServer` (gains shared blog-tools) |
| Model listing HTTP | `OpenCodeManager.getAvailableModels()` | `ai/providers.ts` (thin HTTP for model lists) |

## IPC Changes

### Remove (provider-specific)
- `chat:validateApiKey`, `chat:setApiKey`, `chat:getApiKey` — replaced by generic
- `chat:validateMistralApiKey`, `chat:setMistralApiKey`, `chat:getMistralApiKey` — replaced by generic

### Add (provider-agnostic)
- `chat:getProviders` — list configured provider entries
- `chat:setProviderKey` / `chat:getProviderKey` — per-provider key management
- `chat:validateProvider` — test provider connectivity

### Keep (unchanged)
- `chat:sendMessage`, `chat:abortMessage` — wire to `ChatService`
- `chat:analyzeTaxonomy`, `chat:analyzeMediaImage` — wire to `OneShotTasks`
- All conversation CRUD, model catalog, system prompt handlers
- `a2ui:dispatch`

---

## Key Design Decisions

1. **No façade** — IPC handlers wire directly to `ChatService`, `ProviderRegistry`, `OneShotTasks`
2. **Anthropic context management** replaces `truncateToTokenBudget()` — server-side compaction, smarter than client-side estimation
3. **Cache control** via `providerOptions.anthropic.cacheControl` at message + tool level
4. **Extended thinking** — not now, but architecture supports it (just add `providerOptions.anthropic.thinking`)
5. **Electron `fetch`** — AI SDK uses Node `fetch` (works in Electron 40). Escape hatch: `net.fetch` as custom `fetch` for proxy/SSL
6. **Provider as config** — no per-provider classes. `ProviderRegistry` maps config → AI SDK instance. Add providers without code changes
7. **`toModelOutput`** on `view_image` — single definition works for all providers, eliminates per-provider image formatting hack

---

## Execution Plan

### Phase 0: Validate AI SDK + Electron (1 session) ✅ DONE
1. ~~`npm install ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/mistral`~~ ✅
2. ~~Write integration test: `generateText()` through Zen gateway with `baseURL` override~~ ✅ 31 tests
3. ~~Verify Electron `fetch` works (or set up `net.fetch` fallback)~~ ✅ Node fetch works
4. ~~Verify Zen baseURL path conventions match SDK expectations~~ ✅ See findings below

**Phase 0 Findings:**
- **BaseURL paths confirmed**: `@ai-sdk/anthropic` appends `/messages`, `@ai-sdk/openai` appends `/chat/completions` — Zen-compatible
- **CRITICAL: OpenAI Responses API vs Chat Completions**: `@ai-sdk/openai` v6 defaults to **Responses API** (`/responses`). Must use `provider.chat(modelId)` for Chat Completions (`/chat/completions`). All gateways (Zen, Azure, etc.) require Chat Completions.
- **`providerId:modelId` routing works**: `createProviderRegistry` resolves via prefix — no static model maps needed
- **`customProvider` with `fallbackProvider`**: Proven pattern for gateway routing with one rule: `startsWith('claude') → Anthropic, else → OpenAI`
- **Zod v4 schemas work with `tool()`**: Parameterized schemas, `toModelOutput()` for multimodal results
- **Anthropic `providerOptions`**: Cache control on system+tools, context management — all confirmed working

### Phase 1: Tools + MCP dedup (1 session)
5. Create `ai/blog-tools.ts` — 16 tools with Zod + execute (port from `executeTool` switch)
6. Create `ai/a2ui-tools.ts` — 7 render tools
7. Wire MCPServer to `blog-tools.ts` for `check_term` / `search_posts` — delete duplication
8. Unit tests for all tools (mock engines, no AI calls)

### Phase 2: Providers + Chat + Tasks (1-2 sessions)
9. Create `ai/providers.ts` — `ProviderRegistry` with OpenCode gateway + Mistral direct
10. Extend `SecureKeyStore` for multi-provider keys (`provider_${id}_api_key`)
11. Create `ai/chat.ts` — `ChatService` with `streamText()`
12. Create `ai/tasks.ts` — `OneShotTasks` with `generateText()`
13. Update IPC handlers: generic provider management, wire to new modules
14. Integration tests

### Phase 3: Delete + ship (1 session)
15. Delete `OpenCodeManager.ts` (2,745 lines)
16. Delete `streaming.ts` (621 lines)
17. Delete old MCPServer duplication
18. Update all tests, full build pass
19. Smoke test: chat conversation end-to-end, taxonomy analysis, image analysis

---

## Open Questions

1. ~~**Zen baseURL paths**~~ — **RESOLVED**: `@ai-sdk/anthropic` appends `/messages`, `@ai-sdk/openai.chat()` appends `/chat/completions`. Verified from SDK source code and mock tests.
2. **Model listing** — Zen model list endpoint vs AI SDK model discovery. Likely keep thin HTTP for now.
3. **DB message format** — Current `chatMessages` schema stores role/content/toolCallId/toolCalls. AI SDK `response.messages` may use a richer format. Evaluate whether to migrate schema or adapt at persistence layer.
