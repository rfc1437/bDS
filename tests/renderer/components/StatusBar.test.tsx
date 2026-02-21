import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StatusBar } from '../../../src/renderer/components/StatusBar/StatusBar';
import { useAppStore } from '../../../src/renderer/store';
import { I18nProvider } from '../../../src/renderer/i18n';

vi.mock('../../../src/renderer/components/ProjectSelector', () => ({
  ProjectSelector: () => <div data-testid="project-selector">Project</div>,
}));

describe('StatusBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (window.electronAPI.app as { getSystemLanguage?: () => Promise<string> }).getSystemLanguage = async () => 'de-DE';
    useAppStore.setState({
      media: [],
      tasks: [],
      selectedPostId: null,
      totalPosts: 0,
      picoTheme: 'slate',
    } as any);
  });

  it('shows the currently applied theme', async () => {
    render(
      <I18nProvider>
        <StatusBar />
      </I18nProvider>
    );

    await screen.findByTestId('statusbar-language-select');

    expect(screen.getByText('Theme: slate')).toBeInTheDocument();
  });

  it('shows ui language badge and allows switching language', async () => {
    render(
      <I18nProvider>
        <StatusBar />
      </I18nProvider>
    );

    const languageSelect = await screen.findByTestId('statusbar-language-select');
    expect(languageSelect).toHaveValue('de');

    fireEvent.change(languageSelect, { target: { value: 'fr' } });
    expect(languageSelect).toHaveValue('fr');

    expect(localStorage.setItem).toHaveBeenCalledWith('bds-ui-language', 'fr');
  });
});
