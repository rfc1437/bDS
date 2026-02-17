import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import { APP_MENU_GROUPS } from '../../../main/shared/menuCommands';
import './WindowTitleBar.css';

type WindowControlsOverlayLike = {
  visible: boolean;
  getTitlebarAreaRect: () => DOMRect;
  addEventListener: (type: 'geometrychange', listener: EventListener) => void;
  removeEventListener: (type: 'geometrychange', listener: EventListener) => void;
};

export const WindowTitleBar: React.FC = () => {
  const { sidebarVisible, toggleSidebar } = useAppStore();
  const [windowTitle, setWindowTitle] = useState<string>(document.title || 'Blogging Desktop Server');
  const [openMenu, setOpenMenu] = useState<{ label: string; left: number } | null>(null);
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const isDevMode = (window as Window & { __BDS_IS_DEV__?: boolean }).__BDS_IS_DEV__
    ?? (typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV));

  const visibleMenuGroups = APP_MENU_GROUPS.map((group) => {
    if (group.label !== 'View') {
      return group;
    }

    return {
      ...group,
      items: group.items.filter(item => isDevMode || item.action !== 'toggleDevTools'),
    };
  });

  useEffect(() => {
    const rootStyle = document.documentElement.style;
    const setInsets = (left: number, right: number) => {
      rootStyle.setProperty('--bds-titlebar-overlay-left', `${left}px`);
      rootStyle.setProperty('--bds-titlebar-overlay-right', `${right}px`);
    };

    const overlay = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike }).windowControlsOverlay;
    if (!overlay) {
      setInsets(0, 0);
      return;
    }

    const syncOverlayInsets = () => {
      if (!overlay.visible) {
        setInsets(0, 0);
        return;
      }

      const titlebarRect = overlay.getTitlebarAreaRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || titlebarRect.right;

      const leftInset = Math.max(0, Math.round(titlebarRect.left));
      const rightInset = Math.max(0, Math.round(viewportWidth - titlebarRect.right));
      setInsets(leftInset, rightInset);
    };

    const onGeometryChange: EventListener = () => {
      syncOverlayInsets();
    };
    const onResize = () => {
      syncOverlayInsets();
    };

    syncOverlayInsets();
    overlay.addEventListener('geometrychange', onGeometryChange);
    const canListenToResize = typeof window.addEventListener === 'function';
    if (canListenToResize) {
      window.addEventListener('resize', onResize);
    }

    return () => {
      overlay.removeEventListener('geometrychange', onGeometryChange);
      if (canListenToResize && typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', onResize);
      }
    };
  }, []);

  useEffect(() => {
    const updateTitle = () => {
      setWindowTitle(document.title || 'Blogging Desktop Server');
    };

    updateTitle();

    const titleElement = document.querySelector('title');
    if (!titleElement) {
      return;
    }

    const observer = new MutationObserver(() => {
      updateTitle();
    });
    observer.observe(titleElement, { childList: true });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!openMenu) {
      return;
    }

    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRootRef.current && !menuRootRef.current.contains(target)) {
        setOpenMenu(null);
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenu(null);
      }
    };

    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onEscape);

    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [openMenu]);

  const handleMenuButtonClick = (event: React.MouseEvent<HTMLButtonElement>, label: string) => {
    const buttonRect = event.currentTarget.getBoundingClientRect();
    const rootRect = menuRootRef.current?.getBoundingClientRect();
    const left = rootRect ? buttonRect.left - rootRect.left : buttonRect.left;

    if (openMenu?.label === label) {
      setOpenMenu(null);
      return;
    }

    setOpenMenu({ label, left });
  };

  const handleMenuItemClick = (action: string) => {
    setOpenMenu(null);
    void window.electronAPI?.app?.triggerMenuAction?.(action);
  };

  const formatAccelerator = (accelerator: string): string => {
    const firstPass = accelerator
      .replace(/CmdOrCtrl/g, isMac ? '⌘' : 'Ctrl')
      .replace(/Alt/g, isMac ? '⌥' : 'Alt')
      .replace(/Shift/g, isMac ? '⇧' : 'Shift');
    return firstPass;
  };

  const activeMenu = openMenu ? visibleMenuGroups.find(group => group.label === openMenu.label) : null;

  return (
    <div className="window-titlebar" data-testid="window-titlebar" ref={menuRootRef}>
      <div className="window-titlebar-menu-bar" data-testid="window-titlebar-menu-bar">
        {visibleMenuGroups.map(group => (
          <button
            key={group.label}
            className={`window-titlebar-menu-button${openMenu?.label === group.label ? ' is-active' : ''}`}
            type="button"
            onClick={(event) => handleMenuButtonClick(event, group.label)}
            aria-label={group.label}
          >
            {group.label}
          </button>
        ))}
      </div>
      <div className="window-titlebar-drag-region" />
      <div className="window-titlebar-title" data-testid="window-titlebar-title" title={windowTitle}>
        {windowTitle}
      </div>
      <div className="window-titlebar-actions">
        <button
          className="window-titlebar-action-button"
          aria-label="Toggle Sidebar"
          onClick={toggleSidebar}
          title={`${sidebarVisible ? 'Hide' : 'Show'} Sidebar (Ctrl+B)`}
        >
          <span className="window-titlebar-sidebar-icon" data-shape="frame-square" aria-hidden="true">
            <span className="window-titlebar-sidebar-pane" data-shape="left-half" />
          </span>
        </button>
      </div>
      {openMenu && activeMenu && (
        <div
          className="window-titlebar-menu-dropdown"
          data-testid="window-titlebar-menu-dropdown"
          style={{ left: `${openMenu.left}px` }}
        >
          {activeMenu.items.map(item => {
            if (item.separator) {
              return <div key={item.action} className="window-titlebar-menu-separator" />;
            }

            const acceleratorText = item.accelerator ? formatAccelerator(item.accelerator) : null;

            return (
              <button
                key={item.action}
                type="button"
                className="window-titlebar-menu-item"
                onClick={() => handleMenuItemClick(item.action)}
                aria-label={acceleratorText ? `${item.label} ${acceleratorText}` : item.label}
              >
                <span className="window-titlebar-menu-item-label">{item.label}</span>
                {acceleratorText && <span className="window-titlebar-menu-item-accelerator">{acceleratorText}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WindowTitleBar;