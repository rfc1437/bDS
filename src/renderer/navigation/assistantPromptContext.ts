import type { MediaData, PostData, Tab } from '../store/appStore';

export interface AssistantEditorContext {
  tabType: Tab['type'] | 'none';
  id?: string;
  title?: string;
}

export function resolveAssistantEditorContext(input: {
  activeTab: Tab | null;
  posts: PostData[];
  media: MediaData[];
}): AssistantEditorContext | null {
  const { activeTab, posts, media } = input;
  if (!activeTab) {
    return null;
  }

  if (activeTab.type === 'post') {
    const currentPost = posts.find((post) => post.id === activeTab.id);
    return {
      tabType: 'post',
      id: activeTab.id,
      title: currentPost?.title,
    };
  }

  if (activeTab.type === 'media') {
    const currentMedia = media.find((item) => item.id === activeTab.id);
    return {
      tabType: 'media',
      id: activeTab.id,
      title: currentMedia?.originalName || currentMedia?.filename || currentMedia?.title,
    };
  }

  return {
    tabType: activeTab.type,
    id: activeTab.id,
    title: activeTab.id,
  };
}

export function buildAssistantStartPrompt(input: {
  userPrompt: string;
  context: AssistantEditorContext | null;
}): string {
  const userPrompt = input.userPrompt.trim();
  const context = input.context;

  const lines = [
    `User request: ${userPrompt}`,
    `Current editor context type: ${context?.tabType ?? 'none'}`,
  ];

  if (context?.id) {
    lines.push(`Current editor context id: ${context.id}`);
  }

  if (context?.title) {
    lines.push(`Current editor context title: ${context.title}`);
  }

  lines.push('Use this context when analyzing data and proposing UI updates.');

  return lines.join('\n');
}
