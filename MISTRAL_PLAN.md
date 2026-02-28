# Plan: Add Mistral AI as Alternative Chat Provider

## Context
bDS currently routes all AI chat through the OpenCode Zen gateway (`opencode.ai/zen/v1/...`) with two code paths: Anthropic Messages API and OpenAI-compatible. The user wants Mistral AI added as a direct alternative provider with frontier models that support chat completion, tool use, and vision. Mistral's API is OpenAI-compatible (`api.mistral.ai/v1/chat/completions`), making integration straightforward.

## Target Models
- **Mistral Large 3** (`mistral-large-2512`) - frontier, vision, tools, 40k ctx
- **Mistral Medium 3.1** (`mistral-medium-2508`) - frontier, vision, tools, 40k ctx
- **Mistral Small 3.2** (`mistral-small-2506`) - vision, tools, 128k ctx

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
```

**C. Update `detectProvider()`** (lines 1839-1845)
- Add: `if (id.startsWith('mistral') || id.startsWith('ministral')) return 'mistral';`

**D. Add Mistral API key storage**
- New field: `private mistralApiKey: string = ''`
- New methods: `setMistralApiKey()`, `getMistralApiKey()`, `validateMistralApiKey()`
- Load on init from settings key `'mistral_api_key'`

**E. Add Mistral request path in `sendMessage()`**
- Route `provider === 'mistral'` to new `sendMistralRequest()` method
- Similar to OpenAI path but:
  - URL: `MISTRAL_API_URL` (direct, not through OpenCode gateway)
  - Auth: `Authorization: Bearer ${this.mistralApiKey}`
  - No `tool_choice: "required"` — use `"any"` for Mistral's equivalent
  - Context budget: 35,000 tokens (vs 150k for OpenCode) for 40k-ctx models, 120k for Small 3.2

**F. Vision format for Mistral**
- In `view_image` tool result handling: use `image_url` format with base64 data URI
- Format: `{ type: 'image_url', image_url: { url: 'data:image/webp;base64,...' } }`
- Same as OpenAI path (Mistral is compatible here)

**G. Update `getAvailableModels()`**
- When Mistral key is set, include Mistral models in returned list
- Add `provider` field to model entries so UI can group them

**H. Update `analyzeMediaImage()`** (lines 2066-2192)
- Support Mistral models for image metadata analysis (title/alt/caption generation)
- When a Mistral model is selected, use Mistral vision format (`image_url` with base64 data URI)
- Route to `api.mistral.ai` with Mistral API key

### 2. `src/main/engine/ChatEngine.ts` - Settings persistence

**A. Add Mistral key helpers**
- `getMistralApiKey()` - read from settings table
- `setMistralApiKey(key)` - persist to settings table
- Settings key: `'mistral_api_key'`

### 3. `src/main/ipc/chatHandlers.ts` - IPC bridge

**A. Add Mistral-specific handlers**
- `chat:setMistralApiKey` - validate + persist Mistral key
- `chat:getMistralApiKey` - return masked key
- `chat:validateMistralApiKey` - test key against Mistral API

**B. Update `chat:getAvailableModels`**
- Include Mistral models when Mistral key is configured
- Return provider info per model

**C. Update `chat:checkReady`**
- Report readiness for both providers independently

### 4. `src/main/shared/electronApi.ts` - Type definitions

**A. Extend `ChatModel` interface**
- Add `provider: 'opencode' | 'mistral'` field (already optional, ensure populated)

**B. Add Mistral IPC methods to `ElectronAPI.chat`**
- `setMistralApiKey(key: string)`
- `getMistralApiKey()`
- `validateMistralApiKey(key: string)`

### 5. `src/renderer/components/SettingsView.tsx` - UI settings

**A. Add Mistral API key section**
- Separate input field for Mistral API key (below OpenCode key)
- Same pattern: masked display, change button, validation on save

**B. Update model selector**
- Group models by provider in dropdown (optgroup: "OpenCode Zen", "Mistral AI")
- Show provider badge next to selected model

### 6. `src/renderer/components/ChatPanel/ChatPanel.tsx` - Chat UI

**A. Update model selector in chat**
- Group by provider in dropdown
- Only show models for configured providers

### 7. Preload/IPC registration

**A. `src/main/ipc/handlers.ts` or preload**
- Register new Mistral IPC channels
- Expose in preload bridge

### 8. MCP Server - `src/main/engine/MCPServer.ts`

- No changes needed — MCP server exposes tools for external AI agents to call; no bDS-side AI runs during MCP requests

## Implementation Order

1. Tests first (per AGENTS.md)
2. Types (`electronApi.ts`)
3. Engine (`OpenCodeManager.ts` — constants, detection, key storage, request path)
4. Persistence (`ChatEngine.ts` — settings helpers)
5. IPC (`chatHandlers.ts` — new handlers)
6. UI (`SettingsView.tsx`, `ChatPanel.tsx` — key input, model grouping)
7. Build verification

## Key Differences to Handle

| Aspect | OpenCode/OpenAI | Mistral |
|--------|----------------|---------|
| Base URL | `opencode.ai/zen/v1/...` | `api.mistral.ai/v1/...` |
| Auth header | `Bearer ${openCodeKey}` | `Bearer ${mistralKey}` |
| Tool choice forced | `"required"` | `"any"` |
| Parallel tools | not set | `parallel_tool_calls: true` |
| Context budget | 150k tokens | 35k (Large/Medium), 120k (Small) |
| Vision format | `image_url` block | `image_url` block (same) |
| Streaming | SSE deltas | SSE deltas (same) |

## Verification

1. Run `npm test` — all existing + new tests pass
2. Run `npm run build` — clean build
3. Manual: set Mistral API key in Settings, verify validation
4. Manual: select Mistral Large 3, send chat message, verify response streams
5. Manual: use `view_image` tool in chat with Mistral model, verify vision works
6. Manual: verify tool calling works (search_posts, list_posts, etc.)
7. Manual: verify OpenCode models still work unchanged

## Resolved Decisions

1. **`analyzeMediaImage()`** — Mistral models will be usable for image metadata analysis
2. **MCP server** — N/A; MCP server only exposes tools, no bDS-side AI runs during MCP requests
3. **Model dropdown grouping** — Use `<optgroup>` labels ("OpenCode Zen", "Mistral AI")
