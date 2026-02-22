import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { MenuEditorView } from '../../../src/renderer/components/MenuEditorView/MenuEditorView';

describe('MenuEditorView entry editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      menu: {
        get: vi.fn().mockResolvedValue({
          items: [
            {
              id: 'menu-home',
              title: 'Home',
              kind: 'home',
              pageSlug: 'home',
              children: [],
            },
          ],
        }),
        save: vi.fn().mockResolvedValue({ items: [] }),
      },
      meta: {
        ...(window as any).electronAPI?.meta,
        getCategories: vi.fn().mockResolvedValue(['news', 'tech']),
        getProjectMetadata: vi.fn().mockResolvedValue({
          name: 'Project 1',
          categoryMetadata: {
            news: { title: 'Newsroom', renderInLists: true, showTitle: true },
            tech: { title: 'Technology', renderInLists: true, showTitle: true },
          },
        }),
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

  it('uses the same selector control pattern as tag input for page selection', async () => {
    const { container } = render(<MenuEditorView />);

    const addButton = await screen.findByRole('button', { name: /add entry/i });
    fireEvent.click(addButton);

    const input = await screen.findByPlaceholderText(/type a page title or submenu label/i);
    expect(input.closest('.tag-input-wrapper')).not.toBeNull();
    expect(input.closest('.menu-editor-row')).not.toBeNull();
    expect(container.querySelector('.menu-editor-inline-search')).toBeNull();
    expect(container.querySelector('.menu-editor-picker-list')).toBeNull();
    expect(container.querySelector('.menu-editor-picker-item')).toBeNull();

    fireEvent.input(input, { target: { value: 'ab' } });
    const suggestion = await screen.findByRole('button', { name: /^about$/i });
    expect(suggestion.className).toContain('tag-suggestion');

    const wrapper = input.closest('.tag-input-wrapper');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain('page-input-wrapper-inline');
  });

  it('focuses the new in-row page input immediately after creating an entry', async () => {
    render(<MenuEditorView />);

    const addButton = await screen.findByRole('button', { name: /add entry/i });
    fireEvent.click(addButton);

    const input = await screen.findByPlaceholderText(/type a page title or submenu label/i);
    expect(document.activeElement).toBe(input);
  });

  it('sets the current row as submenu from typed input instead of creating another entry', async () => {
    render(<MenuEditorView />);

    const addButton = await screen.findByRole('button', { name: /add entry/i });
    fireEvent.click(addButton);

    const input = await screen.findByPlaceholderText(/type a page title or submenu label/i);
    fireEvent.input(input, { target: { value: 'Products' } });

    const createSubmenuOption = await screen.findByRole('button', { name: /add submenu/i });
    fireEvent.click(createSubmenuOption);

    expect(screen.queryByPlaceholderText(/type a page title or submenu label/i)).not.toBeInTheDocument();
    expect(screen.getByText('Products')).toBeInTheDocument();
  });

  it('sets the current row to selected page from the suggestion list', async () => {
    render(<MenuEditorView />);

    const addButton = await screen.findByRole('button', { name: /add entry/i });
    fireEvent.click(addButton);

    const input = await screen.findByPlaceholderText(/type a page title or submenu label/i);
    fireEvent.input(input, { target: { value: 'about' } });

    const pageSuggestion = await screen.findByRole('button', { name: /^about$/i });
    fireEvent.click(pageSuggestion);

    expect(screen.queryByPlaceholderText(/type a page title or submenu label/i)).not.toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('keeps focus while typing multiple characters', async () => {
    const { container } = render(<MenuEditorView />);

    const addButton = await screen.findByRole('button', { name: /add entry/i });
    fireEvent.click(addButton);

    const input = await screen.findByPlaceholderText(/type a page title or submenu label/i);
    fireEvent.input(input, { target: { value: 'a' } });
    fireEvent.input(input, { target: { value: 'ab' } });
    fireEvent.input(input, { target: { value: 'abc' } });

    expect((input as HTMLInputElement).value).toBe('abc');
    expect(container.querySelector('.tag-input-field')).toBe(input);
  });

  it('caps matching page suggestions to the same limit as tag input', async () => {
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
    fireEvent.input(input, { target: { value: 'page' } });

    const options = await screen.findAllByRole('button', { name: /page\s+\d+/i });
    expect(options).toHaveLength(8);
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

  it('finalizes entry as page on a single-click suggestion selection', async () => {
    render(<MenuEditorView />);

    const addButton = await screen.findByRole('button', { name: /add entry/i });
    fireEvent.click(addButton);

    const input = await screen.findByPlaceholderText(/type a page title or submenu label/i);
    fireEvent.input(input, { target: { value: 'about' } });

    const pageOption = await screen.findByRole('button', { name: /about/i });
    fireEvent.click(pageOption);

    expect(screen.queryByPlaceholderText(/type a page title or submenu label/i)).not.toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('shows a category archive create button (C+) in toolbar', async () => {
    render(<MenuEditorView />);

    await screen.findByRole('button', { name: /add entry/i });
    expect(screen.getByRole('button', { name: /add category archive/i })).toBeInTheDocument();
  });

  it('opens category input when category archive button is clicked', async () => {
    render(<MenuEditorView />);

    const button = await screen.findByRole('button', { name: /add category archive/i });
    fireEvent.click(button);

    expect(await screen.findByPlaceholderText(/type a category name/i)).toBeInTheDocument();
  });

  it('shows category metadata title in outline rows for category archives', async () => {
    (window as any).electronAPI.menu.get = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'menu-home',
          title: 'Home',
          kind: 'home',
          pageSlug: 'home',
          children: [],
        },
        {
          id: 'cat-news',
          title: 'news',
          kind: 'category-archive',
          categoryName: 'news',
          children: [],
        },
      ],
    });

    render(<MenuEditorView />);

    await screen.findByText('Home');
    expect(screen.getByText('Newsroom')).toBeInTheDocument();
    expect(screen.queryByText(/^news$/i)).not.toBeInTheDocument();
  });

  it('disables delete action when Home entry is selected', async () => {
    render(<MenuEditorView />);

    await screen.findByText('Home');
    const deleteButton = screen.getByRole('button', { name: /^delete$/i });
    expect(deleteButton).toBeDisabled();
  });

  it('shows type as icon only (no visible type text label)', async () => {
    const { container } = render(<MenuEditorView />);

    await screen.findByText('Home');

    const icon = container.querySelector('.menu-editor-row-kind-icon[data-kind="home"]');
    expect(icon).not.toBeNull();
    expect(screen.queryByText(/^page$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^submenu$/i)).not.toBeInTheDocument();
  });

  it('recalculates tree viewport height after loading so outline uses available space', async () => {
    const { container } = render(<MenuEditorView />);
    await screen.findByText('Home');
    await testUtils.wait(0);

    const tree = container.querySelector('[role="tree"]') as HTMLElement | null;
    expect(tree).not.toBeNull();
    expect(tree?.style.height).not.toBe('460px');
  });

  it('uses category titles for suggestions and outline while saving category slug internally', async () => {
    render(<MenuEditorView />);

    const categoryButton = await screen.findByRole('button', { name: /add category archive/i });
    fireEvent.click(categoryButton);

    const input = await screen.findByPlaceholderText(/type a category name/i);
    fireEvent.input(input, { target: { value: 'room' } });

    const suggestion = await screen.findByRole('button', { name: /newsroom/i });
    fireEvent.click(suggestion);

    expect(screen.getByText('Newsroom')).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: /^save menu$/i });
    fireEvent.click(saveButton);

    const saveMock = (window as any).electronAPI.menu.save;
    expect(saveMock).toHaveBeenCalled();
    const payload = saveMock.mock.calls[0][0];

    const categoryItem = payload.items.find((item: any) => item.kind === 'category-archive');
    expect(categoryItem).toBeDefined();
    expect(categoryItem.title).toBe('Newsroom');
    expect(categoryItem.categoryName).toBe('news');
  });

  it('allows creating a new category archive from free text', async () => {
    const { container } = render(<MenuEditorView />);

    const categoryButton = await screen.findByRole('button', { name: /add category archive/i });
    fireEvent.click(categoryButton);

    const input = await screen.findByPlaceholderText(/type a category name/i);
    fireEvent.input(input, { target: { value: 'not-existing-category' } });

    const createSuggestion = container.querySelector('.tag-suggestion.create-new');
    expect(createSuggestion).not.toBeNull();
  });

});
