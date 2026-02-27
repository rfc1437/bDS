import { describe, expect, it } from 'vitest';
import {
  getChatTabSpec,
  getEntityTabSpec,
  getGitDiffCommitTabSpec,
  getGitDiffFileTabSpec,
  getImportTabSpec,
  getScriptTabSpec,
  getTemplateTabSpec,
  parseGitDiffTabId,
  openChatTab,
  getSingletonToolTabSpec,
  openEntityTab,
  openGitDiffCommitTab,
  openGitDiffFileTab,
  openImportTab,
  openScriptTab,
  openTemplateTab,
  openSingletonToolTab,
} from '../../../src/renderer/navigation/tabPolicy';

describe('tabPolicy', () => {
  it('provides canonical singleton tab specs', () => {
    expect(getSingletonToolTabSpec('settings')).toEqual({ type: 'settings', id: 'settings', isTransient: false });
    expect(getSingletonToolTabSpec('tags')).toEqual({ type: 'tags', id: 'tags', isTransient: false });
    expect(getSingletonToolTabSpec('style')).toEqual({ type: 'style', id: 'style', isTransient: false });
    expect(getSingletonToolTabSpec('scripts')).toEqual({ type: 'scripts', id: 'scripts', isTransient: false });
    expect(getSingletonToolTabSpec('menu-editor')).toEqual({ type: 'menu-editor', id: 'menu-editor', isTransient: false });
    expect(getSingletonToolTabSpec('documentation')).toEqual({ type: 'documentation', id: 'documentation', isTransient: false });
    expect(getSingletonToolTabSpec('metadata-diff')).toEqual({ type: 'metadata-diff', id: 'metadata-diff', isTransient: false });
    expect(getSingletonToolTabSpec('site-validation')).toEqual({ type: 'site-validation', id: 'site-validation', isTransient: false });
  });

  it('opens singleton tool tabs using canonical tab spec', () => {
    const openTab = (tab: { type: string; id: string; isTransient: boolean }) => {
      captured = tab;
    };

    let captured: { type: string; id: string; isTransient: boolean } | null = null;

    openSingletonToolTab(openTab, 'site-validation');
    openSingletonToolTab(openTab, 'menu-editor');

    expect(captured).toEqual({ type: 'menu-editor', id: 'menu-editor', isTransient: false });
  });

  it('provides canonical entity tab spec for preview and pin intents', () => {
    expect(getEntityTabSpec('post', 'post-1', 'preview')).toEqual({
      type: 'post',
      id: 'post-1',
      isTransient: true,
    });

    expect(getEntityTabSpec('media', 'media-1', 'pin')).toEqual({
      type: 'media',
      id: 'media-1',
      isTransient: false,
    });
  });

  it('opens entity tabs from canonical policy', () => {
    let captured: { type: string; id: string; isTransient: boolean } | null = null;
    const openTab = (tab: { type: string; id: string; isTransient: boolean }) => {
      captured = tab;
    };

    openEntityTab(openTab, 'post', 'post-2', 'pin');

    expect(captured).toEqual({ type: 'post', id: 'post-2', isTransient: false });
  });

  it('provides canonical chat and import tab specs', () => {
    expect(getChatTabSpec('conversation-1')).toEqual({
      type: 'chat',
      id: 'conversation-1',
      isTransient: false,
    });

    expect(getImportTabSpec('definition-1')).toEqual({
      type: 'import',
      id: 'definition-1',
      isTransient: false,
    });
  });

  it('opens canonical chat and import tabs', () => {
    const opened: Array<{ type: string; id: string; isTransient: boolean }> = [];
    const openTab = (tab: { type: string; id: string; isTransient: boolean }) => {
      opened.push(tab);
    };

    openChatTab(openTab, 'conversation-2');
    openImportTab(openTab, 'definition-2');

    expect(opened).toEqual([
      { type: 'chat', id: 'conversation-2', isTransient: false },
      { type: 'import', id: 'definition-2', isTransient: false },
    ]);
  });

  it('provides canonical script tab spec for preview and pin intents', () => {
    expect(getScriptTabSpec('script-1', 'preview')).toEqual({
      type: 'scripts',
      id: 'script-1',
      isTransient: true,
    });

    expect(getScriptTabSpec('script-1', 'pin')).toEqual({
      type: 'scripts',
      id: 'script-1',
      isTransient: false,
    });
  });

  it('opens script tabs from shared policy', () => {
    const opened: Array<{ type: string; id: string; isTransient: boolean }> = [];
    const openTab = (tab: { type: string; id: string; isTransient: boolean }) => {
      opened.push(tab);
    };

    openScriptTab(openTab, 'script-preview', 'preview');
    openScriptTab(openTab, 'script-pin', 'pin');

    expect(opened).toEqual([
      { type: 'scripts', id: 'script-preview', isTransient: true },
      { type: 'scripts', id: 'script-pin', isTransient: false },
    ]);
  });

  it('builds and parses git-diff file and commit tab specs', () => {
    expect(getGitDiffFileTabSpec('posts/first.md', 'preview')).toEqual({
      type: 'git-diff',
      id: 'git-diff:posts/first.md',
      isTransient: true,
    });

    expect(getGitDiffCommitTabSpec('abc123def', 'pin')).toEqual({
      type: 'git-diff',
      id: 'git-diff:commit:abc123def',
      isTransient: false,
    });

    expect(parseGitDiffTabId('git-diff:posts/first.md')).toEqual({
      resource: 'posts/first.md',
      commitHash: null,
    });

    expect(parseGitDiffTabId('git-diff:commit:abc123def')).toEqual({
      resource: 'commit:abc123def',
      commitHash: 'abc123def',
    });
  });

  it('opens git-diff file and commit tabs from shared policy', () => {
    const opened: Array<{ type: string; id: string; isTransient: boolean }> = [];
    const openTab = (tab: { type: string; id: string; isTransient: boolean }) => {
      opened.push(tab);
    };

    openGitDiffFileTab(openTab, 'posts/second.md', 'preview');
    openGitDiffCommitTab(openTab, 'def456', 'pin');

    expect(opened).toEqual([
      { type: 'git-diff', id: 'git-diff:posts/second.md', isTransient: true },
      { type: 'git-diff', id: 'git-diff:commit:def456', isTransient: false },
    ]);
  });

  it('provides canonical template tab spec for preview and pin intents', () => {
    expect(getTemplateTabSpec('template-1', 'preview')).toEqual({
      type: 'templates',
      id: 'template-1',
      isTransient: true,
    });

    expect(getTemplateTabSpec('template-1', 'pin')).toEqual({
      type: 'templates',
      id: 'template-1',
      isTransient: false,
    });
  });

  it('opens template tabs from shared policy', () => {
    const opened: Array<{ type: string; id: string; isTransient: boolean }> = [];
    const openTab = (tab: { type: string; id: string; isTransient: boolean }) => {
      opened.push(tab);
    };

    openTemplateTab(openTab, 'template-preview', 'preview');
    openTemplateTab(openTab, 'template-pin', 'pin');

    expect(opened).toEqual([
      { type: 'templates', id: 'template-preview', isTransient: true },
      { type: 'templates', id: 'template-pin', isTransient: false },
    ]);
  });
});
