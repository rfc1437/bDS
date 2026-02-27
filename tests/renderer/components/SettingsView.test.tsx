import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsView } from '../../../src/renderer/components/SettingsView/SettingsView';
import { useAppStore } from '../../../src/renderer/store';

describe('SettingsView Diff Preferences', () => {
  let updateProjectMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    updateProjectMock = vi.fn().mockResolvedValue({
      id: 'project-1',
      name: 'Test Project',
      slug: 'test-project',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    useAppStore.setState({
      activeProject: {
        id: 'project-1',
        name: 'Test Project',
        slug: 'test-project',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      gitDiffPreferences: {
        wordWrap: true,
        viewStyle: 'inline',
        hideUnchangedRegions: false,
      },
    });

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      app: {
        ...(window as any).electronAPI?.app,
        getDefaultProjectPath: vi.fn().mockResolvedValue('/repo/path'),
      },
      meta: {
        ...(window as any).electronAPI?.meta,
        getCategories: vi.fn().mockResolvedValue(['article', 'picture', 'aside', 'page']),
        getProjectMetadata: vi.fn().mockResolvedValue({
          maxPostsPerPage: 75,
          publicUrl: 'https://example.com',
          categorySettings: {
            article: { renderInLists: true, showTitle: true },
            picture: { renderInLists: true, showTitle: true },
            aside: { renderInLists: true, showTitle: false },
            page: { renderInLists: false, showTitle: true },
          },
        }),
        updateProjectMetadata: vi.fn().mockResolvedValue({ maxPostsPerPage: 12, publicUrl: 'https://example.com' }),
      },
      chat: {
        ...(window as any).electronAPI?.chat,
        getSystemPrompt: vi.fn().mockResolvedValue({ success: true, prompt: '' }),
        getApiKey: vi.fn().mockResolvedValue({ hasKey: false, maskedKey: '' }),
        getAvailableModels: vi.fn().mockResolvedValue({ success: true, models: [], selectedModel: '' }),
      },
      templates: {
        ...(window as any).electronAPI?.templates,
        getEnabledByKind: vi.fn().mockResolvedValue([]),
      },
      projects: {
        ...(window as any).electronAPI?.projects,
        update: updateProjectMock,
      },
    };
  });

  it('updates git diff preferences from settings controls', async () => {
    render(<SettingsView />);

    const viewStyle = await screen.findByLabelText(/diff view style/i);
    fireEvent.change(viewStyle, { target: { value: 'side-by-side' } });

    const wrapCheckbox = screen.getByLabelText(/wrap long lines in diff/i);
    fireEvent.click(wrapCheckbox);

    const hideCheckbox = screen.getByLabelText(/hide unchanged regions/i);
    fireEvent.click(hideCheckbox);

    expect(useAppStore.getState().gitDiffPreferences).toEqual({
      wordWrap: false,
      viewStyle: 'side-by-side',
      hideUnchangedRegions: true,
    });
  });

  it('includes project-level max posts per page in metadata save payload', async () => {
    render(<SettingsView />);

    await screen.findByDisplayValue('75');

    const saveButton = screen.getByRole('button', { name: /save project settings/i });
    fireEvent.click(saveButton);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((window as any).electronAPI.meta.updateProjectMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ maxPostsPerPage: 75 })
    );
  });

  it('includes project public URL in metadata save payload', async () => {
    render(<SettingsView />);

    await screen.findByDisplayValue('https://example.com');

    const saveButton = screen.getByRole('button', { name: /save project settings/i });
    fireEvent.click(saveButton);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((window as any).electronAPI.meta.updateProjectMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ publicUrl: 'https://example.com' })
    );
  });

  it('includes python runtime mode in metadata save payload', async () => {
    (window as any).electronAPI.meta.getProjectMetadata = vi.fn().mockResolvedValue({
      maxPostsPerPage: 75,
      publicUrl: 'https://example.com',
      pythonRuntimeMode: 'main-thread',
      categorySettings: {
        article: { renderInLists: true, showTitle: true },
        picture: { renderInLists: true, showTitle: true },
        aside: { renderInLists: true, showTitle: false },
        page: { renderInLists: false, showTitle: true },
      },
    });

    render(<SettingsView />);

    await screen.findByDisplayValue('Main Thread (Legacy)');

    const saveButton = screen.getByRole('button', { name: /save project settings/i });
    fireEvent.click(saveButton);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((window as any).electronAPI.meta.updateProjectMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ pythonRuntimeMode: 'main-thread' })
    );
  });

  it('renders category settings checkboxes with required defaults', async () => {
    render(<SettingsView />);

    const asideShowTitle = await screen.findByLabelText(/aside show titles/i);
    const asideRenderInLists = screen.getByLabelText(/aside render in lists/i);
    const pageRenderInLists = screen.getByLabelText(/page render in lists/i);
    const articleShowTitle = screen.getByLabelText(/article show titles/i);

    expect((asideShowTitle as HTMLInputElement).checked).toBe(false);
    expect((asideRenderInLists as HTMLInputElement).checked).toBe(true);
    expect((pageRenderInLists as HTMLInputElement).checked).toBe(false);
    expect((articleShowTitle as HTMLInputElement).checked).toBe(true);
  });

  it('triggers scripts rebuild from data maintenance section', async () => {
    const rebuildScriptsMock = vi.fn().mockResolvedValue(undefined);
    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      scripts: {
        ...(window as any).electronAPI?.scripts,
        rebuildFromFiles: rebuildScriptsMock,
      },
    };

    render(<SettingsView />);

    const rebuildScriptsButton = await screen.findByRole('button', { name: /rebuild scripts/i });
    fireEvent.click(rebuildScriptsButton);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rebuildScriptsMock).toHaveBeenCalledTimes(1);
  });

  it('triggers templates rebuild from data maintenance section', async () => {
    const rebuildTemplatesMock = vi.fn().mockResolvedValue(undefined);
    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      templates: {
        ...(window as any).electronAPI?.templates,
        getEnabledByKind: vi.fn().mockResolvedValue([]),
        rebuildFromFiles: rebuildTemplatesMock,
      },
    };

    render(<SettingsView />);

    const rebuildTemplatesButton = await screen.findByRole('button', { name: /rebuild templates/i });
    fireEvent.click(rebuildTemplatesButton);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rebuildTemplatesMock).toHaveBeenCalledTimes(1);
  });

  it('renders category template dropdowns populated with enabled templates', async () => {
    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      templates: {
        ...(window as any).electronAPI?.templates,
        getEnabledByKind: vi.fn().mockImplementation((kind: string) => {
          if (kind === 'post') {
            return Promise.resolve([
              { slug: 'custom_post', title: 'Custom Post' },
            ]);
          }
          if (kind === 'list') {
            return Promise.resolve([
              { slug: 'custom_list', title: 'Custom List' },
            ]);
          }
          return Promise.resolve([]);
        }),
      },
    };

    render(<SettingsView />);

    const postTemplateSelect = await screen.findByLabelText(/article post template/i);
    expect(postTemplateSelect).toBeInTheDocument();

    await vi.waitFor(() => {
      const options = postTemplateSelect.querySelectorAll('option');
      const optionTexts = Array.from(options).map((o) => o.textContent);
      expect(optionTexts).toContain('Custom Post');
    });

    const listTemplateSelect = screen.getByLabelText(/article list template/i);
    expect(listTemplateSelect).toBeInTheDocument();

    await vi.waitFor(() => {
      const options = listTemplateSelect.querySelectorAll('option');
      const optionTexts = Array.from(options).map((o) => o.textContent);
      expect(optionTexts).toContain('Custom List');
    });
  });

  it('persists category template selection via project metadata update', async () => {
    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      templates: {
        ...(window as any).electronAPI?.templates,
        getEnabledByKind: vi.fn().mockImplementation((kind: string) => {
          if (kind === 'post') {
            return Promise.resolve([
              { slug: 'custom_post', title: 'Custom Post' },
            ]);
          }
          return Promise.resolve([]);
        }),
      },
    };

    render(<SettingsView />);

    const postTemplateSelect = await screen.findByLabelText(/article post template/i);

    await vi.waitFor(() => {
      const options = postTemplateSelect.querySelectorAll('option');
      expect(Array.from(options).map((o) => o.textContent)).toContain('Custom Post');
    });

    fireEvent.change(postTemplateSelect, { target: { value: 'custom_post' } });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((window as any).electronAPI.meta.updateProjectMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryMetadata: expect.objectContaining({
          article: expect.objectContaining({ postTemplateSlug: 'custom_post' }),
        }),
      })
    );
  });

  it('persists category settings changes via project metadata update', async () => {
    render(<SettingsView />);

    const pageRenderInLists = await screen.findByLabelText(/page render in lists/i);
    fireEvent.click(pageRenderInLists);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((window as any).electronAPI.meta.updateProjectMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryMetadata: expect.objectContaining({
          page: expect.objectContaining({ renderInLists: true, showTitle: true, title: 'page' }),
        }),
      })
    );
  });
});
