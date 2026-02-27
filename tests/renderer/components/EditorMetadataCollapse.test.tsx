import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor" />,
}));

vi.mock('@milkdown/kit/core', () => {
  const makeChain = () => {
    const chain = {
      config: (callback: (ctx: { set: () => void; get: () => { markdownUpdated: () => void } }) => void) => {
        callback({
          set: () => {},
          get: () => ({
            markdownUpdated: () => {},
          }),
        });
        return chain;
      },
      use: () => chain,
    };
    return chain;
  };

  return {
    Editor: { make: makeChain },
    defaultValueCtx: Symbol('defaultValueCtx'),
    editorViewCtx: Symbol('editorViewCtx'),
    rootCtx: Symbol('rootCtx'),
    remarkStringifyOptionsCtx: Symbol('remarkStringifyOptionsCtx'),
    remarkPluginsCtx: Symbol('remarkPluginsCtx'),
  };
});

vi.mock('@milkdown/kit/preset/commonmark', () => ({
  commonmark: {},
  toggleStrongCommand: { key: 'toggleStrong' },
  toggleEmphasisCommand: { key: 'toggleEmphasis' },
  wrapInBlockquoteCommand: { key: 'wrapInBlockquote' },
  wrapInBulletListCommand: { key: 'wrapInBulletList' },
  wrapInOrderedListCommand: { key: 'wrapInOrderedList' },
  insertHrCommand: { key: 'insertHr' },
  toggleInlineCodeCommand: { key: 'toggleInlineCode' },
  insertImageCommand: { key: 'insertImage' },
  toggleLinkCommand: { key: 'toggleLink' },
}));

vi.mock('@milkdown/kit/preset/gfm', () => ({
  gfm: {},
  toggleStrikethroughCommand: { key: 'toggleStrike' },
}));

vi.mock('@milkdown/kit/plugin/history', () => ({
  history: {},
  undoCommand: { key: 'undo' },
  redoCommand: { key: 'redo' },
}));

vi.mock('@milkdown/kit/plugin/listener', () => ({
  listener: {},
  listenerCtx: Symbol('listenerCtx'),
}));

vi.mock('@milkdown/kit/plugin/clipboard', () => ({ clipboard: {} }));
vi.mock('@milkdown/kit/plugin/trailing', () => ({ trailing: {} }));
vi.mock('@milkdown/kit/plugin/indent', () => ({ indent: {} }));
vi.mock('@milkdown/kit/plugin/cursor', () => ({ cursor: {} }));

vi.mock('@milkdown/kit/utils', () => ({
  $node: () => ({}),
  $inputRule: () => ({}),
  $remark: () => ({}),
  $prose: () => ({}),
  replaceAll: () => () => {},
  callCommand: () => () => {},
}));

vi.mock('@milkdown/react', () => ({
  Milkdown: () => <div data-testid="milkdown" />,
  MilkdownProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useInstance: () => [false, () => ({ action: (action: unknown) => {
    if (typeof action === 'function') {
      action({ get: () => ({}) });
    }
  } })] as const,
  useEditor: (factory: (root: Node) => unknown) => {
    factory(document.createElement('div'));
  },
}));

