/**
 * Test setup file for Vitest
 * Configures mocks and global test utilities
 */

import { vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Mock localStorage for Zustand persist middleware
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] || null),
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock window.electronAPI for renderer tests
Object.defineProperty(globalThis, 'window', {
  value: {
    electronAPI: {
      posts: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(),
        getAll: vi.fn(),
        getByStatus: vi.fn(),
        publish: vi.fn(),
        unpublish: vi.fn(),
        rebuildFromFiles: vi.fn(),
        search: vi.fn(),
        filter: vi.fn(),
        getTags: vi.fn(),
        getCategories: vi.fn(),
        getByYearMonth: vi.fn(),
        getLinksTo: vi.fn(),
        getLinkedBy: vi.fn(),
        rebuildLinks: vi.fn(),
      },
      media: {
        import: vi.fn(),
        importDialog: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(),
        getAll: vi.fn(),
        rebuildFromFiles: vi.fn(),
        getThumbnail: vi.fn(),
        regenerateThumbnails: vi.fn(),
      },
      sync: {
        configure: vi.fn(),
        start: vi.fn(),
        getStatus: vi.fn(),
        isConfigured: vi.fn(),
        getPendingCount: vi.fn(),
        getLog: vi.fn(),
        stopAutoSync: vi.fn(),
      },
      dropbox: {
        configure: vi.fn(),
        isConfigured: vi.fn(),
        getStatus: vi.fn(),
        syncAll: vi.fn(),
        startWatching: vi.fn(),
        stopWatching: vi.fn(),
        startPolling: vi.fn(),
        stopPolling: vi.fn(),
        getConflicts: vi.fn(),
        resolveConflict: vi.fn(),
        getLastSyncTime: vi.fn(),
      },
      meta: {
        getTags: vi.fn(),
        getCategories: vi.fn(),
        addTag: vi.fn(),
        removeTag: vi.fn(),
        addCategory: vi.fn(),
        removeCategory: vi.fn(),
        syncOnStartup: vi.fn(),
        getProjectMetadata: vi.fn(),
        setProjectMetadata: vi.fn(),
        updateProjectMetadata: vi.fn(),
      },
      tasks: {
        getAll: vi.fn(),
        getRunning: vi.fn(),
        cancel: vi.fn(),
        clearCompleted: vi.fn(),
      },
      on: vi.fn(() => () => {}),
    },
  },
  writable: true,
});

// Mock Electron app module
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      const paths: Record<string, string> = {
        userData: '/mock/userData',
        appData: '/mock/appData',
        temp: '/mock/temp',
      };
      return paths[name] || '/mock/unknown';
    }),
    isPackaged: false,
    quit: vi.fn(),
    on: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    webContents: {
      send: vi.fn(),
      openDevTools: vi.fn(),
    },
    isDestroyed: vi.fn(() => false),
  })),
  Menu: {
    buildFromTemplate: vi.fn(),
    setApplicationMenu: vi.fn(),
  },
}));

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Global test utilities
declare global {
  // Add any global test utilities here
  var testUtils: {
    wait: (ms: number) => Promise<void>;
    createMockDate: (date: string) => Date;
  };
}

globalThis.testUtils = {
  wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  createMockDate: (date: string) => new Date(date),
};
