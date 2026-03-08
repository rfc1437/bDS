import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, within } from '@testing-library/react';

let lastSuggestionFields: Array<{ key: string; label: string; currentValue: string; suggestedValue?: string; disabled?: boolean; warning?: string }> = [];
const menuListeners = new Map<string, () => void | Promise<void>>();

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor" />,
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
vi.mock('../../../src/renderer/components/MilkdownEditor', () => ({
  MilkdownEditor: ({ content, onChange }: { content: string; onChange: (value: string) => void }) => (
    <textarea data-testid="milkdown-editor" value={content} onChange={(event) => onChange(event.target.value)} />
  ),
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
  AISuggestionsModal: ({ isOpen, fields, onConfirm }: { isOpen: boolean; fields: typeof lastSuggestionFields; onConfirm: (values: Record<string, string>) => void }) => {
    if (!isOpen) return null;
    lastSuggestionFields = fields;
    return (
      <div data-testid="ai-suggestions-modal">
        {fields.map((field) => (
          <div key={field.key} data-testid={`field-${field.key}`} data-disabled={field.disabled ? 'true' : 'false'}>
            {field.label}
          </div>
        ))}
        <button onClick={() => onConfirm({ title: 'Better Title', slug: 'better-title' })}>apply-suggestions</button>
      </div>
    );
  },
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

const createTranslation = (overrides: Record<string, unknown> = {}) => ({
  id: 'translation-1',
  translationFor: 'post-1',
  language: 'fr',
  title: 'Bonjour',
  excerpt: 'Resume',
  content: 'Contenu',
  status: 'draft' as const,
  createdAt: new Date('2026-02-16T12:00:00.000Z'),
  updatedAt: new Date('2026-02-16T12:00:00.000Z'),
  publishedAt: null,
  filePath: 'posts/test-post.fr.md',
  ...overrides,
});

describe('Editor AI post suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastSuggestionFields = [];
    menuListeners.clear();
    const neverSettles = new Promise<never>(() => {});

    (window as any).electronAPI ??= {};
    (window as any).electronAPI.posts ??= {};
    (window as any).electronAPI.meta ??= {};
    (window as any).electronAPI.chat ??= {};
    (window as any).electronAPI.templates ??= {};

    (window as any).addEventListener = vi.fn();
    (window as any).removeEventListener = vi.fn();
    (window as any).dispatchEvent = vi.fn();
    (window as any).electronAPI.on = vi.fn((event: string, handler: () => void | Promise<void>) => {
      menuListeners.set(event, handler);
      return () => {
        menuListeners.delete(event);
      };
    });

    (window as any).electronAPI.posts.hasPublishedVersion = vi.fn().mockReturnValue(neverSettles);
    (window as any).electronAPI.posts.getTranslations = vi.fn().mockResolvedValue([]);
    (window as any).electronAPI.posts.getTranslation = vi.fn().mockResolvedValue(null);
    (window as any).electronAPI.posts.publishTranslation = vi.fn().mockResolvedValue(createPost());
    (window as any).electronAPI.posts.upsertTranslation = vi.fn().mockImplementation(async (postId: string, language: string, data: Record<string, string>) =>
      createTranslation({ translationFor: postId, language, ...data, status: 'draft' })
    );
    (window as any).electronAPI.posts.getPreviewUrl = vi.fn().mockResolvedValue('http://127.0.0.1:4123/preview');
    (window as any).electronAPI.posts.publish = vi.fn().mockResolvedValue(createPost({ status: 'published' }));
    (window as any).electronAPI.posts.update = vi.fn().mockImplementation(async (_postId: string, payload: Record<string, string>) => ({
      ...createPost(),
      ...payload,
    }));
    (window as any).electronAPI.meta.getCategories = vi.fn().mockReturnValue(neverSettles);
    (window as any).electronAPI.meta.getProjectMetadata = vi.fn().mockResolvedValue({ mainLanguage: 'en' });
    (window as any).electronAPI.templates.getEnabledByKind = vi.fn().mockResolvedValue([]);
    (window as any).electronAPI.chat.analyzePost = vi.fn().mockResolvedValue({
      success: true,
      title: 'Better Title',
      excerpt: 'A concise summary.',
      slug: 'better-title',
    });
    (window as any).electronAPI.chat.translatePost = vi.fn().mockResolvedValue({
      success: true,
    });

    useAppStore.setState({
      activeProject: { id: 'project-1', name: 'Test', path: '/tmp/test' } as any,
      preferredEditorMode: 'wysiwyg',
      posts: [],
      media: [],
      dirtyPosts: new Set<string>(),
      isLoading: false,
    });
  });

  it('passes a disabled slug suggestion for published posts', async () => {
    (window as any).electronAPI.posts.get = vi.fn().mockResolvedValue(createPost({
      status: 'published',
      publishedAt: new Date('2026-02-16T12:00:00.000Z'),
    }));

    const view = render(<PostEditor postId="post-1" />);
    const ui = within(view.container);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: '⚡ Quick Actions' }));
    });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: /AI: Suggest Title, Summary & Slug/i }));
    });

    const slugField = lastSuggestionFields.find((field) => field.key === 'slug');
    expect(slugField).toBeDefined();
    expect(slugField?.disabled).toBe(true);
  });

  it('submits the AI slug for a never-published draft when applying suggestions', async () => {
    (window as any).electronAPI.posts.get = vi.fn().mockResolvedValue(createPost());

    const view = render(<PostEditor postId="post-1" />);
    const ui = within(view.container);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: '⚡ Quick Actions' }));
    });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: /AI: Suggest Title, Summary & Slug/i }));
    });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: 'apply-suggestions' }));
    });

    expect((window as any).electronAPI.posts.update).toHaveBeenCalledWith(
      'post-1',
      expect.objectContaining({ title: 'Better Title', slug: 'better-title' })
    );
  });

  it('opens a translation modal from quick actions and creates the translation on confirm', async () => {
    (window as any).electronAPI.posts.get = vi.fn().mockResolvedValue(createPost({ title: '' }));

    const view = render(<PostEditor postId="post-1" />);
    const ui = within(view.container);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ui.queryByRole('button', { name: 'Translate to...' })).toBeNull();
    expect(ui.queryByText('Select target language')).toBeNull();

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: '⚡ Quick Actions' }));
    });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: /Translate to\.\.\./i }));
    });

    expect(ui.getByRole('heading', { name: 'Translations' })).toBeInTheDocument();
    expect(ui.getByText('Select target language')).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(ui.getByLabelText('Select target language'), { target: { value: 'fr' } });
    });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: 'Translate to...' }));
    });

    expect((window as any).electronAPI.chat.translatePost).toHaveBeenCalledWith('post-1', 'fr');
  });

  it('renders available translations as compact flag indicators in metadata', async () => {
    (window as any).electronAPI.posts.get = vi.fn().mockResolvedValue(createPost({ title: '' }));
    (window as any).electronAPI.posts.getTranslations = vi.fn().mockResolvedValue([
      createTranslation(),
      createTranslation({
        id: 'translation-2',
        language: 'de',
        title: 'Hallo',
        status: 'published',
        filePath: 'posts/test-post.de.md',
      }),
    ]);

    const view = render(<PostEditor postId="post-1" />);
    const ui = within(view.container);
    const { container } = view;

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('.editor-translations-panel')).toBeNull();
    expect(container.querySelector('.metadata-toggle-header .editor-translations-flags')).not.toBeNull();
    expect(ui.getByLabelText('French (Draft)')).toBeInTheDocument();
    expect(ui.getByLabelText('German (Published)')).toBeInTheDocument();
    expect(container.querySelector('.editor-translations-flags')).not.toBeNull();
    expect(container.querySelector('.editor-translation-actions')).toBeNull();
    expect(container.querySelector('.editor-translation-language')).toBeNull();
  });

  it('switches the active editing language with flags and saves translated title excerpt and content to that language', async () => {
    (window as any).electronAPI.posts.get = vi.fn().mockResolvedValue(createPost({
      language: 'en',
      title: 'Hello world',
      excerpt: 'Canonical excerpt',
      content: 'Canonical content',
    }));
    (window as any).electronAPI.posts.getTranslations = vi.fn().mockResolvedValue([
      createTranslation({ language: 'fr', title: 'Bonjour', excerpt: 'Resume', content: 'Contenu' }),
    ]);

    const view = render(<PostEditor postId="post-1" />);
    const ui = within(view.container);
    const { container } = view;

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: /Metadata/i }));
    });

    const flags = container.querySelectorAll('.metadata-toggle-header .editor-translation-flag');
    expect(flags).toHaveLength(2);
    expect(ui.getByDisplayValue('Hello world')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(ui.getByLabelText('French (Draft)'));
    });

    expect(ui.getByDisplayValue('Bonjour')).toBeInTheDocument();
    expect((ui.getByLabelText('French (Draft)') as HTMLElement).className).toContain('active');

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: /Excerpt/i }));
    });

    expect(ui.getByDisplayValue('Resume')).toBeInTheDocument();
    expect(ui.getByTestId('milkdown-editor')).toHaveValue('Contenu');

    const titleInput = container.querySelector('#post-editor-post-1-title') as HTMLInputElement;
    const excerptInput = container.querySelector('#post-editor-post-1-excerpt') as HTMLTextAreaElement;
    const contentInput = ui.getByTestId('milkdown-editor') as HTMLTextAreaElement;

    const setTextValue = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      const prototype = Object.getPrototypeOf(element);
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      fireEvent.focus(element);
      valueSetter?.call(element, value);
      fireEvent.input(element, { target: { value } });
      fireEvent.change(element, { target: { value } });
      fireEvent.blur(element);
    };

    await act(async () => {
      setTextValue(titleInput, 'Salut modifie');
      setTextValue(excerptInput, 'Resume modifie');
      setTextValue(contentInput, 'Contenu modifie');
    });

    expect(ui.getByDisplayValue('Salut modifie')).toBeInTheDocument();
    expect(ui.getByDisplayValue('Resume modifie')).toBeInTheDocument();
    expect(ui.getByTestId('milkdown-editor')).toHaveValue('Contenu modifie');

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: 'Publish' }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((window as any).electronAPI.posts.upsertTranslation).toHaveBeenCalledWith(
      'post-1',
      'fr',
      expect.objectContaining({
        title: 'Salut modifie',
        excerpt: 'Resume modifie',
        content: 'Contenu modifie',
      })
    );
  });

  it('requests preview URL with lang when a translation is the active editing language', async () => {
    (window as any).electronAPI.posts.get = vi.fn().mockResolvedValue(createPost({
      language: 'en',
      title: 'Hello world',
      content: 'Canonical content',
    }));
    (window as any).electronAPI.posts.getTranslations = vi.fn().mockResolvedValue([
      createTranslation({ language: 'fr', title: 'Bonjour', content: 'Contenu' }),
    ]);

    const view = render(<PostEditor postId="post-1" />);
    const ui = within(view.container);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: /Metadata/i }));
    });

    await act(async () => {
      fireEvent.click(ui.getByLabelText('French (Draft)'));
    });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: 'Preview (Read-only)' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((window as any).electronAPI.posts.getPreviewUrl).toHaveBeenLastCalledWith('post-1', {
      draft: true,
      lang: 'fr',
    });
  });
});