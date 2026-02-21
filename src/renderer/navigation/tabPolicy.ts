import type { TabType } from '../store/appStore';

export type SingletonToolTabKey =
  | 'settings'
  | 'tags'
  | 'style'
  | 'documentation'
  | 'metadata-diff'
  | 'site-validation';

export interface CanonicalTabSpec {
  type: TabType;
  id: string;
  isTransient: boolean;
}

const SINGLETON_TOOL_TAB_REGISTRY: Record<SingletonToolTabKey, CanonicalTabSpec> = {
  settings: { type: 'settings', id: 'settings', isTransient: false },
  tags: { type: 'tags', id: 'tags', isTransient: false },
  style: { type: 'style', id: 'style', isTransient: false },
  documentation: { type: 'documentation', id: 'documentation', isTransient: false },
  'metadata-diff': { type: 'metadata-diff', id: 'metadata-diff', isTransient: false },
  'site-validation': { type: 'site-validation', id: 'site-validation', isTransient: false },
};

export function getSingletonToolTabSpec(key: SingletonToolTabKey): CanonicalTabSpec {
  return SINGLETON_TOOL_TAB_REGISTRY[key];
}

export function openSingletonToolTab(
  openTab: (tab: CanonicalTabSpec) => void,
  key: SingletonToolTabKey,
): void {
  openTab(getSingletonToolTabSpec(key));
}
