import { app, BrowserWindow, Menu, MenuItemConstructorOptions, ipcMain, protocol, net, shell, screen } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { getDatabase, initDatabase } from './database';
import { registerIpcHandlers, registerEventForwarding, registerChatHandlers, initializeChatHandlers, cleanupChatHandlers, startEmbeddingIndexTask, startRebuildEmbeddingIndexTask } from './ipc';
import { media } from './database/schema';
import { eq } from 'drizzle-orm';
import { MediaEngine } from './engine/MediaEngine';
import { PostEngine } from './engine/PostEngine';
import { MetaEngine } from './engine/MetaEngine';
import { MenuEngine } from './engine/MenuEngine';
import { TemplateEngine } from './engine/TemplateEngine';
import { ScriptEngine } from './engine/ScriptEngine';
import { PostMediaEngine } from './engine/PostMediaEngine';
import { TagEngine } from './engine/TagEngine';
import { ProjectEngine } from './engine/ProjectEngine';
import { GitEngine } from './engine/GitEngine';
import { GitApiAdapter } from './engine/GitApiAdapter';
import { BlogGenerationEngine } from './engine/BlogGenerationEngine';
import { BlogmarkTransformService } from './engine/BlogmarkTransformService';
import { PublishEngine } from './engine/PublishEngine';
import { MetadataDiffEngine } from './engine/MetadataDiffEngine';
import { MCPServer } from './engine/MCPServer';
import { taskManager } from './engine/TaskManager';
import { BlogmarkPythonWorkerRuntime } from './engine/BlogmarkPythonWorkerRuntime';
import { PythonMacroWorkerRuntime } from './engine/PythonMacroWorkerRuntime';
import { AppApiAdapter } from './engine/AppApiAdapter';
import { PublishApiAdapter } from './engine/PublishApiAdapter';
import { EmbeddingEngine } from './engine/EmbeddingEngine';
import { NoopNotifier } from './engine/CliNotifier';
import { NotificationWatcher } from './engine/NotificationWatcher';
import { setEngineBundle } from './engine/mainProcessPythonApiInvoker';
import type { EngineBundle } from './engine/EngineBundle';
import { PreviewServer } from './engine/PreviewServer';
import { APP_MENU_ACTION_EVENT_MAP, APP_MENU_GROUPS, APP_MENU_ITEM_IDS, type AppMenuAction, type AppMenuItemDefinition } from './shared/menuCommands';
import { resolveUiLanguageFromSystemLocale, translateMenu } from './shared/i18n';
import { buildBlogmarkMarkdownLink, extractBlogmarkPayloadFromDeepLink, normalizeBlogmarkCategory } from './shared/blogmark';

let mainWindow: BrowserWindow | null = null;
let previewServer: PreviewServer | null = null;
let notificationWatcher: NotificationWatcher | null = null;
let activePreviewPostId: string | null = null;
let appInitialized = false;
let bundle: EngineBundle | null = null;

function buildPreviewServerDeps() {
  const b = bundle!;
  return {
    postEngine: b.postEngine,
    mediaEngine: b.mediaEngine,
    postMediaEngine: b.postMediaEngine,
    settingsEngine: b.metaEngine,
    menuEngine: b.menuEngine,
    getActiveProjectContext: async () => {
      const project = await b.projectEngine.getActiveProject();
      if (!project) throw new Error('No active project');
      const dataDir = b.projectEngine.getDataDir(project.id, project.dataPath);
      return { projectId: project.id, dataDir, projectName: project.name };
    },
  };
}
let blogmarkQueue: string[] = [];
let blogmarkQueueProcessing = false;
let pendingBlogmarkCreatedEvents: unknown[] = [];
let rendererReady = false;
const PREVIEW_SERVER_PORT = 4123;
const MCP_SERVER_PORT = 4124;
const BLOG_PREVIEW_POST_MENU_ID = APP_MENU_ITEM_IDS.previewPost;
const BLOGMARK_PROTOCOL = 'bds';
const BLOGMARK_NEW_POST_PREFIX = `${BLOGMARK_PROTOCOL}://new-post`;
const WINDOW_MIN_WIDTH = 800;
const WINDOW_MIN_HEIGHT = 600;
const WINDOW_DEFAULT_WIDTH = 1400;
const WINDOW_DEFAULT_HEIGHT = 900;
const WINDOW_STATE_FILE_NAME = 'window-state.json';