vi.mock('../../../src/renderer/components/Lightbox', () => ({
  Lightbox: () => null,
  useMarkdownImages: () => [],
}));
vi.mock('../../../src/renderer/components/PostLinks', () => ({ PostLinks: () => null }));
vi.mock('../../../src/renderer/components/LinkedMediaPanel', () => ({ LinkedMediaPanel: () => null }));
vi.mock('../../../src/renderer/components/ErrorModal', () => ({ ErrorModal: () => null }));
vi.mock('../../../src/renderer/components/ConfirmDeleteModal', () => ({ ConfirmDeleteModal: () => null }));
vi.mock('../../../src/renderer/components/SettingsView', () => ({ SettingsView: () => null }));
vi.mock('../../../src/renderer/components/TagsView', () => ({ TagsView: () => null }));
vi.mock('../../../src/renderer/components/TagInput', () => ({ TagInput: () => null }));
vi.mock('../../../src/renderer/components/ChatPanel', () => ({ ChatPanel: () => null }));
vi.mock('../../../src/renderer/components/ImportAnalysisView', () => ({ ImportAnalysisView: () => null }));
vi.mock('../../../src/renderer/components/MetadataDiffPanel', () => ({ MetadataDiffPanel: () => null }));
vi.mock('../../../src/renderer/components/GitDiffView/GitDiffView', () => ({ GitDiffView: () => null }));
vi.mock('../../../src/renderer/components/InsertModal', () => ({ InsertModal: () => null }));
vi.mock('../../../src/renderer/components/AISuggestionsModal/AISuggestionsModal', () => ({
  AISuggestionsModal: () => null,
}));
vi.mock('../../../src/renderer/components/Toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { PostEditor } from '../../../src/renderer/components/Editor/Editor';
import { useAppStore } from '../../../src/renderer/store';

const createPost = (overrides: Record<string, unknown> = {}) => ({
  id: 'post-1',
  title: 'Test Post',
  content: 'Some content',
  excerpt: '',
  slug: 'test-post',
  status: 'draft' as const,
  tags: ['tag1'],
  categories: ['article'],
  featuredImage: null,
  publishedAt: null,
  createdAt: new Date('2026-02-16T12:00:00.000Z'),
  updatedAt: new Date('2026-02-16T12:00:00.000Z'),
  author: undefined,
  metadata: {},
  seoTitle: undefined,
  seoDescription: undefined,
  canonicalUrl: undefined,
  projectId: 'project-1',
  filePath: 'posts/test-post.md',
  ...overrides,
});

describe('Editor metadata collapse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const neverSettles = new Promise<never>(() => {});

    (window as any).addEventListener = vi.fn();
    (window as any).removeEventListener = vi.fn();

    (window as any).electronAPI.posts.hasPublishedVersion = vi.fn().mockReturnValue(neverSettles);
    (window as any).electronAPI.posts.update = vi.fn().mockResolvedValue(null);
    (window as any).electronAPI.posts.getPreviewUrl = vi.fn().mockResolvedValue('http://127.0.0.1:4123/preview');
    (window as any).electronAPI.meta.getCategories = vi.fn().mockReturnValue(neverSettles);

    useAppStore.setState({
      preferredEditorMode: 'wysiwyg',
      posts: [],
      media: [],
      dirtyPosts: new Set<string>(),
      isLoading: false,
    });
  });

  it('collapses metadata for existing posts (non-empty title)', async () => {
    (window as any).electronAPI.posts.get = vi.fn().mockResolvedValue(createPost({ title: 'Existing Post' }));

    const { container } = render(<PostEditor postId="post-1" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const headerRow = container.querySelector('.editor-header-row');
    expect(headerRow).toBeNull();

    const toggle = container.querySelector('.metadata-toggle');
    expect(toggle).not.toBeNull();
  });

  it('expands metadata for new posts (empty title)', async () => {
    (window as any).electronAPI.posts.get = vi.fn().mockResolvedValue(createPost({ title: '' }));

    const { container } = render(<PostEditor postId="post-1" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const headerRow = container.querySelector('.editor-header-row');
    expect(headerRow).not.toBeNull();

    const toggle = container.querySelector('.metadata-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle?.classList.contains('expanded')).toBe(true);
  });

  it('toggles metadata visibility on click', async () => {
    (window as any).electronAPI.posts.get = vi.fn().mockResolvedValue(createPost({ title: 'Existing Post' }));

    const { container } = render(<PostEditor postId="post-1" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Initially collapsed for existing post
    expect(container.querySelector('.editor-header-row')).toBeNull();

    const toggle = container.querySelector('.metadata-toggle')!;

    // Click to expand
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(container.querySelector('.editor-header-row')).not.toBeNull();

    // Click to collapse again
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(container.querySelector('.editor-header-row')).toBeNull();
  });
});
