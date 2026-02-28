import { describe, it, expect } from 'vitest';
import { buildMcpView, type McpViewConfig } from '../../src/main/engine/mcp-view-builder';

describe('mcp-view-builder', () => {
  describe('buildMcpView', () => {
    const minimalConfig: McpViewConfig = {
      title: 'Test View',
      waitingMessage: 'Waiting for data...',
      renderBody: `
        document.getElementById("review").innerHTML = "<h1>Hello</h1>";
      `,
      acceptLabel: 'Accept',
      discardLabel: 'Discard',
    };

    it('returns a valid HTML document', () => {
      const html = buildMcpView(minimalConfig);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('sets the page title', () => {
      const html = buildMcpView(minimalConfig);
      expect(html).toContain('<title>Test View</title>');
    });

    it('contains the waiting message', () => {
      const html = buildMcpView(minimalConfig);
      expect(html).toContain('Waiting for data...');
    });

    it('inlines the ext-apps bundle and exposes App globally', () => {
      const html = buildMcpView(minimalConfig);
      // The bundle is inlined (no external import URLs) — the loader strips the
      // ESM export block and exposes App on globalThis.__bdsExtApp so the page
      // script can instantiate it without a module specifier.
      expect(html).toContain('__bdsExtApp');
      expect(html).toContain('new App(');
      // Must NOT reference an external CDN for the bundle (distribution isolation).
      expect(html).not.toMatch(/<script[^>]+src=["']https?:/i);
      expect(html).not.toMatch(/<link[^>]+href=["']https?:/i);
    });

    it('contains accept and discard proposal handlers', () => {
      const html = buildMcpView(minimalConfig);
      expect(html).toContain('window.acceptProposal');
      expect(html).toContain('window.discardProposal');
    });

    it('uses custom button labels in renderBody', () => {
      const config: McpViewConfig = {
        ...minimalConfig,
        renderBody: `
      document.getElementById("review").innerHTML = \`
        <div class="actions">
          <button class="btn btn-accept" onclick="acceptProposal()">Accept</button>
          <button class="btn btn-discard" onclick="discardProposal()">Discard</button>
        </div>
      \`;`,
      };
      const html = buildMcpView(config);
      expect(html).toContain('onclick="acceptProposal()"');
      expect(html).toContain('onclick="discardProposal()"');
    });

    it('calls accept_proposal and discard_proposal tools via app bridge', () => {
      const html = buildMcpView(minimalConfig);
      expect(html).toContain('app.callServerTool');
      expect(html).toContain('"accept_proposal"');
      expect(html).toContain('"discard_proposal"');
    });

    it('contains the custom renderBody code', () => {
      const html = buildMcpView(minimalConfig);
      expect(html).toContain('document.getElementById("review").innerHTML = "<h1>Hello</h1>"');
    });

    it('uses module script type', () => {
      const html = buildMcpView(minimalConfig);
      expect(html).toContain('type="module"');
    });

    it('connects the App on load', () => {
      const html = buildMcpView(minimalConfig);
      expect(html).toContain('app.connect()');
    });

    it('has a status display element', () => {
      const html = buildMcpView(minimalConfig);
      expect(html).toContain('id="status"');
      expect(html).toContain('showStatus');
    });

    it('disables buttons during action', () => {
      const html = buildMcpView(minimalConfig);
      expect(html).toContain('setButtonsDisabled(true)');
    });

    it('uses XSS-safe escaping function', () => {
      const html = buildMcpView(minimalConfig);
      expect(html).toContain('function esc(');
      expect(html).toContain('document.createElement("div")');
    });

    it('renders tool result data via ontoolresult handler', () => {
      const html = buildMcpView(minimalConfig);
      expect(html).toContain('app.ontoolresult');
      expect(html).toContain('renderReview');
    });

    it('includes extra CSS when provided', () => {
      const config: McpViewConfig = {
        ...minimalConfig,
        extraCss: '.custom-class { color: red; }',
      };
      const html = buildMcpView(config);
      expect(html).toContain('.custom-class { color: red; }');
    });

    it('includes extra JS helpers when provided', () => {
      const config: McpViewConfig = {
        ...minimalConfig,
        extraJsHelpers: 'function fmt(v) { return String(v); }',
      };
      const html = buildMcpView(config);
      expect(html).toContain('function fmt(v) { return String(v); }');
    });

    it('does not include extra CSS/JS when not provided', () => {
      const html = buildMcpView(minimalConfig);
      // The shared CSS is always present; just ensure no extra markers
      expect(html).not.toContain('function fmt(');
    });
  });
});
