import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('updates overlay inset CSS variables when window controls geometry changes', () => {
    const geometryListeners = new Set<EventListener>();
    let rect = {
      x: 0,
      y: 0,
      width: 924,
      height: 34,
      top: 0,
      right: 924,
      bottom: 34,
      left: 0,
      toJSON: () => '',
    } as DOMRect;

    const mockOverlay = {
      visible: true,
      getTitlebarAreaRect: () => rect,
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'geometrychange' && typeof listener === 'function') {
          geometryListeners.add(listener);
        }
      },
      removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'geometrychange' && typeof listener === 'function') {
          geometryListeners.delete(listener);
        }
      },
    };

    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    (navigator as Navigator & { windowControlsOverlay?: typeof mockOverlay }).windowControlsOverlay = mockOverlay;

    render(<WindowTitleBar />);

    expect(document.documentElement.style.getPropertyValue('--bds-titlebar-overlay-right')).toBe('100px');
    expect(document.documentElement.style.getPropertyValue('--bds-titlebar-overlay-left')).toBe('0px');

    rect = {
      ...rect,
      width: 824,
      right: 824,
    } as DOMRect;

    geometryListeners.forEach(listener => listener(new Event('geometrychange')));

    expect(document.documentElement.style.getPropertyValue('--bds-titlebar-overlay-right')).toBe('200px');
  });

  it('renders the window title centered in the custom title bar', () => {
    document.title = 'Blogging Desktop Server';

    render(<WindowTitleBar />);

    const title = screen.getByTestId('window-titlebar-title');
    expect(title).toBeInTheDocument();
    expect(title).toHaveTextContent('Blogging Desktop Server');
  });

  it('renders VS Code-style top menu labels in the title bar', () => {
    render(<WindowTitleBar />);

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Blog' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('dispatches menu action through electron API when menu item is clicked', () => {
    const triggerMenuAction = vi.fn().mockResolvedValue(undefined);
    window.electronAPI.app = {
      ...(window.electronAPI.app || {}),
      triggerMenuAction,
    };

    render(<WindowTitleBar />);

    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    fireEvent.click(screen.getByRole('button', { name: 'New Post Ctrl+N' }));

    expect(triggerMenuAction).toHaveBeenCalledWith('newPost');
  });

  it('shows default edit actions with accelerators in Edit menu', () => {
    render(<WindowTitleBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('button', { name: 'Undo Ctrl+Z' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redo Ctrl+Y' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cut Ctrl+X' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Ctrl+C' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paste Ctrl+V' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select All Ctrl+A' })).toBeInTheDocument();
  });

  it('shows assigned accelerators in View and Blog menus', () => {
    render(<WindowTitleBar />);

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByRole('button', { name: 'Posts Ctrl+1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Media Ctrl+2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle Sidebar Ctrl+B' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle Panel Ctrl+J' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Blog' }));
    expect(screen.getByRole('button', { name: 'Publish Selected Ctrl+Shift+P' })).toBeInTheDocument();
  });

  it('shows Toggle Developer Tools in View menu in development mode', () => {
    (window as Window & { __BDS_IS_DEV__?: boolean }).__BDS_IS_DEV__ = true;
    const triggerMenuAction = vi.fn().mockResolvedValue(undefined);
    window.electronAPI.app = {
      ...(window.electronAPI.app || {}),
      triggerMenuAction,
    };

    render(<WindowTitleBar />);

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Developer Tools Ctrl+Shift+I' }));

    expect(triggerMenuAction).toHaveBeenCalledWith('toggleDevTools');
  });
});
