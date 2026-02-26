import { describe, expect, it } from 'vitest';
import {
  getChatSurfaceMode,
  type ChatSurfaceModeId,
} from '../../../src/renderer/navigation/chatSurfaceMode';

describe('chatSurfaceMode', () => {
  it('returns mode flags for tab and sidebar surfaces', () => {
    const tabMode = getChatSurfaceMode('tab');
    const sidebarMode = getChatSurfaceMode('sidebar');

    expect(tabMode.showModelSelector).toBe(true);
    expect(tabMode.showWelcomeTips).toBe(true);
    expect(tabMode.showToolMarkers).toBe(true);

    expect(sidebarMode.showModelSelector).toBe(false);
    expect(sidebarMode.showWelcomeTips).toBe(false);
    expect(sidebarMode.showToolMarkers).toBe(true);
  });

  it('covers all declared mode ids', () => {
    const modeIds: ChatSurfaceModeId[] = ['tab', 'sidebar'];
    expect(() => modeIds.forEach((modeId) => getChatSurfaceMode(modeId))).not.toThrow();
  });
});
