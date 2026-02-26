import type { SidebarView } from './sidebarViewRegistry';
import type { TabType } from '../store/appStore';
import { isSidebarView } from './sidebarViewRegistry';
import { z } from 'zod';

export interface AssistantActionInput {
  action: string;
  payload?: Record<string, unknown>;
}

export interface AssistantActionDependencies {
  setSelectedPost: (id: string | null) => void;
  setSelectedMedia: (id: string | null) => void;
  openTab: (tab: { type: TabType; id: string; isTransient: boolean }) => void;
  setActiveView: (view: SidebarView) => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
  toggleAssistantSidebar: () => void;
}

export interface AssistantActionResult {
  handled: boolean;
  error?: string;
}

const openPostPayloadSchema = z.object({
  postId: z.string().min(1),
});

const openMediaPayloadSchema = z.object({
  mediaId: z.string().min(1),
});

const switchViewPayloadSchema = z
  .object({
    view: z.string().min(1),
  })
  .refine((payload) => isSidebarView(payload.view), {
    message: 'view must be a valid sidebar view',
  });

const openChatPayloadSchema = z.object({
  conversationId: z.string().min(1),
});

function invalidPayloadError(action: string): AssistantActionResult {
  return {
    handled: false,
    error: `Invalid payload for ${action} action`,
  };
}

export function dispatchAssistantAction(
  input: AssistantActionInput,
  dependencies: AssistantActionDependencies,
): AssistantActionResult {
  const payload = input.payload ?? {};

  if (input.action === 'openPost') {
    const parsed = openPostPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return invalidPayloadError('openPost');
    }
    const { postId } = parsed.data;

    dependencies.setActiveView('posts');
    dependencies.setSelectedPost(postId);
    dependencies.openTab({ type: 'post', id: postId, isTransient: false });
    return { handled: true };
  }

  if (input.action === 'openMedia') {
    const parsed = openMediaPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return invalidPayloadError('openMedia');
    }
    const { mediaId } = parsed.data;

    dependencies.setActiveView('media');
    dependencies.setSelectedMedia(mediaId);
    dependencies.openTab({ type: 'media', id: mediaId, isTransient: false });
    return { handled: true };
  }

  if (input.action === 'switchView' || input.action === 'setActiveView') {
    const parsed = switchViewPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return invalidPayloadError(input.action);
    }
    const { view } = parsed.data;

    dependencies.setActiveView(view as SidebarView);
    return { handled: true };
  }

  if (input.action === 'openChat') {
    const parsed = openChatPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return invalidPayloadError('openChat');
    }

    dependencies.setActiveView('chat');
    dependencies.openTab({ type: 'chat', id: parsed.data.conversationId, isTransient: false });
    return { handled: true };
  }

  if (input.action === 'openSettings') {
    dependencies.setActiveView('settings');
    dependencies.openTab({ type: 'settings', id: 'settings', isTransient: false });
    return { handled: true };
  }

  if (input.action === 'toggleSidebar') {
    dependencies.toggleSidebar();
    return { handled: true };
  }

  if (input.action === 'togglePanel') {
    dependencies.togglePanel();
    return { handled: true };
  }

  if (input.action === 'openPanel') {
    dependencies.togglePanel();
    return { handled: true };
  }

  if (input.action === 'toggleAssistantSidebar') {
    dependencies.toggleAssistantSidebar();
    return { handled: true };
  }

  return { handled: false, error: `Unsupported action: ${input.action}` };
}
