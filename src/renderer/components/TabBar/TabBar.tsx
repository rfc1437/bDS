import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useAppStore, Tab } from '../../store';
import './TabBar.css';

const MAX_CHAT_TITLE_LENGTH = 18;

const getTabTitle = (
  tab: Tab,
  posts: { id: string; title: string }[],
  media: { id: string; originalName: string }[],
  chatTitles: Map<string, string>
): string => {
  if (tab.type === 'settings') {
    return 'Settings';
  }
  
  if (tab.type === 'tags') {
    return 'Tags';
  }
  
  if (tab.type === 'post') {
    const post = posts.find(p => p.id === tab.id);
    return post?.title || 'Untitled';
  }
  
  if (tab.type === 'media') {
    const mediaItem = media.find(m => m.id === tab.id);
    return mediaItem?.originalName || 'Media';
  }
  
  if (tab.type === 'chat') {
    const title = chatTitles.get(tab.id);
    if (title && title !== 'New Chat') {
      // Truncate long titles for display
      return title.length > MAX_CHAT_TITLE_LENGTH 
        ? title.substring(0, MAX_CHAT_TITLE_LENGTH) + '…'
        : title;
    }
    return 'New Chat';
  }
  
  return 'Unknown';
};

const getTabIcon = (tab: Tab): React.ReactNode => {
  switch (tab.type) {
    case 'post':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.85 4.44l-3.28-3.3-.35-.14H2.5l-.5.5v13l.5.5h11l.5-.5V4.8l-.15-.36zm-.85 10.06H3V2h6v3.5l.5.5H13v8.5z"/>
        </svg>
      );
    case 'media':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M14.5 2h-13l-.5.5v11l.5.5h13l.5-.5v-11l-.5-.5zM14 13H2V3h12v10zm-3.5-4.5L9 7.5l-2 2.5-1.5-1L3 12h10l-2.5-3.5z"/>
        </svg>
      );
    case 'settings':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M9.1 4.4L8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.9.8 1.3 2-.2.7-2.4.5v1.2l2.4.5.3.8-1.3 2 .8.8 2-1.3.8.3.4 2.3h1.2l.5-2.4.8-.3 2 1.3.8-.8-1.3-2 .3-.8 2.3-.4V7.4l-2.4-.5-.3-.8 1.3-2-.8-.8-2 1.3-.7-.2zM9.4 1l.5 2.4L12 2.1l2 2-1.4 2.1 2.4.4v3l-2.4.5L14 12l-2 2-2.1-1.4-.5 2.4h-3L5.9 12.5 4 14l-2-2 1.4-2.1L1 9.4v-3l2.4-.5L2 4l2-2 2.1 1.4.4-2.4h3zm.6 7c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zM8 9c.6 0 1-.4 1-1s-.4-1-1-1-1 .4-1 1 .4 1 1 1z"/>
        </svg>
      );
    case 'tags':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M14.28 7.72l-6-6A1 1 0 007.57 1.5H2.5A1 1 0 001.5 2.5v5.07a1 1 0 00.22.56l6 6a1 1 0 001.41 0l5.15-5a1 1 0 000-1.41zM4 5a1 1 0 110-2 1 1 0 010 2z"/>
        </svg>
      );
    case 'chat':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M14 1H2a1 1 0 00-1 1v10a1 1 0 001 1h3v2.5l4-2.5h5a1 1 0 001-1V2a1 1 0 00-1-1zm0 11H8.5L5 14v-2H2V2h12v10z"/>
        </svg>
      );
    default:
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.85 4.44l-3.28-3.3-.35-.14H2.5l-.5.5v13l.5.5h11l.5-.5V4.8l-.15-.36zm-.85 10.06H3V2h6v3.5l.5.5H13v8.5z"/>
        </svg>
      );
  }
};

const CloseIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/>
  </svg>
);

const ChevronLeftIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M10.354 3.146l.707.708L6.768 8l4.293 4.146-.707.708L5.354 8l5-4.854z"/>
  </svg>
);

const ChevronRightIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M5.646 12.854l-.707-.708L9.232 8 4.939 3.854l.707-.708L10.646 8l-5 4.854z"/>
  </svg>
);

