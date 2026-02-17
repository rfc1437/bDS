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
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M3 3.75A1.75 1.75 0 0 1 4.75 2h6.5A1.75 1.75 0 0 1 13 3.75v8.5A1.75 1.75 0 0 1 11.25 14h-6.5A1.75 1.75 0 0 1 3 12.25v-8.5z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
            <path d="M4.5 3.5h3.75v9H4.5z" fill="currentColor"/>
          </svg>
        </button>
      </div>
    </div>
  );
};

export default WindowTitleBar;