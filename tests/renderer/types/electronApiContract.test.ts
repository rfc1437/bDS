import { describe, it, expectTypeOf } from 'vitest';
import type { ElectronAPI as SharedElectronAPI } from '../../../src/main/shared/electronApi';
import type { ElectronAPI as RendererElectronAPI } from '../../../src/renderer/types/electron';

describe('Electron API type contract', () => {
  it('keeps renderer and shared ElectronAPI contracts in sync', () => {
    expectTypeOf<RendererElectronAPI>().toEqualTypeOf<SharedElectronAPI>();
  });
});
