/**
 * MCP App Review Views — inline HTML strings for review UIs.
 *
 * Each function returns a self-contained HTML page that uses the
 * `App` class from `@modelcontextprotocol/ext-apps` (loaded via
 * the `app-with-deps` bundle that includes its own dependencies).
 *
 * These Views are served as `ui://` resources and rendered inline
 * in MCP hosts that support MCP Apps (Claude, ChatGPT, VS Code, etc.).
 */

function baseStyles(): string {
  return `
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
    .diff-table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    .diff-table th, .diff-table td { padding: 6px 10px; border: 1px solid #dee2e6; text-align: left; font-size: 0.85rem; }
    .diff-table th { background: #f1f3f5; font-weight: 600; }
    .diff-old { background: #ffeef0; }
    .diff-new { background: #e6ffed; }
    .word-count { color: #888; font-size: 0.8rem; }
  `;
}

function appScript(): string {
  return `
    import { App } from "@modelcontextprotocol/ext-apps/app-with-deps";

    const app = new App({ name: "bDS Review", version: "1.0.0" });

    let currentData = null;

    app.ontoolresult = (result) => {
      try {
        const textContent = result.content?.find(c => c.type === "text");
        if (textContent?.text) {
          currentData = JSON.parse(textContent.text);
          renderReview(currentData);
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
    window.renderReview = window.renderReview || (() => {});

    app.connect().catch(e => console.error("App connect failed:", e));
  `;
}

export function reviewPostHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Review Post</title>
<style>${baseStyles()}</style>
</head>
<body>
  <div id="review">
    <p class="meta">Waiting for post data...</p>
  </div>
  <div id="status" class="status" style="display:none"></div>
  <script type="module">
    ${appScript()}
    window.renderReview = (data) => {
      const post = data.post || {};
      const wc = (post.content || "").split(/\\s+/).filter(Boolean).length;
      document.getElementById("review").innerHTML = \`
        <h1>\${esc(post.title || "Untitled")}</h1>
        <p class="meta">
          <span class="badge badge-draft">Draft</span>
          <span class="word-count">\${wc} words</span>
        </p>
        \${post.categories?.length ? '<p class="meta">Categories: ' + post.categories.map(c => esc(c)).join(", ") + '</p>' : ''}
        \${post.tags?.length ? '<p class="meta">Tags: ' + post.tags.map(t => esc(t)).join(", ") + '</p>' : ''}
        \${post.excerpt ? '<h2>Excerpt</h2><p>' + esc(post.excerpt) + '</p>' : ''}
        <h2>Content</h2>
        <div class="content-preview">\${esc(post.content || "")}</div>
        <div class="actions">
          <button class="btn btn-accept" onclick="acceptProposal()">Publish</button>
          <button class="btn btn-discard" onclick="discardProposal()">Discard Draft</button>
        </div>
      \`;
    };
    function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  </script>
</body>
</html>`;
}

export function reviewScriptHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Review Script</title>
<style>${baseStyles()}</style>
</head>
<body>
  <div id="review">
    <p class="meta">Waiting for script data...</p>
  </div>
  <div id="status" class="status" style="display:none"></div>
  <script type="module">
    ${appScript()}
    window.renderReview = (data) => {
      const p = data.preview || data;
      document.getElementById("review").innerHTML = \`
        <h1>\${esc(p.title || "Untitled Script")}</h1>
        <p class="meta"><span class="badge badge-kind">\${esc(p.kind || "script")}</span></p>
        <h2>Python Code</h2>
        <div class="content-preview">\${esc(p.content || "(code not included in preview)")}</div>
        <div class="actions">
          <button class="btn btn-accept" onclick="acceptProposal()">Create Script</button>
          <button class="btn btn-discard" onclick="discardProposal()">Discard</button>
        </div>
      \`;
    };
    function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  </script>
</body>
</html>`;
}

export function reviewTemplateHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Review Template</title>
<style>${baseStyles()}</style>
</head>
<body>
  <div id="review">
    <p class="meta">Waiting for template data...</p>
  </div>
  <div id="status" class="status" style="display:none"></div>
  <script type="module">
    ${appScript()}
    window.renderReview = (data) => {
      const p = data.preview || data;
      document.getElementById("review").innerHTML = \`
        <h1>\${esc(p.title || "Untitled Template")}</h1>
        <p class="meta"><span class="badge badge-kind">\${esc(p.kind || "template")}</span></p>
        <h2>Liquid Template</h2>
        <div class="content-preview">\${esc(p.content || "(template not included in preview)")}</div>
        <div class="actions">
          <button class="btn btn-accept" onclick="acceptProposal()">Create Template</button>
          <button class="btn btn-discard" onclick="discardProposal()">Discard</button>
        </div>
      \`;
    };
    function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  </script>
</body>
</html>`;
}

export function reviewMetadataHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Review Metadata Changes</title>
<style>${baseStyles()}</style>
</head>
<body>
  <div id="review">
    <p class="meta">Waiting for metadata data...</p>
  </div>
  <div id="status" class="status" style="display:none"></div>
  <script type="module">
    ${appScript()}
    window.renderReview = (data) => {
      const current = data.current || {};
      const proposed = data.proposed || {};
      const fields = Object.keys(proposed);
      let rows = fields.map(f => \`
        <tr>
          <td><strong>\${esc(f)}</strong></td>
          <td class="diff-old">\${esc(fmt(current[f]))}</td>
          <td class="diff-new">\${esc(fmt(proposed[f]))}</td>
        </tr>
      \`).join("");
      document.getElementById("review").innerHTML = \`
        <h1>Metadata Changes</h1>
        <table class="diff-table">
          <thead><tr><th>Field</th><th>Current</th><th>Proposed</th></tr></thead>
          <tbody>\${rows}</tbody>
        </table>
        <div class="actions">
          <button class="btn btn-accept" onclick="acceptProposal()">Apply Changes</button>
          <button class="btn btn-discard" onclick="discardProposal()">Discard</button>
        </div>
      \`;
    };
    function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
    function fmt(v) { if (v == null) return "(empty)"; if (Array.isArray(v)) return v.join(", "); return String(v); }
  </script>
</body>
</html>`;
}
