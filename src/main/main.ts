import { app, BrowserWindow, Menu, MenuItemConstructorOptions, ipcMain, protocol, net, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { getDatabase } from './database';
import { registerIpcHandlers, registerChatHandlers, initializeChatHandlers, cleanupChatHandlers } from './ipc';
import { media } from './database/schema';
import { eq } from 'drizzle-orm';
import { getMediaEngine } from './engine/MediaEngine';
import { getPostEngine } from './engine/PostEngine';
import { PreviewServer } from './engine/PreviewServer';
import { APP_MENU_ACTION_EVENT_MAP, APP_MENU_GROUPS, APP_MENU_ITEM_IDS, type AppMenuAction, type AppMenuItemDefinition } from './shared/menuCommands';
import { resolveUiLanguageFromSystemLocale, translateMenu } from './shared/i18n';

let mainWindow: BrowserWindow | null = null;
let previewServer: PreviewServer | null = null;
let activePreviewPostId: string | null = null;
const PREVIEW_SERVER_PORT = 4123;
const BLOG_PREVIEW_POST_MENU_ID = APP_MENU_ITEM_IDS.previewPost;

// Check if dev server is likely running (only in development)
const isDev = process.env.NODE_ENV === 'development';

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
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
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
      mainWindow?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Load the app - use built files unless explicitly in dev mode
  const rendererPath = path.join(__dirname, '../renderer/index.html');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else if (fs.existsSync(rendererPath)) {
    mainWindow.loadFile(rendererPath);
  } else {
    // Fallback to dev server if built files don't exist
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
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
}

async function openPreviewInBrowser(): Promise<void> {
  if (!previewServer) {
    previewServer = new PreviewServer();
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

  const postEngine = getPostEngine();
  const post = await postEngine.getPost(activePreviewPostId);
  if (!post) {
    setPreviewPostMenuEnabled(false);
    return;
  }

  if (!previewServer) {
    previewServer = new PreviewServer();
  }

  await previewServer.start(PREVIEW_SERVER_PORT);
  const canonicalPath = buildCanonicalPostPath(post.createdAt, post.slug);
  await shell.openExternal(`${previewServer.getBaseUrl()}${canonicalPath}`);
}

async function startPreviewServerOnAppStart(): Promise<void> {
  if (!previewServer) {
    previewServer = new PreviewServer();
  }

  await previewServer.start(PREVIEW_SERVER_PORT);
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
      const paths = getDatabase().getDataPaths();
      void shell.openPath(path.dirname(paths.database));
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

    if (action === 'viewOnGitHub') {
      void shell.openExternal('https://github.com/rfc1437/bDS');
      return;
    }

    if (action === 'reportIssue') {
      void shell.openExternal('https://github.com/rfc1437/bDS/issues');
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

    return {
      label: translatedLabel,
      accelerator: definition.accelerator,
      id: definition.id,
      enabled: definition.enabled,
      click: async () => {
        await triggerMenuAction(action);
      },
    };
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
  // Initialize database
  const db = getDatabase();
  await db.initializeLocal();

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

      const engine = getMediaEngine();
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

  // Register IPC handlers
  registerIpcHandlers();

  ipcMain.handle('app:setPreviewPostTarget', async (_, postId: string | null) => {
    activePreviewPostId = typeof postId === 'string' && postId.length > 0 ? postId : null;
    setPreviewPostMenuEnabled(Boolean(activePreviewPostId));
  });
  
  // Initialize and register chat handlers
  initializeChatHandlers(() => mainWindow);
  registerChatHandlers();
}

// App lifecycle
app.whenReady().then(async () => {
  await initialize();
  try {
    await startPreviewServerOnAppStart();
  } catch (error) {
    console.error('Failed to start preview server on app startup:', error);
  }
  createWindow();

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
  // Cleanup chat resources
  await cleanupChatHandlers();

  if (previewServer) {
    await previewServer.stop();
    previewServer = null;
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
