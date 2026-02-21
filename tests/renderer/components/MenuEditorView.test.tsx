import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { MenuEditorView } from '../../../src/renderer/components/MenuEditorView/MenuEditorView';

describe('MenuEditorView entry editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (window as any).addEventListener = vi.fn();
    (window as any).removeEventListener = vi.fn();

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      menu: {
        get: vi.fn().mockResolvedValue({
          items: [
            {
              id: 'root-page',
              title: 'Home',
              kind: 'page',
              children: [],
            },
          ],
        }),
        save: vi.fn().mockResolvedValue({ items: [] }),
      },
      posts: {
        ...(window as any).electronAPI?.posts,
        filter: vi.fn().mockResolvedValue([
          {
            id: 'page-about',
            projectId: 'project-1',
            title: 'About',
            slug: 'about',
            content: '',
            status: 'published',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            tags: [],
            categories: ['page'],
          },
        ]),
      },
    };
  });

  it('uses a standalone input editor and keeps focus while typing multiple characters', async () => {
    const { container } = render(<MenuEditorView />);

    const addButton = await screen.findByRole('button', { name: /add entry/i });
    fireEvent.click(addButton);

    const input = await screen.findByPlaceholderText(/type a page title or submenu label/i);
    expect(input.closest('.menu-editor-entry-editor')).not.toBeNull();

    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.change(input, { target: { value: 'abc' } });

    expect((input as HTMLInputElement).value).toBe('abc');
    expect(document.activeElement).toBe(input);

    expect(container.querySelector('.menu-editor-row .menu-editor-inline-input')).toBeNull();
  });

  it('renders all matching page results without UI capping', async () => {
    const pagePosts = Array.from({ length: 12 }).map((_, index) => ({
      id: `page-${index + 1}`,
      projectId: 'project-1',
      title: `Page ${index + 1}`,
      slug: `page-${index + 1}`,
      content: '',
      status: 'published',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: [],
      categories: ['page'],
    }));

    (window as any).electronAPI.posts.filter = vi.fn().mockResolvedValue(pagePosts);

    render(<MenuEditorView />);

    const addButton = await screen.findByRole('button', { name: /add entry/i });
    fireEvent.click(addButton);

    const input = await screen.findByPlaceholderText(/type a page title or submenu label/i);
    fireEvent.change(input, { target: { value: 'page' } });

    const options = await screen.findAllByRole('button', { name: /page\s+\d+/i });
    expect(options).toHaveLength(12);
  });

  it('shows standard outliner control buttons in the toolbar', async () => {
    render(<MenuEditorView />);

    await screen.findByRole('button', { name: /add entry/i });

    expect(screen.getByRole('button', { name: /^move up$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^move down$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^indent$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^unindent$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });

  it('marks outliner rows as drag handles so drag-and-drop can start from rows', async () => {
    const { container } = render(<MenuEditorView />);

    await screen.findByRole('button', { name: /add entry/i });

    const row = container.querySelector('.menu-editor-row');
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute('data-drag-handle', 'true');
  });

  it('finalizes entry as page on a double-click gesture', async () => {
    render(<MenuEditorView />);

    const addButton = await screen.findByRole('button', { name: /add entry/i });
    fireEvent.click(addButton);

    const pageOption = await screen.findByRole('button', { name: /about/i });
    fireEvent.doubleClick(pageOption);

    expect(screen.queryByPlaceholderText(/type a page title or submenu label/i)).not.toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
  });

});
