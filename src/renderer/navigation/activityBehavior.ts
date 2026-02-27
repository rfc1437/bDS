import type { Tab } from '../store/appStore';
import type { SidebarView } from './sidebarViewRegistry';

export type ActivityId = 'posts' | 'pages' | 'media' | 'scripts' | 'templates' | 'tags' | 'chat' | 'import' | 'git' | 'settings';

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
  activeStrategy: ActiveStrategy;
  clickStrategy: ClickStrategy;
}

const ACTIVITY_CONFIG: Record<ActivityId, ActivityConfig> = {
  posts: {
    id: 'posts',
    view: 'posts',
    labelKey: 'activity.posts',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  pages: {
    id: 'pages',
    view: 'pages',
    labelKey: 'activity.pages',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  media: {
    id: 'media',
    view: 'media',
    labelKey: 'activity.media',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  scripts: {
    id: 'scripts',
    view: 'scripts',
    labelKey: 'activity.scripts',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  templates: {
    id: 'templates',
    view: 'templates',
    labelKey: 'activity.templates',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  tags: {
    id: 'tags',
    view: 'tags',
    labelKey: 'activity.tags',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  chat: {
    id: 'chat',
    view: 'chat',
    labelKey: 'activity.aiAssistant',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  import: {
    id: 'import',
    view: 'import',
    labelKey: 'activity.import',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  git: {
    id: 'git',
    view: 'git',
    labelKey: 'activity.sourceControl',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
  settings: {
    id: 'settings',
    view: 'settings',
    labelKey: 'common.settings',
    activeStrategy: 'sidebar-owner',
    clickStrategy: 'sidebar-toggle',
  },
};

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
