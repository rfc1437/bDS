import { describe, expect, it } from 'vitest';
import type { Tab } from '../../../src/renderer/store/appStore';
import {
  EDITOR_TAB_ROUTE_REGISTRY,
  resolveEditorRoute,
} from '../../../src/renderer/navigation/editorRouting';

describe('editorRouting', () => {
  it('defines canonical tab-type to editor-route mapping', () => {
    expect(EDITOR_TAB_ROUTE_REGISTRY).toEqual({
      post: 'post',
      media: 'media',
      settings: 'settings',
      style: 'style',
      tags: 'tags',
      chat: 'chat',
      import: 'import',
      'menu-editor': 'menu-editor',
      'metadata-diff': 'metadata-diff',
      'git-diff': 'git-diff',
      documentation: 'documentation',
      'api-documentation': 'api-documentation',
      'site-validation': 'site-validation',
      'translation-validation': 'translation-validation',
      scripts: 'scripts',
      templates: 'templates',
      'find-duplicates': 'find-duplicates',
    });
  });

  it('resolves dashboard route when no active tab is present', () => {
    expect(resolveEditorRoute(undefined)).toEqual({
      route: 'dashboard',
      tabId: null,
      gitDiffResource: null,
    });
  });

  it('resolves post and media routes with active tab id', () => {
    const postTab: Tab = { type: 'post', id: 'post-1', isTransient: true };
    const mediaTab: Tab = { type: 'media', id: 'media-1', isTransient: false };

    expect(resolveEditorRoute(postTab)).toEqual({
      route: 'post',
      tabId: 'post-1',
      gitDiffResource: null,
    });

    expect(resolveEditorRoute(mediaTab)).toEqual({
      route: 'media',
      tabId: 'media-1',
      gitDiffResource: null,
    });
  });

  it('resolves git-diff route and extracts resource from tab id', () => {
    const tab: Tab = {
      type: 'git-diff',
      id: 'git-diff:commit:abc123',
      isTransient: true,
    };

    expect(resolveEditorRoute(tab)).toEqual({
      route: 'git-diff',
      tabId: 'git-diff:commit:abc123',
      gitDiffResource: 'commit:abc123',
    });
  });
});