export const TabBar: React.FC = () => {
  const { 
    tabs, 
    activeTabId, 
    posts, 
    media,
    dirtyPosts,
    sidebarVisible,
    toggleSidebar,
    setActiveTab, 
    closeTab,
    pinTab,
  } = useAppStore();

  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const [chatTitles, setChatTitles] = useState<Map<string, string>>(new Map());

  // Fetch chat titles for chat tabs
  useEffect(() => {
    const chatTabs = tabs.filter(t => t.type === 'chat');
    if (chatTabs.length === 0) return;

    // Fetch titles for chat tabs that don't have a title yet
    const fetchTitles = async () => {
      const newTitles = new Map(chatTitles);
      
      for (const tab of chatTabs) {
        if (!chatTitles.has(tab.id)) {
          try {
            const conversation = await window.electronAPI?.chat.getConversation(tab.id);
            if (conversation) {
              newTitles.set(tab.id, conversation.title);
            }
          } catch (error) {
            console.error('Failed to fetch chat title:', error);
          }
        }
      }
      
      if (newTitles.size !== chatTitles.size) {
        setChatTitles(newTitles);
      }
    };

    fetchTitles();
  }, [tabs]); // Note: intentionally not including chatTitles to avoid infinite loops

  // Listen for chat title updates
  useEffect(() => {
    const unsub = window.electronAPI?.chat.onTitleUpdated((data) => {
      setChatTitles(prev => {
        const newTitles = new Map(prev);
        newTitles.set(data.conversationId, data.title);
        return newTitles;
      });
    });

    return () => {
      unsub?.();
    };
  }, []);

  // Check if arrows are needed based on scroll position
  const updateArrowVisibility = useCallback(() => {
    const container = tabsContainerRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    setShowLeftArrow(scrollLeft > 0);
    setShowRightArrow(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  // Update arrow visibility on scroll or resize
  useEffect(() => {
    const container = tabsContainerRef.current;
    if (!container) return;

    updateArrowVisibility();

    container.addEventListener('scroll', updateArrowVisibility);
    const resizeObserver = new ResizeObserver(updateArrowVisibility);
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener('scroll', updateArrowVisibility);
      resizeObserver.disconnect();
    };
  }, [updateArrowVisibility, tabs]);

  // Scroll to active tab when it changes
  useEffect(() => {
    if (!activeTabId || !tabsContainerRef.current) return;

    const container = tabsContainerRef.current;
    const activeTab = container.querySelector(`[data-tab-id="${activeTabId}"]`) as HTMLElement;
    if (activeTab) {
      const containerRect = container.getBoundingClientRect();
      const tabRect = activeTab.getBoundingClientRect();
      
      if (tabRect.left < containerRect.left) {
        container.scrollLeft -= containerRect.left - tabRect.left + 10;
      } else if (tabRect.right > containerRect.right) {
        container.scrollLeft += tabRect.right - containerRect.right + 10;
      }
    }
  }, [activeTabId]);

  // Keyboard shortcut handler (Ctrl+W to close active tab, Ctrl+B to toggle sidebar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) {
          closeTab(activeTabId);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, closeTab, toggleSidebar]);

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
  };

  const handleTabDoubleClick = (tab: Tab) => {
    // Double-click on transient tab pins it
    if (tab.isTransient) {
      pinTab(tab.id);
    }
  };

  const handleTabClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  const handleMiddleClick = (e: React.MouseEvent, tabId: string) => {
    // Middle-click closes the tab
    if (e.button === 1) {
      e.preventDefault();
      closeTab(tabId);
    }
  };

  const scrollLeft = () => {
    const container = tabsContainerRef.current;
    if (container) {
      container.scrollBy({ left: -150, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    const container = tabsContainerRef.current;
    if (container) {
      container.scrollBy({ left: 150, behavior: 'smooth' });
    }
  };

  return (
    <div className="tab-bar">
      <button
        className="tab-bar-toggle-sidebar"
        onClick={toggleSidebar}
        title={`${sidebarVisible ? 'Hide' : 'Show'} Sidebar (Ctrl+B)`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 1h16v14H0V1zm1 1v12h4V2H1zm5 0v12h9V2H6z"/>
          {!sidebarVisible && <path d="M2 4h2v1H2V4zm0 2h2v1H2V6zm0 2h2v1H2V8z" opacity="0.5"/>}
          {sidebarVisible && <path d="M2 4h2v1H2V4zm0 2h2v1H2V6zm0 2h2v1H2V8z"/>}
        </svg>
      </button>
      
      {showLeftArrow && (
        <button 
          className="tab-scroll-button tab-scroll-left"
          onClick={scrollLeft}
          title="Scroll tabs left"
        >
          <ChevronLeftIcon />
        </button>
      )}
      
      <div className="tab-bar-tabs" ref={tabsContainerRef}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isDirty = tab.type === 'post' && dirtyPosts.has(tab.id);
          const title = getTabTitle(tab, posts, media, chatTitles);
          const icon = getTabIcon(tab);
          
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              className={`tab ${isActive ? 'active' : ''} ${tab.isTransient ? 'transient' : ''} ${isDirty ? 'dirty' : ''}`}
              onClick={() => handleTabClick(tab.id)}
              onDoubleClick={() => handleTabDoubleClick(tab)}
              onMouseDown={(e) => handleMiddleClick(e, tab.id)}
              title={`${title}${tab.isTransient ? ' (Preview)' : ''}${isDirty ? ' • Modified' : ''}`}
            >
              <span className="tab-icon">{icon}</span>
              <span className={`tab-title ${tab.isTransient ? 'italic' : ''}`}>
                {title}
              </span>
              <div className="tab-actions">
                {isDirty && <span className="tab-dirty-indicator">●</span>}
                <button 
                  className="tab-close" 
                  onClick={(e) => handleTabClose(e, tab.id)}
                  title="Close (Ctrl+W)"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showRightArrow && (
        <button 
          className="tab-scroll-button tab-scroll-right"
          onClick={scrollRight}
          title="Scroll tabs right"
        >
          <ChevronRightIcon />
        </button>
      )}
    </div>
  );
};

export default TabBar;
