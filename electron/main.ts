import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { initWindowState } from './window-state';
import { startPythonBackend, stopPythonBackend } from './python-bridge';
import { registerIpcHandlers } from './ipc-handlers';
import { decrypt } from './security';

// Prevent Electron main process crash on EPIPE (broken pipe) when stdout/stderr streams are closed by parent
if (process.stdout) {
  process.stdout.on('error', (err: any) => {
    if (err.code === 'EPIPE') {
      // Ignore broken pipe errors
    }
  });
}
if (process.stderr) {
  process.stderr.on('error', (err: any) => {
    if (err.code === 'EPIPE') {
      // Ignore broken pipe errors
    }
  });
}


let mainWindow: BrowserWindow | null = null;
let initialFilePath: string | null = null;
let initialFileContent: string | null = null;

// Handle single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', async (_event, commandLine) => {
    // Someone tried to run a second instance, focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();

      // Handle .bcs template files
      const bcsArg = commandLine.find(arg => arg.endsWith('.bcs'));
      if (bcsArg) {
        try {
          const rawContent = await fs.readFile(bcsArg, 'utf8');
          const content = decrypt(rawContent);
          mainWindow.webContents.send('open-file', bcsArg, content);
        } catch (err) {
          console.error('[Main] Error reading second-instance .bcs file:', err);
        }
      }

      // Handle .bcsc config files
      const bcscArg = commandLine.find(arg => arg.endsWith('.bcsc'));
      if (bcscArg) {
        try {
          const rawContent = await fs.readFile(bcscArg, 'utf8');
          const content = decrypt(rawContent);
          mainWindow.webContents.send('open-config-file', bcscArg, content);
        } catch (err) {
          console.error('[Main] Error reading second-instance .bcsc file:', err);
        }
      }
    }
  });
}

// Extract initial file path if any (.bcs template or .bcsc config)
const bcsArg = process.argv.find(arg => arg.endsWith('.bcs'));
const bcscArg = process.argv.find(arg => arg.endsWith('.bcsc'));
if (bcsArg) {
  initialFilePath = bcsArg;
} else if (bcscArg) {
  initialFilePath = bcscArg;
}

async function createWindow() {
  const windowState = initWindowState('main', 1400, 900);

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    frame: false, // Frameless window
    thickFrame: true, // Auto Aero Snap support on Windows
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  // Register Electron IPC handlers
  registerIpcHandlers(mainWindow);

  // Load React UI
  const isDev = !app.isPackaged;
  if (isDev) {
    // Wait for the dev server to start
    await mainWindow.loadURL('http://127.0.0.1:3000');
    // Open DevTools in dev mode
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
    await mainWindow.loadFile(indexPath);
  }

  // Window state save events
  mainWindow.on('resize', () => windowState.saveState(mainWindow!));
  mainWindow.on('move', () => windowState.saveState(mainWindow!));
  mainWindow.on('close', () => windowState.saveState(mainWindow!));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // If initial file path is found, pre-read the content
  if (initialFilePath) {
    try {
      let content = await fs.readFile(initialFilePath, 'utf8');
      if (initialFilePath.endsWith('.bcs') || initialFilePath.endsWith('.bcsc')) {
        content = decrypt(content);
      }
      initialFileContent = content;
      const isConfig = initialFilePath.endsWith('.bcsc');
      // Send it when webContents is finished loading
      mainWindow.webContents.once('did-finish-load', () => {
        if (isConfig) {
          mainWindow?.webContents.send('open-config-file', initialFilePath!, initialFileContent!);
        } else {
          mainWindow?.webContents.send('open-file', initialFilePath!, initialFileContent!);
        }
      });
    } catch (err) {
      console.error('[Main] Failed to read initial file content:', err);
    }
  }
}

app.whenReady().then(async () => {
  try {
    console.log('[Main] Launching Python backend...');
    await startPythonBackend();
    console.log('[Main] Python backend started successfully. Creating browser window...');
    await createWindow();
  } catch (err) {
    console.error('[Main] Initialization failed:', err);
    // Show user dialog
    const { dialog } = require('electron');
    dialog.showErrorBox(
      'Initialization Error',
      `Failed to launch Barcode Studio: ${err instanceof Error ? err.message : String(err)}`
    );
    app.quit();
  }
});

// Manage initial file query handler
ipcMain.handle('get-initial-file', () => {
  if (initialFilePath && initialFileContent) {
    const pathVal = initialFilePath;
    const contentVal = initialFileContent;
    // Clear once retrieved to prevent double reading
    initialFilePath = null;
    initialFileContent = null;
    return { filePath: pathVal, content: contentVal };
  }
  return null;
});

app.on('window-all-closed', () => {
  stopPythonBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});

app.on('will-quit', () => {
  stopPythonBackend();
});
