import { describe, it, expect, vi, afterEach } from 'vitest';

describe('main bootstrap preview behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
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
});
