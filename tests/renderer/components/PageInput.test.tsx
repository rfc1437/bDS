import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PageInput } from '../../../src/renderer/components/PageInput/PageInput';

describe('PageInput', () => {
  const pages = [
    {
      id: 'page-1',
      projectId: 'project-1',
      title: 'About',
      slug: 'about',
      content: '',
      status: 'published' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: [],
      categories: ['page'],
    },
    {
      id: 'page-2',
      projectId: 'project-1',
      title: 'Contact',
      slug: 'contact',
      content: '',
      status: 'published' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: [],
      categories: ['page'],
    },
  ];

  it('selects a page suggestion', async () => {
    const onSelectPage = vi.fn();
    const onCreateSubmenu = vi.fn();

    render(
      <PageInput
        pages={pages}
        onSelectPage={onSelectPage}
        onCreateSubmenu={onCreateSubmenu}
        placeholder="Type"
        createSubmenuLabel="Add Submenu"
      />
    );

    const input = screen.getByPlaceholderText('Type');
    fireEvent.input(input, { target: { value: 'abo' } });

    const suggestion = await screen.findByRole('button', { name: /^about$/i });
    fireEvent.click(suggestion);

    expect(onSelectPage).toHaveBeenCalledTimes(1);
    expect(onSelectPage).toHaveBeenCalledWith(expect.objectContaining({ id: 'page-1' }));
    expect(onCreateSubmenu).not.toHaveBeenCalled();
  });

  it('offers submenu creation from free text', async () => {
    const onSelectPage = vi.fn();
    const onCreateSubmenu = vi.fn();

    render(
      <PageInput
        pages={pages}
        onSelectPage={onSelectPage}
        onCreateSubmenu={onCreateSubmenu}
        placeholder="Type"
        createSubmenuLabel="Add Submenu"
      />
    );

    const input = screen.getByPlaceholderText('Type');
    fireEvent.input(input, { target: { value: 'Products' } });

    const createOption = await screen.findByRole('button', { name: /add submenu/i });
    fireEvent.click(createOption);

    expect(onCreateSubmenu).toHaveBeenCalledWith('Products');
    expect(onSelectPage).not.toHaveBeenCalled();
  });
});
