# Plan: Add Mistral AI as Alternative Chat Provider

## Context
bDS currently routes all AI chat through the OpenCode Zen gateway (`opencode.ai/zen/v1/...`) with two code paths: Anthropic Messages API and OpenAI-compatible. The user wants Mistral AI added as a direct alternative provider with frontier models that support chat completion, tool use, and vision. Mistral's API is OpenAI-compatible (`api.mistral.ai/v1/chat/completions`), making integration straightforward.

**Important architecture facts:**
- HTTP requests are currently **non-streaming** (full response body collected, text emitted after each complete call) — to be converted to SSE streaming as part of this work
- Neither `sendAnthropicMessage()` nor `sendOpenAIMessage()` currently sets `tool_choice`
- `sendOpenAIMessage()` does **not** convert `view_image` results to `image_url` format — they are JSON-stringified
- `generateConversationTitle()` is hardcoded to `claude-haiku-4-5` via `ZEN_ANTHROPIC_URL`
- `analyzeMediaImage()` is hardcoded to `claude-sonnet-4-5` via `ZEN_ANTHROPIC_URL`
- `checkReady()` only checks the OpenCode key — blocks `sendMessage()` for keyless users

## Target Models

| Model ID | Display Name | Vision | Tools | Context Window | Context Budget |
|----------|-------------|--------|-------|----------------|----------------|
| `mistral-large-2512` | Mistral Large 3 | yes | yes | 40k | 35,000 |
| `mistral-medium-2508` | Mistral Medium 3.1 | yes | yes | 40k | 35,000 |
| `mistral-small-2506` | Mistral Small 3.2 | yes | yes | 128k | 120,000 |
| `devstral-small-2505` | Devstral Small | no | yes | 128k | 120,000 |
| `devstral-large-2506` | Devstral 2 | no | yes | 256k | 240,000 |

## Files to Modify

### 1. `src/main/engine/OpenCodeManager.ts` - Core provider logic

**A. Add Mistral constants** (near lines 23-25)
- `MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions'`
- `MISTRAL_MODELS_URL = 'https://api.mistral.ai/v1/models'`

**B. Add Mistral models to `MODEL_DISPLAY_NAMES`** (lines 28-69)
```
'mistral-large-2512': 'Mistral Large 3'
'mistral-medium-2508': 'Mistral Medium 3.1'
'mistral-small-2506': 'Mistral Small 3.2'
'devstral-small-2505': 'Devstral Small'
'devstral-large-2506': 'Devstral 2'
```

**C. Update `detectProvider()`** (lines 1839-1845)
- Add: `if (id.startsWith('mistral') || id.startsWith('ministral') || id.startsWith('devstral') || id.startsWith('codestral') || id.startsWith('pixtral')) return 'mistral';`
- This covers all current and foreseeable Mistral model prefixes (Mistral, Ministral, Devstral, Codestral, Pixtral)

**C2. Update `formatModelName()` and `UPPERCASE_PREFIXES`**
- `formatModelName()` (L1869) first checks `MODEL_DISPLAY_NAMES`, then auto-formats via hyphen splitting + capitalization
- All 5 Mistral models are in `MODEL_DISPLAY_NAMES`, so auto-format is a fallback for future unknown models — no changes needed
- `UPPERCASE_PREFIXES` (L72) contains `['gpt', 'glm']` — no Mistral prefixes need uppercasing, so no changes needed

**D. Add Mistral API key storage**
- New field: `private mistralApiKey: string = ''`
- New methods: `setMistralApiKey()`, `getMistralApiKey()`, `validateMistralApiKey()`
- Load on init from settings key `'mistral_api_key'`

**E. Update `checkReady()`**
- Return `ready: true` if **either** OpenCode key or Mistral key is set
- Extend `ChatReadyStatus` to report per-provider availability, e.g. `providers: { opencode: boolean, mistral: boolean }`
- Callers (`Sidebar.tsx`, `sendMessage()`) must gate on the relevant provider, not a single boolean

