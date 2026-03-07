import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, screen } from '@testing-library/react';

let lastSuggestionFields: Array<{ key: string; label: string; currentValue: string; suggestedValue?: string; disabled?: boolean; warning?: string }> = [];

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

describe('Editor AI post suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastSuggestionFields = [];
    const neverSettles = new Promise<never>(() => {});

    (window as any).electronAPI ??= {};
    (window as any).electronAPI.posts ??= {};
    (window as any).electronAPI.meta ??= {};
    (window as any).electronAPI.chat ??= {};
    (window as any).electronAPI.templates ??= {};

    (window as any).addEventListener = vi.fn();
    (window as any).removeEventListener = vi.fn();

    (window as any).electronAPI.posts.hasPublishedVersion = vi.fn().mockReturnValue(neverSettles);
    (window as any).electronAPI.posts.getPreviewUrl = vi.fn().mockResolvedValue('http://127.0.0.1:4123/preview');
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

    render(<PostEditor postId="post-1" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '⚡ Quick Actions' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /AI: Suggest Title, Summary & Slug/i }));
    });

    const slugField = lastSuggestionFields.find((field) => field.key === 'slug');
    expect(slugField).toBeDefined();
    expect(slugField?.disabled).toBe(true);
  });

  it('submits the AI slug for a never-published draft when applying suggestions', async () => {
    (window as any).electronAPI.posts.get = vi.fn().mockResolvedValue(createPost());

    render(<PostEditor postId="post-1" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '⚡ Quick Actions' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /AI: Suggest Title, Summary & Slug/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'apply-suggestions' }));
    });

    expect((window as any).electronAPI.posts.update).toHaveBeenCalledWith(
      'post-1',
      expect.objectContaining({ title: 'Better Title', slug: 'better-title' })
    );
  });
});