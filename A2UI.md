# A2UI Modernization Plan (Protocol-First)

## Purpose

This document defines the target architecture and execution plan to evolve the current chat assistant from a retrofit UI renderer into a mature, best-practice, protocol-first Agentic UI system.

Branch goal: ship a full-fledged assistant that can use all app capabilities, ask clarifying questions through rich UI controls, and reliably present actionable responses in both chat surfaces.

---

## Product Goal for This Branch

Build a **protocol-first chat assistant** that:

1. Emits deterministic structured responses and UI controls.
2. Uses rich UI to gather missing inputs (forms, pickers, approvals).
3. Executes app actions safely and reports outcomes back into the reasoning loop.
4. Works identically in editor chat and assistant sidebar.
5. Is observable, testable, and versioned for internal iteration.

## Implementation Status (This Branch)

- ✅ Phase 0 — Foundation Contracts (**completed 2026-02-25**)
- ✅ Phase 1 — Server-Side Enforcement + Repair Loop (**completed 2026-02-25**)
- ✅ Phase 2 — Capability Registry + Negotiation (**completed 2026-02-25**)
- ✅ Phase 3 — Workflow Engine and Clarification UX (**completed 2026-02-25**)
- ✅ Phase 4 — Action Policy and Safety (**completed 2026-02-25**)
- ✅ Phase 5 — Observability and QA (**completed 2026-02-25**)

### Implemented Artifacts

- `src/main/agentic/protocol/types.ts`
- `src/main/agentic/protocol/errors.ts`
- `src/main/agentic/protocol/validator.ts`
- `src/main/agentic/protocol/uiSchema.ts`
- `src/main/agentic/protocol/uiSpecParser.ts`
- `src/main/agentic/protocol/responseBuilder.ts`
- `src/main/agentic/capabilities/registry.ts`
- `src/main/agentic/workflow/turnStateMachine.ts`
- `src/main/agentic/workflow/checkpointStore.ts`
- `src/main/agentic/policy/actionPolicy.ts`
- `src/main/agentic/observability/protocolTelemetry.ts`

### Branch Completion Notes

- Main-process protocol validation/envelope building now runs server-side before renderer consumption.
- Renderer consumes protocol envelope directly; legacy text parsing remains as compatibility fallback only.
- Capability snapshots are injected into each model request and unsupported widgets/actions are filtered with diagnostics.
- Workflow checkpoints are persisted per conversation for resumable needs-input turns.
- Action policy levels (`silent`, `confirm`, `danger`) are enforced at render-time before dispatch.
- Protocol telemetry is emitted and available via `chat:getProtocolHealth` IPC.

---

## Current State (Baseline)

### Already implemented

- A2UI schema parsing for canonical `specVersion: "1"` payloads.
- Rich widget rendering (chart, form, input, datePicker, card, image, tabs).
- Shared controls renderer reused by both chat surfaces.
- Text + UI mixed response extraction.
- Action dispatcher and action-result persistence to chat history.
- Metadata propagation (`surface: tab|sidebar`) through renderer → preload → IPC → manager.
- Compatibility normalization for common non-canonical model outputs.

### Why this is still retrofit

- Structured output is still inferred from free-form model text.
- UI contract is validated client-side after generation, not guaranteed at generation time.
- No explicit protocol envelope enforced server-side each turn.
- No formal capability handshake/version negotiation.
- No repair/retry orchestration as a first-class protocol step.
- No end-to-end telemetry contract for A2UI reliability metrics.

---

## Missing Elements to Reach Best Practice

## 1) Protocol Contract Maturity

- Missing: strict response envelope (`assistant_text`, `ui`, `intent`, `confidence`, `needs_input`).
- Missing: request envelope (`messages`, `context`, `capabilities`, `surface`, `protocol_version`).
- Missing: version negotiation and deprecation strategy.
- Missing: canonical machine-readable error model for invalid A2UI payloads.

## 2) Model Interaction Strategy

- Missing: hard structured-output mode at provider call boundary.
- Missing: deterministic prompt templates per intent class (analysis, edit, workflow).
- Missing: first-class clarification mode (`needs_input`) with required fields contract.
- Missing: server-side repair loop when response is invalid or incomplete.

## 3) Capability Discovery / Negotiation

- Missing: runtime capability registry sent to model each turn.
- Missing: widget/action availability by surface and app state.
- Missing: capability flags for disabled features and permission gates.

## 4) Agent Workflow Engine

- Missing: protocol-level finite-state turn machine (Plan → Ask → Execute → Observe → Continue).
- Missing: action dependency graph for multi-step guided flows.
- Missing: state checkpointing for resumable workflows.

## 5) UI Runtime and Action Safety

