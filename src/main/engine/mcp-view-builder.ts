/**
 * MCP App Review View Builder — generates self-contained HTML pages
 * from shared boilerplate + per-view configuration.
 *
 * Each generated page uses the `App` class from
 * `@modelcontextprotocol/ext-apps` (inlined as a self-contained script)
 * and is served as a `ui://` resource for MCP hosts.
 *
 * The bundle is loaded from disk once and cached; it cannot use bare
 * specifiers in the sandboxed iframe, so it is inlined directly.
 */

import * as fs from 'fs';

/** Configuration for a single MCP review view. */
export interface McpViewConfig {
  /** Page <title>. */
  title: string;
  /** Text shown in the review area before data arrives. */
  waitingMessage: string;
  /**
   * The body of the `window.renderReview = (data) => { ... }` function.
   * Has access to `data`, `esc()`, `document`, and any helpers defined
   * in `extraJsHelpers`. Must set `document.getElementById("review").innerHTML`.
   */
  renderBody: string;
  /** Label for the accept/confirm button (e.g. "Publish", "Create Template"). */
  acceptLabel: string;
  /** Label for the discard/cancel button (e.g. "Discard", "Discard Draft"). */
  discardLabel: string;
  /** Additional CSS rules appended after the shared stylesheet. */
  extraCss?: string;
  /** Additional JS helper functions placed before `renderReview`. */
  extraJsHelpers?: string;
}

/* ── Shared CSS ─────────────────────────────────────────────────────── */

const SHARED_CSS = `\
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 16px; color: #1a1a1a; background: #fff; line-height: 1.5; }
    h1 { font-size: 1.25rem; margin-bottom: 12px; }
    h2 { font-size: 1rem; margin: 12px 0 8px; color: #555; }
    .meta { color: #666; font-size: 0.875rem; margin-bottom: 8px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .badge-draft { background: #fef3cd; color: #856404; }
    .badge-kind { background: #d1ecf1; color: #0c5460; }
    .content-preview { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; padding: 12px; margin: 8px 0; overflow-x: auto; white-space: pre-wrap; font-family: monospace; font-size: 0.85rem; max-height: 400px; overflow-y: auto; }
    .actions { display: flex; gap: 8px; margin-top: 16px; }
    .btn { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: 0.875rem; font-weight: 500; }
    .btn-accept { background: #28a745; color: #fff; }
    .btn-accept:hover { background: #218838; }
    .btn-discard { background: #dc3545; color: #fff; }
    .btn-discard:hover { background: #c82333; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { margin-top: 12px; padding: 8px 12px; border-radius: 6px; font-size: 0.875rem; }
    .status-success { background: #d4edda; color: #155724; }
    .status-error { background: #f8d7da; color: #721c24; }
    .word-count { color: #888; font-size: 0.8rem; }`;

/* ── Inline bundle loader ───────────────────────────────────────────── */

let _appBundle: string | null = null;

/**
 * Read the `app-with-deps` ESM bundle from node_modules, strip its
 * `export{...}` block, and add `globalThis.__bdsExtApp = App_internal_name;`
 * so the App class is accessible as a global from a plain `<script>` tag.
 * Result is cached after the first call.
 */
function getAppBundle(): string {
  if (_appBundle !== null) {
    return _appBundle;
  }

   
  const bundlePath: string = require.resolve('@modelcontextprotocol/ext-apps/app-with-deps');
  let source = fs.readFileSync(bundlePath, 'utf-8');

  // The bundle ends with export{...,X as App,...}.
  // Extract the internal variable name for `App`.
  const match = source.match(/export\{[^}]*\b(\w+)\s+as\s+App\b[^}]*\}/);
  if (!match) {
    throw new Error('Could not find App export in app-with-deps bundle');
  }
  const internalName = match[1];

  // Strip ESM export block and expose App class on globalThis.
  source = source.replace(/export\{[^}]+\}/, '');
  source += `\nglobalThis.__bdsExtApp=${internalName};`;

  _appBundle = source;
  return _appBundle;
}

