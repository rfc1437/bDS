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
});
