import React, { useEffect } from 'react';
import { ActivityBar, Sidebar, Editor, StatusBar, Panel, ToastContainer, showToast } from './components';
import { useAppStore, PostData, MediaData, TaskProgress } from './store';
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
    setSyncStatus,
    setSyncConfigured,
    setPendingChanges,
    setLoading,
    toggleSidebar,
    togglePanel,
    setActiveView,
    setSelectedPost,
  } = useAppStore();

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // First, get active project to set the correct context in backend engines
        await window.electronAPI?.projects.getActive();
        
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

        // Re-configure Dropbox sync from saved credentials
        const savedCreds = localStorage.getItem('bds-credentials');
        if (savedCreds) {
          try {
            const creds = JSON.parse(savedCreds);
            if (creds.dropboxAccessToken && creds.dropboxAppKey) {
              await window.electronAPI?.dropbox?.configure({
                accessToken: creds.dropboxAccessToken,
                appKey: creds.dropboxAppKey,
                remotePath: creds.dropboxRemotePath || '/blog',
              });
            }
          } catch (e) {
            console.error('Failed to restore sync configuration:', e);
          }
        }

        // Check sync status (uses Dropbox configuration)
        const syncConfigured = await window.electronAPI?.sync.isConfigured();
        setSyncConfigured(syncConfigured || false);

        // Get pending changes count
        const pending = await window.electronAPI?.sync.getPendingCount();
        if (pending) {
          setPendingChanges(pending);
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

    // Sync events
    unsubscribers.push(
      window.electronAPI?.on('sync:started', () => {
        setSyncStatus('syncing');
        showToast.loading('Syncing...');
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('sync:completed', async () => {
        setSyncStatus('idle');
        showToast.dismiss();
        showToast.success('Sync completed');
        const pending = await window.electronAPI?.sync.getPendingCount();
        if (pending) {
          setPendingChanges(pending);
        }
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('sync:failed', (errorMsg: unknown) => {
        setSyncStatus('error');
        showToast.dismiss();
        const message = typeof errorMsg === 'string' && errorMsg ? errorMsg : 'Unknown error';
        showToast.error(`Sync failed: ${message}`);
        console.error('Sync failed:', message);
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

    unsubscribers.push(
      window.electronAPI?.on('menu:syncNow', () => {
        window.electronAPI?.sync.start('bidirectional');
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:pushChanges', () => {
        window.electronAPI?.sync.start('push');
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:pullChanges', () => {
        window.electronAPI?.sync.start('pull');
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:configureSync', () => {
        setActiveView('settings');
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
      window.electronAPI?.on('menu:rebuildDatabase', () => {
        // Fire and forget - the handlers return immediately now
        window.electronAPI?.posts.rebuildFromFiles();
        window.electronAPI?.media.rebuildFromFiles();
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:reindexText', () => {
        // Fire and forget - runs as a background task
        window.electronAPI?.posts.reindexText();
      }) || (() => {})
    );

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, []);

  return (
    <div className="app">
      <div className="app-main">
        <ActivityBar />
        <Sidebar />
        <div className="app-content">
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
