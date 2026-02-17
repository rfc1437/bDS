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
    const iconFrame = toggleButton.querySelector('.window-titlebar-sidebar-icon');
    const iconPane = toggleButton.querySelector('.window-titlebar-sidebar-pane');

    expect(iconFrame).not.toBeNull();
    expect(iconPane).not.toBeNull();
    expect(iconFrame).toHaveAttribute('data-shape', 'frame-square');
    expect(iconPane).toHaveAttribute('data-shape', 'left-half');
  });
});