**F. Add Mistral request path in `sendMessage()`**
- Route `provider === 'mistral'` to new `sendMistralRequest()` method
- Similar to OpenAI path but:
  - URL: `MISTRAL_API_URL` (direct, not through OpenCode gateway)
  - Auth: `Authorization: Bearer ${this.mistralApiKey}`
  - Context budget: per-model (see Target Models table above)
  - `tool_choice: "auto"` — Mistral's default; do **not** set `"any"` (which forces a tool call every turn even when the model should respond with text). Omit `tool_choice` entirely, since `"auto"` is the default, matching existing OpenCode behavior
  - `parallel_tool_calls: false` — set explicitly; our tool executor runs tools sequentially, so parallel tool calls would break the execution loop

**F2. Add `MODEL_CONTEXT_BUDGETS` map**
- New constant map `MODEL_CONTEXT_BUDGETS: Record<string, number>` with per-model token budgets
- `truncateToTokenBudget()` (L1654) currently defaults to `maxContextTokens = 150000`
- In `sendAnthropicMessage()` and `sendOpenAIMessage()`: pass the model's context budget from the map (defaulting to 150,000 for OpenCode models)
- In `sendMistralRequest()`: look up `MODEL_CONTEXT_BUDGETS[modelId]` and pass to truncation
- Values from Target Models table (35k, 120k, 240k)

**G. Fix tool-call message history in OpenAI-compatible path**
- `sendOpenAIMessage()` currently only keeps `user`/`assistant` messages in history, discarding `tool` role messages
- Tool results must be persisted in conversation history so follow-up rounds have context
- This affects all OpenAI-compatible providers (OpenCode OpenAI path + Mistral)

**H. Fix vision in OpenAI-compatible path (affects Mistral too)**
- `sendOpenAIMessage()` currently JSON-stringifies `view_image` results — no `image_url` conversion
- Add `image_url` format conversion for `__isImageResult` objects in the OpenAI path:
  `{ type: 'image_url', image_url: { url: 'data:image/webp;base64,...' } }`
- This fixes vision for all OpenAI-compatible providers, not just Mistral

**I. Update `getAvailableModels()`**
- When Mistral key is set, include Mistral models in returned list
- Add `provider` field to model entries so UI can group them
- Invalidate `cachedModels`/`cachedModelsAt` when Mistral key is added or removed

**J. Update `generateConversationTitle()` — make configurable in Preferences**
- Currently hardcoded to `claude-haiku-4-5` via `ZEN_ANTHROPIC_URL` with OpenCode key
- Add a **"Title generation model"** preference in Settings so users can pick the cheapest model for this task
- Default: `claude-haiku-4-5` (OpenCode) or `mistral-small-2506` (Mistral) based on available keys
- Route to the correct provider URL + API key based on the selected model's provider
- Must work with any configured provider, not just OpenCode

**K. Update `analyzeMediaImage()` — make configurable in Preferences** (lines 2066-2192)
- Currently hardcoded to `claude-sonnet-4-5` via `ZEN_ANTHROPIC_URL`
- Add an **"Image analysis model"** preference in Settings so users can select a dedicated vision model independent of their chat model (e.g. use Devstral for chat but Mistral Large 3 for images)
- **Only vision-capable models may be offered** — filter model list by a `vision` capability flag (e.g. Devstral models have no vision and must be excluded)
- Default: `claude-sonnet-4-5` (OpenCode) or first vision-capable Mistral model based on available keys
- Route to the correct provider URL + API key based on the selected model's provider
- When routed to Mistral: use `image_url` format with base64 data URI
- When routed to OpenCode/Anthropic: keep current Anthropic-native `image` block format

**L. Update `analyzeTaxonomy()`**
- Currently uses `this.apiKey` (OpenCode) for both Anthropic and OpenAI paths
- When a Mistral model is selected: use Mistral API key + `MISTRAL_API_URL`
- Must branch on provider to select correct key and URL

