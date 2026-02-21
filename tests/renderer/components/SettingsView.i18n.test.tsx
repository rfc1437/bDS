import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsView } from '../../../src/renderer/components/SettingsView/SettingsView';
import { useAppStore } from '../../../src/renderer/store';
import { I18nProvider, UI_LANGUAGE_STORAGE_KEY } from '../../../src/renderer/i18n';
import { SUPPORTED_RENDER_LANGUAGES } from '../../../src/main/shared/i18n';

describe('SettingsView i18n', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'de');
    (window.electronAPI.app as { getSystemLanguage?: () => Promise<string> }).getSystemLanguage = async () => 'de-DE';

    useAppStore.setState({
      activeProject: {
        id: 'project-1',
        name: 'Testprojekt',
        slug: 'testprojekt',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      gitDiffPreferences: {
        wordWrap: true,
        viewStyle: 'inline',
        hideUnchangedRegions: false,
      },
    } as never);

    (window as Window & { electronAPI: any }).electronAPI = {
      ...(window as Window & { electronAPI: any }).electronAPI,
      app: {
        ...(window as Window & { electronAPI: any }).electronAPI?.app,
        getDefaultProjectPath: vi.fn().mockResolvedValue('/repo/path'),
      },
      meta: {
        ...(window as Window & { electronAPI: any }).electronAPI?.meta,
        getCategories: vi.fn().mockResolvedValue(['article', 'picture', 'aside', 'page']),
        getProjectMetadata: vi.fn().mockResolvedValue({}),
      },
      chat: {
        ...(window as Window & { electronAPI: any }).electronAPI?.chat,
        getSystemPrompt: vi.fn().mockResolvedValue({ success: true, prompt: '' }),
        getApiKey: vi.fn().mockResolvedValue({ hasKey: false, maskedKey: '' }),
        getAvailableModels: vi.fn().mockResolvedValue({ success: true, models: [], selectedModel: '' }),
      },
    };
  });

  it('renders project section labels in selected UI language', async () => {
    render(
      <I18nProvider>
        <SettingsView />
      </I18nProvider>
    );

    expect(await screen.findByText('Projekt')).toBeInTheDocument();
    expect(screen.getByText('Projektname')).toBeInTheDocument();
    expect(screen.getByText('Projekteinstellungen speichern')).toBeInTheDocument();
  });

  it('shows only supported render languages in project language selector', async () => {
    render(
      <I18nProvider>
        <SettingsView />
      </I18nProvider>
    );

    const select = await screen.findByLabelText('Hauptsprache');
    const options = Array.from((select as HTMLSelectElement).options).map((option) => option.value);

    expect(options).toEqual(SUPPORTED_RENDER_LANGUAGES);
  });
});