interface PersistedWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Check if dev server is likely running (only in development)
const isDev = process.env.NODE_ENV === 'development';

function toggleDetachedDevTools(targetWindow: BrowserWindow | null): void {
  const webContents = targetWindow?.webContents;
  if (!webContents) {
    return;
  }

  if (webContents.isDevToolsOpened()) {
    webContents.closeDevTools();
    return;
  }

  webContents.openDevTools({ mode: 'detach' });
}

function getWindowStatePath(): string | null {
  if (typeof app.getPath !== 'function') {
    return null;
  }

  return path.join(app.getPath('userData'), WINDOW_STATE_FILE_NAME);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parsePersistedWindowState(raw: unknown): PersistedWindowState | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const state = raw as Partial<PersistedWindowState>;
  if (!isFiniteNumber(state.x) || !isFiniteNumber(state.y) || !isFiniteNumber(state.width) || !isFiniteNumber(state.height)) {
    return null;
  }

  if (state.width <= 0 || state.height <= 0) {
    return null;
  }

  return {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
  };
}

function readPersistedWindowState(): PersistedWindowState | null {
  const windowStatePath = getWindowStatePath();
  if (!windowStatePath || !fs.existsSync(windowStatePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(windowStatePath, 'utf8');
    const parsed = JSON.parse(content);
    return parsePersistedWindowState(parsed);
  } catch {
    return null;
  }
}

function writePersistedWindowState(state: PersistedWindowState): void {
  const windowStatePath = getWindowStatePath();
  if (!windowStatePath) {
    return;
  }

  try {
    fs.writeFileSync(windowStatePath, JSON.stringify(state), 'utf8');
  } catch {
    // best effort persistence, ignore write errors
  }
}

function getWorkAreaForState(state: PersistedWindowState): Rectangle {
  if (screen && typeof screen.getDisplayMatching === 'function') {
    const matchingDisplay = screen.getDisplayMatching({
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
    });

    if (matchingDisplay?.workArea) {
      return matchingDisplay.workArea;
    }
  }

  return {
    x: 0,
    y: 0,
    width: WINDOW_DEFAULT_WIDTH,
    height: WINDOW_DEFAULT_HEIGHT,
  };
}

function clampWindowStateToWorkArea(state: PersistedWindowState, workArea: Rectangle): PersistedWindowState {
  const width = Math.max(WINDOW_MIN_WIDTH, Math.min(state.width, workArea.width));
  const height = Math.max(WINDOW_MIN_HEIGHT, Math.min(state.height, workArea.height));

  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;

  return {
    x: Math.min(Math.max(state.x, workArea.x), maxX),
    y: Math.min(Math.max(state.y, workArea.y), maxY),
    width,
    height,
  };
}

function resolveInitialWindowState(): PersistedWindowState {
  const persistedState = readPersistedWindowState();
  if (!persistedState) {
    return {
      x: 0,
      y: 0,
      width: WINDOW_DEFAULT_WIDTH,
      height: WINDOW_DEFAULT_HEIGHT,
    };
  }

  const workArea = getWorkAreaForState(persistedState);
  return clampWindowStateToWorkArea(persistedState, workArea);
}

function persistMainWindowState(windowToPersist: BrowserWindow): void {
  if (typeof windowToPersist.isFullScreen === 'function' && windowToPersist.isFullScreen()) {
    return;
  }

  let bounds = windowToPersist.getBounds();
  if (typeof windowToPersist.isMaximized === 'function' && windowToPersist.isMaximized() && typeof windowToPersist.getNormalBounds === 'function') {
    bounds = windowToPersist.getNormalBounds();
  }

  writePersistedWindowState({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
}

// Register custom protocol scheme as privileged (must be done before app is ready)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'bds-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: 'bds-thumb',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function createWindow(): void {
  rendererReady = false;
  const isMac = process.platform === 'darwin';
  const initialWindowState = resolveInitialWindowState();
  mainWindow = new BrowserWindow({
    x: initialWindowState.x,
    y: initialWindowState.y,
    width: initialWindowState.width,
    height: initialWindowState.height,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    title: 'Blogging Desktop Server',
    backgroundColor: '#1e1e1e', // VS Code dark background
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? {}
      : {
          titleBarOverlay: {
            color: '#252526',
            symbolColor: '#cccccc',
            height: 34,
          },
          autoHideMenuBar: false,
        }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      devTools: true,
    },
    icon: path.join(__dirname, '../../assets/icon.png'),
  });

  // Set up the application menu
  const menu = createApplicationMenu();
  Menu.setApplicationMenu(menu);

  // Register keyboard shortcuts for DevTools via before-input-event (more reliable)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // F12 or Ctrl+Shift+I to toggle DevTools
    if (input.key === 'F12' || 
        (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      toggleDetachedDevTools(mainWindow);
      event.preventDefault();
    }
  });

  // Load the app - use built files unless explicitly in dev mode
  const rendererPath = path.join(__dirname, '../renderer/index.html');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else if (fs.existsSync(rendererPath)) {
    mainWindow.loadFile(rendererPath);
  } else {
    // Fallback to dev server if built files don't exist
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Forward events to renderer
  // Note: ipcMain.emit() (used by forwardEvent in handlers) is a raw EventEmitter emit,
  // so the first arg is NOT an IpcMainEvent — it's the event name string directly.
  ipcMain.on('forward-to-renderer', (eventNameOrEvent: any, ...args: unknown[]) => {
    // When called via ipcMain.emit(), first arg is the channel string directly
    const eventName: string = typeof eventNameOrEvent === 'string'
      ? eventNameOrEvent
      : args.shift() as string;
    if (mainWindow && !mainWindow.isDestroyed() && typeof eventName === 'string') {
      mainWindow.webContents.send(eventName, ...args);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', () => {
    if (mainWindow) {
      persistMainWindowState(mainWindow);
    }
  });
}

async function openPreviewInBrowser(): Promise<void> {
  if (!previewServer) {
    previewServer = new PreviewServer(buildPreviewServerDeps());
  }

  await previewServer.start(PREVIEW_SERVER_PORT);
  await shell.openExternal(`${previewServer.getBaseUrl()}/`);
}

function buildCanonicalPostPath(createdAt: Date, slug: string): string {
  const year = createdAt.getFullYear();
  const month = String(createdAt.getMonth() + 1).padStart(2, '0');
  const day = String(createdAt.getDate()).padStart(2, '0');
  return `/${year}/${month}/${day}/${slug}`;
}

function setPreviewPostMenuEnabled(enabled: boolean): void {
  const appMenu = Menu.getApplicationMenu();
  const previewPostMenuItem = appMenu?.getMenuItemById(BLOG_PREVIEW_POST_MENU_ID);
  if (previewPostMenuItem) {
    previewPostMenuItem.enabled = enabled;
  }
}

async function openActivePostPreviewInBrowser(): Promise<void> {
  if (!activePreviewPostId) {
    return;
  }

  const postEngine = bundle!.postEngine;
  const post = await postEngine.getPost(activePreviewPostId);
  if (!post) {
    setPreviewPostMenuEnabled(false);
    return;
  }

  if (!previewServer) {
    previewServer = new PreviewServer(buildPreviewServerDeps());
  }

  await previewServer.start(PREVIEW_SERVER_PORT);
  const canonicalPath = buildCanonicalPostPath(post.createdAt, post.slug);
  await shell.openExternal(`${previewServer.getBaseUrl()}${canonicalPath}`);
}

async function startPreviewServerOnAppStart(): Promise<void> {
  if (!previewServer) {
    previewServer = new PreviewServer(buildPreviewServerDeps());
  }

  await previewServer.start(PREVIEW_SERVER_PORT);
}

function extractBlogmarkDeepLinks(argv: string[]): string[] {
  return argv.filter((argument) => typeof argument === 'string' && argument.startsWith(BLOGMARK_NEW_POST_PREFIX));
}

function enqueueBlogmarkDeepLink(rawDeepLink: string): void {
  if (rawDeepLink.startsWith(BLOGMARK_NEW_POST_PREFIX)) {
    blogmarkQueue.push(rawDeepLink);
  }
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (typeof mainWindow.isMinimized === 'function' && mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (typeof mainWindow.focus === 'function') {
    mainWindow.focus();
  }
}

async function processBlogmarkDeepLink(rawDeepLink: string): Promise<void> {
  const payload = extractBlogmarkPayloadFromDeepLink(rawDeepLink);
  if (!payload) {
    return;
  }

  const metadata = await bundle!.metaEngine.getProjectMetadata();
  const preferredCategory = normalizeBlogmarkCategory((metadata as { blogmarkCategory?: unknown } | null)?.blogmarkCategory);

  const transformService = bundle!.blogmarkTransformService;
  const transformResult = await transformService.applyTransforms({
    post: {
      title: payload.title,
      content: buildBlogmarkMarkdownLink(payload.title, payload.url),
      tags: [],
      categories: preferredCategory ? [preferredCategory] : [],
    },
    context: {
      source: 'blogmark',
      url: payload.url,
    },
  });

  const createdPost = await bundle!.postEngine.createPost({
    title: transformResult.post.title,
    content: transformResult.post.content,
    tags: transformResult.post.tags,
    categories: transformResult.post.categories,
  });

  const blogmarkCreatedPayload = {
    post: createdPost,
    transform: {
      appliedScriptIds: transformResult.appliedScriptIds,
      errors: transformResult.errors,
      toasts: transformResult.toasts,
    },
  };

  if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
    mainWindow.webContents.send('blogmark:created', blogmarkCreatedPayload);
  } else {
    pendingBlogmarkCreatedEvents.push(blogmarkCreatedPayload);
  }
}

function flushPendingBlogmarkCreatedEvents(): void {
  if (!rendererReady || !mainWindow || mainWindow.isDestroyed() || pendingBlogmarkCreatedEvents.length === 0) {
    return;
  }

  const queuedEvents = pendingBlogmarkCreatedEvents;
  pendingBlogmarkCreatedEvents = [];
  for (const payload of queuedEvents) {
    mainWindow.webContents.send('blogmark:created', payload);
  }
}

async function processBlogmarkQueue(): Promise<void> {
  if (!appInitialized || blogmarkQueueProcessing || blogmarkQueue.length === 0) {
    return;
  }

  blogmarkQueueProcessing = true;
  try {
    while (blogmarkQueue.length > 0) {
      const rawDeepLink = blogmarkQueue.shift();
      if (!rawDeepLink) {
        continue;
      }

      try {
        await processBlogmarkDeepLink(rawDeepLink);
      } catch (error) {
        console.error('Failed to process blogmark deep link:', error);
      }
    }
  } finally {
    blogmarkQueueProcessing = false;
  }
}

function registerBlogmarkProtocolClient(): void {
  if (typeof app.setAsDefaultProtocolClient === 'function') {
    app.setAsDefaultProtocolClient(BLOGMARK_PROTOCOL);
  }
}

async function initializeActiveProjectContext(): Promise<void> {
  try {
    const projectEngine = bundle!.projectEngine;
    const project = await projectEngine.getActiveProject();

    if (!project) {
      return;
    }

    const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
    const postEngine = bundle!.postEngine as {
      setProjectContext?: (projectId: string, dataDir?: string) => void;
      setSearchLanguage?: (language: string) => void;
      setMainLanguage?: (language: string) => void;
    };
    const mediaEngine = bundle!.mediaEngine as {
      setProjectContext?: (projectId: string, dataDir?: string, internalDir?: string) => void;
      setSearchLanguage?: (language: string) => void;
    };
    const metaEngine = bundle!.metaEngine as {
      setProjectContext?: (projectId: string, dataDir?: string) => void;
      syncOnStartup?: () => Promise<void>;
      getProjectMetadata?: () => Promise<{ mainLanguage?: string } | null>;
    };

    postEngine.setProjectContext?.(project.id, dataDir);
    mediaEngine.setProjectContext?.(project.id, dataDir, dataDir);
    metaEngine.setProjectContext?.(project.id, dataDir);

    const embeddingEngineInstance = bundle!.embeddingEngine;
    await embeddingEngineInstance.setProjectContext(project.id);

    const templateEngine = bundle!.templateEngine as {
      setProjectContext?: (projectId: string, dataDir?: string) => void;
    };
    templateEngine.setProjectContext?.(project.id, dataDir);

    await metaEngine.syncOnStartup?.();

    const metadata = await metaEngine.getProjectMetadata?.();
    if (metadata?.mainLanguage) {
      const { isoToStemmerLanguage } = await import('./engine/stemmer');
      const stemmerLang = isoToStemmerLanguage(metadata.mainLanguage);
      postEngine.setSearchLanguage?.(stemmerLang);
      mediaEngine.setSearchLanguage?.(stemmerLang);
      postEngine.setMainLanguage?.(metadata.mainLanguage);
    }
  } catch (error) {
    console.error('Failed to initialize active project context:', error);
  }
}

function createApplicationMenu(): Menu {
  const systemLocale = typeof app.getLocale === 'function' ? app.getLocale() : 'en';
  const uiLanguage = resolveUiLanguageFromSystemLocale(systemLocale);
  const commandDefinitions = APP_MENU_GROUPS
    .flatMap(group => group.items)
    .filter(item => !item.separator)
    .reduce<Record<string, AppMenuItemDefinition>>((acc, item) => {
      acc[item.action] = item;
      return acc;
    }, {});

  const triggerMenuAction = async (action: AppMenuAction): Promise<void> => {
    if (action === 'quit') {
      app.quit();
      return;
    }

    if (action === 'openInBrowser') {
      await openPreviewInBrowser().catch((error) => {
        console.error('Failed to open preview in browser:', error);
      });
      return;
    }

    if (action === 'openDataFolder') {
      const dbPath = getDatabase().getDbPath();
      void shell.openPath(path.dirname(dbPath));
      return;
    }

    if (action === 'previewPost') {
      await openActivePostPreviewInBrowser().catch((error) => {
        console.error('Failed to preview active post in browser:', error);
      });
      return;
    }

    if (action === 'reload') {
      mainWindow?.webContents.reload();
      return;
    }

    if (action === 'forceReload') {
      mainWindow?.webContents.reloadIgnoringCache();
      return;
    }

    if (action === 'resetZoom') {
      mainWindow?.webContents.setZoomLevel(0);
      return;
    }

    if (action === 'zoomIn') {
      if (mainWindow) {
        const zoomLevel = mainWindow.webContents.getZoomLevel();
        mainWindow.webContents.setZoomLevel(zoomLevel + 0.5);
      }
      return;
    }

    if (action === 'zoomOut') {
      if (mainWindow) {
        const zoomLevel = mainWindow.webContents.getZoomLevel();
        mainWindow.webContents.setZoomLevel(zoomLevel - 0.5);
      }
      return;
    }

    if (action === 'toggleFullScreen') {
      if (mainWindow) {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      }
      return;
    }

    if (action === 'toggleDevTools') {
      toggleDetachedDevTools(mainWindow);
      return;
    }

    if (action === 'viewOnGitHub') {
      void shell.openExternal('https://github.com/rfc1437/bDS');
      return;
    }

    if (action === 'reportIssue') {
      void shell.openExternal('https://github.com/rfc1437/bDS/issues');
      return;
    }

    if (action === 'rebuildEmbeddingIndex') {
      startRebuildEmbeddingIndexTask(bundle!);
      return;
    }

    const channel = APP_MENU_ACTION_EVENT_MAP[action];
    if (channel) {
      mainWindow?.webContents.send(channel);
    }
  };

  const getMenuItemLabel = (action: AppMenuAction, fallback: string): string => {
    return translateMenu(uiLanguage, `menu.item.${action}`) || fallback;
  };

  const getMenuGroupLabel = (groupLabel: string): string => {
    return translateMenu(uiLanguage, `menu.group.${groupLabel.toLowerCase()}`) || groupLabel;
  };

  const buildSharedMenuItem = (action: AppMenuAction): MenuItemConstructorOptions => {
    const definition = commandDefinitions[action];
    if (!definition) {
      throw new Error(`Unknown shared menu action: ${action}`);
    }

    const translatedLabel = getMenuItemLabel(action, definition.label);

    if (definition.role) {
      return {
        label: translatedLabel,
        role: definition.role,
        accelerator: definition.accelerator,
      };
    }

    const item: MenuItemConstructorOptions = {
      label: translatedLabel,
      click: async () => {
        await triggerMenuAction(action);
      },
    };
    if (definition.accelerator) item.accelerator = definition.accelerator;
    if (definition.id) item.id = definition.id;
    if (definition.enabled !== undefined) item.enabled = definition.enabled;
    return item;
  };

  const buildSharedGroupMenuItems = (groupLabel: string): MenuItemConstructorOptions[] => {
    const group = APP_MENU_GROUPS.find(item => item.label === groupLabel);
    if (!group) {
      return [];
    }

    const filteredItems = group.items.filter(item => isDev || item.action !== 'toggleDevTools');

    return filteredItems.map((item) => {
      if (item.separator) {
        return { type: 'separator' };
      }

      return buildSharedMenuItem(item.action as AppMenuAction);
    });
  };

  const template: MenuItemConstructorOptions[] = [
    {
      label: getMenuGroupLabel('File'),
      submenu: buildSharedGroupMenuItems('File'),
    },
    {
      label: getMenuGroupLabel('Edit'),
      submenu: buildSharedGroupMenuItems('Edit'),
    },
    {
      label: getMenuGroupLabel('View'),
      submenu: buildSharedGroupMenuItems('View'),
    },
    {
      label: getMenuGroupLabel('Blog'),
      submenu: buildSharedGroupMenuItems('Blog'),
    },
    {
      label: getMenuGroupLabel('Help'),
      submenu: buildSharedGroupMenuItems('Help'),
    },
  ];

  // macOS specific menu adjustments
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  return Menu.buildFromTemplate(template);
}

async function initialize(): Promise<void> {
  // Register IPC handlers immediately (synchronous) so they are available
  // before any async work. This eliminates race conditions where the renderer
  // calls handlers before the database is ready.
  registerIpcHandlers(bundle!);

  // Initialize database
  const db = getDatabase();
  await db.initializeLocal();

  // Now that the database is ready, register event forwarding from engines
  // to the renderer (engines need DB access at registration time).
  registerEventForwarding(bundle!);

  // Register custom protocol for serving media files
  // URLs like bds-media://media-id will be resolved to the actual file
  protocol.handle('bds-media', async (request) => {
    try {
      const url = new URL(request.url);
      const mediaIdentifier = url.hostname; // bds-media://media-id or bds-media://filename.jpg
      
      const database = getDatabase().getLocal();
      
      // First, try to find by ID (most common case)
      let mediaItem = await database
        .select()
        .from(media)
        .where(eq(media.id, mediaIdentifier))
        .get();
      
      // If not found by ID, try by filename
      if (!mediaItem) {
        mediaItem = await database
          .select()
          .from(media)
          .where(eq(media.filename, mediaIdentifier))
          .get();
      }
      
      // If still not found, try by original name
      if (!mediaItem) {
        mediaItem = await database
          .select()
          .from(media)
          .where(eq(media.originalName, mediaIdentifier))
          .get();
      }
      
      if (mediaItem && mediaItem.filePath) {
        // Check if file exists before attempting to fetch
        if (!fs.existsSync(mediaItem.filePath)) {
          console.error(`[bds-media] File not found at path: ${mediaItem.filePath} (media id: ${mediaIdentifier})`);
          return new Response(`Media file not found at: ${mediaItem.filePath}`, { status: 404 });
        }
        // Use net.fetch to get the file - this handles the file protocol properly
        return net.fetch(`file://${mediaItem.filePath}`);
      }
      
      // Return a 404 response if media not found
      console.error(`[bds-media] No media record found for identifier: ${mediaIdentifier}`);
      return new Response('Media not found in database', { status: 404 });
    } catch (error) {
      console.error('[bds-media] Error serving media:', error);
      return new Response('Internal server error', { status: 500 });
    }
  });

  // Register custom protocol for serving thumbnail images
  // URLs like bds-thumb://media-id will serve the small thumbnail webp
  protocol.handle('bds-thumb', async (request) => {
    try {
      const url = new URL(request.url);
      const mediaId = url.hostname;

      const engine = bundle!.mediaEngine;
      const thumbnails = await engine.getThumbnailPaths(mediaId);

      if (thumbnails.small) {
        // Check if thumbnail file exists
        if (!fs.existsSync(thumbnails.small)) {
          console.error(`[bds-thumb] Thumbnail not found at path: ${thumbnails.small} (media id: ${mediaId})`);
          // Fall through to try full image
        } else {
          return net.fetch(`file://${thumbnails.small}`);
        }
      }

      // Fallback to full image if thumbnail doesn't exist
      const database = getDatabase().getLocal();
      const mediaItem = await database
        .select()
        .from(media)
        .where(eq(media.id, mediaId))
        .get();

      if (mediaItem && mediaItem.filePath) {
        // Check if file exists before attempting to fetch
        if (!fs.existsSync(mediaItem.filePath)) {
          console.error(`[bds-thumb] Media file not found at path: ${mediaItem.filePath} (media id: ${mediaId})`);
          return new Response(`Media file not found at: ${mediaItem.filePath}`, { status: 404 });
        }
        return net.fetch(`file://${mediaItem.filePath}`);
      }

      console.error(`[bds-thumb] No media record found for id: ${mediaId}`);
      return new Response('Thumbnail not found', { status: 404 });
    } catch (error) {
      console.error('[bds-thumb] Error serving thumbnail:', error);
      return new Response('Internal server error', { status: 500 });
    }
  });

  ipcMain.handle('app:setPreviewPostTarget', async (_, postId: string | null) => {
    activePreviewPostId = typeof postId === 'string' && postId.length > 0 ? postId : null;
    setPreviewPostMenuEnabled(Boolean(activePreviewPostId));
  });

  ipcMain.handle('app:rendererReady', async () => {
    rendererReady = true;
    flushPendingBlogmarkCreatedEvents();
    return true;
  });
  
  // Initialize and register chat handlers
  initializeChatHandlers(() => mainWindow, bundle!);
  registerChatHandlers();
}

const hasSingleInstanceLock = typeof app.requestSingleInstanceLock !== 'function'
  ? true
  : app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', (_event, argv) => {
  focusMainWindow();
  const deepLinks = extractBlogmarkDeepLinks(argv);
  for (const deepLink of deepLinks) {
    enqueueBlogmarkDeepLink(deepLink);
  }
  void processBlogmarkQueue();
});

