import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import { APP_MENU_GROUPS } from '../../../main/shared/menuCommands';
import { resolveSupportedUiLanguage, translateMenu } from '../../../main/shared/i18n';
import { useI18n } from '../../i18n';
import './WindowTitleBar.css';

type WindowControlsOverlayLike = {
  visible: boolean;
  getTitlebarAreaRect: () => DOMRect;
  addEventListener: (type: 'geometrychange', listener: EventListener) => void;
  removeEventListener: (type: 'geometrychange', listener: EventListener) => void;
};

export const WindowTitleBar: React.FC = () => {
  const { language, t } = useI18n();
  const { sidebarVisible, panelVisible, assistantSidebarVisible, toggleSidebar, togglePanel, toggleAssistantSidebar } = useAppStore();
  const [windowTitle, setWindowTitle] = useState<string>(document.title || 'Blogging Desktop Server');
  const [openMenu, setOpenMenu] = useState<{ label: string; left: number } | null>(null);
  const [showMnemonics, setShowMnemonics] = useState<boolean>(false);
  const [keyboardMenuItemIndex, setKeyboardMenuItemIndex] = useState<number | null>(null);
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
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

  const uiLanguage = resolveSupportedUiLanguage(language);

  const getGroupDisplayLabel = (groupLabel: string): string => {
    return translateMenu(uiLanguage, `menu.group.${groupLabel.toLowerCase()}`) || groupLabel;
  };

  const getItemDisplayLabel = (itemLabel: string): string => {
    if (itemLabel.startsWith('menu.')) {
      return translateMenu(uiLanguage, itemLabel) || itemLabel;
    }
    return itemLabel;
  };

  const mnemonicByKey = useMemo(() => {
    return visibleMenuGroups.reduce<Record<string, string>>((acc, group) => {
      const mnemonicKey = group.label.charAt(0).toLowerCase();
      acc[mnemonicKey] = group.label;
      return acc;
    }, {});
  }, [visibleMenuGroups]);

  const getMenuLeft = (label: string): number | null => {
    const button = menuButtonRefs.current[label];
    if (!button) {
      return null;
    }

    const buttonRect = button.getBoundingClientRect();
    const rootRect = menuRootRef.current?.getBoundingClientRect();
    return rootRect ? buttonRect.left - rootRect.left : buttonRect.left;
  };

  const openMenuByLabel = (label: string) => {
    const left = getMenuLeft(label);
    if (left === null) {
      return;
    }
    setKeyboardMenuItemIndex(null);
    setOpenMenu({ label, left });
  };

  const getMenuActionableItems = (label: string) => {
    const group = visibleMenuGroups.find(item => item.label === label);
    if (!group) {
      return [];
    }

    return group.items.filter(item => !item.separator);
  };

  const switchOpenMenuByOffset = (offset: number) => {
    if (!openMenu) {
      return;
    }

    const currentIndex = visibleMenuGroups.findIndex(group => group.label === openMenu.label);
    if (currentIndex < 0) {
      return;
    }

    const nextIndex = (currentIndex + offset + visibleMenuGroups.length) % visibleMenuGroups.length;
    openMenuByLabel(visibleMenuGroups[nextIndex].label);
  };

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
        setShowMnemonics(false);
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenu(null);
        setKeyboardMenuItemIndex(null);
        setShowMnemonics(false);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        switchOpenMenuByOffset(1);
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        switchOpenMenuByOffset(-1);
        return;
      }

      if (!openMenu) {
        return;
      }

      const actionableItems = getMenuActionableItems(openMenu.label);
      if (actionableItems.length === 0) {
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setKeyboardMenuItemIndex((previous) => {
          if (previous === null) {
            return 0;
          }
          return (previous + 1) % actionableItems.length;
        });
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setKeyboardMenuItemIndex((previous) => {
          if (previous === null) {
            return actionableItems.length - 1;
          }
          return (previous - 1 + actionableItems.length) % actionableItems.length;
        });
        return;
      }

      if ((event.key === 'Enter' || event.key === ' ') && keyboardMenuItemIndex !== null) {
        event.preventDefault();
        const targetItem = actionableItems[keyboardMenuItemIndex];
        if (targetItem) {
          void window.electronAPI?.app?.triggerMenuAction?.(targetItem.action);
          setOpenMenu(null);
          setKeyboardMenuItemIndex(null);
          setShowMnemonics(false);
        }
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        setKeyboardMenuItemIndex(0);
        return;
      }

      if (event.key === 'End') {
        event.preventDefault();
        setKeyboardMenuItemIndex(actionableItems.length - 1);
        return;
      }

      if (event.key.length === 1 && !event.altKey && !event.shiftKey) {
        const typed = event.key.toLowerCase();
        const matchingIndices = actionableItems
          .map((item, index) => ({ item, index }))
          .filter(entry => getItemDisplayLabel(entry.item.label).toLowerCase().startsWith(typed))
          .map(entry => entry.index);

        if (matchingIndices.length === 0) {
          return;
        }

        event.preventDefault();
        if (keyboardMenuItemIndex === null) {
          setKeyboardMenuItemIndex(matchingIndices[0]);
          return;
        }

        const currentMatchPosition = matchingIndices.findIndex(index => index === keyboardMenuItemIndex);
        if (currentMatchPosition >= 0) {
          const nextPosition = (currentMatchPosition + 1) % matchingIndices.length;
          setKeyboardMenuItemIndex(matchingIndices[nextPosition]);
          return;
        }

        const firstAfterCurrent = matchingIndices.find(index => index > keyboardMenuItemIndex);
        setKeyboardMenuItemIndex(firstAfterCurrent ?? matchingIndices[0]);
      }
    };

    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onEscape);

    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [keyboardMenuItemIndex, openMenu, visibleMenuGroups]);

  useEffect(() => {
    setKeyboardMenuItemIndex(null);
  }, [openMenu?.label]);

  useEffect(() => {
    if (isMac) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey) {
        return;
      }

      if (event.key === 'Alt' && !event.shiftKey) {
        setShowMnemonics(true);
        return;
      }

      if (event.altKey && event.key.length === 1) {
        const targetMenuLabel = mnemonicByKey[event.key.toLowerCase()];
        if (targetMenuLabel) {
          event.preventDefault();
          setShowMnemonics(true);
          openMenuByLabel(targetMenuLabel);
        }
        return;
      }

      if (showMnemonics && event.key !== 'Shift') {
        setShowMnemonics(false);
      }
    };

    const onDocumentMouseDown = () => {
      if (showMnemonics) {
        setShowMnemonics(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onDocumentMouseDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onDocumentMouseDown);
    };
  }, [isMac, mnemonicByKey, showMnemonics]);

  const handleMenuButtonClick = (event: React.MouseEvent<HTMLButtonElement>, label: string) => {
    const left = getMenuLeft(label);
    if (left === null) {
      return;
    }

    if (openMenu?.label === label) {
      setOpenMenu(null);
      setKeyboardMenuItemIndex(null);
      return;
    }

    setOpenMenu({ label, left });
  };

  const handleMenuButtonMouseEnter = (event: React.MouseEvent<HTMLButtonElement>, label: string) => {
    if (!openMenu || openMenu.label === label) {
      return;
    }

    const buttonRect = event.currentTarget.getBoundingClientRect();
    const rootRect = menuRootRef.current?.getBoundingClientRect();
    const left = rootRect ? buttonRect.left - rootRect.left : buttonRect.left;
    setOpenMenu({ label, left });
  };

  const handleMenuItemClick = (action: string) => {
    setOpenMenu(null);
    setKeyboardMenuItemIndex(null);
    setShowMnemonics(false);
    void window.electronAPI?.app?.triggerMenuAction?.(action);
  };

  const renderMenuLabel = (label: string) => {
    if (!showMnemonics || label.length === 0) {
      return label;
    }

    return (
      <>
        <span className="window-titlebar-menu-mnemonic">{label.charAt(0)}</span>
        {label.slice(1)}
      </>
    );
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
    <div className={`window-titlebar${isMac ? ' is-mac' : ''}`} data-testid="window-titlebar" ref={menuRootRef}>
      {!isMac && (
        <div className="window-titlebar-menu-bar" data-testid="window-titlebar-menu-bar">
          {visibleMenuGroups.map(group => (
            <button
              key={group.label}
              ref={(element) => {
                menuButtonRefs.current[group.label] = element;
              }}
              className={`window-titlebar-menu-button${openMenu?.label === group.label ? ' is-active' : ''}`}
              type="button"
              onClick={(event) => handleMenuButtonClick(event, group.label)}
              onMouseEnter={(event) => handleMenuButtonMouseEnter(event, group.label)}
              aria-label={group.label}
            >
              {renderMenuLabel(getGroupDisplayLabel(group.label))}
            </button>
          ))}
        </div>
      )}
      <div className="window-titlebar-drag-region" />
      <div className="window-titlebar-title" data-testid="window-titlebar-title" title={windowTitle}>
        {windowTitle}
      </div>
      <div className="window-titlebar-actions">
        <button
          className="window-titlebar-action-button"
          aria-label={t('windowTitleBar.toggleSidebar')}
          onClick={toggleSidebar}
          title={sidebarVisible ? t('windowTitleBar.hideSidebar') : t('windowTitleBar.showSidebar')}
        >
          <span
            className={`window-titlebar-sidebar-icon ${sidebarVisible ? 'is-active' : 'is-inactive'}`}
            data-shape="frame-square"
            aria-hidden="true"
          >
            <span className="window-titlebar-sidebar-pane" data-shape="left-half" />
          </span>
        </button>
        <button
          className="window-titlebar-action-button"
          aria-label={t('windowTitleBar.togglePanel')}
          onClick={togglePanel}
          title={panelVisible ? t('windowTitleBar.hidePanel') : t('windowTitleBar.showPanel')}
        >
          <span
            className={`window-titlebar-panel-icon ${panelVisible ? 'is-active' : 'is-inactive'}`}
            data-shape="frame-square"
            aria-hidden="true"
          >
            <span className="window-titlebar-panel-pane" data-shape="bottom-half" />
          </span>
        </button>
        <button
          className="window-titlebar-action-button"
          aria-label={t('windowTitleBar.toggleAssistantSidebar')}
          onClick={toggleAssistantSidebar}
          title={assistantSidebarVisible ? t('windowTitleBar.hideAssistantSidebar') : t('windowTitleBar.showAssistantSidebar')}
        >
          <span
            className={`window-titlebar-assistant-icon ${assistantSidebarVisible ? 'is-active' : 'is-inactive'}`}
            data-shape="frame-square"
            aria-hidden="true"
          >
            <span className="window-titlebar-assistant-pane" data-shape="right-half" />
          </span>
        </button>
      </div>
      {!isMac && openMenu && activeMenu && (
        <div
          className="window-titlebar-menu-dropdown"
          data-testid="window-titlebar-menu-dropdown"
          style={{ left: `${openMenu.left}px` }}
        >
          {activeMenu.items.map((item) => {
            if (item.separator) {
              return <div key={item.action} className="window-titlebar-menu-separator" />;
            }

            const displayLabel = getItemDisplayLabel(item.label);
            const acceleratorText = item.accelerator ? formatAccelerator(item.accelerator) : null;
            const actionableItems = activeMenu.items.filter(menuItem => !menuItem.separator);
            const currentActionableIndex = actionableItems.findIndex(menuItem => menuItem.action === item.action);
            const isKeyboardActive = keyboardMenuItemIndex !== null && keyboardMenuItemIndex === currentActionableIndex;

            return (
              <button
                key={item.action}
                type="button"
                className={`window-titlebar-menu-item${isKeyboardActive ? ' is-keyboard-active' : ''}`}
                onClick={() => handleMenuItemClick(item.action)}
                aria-label={acceleratorText ? `${displayLabel} ${acceleratorText}` : displayLabel}
              >
                <span className="window-titlebar-menu-item-label">{displayLabel}</span>
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