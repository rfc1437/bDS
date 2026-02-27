import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useAppStore, Tab } from '../../store';
import { parseGitDiffTabId } from '../../navigation/tabPolicy';
import { BDS_EVENT_TEMPLATES_CHANGED, addWindowEventListener } from '../../utils';
import { useI18n } from '../../i18n';
import './TabBar.css';

const MAX_CHAT_TITLE_LENGTH = 18;

const getTabTitle = (
  tab: Tab,
  postTitles: Map<string, string>,
  media: { id: string; originalName: string }[],
  scriptTitles: Map<string, string>,
  chatTitles: Map<string, string>,
  importDefTitles: Map<string, string>,
  commitTitles: Map<string, string>,
  templateTitles: Map<string, string>,
  tr: (key: string, vars?: Record<string, string | number>) => string,
): string => {
  if (tab.type === 'git-diff') {
    const { resource: filePath, commitHash } = parseGitDiffTabId(tab.id);
    if (commitHash) {
      const commitTitle = commitTitles.get(commitHash);
      if (commitTitle) {
        return commitTitle;
      }
      return tr('tabBar.commitTitle', { hash: commitHash.slice(0, 7) });
    }
    const filename = filePath.split('/').pop();
    return filename || filePath;
  }

  if (tab.type === 'settings') {
    return tr('common.settings');
  }

  if (tab.type === 'style') {
    return tr('tabBar.style');
  }
  
  if (tab.type === 'tags') {
    return tr('activity.tags');
  }
  
  if (tab.type === 'post') {
    return postTitles.get(tab.id) || tr('tabBar.loading');
  }
  
  if (tab.type === 'media') {
    const mediaItem = media.find(m => m.id === tab.id);
    return mediaItem?.originalName || tr('activity.media');
  }
  
  if (tab.type === 'chat') {
    const title = chatTitles.get(tab.id);
    if (title && title !== tr('chat.newChat')) {
      // Truncate long titles for display
      return title.length > MAX_CHAT_TITLE_LENGTH
        ? title.substring(0, MAX_CHAT_TITLE_LENGTH) + '…'
        : title;
    }
    return tr('chat.newChat');
  }

  if (tab.type === 'import') {
    return importDefTitles.get(tab.id) || tr('activity.import');
  }

  if (tab.type === 'menu-editor') {
    return tr('menuEditor.tabTitle');
  }

  if (tab.type === 'metadata-diff') {
    return tr('app.metadataDiff');
  }

  if (tab.type === 'documentation') {
    return tr('docs.title');
  }

  if (tab.type === 'api-documentation') {
    return tr('docs.apiTitle');
  }

  if (tab.type === 'site-validation') {
    return tr('siteValidation.tabTitle');
  }

  if (tab.type === 'scripts') {
    return scriptTitles.get(tab.id) || tr('tabBar.scripts');
  }

  if (tab.type === 'templates') {
    return templateTitles.get(tab.id) || tr('editor.untitled');
  }

  return tr('tabBar.unknown');
};

