import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  reviewPostHtml,
  reviewScriptHtml,
  reviewTemplateHtml,
  reviewMetadataHtml,
  resolveMcpViewsDirs,
  loadViewHtml,
} from '../../src/main/engine/mcp-views';

const viewOpts = {
  moduleDir: path.resolve(__dirname, '../../src/main/engine'),
};

describe('mcp-views', () => {
  describe('resolveMcpViewsDirs', () => {
    it('returns candidate directories', () => {
      const dirs = resolveMcpViewsDirs(viewOpts);
      expect(dirs.length).toBeGreaterThanOrEqual(2);
      expect(dirs.some(d => d.includes('mcp-views'))).toBe(true);
    });
  });

  describe('loadViewHtml', () => {
    it('loads an existing view file', () => {
      const html = loadViewHtml('review-post.html', viewOpts);
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('throws for a non-existent view', () => {
      expect(() => loadViewHtml('does-not-exist.html', viewOpts)).toThrow(
        /not found/,
      );
    });
  });

  describe('reviewPostHtml', () => {
    it('returns valid HTML document', () => {
      const html = reviewPostHtml(viewOpts);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('contains App import from ext-apps', () => {
      const html = reviewPostHtml(viewOpts);
      expect(html).toContain('@modelcontextprotocol/ext-apps/app-with-deps');
      expect(html).toContain('new App(');
    });

    it('contains accept and discard buttons', () => {
      const html = reviewPostHtml(viewOpts);
      expect(html).toContain('acceptProposal()');
      expect(html).toContain('discardProposal()');
    });

    it('calls accept_proposal and discard_proposal tools via app bridge', () => {
      const html = reviewPostHtml(viewOpts);
      expect(html).toContain('app.callServerTool');
      expect(html).toContain('"accept_proposal"');
      expect(html).toContain('"discard_proposal"');
    });

    it('contains post-specific UI elements', () => {
      const html = reviewPostHtml(viewOpts);
      expect(html).toContain('Review Post');
      expect(html).toContain('Publish');
      expect(html).toContain('badge-draft');
      expect(html).toContain('word-count');
    });

    it('renders tool result data via ontoolresult handler', () => {
      const html = reviewPostHtml(viewOpts);
      expect(html).toContain('app.ontoolresult');
      expect(html).toContain('renderReview');
    });

    it('uses XSS-safe escaping function', () => {
      const html = reviewPostHtml(viewOpts);
      expect(html).toContain('function esc(');
      expect(html).toContain('document.createElement("div")');
    });
  });

  describe('reviewScriptHtml', () => {
    it('returns valid HTML document', () => {
      const html = reviewScriptHtml(viewOpts);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('contains App import from ext-apps', () => {
      const html = reviewScriptHtml(viewOpts);
      expect(html).toContain('@modelcontextprotocol/ext-apps/app-with-deps');
    });

    it('contains accept and discard buttons', () => {
      const html = reviewScriptHtml(viewOpts);
      expect(html).toContain('acceptProposal()');
      expect(html).toContain('discardProposal()');
    });

    it('contains script-specific UI elements', () => {
      const html = reviewScriptHtml(viewOpts);
      expect(html).toContain('Review Script');
      expect(html).toContain('Create Script');
      expect(html).toContain('Python Code');
    });
  });

  describe('reviewTemplateHtml', () => {
    it('returns valid HTML document', () => {
      const html = reviewTemplateHtml(viewOpts);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('contains App import from ext-apps', () => {
      const html = reviewTemplateHtml(viewOpts);
      expect(html).toContain('@modelcontextprotocol/ext-apps/app-with-deps');
    });

    it('contains accept and discard buttons', () => {
      const html = reviewTemplateHtml(viewOpts);
      expect(html).toContain('acceptProposal()');
      expect(html).toContain('discardProposal()');
    });

    it('contains template-specific UI elements', () => {
      const html = reviewTemplateHtml(viewOpts);
      expect(html).toContain('Review Template');
      expect(html).toContain('Create Template');
      expect(html).toContain('Liquid Template');
    });
  });

  describe('reviewMetadataHtml', () => {
    it('returns valid HTML document', () => {
      const html = reviewMetadataHtml(viewOpts);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('contains App import from ext-apps', () => {
      const html = reviewMetadataHtml(viewOpts);
      expect(html).toContain('@modelcontextprotocol/ext-apps/app-with-deps');
    });

    it('contains accept and discard buttons', () => {
      const html = reviewMetadataHtml(viewOpts);
      expect(html).toContain('acceptProposal()');
      expect(html).toContain('discardProposal()');
    });

    it('contains metadata-diff UI elements', () => {
      const html = reviewMetadataHtml(viewOpts);
      expect(html).toContain('Metadata Changes');
      expect(html).toContain('Apply Changes');
      expect(html).toContain('diff-table');
      expect(html).toContain('Current');
      expect(html).toContain('Proposed');
    });

    it('contains diff formatting function', () => {
      const html = reviewMetadataHtml(viewOpts);
      expect(html).toContain('function fmt(');
      expect(html).toContain('diff-old');
      expect(html).toContain('diff-new');
    });
  });

  describe('shared behavior', () => {
    const allViews = [
      { name: 'reviewPostHtml', fn: () => reviewPostHtml(viewOpts) },
      { name: 'reviewScriptHtml', fn: () => reviewScriptHtml(viewOpts) },
      { name: 'reviewTemplateHtml', fn: () => reviewTemplateHtml(viewOpts) },
      { name: 'reviewMetadataHtml', fn: () => reviewMetadataHtml(viewOpts) },
    ];

    it.each(allViews)('$name connects the App on load', ({ fn }) => {
      const html = fn();
      expect(html).toContain('app.connect()');
    });

    it.each(allViews)('$name has a status display element', ({ fn }) => {
      const html = fn();
      expect(html).toContain('id="status"');
      expect(html).toContain('showStatus');
    });

    it.each(allViews)('$name disables buttons during action', ({ fn }) => {
      const html = fn();
      expect(html).toContain('setButtonsDisabled(true)');
    });

    it.each(allViews)('$name uses module script type', ({ fn }) => {
      const html = fn();
      expect(html).toContain('type="module"');
    });
  });
});
