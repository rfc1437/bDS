import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActivityBar } from '../../../src/renderer/components/ActivityBar/ActivityBar';
import { I18nProvider } from '../../../src/renderer/i18n';
import { useAppStore } from '../../../src/renderer/store';

describe('ActivityBar tags behavior', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeView: 'posts',
      sidebarVisible: true,
      tabs: [],
      activeTabId: null,
    });
  });

  it('opens tags tab and switches sidebar to tags view when clicking Tags', () => {
    render(
      <I18nProvider>
        <ActivityBar />
      </I18nProvider>
    );

    fireEvent.click(screen.getByTitle('Tags (click again to toggle sidebar)'));

    const state = useAppStore.getState();
    expect(state.activeView).toBe('tags');
    expect(state.sidebarVisible).toBe(true);
    expect(state.activeTabId).toBe('tags');
    expect(state.tabs).toContainEqual({ type: 'tags', id: 'tags', isTransient: false });
  });

  it('toggles tags sidebar off when tags view is already active', () => {
    useAppStore.setState({
      activeView: 'tags',
      sidebarVisible: true,
      tabs: [{ type: 'tags', id: 'tags', isTransient: false }],
      activeTabId: 'tags',
    });

    render(
      <I18nProvider>
        <ActivityBar />
      </I18nProvider>
    );

    fireEvent.click(screen.getByTitle('Tags (click again to toggle sidebar)'));

    expect(useAppStore.getState().sidebarVisible).toBe(false);
  });

  it('shows tags sidebar when hidden and tags view is active', () => {
    useAppStore.setState({
      activeView: 'tags',
      sidebarVisible: false,
      tabs: [{ type: 'tags', id: 'tags', isTransient: false }],
      activeTabId: 'tags',
    });

    render(
      <I18nProvider>
        <ActivityBar />
      </I18nProvider>
    );

    fireEvent.click(screen.getByTitle('Tags (click again to toggle sidebar)'));

    expect(useAppStore.getState().sidebarVisible).toBe(true);
  });

  it('does not mark tags icon active when tags editor tab is open but another sidebar is active', () => {
    useAppStore.setState({
      activeView: 'posts',
      sidebarVisible: true,
      tabs: [{ type: 'tags', id: 'tags', isTransient: false }],
      activeTabId: 'tags',
    });

    render(
      <I18nProvider>
        <ActivityBar />
      </I18nProvider>
    );

    expect(screen.getByTitle('Tags (click again to toggle sidebar)')).not.toHaveClass('active');
  });

  it('uses the shared toggle hint in the tags activity button title', () => {
    render(
      <I18nProvider>
        <ActivityBar />
      </I18nProvider>
    );

    expect(screen.getByTitle('Tags (click again to toggle sidebar)')).toBeInTheDocument();
  });
});