/* ── Shared JS ──────────────────────────────────────────────────────── */

const SHARED_JS = `\
    const App = globalThis.__bdsExtApp;
    if (!App) {
      document.getElementById("status").textContent = "Error: App bundle not loaded"; document.getElementById("status").className = "status status-error"; document.getElementById("status").style.display = "block"; throw new Error("App bundle not loaded");
    }

    const app = new App({ name: "bDS Review", version: "1.0.1" });

    let currentData = null;

    app.ontoolresult = (result) => {
      try {
        const textContent = result.content?.find(c => c.type === "text");
        if (textContent?.text) {
          currentData = JSON.parse(textContent.text);
          renderReview(currentData);
        } else {
          showStatus("Tool result received but no text content found. Raw: " + JSON.stringify(result).slice(0, 200), "error");
        }
      } catch (e) {
        showStatus("Failed to parse tool result: " + e.message, "error");
      }
    };

    window.acceptProposal = async () => {
      if (!currentData?.proposalId) return;
      setButtonsDisabled(true);
      try {
        const result = await app.callServerTool({
          name: "accept_proposal",
          arguments: { proposalId: currentData.proposalId }
        });
        const text = result.content?.find(c => c.type === "text")?.text;
        const parsed = text ? JSON.parse(text) : {};
        showStatus(parsed.success ? "Accepted!" : (parsed.message || "Failed"), parsed.success ? "success" : "error");
      } catch (e) {
        showStatus("Error: " + e.message, "error");
      }
    };

    window.discardProposal = async () => {
      if (!currentData?.proposalId) return;
      setButtonsDisabled(true);
      try {
        const result = await app.callServerTool({
          name: "discard_proposal",
          arguments: { proposalId: currentData.proposalId }
        });
        const text = result.content?.find(c => c.type === "text")?.text;
        const parsed = text ? JSON.parse(text) : {};
        showStatus(parsed.success ? "Discarded." : (parsed.message || "Failed"), parsed.success ? "success" : "error");
      } catch (e) {
        showStatus("Error: " + e.message, "error");
      }
    };

    function setButtonsDisabled(disabled) {
      document.querySelectorAll(".btn").forEach(b => b.disabled = disabled);
    }

    function showStatus(message, type) {
      const el = document.getElementById("status");
      if (el) {
        el.textContent = message;
        el.className = "status status-" + type;
        el.style.display = "block";
      }
    }

    window.showStatus = showStatus;
    function esc(s) {
      const d = document.createElement("div"); d.textContent = s; return d.innerHTML;
    }

    window.__connectApp = () => {
      app.connect()
        .then(() => {
          showStatus("Connected — waiting for tool result…", "success");
        })
        .catch(e => {
          showStatus("Failed to connect to host: " + e.message, "error");
          console.error("App connect failed:", e);
        });
    };`;

/* ── Builder ────────────────────────────────────────────────────────── */

/**
 * Build a self-contained HTML page for an MCP review view.
 *
 * The output is a complete `<!DOCTYPE html>` document that can be served
 * directly as a `ui://` resource.
 */
export function buildMcpView(config: McpViewConfig): string {
  const extraCss = config.extraCss ? `\n${config.extraCss}` : '';
  const extraJs = config.extraJsHelpers ? `\n    ${config.extraJsHelpers}` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${config.title}</title>
<style>
${SHARED_CSS}${extraCss}
</style>
</head>
<body>
  <div id="review">
    <p class="meta">${config.waitingMessage}</p>
  </div>
  <div id="status" class="status" style="display:none"></div>
  <script>${getAppBundle()}</script>
  <script type="module">
${SHARED_JS}${extraJs}

    window.renderReview = (data) => {
${config.renderBody}
    };

    window.__connectApp();
  </script>
</body>
</html>
`;
}
