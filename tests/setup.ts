/**
 * Test setup file for Vitest
 * Configures mocks and global test utilities
 */

import { vi, beforeEach, afterEach } from 'vitest';

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