**M. Convert chat HTTP calls to SSE streaming**

Currently `httpRequest()` buffers the entire response body before any text reaches the UI. Users wait 5–30s per API round with only a bouncing-dots indicator. All three providers (Anthropic, OpenAI, Mistral) support `stream: true` with SSE.

**M1. Core streaming infrastructure — `httpRequestStream()`**
- New method (~100 lines) — uses Node.js `https.request()` but reads `res` as a readable stream
- Returns an async iterable of parsed SSE events (or accepts an `onEvent` callback)
- SSE line protocol: lines separated by `\n\n`, each line prefixed with `event: ` or `data: `
- Must handle:
  - Buffering partial lines across `data` chunks (TCP may split mid-line)
  - Empty `data:` lines (keep-alive pings)
  - `data: [DONE]` sentinel — terminates the stream for OpenAI/Mistral (do NOT try to JSON.parse this)
  - Multiple `data:` lines between double-newlines (concatenate per SSE spec)
- Supports `AbortSignal` — calls `req.destroy()` to terminate immediately
- 120-second timeout matching existing `httpRequest()`
- On non-2xx status: collect the error body (not streamed) and throw with parsed error message

**M2. SSE parser for OpenAI/Mistral format** (~50 lines)
OpenAI and Mistral use identical SSE event structure:
```
data: {"id":"...","choices":[{"delta":{"content":"Hello"}}]}
data: {"id":"...","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_...","function":{"name":"search_posts","arguments":""}}]}}]}
data: {"id":"...","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"query\""}}]}}]}
...
data: {"id":"...","usage":{"prompt_tokens":150,"completion_tokens":42,"total_tokens":192}}
data: [DONE]
```
- **Text deltas**: `choices[0].delta.content` — emit via `onDelta(content)` immediately
- **Tool call start**: `delta.tool_calls[i]` with `id` + `function.name` — begin accumulating arguments for tool call at index `i`
- **Tool call argument fragments**: `delta.tool_calls[i].function.arguments` — append to argument accumulator string for index `i`
- **Finish reason**: `choices[0].finish_reason === 'tool_calls'` or `'stop'` — signals end of this chunk
- **Token usage**: arrives in the **final chunk before `[DONE]`** only if `stream_options: { include_usage: true }` is set in the request body — parse `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`
- **`[DONE]` sentinel**: stop iteration, do NOT JSON.parse
- After stream ends: if tool calls were accumulated, JSON.parse each tool's assembled arguments string and execute

**M3. SSE parser for Anthropic format** (~60 lines)
Anthropic uses named event types:
```
event: message_start
data: {"type":"message_start","message":{"id":"...","model":"...","usage":{"input_tokens":150}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_...","name":"search_posts"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"query\""}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":42}}

event: message_stop
data: {"type":"message_stop"}
```
- **`message_start`**: extract `usage.input_tokens` (prompt tokens) + `usage.cache_read_input_tokens` + `usage.cache_creation_input_tokens`
- **`content_block_start`** with `type: 'text'`: no-op (empty initial text)
- **`content_block_start`** with `type: 'tool_use'`: record tool call `id` and `name` at block index
- **`content_block_delta`** with `type: 'text_delta'`: emit via `onDelta(delta.text)` immediately
- **`content_block_delta`** with `type: 'input_json_delta'`: append `delta.partial_json` to argument accumulator
- **`content_block_stop`**: if tool block, JSON.parse the accumulated arguments for that block
- **`message_delta`**: extract `usage.output_tokens` (completion tokens), `delta.stop_reason`
- **`message_stop`**: stream complete
- **`ping`**: ignore (keep-alive)
- **`error`**: throw with `data.error.message` — handles mid-stream server errors (e.g. overloaded)

**M4. Request body changes**
- `sendAnthropicMessage()`: add `"stream": true` to request body
- `sendOpenAIMessage()` / `sendMistralRequest()`: add `"stream": true` and `"stream_options": { "include_usage": true }` to request body — this is **required** to receive token usage in streaming mode (without it, usage is omitted from streamed responses)