const getTabIcon = (tab: Tab): React.ReactNode => {
  switch (tab.type) {
    case 'git-diff':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 3H5a2 2 0 0 0-2 2v4h2V5h4V3zm10 6h2V5a2 2 0 0 0-2-2h-4v2h4v4zM5 15H3v4a2 2 0 0 0 2 2h4v-2H5v-4zm16 0h-2v4h-4v2h4a2 2 0 0 0 2-2v-4zM7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h10v2H7v-2z"/>
        </svg>
      );
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
    case 'style':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1a6 6 0 0 1 4.91 2.55c-.61.3-1.39.52-2.28.52-1.08 0-1.9-.22-2.62-.42-.71-.2-1.33-.37-2.06-.37-.97 0-1.84.25-2.55.6A6 6 0 0 1 8 2zm-5 6a5.97 5.97 0 0 1 .17-1.42c.59-.37 1.5-.8 2.77-.8.59 0 1.1.14 1.76.32.79.22 1.69.47 2.92.47 1.05 0 1.99-.24 2.75-.59A6 6 0 0 1 13.99 8H3zm10.82 1h-10.6a6 6 0 0 0 10.6 0z"/>
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
    case 'import':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
        </svg>
      );
    case 'menu-editor':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 3h12v1H2V3zm0 3h12v1H2V6zm0 3h8v1H2V9zm0 3h8v1H2v-1zm10-2 2 2-2 2v-1H9v-2h3V10z"/>
        </svg>
      );
    case 'metadata-diff':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 3h5v1H2V3zm0 3h5v1H2V6zm0 3h5v1H2V9zm0 3h5v1H2v-1zm7-9h5v1H9V3zm0 3h5v1H9V6zm0 3h5v1H9V9zm0 3h5v1H9v-1z"/>
        </svg>
      );
    case 'documentation':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h7A1.5 1.5 0 0 1 13 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-11zm1.5-.5a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5h-7z"/>
          <path d="M5 4h6v1H5V4zm0 2h6v1H5V6zm0 2h6v1H5V8zm0 2h4v1H5v-1z"/>
        </svg>
      );
    case 'api-documentation':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2.5 2A1.5 1.5 0 0 0 1 3.5v9A1.5 1.5 0 0 0 2.5 14h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 13.5 2h-11zm0 1h11a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5z"/>
          <path d="M4 5h2v1H4V5zm3 0h5v1H7V5zM4 7.5h2v1H4v-1zm3 0h5v1H7v-1zM4 10h2v1H4v-1zm3 0h5v1H7v-1z"/>
        </svg>
      );
    case 'site-validation':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5A6.5 6.5 0 0 0 8 1.5zm0 1a5.5 5.5 0 0 1 4.39 8.82l-.88-.88a.5.5 0 0 0-.7.7l.8.8A5.5 5.5 0 1 1 8 2.5zm2.35 3.15L7 9 5.65 7.65a.5.5 0 1 0-.7.7l1.7 1.7a.5.5 0 0 0 .7 0l3.7-3.7a.5.5 0 1 0-.7-.7z"/>
        </svg>
      );
    case 'scripts':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 3H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7v2H8v2h8v-2h-3v-2h7a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zM5 14V5h14v9H5zm2-7.5L9.5 9 7 11.5l1.4 1.4L12.3 9 8.4 5.1 7 6.5zm6.5 5.5h4v-2h-4v2z"/>
        </svg>
      );
    case 'templates':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M14 2H2v4h12V2zM3 3h10v2H3V3zm-1 5h5v7H2V8zm1 1v5h3V9H3zm5-1h6v3H8V8zm1 1v1h4V9H9zm0 3h6v3H9v-3zm1 1v1h4v-1h-4z"/>
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
  const { t: tr } = useI18n();
  const { 
    tabs, 
    activeTabId, 
    posts,
    media,
    activeProject,
    dirtyPosts,
    toggleSidebar,
    setActiveTab, 
    closeTab,
    pinTab,
  } = useAppStore();

  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const [postTitles, setPostTitles] = useState<Map<string, string>>(new Map());
  const [scriptTitles, setScriptTitles] = useState<Map<string, string>>(new Map());
  const [chatTitles, setChatTitles] = useState<Map<string, string>>(new Map());
  const [importDefTitles, setImportDefTitles] = useState<Map<string, string>>(new Map());
  const [commitTitles, setCommitTitles] = useState<Map<string, string>>(new Map());
  const [templateTitles, setTemplateTitles] = useState<Map<string, string>>(new Map());

  // Fetch post titles from database for post tabs
  useEffect(() => {
    const postTabs = tabs.filter(t => t.type === 'post');
    const postTabIds = new Set(postTabs.map(t => t.id));

    setPostTitles((previous) => {
      const next = new Map(previous);
      let changed = false;

      for (const id of Array.from(next.keys())) {
        if (!postTabIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }

      for (const post of posts) {
        if (!postTabIds.has(post.id)) {
          continue;
        }

        const title = post.title || tr('editor.untitled');
        if (next.get(post.id) !== title) {
          next.set(post.id, title);
          changed = true;
        }
      }

      return changed ? next : previous;
    });

    if (postTabs.length === 0) return;

    const fetchTitles = async () => {
      const newTitles = new Map(postTitles);
      let changed = false;

      for (const tab of postTabs) {
        const postInStore = posts.find((post) => post.id === tab.id);

        if (!postInStore) {
          try {
            const post = await window.electronAPI?.posts.get(tab.id);
            if (post) {
              newTitles.set(tab.id, post.title || tr('editor.untitled'));
              changed = true;
            }
          } catch (error) {
            console.error(tr('tabBar.error.fetchPostTitle'), error);
          }
        }
      }

      if (changed) {
        setPostTitles(newTitles);
      }
    };

    fetchTitles();
  }, [tabs, posts, tr]); // Note: intentionally not including postTitles to avoid infinite loops

  // Listen for post updates to refresh titles
  useEffect(() => {
    const unsub = window.electronAPI?.on('post-updated', (...args: unknown[]) => {
      const post = args[0] as { id: string; title: string } | undefined;
      if (post) {
        setPostTitles(prev => {
          const newTitles = new Map(prev);
          newTitles.set(post.id, post.title || tr('editor.untitled'));
          return newTitles;
        });
      }
    });

    return () => {
      unsub?.();
    };
  }, [tr]);

  // Fetch script titles for script tabs
  useEffect(() => {
    const scriptTabs = tabs.filter((t) => t.type === 'scripts');
    const scriptTabIds = new Set(scriptTabs.map((t) => t.id));

    setScriptTitles((previous) => {
      const next = new Map(previous);
      let changed = false;

      for (const id of Array.from(next.keys())) {
        if (!scriptTabIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }

      return changed ? next : previous;
    });

    if (scriptTabs.length === 0) {
      return;
    }

    const fetchScriptTitles = async () => {
      const newTitles = new Map(scriptTitles);
      let changed = false;

      for (const tab of scriptTabs) {
        if (scriptTitles.has(tab.id)) {
          continue;
        }

        try {
          const script = await window.electronAPI?.scripts.get(tab.id);
          if (script) {
            const title = script.title || tr('editor.untitled');
            if (newTitles.get(tab.id) !== title) {
              newTitles.set(tab.id, title);
              changed = true;
            }
          }
        } catch (error) {
          console.error(tr('tabBar.error.fetchScriptTitle'), error);
        }
      }

      if (changed) {
        setScriptTitles(newTitles);
      }
    };

    void fetchScriptTitles();
  }, [tabs, tr]); // Note: intentionally not including scriptTitles to avoid infinite loops

  // Listen for script updates to refresh titles
  useEffect(() => {
    const handleScriptsChanged = async () => {
      const scriptTabs = tabs.filter((t) => t.type === 'scripts');
      if (scriptTabs.length === 0) {
        return;
      }

      const updated = new Map(scriptTitles);
      let changed = false;

      for (const tab of scriptTabs) {
        try {
          const script = await window.electronAPI?.scripts.get(tab.id);
          if (script) {
            const title = script.title || tr('editor.untitled');
            if (updated.get(tab.id) !== title) {
              updated.set(tab.id, title);
              changed = true;
            }
          }
        } catch (error) {
          console.error(tr('tabBar.error.fetchScriptTitle'), error);
        }
      }

      if (changed) {
        setScriptTitles(updated);
      }
    };

    if (typeof window.addEventListener === 'function') {
      window.addEventListener('bds:scripts-changed', handleScriptsChanged);
    }

    return () => {
      if (typeof window.removeEventListener === 'function') {
        window.removeEventListener('bds:scripts-changed', handleScriptsChanged);
      }
    };
  }, [tabs, scriptTitles, tr]);

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
            console.error(tr('tabBar.error.fetchChatTitle'), error);
          }
        }
      }
      
      if (newTitles.size !== chatTitles.size) {
        setChatTitles(newTitles);
      }
    };

    fetchTitles();
  }, [tabs, tr]); // Note: intentionally not including chatTitles to avoid infinite loops

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

  // Fetch import definition titles for import tabs
  useEffect(() => {
    const importTabs = tabs.filter(t => t.type === 'import');
    if (importTabs.length === 0) return;

    const fetchTitles = async () => {
      const newTitles = new Map(importDefTitles);
      for (const tab of importTabs) {
        if (!importDefTitles.has(tab.id)) {
          try {
            const def = await window.electronAPI?.importDefinitions.get(tab.id);
            if (def) {
              newTitles.set(tab.id, def.name);
            }
          } catch (error) {
            console.error(tr('tabBar.error.fetchImportTitle'), error);
          }
        }
      }
      if (newTitles.size !== importDefTitles.size) {
        setImportDefTitles(newTitles);
      }
    };

    fetchTitles();
  }, [tabs, tr]); // Note: intentionally not including importDefTitles to avoid infinite loops

  // Listen for import definition name updates
  useEffect(() => {
    const unsub = window.electronAPI?.importDefinitions.onNameUpdated((data) => {
      setImportDefTitles(prev => {
        const newTitles = new Map(prev);
        newTitles.set(data.definitionId, data.name);
        return newTitles;
      });
    });

    return () => {
      unsub?.();
    };
  }, []);

  // Fetch commit subjects for commit-based git-diff tabs
  useEffect(() => {
    const commitHashes = tabs
      .filter((tab) => tab.type === 'git-diff')
      .map((tab) => parseGitDiffTabId(tab.id).commitHash)
      .filter((hash): hash is string => Boolean(hash));

    if (commitHashes.length === 0 || !activeProject) {
      return;
    }

    const missingHashes = commitHashes.filter((hash) => !commitTitles.has(hash));
    if (missingHashes.length === 0) {
      return;
    }

    let cancelled = false;

    const fetchCommitTitles = async () => {
      try {
        const projectPath = activeProject.dataPath
          ? activeProject.dataPath
          : await window.electronAPI?.app.getDefaultProjectPath(activeProject.id);

        if (!projectPath) {
          return;
        }

        const history = await window.electronAPI?.git.getHistory(projectPath, 200);
        if (!history || cancelled) {
          return;
        }

        setCommitTitles((previous) => {
          const updated = new Map(previous);
          let changed = false;

          for (const hash of missingHashes) {
            const match = history.find((entry) => entry.hash === hash);
            if (match) {
              updated.set(hash, `${match.shortHash} ${match.subject}`);
              changed = true;
            }
          }

          return changed ? updated : previous;
        });
      } catch (error) {
        console.error(tr('tabBar.error.fetchCommitTitle'), error);
      }
    };

    void fetchCommitTitles();

    return () => {
      cancelled = true;
    };
  }, [tabs, activeProject, tr]);

  // Fetch template titles for template tabs
  useEffect(() => {
    const templateTabs = tabs.filter((t) => t.type === 'templates');
    const templateTabIds = new Set(templateTabs.map((t) => t.id));

    setTemplateTitles((previous) => {
      const next = new Map(previous);
      let changed = false;

      for (const id of Array.from(next.keys())) {
        if (!templateTabIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }

      return changed ? next : previous;
    });

    if (templateTabs.length === 0) {
      return;
    }

    const fetchTemplateTitles = async () => {
      const newTitles = new Map(templateTitles);
      let changed = false;

      for (const tab of templateTabs) {
        if (templateTitles.has(tab.id)) {
          continue;
        }

        try {
          const tmpl = await window.electronAPI?.templates.get(tab.id);
          if (tmpl) {
            const title = tmpl.title || tr('editor.untitled');
            if (newTitles.get(tab.id) !== title) {
              newTitles.set(tab.id, title);
              changed = true;
            }
          }
        } catch (error) {
          console.error(tr('tabBar.error.fetchTemplateTitle'), error);
        }
      }

      if (changed) {
        setTemplateTitles(newTitles);
      }
    };

    void fetchTemplateTitles();
  }, [tabs, tr]); // Note: intentionally not including templateTitles to avoid infinite loops

  // Listen for template updates to refresh titles
  useEffect(() => {
    const handleTemplatesChanged = async () => {
      const templateTabs = tabs.filter((t) => t.type === 'templates');
      if (templateTabs.length === 0) {
        return;
      }

      const updated = new Map(templateTitles);
      let changed = false;

      for (const tab of templateTabs) {
        try {
          const tmpl = await window.electronAPI?.templates.get(tab.id);
          if (tmpl) {
            const title = tmpl.title || tr('editor.untitled');
            if (updated.get(tab.id) !== title) {
              updated.set(tab.id, title);
              changed = true;
            }
          }
        } catch (error) {
          console.error(tr('tabBar.error.fetchTemplateTitle'), error);
        }
      }

      if (changed) {
        setTemplateTitles(updated);
      }
    };

    return addWindowEventListener(BDS_EVENT_TEMPLATES_CHANGED, handleTemplatesChanged);
  }, [tabs, templateTitles, tr]);

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

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="tab-bar">
      {showLeftArrow && (
        <button 
          className="tab-scroll-button tab-scroll-left"
          onClick={scrollLeft}
          title={tr('tabBar.scrollLeft')}
        >
          <ChevronLeftIcon />
        </button>
      )}
      
      <div className="tab-bar-tabs" ref={tabsContainerRef}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isDirty = tab.type === 'post' && dirtyPosts.has(tab.id);
          const title = getTabTitle(tab, postTitles, media, scriptTitles, chatTitles, importDefTitles, commitTitles, templateTitles, tr);
          const icon = getTabIcon(tab);
          
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              className={`tab ${isActive ? 'active' : ''} ${tab.isTransient ? 'transient' : ''} ${isDirty ? 'dirty' : ''}`}
              onClick={() => handleTabClick(tab.id)}
              onDoubleClick={() => handleTabDoubleClick(tab)}
              onMouseDown={(e) => handleMiddleClick(e, tab.id)}
              title={`${title}${tab.isTransient ? ` (${tr('tabBar.preview')})` : ''}${isDirty ? ` • ${tr('tabBar.modified')}` : ''}`}
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
                  title={tr('tabBar.closeHint')}
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
          title={tr('tabBar.scrollRight')}
        >
          <ChevronRightIcon />
        </button>
      )}
    </div>
  );
};

export default TabBar;
