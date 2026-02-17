import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WindowTitleBar } from '../../../src/renderer/components/WindowTitleBar/WindowTitleBar';
import { useAppStore } from '../../../src/renderer/store';

describe('WindowTitleBar', () => {
  beforeEach(() => {
    useAppStore.setState({
      sidebarVisible: true,
    });
  });

  it('renders a right-side sidebar toggle button and toggles store state', () => {
    render(<WindowTitleBar />);

    const toggleButton = screen.getByLabelText('Toggle Sidebar');
    expect(toggleButton).toBeInTheDocument();
    expect(toggleButton).toHaveAttribute('title', 'Hide Sidebar (Ctrl+B)');

    fireEvent.click(toggleButton);

    expect(useAppStore.getState().sidebarVisible).toBe(false);
    expect(toggleButton).toHaveAttribute('title', 'Show Sidebar (Ctrl+B)');
  });

  it('uses a VS Code-like sidebar toggle icon shape', () => {
    render(<WindowTitleBar />);

    const toggleButton = screen.getByLabelText('Toggle Sidebar');
    const svg = toggleButton.querySelector('svg');
    const paths = svg?.querySelectorAll('path');

    expect(svg).not.toBeNull();
    expect(paths?.[0]?.getAttribute('d')).toBe('M3 3.75A1.75 1.75 0 0 1 4.75 2h6.5A1.75 1.75 0 0 1 13 3.75v8.5A1.75 1.75 0 0 1 11.25 14h-6.5A1.75 1.75 0 0 1 3 12.25v-8.5z');
    expect(paths?.[1]?.getAttribute('d')).toBe('M4.5 3.5h3.75v9H4.5z');
  });
});
