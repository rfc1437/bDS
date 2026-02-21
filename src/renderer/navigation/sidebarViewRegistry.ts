export const SIDEBAR_VIEW_REGISTRY = [
  'posts',
  'pages',
  'media',
  'settings',
  'tags',
  'chat',
  'import',
  'git',
] as const;

export type SidebarView = (typeof SIDEBAR_VIEW_REGISTRY)[number];

export const DEFAULT_SIDEBAR_VIEW: SidebarView = 'posts';

export function isSidebarView(value: string): value is SidebarView {
  return (SIDEBAR_VIEW_REGISTRY as readonly string[]).includes(value);
}
