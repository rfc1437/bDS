import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProjectSelector } from '../../../src/renderer/components/ProjectSelector/ProjectSelector';
import { useAppStore } from '../../../src/renderer/store';
import { I18nProvider } from '../../../src/renderer/i18n';

describe('ProjectSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      projects: {
        getAll: vi.fn().mockResolvedValue([
          { id: 'default', name: 'Default', slug: 'default', isActive: true, createdAt: '', updatedAt: '' },
          { id: 'p2', name: 'Blog Two', slug: 'blog-two', isActive: false, createdAt: '', updatedAt: '' },
        ]),
        setActive: vi.fn().mockResolvedValue({ id: 'p2', name: 'Blog Two', slug: 'blog-two', isActive: true }),
        create: vi.fn(),
        deleteWithData: vi.fn(),
      },
      posts: { getAll: vi.fn().mockResolvedValue({ items: [], hasMore: false, total: 0 }) },
      media: { getAll: vi.fn().mockResolvedValue([]) },
      app: {
        getSystemLanguage: vi.fn().mockResolvedValue('en-US'),
      },
    };

    useAppStore.setState({
      projects: [
        { id: 'default', name: 'Default', slug: 'default', isActive: true, createdAt: '', updatedAt: '' },
        { id: 'p2', name: 'Blog Two', slug: 'blog-two', isActive: false, createdAt: '', updatedAt: '' },
      ],
      activeProject: { id: 'default', name: 'Default', slug: 'default', isActive: true, createdAt: '', updatedAt: '' },
    } as any);
  });

  it('opens project dropdown when trigger is clicked', async () => {
    render(
      <I18nProvider>
        <ProjectSelector />
      </I18nProvider>,
    );

    const trigger = screen.getByTitle('Switch project');
    fireEvent.click(trigger);

    // The dropdown should appear and list the projects
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getAllByText('Default').length).toBeGreaterThanOrEqual(2); // trigger + list item
    expect(screen.getByText('Blog Two')).toBeInTheDocument();
  });

  it('closes dropdown when clicking outside', async () => {
    render(
      <I18nProvider>
        <ProjectSelector />
      </I18nProvider>,
    );

    const trigger = screen.getByTitle('Switch project');
    fireEvent.click(trigger);
    expect(screen.getByText('Projects')).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Projects')).not.toBeInTheDocument();
  });
});
