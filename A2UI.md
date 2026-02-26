# A2UI Implementation Plan — Full Rework

## Credits

- Plan: Claude Opus 4.6 (2026-02-26)
- A2UI specification: Google (https://a2ui.org, https://github.com/google/A2UI, Apache 2.0)
- A2UI SDK types: @a2ui-sdk community packages (https://a2ui-sdk.js.org/)

## Context

The current `feature-agui` branch claims to implement "A2UI" but does not implement the actual Google A2UI protocol (https://a2ui.org, https://github.com/google/A2UI). Instead, it has a custom protocol envelope system where the LLM is instructed to output a monolithic JSON blob, which is then validated with hyper-strict Zod schemas. This approach fundamentally doesn't work:

- The LLM can't reliably produce the exact JSON schema required
- Raw JSON streams to the chat UI before being replaced (visible flicker)
- Strict validation rejects almost everything, so UI elements never render
- A failed retry doubles API cost and latency
- The 11 files in `src/main/agentic/` are elaborate infrastructure built on a broken premise

**Goal:** Replace the broken custom protocol with a proper implementation of Google's A2UI v0.9 protocol — streaming, flat-component, data-binding — so the assistant can progressively render rich interactive UI in both chat surfaces.

---

## Architecture Overview

### Real A2UI (v0.9) Key Concepts

- **JSONL streaming**: Server sends a stream of JSON messages, each a complete A2UI message
- **4 message types**: `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`
- **Flat component model**: Components are a flat list with ID references (adjacency list), not nested trees
- **Data binding**: Components bind to a data model via JSON Pointer paths (RFC 6901)
- **Component catalog**: Client declares which components it supports; agent can only use those
- **Actions**: User interactions dispatch events back to the server

### How This Maps to Our Electron App

```
User types message
    ↓
Renderer → IPC → Main Process (OpenCodeManager)
    ↓
Main Process calls LLM API (text + tool calls)
    ↓
LLM responds with text + calls UI tools (render_chart, render_form, etc.)
    ↓
Main Process A2UI Generator creates A2UI messages from tool results
    ↓
A2UI messages sent to renderer via IPC events (one event per message)
    ↓
Renderer A2UI Engine processes messages:
  - createSurface → initialize surface state
  - updateComponents → add/update components in flat buffer
  - updateDataModel → update data model store
    ↓
Renderer A2UI Renderer resolves component tree from flat buffer
    ↓
React components render (reusing existing widget implementations)
    ↓
User clicks button → action event → IPC → Main Process → feed back to LLM
```

**Key insight: IPC IS the transport.** We don't need JSONL parsing libraries or SSE. The main process generates A2UI message objects and sends them individually via `webContents.send()`. The renderer receives them as JavaScript objects via `ipcRenderer.on()`.

### Tool-Driven UI Generation (Not Free-Text JSON)

Instead of asking the LLM to produce A2UI JSON as free text (unreliable), we add **UI-rendering tools** that the LLM calls via the existing tool-use mechanism:

| Tool | Purpose | A2UI Output |
|------|---------|-------------|
| `render_chart` | Show bar/stacked-bar/line/pie chart | `updateComponents` with chart component |
| `render_table` | Show data table | `updateComponents` with table rows |
| `render_form` | Show input form | `updateComponents` with form fields |
| `render_card` | Show info card | `updateComponents` with card component |
| `render_metric` | Show key-value metric | `updateComponents` with metric display |
| `render_list` | Show item list | `updateComponents` with list items |
| `render_tabs` | Show tabbed content | `updateComponents` with tabs |

The LLM calls these tools with structured parameters (validated by the API provider), and our code translates tool results into proper A2UI messages. This is reliable because tool call schemas ARE validated by Claude/GPT APIs.

---

## Dependencies

### Install

| Package | Purpose | Why |
|---------|---------|-----|
| `@a2ui-sdk/types` | TypeScript types for A2UI v0.9 messages | Type-safe message handling without full renderer |

### Evaluate (may not need)

| Package | Purpose | Decision Point |
|---------|---------|---------------|
| `@a2ui-sdk/react` | React renderer + hooks | If it supports component overrides without forcing Tailwind/shadcn. Our app uses VSCode theme variables. If it forces Tailwind, skip and build custom renderer using existing `AssistantPanelControls` widgets. |

### Do NOT install

| Package | Why Not |
|---------|---------|
| `ndjson` / JSONL parsers | IPC is the transport — no JSONL wire format needed |
| CopilotKit / AG-UI | Full-stack framework, too heavyweight for integration into existing Electron app |

---

## Files to DELETE (broken protocol machinery)

All of `src/main/agentic/` — 11 files that implement the broken custom protocol:

- `src/main/agentic/protocol/types.ts` → replaced by `@a2ui-sdk/types`
- `src/main/agentic/protocol/errors.ts` → no longer needed
- `src/main/agentic/protocol/validator.ts` → replaced by schema validation in A2UI engine
- `src/main/agentic/protocol/uiSchema.ts` → duplicate of renderer schema, deleted
- `src/main/agentic/protocol/uiSpecParser.ts` → replaced by A2UI message parser
- `src/main/agentic/protocol/responseBuilder.ts` → replaced by A2UI generator
- `src/main/agentic/capabilities/registry.ts` → replaced by A2UI client capabilities
- `src/main/agentic/workflow/turnStateMachine.ts` → not needed
- `src/main/agentic/workflow/checkpointStore.ts` → not needed
- `src/main/agentic/policy/actionPolicy.ts` → action policies move into A2UI action handler
- `src/main/agentic/observability/protocolTelemetry.ts` → not needed initially

Also delete these test files for removed code:

- `tests/engine/agentic/protocol/responseBuilder.test.ts`
- `tests/engine/OpenCodeManager.protocol.test.ts`
- Any other tests in `tests/` that test the deleted agentic/ modules

---

## Files to MODIFY

### `src/main/engine/OpenCodeManager.ts`
- Remove `protocolBoundaryInstructions` (line 152-159)
- Remove protocol retry mechanism (lines 408-438)
- Remove `ProtocolResponseBuilder` usage
- Remove `CapabilityRegistryService`, `AgentTurnStateMachine`, `WorkflowCheckpointStore`, `protocolTelemetry` usage
- Remove the `protocolVersion`/`envelope` fields from `SendMessageResult`
- Add UI-rendering tools to `getToolDefinitions()`: `render_chart`, `render_table`, `render_form`, `render_card`, `render_metric`, `render_list`, `render_tabs`
- Add `executeTool` handlers that convert tool args into A2UI messages and emit them via IPC
- Keep text streaming (`onDelta`) as-is for conversational responses
- Add new callback: `onA2UIMessage` for streaming A2UI messages to renderer

### `src/main/ipc/chatHandlers.ts`
- Add new IPC event: `a2ui-message` for streaming A2UI messages
- Add new IPC handler: `a2ui-action` for receiving user actions from renderer
- Wire `onA2UIMessage` callback to `webContents.send('a2ui-message', ...)`

### `src/main/preload.ts`
- Add `onA2UIMessage(callback)` listener to `window.electronAPI.chat`
- Add `dispatchA2UIAction(surfaceId, action)` method
- Add to type definitions

### `src/renderer/components/ChatPanel/ChatPanel.tsx`
- Remove protocol envelope handling (`result.envelope`, `buildActionPoliciesFromEnvelope`, `toClarificationElements`)
- Subscribe to `onA2UIMessage` events
- Feed A2UI messages to new A2UI surface state manager
- Render A2UI surface alongside chat transcript
- Handle A2UI actions (dispatch back via IPC)

### `src/renderer/components/AssistantSidebar/AssistantSidebar.tsx`
- Same changes as ChatPanel — A2UI surface rendering, remove protocol envelope

### `src/main/engine/ChatEngine.ts`
- Remove `getBuiltInSystemPrompt()` references to "AGUI payload" and protocol envelope
- Update system prompt to describe available UI tools instead
- Keep the rest (conversation CRUD, message persistence) as-is

### `src/renderer/navigation/assistantPanelSpec.ts`
- Keep the Zod schemas and `AssistantPanelElement` types — these become our component catalog definitions
- Remove `extractAssistantResponseContent()` and `extractAssistantPanelSpec()` (free-text JSON parsing) — no longer needed
- Export schemas for use by A2UI component registry

### `src/renderer/components/AssistantPanelControls/AssistantPanelControls.tsx`
- Refactor into individual component files that can be registered in an A2UI catalog
- Each component becomes a standalone renderer: `A2UIText`, `A2UIChart`, `A2UIForm`, etc.
- These map A2UI flat components (with data binding) to existing widget rendering

---

## Files to CREATE

### `src/main/a2ui/types.ts`
A2UI message types for our app. If `@a2ui-sdk/types` provides adequate types, re-export from there. Otherwise define:
- `A2UIServerMessage` (union of `CreateSurface | UpdateComponents | UpdateDataModel | DeleteSurface`)
- `A2UIClientAction` (action events from user interactions)
- `A2UIComponent` (flat component with ID + type + properties)
- `BDSCatalogId` — our custom catalog identifier

### `src/main/a2ui/generator.ts`
Converts tool call results into A2UI messages:
- `createChartSurface(toolArgs)` → `[createSurface, updateComponents, updateDataModel]`
- `createFormSurface(toolArgs)` → `[createSurface, updateComponents]`
- `createTableSurface(toolArgs)` → `[createSurface, updateComponents, updateDataModel]`
- etc.
Each function returns an array of A2UI messages to stream to the renderer.

### `src/main/a2ui/catalog.ts`
Defines the bDS component catalog — what component types we support:
- Maps A2UI basic catalog components to our implementations
- Adds custom components (chart, metric) not in A2UI basic catalog
- This is sent as client capabilities to inform the LLM what's available

### `src/renderer/a2ui/A2UISurfaceManager.ts`
Client-side state manager for A2UI surfaces:
- Maintains per-surface component buffer (Map<ComponentId, Component>)
- Maintains per-surface data model (JSON object)
- Processes incoming A2UI messages:
  - `createSurface` → initialize new surface
  - `updateComponents` → merge components into buffer
  - `updateDataModel` → update data at JSON Pointer path
  - `deleteSurface` → clean up
- Resolves flat component list into tree (using `children` ID references)
- Resolves data bindings (JSON Pointer → value)
- Emits render-ready component tree

### `src/renderer/a2ui/useA2UISurface.ts`
React hook that wraps `A2UISurfaceManager`:
- Subscribes to `onA2UIMessage` IPC events
- Feeds messages into surface manager
- Returns render-ready component tree + dispatch function for actions
- Handles progressive rendering (re-render as components arrive)

### `src/renderer/a2ui/A2UIRenderer.tsx`
React component that renders an A2UI surface:
- Takes component tree from `useA2UISurface`
- Maps each A2UI component type to a React component (from our catalog)
- Handles data binding for input components
- Dispatches actions on user interaction

### `src/renderer/a2ui/components/` (directory)
Individual component renderers, refactored from `AssistantPanelControls`:
- `A2UIText.tsx` — renders Text (with Markdown support)
- `A2UIButton.tsx` — renders Button with action
- `A2UICard.tsx` — renders Card with title/body/actions
- `A2UIChart.tsx` — renders Chart (custom, not in A2UI basic catalog)
- `A2UIForm.tsx` — renders form with fields
- `A2UITable.tsx` — renders data table
- `A2UITabs.tsx` — renders tabbed interface
- `A2UITextField.tsx` — renders text input with data binding
- `A2UICheckBox.tsx` — renders checkbox with data binding
- `A2UIDateTimeInput.tsx` — renders date picker
- `A2UIImage.tsx` — renders image with caption
- `A2UIMetric.tsx` — renders metric display (custom)
- `A2UIList.tsx` — renders item list
- `A2UIRow.tsx` / `A2UIColumn.tsx` — layout containers

### `tests/a2ui/` (directory)
- `generator.test.ts` — test A2UI message generation from tool calls
- `surfaceManager.test.ts` — test surface state management, component tree resolution, data binding
- `catalog.test.ts` — test component catalog registration

---

## Implementation Phases

### Phase 1: Foundation — A2UI Types, Surface Manager, IPC Transport
**Goal:** Get A2UI messages flowing from main process to renderer and being processed correctly.

1. Install `@a2ui-sdk/types` (or define our own types if the package doesn't cover v0.9 well)
2. Create `src/main/a2ui/types.ts` with message types
3. Create `src/renderer/a2ui/A2UISurfaceManager.ts` — process messages, maintain state, resolve tree
4. Write tests for surface manager (TDD: red → green → refactor)
5. Add `a2ui-message` IPC event to `chatHandlers.ts` and preload
6. Add `a2ui-action` IPC handler for action dispatch
7. Delete `src/main/agentic/` directory and all its tests

### Phase 2: A2UI Generator — Tool-Driven UI Creation
**Goal:** LLM can trigger rich UI by calling tools.

1. Create `src/main/a2ui/generator.ts` — converts tool args to A2UI messages
2. Create `src/main/a2ui/catalog.ts` — defines our component catalog
3. Add UI-rendering tools to `OpenCodeManager.getToolDefinitions()`:
   - `render_chart({ chartType, title, series })` — chartType includes `bar`, `stacked-bar`, `line`, `pie`
   - `render_table({ title, columns, rows })`
   - `render_form({ title, fields, submitAction })`
   - `render_card({ title, body, subtitle, actions })`
   - `render_metric({ label, value })`
   - `render_list({ title, items })`
   - `render_tabs({ tabs: [{ label, content }] })`
4. Add `executeTool` handlers that call generator and emit A2UI messages via `onA2UIMessage` callback
5. Write tests for generator (TDD)
6. Remove `protocolBoundaryInstructions`, protocol retry, envelope building from `OpenCodeManager`
7. Update `SendMessageResult` — remove `envelope`/`protocolVersion`/`traceId`

### Phase 3: A2UI Renderer — React Component Catalog
**Goal:** A2UI surfaces render as interactive UI in the chat.

1. Refactor `AssistantPanelControls` into individual component files under `src/renderer/a2ui/components/`
2. Create `src/renderer/a2ui/A2UIRenderer.tsx` — maps component types to React components
3. Create `src/renderer/a2ui/useA2UISurface.ts` — React hook for surface state
4. Integrate into `ChatPanel.tsx`:
   - Subscribe to `onA2UIMessage`
   - Render `A2UIRenderer` for each active surface
   - Handle actions
5. Integrate into `AssistantSidebar.tsx` (same pattern)
6. Remove old protocol envelope handling from both components
7. Write component tests

### Phase 4: System Prompt and LLM Integration
**Goal:** LLM knows about and uses UI tools effectively.

1. Update `ChatEngine.getBuiltInSystemPrompt()`:
   - Remove all "AGUI payload" / "protocol envelope" instructions
   - Add descriptions of UI tools and when to use them
   - Include examples: "When showing statistics, use render_chart. When showing a list of posts, use render_table."
2. Update system prompt to describe the component catalog available
3. Test end-to-end: user asks for a chart → LLM calls `render_chart` → A2UI messages → UI renders

### Phase 5: Actions, Data Binding, and Polish
**Goal:** Full interactivity — forms submit, buttons trigger actions, data flows both ways.

1. Implement action dispatch: renderer → IPC → main process → feed back to LLM as tool result
2. Implement two-way data binding for form inputs:
   - User edits input → local data model updates
   - Submit action includes current data model values
3. Add action confirmation policies (keep the existing silent/confirm/danger concept)
4. Handle surface lifecycle (delete surfaces when conversation changes)
5. Clean up: remove unused imports, dead code, duplicate schemas
6. Update `API.md` and Python API bindings if affected

### Phase 6: Cleanup and Tests
**Goal:** Zero failing tests, clean build, no dead code.

1. Delete all files listed in "Files to DELETE"
2. Remove all imports of deleted modules across the codebase
3. Run full test suite, fix all failures
4. Run `npm run build`, fix all build errors
5. Update `protocolActionPolicies.ts` and `protocolNeedsInput.ts` — either adapt for A2UI actions or delete if superseded
6. Delete `src/renderer/python/pythonApiContractV1.ts` changes if they reference the old protocol
7. Final review: no unused code, no commented-out code

---

## Component Catalog Mapping: Existing Widgets → A2UI Components

| Existing Widget | A2UI Component | Notes |
|----------------|----------------|-------|
| `text` | `Text` | Direct mapping, add Markdown support |
| `metric` | Custom `Metric` | Not in A2UI basic catalog — register as custom component |
| `list` | `List` | A2UI has List container |
| `table` | Custom `Table` | Not in A2UI basic catalog — register as custom |
| `action` | `Button` | A2UI uses Button with action events |
| `chart` | Custom `Chart` | Not in A2UI basic catalog — register as custom |
| `input` | `TextField` / `CheckBox` / `DateTimeInput` / `ChoicePicker` | A2UI splits by type |
| `form` | `Column` + form fields + `Button` | A2UI doesn't have a Form primitive — compose from layout + inputs |
| `card` | `Card` | Direct mapping |
| `image` | `Image` | Direct mapping |
| `tabs` | `Tabs` | Direct mapping |
| `datePicker` | `DateTimeInput` | A2UI equivalent |
| (new) `Row` | `Row` | Layout container |
| (new) `Column` | `Column` | Layout container |
| (new) `Divider` | `Divider` | Visual separator |

---

## Verification

After each phase, verify:

1. **Tests pass**: `npm test` — zero failures
2. **Build succeeds**: `npm run build` — no errors
3. **Manual test**: Send chat messages, verify:
   - Text responses render normally in chat
   - "Show me post statistics as a chart" → LLM calls `render_chart` → chart renders
   - "List my recent posts in a table" → LLM calls `render_table` → table renders
   - Forms render with inputs, submit works
   - Cards with action buttons work
   - Tab navigation works
   - Both ChatPanel and AssistantSidebar work
4. **No regression**: Existing tool calls (search_posts, read_post, etc.) still work
5. **No raw JSON visible**: Users never see protocol JSON in the chat

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| `@a2ui-sdk/types` doesn't cover v0.9 well | Define our own types — A2UI messages are simple JSON |
| LLM doesn't call UI tools reliably | Good tool descriptions + examples in system prompt; text fallback always works |
| Performance: many small IPC messages | Batch `updateComponents` messages; A2UI supports sending multiple components per message |
| Breaking existing functionality | Phase 1 deletes old code; each subsequent phase adds new functionality. Keep existing tool calls (search_posts etc.) unchanged. |
| A2UI spec changes (v0.9 is draft) | Our implementation is a subset; the flat component + data binding model is stable |
