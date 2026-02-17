import React from 'react';
import { useAppStore } from '../../store';
import './WindowTitleBar.css';

export const WindowTitleBar: React.FC = () => {
  const { sidebarVisible, toggleSidebar } = useAppStore();

  return (
    <div className="window-titlebar" data-testid="window-titlebar">
      <div className="window-titlebar-drag-region" />
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
    </div>
  );
};

export default WindowTitleBar;