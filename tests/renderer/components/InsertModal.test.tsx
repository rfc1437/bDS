import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { InsertModal } from '../../../src/renderer/components/InsertModal/InsertModal';
import { useAppStore } from '../../../src/renderer/store/appStore';

describe('InsertModal format hints', () => {
  it('shows canonical post link format hint in internal link mode', () => {
    render(
      <InsertModal
        mode="link"
        onInsertLink={vi.fn()}
        onInsertImage={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Canonical: /YYYY/MM/DD/slug')).toBeInTheDocument();
  });

  it('shows canonical media format hint in internal image mode', () => {
    render(
      <InsertModal
        mode="image"
        onInsertLink={vi.fn()}
        onInsertImage={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Canonical: /media/YYYY/MM/file.ext')).toBeInTheDocument();
  });
});

describe('InsertModal create post', () => {
  const mockOnInsertLink = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ tabs: [], activeTabId: 'current-post' });
  });

  it('does not show create option when query is shorter than 2 characters', () => {
    render(
      <InsertModal
        mode="link"
        onInsertLink={mockOnInsertLink}
        onInsertImage={vi.fn()}
        onClose={mockOnClose}
      />
    );

    const input = screen.getByPlaceholderText('Search posts by title or content...');
    fireEvent.input(input, { target: { value: 'a' } });

    expect(screen.queryByText(/Create post/)).not.toBeInTheDocument();
  });

  it('does not show create option in image mode', async () => {
    (window.electronAPI.media.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(
      <InsertModal
        mode="image"
        onInsertLink={vi.fn()}
        onInsertImage={vi.fn()}
        onClose={mockOnClose}
      />
    );

    const input = screen.getByPlaceholderText('Search media by name, title, or alt text...');
    fireEvent.input(input, { target: { value: 'test query' } });

    // Wait for search to complete by finding the no-results message
    await screen.findByText(/No.*found/i);

    expect(screen.queryByText(/Create post/)).not.toBeInTheDocument();
  });

  it('shows create option when search has no exact title match', async () => {
    (window.electronAPI.posts.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'p1', title: 'Different Title', slug: 'different-title', excerpt: 'Some text' },
    ]);

    render(
      <InsertModal
        mode="link"
        onInsertLink={mockOnInsertLink}
        onInsertImage={vi.fn()}
        onClose={mockOnClose}
      />
    );

    const input = screen.getByPlaceholderText('Search posts by title or content...');
    fireEvent.input(input, { target: { value: 'My New Post' } });

    // Wait for search results to render
    await screen.findByText('Different Title');

    expect(screen.getByText('Create post "My New Post"')).toBeInTheDocument();
  });

  it('does not show create option when an exact title match exists', async () => {
    (window.electronAPI.posts.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'p1', title: 'My New Post', slug: 'my-new-post', excerpt: '' },
    ]);

    render(
      <InsertModal
        mode="link"
        onInsertLink={mockOnInsertLink}
        onInsertImage={vi.fn()}
        onClose={mockOnClose}
      />
    );

    const input = screen.getByPlaceholderText('Search posts by title or content...');
    fireEvent.input(input, { target: { value: 'My New Post' } });

    // Wait for results to render (slug appears in the result path)
    await screen.findByText(/my-new-post/);

    expect(screen.queryByText('Create post "My New Post"')).not.toBeInTheDocument();
  });

  it('creates post and inserts link when create option is clicked', async () => {
    (window.electronAPI.posts.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (window.electronAPI.posts.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'new-post-id',
      title: 'New Post Title',
      slug: 'new-post-title',
      content: '',
      status: 'draft',
      tags: ['tag1'],
      categories: ['article'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    render(
      <InsertModal
        mode="link"
        onInsertLink={mockOnInsertLink}
        onInsertImage={vi.fn()}
        onClose={mockOnClose}
        currentPostTags={['tag1']}
        currentPostCategories={['article']}
      />
    );

    const input = screen.getByPlaceholderText('Search posts by title or content...');
    fireEvent.input(input, { target: { value: 'New Post Title' } });

    // Wait for the create option to appear after debounced search completes
    const createButton = await screen.findByText('Create post "New Post Title"');

    await act(async () => {
      fireEvent.click(createButton);
    });

    expect(window.electronAPI.posts.create).toHaveBeenCalledWith({
      title: 'New Post Title',
      tags: ['tag1'],
      categories: ['article'],
    });

    expect(mockOnInsertLink).toHaveBeenCalledWith('/posts/new-post-title', 'New Post Title');
    expect(mockOnClose).toHaveBeenCalled();

    // Check that the tab was opened in the background
    const storeState = useAppStore.getState();
    expect(storeState.tabs).toContainEqual(
      expect.objectContaining({ type: 'post', id: 'new-post-id', isTransient: false })
    );
    expect(storeState.activeTabId).toBe('current-post');
  });

  it('shows create option when no results exist (standalone)', async () => {
    (window.electronAPI.posts.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(
      <InsertModal
        mode="link"
        onInsertLink={mockOnInsertLink}
        onInsertImage={vi.fn()}
        onClose={mockOnClose}
      />
    );

    const input = screen.getByPlaceholderText('Search posts by title or content...');
    fireEvent.input(input, { target: { value: 'Nonexistent Post' } });

    // Wait for create option to appear (replaces no-results message)
    expect(await screen.findByText('Create post "Nonexistent Post"')).toBeInTheDocument();

    // The "no results" message should not appear when create option is shown
    expect(screen.queryByText(/No posts found/i)).not.toBeInTheDocument();
  });
});
