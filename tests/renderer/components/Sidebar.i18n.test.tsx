import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '../../../src/renderer/components/Sidebar/Sidebar';
import { useAppStore } from '../../../src/renderer/store';
import { I18nProvider, UI_LANGUAGE_STORAGE_KEY } from '../../../src/renderer/i18n';

describe('Sidebar i18n', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'de');
    (window.electronAPI.app as { getSystemLanguage?: () => Promise<string> }).getSystemLanguage = async () => 'de-DE';

    useAppStore.setState({
      activeView: 'settings',
      sidebarVisible: true,
      tabs: [],
      activeTabId: null,
    } as never);
  });

  it('renders settings navigation labels in selected UI language', async () => {
    render(
      <I18nProvider>
        <Sidebar />
      </I18nProvider>
    );

    expect(await screen.findByText('EINSTELLUNGEN')).toBeInTheDocument();
    expect(screen.getByText('Projekt')).toBeInTheDocument();
    expect(screen.getByText('Texteditor')).toBeInTheDocument();
  });
});