**M5. Tool call accumulation during streaming**
- Tool call arguments arrive as partial JSON fragments across many SSE events
- Maintain a per-stream accumulator: `Map<number, { id: string, name: string, arguments: string }>` keyed by tool call index
- Append each `arguments` fragment to the accumulator string
- On stream completion (finish_reason `tool_calls`/`tool_use`, or `content_block_stop` for Anthropic): JSON.parse the full accumulated arguments string and execute the tool
- If JSON.parse fails on accumulated arguments, report a tool error to the model and continue

**M6. Error handling during streaming**
- **Non-2xx status on connection**: do NOT stream; collect the full error body and throw (same as current `httpRequest()` behavior)
- **Mid-stream TCP disconnect / network error**: `res.on('error')` handler — emit whatever text was accumulated so far, then throw so the tool-call loop can surface the error to the user
- **Mid-stream API error event**: Anthropic sends `event: error` with error details; OpenAI/Mistral return an error JSON in a `data:` line — detect and throw with parsed error message
- **Abort during streaming**: `req.destroy()` triggers `res.on('error')` or `res.on('close')` — handle gracefully without surfacing as an error to the user (it's intentional cancellation)

**What does NOT change:**
- The renderer pipeline — `onDelta` → IPC `chat-stream-delta` → `appendStreamDelta` → React state → live Markdown rendering already works token-by-token; it just receives one big chunk today
- `AbortController` abort support — `req.destroy()` stops the stream immediately instead of wasting a buffered response
- The tool-call loop structure — still max 10 rounds, still sequential

**What to keep non-streaming:**
- `generateConversationTitle()` — small one-shot request, buffering is fine
- `analyzeMediaImage()` — one-shot, no UI streaming needed
- `analyzeTaxonomy()` — one-shot, no UI streaming needed
- `validateApiKey()` / `validateMistralApiKey()` — small validation requests
- Note: `validateMistralApiKey()` must call `GET https://api.mistral.ai/v1/models` with `Authorization: Bearer ${key}`. Mistral returns `{ data: [{ id, object, created, owned_by }] }` — check for HTTP 200 + non-empty `data` array. On 401, return invalid. On success, optionally cross-reference returned model IDs with `MODEL_DISPLAY_NAMES` to verify expected models are available

**Estimated scope:** ~300 lines of new code in `OpenCodeManager.ts` (streaming adds ~100 lines vs original estimate)

### 2. `src/main/engine/ChatEngine.ts` - Settings persistence

**A. Add Mistral key helpers**
- `getMistralApiKey()` - read from settings table
- `setMistralApiKey(key)` - persist to settings table
- Settings key: `'mistral_api_key'`

**B. Default model is user-driven**
- `getSelectedModel()` defaults to `'claude-sonnet-4-5'`
- When user configures providers in Preferences, they explicitly select their default model — no automatic fallback logic needed
- All surfaces (ChatPanel, AssistantSidebar, ImportAnalysisView) use this preference as default
- If selected model's provider key is later removed:
  - `sendMessage()` returns a clear error string: "The selected model requires a {provider} API key. Configure it in Settings."
  - `checkReady()` still returns `ready: true` if any other provider is available
  - ChatPanel shows an inline error banner (not a toast) with a link/button to open Settings
  - i18n key: `chat.providerKeyMissing` — "The model '{model}' requires a {provider} API key. Go to Settings to configure it."
  - Add this key to all 5 locale files

**C. Add per-purpose model preferences**
- `getTitleModel()` / `setTitleModel(modelId)` — settings key `'chat_title_model'`
- `getImageAnalysisModel()` / `setImageAnalysisModel(modelId)` — settings key `'chat_image_analysis_model'`
- Both default to `null` (= use hardcoded defaults per provider)

### 3. `src/main/ipc/chatHandlers.ts` - IPC bridge

**A. Add Mistral-specific handlers**
- `chat:setMistralApiKey` - validate + persist Mistral key, invalidate model cache
- `chat:getMistralApiKey` - return masked key
- `chat:validateMistralApiKey` - test key against Mistral API

**B. Update `chat:getAvailableModels`**
- Include Mistral models when Mistral key is configured
- Return provider info per model

**C. Update `chat:checkReady`**
- Report readiness for both providers independently

**D. Update `getOpenCodeManager()` init**
- Load `'mistral_api_key'` from settings on first call (alongside OpenCode key)
- Call `manager.setMistralApiKey()` during init

**E. Add per-purpose model preference handlers**
- `chat:setTitleModel` / `chat:getTitleModel` — persist + load title generation model preference
- `chat:setImageAnalysisModel` / `chat:getImageAnalysisModel` — persist + load image analysis model preference

### 4. `src/main/shared/electronApi.ts` - Type definitions

**A. Extend `ChatModel` interface**
- Add `provider: 'opencode' | 'mistral'` field (already optional, ensure populated)
- Add `vision: boolean` field — indicates whether the model supports image inputs (used to filter the image analysis model dropdown)

**B. Extend `ChatReadyStatus` interface**
- Add `providers?: { opencode: boolean; mistral: boolean }` for per-provider status

**C. Add Mistral IPC methods to `ElectronAPI.chat`**
- `setMistralApiKey(key: string)`
- `getMistralApiKey()`
- `validateMistralApiKey(key: string)`

**D. Add per-purpose model preference methods to `ElectronAPI.chat`**
- `setTitleModel(modelId: string | null)` / `getTitleModel()`
- `setImageAnalysisModel(modelId: string | null)` / `getImageAnalysisModel()`

### 5. `src/renderer/components/SettingsView/SettingsView.tsx` - UI settings

**A. Add Mistral API key section**
- Separate input field for Mistral API key (below OpenCode key)
- Same pattern: masked display, change button, validation on save

**B. Update model selector**
- Group models by provider in dropdown (optgroup: "OpenCode Zen", "Mistral AI")
- Show provider badge next to selected model

**C. Add per-purpose model preferences**
- "Title generation model" dropdown — select cheapest/fastest model for auto-titling conversations
- "Image analysis model" dropdown — select a dedicated vision model for media metadata (independent of chat model, e.g. use Devstral for chat but Mistral Large 3 for images); **only show vision-capable models** (filter out models without vision support like Devstral)
- Both show available models from all configured providers, grouped by provider
- Both allow a "Default" option that auto-selects per provider defaults

### 6. `src/renderer/components/ChatPanel/ChatPanel.tsx` - Chat UI

**A. Update model selector in chat**
- Group by provider in dropdown
- Only show models for configured providers

### 7. `src/renderer/components/AssistantSidebar/` - Assistant UI

**A. No model selector changes needed**
- AssistantSidebar has no model selector and no `checkReady()` call of its own
- It uses whatever default model is set in Preferences (via `getSelectedModel()`)
- No code changes needed here — provider-awareness is handled at the Preferences and engine level

### 8. `src/renderer/components/Sidebar.tsx` - Navigation

**A. Update readiness check**
- Calls `chat.checkReady()` to show/hide chat features
- Must handle multi-provider readiness (show chat if **any** provider is ready)
- Note: Zustand store (`src/renderer/store/appStore.ts`) currently only tracks `chatTokenUsage` — no provider/readiness state is stored there. Provider readiness is ephemeral (fetched on mount via `checkReady()`), so no Zustand changes needed. If future features need reactive provider state, consider adding it then

### 9. `src/renderer/components/ImportAnalysisView/ImportAnalysisView.tsx` - Taxonomy analysis UI

**A. Update model selector**
- Has its own model selector (`ChatModel[]` state + `getAvailableModels()` call) for taxonomy analysis
- Currently renders a flat model list with no provider grouping
- Apply same provider grouping as ChatPanel (optgroup by provider)
- Default to whatever is set in Preferences as default model (via `getSelectedModel()`)
- Use the shared `ModelSelector` component (see section 9b)

### 9b. `src/renderer/components/shared/ModelSelector.tsx` - Shared model selector component (NEW)

**Extract a reusable `ModelSelector` component** used by SettingsView, ChatPanel, and ImportAnalysisView:
- Props: `models: ChatModel[]`, `selectedModelId: string`, `onChange: (modelId: string) => void`, `filterVisionOnly?: boolean`, `allowDefault?: boolean`, `disabled?: boolean`
- Groups models into `<optgroup>` by `model.provider` (labels: "OpenCode Zen", "Mistral AI")
- When `filterVisionOnly` is true, only shows models with `vision: true` (for image analysis model selector)
- When `allowDefault` is true, adds a "Default" option at the top (for per-purpose model preferences)
- All three surfaces currently duplicate this dropdown logic — extracting prevents drift

### 10. Preload/IPC registration

**A. `src/main/preload.ts`**
- Register new Mistral IPC channels in preload bridge
- All chat IPC channels are bridged 1:1; new methods need entries here

### 11. i18n - All locale files

**A. Add Mistral-specific i18n keys** in all 5 locale files:
- `src/renderer/i18n/locales/en.json`
- `src/renderer/i18n/locales/de.json`
- `src/renderer/i18n/locales/fr.json`
- `src/renderer/i18n/locales/es.json`
- `src/renderer/i18n/locales/it.json`

Keys needed:
- `settings.ai.mistralApiKeyLabel` — "Mistral API Key"
- `settings.ai.mistralApiKeyDescription` — description text
- `settings.ai.mistralApiKeyPlaceholder` — placeholder text
- `settings.ai.titleModelLabel` — "Title generation model"
- `settings.ai.titleModelDescription` — description text
- `settings.ai.imageAnalysisModelLabel` — "Image analysis model"
- `settings.ai.imageAnalysisModelDescription` — description text
- `settings.ai.defaultOption` — "Default" (for per-purpose model selectors)
- `settings.ai.providerGroupOpenCode` — "OpenCode Zen" (optgroup label)
- `settings.ai.providerGroupMistral` — "Mistral AI" (optgroup label)
- `chat.providerKeyMissing` — "The model '{model}' requires a {provider} API key. Go to Settings to configure it."
- `chat.apiKeyRequiredTitle` — make generic or multi-provider (currently hardcoded to "OpenCode Zen API Key Required")
- `chat.apiKeyRequiredDescription` — make generic or multi-provider (currently hardcoded to OpenCode-specific text)

### 12. MCP Server - `src/main/engine/MCPServer.ts`

- No changes needed — MCP server exposes tools for external AI agents to call; no bDS-side AI runs during MCP requests

### 13. Python API - `src/main/shared/pythonApiContractV1.ts`

- No changes needed — AI/chat features are explicitly not exposed via Python API

## Tests to Update

### New tests
- OpenCodeManager: Mistral key storage, `detectProvider('mistral-*')` + `detectProvider('devstral-*')` + `detectProvider('codestral-*')` + `detectProvider('pixtral-*')`, `sendMistralRequest()`, vision image conversion in OpenAI path, tool-call message persistence in OpenAI path, `generateConversationTitle()` Mistral routing, model cache invalidation, `MODEL_CONTEXT_BUDGETS` correctness, SSE line parsing (both OpenAI/Mistral and Anthropic formats), `[DONE]` sentinel handling, tool-call argument accumulation during streaming, mid-stream error handling, `stream_options` in request bodies
- ChatEngine: `getMistralApiKey()`/`setMistralApiKey()`, `getTitleModel()`/`setTitleModel()`, `getImageAnalysisModel()`/`setImageAnalysisModel()`, default model fallback
- chatHandlers: new Mistral IPC handlers, per-purpose model preference handlers

### Existing tests to update
- `tests/engine/OpenCodeManagerTools.test.ts` — if mocked manager gains new required fields
- `tests/engine/ChatEngine.test.ts` — default model fallback logic
- `tests/ipc/chatHandlers.test.ts` — new handler registration, init flow
- `electronApiContract.test.ts` — `ElectronAPI.chat` shape now includes Mistral methods
- 10 renderer test files that mock `window.electronAPI.chat` (12 mock blocks total) — add Mistral method stubs to mocks:
  - `tests/renderer/components/SidebarChat.test.tsx`
  - `tests/renderer/components/SettingsView.test.tsx` (2 mock blocks)
  - `tests/renderer/components/SettingsView.i18n.test.tsx`
  - `tests/renderer/components/TabBar.test.tsx`
  - `tests/renderer/components/EditorDashboardTimeline.test.tsx`
  - `tests/renderer/components/AssistantSidebar.wiring.test.tsx`
  - `tests/renderer/navigation/chatSurfaceUsageGuards.test.ts`
  - `tests/renderer/navigation/chatSurfaceModeUsageGuards.test.ts`
  - `tests/renderer/navigation/assistantSidebarGuards.test.ts`
  - `tests/renderer/a2ui/surfaceActionWiring.test.tsx`

## Implementation Order

1. Tests first (per AGENTS.md)
2. Types (`electronApi.ts` — `ChatModel`, `ChatReadyStatus`, `ElectronAPI.chat`)
3. Engine (`OpenCodeManager.ts` — constants, `MODEL_CONTEXT_BUDGETS`, detection, key storage, `checkReady()`, request path, vision fix, title generation fallback)
4. SSE streaming (`OpenCodeManager.ts` — `httpRequestStream()`, SSE parsers for Anthropic + OpenAI/Mistral formats, `stream: true` + `stream_options` in request bodies)
5. Persistence (`ChatEngine.ts` — settings helpers, per-purpose model preferences, default model fallback)
6. IPC (`chatHandlers.ts` — new handlers, init flow update)
7. Preload (`preload.ts` — bridge new channels)
8. i18n (all 5 locale files)
9. Shared components (`ModelSelector.tsx` — extract reusable model selector with provider grouping)
10. UI (`SettingsView/SettingsView.tsx`, `ChatPanel.tsx`, `ImportAnalysisView.tsx`, `Sidebar.tsx` — use shared `ModelSelector`)
11. Update existing test mocks
12. Build verification (`npm run build`)

## Key Differences to Handle

| Aspect | OpenCode/Anthropic | OpenCode/OpenAI-compat | Mistral |
|--------|-------------------|----------------------|---------|
| Base URL | `opencode.ai/zen/v1/messages` | `opencode.ai/zen/v1/chat/completions` | `api.mistral.ai/v1/chat/completions` |
| Auth header | `Bearer ${openCodeKey}` | `Bearer ${openCodeKey}` | `Bearer ${mistralKey}` |
| Tool choice | not set | not set | not set (default `"auto"`) |
| Parallel tools | not set | not set | `parallel_tool_calls: false` |
| Context budget | 150k tokens | 150k tokens | per-model (see Target Models table) |
| Stream options | `"stream": true` | `"stream": true, "stream_options": {"include_usage": true}` | `"stream": true, "stream_options": {"include_usage": true}` |
| Vision in tool results | Anthropic `image` block (native) | **BUG: JSON-stringified** | `image_url` block (fix needed) |
| HTTP mode | SSE streaming (`stream: true`) | SSE streaming (`stream: true`) | SSE streaming (`stream: true`) |
| Title generation | `claude-haiku-4-5` default | N/A | `mistral-small-2506` default |
| Image analysis | `claude-sonnet-4-5` default | N/A | user-selected vision model |

## Verification

1. Run `npm test` — all existing + new tests pass
2. Run `npm run build` — clean build
3. Manual: set Mistral API key in Settings, verify validation
4. Manual: select Mistral Large 3, send chat message, verify response completes
5. Manual: use `view_image` tool in chat with Mistral model, verify vision works
6. Manual: verify tool calling works (search_posts, list_posts, etc.)
7. Manual: verify OpenCode models still work unchanged
8. Manual: verify Mistral-only mode (no OpenCode key) — chat works, title generates, readiness shows correctly
9. Manual: verify `analyzeMediaImage()` and `analyzeTaxonomy()` with Mistral model
10. Manual: configure title generation model in Settings, verify titles use selected model
11. Manual: configure image analysis model in Settings, verify media analysis uses selected model (independent of chat model)
12. Manual: verify SSE streaming — text appears token-by-token (not as a single block after long wait)
13. Manual: verify abort during streaming — text stops immediately, no wasted response

## Resolved Decisions

1. **`analyzeMediaImage()`** — Configurable via Settings preference; user selects a dedicated vision model independent of chat model; dropdown only shows vision-capable models
2. **`generateConversationTitle()`** — Configurable via Settings preference; user selects cheapest/fastest model for auto-titling
3. **`checkReady()`** — Returns true if any provider key is set; reports per-provider availability
4. **Default model** — User-driven; set explicitly in Preferences when configuring provider + model; all surfaces (ChatPanel, AssistantSidebar, ImportAnalysisView) use this preference
5. **Vision in OpenAI path** — Fix `image_url` conversion for all OpenAI-compatible providers (not just Mistral)
6. **MCP server** — N/A; only exposes tools, no bDS-side AI runs
7. **Python API** — N/A; AI/chat not exposed via Python API
8. **Model dropdown grouping** — Use `<optgroup>` labels ("OpenCode Zen", "Mistral AI"); extract shared `ModelSelector` component to avoid duplication across 3 surfaces
9. **SSE streaming** — Convert all chat HTTP calls to `stream: true` + SSE parsing; keep one-shot requests (title, image analysis, taxonomy, validation) non-streaming. Renderer needs zero changes — existing `onDelta` pipeline already supports incremental tokens. Token usage requires `stream_options: { include_usage: true }` for OpenAI/Mistral format; Anthropic provides usage in `message_start` + `message_delta` events
10. **OpenAI tool-call history** — Fix `sendOpenAIMessage()` to persist `tool` role messages in conversation history (not just `user`/`assistant`), so follow-up tool rounds have context
11. **ImportAnalysisView** — Has its own model selector; apply same provider grouping; default to Preferences model
12. **AssistantSidebar** — No model selector of its own; uses Preferences default model; no code changes needed
13. **`tool_choice`** — Do NOT set `tool_choice: "any"` for Mistral (this forces tool use every turn). Omit it entirely; Mistral defaults to `"auto"`, same as OpenCode. Set `parallel_tool_calls: false` explicitly since our tool executor is sequential
14. **`detectProvider()` prefixes** — Cover all Mistral model families: `mistral`, `ministral`, `devstral`, `codestral`, `pixtral`
15. **`formatModelName()` / `UPPERCASE_PREFIXES`** — No changes needed; all 5 Mistral models are in `MODEL_DISPLAY_NAMES`; auto-format fallback handles future unknown models correctly
16. **Context budgets** — Stored in `MODEL_CONTEXT_BUDGETS` map; passed explicitly to `truncateToTokenBudget()` per provider path; OpenCode defaults to 150k, Mistral per-model (see Target Models table)
17. **Error UX for removed provider key** — Inline error banner in ChatPanel (not a toast) with link to Settings; `sendMessage()` returns descriptive error string; `checkReady()` stays true if any provider available
18. **Zustand store** — No changes needed; provider readiness is ephemeral (fetched on mount), token usage tracking is already in store and is provider-agnostic
19. **`validateMistralApiKey()`** — Calls `GET https://api.mistral.ai/v1/models` with Bearer token; checks for HTTP 200 + non-empty `data` array; Mistral returns `{ data: [{ id, object, created, owned_by }] }` format
