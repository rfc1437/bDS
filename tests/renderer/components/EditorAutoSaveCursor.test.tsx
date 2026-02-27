import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

// Capture the value/defaultValue props passed to the Monaco editor
let lastMonacoValue: string | undefined;
let lastMonacoDefaultValue: string | undefined;
let lastMonacoKey: string | number | undefined;
let monacoOnChange: ((value: string | undefined) => void) | null = null;

vi.mock('@monaco-editor/react', () => ({
  default: (props: { value?: string; defaultValue?: string; onChange?: (value: string | undefined) => void; key?: string | number }) => {
    lastMonacoValue = props.value;
    lastMonacoDefaultValue = props.defaultValue;
    lastMonacoKey = props.key;
    monacoOnChange = props.onChange ?? null;
    return <div data-testid="monaco-editor" data-value={props.value} data-default-value={props.defaultValue} />;
  },
}));

vi.mock('@milkdown/kit/core', () => {
  const makeChain = () => {
    const chain = {
      config: (callback: (ctx: { set: () => void; get: () => { markdownUpdated: () => void } }) => void) => {
        callback({
          set: () => {},
          get: () => ({ markdownUpdated: () => {} }),
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

const INITIAL_CONTENT = '# Hello World\n\nThis is the original content.';

const createPost = (overrides: Record<string, unknown> = {}) => ({
  id: 'post-1',
  title: 'Test Post',
  content: INITIAL_CONTENT,
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
  ...overrides,
});

describe('Editor does not reset content on auto-save (cursor stability)', () => {
  // Capture event handlers registered via mocked addEventListener
  let eventHandlers: Map<string, EventListener[]>;

  beforeEach(() => {
    lastMonacoValue = undefined;
    lastMonacoDefaultValue = undefined;
    lastMonacoKey = undefined;
    monacoOnChange = null;
    eventHandlers = new Map();
    vi.clearAllMocks();

    const neverSettles = new Promise<never>(() => {});

    (window as any).addEventListener = vi.fn((event: string, handler: EventListener) => {
      if (!eventHandlers.has(event)) eventHandlers.set(event, []);
      eventHandlers.get(event)!.push(handler);
    });
    (window as any).removeEventListener = vi.fn((event: string, handler: EventListener) => {
      const handlers = eventHandlers.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    });

    (window as any).electronAPI.posts.get = vi.fn().mockResolvedValue(createPost());
    (window as any).electronAPI.posts.hasPublishedVersion = vi.fn().mockReturnValue(neverSettles);
    (window as any).electronAPI.posts.update = vi.fn().mockResolvedValue(null);
    (window as any).electronAPI.posts.getPreviewUrl = vi.fn().mockResolvedValue('http://localhost:4123/preview');
    (window as any).electronAPI.meta.getCategories = vi.fn().mockReturnValue(neverSettles);

    useAppStore.setState({
      preferredEditorMode: 'markdown',
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

  /** Dispatch a synthetic event to all captured handlers */
  function fireEvent(name: string, detail: unknown) {
    const handlers = eventHandlers.get(name) ?? [];
    const event = { detail } as unknown as Event;
    for (const h of handlers) h(event);
  }

  it('uses uncontrolled Monaco (defaultValue, not value) to prevent cursor jumps', async () => {
    render(<PostEditor postId="post-1" />);

    // Wait for initial post load and initialization
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Monaco must be in uncontrolled mode: defaultValue set, value undefined
    expect(lastMonacoDefaultValue).toBe(INITIAL_CONTENT);
    expect(lastMonacoValue).toBeUndefined();
  });

  it('does not reset Monaco when auto-save event updates the post', async () => {
    render(<PostEditor postId="post-1" />);

    // Wait for initial post load and initialization
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const initialKey = lastMonacoKey;

    // User types more content in the editor
    const userEditedContent = INITIAL_CONTENT + '\n\nNew paragraph typed by user.';
    await act(async () => {
      monacoOnChange?.(userEditedContent);
    });

    // Simulate auto-save completing with the OLD content (before user's latest edits).
    const autoSavedPost = createPost(); // still has INITIAL_CONTENT
    await act(async () => {
      fireEvent('bds:post-auto-saved', { id: 'post-1', updated: autoSavedPost });
    });

    // Monaco must NOT have been remounted (key unchanged) — content stays untouched
    expect(lastMonacoKey).toBe(initialKey);
    // value prop must still be undefined (uncontrolled)
    expect(lastMonacoValue).toBeUndefined();
  });

  it('does not reset Monaco when manual save updates the post', async () => {
    // Make update return the saved post data
    const savedPost = createPost();
    (window as any).electronAPI.posts.update = vi.fn().mockResolvedValue(savedPost);

    render(<PostEditor postId="post-1" />);

    // Wait for initialization
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const initialKey = lastMonacoKey;

    // User edits
    const userEditedContent = 'Completely rewritten content';
    await act(async () => {
      monacoOnChange?.(userEditedContent);
    });

    // Simulate post state update (as happens after save completes with older content)
    await act(async () => {
      fireEvent('bds:post-auto-saved', { id: 'post-1', updated: savedPost });
    });

    // Monaco must NOT have been remounted
    expect(lastMonacoKey).toBe(initialKey);
    expect(lastMonacoValue).toBeUndefined();
  });
});
