import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, within } from '@testing-library/react';

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor" />,
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
  AISuggestionsModal: () => null,
}));
vi.mock('../../../src/renderer/components/Toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { MediaEditor } from '../../../src/renderer/components/Editor/Editor';
import { useAppStore } from '../../../src/renderer/store';

const createMedia = (overrides: Record<string, unknown> = {}) => ({
  id: 'media-1',
  title: 'Test Image',
  alt: 'A test image',
  caption: 'Photo caption',
  originalName: 'test.jpg',
  mimeType: 'image/jpeg',
  size: 1024,
  width: 800,
  height: 600,
  tags: [],
  author: '',
  language: 'en',
  availableLanguages: [],
  projectId: 'project-1',
  filePath: 'media/test.jpg',
  createdAt: new Date('2026-02-16T12:00:00.000Z'),
  updatedAt: new Date('2026-02-16T12:00:00.000Z'),
  ...overrides,
});

describe('Media editor quick-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const neverSettles = new Promise<never>(() => {});

    (window as any).electronAPI ??= {};
    (window as any).electronAPI.media ??= {};
    (window as any).electronAPI.meta ??= {};
    (window as any).electronAPI.chat ??= {};
    (window as any).electronAPI.postMedia ??= {};

    (window as any).addEventListener = vi.fn();
    (window as any).removeEventListener = vi.fn();
    (window as any).dispatchEvent = vi.fn();
    (window as any).electronAPI.on = vi.fn(() => () => {});

    (window as any).electronAPI.media.getTranslations = vi.fn().mockResolvedValue([]);
    (window as any).electronAPI.media.getTranslation = vi.fn().mockResolvedValue(null);
    (window as any).electronAPI.media.deleteTranslation = vi.fn().mockResolvedValue(undefined);
    (window as any).electronAPI.media.upsertTranslation = vi.fn().mockImplementation(async (_id: string, lang: string, data: Record<string, unknown>) => ({
      id: 'trans-1', projectId: 'project-1', translationFor: _id, language: lang, ...data,
      createdAt: new Date(), updatedAt: new Date(),
    }));
    (window as any).electronAPI.media.update = vi.fn().mockImplementation(async (_id: string, payload: Record<string, unknown>) => ({
      ...createMedia(),
      ...payload,
    }));
    (window as any).electronAPI.media.replaceFileDialog = vi.fn().mockReturnValue(neverSettles);
    (window as any).electronAPI.meta.getProjectMetadata = vi.fn().mockResolvedValue({ mainLanguage: 'en' });
    (window as any).electronAPI.postMedia.getForMedia = vi.fn().mockResolvedValue([]);
    (window as any).electronAPI.chat.analyzeMediaImage = vi.fn().mockResolvedValue({ success: true, title: 'AI Title', alt: 'AI alt', caption: 'AI caption' });
    (window as any).electronAPI.chat.detectMediaLanguage = vi.fn().mockResolvedValue({ success: true, language: 'de' });
    (window as any).electronAPI.chat.translateMediaMetadata = vi.fn().mockResolvedValue({ success: true });

    useAppStore.setState({
      activeProject: { id: 'project-1', name: 'Test', path: '/tmp/test' } as any,
      media: [createMedia()],
      posts: [],
      dirtyPosts: new Set<string>(),
      isLoading: false,
    });
  });

  it('shows quick-actions button for image media', async () => {
    const view = render(<MediaEditor mediaId="media-1" />);
    const ui = within(view.container);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(ui.getByRole('button', { name: /Quick Actions/i })).toBeInTheDocument();
  });

  it('shows quick-actions button for non-image media', async () => {
    useAppStore.setState({
      media: [createMedia({ mimeType: 'application/pdf', width: undefined, height: undefined })],
    });

    const view = render(<MediaEditor mediaId="media-1" />);
    const ui = within(view.container);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(ui.getByRole('button', { name: /Quick Actions/i })).toBeInTheDocument();
  });

  it('shows AI analysis, detect language, and translate items in the quick-actions menu', async () => {
    const view = render(<MediaEditor mediaId="media-1" />);
    const ui = within(view.container);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: /Quick Actions/i }));
    });

    expect(ui.getByText('AI: Generate Title, Alt & Caption')).toBeInTheDocument();
    expect(ui.getByText('Detect Language')).toBeInTheDocument();
    expect(ui.getByText('Translate to...')).toBeInTheDocument();
  });

  it('hides AI analysis item for non-image media but shows detect + translate', async () => {
    useAppStore.setState({
      media: [createMedia({ mimeType: 'application/pdf', width: undefined, height: undefined })],
    });

    const view = render(<MediaEditor mediaId="media-1" />);
    const ui = within(view.container);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: /Quick Actions/i }));
    });

    expect(ui.queryByText('AI: Generate Title, Alt & Caption')).toBeNull();
    expect(ui.getByText('Detect Language')).toBeInTheDocument();
    expect(ui.getByText('Translate to...')).toBeInTheDocument();
  });

  it('calls detectMediaLanguage and updates the language dropdown on detect', async () => {
    const view = render(<MediaEditor mediaId="media-1" />);
    const ui = within(view.container);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: /Quick Actions/i }));
    });

    await act(async () => {
      fireEvent.click(ui.getByText('Detect Language'));
    });

    expect((window as any).electronAPI.chat.detectMediaLanguage).toHaveBeenCalledWith(
      'Test Image', 'A test image', 'Photo caption'
    );
  });

  it('opens a translation modal from quick-actions and translates on confirm', async () => {
    const view = render(<MediaEditor mediaId="media-1" />);
    const ui = within(view.container);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: /Quick Actions/i }));
    });

    await act(async () => {
      fireEvent.click(ui.getByText('Translate to...'));
    });

    expect(ui.getByRole('heading', { name: 'Translations' })).toBeInTheDocument();
    expect(ui.getByText('Select target language')).toBeInTheDocument();
    expect(ui.getByText(/Current language/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(ui.getByLabelText('Select target language'), { target: { value: 'fr' } });
    });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: 'Translate to…' }));
    });

    expect((window as any).electronAPI.chat.translateMediaMetadata).toHaveBeenCalledWith('media-1', 'fr');
  });

  it('disables translate quick-action when no language is set', async () => {
    useAppStore.setState({
      media: [createMedia({ language: '' })],
    });

    const view = render(<MediaEditor mediaId="media-1" />);
    const ui = within(view.container);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: /Quick Actions/i }));
    });

    const translateButton = ui.getByText('Translate to...').closest('button');
    expect(translateButton).toBeDisabled();
  });

  describe('edit translation modal', () => {
    const translationFixture = {
      id: 'trans-1',
      projectId: 'project-1',
      translationFor: 'media-1',
      language: 'fr',
      title: 'Titre français',
      alt: 'Alt français',
      caption: 'Légende française',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('opens edit modal when clicking a translation title', async () => {
      (window as any).electronAPI.media.getTranslations = vi.fn().mockResolvedValue([translationFixture]);

      const view = render(<MediaEditor mediaId="media-1" />);
      const ui = within(view.container);

      await act(async () => { await Promise.resolve(); await Promise.resolve(); });

      const translationTitle = ui.getByText(/Titre français/);
      expect(translationTitle).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(translationTitle);
      });

      expect(ui.getByRole('heading', { name: /Edit Translation/ })).toBeInTheDocument();
      expect((ui.getByDisplayValue('Titre français') as HTMLInputElement)).toBeInTheDocument();
      expect((ui.getByDisplayValue('Alt français') as HTMLInputElement)).toBeInTheDocument();
      expect((ui.getByDisplayValue('Légende française') as HTMLTextAreaElement)).toBeInTheDocument();
    });

    it('closes edit modal on cancel', async () => {
      (window as any).electronAPI.media.getTranslations = vi.fn().mockResolvedValue([translationFixture]);

      const view = render(<MediaEditor mediaId="media-1" />);
      const ui = within(view.container);

      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await act(async () => { fireEvent.click(ui.getByText(/Titre français/)); });

      expect(ui.getByRole('heading', { name: /Edit Translation/ })).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(ui.getByRole('button', { name: /Cancel/i }));
      });

      expect(ui.queryByRole('heading', { name: /Edit Translation/ })).toBeNull();
    });

    it('saves translation via upsertTranslation and shows success toast', async () => {
      (window as any).electronAPI.media.getTranslations = vi.fn().mockResolvedValue([translationFixture]);
      const { showToast } = await import('../../../src/renderer/components/Toast');

      const view = render(<MediaEditor mediaId="media-1" />);
      const ui = within(view.container);

      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await act(async () => { fireEvent.click(ui.getByText(/Titre français/)); });

      const modal = ui.getByText(/Edit Translation/).closest('.translation-modal')!;
      const modalUi = within(modal as HTMLElement);

      await act(async () => {
        fireEvent.click(modalUi.getByRole('button', { name: /Save/i }));
      });

      expect((window as any).electronAPI.media.upsertTranslation).toHaveBeenCalledWith(
        'media-1', 'fr', { title: 'Titre français', alt: 'Alt français', caption: 'Légende française' }
      );
      expect(showToast.success).toHaveBeenCalled();
    });

    it('shows error toast when save fails', async () => {
      (window as any).electronAPI.media.getTranslations = vi.fn().mockResolvedValue([translationFixture]);
      (window as any).electronAPI.media.upsertTranslation = vi.fn().mockRejectedValue(new Error('DB Error'));
      const { showToast } = await import('../../../src/renderer/components/Toast');

      const view = render(<MediaEditor mediaId="media-1" />);
      const ui = within(view.container);

      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await act(async () => { fireEvent.click(ui.getByText(/Titre français/)); });

      const modal = ui.getByText(/Edit Translation/).closest('.translation-modal')!;
      const modalUi = within(modal as HTMLElement);

      await act(async () => {
        fireEvent.click(modalUi.getByRole('button', { name: /Save/i }));
      });

      expect(showToast.error).toHaveBeenCalled();
    });
  });
});
