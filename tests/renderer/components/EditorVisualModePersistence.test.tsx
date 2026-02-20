import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';

let markdownUpdatedHandler: ((ctx: unknown, markdown: string, prevMarkdown: string) => void) | null = null;

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor" />,
}));

vi.mock('@milkdown/kit/core', () => {
  const makeChain = () => {
    const chain = {
      config: (callback: (ctx: { set: () => void; get: () => { markdownUpdated: (cb: typeof markdownUpdatedHandler) => void } }) => void) => {
        callback({
          set: () => {},
          get: () => ({
            markdownUpdated: (cb) => {
              markdownUpdatedHandler = cb;
            },
          }),
        });
        return chain;
      },
      use: () => chain,
    };
    return chain;
  };

  return {
    Editor: {
      make: makeChain,
    },
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
  replaceAll: (content: string) => () => {
    const normalized = content.replace(/\n/g, '\n\n');
    markdownUpdatedHandler?.({}, normalized, '');
  },
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

const createPost = () => ({
  id: 'post-1',
  title: 'Test Post',
  content: 'Line one\nLine two',
  excerpt: '',
  slug: 'test-post',
  status: 'draft' as const,
  tags: [],
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
});

describe('Editor visual mode persistence', () => {
  beforeEach(() => {
    markdownUpdatedHandler = null;
    vi.clearAllMocks();
    const neverSettles = new Promise<never>(() => {});

    (window as any).addEventListener = vi.fn();
    (window as any).removeEventListener = vi.fn();

    (window as any).electronAPI.posts.get = vi.fn().mockResolvedValue(createPost());
    (window as any).electronAPI.posts.hasPublishedVersion = vi.fn().mockReturnValue(neverSettles);
    (window as any).electronAPI.posts.update = vi.fn().mockResolvedValue(null);
    (window as any).electronAPI.posts.getPreviewUrl = vi.fn().mockResolvedValue('http://127.0.0.1:4123/2026/02/16/test-post?draft=true&postId=post-1');
    (window as any).electronAPI.meta.getCategories = vi.fn().mockReturnValue(neverSettles);

    useAppStore.setState({
      preferredEditorMode: 'wysiwyg',
      posts: [],
      media: [],
      dirtyPosts: new Set<string>(),
      isLoading: false,
    });
  });

  afterEach(() => {
    useAppStore.setState({
      dirtyPosts: new Set<string>(),
    });
  });

  it('does not mark post dirty when Milkdown emits formatting-only update on load', async () => {
    let unmount: (() => void) | undefined;

    await act(async () => {
      ({ unmount } = render(<PostEditor postId="post-1" />));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect((window as any).electronAPI.posts.get).toHaveBeenCalledWith('post-1');

    expect(useAppStore.getState().isDirty('post-1')).toBe(false);

    await act(async () => {
      unmount?.();
    });
  });

  it('uses editor preview HTML in preview mode iframe', async () => {
    const { getByTitle, container } = render(<PostEditor postId="post-1" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(getByTitle('Read-only preview'));
      await Promise.resolve();
    });

    expect((window as any).electronAPI.posts.getPreviewUrl).toHaveBeenCalledWith('post-1', { draft: true });

    const frame = container.querySelector('.editor-preview-frame') as HTMLIFrameElement | null;
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('src')).toBe('http://127.0.0.1:4123/2026/02/16/test-post?draft=true&postId=post-1');
    expect(frame?.getAttribute('srcdoc')).toBeNull();

    expect(container.querySelector('.preview-content')).toBeNull();
  });

  it('renders mode toggle in centered toolbar section', async () => {
    const { container } = render(<PostEditor postId="post-1" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const centerSection = container.querySelector('.editor-toolbar-center');
    expect(centerSection).not.toBeNull();

    const modeToggle = centerSection?.querySelector('.editor-mode-toggle');
    expect(modeToggle).not.toBeNull();

    const modeButtons = modeToggle?.querySelectorAll('button');
    expect(modeButtons?.length).toBe(3);
  });
});
