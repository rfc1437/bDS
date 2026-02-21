import type { Tab, TabType } from '../store/appStore';
import { parseGitDiffTabId } from './tabPolicy';

export type EditorRoute =
  | 'dashboard'
  | 'post'
  | 'media'
  | 'settings'
  | 'style'
  | 'tags'
  | 'chat'
  | 'import'
  | 'metadata-diff'
  | 'git-diff'
  | 'documentation'
  | 'site-validation';

export const EDITOR_TAB_ROUTE_REGISTRY: Record<TabType, Exclude<EditorRoute, 'dashboard'>> = {
  post: 'post',
  media: 'media',
  settings: 'settings',
  style: 'style',
  tags: 'tags',
  chat: 'chat',
  import: 'import',
  'metadata-diff': 'metadata-diff',
  'git-diff': 'git-diff',
  documentation: 'documentation',
  'site-validation': 'site-validation',
};

export interface EditorRouteResolution {
  route: EditorRoute;
  tabId: string | null;
  gitDiffResource: string | null;
}

export function resolveEditorRoute(activeTab: Tab | undefined): EditorRouteResolution {
  if (!activeTab) {
    return {
      route: 'dashboard',
      tabId: null,
      gitDiffResource: null,
    };
  }

  if (activeTab.type === 'git-diff') {
    return {
      route: 'git-diff',
      tabId: activeTab.id,
      gitDiffResource: parseGitDiffTabId(activeTab.id).resource,
    };
  }

  return {
    route: EDITOR_TAB_ROUTE_REGISTRY[activeTab.type],
    tabId: activeTab.id,
    gitDiffResource: null,
  };
}