app.on('open-url', (event, deepLink) => {
  event.preventDefault();
  enqueueBlogmarkDeepLink(deepLink);
  focusMainWindow();
  void processBlogmarkQueue();
});

// App lifecycle
app.whenReady().then(async () => {
  // Initialise the database before constructing any engines.
  const userData = app.getPath('userData');
  const migrationsFolder = app.isPackaged
    ? path.join(process.resourcesPath, 'drizzle')
    : path.join(__dirname, '..', '..', 'drizzle');
  const db = initDatabase({ dbPath: path.join(userData, 'bds.db'), migrationsFolder });
  await db.initializeLocal();

  // Construct all engines and build EngineBundle before any initialization
  const noopNotifier = new NoopNotifier();
  const projectEngine = new ProjectEngine();
  const metaEngine = new MetaEngine();
  const menuEngine = new MenuEngine();
  const mediaEngine = new MediaEngine(noopNotifier);
  const postEngine = new PostEngine({ notifier: noopNotifier, mediaEngine });
  const postMediaEngine = new PostMediaEngine(mediaEngine);
  const tagEngine = new TagEngine(postEngine);
  const scriptEngine = new ScriptEngine(noopNotifier);
  const templateEngine = new TemplateEngine(noopNotifier);
  const metadataDiffEngine = new MetadataDiffEngine(postEngine, mediaEngine, scriptEngine, templateEngine);
  const publishEngine = new PublishEngine();
  const gitEngine = new GitEngine();
  const gitApiAdapter = new GitApiAdapter(gitEngine, projectEngine);
  const blogGenerationEngine = new BlogGenerationEngine(postEngine, mediaEngine, postMediaEngine);
  const blogmarkPythonWorkerRuntime = new BlogmarkPythonWorkerRuntime();
  const pythonMacroWorkerRuntime = new PythonMacroWorkerRuntime();
  const blogmarkTransformService = new BlogmarkTransformService({ scriptEngine, metaEngine, blogmarkWorkerRuntime: blogmarkPythonWorkerRuntime });
  const embeddingEngine = new EmbeddingEngine({
    getIndexPath: (projectId: string) =>
      path.join(userData, 'projects', projectId, 'embeddings.usearch'),
    modelCacheDir: path.join(userData, 'model-cache'),
  });
  const appApiAdapter = new AppApiAdapter(projectEngine);
  const publishApiAdapter = new PublishApiAdapter(projectEngine, publishEngine, taskManager);
  const mcpServer = new MCPServer({
    postEngine,
    mediaEngine,
    scriptEngine,
    templateEngine,
    metaEngine,
    postMediaEngine,
    tagEngine,
  });
  bundle = {
    postEngine,
    mediaEngine,
    scriptEngine,
    templateEngine,
    metaEngine,
    menuEngine,
    tagEngine,
    postMediaEngine,
    projectEngine,
    gitEngine,
    gitApiAdapter,
    blogGenerationEngine,
    publishEngine,
    metadataDiffEngine,
    taskManager,
    blogmarkTransformService,
    mcpServer,
    blogmarkPythonWorkerRuntime,
    pythonMacroWorkerRuntime,
    publishApiAdapter,
    appApiAdapter,
    embeddingEngine,
  };
  setEngineBundle(bundle);

  await initialize();
  const activeProjectContextReady = initializeActiveProjectContext();
  registerBlogmarkProtocolClient();
  try {
    await startPreviewServerOnAppStart();
  } catch (error) {
    console.error('Failed to start preview server on app startup:', error);
  }
  try {
    await mcpServer.start(MCP_SERVER_PORT);
  } catch (error) {
    console.error('Failed to start MCP server on app startup:', error);
  }
  createWindow();

  // Start NotificationWatcher after window is created (watcher needs mainWindow).
  if (mainWindow) {
    const db = getDatabase();
    notificationWatcher = new NotificationWatcher(
      db.getDbPath(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.getLocal() as any,
      {
        post: bundle.postEngine,
        media: bundle.mediaEngine,
        script: bundle.scriptEngine,
        template: bundle.templateEngine,
      },
      mainWindow,
    );
    notificationWatcher.start();
  }

  await activeProjectContextReady;
  appInitialized = true;

  // If semantic similarity was already enabled when the app started, kick off indexing.
  if (bundle) {
    const startupBundle = bundle;
    startupBundle.metaEngine.getProjectMetadata().then((metadata) => {
      if (metadata?.semanticSimilarityEnabled === true) {
        startEmbeddingIndexTask(startupBundle);
      }
    }).catch(() => {});
  }

  const startupDeepLinks = extractBlogmarkDeepLinks(process.argv);
  for (const deepLink of startupDeepLinks) {
    enqueueBlogmarkDeepLink(deepLink);
  }
  await processBlogmarkQueue();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  // Stop the notification watcher first to avoid processing events during shutdown.
  notificationWatcher?.stop();
  notificationWatcher = null;

  // Cleanup chat resources
  await cleanupChatHandlers();

  if (previewServer) {
    await previewServer.stop();
    previewServer = null;
  }

  try {
    await bundle?.mcpServer.cleanup();
  } catch (error) {
    console.error('Failed to cleanup MCP server:', error);
  }

  try {
    await bundle?.embeddingEngine.shutdown();
  } catch (error) {
    console.error('Failed to shutdown embedding engine:', error);
  }

  const db = getDatabase();
  await db.close();
});

// Handle any uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
