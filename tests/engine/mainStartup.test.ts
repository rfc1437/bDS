import { describe, it, expect, vi, afterEach } from 'vitest';

describe('main bootstrap preview behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it.each(['win32', 'linux'])('uses compact unified window decorations on %s', async (platform) => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: platform });

    const mockApp = {
      name: 'bDS',
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      quit: vi.fn(),
    };

    const browserWindowCalls: any[] = [];
    class BrowserWindowMock {
      static getAllWindows = vi.fn(() => [{ id: 1 }]);

      loadURL = vi.fn();
      loadFile = vi.fn();
      on = vi.fn();
      isDestroyed = vi.fn(() => false);
      webContents = {
        on: vi.fn(),
        send: vi.fn(),
        openDevTools: vi.fn(),
        toggleDevTools: vi.fn(),
      };

      constructor(options: any) {
        browserWindowCalls.push(options);
      }
    }

    vi.doMock('electron', () => ({
      app: mockApp,
      BrowserWindow: BrowserWindowMock,
      Menu: {
        buildFromTemplate: vi.fn(() => ({})),
        setApplicationMenu: vi.fn(),
      },
      ipcMain: {
        on: vi.fn(),
        handle: vi.fn(),
        removeHandler: vi.fn(),
      },
      protocol: {
        registerSchemesAsPrivileged: vi.fn(),
        handle: vi.fn(),
      },
      net: {
        fetch: vi.fn(),
      },
      shell: {
        openExternal: vi.fn(),
        openPath: vi.fn(),
      },
    }));

    class MockPreviewServer {
      start = vi.fn().mockResolvedValue(4123);
      stop = vi.fn().mockResolvedValue(undefined);
      getBaseUrl = vi.fn(() => 'http://127.0.0.1:4123');
    }

    vi.doMock('../../src/main/engine/PreviewServer', () => ({
      PreviewServer: MockPreviewServer,
    }));

    vi.doMock('../../src/main/database', () => ({
      getDatabase: vi.fn(() => ({
        initializeLocal: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        getLocal: vi.fn(() => ({
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                get: vi.fn().mockResolvedValue(null),
              })),
            })),
          })),
        })),
        getDataPaths: vi.fn(() => ({ database: '/tmp/mock.db' })),
      })),
    }));

    vi.doMock('../../src/main/ipc', () => ({
      registerIpcHandlers: vi.fn(),
      registerChatHandlers: vi.fn(),
      initializeChatHandlers: vi.fn(),
      cleanupChatHandlers: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock('../../src/main/database/schema', () => ({
      media: {},
    }));

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn(),
    }));

    vi.doMock('../../src/main/engine/MediaEngine', () => ({
      getMediaEngine: vi.fn(() => ({
        getThumbnailPaths: vi.fn().mockResolvedValue({ small: null }),
      })),
    }));

    await import('../../src/main/main');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(browserWindowCalls[0]).toEqual(expect.objectContaining({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#252526',
        symbolColor: '#cccccc',
        height: 34,
      },
      autoHideMenuBar: false,
    }));

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('starts preview server during app startup', async () => {
    const mockApp = {
      name: 'bDS',
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      quit: vi.fn(),
    };

    const mockBrowserWindowGetAllWindows = vi.fn(() => [{ id: 1 }]);

    class MockBrowserWindow {
      static getAllWindows = mockBrowserWindowGetAllWindows;

      loadURL = vi.fn();
      loadFile = vi.fn();
      on = vi.fn();
      isDestroyed = vi.fn(() => false);
      webContents = {
        on: vi.fn(),
        send: vi.fn(),
        openDevTools: vi.fn(),
        toggleDevTools: vi.fn(),
      };
    }

    vi.doMock('electron', () => ({
      app: mockApp,
      BrowserWindow: MockBrowserWindow,
      Menu: {
        buildFromTemplate: vi.fn(() => ({})),
        setApplicationMenu: vi.fn(),
      },
      ipcMain: {
        on: vi.fn(),
        handle: vi.fn(),
        removeHandler: vi.fn(),
      },
      protocol: {
        registerSchemesAsPrivileged: vi.fn(),
        handle: vi.fn(),
      },
      net: {
        fetch: vi.fn(),
      },
      shell: {
        openExternal: vi.fn(),
        openPath: vi.fn(),
      },
    }));

    const mockPreviewStart = vi.fn().mockResolvedValue(4123);
    const mockPreviewStop = vi.fn().mockResolvedValue(undefined);
    const mockPreviewGetBaseUrl = vi.fn(() => 'http://127.0.0.1:4123');

    class MockPreviewServer {
      start = mockPreviewStart;
      stop = mockPreviewStop;
      getBaseUrl = mockPreviewGetBaseUrl;
    }

    vi.doMock('../../src/main/engine/PreviewServer', () => ({
      PreviewServer: MockPreviewServer,
    }));

    vi.doMock('../../src/main/database', () => ({
      getDatabase: vi.fn(() => ({
        initializeLocal: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        getLocal: vi.fn(() => ({
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                get: vi.fn().mockResolvedValue(null),
              })),
            })),
          })),
        })),
        getDataPaths: vi.fn(() => ({ database: '/tmp/mock.db' })),
      })),
    }));

    vi.doMock('../../src/main/ipc', () => ({
      registerIpcHandlers: vi.fn(),
      registerChatHandlers: vi.fn(),
      initializeChatHandlers: vi.fn(),
      cleanupChatHandlers: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock('../../src/main/database/schema', () => ({
      media: {},
    }));

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn(),
    }));

    vi.doMock('../../src/main/engine/MediaEngine', () => ({
      getMediaEngine: vi.fn(() => ({
        getThumbnailPaths: vi.fn().mockResolvedValue({ small: null }),
      })),
    }));

    await import('../../src/main/main');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockPreviewStart).toHaveBeenCalledWith(4123);
    expect(mockApp.whenReady).toHaveBeenCalled();
  });

  it('enables Blog Preview Post only for active post tab and opens canonical URL', async () => {
    const mockApp = {
      name: 'bDS',
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      quit: vi.fn(),
    };

    const mockBrowserWindowGetAllWindows = vi.fn(() => [{ id: 1 }]);

    class MockBrowserWindow {
      static getAllWindows = mockBrowserWindowGetAllWindows;

      loadURL = vi.fn();
      loadFile = vi.fn();
      on = vi.fn();
      isDestroyed = vi.fn(() => false);
      webContents = {
        on: vi.fn(),
        send: vi.fn(),
        openDevTools: vi.fn(),
        toggleDevTools: vi.fn(),
      };
    }

    const findMenuItemById = (template: any[], id: string): any | null => {
      for (const item of template) {
        if (item && item.id === id) {
          return item;
        }
        if (item?.submenu && Array.isArray(item.submenu)) {
          const found = findMenuItemById(item.submenu, id);
          if (found) return found;
        }
      }
      return null;
    };

    let capturedTemplate: any[] = [];
    const menuObject = {
      getMenuItemById: (id: string) => findMenuItemById(capturedTemplate, id),
    };

    const ipcMainHandle = vi.fn();
    const shellOpenExternal = vi.fn().mockResolvedValue(undefined);

    vi.doMock('electron', () => ({
      app: mockApp,
      BrowserWindow: MockBrowserWindow,
      Menu: {
        buildFromTemplate: vi.fn((template: any[]) => {
          capturedTemplate = template;
          return menuObject;
        }),
        setApplicationMenu: vi.fn(),
        getApplicationMenu: vi.fn(() => menuObject),
      },
      ipcMain: {
        on: vi.fn(),
        handle: ipcMainHandle,
        removeHandler: vi.fn(),
      },
      protocol: {
        registerSchemesAsPrivileged: vi.fn(),
        handle: vi.fn(),
      },
      net: {
        fetch: vi.fn(),
      },
      shell: {
        openExternal: shellOpenExternal,
        openPath: vi.fn(),
      },
    }));

    const mockPreviewStart = vi.fn().mockResolvedValue(4123);
    const mockPreviewStop = vi.fn().mockResolvedValue(undefined);
    const mockPreviewGetBaseUrl = vi.fn(() => 'http://127.0.0.1:4123');

    class MockPreviewServer {
      start = mockPreviewStart;
      stop = mockPreviewStop;
      getBaseUrl = mockPreviewGetBaseUrl;
    }

    vi.doMock('../../src/main/engine/PreviewServer', () => ({
      PreviewServer: MockPreviewServer,
    }));

    const postCreatedAt = new Date('2026-02-17T10:00:00.000Z');
    const getPost = vi.fn().mockResolvedValue({
      id: 'post-42',
      slug: 'current-post',
      createdAt: postCreatedAt,
    });

    vi.doMock('../../src/main/engine/PostEngine', () => ({
      getPostEngine: vi.fn(() => ({
        getPost,
      })),
    }));

    vi.doMock('../../src/main/database', () => ({
      getDatabase: vi.fn(() => ({
        initializeLocal: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        getLocal: vi.fn(() => ({
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                get: vi.fn().mockResolvedValue(null),
              })),
            })),
          })),
        })),
        getDataPaths: vi.fn(() => ({ database: '/tmp/mock.db' })),
      })),
    }));

    vi.doMock('../../src/main/ipc', () => ({
      registerIpcHandlers: vi.fn(),
      registerChatHandlers: vi.fn(),
      initializeChatHandlers: vi.fn(),
      cleanupChatHandlers: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock('../../src/main/database/schema', () => ({
      media: {},
    }));

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn(),
    }));

    vi.doMock('../../src/main/engine/MediaEngine', () => ({
      getMediaEngine: vi.fn(() => ({
        getThumbnailPaths: vi.fn().mockResolvedValue({ small: null }),
      })),
    }));

    await import('../../src/main/main');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const previewMenuItem = findMenuItemById(capturedTemplate, 'blog.previewPost');
    expect(previewMenuItem).toBeTruthy();
    expect(previewMenuItem.enabled).toBe(false);

    const setPreviewTargetCall = ipcMainHandle.mock.calls.find((call: unknown[]) => call[0] === 'app:setPreviewPostTarget');
    expect(setPreviewTargetCall).toBeTruthy();
    const setPreviewTargetHandler = setPreviewTargetCall?.[1] as ((event: unknown, postId: string | null) => Promise<void>);

    await setPreviewTargetHandler({}, 'post-42');
    expect(previewMenuItem.enabled).toBe(true);

    await previewMenuItem.click();

    expect(getPost).toHaveBeenCalledWith('post-42');
    expect(shellOpenExternal).toHaveBeenCalledWith('http://127.0.0.1:4123/2026/02/17/current-post');

    await setPreviewTargetHandler({}, null);
    expect(previewMenuItem.enabled).toBe(false);
  });

  it('restores previous window bounds unchanged when they fit the current display work area', async () => {
    const mockApp = {
      name: 'bDS',
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      quit: vi.fn(),
      getPath: vi.fn((name: string) => (name === 'userData' ? '/tmp/bds-user-data' : '/tmp')),
    };

    const browserWindowCalls: any[] = [];

    class MockBrowserWindow {
      static getAllWindows = vi.fn(() => [{ id: 1 }]);

      loadURL = vi.fn();
      loadFile = vi.fn();
      on = vi.fn();
      isDestroyed = vi.fn(() => false);
      webContents = {
        on: vi.fn(),
        send: vi.fn(),
        openDevTools: vi.fn(),
        toggleDevTools: vi.fn(),
      };

      constructor(options: any) {
        browserWindowCalls.push(options);
      }
    }

    vi.doMock('electron', () => ({
      app: mockApp,
      BrowserWindow: MockBrowserWindow,
      Menu: {
        buildFromTemplate: vi.fn(() => ({})),
        setApplicationMenu: vi.fn(),
      },
      ipcMain: {
        on: vi.fn(),
        handle: vi.fn(),
        removeHandler: vi.fn(),
      },
      protocol: {
        registerSchemesAsPrivileged: vi.fn(),
        handle: vi.fn(),
      },
      net: {
        fetch: vi.fn(),
      },
      shell: {
        openExternal: vi.fn(),
        openPath: vi.fn(),
      },
      screen: {
        getDisplayMatching: vi.fn(() => ({
          workArea: { x: 0, y: 25, width: 1920, height: 1055 },
        })),
      },
    }));

    class MockPreviewServer {
      start = vi.fn().mockResolvedValue(4123);
      stop = vi.fn().mockResolvedValue(undefined);
      getBaseUrl = vi.fn(() => 'http://127.0.0.1:4123');
    }

    vi.doMock('../../src/main/engine/PreviewServer', () => ({
      PreviewServer: MockPreviewServer,
    }));

    vi.doMock('fs', () => ({
      existsSync: vi.fn((targetPath: string) => targetPath.includes('window-state.json')),
      readFileSync: vi.fn(() => JSON.stringify({ x: 120, y: 80, width: 1280, height: 820 })),
      writeFileSync: vi.fn(),
    }));

    vi.doMock('../../src/main/database', () => ({
      getDatabase: vi.fn(() => ({
        initializeLocal: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        getLocal: vi.fn(() => ({
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                get: vi.fn().mockResolvedValue(null),
              })),
            })),
          })),
        })),
        getDataPaths: vi.fn(() => ({ database: '/tmp/mock.db' })),
      })),
    }));

    vi.doMock('../../src/main/ipc', () => ({
      registerIpcHandlers: vi.fn(),
      registerChatHandlers: vi.fn(),
      initializeChatHandlers: vi.fn(),
      cleanupChatHandlers: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock('../../src/main/database/schema', () => ({
      media: {},
    }));

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn(),
    }));

    vi.doMock('../../src/main/engine/MediaEngine', () => ({
      getMediaEngine: vi.fn(() => ({
        getThumbnailPaths: vi.fn().mockResolvedValue({ small: null }),
      })),
    }));

    await import('../../src/main/main');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(browserWindowCalls[0]).toEqual(expect.objectContaining({
      x: 120,
      y: 80,
      width: 1280,
      height: 820,
    }));
  });

  it('clamps restored window bounds only when they overflow the current display work area', async () => {
    const mockApp = {
      name: 'bDS',
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      quit: vi.fn(),
      getPath: vi.fn((name: string) => (name === 'userData' ? '/tmp/bds-user-data' : '/tmp')),
    };

    const browserWindowCalls: any[] = [];

    class MockBrowserWindow {
      static getAllWindows = vi.fn(() => [{ id: 1 }]);

      loadURL = vi.fn();
      loadFile = vi.fn();
      on = vi.fn();
      isDestroyed = vi.fn(() => false);
      webContents = {
        on: vi.fn(),
        send: vi.fn(),
        openDevTools: vi.fn(),
        toggleDevTools: vi.fn(),
      };

      constructor(options: any) {
        browserWindowCalls.push(options);
      }
    }

    vi.doMock('electron', () => ({
      app: mockApp,
      BrowserWindow: MockBrowserWindow,
      Menu: {
        buildFromTemplate: vi.fn(() => ({})),
        setApplicationMenu: vi.fn(),
      },
      ipcMain: {
        on: vi.fn(),
        handle: vi.fn(),
        removeHandler: vi.fn(),
      },
      protocol: {
        registerSchemesAsPrivileged: vi.fn(),
        handle: vi.fn(),
      },
      net: {
        fetch: vi.fn(),
      },
      shell: {
        openExternal: vi.fn(),
        openPath: vi.fn(),
      },
      screen: {
        getDisplayMatching: vi.fn(() => ({
          workArea: { x: 0, y: 25, width: 1280, height: 775 },
        })),
      },
    }));

    class MockPreviewServer {
      start = vi.fn().mockResolvedValue(4123);
      stop = vi.fn().mockResolvedValue(undefined);
      getBaseUrl = vi.fn(() => 'http://127.0.0.1:4123');
    }

    vi.doMock('../../src/main/engine/PreviewServer', () => ({
      PreviewServer: MockPreviewServer,
    }));

    vi.doMock('fs', () => ({
      existsSync: vi.fn((targetPath: string) => targetPath.includes('window-state.json')),
      readFileSync: vi.fn(() => JSON.stringify({ x: -40, y: -10, width: 1800, height: 1000 })),
      writeFileSync: vi.fn(),
    }));

    vi.doMock('../../src/main/database', () => ({
      getDatabase: vi.fn(() => ({
        initializeLocal: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        getLocal: vi.fn(() => ({
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                get: vi.fn().mockResolvedValue(null),
              })),
            })),
          })),
        })),
        getDataPaths: vi.fn(() => ({ database: '/tmp/mock.db' })),
      })),
    }));

    vi.doMock('../../src/main/ipc', () => ({
      registerIpcHandlers: vi.fn(),
      registerChatHandlers: vi.fn(),
      initializeChatHandlers: vi.fn(),
      cleanupChatHandlers: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock('../../src/main/database/schema', () => ({
      media: {},
    }));

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn(),
    }));

    vi.doMock('../../src/main/engine/MediaEngine', () => ({
      getMediaEngine: vi.fn(() => ({
        getThumbnailPaths: vi.fn().mockResolvedValue({ small: null }),
      })),
    }));

    await import('../../src/main/main');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(browserWindowCalls[0]).toEqual(expect.objectContaining({
      x: 0,
      y: 25,
      width: 1280,
      height: 775,
    }));
  });

  it('handles bds deep-link by creating a blogmark post with preferred category', async () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    const ipcHandlers = new Map<string, (...args: any[]) => any>();
    const mockApp = {
      name: 'bDS',
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn((event: string, callback: (...args: any[]) => void) => {
        listeners.set(event, callback);
      }),
      quit: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => true),
      setAsDefaultProtocolClient: vi.fn(() => true),
    };

    const windows: Array<{ webContents: { send: ReturnType<typeof vi.fn> } }> = [];

    class MockBrowserWindow {
      static getAllWindows = vi.fn(() => windows as any);

      loadURL = vi.fn();
      loadFile = vi.fn();
      on = vi.fn();
      isDestroyed = vi.fn(() => false);
      webContents = {
        on: vi.fn(),
        send: vi.fn(),
        openDevTools: vi.fn(),
        toggleDevTools: vi.fn(),
      };

      constructor() {
        windows.push(this as any);
      }
    }

    vi.doMock('electron', () => ({
      app: mockApp,
      BrowserWindow: MockBrowserWindow,
      Menu: {
        buildFromTemplate: vi.fn(() => ({})),
        setApplicationMenu: vi.fn(),
      },
      ipcMain: {
        on: vi.fn(),
        handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
          ipcHandlers.set(channel, handler);
        }),
        removeHandler: vi.fn(),
      },
      protocol: {
        registerSchemesAsPrivileged: vi.fn(),
        handle: vi.fn(),
      },
      net: {
        fetch: vi.fn(),
      },
      shell: {
        openExternal: vi.fn(),
        openPath: vi.fn(),
      },
    }));

    class MockPreviewServer {
      start = vi.fn().mockResolvedValue(4123);
      stop = vi.fn().mockResolvedValue(undefined);
      getBaseUrl = vi.fn(() => 'http://127.0.0.1:4123');
    }

    const createPost = vi.fn().mockResolvedValue({
      id: 'new-post-id',
      title: 'Example title',
      content: '[Example title](https://example.com/)',
      categories: ['article'],
    });

    vi.doMock('../../src/main/engine/PreviewServer', () => ({
      PreviewServer: MockPreviewServer,
    }));

    vi.doMock('../../src/main/engine/PostEngine', () => ({
      getPostEngine: vi.fn(() => ({
        getPost: vi.fn().mockResolvedValue(null),
        createPost,
      })),
    }));

    vi.doMock('../../src/main/engine/MetaEngine', () => ({
      getMetaEngine: vi.fn(() => ({
        getProjectMetadata: vi.fn().mockResolvedValue({ blogmarkCategory: 'article' }),
      })),
    }));

    vi.doMock('../../src/main/engine/BlogmarkTransformService', () => ({
      getBlogmarkTransformService: vi.fn(() => ({
        applyTransforms: vi.fn(async (input: { post: { title: string; content: string; categories: string[] } }) => ({
          post: input.post,
          appliedScriptIds: [],
          errors: [],
          toasts: [],
        })),
      })),
    }));

    vi.doMock('../../src/main/database', () => ({
      getDatabase: vi.fn(() => ({
        initializeLocal: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        getLocal: vi.fn(() => ({
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                get: vi.fn().mockResolvedValue(null),
              })),
            })),
          })),
        })),
        getDataPaths: vi.fn(() => ({ database: '/tmp/mock.db' })),
      })),
    }));

    vi.doMock('../../src/main/ipc', () => ({
      registerIpcHandlers: vi.fn(),
      registerChatHandlers: vi.fn(),
      initializeChatHandlers: vi.fn(),
      cleanupChatHandlers: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock('../../src/main/database/schema', () => ({
      media: {},
    }));

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn(),
    }));

    vi.doMock('../../src/main/engine/MediaEngine', () => ({
      getMediaEngine: vi.fn(() => ({
        getThumbnailPaths: vi.fn().mockResolvedValue({ small: null }),
      })),
    }));

    await import('../../src/main/main');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const openUrl = listeners.get('open-url');
    expect(openUrl).toBeTruthy();

    const preventDefault = vi.fn();
    openUrl?.({ preventDefault } as any, 'bds://new-post?title=Example%20title&url=https%3A%2F%2Fexample.com%2F');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(preventDefault).toHaveBeenCalled();
    expect(createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Example title',
        content: '[Example title](https://example.com/)',
        categories: ['article'],
      }),
    );

    const rendererReadyHandler = ipcHandlers.get('app:rendererReady');
    await rendererReadyHandler?.();

    expect(windows[0]?.webContents.send).toHaveBeenCalledWith(
      'blogmark:created',
      expect.objectContaining({
        post: expect.objectContaining({ id: 'new-post-id' }),
        transform: expect.objectContaining({
          appliedScriptIds: [],
          errors: [],
          toasts: [],
        }),
      }),
    );
  });

  it('queues blogmark created event until renderer has finished loading', async () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    const webContentsListeners = new Map<string, (...args: any[]) => void>();
    const ipcHandlers = new Map<string, (...args: any[]) => any>();
    const mockApp = {
      name: 'bDS',
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn((event: string, callback: (...args: any[]) => void) => {
        listeners.set(event, callback);
      }),
      quit: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => true),
      setAsDefaultProtocolClient: vi.fn(() => true),
    };

    const windows: Array<{ webContents: { send: ReturnType<typeof vi.fn> } }> = [];
    let rendererLoading = true;

    class MockBrowserWindow {
      static getAllWindows = vi.fn(() => windows as any);

      loadURL = vi.fn();
      loadFile = vi.fn();
      on = vi.fn();
      isDestroyed = vi.fn(() => false);
      webContents = {
        on: vi.fn((event: string, callback: (...args: any[]) => void) => {
          webContentsListeners.set(event, callback);
        }),
        isLoadingMainFrame: vi.fn(() => rendererLoading),
        send: vi.fn(),
        openDevTools: vi.fn(),
        toggleDevTools: vi.fn(),
      };

      constructor() {
        windows.push(this as any);
      }
    }

    vi.doMock('electron', () => ({
      app: mockApp,
      BrowserWindow: MockBrowserWindow,
      Menu: {
        buildFromTemplate: vi.fn(() => ({})),
        setApplicationMenu: vi.fn(),
      },
      ipcMain: {
        on: vi.fn(),
        handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
          ipcHandlers.set(channel, handler);
        }),
        removeHandler: vi.fn(),
      },
      protocol: {
        registerSchemesAsPrivileged: vi.fn(),
        handle: vi.fn(),
      },
      net: {
        fetch: vi.fn(),
      },
      shell: {
        openExternal: vi.fn(),
        openPath: vi.fn(),
      },
    }));

    class MockPreviewServer {
      start = vi.fn().mockResolvedValue(4123);
      stop = vi.fn().mockResolvedValue(undefined);
      getBaseUrl = vi.fn(() => 'http://127.0.0.1:4123');
    }

    const createPost = vi.fn().mockResolvedValue({
      id: 'queued-post-id',
      title: 'Queued title',
      content: '[Queued title](https://example.com/)',
      categories: ['article'],
    });

    vi.doMock('../../src/main/engine/PreviewServer', () => ({
      PreviewServer: MockPreviewServer,
    }));

    vi.doMock('../../src/main/engine/PostEngine', () => ({
      getPostEngine: vi.fn(() => ({
        getPost: vi.fn().mockResolvedValue(null),
        createPost,
      })),
    }));

    vi.doMock('../../src/main/engine/MetaEngine', () => ({
      getMetaEngine: vi.fn(() => ({
        getProjectMetadata: vi.fn().mockResolvedValue({ blogmarkCategory: 'article' }),
      })),
    }));

    vi.doMock('../../src/main/engine/BlogmarkTransformService', () => ({
      getBlogmarkTransformService: vi.fn(() => ({
        applyTransforms: vi.fn(async (input: { post: { title: string; content: string; categories: string[] } }) => ({
          post: input.post,
          appliedScriptIds: [],
          errors: [],
          toasts: [],
        })),
      })),
    }));

    vi.doMock('../../src/main/database', () => ({
      getDatabase: vi.fn(() => ({
        initializeLocal: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        getLocal: vi.fn(() => ({
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                get: vi.fn().mockResolvedValue(null),
              })),
            })),
          })),
        })),
        getDataPaths: vi.fn(() => ({ database: '/tmp/mock.db' })),
      })),
    }));

    vi.doMock('../../src/main/ipc', () => ({
      registerIpcHandlers: vi.fn(),
      registerChatHandlers: vi.fn(),
      initializeChatHandlers: vi.fn(),
      cleanupChatHandlers: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock('../../src/main/database/schema', () => ({
      media: {},
    }));

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn(),
    }));

    vi.doMock('../../src/main/engine/MediaEngine', () => ({
      getMediaEngine: vi.fn(() => ({
        getThumbnailPaths: vi.fn().mockResolvedValue({ small: null }),
      })),
    }));

    await import('../../src/main/main');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const openUrl = listeners.get('open-url');
    expect(openUrl).toBeTruthy();

    const preventDefault = vi.fn();
    openUrl?.({ preventDefault } as any, 'bds://new-post?title=Queued%20title&url=https%3A%2F%2Fexample.com%2F');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createPost).toHaveBeenCalledTimes(1);
    expect(windows[0]?.webContents.send).not.toHaveBeenCalledWith(
      'blogmark:created',
      expect.anything(),
    );

    rendererLoading = false;
    const didFinishLoad = webContentsListeners.get('did-finish-load');
    didFinishLoad?.();

    expect(windows[0]?.webContents.send).not.toHaveBeenCalledWith(
      'blogmark:created',
      expect.anything(),
    );

    const rendererReadyHandler = ipcHandlers.get('app:rendererReady');
    await rendererReadyHandler?.();

    expect(windows[0]?.webContents.send).toHaveBeenCalledWith(
      'blogmark:created',
      expect.objectContaining({
        post: expect.objectContaining({ id: 'queued-post-id' }),
        transform: expect.objectContaining({
          appliedScriptIds: [],
          errors: [],
          toasts: [],
        }),
      }),
    );
  });

  it('uses active project blogmark category during cold-start deep-link processing', async () => {
    const originalArgv = process.argv;
    process.argv = [
      'bds',
      'bds://new-post?title=Cold%20start&url=https%3A%2F%2Fexample.com%2Fcold',
    ];

    const mockApp = {
      name: 'bDS',
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      quit: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => true),
      setAsDefaultProtocolClient: vi.fn(() => true),
    };

    class MockBrowserWindow {
      static getAllWindows = vi.fn(() => [{ id: 1 }]);

      loadURL = vi.fn();
      loadFile = vi.fn();
      on = vi.fn();
      isDestroyed = vi.fn(() => false);
      webContents = {
        on: vi.fn(),
        send: vi.fn(),
        openDevTools: vi.fn(),
        toggleDevTools: vi.fn(),
      };
    }

    vi.doMock('electron', () => ({
      app: mockApp,
      BrowserWindow: MockBrowserWindow,
      Menu: {
        buildFromTemplate: vi.fn(() => ({})),
        setApplicationMenu: vi.fn(),
      },
      ipcMain: {
        on: vi.fn(),
        handle: vi.fn(),
        removeHandler: vi.fn(),
      },
      protocol: {
        registerSchemesAsPrivileged: vi.fn(),
        handle: vi.fn(),
      },
      net: {
        fetch: vi.fn(),
      },
      shell: {
        openExternal: vi.fn(),
        openPath: vi.fn(),
      },
    }));

    class MockPreviewServer {
      start = vi.fn().mockResolvedValue(4123);
      stop = vi.fn().mockResolvedValue(undefined);
      getBaseUrl = vi.fn(() => 'http://127.0.0.1:4123');
    }

    const createPost = vi.fn().mockResolvedValue({
      id: 'cold-start-id',
      title: 'Cold start',
      content: '[Cold start](https://example.com/cold)',
      categories: ['aside'],
    });

    vi.doMock('../../src/main/engine/PreviewServer', () => ({
      PreviewServer: MockPreviewServer,
    }));

    vi.doMock('../../src/main/engine/PostEngine', () => ({
      getPostEngine: vi.fn(() => ({
        getPost: vi.fn().mockResolvedValue(null),
        createPost,
        setProjectContext: vi.fn(),
        setSearchLanguage: vi.fn(),
      })),
    }));

    let currentProjectId = 'default';
    vi.doMock('../../src/main/engine/MetaEngine', () => ({
      getMetaEngine: vi.fn(() => ({
        setProjectContext: vi.fn((projectId: string) => {
          currentProjectId = projectId;
        }),
        syncOnStartup: vi.fn().mockResolvedValue(undefined),
        getProjectMetadata: vi.fn(async () => ({
          blogmarkCategory: currentProjectId === 'project-2' ? 'aside' : 'article',
        })),
      })),
    }));

    vi.doMock('../../src/main/engine/ProjectEngine', () => ({
      getProjectEngine: vi.fn(() => ({
        getActiveProject: vi.fn().mockResolvedValue({
          id: 'project-2',
          dataPath: '/tmp/project-2',
        }),
        getDataDir: vi.fn(() => '/tmp/project-2'),
      })),
    }));

    vi.doMock('../../src/main/database', () => ({
      getDatabase: vi.fn(() => ({
        initializeLocal: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        getLocal: vi.fn(() => ({
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                get: vi.fn().mockResolvedValue(null),
              })),
            })),
          })),
        })),
        getDataPaths: vi.fn(() => ({ database: '/tmp/mock.db' })),
      })),
    }));

    vi.doMock('../../src/main/ipc', () => ({
      registerIpcHandlers: vi.fn(),
      registerChatHandlers: vi.fn(),
      initializeChatHandlers: vi.fn(),
      cleanupChatHandlers: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock('../../src/main/database/schema', () => ({
      media: {},
    }));

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn(),
    }));

    vi.doMock('../../src/main/engine/MediaEngine', () => ({
      getMediaEngine: vi.fn(() => ({
        getThumbnailPaths: vi.fn().mockResolvedValue({ small: null }),
        setProjectContext: vi.fn(),
        setSearchLanguage: vi.fn(),
      })),
    }));

    await import('../../src/main/main');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        categories: ['aside'],
      }),
    );

    process.argv = originalArgv;
  });
});
