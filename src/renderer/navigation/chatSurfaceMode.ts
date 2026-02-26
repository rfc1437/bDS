export type ChatSurfaceModeId = 'tab' | 'sidebar';

export interface ChatSurfaceMode {
  showModelSelector: boolean;
  showWelcomeTips: boolean;
  showToolMarkers: boolean;
}

const CHAT_SURFACE_MODE_REGISTRY: Record<ChatSurfaceModeId, ChatSurfaceMode> = {
  tab: {
    showModelSelector: true,
    showWelcomeTips: true,
    showToolMarkers: true,
  },
  sidebar: {
    showModelSelector: false,
    showWelcomeTips: false,
    showToolMarkers: true,
  },
};

export function getChatSurfaceMode(modeId: ChatSurfaceModeId): ChatSurfaceMode {
  return CHAT_SURFACE_MODE_REGISTRY[modeId];
}
