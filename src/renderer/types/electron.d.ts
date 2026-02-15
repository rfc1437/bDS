export * from '../../main/shared/electronApi';

import type { ElectronAPI } from '../../main/shared/electronApi';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
