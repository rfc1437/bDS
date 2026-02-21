export type AppMenuAction =
  | 'newPost'
  | 'importMedia'
  | 'save'
  | 'openInBrowser'
  | 'openDataFolder'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'delete'
  | 'selectAll'
  | 'find'
  | 'replace'
  | 'viewPosts'
  | 'viewMedia'
  | 'toggleSidebar'
  | 'togglePanel'
  | 'toggleDevTools'
  | 'reload'
  | 'forceReload'
  | 'resetZoom'
  | 'zoomIn'
  | 'zoomOut'
  | 'toggleFullScreen'
  | 'publishSelected'
  | 'previewPost'
  | 'rebuildDatabase'
  | 'reindexText'
  | 'metadataDiff'
  | 'generateSitemap'
  | 'openDocumentation'
  | 'about'
  | 'viewOnGitHub'
  | 'reportIssue';

export type AppMenuRole = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll';

export interface AppMenuItemDefinition {
  label: string;
  action: AppMenuAction | `${string}-separator-${number}`;
  accelerator?: string;
  separator?: boolean;
  role?: AppMenuRole;
  id?: string;
  enabled?: boolean;
}

export interface AppMenuGroupDefinition {
  label: 'File' | 'Edit' | 'View' | 'Blog' | 'Help';
  items: AppMenuItemDefinition[];
}

export const APP_MENU_ITEM_IDS = {
  previewPost: 'blog.previewPost',
} as const;

export const APP_MENU_GROUPS: AppMenuGroupDefinition[] = [
  {
    label: 'File',
    items: [
      { label: 'menu.item.newPost', action: 'newPost', accelerator: 'CmdOrCtrl+N' },
      { label: 'menu.item.importMedia', action: 'importMedia', accelerator: 'CmdOrCtrl+I' },
      { label: '', action: 'file-separator-0', separator: true },
      { label: 'menu.item.save', action: 'save', accelerator: 'CmdOrCtrl+S' },
      { label: '', action: 'file-separator-1', separator: true },
      { label: 'menu.item.openInBrowser', action: 'openInBrowser' },
      { label: '', action: 'file-separator-2', separator: true },
      { label: 'menu.item.openDataFolder', action: 'openDataFolder' },
      { label: '', action: 'file-separator-3', separator: true },
      { label: 'menu.item.quit', action: 'quit', accelerator: 'CmdOrCtrl+Q' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'menu.item.undo', action: 'undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
      { label: 'menu.item.redo', action: 'redo', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
      { label: '', action: 'edit-separator-1', separator: true },
      { label: 'menu.item.cut', action: 'cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
      { label: 'menu.item.copy', action: 'copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
      { label: 'menu.item.paste', action: 'paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
      { label: 'menu.item.delete', action: 'delete', role: 'delete' },
      { label: '', action: 'edit-separator-2', separator: true },
      { label: 'menu.item.selectAll', action: 'selectAll', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      { label: '', action: 'edit-separator-3', separator: true },
      { label: 'menu.item.find', action: 'find', accelerator: 'CmdOrCtrl+F' },
      { label: 'menu.item.replace', action: 'replace', accelerator: 'CmdOrCtrl+H' },
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'menu.item.viewPosts', action: 'viewPosts', accelerator: 'CmdOrCtrl+1' },
      { label: 'menu.item.viewMedia', action: 'viewMedia', accelerator: 'CmdOrCtrl+2' },
      { label: 'menu.item.toggleSidebar', action: 'toggleSidebar', accelerator: 'CmdOrCtrl+B' },
      { label: 'menu.item.togglePanel', action: 'togglePanel', accelerator: 'CmdOrCtrl+J' },
      { label: 'menu.item.toggleDevTools', action: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' },
      { label: '', action: 'view-separator-1', separator: true },
      { label: 'menu.item.reload', action: 'reload' },
      { label: 'menu.item.forceReload', action: 'forceReload' },
      { label: '', action: 'view-separator-2', separator: true },
      { label: 'menu.item.resetZoom', action: 'resetZoom' },
      { label: 'menu.item.zoomIn', action: 'zoomIn' },
      { label: 'menu.item.zoomOut', action: 'zoomOut' },
      { label: '', action: 'view-separator-3', separator: true },
      { label: 'menu.item.toggleFullScreen', action: 'toggleFullScreen' },
    ],
  },
  {
    label: 'Blog',
    items: [
      { label: 'menu.item.publishSelected', action: 'publishSelected', accelerator: 'CmdOrCtrl+Shift+P' },
      { label: '', action: 'blog-separator-1', separator: true },
      { label: 'menu.item.previewPost', action: 'previewPost', id: APP_MENU_ITEM_IDS.previewPost, enabled: false, accelerator: 'CmdOrCtrl+Shift+V' },
      { label: '', action: 'blog-separator-2', separator: true },
      { label: 'menu.item.rebuildDatabase', action: 'rebuildDatabase' },
      { label: 'menu.item.reindexText', action: 'reindexText' },
      { label: '', action: 'blog-separator-3', separator: true },
      { label: 'menu.item.metadataDiff', action: 'metadataDiff' },
      { label: 'menu.item.generateSitemap', action: 'generateSitemap', accelerator: 'CmdOrCtrl+R' },
    ],
  },
  {
    label: 'Help',
    items: [
      { label: 'menu.item.about', action: 'about' },
      { label: 'menu.item.openDocumentation', action: 'openDocumentation' },
      { label: '', action: 'help-separator-1', separator: true },
      { label: 'menu.item.viewOnGitHub', action: 'viewOnGitHub' },
      { label: 'menu.item.reportIssue', action: 'reportIssue' },
    ],
  },
];

export const APP_MENU_ACTION_EVENT_MAP: Partial<Record<AppMenuAction, string>> = {
  newPost: 'menu:newPost',
  importMedia: 'menu:importMedia',
  save: 'menu:save',
  find: 'menu:find',
  replace: 'menu:replace',
  viewPosts: 'menu:viewPosts',
  viewMedia: 'menu:viewMedia',
  toggleSidebar: 'menu:toggleSidebar',
  togglePanel: 'menu:togglePanel',
  toggleDevTools: 'menu:toggleDevTools',
  previewPost: 'menu:previewPost',
  publishSelected: 'menu:publishSelected',
  rebuildDatabase: 'menu:rebuildDatabase',
  reindexText: 'menu:reindexText',
  metadataDiff: 'menu:metadataDiff',
  generateSitemap: 'menu:generateSitemap',
  openDocumentation: 'menu:openDocumentation',
  about: 'menu:about',
};

export const APP_MENU_WEB_CONTENTS_ACTIONS: ReadonlySet<AppMenuAction> = new Set([
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'delete',
  'selectAll',
  'toggleDevTools',
  'reload',
  'forceReload',
  'resetZoom',
  'zoomIn',
  'zoomOut',
  'toggleFullScreen',
]);
