import { openEntityTab, type CanonicalTabSpec } from './tabPolicy';
import type { SidebarView } from './sidebarViewRegistry';

interface BlogmarkStateSnapshot {
  activeView: SidebarView;
  sidebarVisible: boolean;
}

interface BlogmarkCreatedPayload {
  id?: string;
}

interface BlogmarkHandlers {
  setActiveView: (view: SidebarView) => void;
  toggleSidebar: () => void;
  setSelectedPost: (id: string) => void;
  openTab: (tab: CanonicalTabSpec) => void;
}

export function handleBlogmarkCreatedEvent(
  snapshot: BlogmarkStateSnapshot,
  payload: BlogmarkCreatedPayload | null | undefined,
  handlers: BlogmarkHandlers,
): void {
  const postId = typeof payload?.id === 'string' ? payload.id : '';
  if (!postId) {
    return;
  }

  if (snapshot.activeView !== 'posts') {
    handlers.setActiveView('posts');
  }

  if (!snapshot.sidebarVisible) {
    handlers.toggleSidebar();
  }

  handlers.setSelectedPost(postId);
  openEntityTab(handlers.openTab, 'post', postId, 'preview');
}
