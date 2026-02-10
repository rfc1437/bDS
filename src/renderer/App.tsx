import React, { useEffect } from 'react';
import { ActivityBar, Sidebar, Editor, StatusBar, Panel } from './components';
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
        // Load posts
        const posts = await window.electronAPI?.posts.getAll();
        if (posts) {
          setPosts(posts as PostData[]);
        }

        // Load media
        const media = await window.electronAPI?.media.getAll();
        if (media) {
          setMedia(media as MediaData[]);
        }

        // Check sync status
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
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('sync:completed', async () => {
        setSyncStatus('idle');
        const pending = await window.electronAPI?.sync.getPendingCount();
        if (pending) {
          setPendingChanges(pending);
        }
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('sync:failed', () => {
        setSyncStatus('error');
      }) || (() => {})
    );

    // Task events
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
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('task:failed', (task: unknown) => {
        const t = task as TaskProgress;
        updateTask(t.taskId, t);
      }) || (() => {})
    );

    // Menu events
    unsubscribers.push(
      window.electronAPI?.on('menu:newPost', async () => {
        const post = await window.electronAPI?.posts.create({
          title: 'New Post',
          content: '# New Post\n\nStart writing...',
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

    unsubscribers.push(
      window.electronAPI?.on('menu:rebuildDatabase', async () => {
        await window.electronAPI?.posts.rebuildFromFiles();
        await window.electronAPI?.media.rebuildFromFiles();
        // Reload data
        const posts = await window.electronAPI?.posts.getAll();
        if (posts) {
          setPosts(posts as PostData[]);
        }
        const media = await window.electronAPI?.media.getAll();
        if (media) {
          setMedia(media as MediaData[]);
        }
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
    </div>
  );
};

export default App;