- Missing: explicit action confirmation policy levels (`silent`, `confirm`, `danger`).
- Missing: standardized form validation and inline error schema.
- Missing: universal fallback component for unsupported widgets.
- Missing: deterministic conflict handling for stale context.

## 6) Observability and Reliability

- Missing: telemetry for parse success, fallback rate, repair rate, action success.
- Missing: protocol health dashboard and SLOs.
- Missing: reproducible turn traces for debugging and regression analysis.

## 7) Test Architecture

- Missing: protocol conformance suite (golden request/response cases).
- Missing: end-to-end A2UI scenario tests (clarify + execute + reflect).
- Missing: fuzz tests for malformed payload handling.
- Missing: migration tests for protocol version compatibility.

## 8) Governance and Docs

- Missing: authoritative A2UI protocol spec doc with examples.
- Missing: widget/action compatibility matrix by version.
- Missing: internal governance for protocol changes and ownership boundaries.

---

## Target Architecture (Protocol-First)

## A. Core Components

1. **A2UI Protocol Layer (Main Process)**
   - Owns request/response envelopes, validation, normalization, repair loop.

2. **Capability Registry Service (Main Process)**
   - Publishes current widgets/actions/tools/features by surface and context.

3. **Agent Orchestrator (Main Process)**
   - Executes turn state machine and mediates tool calls + UI requests.

4. **Action Runtime (Renderer + Main IPC)**
   - Executes declared actions with policy checks and structured result events.

5. **A2UI Renderer (Renderer Shared)**
   - Renders protocol `ui` payloads with strict schema and graceful fallbacks.

6. **Observability Pipeline (Main + Renderer)**
   - Emits protocol metrics and trace IDs for each turn.

## B. Canonical Envelope (v2 proposal)

```json
{
  "protocolVersion": "2.0",
  "assistantText": "...",
  "ui": {
    "specVersion": "1",
    "elements": []
  },
  "intent": "analyze|ask_input|propose_action|execute_action|summarize",
  "needsInput": {
    "required": false,
    "fields": []
  },
  "actions": [],
  "confidence": 0.0,
  "traceId": "..."
}
```

Rules:

- `assistantText` is always present (possibly empty string).
- `ui` is optional but schema-valid when present.
- `needsInput.required=true` requires at least one field in `needsInput.fields`.
- `actions` are declarative, validated against capability registry.
- Unknown properties are rejected in strict mode.

### Canonical Request Envelope Example

```json
{
   "protocolVersion": "2.0",
   "surface": "tab",
   "messages": [
      { "role": "user", "content": "Show posting trend by month" }
   ],
   "context": {
      "projectId": "project-1"
   },
   "capabilities": {
      "widgets": ["chart", "form", "tabs"],
      "actions": ["openPost", "openSettings"],
      "tools": ["search_posts", "list_posts"],
      "disabled": []
   }
}
```

### Invalid Envelope Example (strict mode)

```json
{
   "protocolVersion": "2.0",
   "assistantText": "Please provide missing fields",
   "intent": "ask_input",
   "needsInput": {
      "required": true,
      "fields": []
   },
   "actions": [],
   "confidence": 0.9,
   "traceId": "trace-123",
   "extra": "not-allowed"
}
```

Reason invalid:

- `needsInput.required=true` but `needsInput.fields` is empty.
- `extra` is an unknown property in strict mode.

### Protocol Error Codes

- `A2UI_PROTOCOL_VALIDATION_ERROR`
   - Emitted for request/response envelope validation failures.
   - Includes human-readable `message` and per-field `details`.

---

## Implementation Plan (Phased)

## Phase 0 — Foundation Contracts (Required First)

### Scope

- Add A2UI protocol specification section in repo docs.
- Introduce canonical request/response TypeScript contracts.
- Add protocol validator module in main process.

### Deliverables

- `src/main/agentic/protocol/types.ts`
- `src/main/agentic/protocol/validator.ts`
- `A2UI.md` + protocol examples + error codes

### Acceptance Criteria

- All responses crossing IPC can be validated by `protocolVersion`.
- Invalid payloads produce structured protocol errors, never silent drops.

## Phase 1 — Server-Side Enforcement + Repair Loop

### Scope

- Move UI parsing/normalization from renderer-first to main-first.
- Implement deterministic repair retry when response violates contract.
- Remove legacy response handling once envelope enforcement is in place.

### Deliverables

- `ProtocolResponseBuilder` in main process.
- `repairAttempt` policy with max retry count + fallback response.
- Trace IDs propagated to renderer.

### Acceptance Criteria

- 95%+ UI-intent prompts return valid envelope without client fallback.
- No renderer-side protocol normalization required for valid turns.

