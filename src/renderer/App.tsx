import React, { useEffect, useRef } from 'react';
import { ActivityBar, Sidebar, Editor, StatusBar, Panel, TabBar, ToastContainer, showToast, ResizablePanel, WindowTitleBar, AssistantSidebar } from './components';
import { useAppStore, PostData, MediaData, TaskProgress } from './store';
import { loadTabsForProject, saveTabsForProject } from './utils';
import { openSingletonToolTab } from './navigation/tabPolicy';
import { persistSiteValidationReport } from './navigation/siteValidationPersistence';
import { executeActivityClick } from './navigation/activityExecution';
import { handleBlogmarkCreatedEvent } from './navigation/blogmarkHandling';
import {
  buildBlogmarkTransformOutputEntries,
  buildBlogmarkTransformToastNotifications,
  parseBlogmarkCreatedEventPayload,
  shouldAutoOpenPanelForOutputEntries,
} from './navigation/blogmarkTransformOutput';
import { createDeferredEventGate } from './navigation/deferredEventGate';
import { createAndFocusPost } from './navigation/postCreation';
import { ensureRendererPicoThemeStylesheet, getRendererPicoTheme } from './utils/picoTheme';
import { addWindowEventListener, BDS_EVENT_SCRIPTS_CHANGED } from './utils/windowEvents';
import { refreshPythonMacroSlugs, wirePythonMacroPreview, invalidatePythonMacroScriptCache } from './macros';
import { useI18n } from './i18n';
import './App.css';

