import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SidebarEntityList } from '../../../src/renderer/components/Sidebar/SidebarEntityList';

describe('SidebarEntityList', () => {
  it('renders loading state with header', () => {
    render(
      <SidebarEntityList
        header="Header"
        createTitle="Create"
        onCreate={vi.fn()}
        isLoading
        loadingLabel="Loading..."
        emptyMessage="Empty"
        emptyActionLabel="Create first"
        onEmptyAction={vi.fn()}
        items={[]}
        renderItem={() => null}
      />,
    );

    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders empty state and triggers empty action', () => {
    const onEmptyAction = vi.fn();

    render(
      <SidebarEntityList
        header="Header"
        createTitle="Create"
        onCreate={vi.fn()}
        isLoading={false}
        loadingLabel="Loading..."
        emptyMessage="Empty"
        emptyActionLabel="Create first"
        onEmptyAction={onEmptyAction}
        items={[]}
        renderItem={() => null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create first' }));
    expect(onEmptyAction).toHaveBeenCalledTimes(1);
  });

  it('renders rows and create button action', () => {
    const onCreate = vi.fn();

    render(
      <SidebarEntityList
        header="Header"
        createTitle="Create"
        onCreate={onCreate}
        isLoading={false}
        loadingLabel="Loading..."
        emptyMessage="Empty"
        emptyActionLabel="Create first"
        onEmptyAction={vi.fn()}
        items={[{ id: 'a' }]}
        getItemKey={(item) => item.id}
        renderItem={(item) => <div>{item.id}</div>}
      />,
    );

    expect(screen.getByText('a')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
