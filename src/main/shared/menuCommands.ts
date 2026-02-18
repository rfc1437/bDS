export type AppMenuAction =
  | 'newPost'
  | 'importMedia'
  | 'save'
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
  | 'publishSelected'
  | 'rebuildDatabase'
  | 'reindexText'
  | 'metadataDiff'
  | 'generateSitemap'
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
}

export interface AppMenuGroupDefinition {
  label: 'File' | 'Edit' | 'View' | 'Blog' | 'Help';
  items: AppMenuItemDefinition[];
}

export const APP_MENU_GROUPS: AppMenuGroupDefinition[] = [
  {
    label: 'File',
    items: [
      { label: 'New Post', action: 'newPost', accelerator: 'CmdOrCtrl+N' },
      { label: 'Import Media...', action: 'importMedia', accelerator: 'CmdOrCtrl+I' },
      { label: 'Save', action: 'save', accelerator: 'CmdOrCtrl+S' },
      { label: '', action: 'file-separator-1', separator: true },
      { label: 'Quit', action: 'quit', accelerator: 'CmdOrCtrl+Q' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo', action: 'undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
      { label: 'Redo', action: 'redo', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
      { label: '', action: 'edit-separator-1', separator: true },
      { label: 'Cut', action: 'cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
      { label: 'Copy', action: 'copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
      { label: 'Paste', action: 'paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
      { label: 'Delete', action: 'delete', role: 'delete' },
      { label: '', action: 'edit-separator-2', separator: true },
      { label: 'Select All', action: 'selectAll', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      { label: '', action: 'edit-separator-3', separator: true },
      { label: 'Find', action: 'find', accelerator: 'CmdOrCtrl+F' },
      { label: 'Replace', action: 'replace', accelerator: 'CmdOrCtrl+H' },
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'Posts', action: 'viewPosts', accelerator: 'CmdOrCtrl+1' },
      { label: 'Media', action: 'viewMedia', accelerator: 'CmdOrCtrl+2' },
      { label: 'Toggle Sidebar', action: 'toggleSidebar', accelerator: 'CmdOrCtrl+B' },
      { label: 'Toggle Panel', action: 'togglePanel', accelerator: 'CmdOrCtrl+J' },
      { label: 'Toggle Developer Tools', action: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' },
    ],
  },
  {
    label: 'Blog',
    items: [
      { label: 'Publish Selected', action: 'publishSelected', accelerator: 'CmdOrCtrl+Shift+P' },
      { label: 'Rebuild Database from Files', action: 'rebuildDatabase' },
      { label: 'Reindex Search Text', action: 'reindexText' },
      { label: 'Metadata Diff Tool', action: 'metadataDiff' },
      { label: 'Generate Sitemap', action: 'generateSitemap' },
    ],
  },
  {
    label: 'Help',
    items: [
      { label: 'About Blogging Desktop Server', action: 'about' },
      { label: '', action: 'help-separator-1', separator: true },
      { label: 'View on GitHub', action: 'viewOnGitHub' },
      { label: 'Report Issue', action: 'reportIssue' },
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
  publishSelected: 'menu:publishSelected',
  rebuildDatabase: 'menu:rebuildDatabase',
  reindexText: 'menu:reindexText',
  metadataDiff: 'menu:metadataDiff',
  generateSitemap: 'menu:generateSitemap',
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
]);
