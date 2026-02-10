import { app, BrowserWindow, Menu, MenuItemConstructorOptions, ipcMain, protocol, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { getDatabase } from './database';
import { registerIpcHandlers } from './ipc';
import { media } from './database/schema';
import { eq } from 'drizzle-orm';

let mainWindow: BrowserWindow | null = null;

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
]);

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Blogging Desktop Server',
    backgroundColor: '#1e1e1e', // VS Code dark background
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    icon: path.join(__dirname, '../../assets/icon.png'),
  });

  // Set up the application menu
  const menu = createApplicationMenu();
  Menu.setApplicationMenu(menu);

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

function createApplicationMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Post',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow?.webContents.send('menu:newPost');
          },
        },
        {
          label: 'Import Media...',
          accelerator: 'CmdOrCtrl+I',
          click: () => {
            mainWindow?.webContents.send('menu:importMedia');
          },
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            mainWindow?.webContents.send('menu:save');
          },
        },
        { type: 'separator' },
        {
          label: 'Open Data Folder',
          click: async () => {
            const { shell } = require('electron');
            const paths = getDatabase().getDataPaths();
            shell.openPath(path.dirname(paths.database));
          },
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            mainWindow?.webContents.send('menu:find');
          },
        },
        {
          label: 'Replace',
          accelerator: 'CmdOrCtrl+H',
          click: () => {
            mainWindow?.webContents.send('menu:replace');
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Posts',
          accelerator: 'CmdOrCtrl+1',
          click: () => {
            mainWindow?.webContents.send('menu:viewPosts');
          },
        },
        {
          label: 'Media',
          accelerator: 'CmdOrCtrl+2',
          click: () => {
            mainWindow?.webContents.send('menu:viewMedia');
          },
        },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            mainWindow?.webContents.send('menu:toggleSidebar');
          },
        },
        {
          label: 'Toggle Panel',
          accelerator: 'CmdOrCtrl+J',
          click: () => {
            mainWindow?.webContents.send('menu:togglePanel');
          },
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Blog',
      submenu: [
        {
          label: 'Publish Selected',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => {
            mainWindow?.webContents.send('menu:publishSelected');
          },
        },
        { type: 'separator' },
        {
          label: 'Preview Post',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: () => {
            mainWindow?.webContents.send('menu:previewPost');
          },
        },
        { type: 'separator' },
        {
          label: 'Rebuild Database from Files',
          click: () => {
            mainWindow?.webContents.send('menu:rebuildDatabase');
          },
        },
      ],
    },
    {
      label: 'Sync',
      submenu: [
        {
          label: 'Sync Now',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            mainWindow?.webContents.send('menu:syncNow');
          },
        },
        {
          label: 'Push Changes',
          click: () => {
            mainWindow?.webContents.send('menu:pushChanges');
          },
        },
        {
          label: 'Pull Changes',
          click: () => {
            mainWindow?.webContents.send('menu:pullChanges');
          },
        },
        { type: 'separator' },
        {
          label: 'Configure Sync...',
          click: () => {
            mainWindow?.webContents.send('menu:configureSync');
          },
        },
        {
          label: 'View Sync Log',
          click: () => {
            mainWindow?.webContents.send('menu:viewSyncLog');
          },
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Blogging Desktop Server',
          click: () => {
            mainWindow?.webContents.send('menu:about');
          },
        },
        { type: 'separator' },
        {
          label: 'View on GitHub',
          click: async () => {
            const { shell } = require('electron');
            await shell.openExternal('https://github.com/rfc1437/bDS');
          },
        },
        {
          label: 'Report Issue',
          click: async () => {
            const { shell } = require('electron');
            await shell.openExternal('https://github.com/rfc1437/bDS/issues');
          },
        },
      ],
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
        // Use net.fetch to get the file - this handles the file protocol properly
        return net.fetch(`file://${mediaItem.filePath}`);
      }
      
      // Return a 404 response if media not found
      return new Response('Media not found', { status: 404 });
    } catch (error) {
      console.error('Error serving media:', error);
      return new Response('Internal server error', { status: 500 });
    }
  });

  // Register IPC handlers
  registerIpcHandlers();
}

// App lifecycle
app.whenReady().then(async () => {
  await initialize();
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
