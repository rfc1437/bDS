import type { Tab } from '../store/appStore';

export type ActivityId = 'posts' | 'pages' | 'media' | 'tags' | 'chat' | 'import' | 'git' | 'settings';
export type SidebarView = 'posts' | 'pages' | 'media' | 'settings' | 'tags' | 'chat' | 'import' | 'git';

export interface ActivitySnapshot {
  activeView: SidebarView;
  sidebarVisible: boolean;
  tabs: Tab[];
  activeTabId: string | null;
}

type ActiveStrategy = 'sidebar-owner';
type ClickStrategy = 'sidebar-toggle';

interface ActivityConfig {
  id: ActivityId;
  view: SidebarView;
  labelKey: string;
  placement: 'top' | 'bottom';
  activeStrategy: ActiveStrategy;
  clickStrategy: ClickStrategy;
}

const ACTIVITY_CONFIG: Record<ActivityId, ActivityConfig> = {
  posts: {
    id: 'posts',
    view: 'posts',
    labelKey: 'activity.posts',
    placement: 'top',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  pages: {
    id: 'pages',
    view: 'pages',
    labelKey: 'activity.pages',
    placement: 'top',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  media: {
    id: 'media',
    view: 'media',
    labelKey: 'activity.media',
    placement: 'top',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  tags: {
    id: 'tags',
    view: 'tags',
    labelKey: 'activity.tags',
    placement: 'top',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  chat: {
    id: 'chat',
    view: 'chat',
    labelKey: 'activity.aiAssistant',
    placement: 'top',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  import: {
    id: 'import',
    view: 'import',
    labelKey: 'activity.import',
    placement: 'top',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  git: {
    id: 'git',
    view: 'git',
    labelKey: 'activity.sourceControl',
    placement: 'bottom',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  settings: {
    id: 'settings',
    view: 'settings',
    labelKey: 'common.settings',
    placement: 'bottom',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
};

export const TOP_ACTIVITY_IDS: ActivityId[] = ['posts', 'pages', 'media', 'tags', 'chat', 'import'];
export const BOTTOM_ACTIVITY_IDS: ActivityId[] = ['git', 'settings'];

export function getActivityConfig(activityId: ActivityId): ActivityConfig {
  return ACTIVITY_CONFIG[activityId];
}

export function isActivityActive(snapshot: ActivitySnapshot, activityId: ActivityId): boolean {
  const config = getActivityConfig(activityId);
  return snapshot.activeView === config.view && snapshot.sidebarVisible;
}

export type ActivityAction =
  | { type: 'toggleSidebar' }
  | { type: 'setActiveView'; view: SidebarView };

export function getActivityClickActions(snapshot: ActivitySnapshot, activityId: ActivityId): ActivityAction[] {
  const config = getActivityConfig(activityId);

  if (snapshot.activeView === config.view) {
    return [{ type: 'toggleSidebar' }];
  }

  const actions: ActivityAction[] = [];

  actions.push({ type: 'setActiveView', view: config.view });

  if (!snapshot.sidebarVisible) {
    actions.push({ type: 'toggleSidebar' });
  }

  return actions;
}
