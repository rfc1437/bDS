/**
 * MCP App Review Views — generated at runtime from shared boilerplate
 * + per-view configuration via `buildMcpView()`.
 *
 * Each function returns a self-contained HTML page that uses the
 * `App` class from `@modelcontextprotocol/ext-apps` (loaded via
 * the `app-with-deps` bundle that includes its own dependencies).
 *
 * These Views are served as `ui://` resources and rendered inline
 * in MCP hosts that support MCP Apps (Claude, ChatGPT, VS Code, etc.).
 */

import { buildMcpView } from './mcp-view-builder';

/* ── Review Post ────────────────────────────────────────────────────── */

export function reviewPostHtml(): string {
  return buildMcpView({
    title: 'Review Post',
    waitingMessage: 'Waiting for post data...',
    acceptLabel: 'Publish',
    discardLabel: 'Discard Draft',
    renderBody: `\
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
      \`;`,
  });
}

/* ── Review Script ──────────────────────────────────────────────────── */

export function reviewScriptHtml(): string {
  return buildMcpView({
    title: 'Review Script',
    waitingMessage: 'Waiting for script data...',
    acceptLabel: 'Create Script',
    discardLabel: 'Discard',
    renderBody: `\
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
      \`;`,
  });
}

/* ── Review Template ────────────────────────────────────────────────── */

export function reviewTemplateHtml(): string {
  return buildMcpView({
    title: 'Review Template',
    waitingMessage: 'Waiting for template data...',
    acceptLabel: 'Create Template',
    discardLabel: 'Discard',
    renderBody: `\
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
      \`;`,
  });
}

/* ── Review Metadata ────────────────────────────────────────────────── */

export function reviewMetadataHtml(): string {
  return buildMcpView({
    title: 'Review Metadata',
    waitingMessage: 'Waiting for metadata...',
    acceptLabel: 'Apply Changes',
    discardLabel: 'Discard',
    extraCss: `\
    .diff-table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    .diff-table th, .diff-table td { padding: 6px 10px; border: 1px solid #dee2e6; text-align: left; font-size: 0.85rem; }
    .diff-table th { background: #f1f3f5; font-weight: 600; }
    .diff-old { background: #ffeef0; }
    .diff-new { background: #e6ffed; }`,
    extraJsHelpers: 'function fmt(v) { if (v == null) return "(empty)"; if (Array.isArray(v)) return v.join(", "); return String(v); }',
    renderBody: `\
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
      \`;`,
  });
}
