import { describe, it, expect, vi, beforeEach } from 'vitest';

const exposeInMainWorld = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    once: vi.fn(),
  },
}));

describe('preload contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports the electronAPI contract object and exposes it via contextBridge', async () => {
    const preloadModule = await import('../../src/main/preload');

    expect(preloadModule).toHaveProperty('electronAPI');
    expect(exposeInMainWorld).toHaveBeenCalledWith('electronAPI', (preloadModule as { electronAPI: unknown }).electronAPI);
  });
});
