import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor" />,
}));

vi.mock('../../../src/renderer/components/MilkdownEditor', () => ({ MilkdownEditor: () => null }));
vi.mock('../../../src/renderer/components/Lightbox', () => ({
  Lightbox: () => null,
  useMarkdownImages: () => [],
}));
vi.mock('../../../src/renderer/components/PostLinks', () => ({ PostLinks: () => null }));
vi.mock('../../../src/renderer/components/LinkedMediaPanel', () => ({ LinkedMediaPanel: () => null }));
vi.mock('../../../src/renderer/components/ErrorModal', () => ({ ErrorModal: () => null }));
vi.mock('../../../src/renderer/components/ConfirmDeleteModal', () => ({ ConfirmDeleteModal: () => null }));
vi.mock('../../../src/renderer/components/SettingsView', () => ({ SettingsView: () => null }));
vi.mock('../../../src/renderer/components/StyleView/StyleView', () => ({ StyleView: () => null }));
vi.mock('../../../src/renderer/components/TagsView', () => ({ TagsView: () => null }));
vi.mock('../../../src/renderer/components/TagInput', () => ({ TagInput: () => null }));
vi.mock('../../../src/renderer/components/ChatPanel', () => ({ ChatPanel: () => null }));
vi.mock('../../../src/renderer/components/ImportAnalysisView', () => ({ ImportAnalysisView: () => null }));
vi.mock('../../../src/renderer/components/MenuEditorView/MenuEditorView', () => ({ MenuEditorView: () => null }));
vi.mock('../../../src/renderer/components/MetadataDiffPanel', () => ({ MetadataDiffPanel: () => null }));
vi.mock('../../../src/renderer/components/GitDiffView/GitDiffView', () => ({ GitDiffView: () => null }));
vi.mock('../../../src/renderer/components/DocumentationView/DocumentationView', () => ({ DocumentationView: () => null }));
vi.mock('../../../src/renderer/components/SiteValidationView', () => ({ SiteValidationView: () => null }));
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

import { Editor } from '../../../src/renderer/components/Editor/Editor';
import { useAppStore } from '../../../src/renderer/store';

describe('Editor dashboard timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (window as any).electronAPI.posts.getDashboardStats = vi.fn().mockResolvedValue({
      totalPosts: 1,
      draftCount: 0,
      publishedCount: 1,
      archivedCount: 0,
    });
    (window as any).electronAPI.posts.getByYearMonth = vi.fn().mockResolvedValue([
      { year: 2024, month: 0, count: 1 },
    ]);
    (window as any).electronAPI.posts.getTagsWithCounts = vi.fn().mockResolvedValue([]);
    (window as any).electronAPI.posts.getCategoriesWithCounts = vi.fn().mockResolvedValue([]);
    (window as any).electronAPI.chat = {};
    (window as any).electronAPI.tags = {
      getAll: vi.fn().mockResolvedValue([]),
    };
    (window as any).electronAPI.app.setPreviewPostTarget = vi.fn().mockResolvedValue(undefined);

    useAppStore.setState({
      activeProject: { id: 'project-1', name: 'Test', path: '/tmp/test' } as any,
      tabs: [],
      activeTabId: null,
      posts: [],
      media: [],
      isLoading: false,
      errorModal: null,
      confirmDeleteModal: null,
    });
  });

  it('shows the timeline year for each month label', async () => {
    render(<Editor />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('2024')).toBeInTheDocument();
  });
});