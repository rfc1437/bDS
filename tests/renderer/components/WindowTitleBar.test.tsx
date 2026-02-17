import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WindowTitleBar } from '../../../src/renderer/components/WindowTitleBar/WindowTitleBar';
import { useAppStore } from '../../../src/renderer/store';

describe('WindowTitleBar', () => {
  beforeEach(() => {
    useAppStore.setState({
      sidebarVisible: true,
      panelVisible: false,
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

  it('renders a right-side panel toggle button and toggles panel visibility', () => {
    render(<WindowTitleBar />);

    const toggleButton = screen.getByLabelText('Toggle Panel');
    expect(toggleButton).toBeInTheDocument();
    expect(toggleButton).toHaveAttribute('title', 'Show Panel (Ctrl+J)');

    fireEvent.click(toggleButton);

    expect(useAppStore.getState().panelVisible).toBe(true);
    expect(toggleButton).toHaveAttribute('title', 'Hide Panel (Ctrl+J)');
  });

  it('uses a VS Code-like panel toggle icon shape', () => {
    render(<WindowTitleBar />);

    const toggleButton = screen.getByLabelText('Toggle Panel');
    const iconFrame = toggleButton.querySelector('.window-titlebar-panel-icon');
    const iconPane = toggleButton.querySelector('.window-titlebar-panel-pane');

    expect(iconFrame).not.toBeNull();
    expect(iconPane).not.toBeNull();
    expect(iconFrame).toHaveAttribute('data-shape', 'frame-square');
    expect(iconPane).toHaveAttribute('data-shape', 'bottom-half');
  });

  it('places panel toggle to the right of sidebar toggle', () => {
    render(<WindowTitleBar />);

    const actionButtons = Array.from(document.querySelectorAll('.window-titlebar-actions .window-titlebar-action-button'));

    expect(actionButtons).toHaveLength(2);
    expect(actionButtons[0]).toHaveAttribute('aria-label', 'Toggle Sidebar');
    expect(actionButtons[1]).toHaveAttribute('aria-label', 'Toggle Panel');
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

  it('shows Quit in File menu and View on GitHub in Help menu', () => {
    render(<WindowTitleBar />);

    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    expect(screen.getByRole('button', { name: 'Quit Ctrl+Q' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('button', { name: 'View on GitHub' })).toBeInTheDocument();
  });

  it('switches to another menu on hover when a menu is already open', () => {
    render(<WindowTitleBar />);

    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    expect(screen.getByRole('button', { name: 'New Post Ctrl+N' })).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('button', { name: 'Undo Ctrl+Z' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New Post Ctrl+N' })).toBeNull();
  });

  it('shows menu mnemonics when Alt is pressed', () => {
    const { container } = render(<WindowTitleBar />);

    expect(container.querySelector('.window-titlebar-menu-mnemonic')).toBeNull();

    fireEvent.keyDown(document, { key: 'Alt' });

    expect(container.querySelector('.window-titlebar-menu-mnemonic')).not.toBeNull();
  });

  it('opens File menu when Alt+F is pressed', () => {
    render(<WindowTitleBar />);

    fireEvent.keyDown(document, { key: 'f', altKey: true });

    expect(screen.getByRole('button', { name: 'New Post Ctrl+N' })).toBeInTheDocument();
  });

  it('navigates menu items with arrow keys and activates selection with Enter', () => {
    const triggerMenuAction = vi.fn().mockResolvedValue(undefined);
    window.electronAPI.app = {
      ...(window.electronAPI.app || {}),
      triggerMenuAction,
    };

    render(<WindowTitleBar />);

    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });

    expect(triggerMenuAction).toHaveBeenCalledWith('newPost');
  });

  it('switches open menu with ArrowRight and ArrowLeft', () => {
    render(<WindowTitleBar />);

    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    expect(screen.getByRole('button', { name: 'New Post Ctrl+N' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Undo Ctrl+Z' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: 'New Post Ctrl+N' })).toBeInTheDocument();
  });

  it('jumps to first and last menu item with Home and End', () => {
    const triggerMenuAction = vi.fn().mockResolvedValue(undefined);
    window.electronAPI.app = {
      ...(window.electronAPI.app || {}),
      triggerMenuAction,
    };

    render(<WindowTitleBar />);

    fireEvent.click(screen.getByRole('button', { name: 'File' }));

    fireEvent.keyDown(document, { key: 'End' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(triggerMenuAction).toHaveBeenCalledWith('quit');

    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    fireEvent.keyDown(document, { key: 'Home' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(triggerMenuAction).toHaveBeenCalledWith('newPost');
  });

  it('jumps to matching item by first letter key and activates with Enter', () => {
    const triggerMenuAction = vi.fn().mockResolvedValue(undefined);
    window.electronAPI.app = {
      ...(window.electronAPI.app || {}),
      triggerMenuAction,
    };

    render(<WindowTitleBar />);

    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    fireEvent.keyDown(document, { key: 'i' });
    fireEvent.keyDown(document, { key: 'Enter' });

    expect(triggerMenuAction).toHaveBeenCalledWith('importMedia');
  });

  it('cycles through same-letter matches on repeated key presses', () => {
    const triggerMenuAction = vi.fn().mockResolvedValue(undefined);
    window.electronAPI.app = {
      ...(window.electronAPI.app || {}),
      triggerMenuAction,
    };

    render(<WindowTitleBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.keyDown(document, { key: 'r' });
    fireEvent.keyDown(document, { key: 'r' });
    fireEvent.keyDown(document, { key: 'Enter' });

    expect(triggerMenuAction).toHaveBeenCalledWith('replace');
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