## Phase 2 — Capability Registry + Negotiation

### Scope

- Add runtime registry of widgets/actions/tools per surface/context.
- Inject capability snapshot into every model request.
- Validate action and widget availability before returning to renderer.

### Deliverables

- `src/main/agentic/capabilities/registry.ts`
- Capability snapshot in request envelope.
- Contract tests for per-surface differences.

### Acceptance Criteria

- Model never receives unsupported widget/action lists.
- Unsupported action attempts are blocked pre-render with clear diagnostics.

## Phase 3 — Workflow Engine and Clarification UX

### Scope

- Implement turn state machine with explicit `needsInput` handling.
- Add reusable clarification controls (forms/selects/date/radio).
- Persist workflow state for resumable conversations.

### Deliverables

- `AgentTurnStateMachine` module.
- Clarification form primitives + validation schema.
- Workflow checkpoint storage.

### Acceptance Criteria

- Assistant can pause for missing data and resume execution deterministically.
- Multi-step tasks survive app refresh/reopen.

## Phase 4 — Action Policy and Safety

### Scope

- Add action policy levels and confirmation requirements.
- Add preconditions and postconditions for critical actions.
- Add structured rollback hints for reversible actions.

### Deliverables

- Action policy map.
- Confirmation UI flow integrated into A2UI actions.
- Action audit log entries with trace IDs.

### Acceptance Criteria

- Dangerous actions always require explicit confirmation.
- Every executed action emits structured success/failure payload.

## Phase 5 — Observability and QA

### Scope

- Instrument protocol metrics and error taxonomy.
- Build conformance + E2E A2UI test suites.
- Add internal test gates that block merges on protocol drift.

### Deliverables

- Protocol metrics dashboard.
- Golden test fixtures for representative workflows.
- CI quality gates for protocol conformance and A2UI scenarios.

### Acceptance Criteria

- Defined SLOs met for parse validity, action success, and fallback rate.
- Regression suite blocks merges on protocol drift.

---

## Architectural Rework Tasks (Concrete Backlog)

## Main Process

- Create `agentic/` domain package with protocol/orchestrator/capabilities.
- Refactor `OpenCodeManager` response handling into envelope builder.
- Add repair retry policy for chart/control requests.
- Add `traceId` generation and propagation.

## IPC / Shared Contracts

- Version all chat IPC payloads with `protocolVersion`.
- Replace raw string assistant response return with envelope return.
- Remove or rewrite legacy IPC methods that cannot satisfy envelope guarantees.

## Renderer

- Consume envelope (`assistantText` + `ui`) directly.
- Remove renderer responsibility for protocol normalization over time.
- Keep widget renderer pure and stateless by schema.

## Testing

- Add protocol conformance tests for all envelope fields.
- Add model-output compatibility fixtures and repair-path tests.
- Add scenario tests: “ask chart” → chart render → user input → action execute.

## Documentation

- Add A2UI protocol appendix with canonical and invalid examples.
- Add migration guide from legacy message parsing to v2 envelope.

---

## Success Metrics (Definition of Done)

The branch is complete when:

1. **Protocol reliability**
   - ≥ 98% of A2UI-intent turns produce valid envelope without renderer fallback.

2. **UI execution reliability**
   - ≥ 95% of emitted actions execute successfully or fail with structured actionable error.

3. **Clarification quality**
   - Missing-input tasks use `needsInput` controls instead of textual back-and-forth in ≥ 90% of cases.

4. **Cross-surface parity**
   - Same A2UI payload renders and behaves equivalently in chat tab and sidebar.

5. **Governance and maintainability**
   - Protocol conformance suite and migration tests are mandatory in CI.

---

## Risks and Mitigations

- **Risk:** Provider inconsistency in structured outputs.
  - **Mitigation:** enforce server-side validation + repair loop + fallback envelope.

- **Risk:** Action safety regressions.
  - **Mitigation:** policy levels, confirmations, audit logs, blocked dangerous defaults.

- **Risk:** Protocol churn breaks compatibility.
   - **Mitigation:** strict versioned envelopes, migration tests, and single-source protocol ownership.

- **Risk:** Feature complexity growth.
  - **Mitigation:** domain separation (`protocol`, `orchestrator`, `renderer`), clear ownership boundaries.

---

## Recommended Execution Order for This Branch

1. Phase 0 + Phase 1 (contract + enforcement + repair)
2. Phase 2 (capability negotiation)
3. Phase 3 (clarification/workflow engine)
4. Phase 4 (safety policy)
5. Phase 5 (observability + QA)

This order converts the current retrofit into a stable protocol platform first, then builds mature agentic behavior on top.