const App: React.FC = () => {
  const { t: tr } = useI18n();
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
    toggleAssistantSidebar,
    setActiveView,
    setSelectedPost,
    setActiveProject,
    setPicoTheme,
    openTab,
    restoreTabState,
    appendPanelOutputEntry,
  } = useAppStore();
  const blogmarkEventGateRef = useRef(createDeferredEventGate<PostData>());

  const processBlogmarkCreated = (created: PostData) => {
    addPost(created);
    const state = useAppStore.getState();
    handleBlogmarkCreatedEvent(
      {
        activeView: state.activeView,
        sidebarVisible: state.sidebarVisible,
      },
      created,
      {
        setActiveView: state.setActiveView,
        toggleSidebar: state.toggleSidebar,
        setSelectedPost: state.setSelectedPost,
        openTab: state.openTab,
      },
    );
  };

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // First, get active project to set the correct context in backend engines
        const activeProject = await window.electronAPI?.projects.getActive();
        if (activeProject) {
          setActiveProject(activeProject as import('./store').ProjectData);

          const metadata = await window.electronAPI?.meta.getProjectMetadata();
          setPicoTheme(metadata?.picoTheme);
          const resolvedTheme = getRendererPicoTheme(metadata?.picoTheme);
          await ensureRendererPicoThemeStylesheet(resolvedTheme);
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

        // Load known Python macro slugs for editor detection
        await refreshPythonMacroSlugs();

        // Wire Python macro resolver/renderer for editor preview
        wirePythonMacroPreview();
      } catch (error) {
        console.error('Failed to load initial data:', error);
      } finally {
        setLoading(false);
        setTimeout(() => {
          blogmarkEventGateRef.current.markReady(processBlogmarkCreated);
        }, 0);
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
  }, [tr]);

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
      window.electronAPI?.on('task:created', (task: unknown) => {
        const t = task as TaskProgress;
        updateTask(t.taskId, t);
      }) || (() => {})
    );

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
        showToast.success(tr('app.taskCompleted', { message: t.message }));
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('task:failed', (task: unknown) => {
        const t = task as TaskProgress;
        updateTask(t.taskId, t);
        showToast.error(tr('app.taskFailed', { message: t.error || t.message }));
      }) || (() => {})
    );

    // Menu events
    unsubscribers.push(
      window.electronAPI?.on('menu:newPost', async () => {
        const state = useAppStore.getState();
        await createAndFocusPost({
          createPost: async (input) => (await window.electronAPI?.posts.create(input)) as { id: string } | null | undefined,
          setSelectedPost: state.setSelectedPost,
          ensurePostsSidebar: () => {
            const next = useAppStore.getState();
            executeActivityClick(
              {
                activeView: next.activeView,
                sidebarVisible: next.sidebarVisible,
                tabs: next.tabs,
                activeTabId: next.activeTabId,
              },
              'posts',
              {
                setActiveView: next.setActiveView,
                toggleSidebar: next.toggleSidebar,
              },
            );
          },
          onError: (error) => {
            console.error('Failed to create post:', error);
          },
        });
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('blogmark:created', (payload: unknown) => {
        const parsedPayload = parseBlogmarkCreatedEventPayload(payload);
        if (!parsedPayload) {
          return;
        }

        const created = parsedPayload.post as PostData;
        if (!created?.id) {
          return;
        }

        const outputEntries = buildBlogmarkTransformOutputEntries(parsedPayload.transform, tr);
        const toastNotifications = buildBlogmarkTransformToastNotifications(parsedPayload.transform, tr);

        toastNotifications.forEach((notification) => {
          if (notification.kind === 'error') {
            showToast.error(notification.message);
            return;
          }

          showToast.success(notification.message);
        });

        if (outputEntries.length > 0) {
          const createdAt = new Date().toISOString();
          outputEntries.forEach((entry, index) => {
            appendPanelOutputEntry({
              id: `blogmark-transform-${Date.now()}-${index}`,
              createdAt,
              message: entry.message,
              kind: entry.kind,
            });
          });

          if (shouldAutoOpenPanelForOutputEntries(outputEntries)) {
            useAppStore.setState({
              panelVisible: true,
              panelActiveTab: 'output',
            });
          }
        }

        blogmarkEventGateRef.current.push(created, processBlogmarkCreated);
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
      window.electronAPI?.on('menu:toggleAssistantSidebar', () => {
        toggleAssistantSidebar();
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:viewPosts', () => {
        const state = useAppStore.getState();
        executeActivityClick(
          {
            activeView: state.activeView,
            sidebarVisible: state.sidebarVisible,
            tabs: state.tabs,
            activeTabId: state.activeTabId,
          },
          'posts',
          {
            setActiveView: state.setActiveView,
            toggleSidebar: state.toggleSidebar,
          },
        );
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:viewMedia', () => {
        const state = useAppStore.getState();
        executeActivityClick(
          {
            activeView: state.activeView,
            sidebarVisible: state.sidebarVisible,
            tabs: state.tabs,
            activeTabId: state.activeTabId,
          },
          'media',
          {
            setActiveView: state.setActiveView,
            toggleSidebar: state.toggleSidebar,
          },
        );
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:editPreferences', () => {
        openSingletonToolTab(openTab, 'settings');
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:editMenu', () => {
        openSingletonToolTab(openTab, 'menu-editor');
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
            window.electronAPI?.scripts.rebuildFromFiles(),
          ]);
          await window.electronAPI?.media.regenerateMissingThumbnails();
        } catch (error) {
          console.error('Database rebuild failed:', error);
          showToast.error(tr('app.databaseRebuildFailed'));
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
          showToast.error(tr('app.textReindexFailed'));
        }
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:metadataDiff', () => {
        openSingletonToolTab(openTab, 'metadata-diff');
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:generateSitemap', async () => {
        try {
          await window.electronAPI?.blog.generateSitemap();
        } catch (error) {
          console.error('Sitemap generation failed:', error);
          showToast.error(tr('app.sitemapGenerationFailed'));
        }
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:regenerateCalendar', async () => {
        try {
          await window.electronAPI?.blog.regenerateCalendar();
        } catch (error) {
          console.error('Calendar regeneration failed:', error);
          showToast.error(tr('app.calendarRegenerationFailed'));
        }
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:validateSite', () => {
        const validateAndOpen = async () => {
          try {
            const report = await window.electronAPI?.blog.validateSite();
            const projectId = useAppStore.getState().activeProject?.id;
            if (projectId && report) {
              persistSiteValidationReport(projectId, report);
              window.dispatchEvent(new CustomEvent('bds:site-validation-updated', {
                detail: { projectId },
              }));
            }
            openSingletonToolTab(openTab, 'site-validation');
          } catch (error) {
            console.error('Site validation failed:', error);
            showToast.error(tr('siteValidation.error.validate'));
          }
        };
        void validateAndOpen();
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:previewPost', async () => {
        try {
          const selectedPostId = useAppStore.getState().selectedPostId;
          if (!selectedPostId) {
            return;
          }

          const previewUrl = await window.electronAPI?.posts.getPreviewUrl(selectedPostId);
          if (typeof previewUrl === 'string' && previewUrl.length > 0) {
            window.open(previewUrl, '_blank', 'noopener');
          }
        } catch (error) {
          console.error('Failed to open selected post preview:', error);
          showToast.error(tr('app.previewOpenFailed'));
        }
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:uploadSite', async () => {
        try {
          const prefs = await window.electronAPI?.meta.getPublishingPreferences();
          if (!prefs) {
            showToast.error(tr('app.uploadSiteNoCredentials'));
            return;
          }
          if (!prefs.sshHost || !prefs.sshUser || !prefs.sshRemotePath) {
            showToast.error(tr('app.uploadSiteNoCredentials'));
            return;
          }
          await window.electronAPI?.publish.uploadSite(prefs);
        } catch (error) {
          console.error('Site upload failed:', error);
          showToast.error(tr('app.uploadSiteFailed'));
        }
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:openDocumentation', () => {
        openSingletonToolTab(openTab, 'documentation');
      }) || (() => {})
    );

    unsubscribers.push(
      window.electronAPI?.on('menu:openApiDocumentation', () => {
        openSingletonToolTab(openTab, 'api-documentation');
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
          showToast.success(tr('app.importComplete', { posts: importedCount, media: importedMedia }));
        }
      }) || (() => {})
    );

    // Refresh Python macro slugs when scripts change
    unsubscribers.push(
      addWindowEventListener(BDS_EVENT_SCRIPTS_CHANGED, () => {
        invalidatePythonMacroScriptCache();
        void refreshPythonMacroSlugs();
      })
    );

    void window.electronAPI?.app.notifyRendererReady?.().catch((error) => {
      console.error('Failed to notify renderer readiness:', error);
    });

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, []);

  const { sidebarVisible, assistantSidebarVisible } = useAppStore();

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
        {assistantSidebarVisible && (
          <ResizablePanel
            direction="horizontal"
            initialSize={360}
            minSize={280}
            maxSize={640}
            storageKey="assistant-sidebar-width"
            resizerPosition="start"
          >
            <AssistantSidebar />
          </ResizablePanel>
        )}
      </div>
      <StatusBar />
      <ToastContainer />
    </div>
  );
};

export default App;
