import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsView } from '../../../src/renderer/components/SettingsView/SettingsView';
import { useAppStore } from '../../../src/renderer/store';

describe('SettingsView Diff Preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
        getProjectMetadata: vi.fn().mockResolvedValue({}),
      },
      chat: {
        ...(window as any).electronAPI?.chat,
        getSystemPrompt: vi.fn().mockResolvedValue({ success: true, prompt: '' }),
        getApiKey: vi.fn().mockResolvedValue({ hasKey: false, maskedKey: '' }),
        getAvailableModels: vi.fn().mockResolvedValue({ success: true, models: [], selectedModel: '' }),
      },
      projects: {
        ...(window as any).electronAPI?.projects,
        update: vi.fn().mockResolvedValue(null),
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
});
