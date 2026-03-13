import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

let monacoOnChange: ((value: string | undefined) => void) | null = null;

vi.mock('@monaco-editor/react', () => ({
  default: (props: { value?: string; defaultValue?: string; onChange?: (value: string | undefined) => void; key?: string | number }) => {
    monacoOnChange = props.onChange ?? null;
    return <div data-testid="monaco-editor" data-default-value={props.defaultValue} />;
  },
}));

vi.mock('@milkdown/kit/core', () => {
  const makeChain = () => {
    const chain = {
      config: (callback: (ctx: { set: () => void; get: () => { markdownUpdated: () => void } }) => void) => {
        callback({ set: () => {}, get: () => ({ markdownUpdated: () => {} }) });
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
    info: vi.fn(),
  },
}));

import { PostEditor } from '../../../src/renderer/components/Editor/PostEditor';
import { useAppStore } from '../../../src/renderer/store';

const createPost = (overrides: Record<string, unknown> = {}) => ({
  id: 'post-1',
  title: 'Bookmarklet Post',
  content: '[Example](https://example.com)',
  excerpt: '',
  slug: 'bookmarklet-post',
  status: 'draft' as const,
  tags: [],
  categories: ['article'],
  featuredImage: null,
  publishedAt: null,
  createdAt: new Date('2026-03-13T12:00:00.000Z'),
  updatedAt: new Date('2026-03-13T12:00:00.000Z'),
  author: undefined,
  metadata: {},
  seoTitle: undefined,
  seoDescription: undefined,
  canonicalUrl: undefined,
  projectId: 'project-1',
  filePath: '',
  ...overrides,
});

describe('Editor keeps canonical language focus on post creation', () => {
  let metadataResolve: (value: unknown) => void;
  let eventHandlers: Map<string, EventListener[]>;

  beforeEach(() => {
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
    const metadataPromise = new Promise((resolve) => {
      metadataResolve = resolve;
    });

    (window as any).electronAPI.posts.get = vi.fn().mockResolvedValue(createPost({ language: null }));
    (window as any).electronAPI.posts.hasPublishedVersion = vi.fn().mockReturnValue(neverSettles);
    (window as any).electronAPI.posts.update = vi.fn().mockResolvedValue(null);
    (window as any).electronAPI.posts.getPreviewUrl = vi.fn().mockResolvedValue('http://localhost:4123/preview');
    (window as any).electronAPI.posts.getTranslations = vi.fn().mockResolvedValue([]);
    (window as any).electronAPI.posts.upsertTranslation = vi.fn().mockResolvedValue(null);
    (window as any).electronAPI.meta.getCategories = vi.fn().mockReturnValue(neverSettles);
    (window as any).electronAPI.meta.getProjectMetadata = vi.fn().mockReturnValue(metadataPromise);
    (window as any).electronAPI.templates.getEnabledByKind = vi.fn().mockResolvedValue([]);

    useAppStore.setState({
      activeProject: { id: 'project-1', name: 'Test Blog', path: '/tmp/test' } as any,
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

  it('updates activeEditingLanguage when projectLanguage loads after initialization', async () => {
    render(<PostEditor postId="post-1" />);

    // Wait for post data to load and initialization to complete
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Before metadata resolves, the active flag should be 'en' (default projectLanguage)
    let flagContainer = screen.getByLabelText(/translations/i);
    let activeButton = flagContainer.querySelector('.active');
    expect(activeButton).toBeTruthy();
    expect(activeButton?.getAttribute('aria-label')).toContain('English');

    // Now resolve projectMetadata with mainLanguage = 'de'
    await act(async () => {
      metadataResolve({ mainLanguage: 'de' });
      // Let React process the state updates
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // After metadata resolves, the active flag should be 'de' (the canonical language)
    // Re-query DOM since buttons may have been re-rendered
    flagContainer = screen.getByLabelText(/translations/i);
    activeButton = flagContainer.querySelector('.active');
    expect(activeButton).toBeTruthy();
    expect(activeButton?.getAttribute('aria-label')).toContain('German');
  });

  it('does not create translation draft when typing after projectLanguage loads', async () => {
    render(<PostEditor postId="post-1" />);

    // Wait for post data to load and initialization to complete
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Resolve projectMetadata with mainLanguage = 'de'
    await act(async () => {
      metadataResolve({ mainLanguage: 'de' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // User types in the editor - this should go to canonical, not create a translation
    await act(async () => {
      monacoOnChange?.('[Example](https://example.com)\n\nNew paragraph');
    });

    // No translation flag should appear for 'en' translation
    const flagContainer = screen.getByLabelText(/translations/i);
    const allButtons = flagContainer.querySelectorAll('button');
    // Should only have 1 button (canonical 'de'), no 'en' translation button
    expect(allButtons).toHaveLength(1);
  });

  it('keeps canonical language focus when post has explicit language matching project', async () => {
    // Post created via IPC handler with language set explicitly
    (window as any).electronAPI.posts.get = vi.fn().mockResolvedValue(createPost({ language: 'de' }));

    render(<PostEditor postId="post-1" />);

    // Wait for initialization
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Resolve projectMetadata (even though post already has language)
    await act(async () => {
      metadataResolve({ mainLanguage: 'de' });
      await Promise.resolve();
      await Promise.resolve();
    });

    // The active flag should be 'de' (canonical)
    const flagContainer = screen.getByLabelText(/translations/i);
    const activeButton = flagContainer.querySelector('.active');
    expect(activeButton).toBeTruthy();
    expect(activeButton?.getAttribute('aria-label')).toContain('German');

    // Typing should not create translations
    await act(async () => {
      monacoOnChange?.('[Example](https://example.com)\n\nNew content');
    });

    const allButtons = screen.getByLabelText(/translations/i).querySelectorAll('button');
    expect(allButtons).toHaveLength(1);
  });
});
