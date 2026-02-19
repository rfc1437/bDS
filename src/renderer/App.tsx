import React, { useEffect } from 'react';
import { ActivityBar, Sidebar, Editor, StatusBar, Panel, TabBar, ToastContainer, showToast, ResizablePanel, WindowTitleBar } from './components';
import { useAppStore, PostData, MediaData, TaskProgress } from './store';
import { loadTabsForProject, saveTabsForProject } from './utils';
import './App.css';

const App: React.FC = () => {
  const {
    setPosts,
    setMedia,
    addPost,
    updatePost,
    removePost,
    addMedia,
    updateMedia,
    removeMedia,
    setTasks,
    updateTask,
    setLoading,
    toggleSidebar,
    togglePanel,
    setActiveView,
    setSelectedPost,
    setActiveProject,
    openTab,
    restoreTabState,
  } = useAppStore();

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // First, get active project to set the correct context in backend engines
        const activeProject = await window.electronAPI?.projects.getActive();
        if (activeProject) {
          setActiveProject(activeProject as import('./store').ProjectData);
        }
        
        // Load posts (now with correct project context, limited to 500)
        const postsResult = await window.electronAPI?.posts.getAll({ limit: 500, offset: 0 });
        if (postsResult) {
          const { items, hasMore, total } = postsResult as { items: PostData[]; hasMore: boolean; total: number };
          setPosts(items, hasMore, total);
        }

        // Load media
        const media = await window.electronAPI?.media.getAll();
        if (media) {
          setMedia(media as MediaData[]);
        }
        
        // Restore tabs for the active project
        if (activeProject && (activeProject as { id: string }).id) {
          const savedTabState = loadTabsForProject((activeProject as { id: string }).id);
          if (savedTabState) {
            restoreTabState(savedTabState);
          }
        }

        // Load tasks
        const tasks = await window.electronAPI?.tasks.getAll();
        if (tasks) {
          setTasks(tasks as TaskProgress[]);
        }
      } catch (error) {
        console.error('Failed to load initial data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Save tabs when window closes
  useEffect(() => {
    const saveTabsOnUnload = () => {
      const state = useAppStore.getState();
      const projectId = state.activeProject?.id;
      if (projectId) {
        const tabState = state.getTabState();
        saveTabsForProject(projectId, tabState);
      }
    };

    window.addEventListener('beforeunload', saveTabsOnUnload);
    return () => window.removeEventListener('beforeunload', saveTabsOnUnload);
  }, []);

  // Set up event listeners for real-time updates
  useEffect(() => {
    const unsubscribers: Array<() => void> = [];

    // Post events
    unsubscribers.push(
      window.electronAPI?.on('post:created', (post: unknown) => {
        addPost(post as PostData);
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('post:updated', (post: unknown) => {
        const p = post as PostData;
        updatePost(p.id, p);
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('post:deleted', (id: unknown) => {
        removePost(id as string);
        useAppStore.getState().closeTab(id as string);
      }) || (() => {})
    );

    // Media events
    unsubscribers.push(
      window.electronAPI?.on('media:imported', (media: unknown) => {
        addMedia(media as MediaData);
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('media:updated', (media: unknown) => {
        const m = media as MediaData;
        updateMedia(m.id, m);
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('media:deleted', (id: unknown) => {
        removeMedia(id as string);
      }) || (() => {})
    );

    // Task events
    unsubscribers.push(
      window.electronAPI?.on('task:started', (task: unknown) => {
        const t = task as TaskProgress;
        updateTask(t.taskId, t);
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('task:progress', (task: unknown) => {
        const t = task as TaskProgress;
        updateTask(t.taskId, t);
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('task:completed', (task: unknown) => {
        const t = task as TaskProgress;
        updateTask(t.taskId, t);
        showToast.success(`Task completed: ${t.message}`);
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('task:failed', (task: unknown) => {
        const t = task as TaskProgress;
        updateTask(t.taskId, t);
        showToast.error(`Task failed: ${t.error || t.message}`);
      }) || (() => {})
    );

    // Menu events
    unsubscribers.push(
      window.electronAPI?.on('menu:newPost', async () => {
        const post = await window.electronAPI?.posts.create({
          title: '',
          content: '',
        });
        if (post) {
          setSelectedPost((post as PostData).id);
          setActiveView('posts');
        }
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:importMedia', () => {
        window.electronAPI?.media.importDialog();
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:toggleSidebar', () => {
        toggleSidebar();
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:togglePanel', () => {
        togglePanel();
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:viewPosts', () => {
        setActiveView('posts');
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:viewMedia', () => {
        setActiveView('media');
      }) || (() => {})
    );

    // Rebuild events - clear store on start, reload on complete
    unsubscribers.push(
      window.electronAPI?.on('posts:rebuildStarted', () => {
        setPosts([], false, 0);
        setSelectedPost(null);
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('posts:databaseRebuilt', async () => {
        const postsResult = await window.electronAPI?.posts.getAll({ limit: 500, offset: 0 });
        if (postsResult) {
          const { items, hasMore, total } = postsResult as { items: PostData[]; hasMore: boolean; total: number };
          setPosts(items, hasMore, total);
        }
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('media:rebuildStarted', () => {
        setMedia([]);
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('media:databaseRebuilt', async () => {
        const mediaResult = await window.electronAPI?.media.getAll();
        if (mediaResult) {
          setMedia(mediaResult as MediaData[]);
        }
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:rebuildDatabase', async () => {
        try {
          await Promise.all([
            window.electronAPI?.posts.rebuildFromFiles(),
            window.electronAPI?.media.rebuildFromFiles(),
          ]);
          await window.electronAPI?.media.regenerateMissingThumbnails();
        } catch (error) {
          console.error('Database rebuild failed:', error);
          showToast.error('Database rebuild failed');
        }
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:reindexText', async () => {
        try {
          await Promise.all([
            window.electronAPI?.posts.reindexText(),
            window.electronAPI?.media.reindexText(),
          ]);
        } catch (error) {
          console.error('Text reindex failed:', error);
          showToast.error('Text reindex failed');
        }
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:metadataDiff', () => {
        // Open metadata diff tool tab
        openTab({ id: 'metadata-diff', type: 'metadata-diff', title: 'Metadata Diff' });
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:generateSitemap', async () => {
        try {
          await window.electronAPI?.blog.generateSitemap();
        } catch (error) {
          console.error('Sitemap generation failed:', error);
          showToast.error('Sitemap generation failed');
        }
      }) || (() => {})
    );

    // Import completion event - refresh posts and media stores
    unsubscribers.push(
      window.electronAPI?.import.onComplete(async (data) => {
        // Refresh posts store if any posts were imported
        if (data.posts.imported > 0 || data.pages.imported > 0) {
          const postsResult = await window.electronAPI?.posts.getAll({ limit: 500, offset: 0 });
          if (postsResult) {
            const { items, hasMore, total } = postsResult as { items: PostData[]; hasMore: boolean; total: number };
            setPosts(items, hasMore, total);
          }
        }

        // Refresh media store if any media was imported
        if (data.media.imported > 0) {
          const mediaResult = await window.electronAPI?.media.getAll();
          if (mediaResult) {
            setMedia(mediaResult as MediaData[]);
          }
        }

        // Show success toast
        const importedCount = data.posts.imported + data.pages.imported;
        const importedMedia = data.media.imported;
        if (data.success) {
          showToast.success(`Import complete: ${importedCount} posts, ${importedMedia} media files`);
        }
      }) || (() => {})
    );

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, []);

  const { sidebarVisible } = useAppStore();

  return (
    <div className="app">
      <WindowTitleBar />
      <div className="app-main">
        <ActivityBar />
        {sidebarVisible && (
          <ResizablePanel
            direction="horizontal"
            initialSize={280}
            minSize={200}
            maxSize={500}
            storageKey="sidebar-width"
            resizerPosition="end"
          >
            <Sidebar />
          </ResizablePanel>
        )}
        <div className="app-content">
          <TabBar />
          <Editor />
          <Panel />
        </div>
      </div>
      <StatusBar />
      <ToastContainer />
    </div>
  );
};

export default App;
