import { describe, it, expect } from 'vitest';
import {
  reviewPostHtml,
  reviewScriptHtml,
  reviewTemplateHtml,
  reviewMetadataHtml,
} from '../../src/main/engine/mcp-views';

describe('mcp-views', () => {
  describe('reviewPostHtml', () => {
    it('returns valid HTML document', () => {
      const html = reviewPostHtml();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('inlines ext-apps bundle and uses App class', () => {
      const html = reviewPostHtml();
      expect(html).toContain('__bdsExtApp'); // inlined bundle sets global
      expect(html).toContain('new App(');   // SHARED_JS uses the global
    });

    it('contains accept and discard buttons', () => {
      const html = reviewPostHtml();
      expect(html).toContain('acceptProposal()');
      expect(html).toContain('discardProposal()');
    });

    it('calls accept_proposal and discard_proposal tools via app bridge', () => {
      const html = reviewPostHtml();
      expect(html).toContain('app.callServerTool');
      expect(html).toContain('"accept_proposal"');
      expect(html).toContain('"discard_proposal"');
    });

    it('contains post-specific UI elements', () => {
      const html = reviewPostHtml();
      expect(html).toContain('Review Post');
      expect(html).toContain('Publish');
      expect(html).toContain('badge-draft');
      expect(html).toContain('word-count');
    });

    it('renders tool result data via ontoolresult handler', () => {
      const html = reviewPostHtml();
      expect(html).toContain('app.ontoolresult');
      expect(html).toContain('renderReview');
    });

    it('uses XSS-safe escaping function', () => {
      const html = reviewPostHtml();
      expect(html).toContain('function esc(');
      expect(html).toContain('document.createElement("div")');
    });
  });

  describe('reviewScriptHtml', () => {
    it('returns valid HTML document', () => {
      const html = reviewScriptHtml();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('inlines ext-apps bundle and uses App class', () => {
      const html = reviewScriptHtml();
      expect(html).toContain('__bdsExtApp');
      expect(html).toContain('new App(');
    });

    it('contains accept and discard buttons', () => {
      const html = reviewScriptHtml();
      expect(html).toContain('acceptProposal()');
      expect(html).toContain('discardProposal()');
    });

    it('contains script-specific UI elements', () => {
      const html = reviewScriptHtml();
      expect(html).toContain('Review Script');
      expect(html).toContain('Create Script');
      expect(html).toContain('Python Code');
    });
  });

  describe('reviewTemplateHtml', () => {
    it('returns valid HTML document', () => {
      const html = reviewTemplateHtml();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('inlines ext-apps bundle and uses App class', () => {
      const html = reviewTemplateHtml();
      expect(html).toContain('__bdsExtApp');
      expect(html).toContain('new App(');
    });

    it('contains accept and discard buttons', () => {
      const html = reviewTemplateHtml();
      expect(html).toContain('acceptProposal()');
      expect(html).toContain('discardProposal()');
    });

    it('contains template-specific UI elements', () => {
      const html = reviewTemplateHtml();
      expect(html).toContain('Review Template');
      expect(html).toContain('Create Template');
      expect(html).toContain('Liquid Template');
    });
  });

  describe('reviewMetadataHtml', () => {
    it('returns valid HTML document', () => {
      const html = reviewMetadataHtml();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('inlines ext-apps bundle and uses App class', () => {
      const html = reviewMetadataHtml();
      expect(html).toContain('__bdsExtApp');
      expect(html).toContain('new App(');
    });

    it('contains accept and discard buttons', () => {
      const html = reviewMetadataHtml();
      expect(html).toContain('acceptProposal()');
      expect(html).toContain('discardProposal()');
    });

    it('contains metadata-diff UI elements', () => {
      const html = reviewMetadataHtml();
      expect(html).toContain('Metadata Changes');
      expect(html).toContain('Apply Changes');
      expect(html).toContain('diff-table');
      expect(html).toContain('Current');
      expect(html).toContain('Proposed');
    });

    it('contains diff formatting function', () => {
      const html = reviewMetadataHtml();
      expect(html).toContain('function fmt(');
      expect(html).toContain('diff-old');
      expect(html).toContain('diff-new');
    });
  });

  describe('shared behavior', () => {
    const allViews = [
      { name: 'reviewPostHtml', fn: () => reviewPostHtml() },
      { name: 'reviewScriptHtml', fn: () => reviewScriptHtml() },
      { name: 'reviewTemplateHtml', fn: () => reviewTemplateHtml() },
      { name: 'reviewMetadataHtml', fn: () => reviewMetadataHtml() },
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
