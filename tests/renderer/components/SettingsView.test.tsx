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
        getProjectMetadata: vi.fn().mockResolvedValue({ maxPostsPerPage: 75, publicUrl: 'https://example.com' }),
        updateProjectMetadata: vi.fn().mockResolvedValue({ maxPostsPerPage: 12, publicUrl: 'https://example.com' }),
      },
      chat: {
        ...(window as any).electronAPI?.chat,
        getSystemPrompt: vi.fn().mockResolvedValue({ success: true, prompt: '' }),
        getApiKey: vi.fn().mockResolvedValue({ hasKey: false, maskedKey: '' }),
        getAvailableModels: vi.fn().mockResolvedValue({ success: true, models: [], selectedModel: '' }),
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
});
