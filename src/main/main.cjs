// ssh4ai - Electron Main Process (Windows 11 Native Client)
const { app, BrowserWindow, ipcMain, clipboard, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./db.cjs');
const sshManager = require('./ssh-manager.cjs');
const api = require('./api.cjs');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0e14',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  // Web Links / terminal links open in the default browser, never inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--test-mode')) {
      console.log('SUCCESS: Window ready-to-show event fired! All Main and Renderer assets loaded.');
      setTimeout(() => {
        app.quit();
      }, 500);
    }
  });

  mainWindow.on('maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximize-changed', true);
    }
  });

  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximize-changed', false);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    sshManager.disconnectAll();
  });
}

// --- IPC HANDLERS ---
// Window Controls
ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  } else {
    mainWindow.maximize();
    return true;
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.handle('window-toggle-zen', () => {
  if (!mainWindow) return false;
  const isZen = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(isZen);
  return isZen;
});

// Database & Host Handlers
ipcMain.handle('db-get-hosts', () => {
  return db.getHosts();
});

ipcMain.handle('db-save-host', (_e, data) => {
  // Key material is only written through the validated /api/devices routes (api.cjs), never straight from the renderer.
  const safe = { ...(data || {}) };
  delete safe.private_key; delete safe.key_passphrase; delete safe.public_key;
  return db.saveHost(safe);
});

ipcMain.handle('db-delete-host', (_e, id) => {
  return db.deleteHost(id);
});

ipcMain.handle('db-reorder-hosts', (_e, orderedIds) => {
  return db.reorderHosts(orderedIds);
});

ipcMain.handle('db-toggle-pin', (_e, id) => {
  return db.togglePin(id);
});

// Macros
ipcMain.handle('db-get-macros', () => {
  return db.getMacros();
});

ipcMain.handle('db-save-macro', (_e, data) => {
  return db.saveMacro(data);
});

// Scratchpad
ipcMain.handle('db-get-scratchpads', () => {
  return db.getScratchpads();
});

ipcMain.handle('db-save-scratchpad', (_e, { bucketIndex, title, content }) => {
  return db.saveScratchpad(bucketIndex, title, content);
});

ipcMain.handle('db-clear-all-scratchpads', () => {
  return db.clearAllScratchpads();
});

// Settings
ipcMain.handle('db-get-settings', () => {
  return db.getSettings();
});

ipcMain.handle('db-save-settings', (_e, settingsMap) => {
  return db.saveSettings(settingsMap);
});

// SSH Engine Handlers
ipcMain.handle('ssh-connect', async (_e, { tabId, hostId, cols, rows }) => {
  try {
    await sshManager.connect(
      tabId,
      hostId,
      cols || 131,
      rows || 46,
      (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ssh-data', { tabId, data });
        }
      },
      (status) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ssh-status', status);
        }
      }
    );
    return { success: true };
  } catch (err) {
    console.error('[SSH] Connect error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ssh-write', (_e, { tabId, data }) => {
  sshManager.write(tabId, data);
  return true;
});

ipcMain.handle('ssh-resize', (_e, { tabId, cols, rows }) => {
  sshManager.resize(tabId, cols, rows);
  return true;
});

ipcMain.handle('ssh-disconnect', (_e, { tabId }) => {
  sshManager.disconnect(tabId);
  return true;
});

ipcMain.handle('ssh-test-ping', async (_e, hostId) => {
  return await sshManager.testPing(hostId);
});

// Web-UI bridge
ipcMain.handle('api-request', (_e, { method, path, body }) => {
  try {
    return api.handle(String(method || 'GET').toUpperCase(), path, body);
  } catch (e) {
    return { status: 500, body: { error: e.message } };
  }
});

ipcMain.handle('ssh-attach', async (_e, { sessionId, cols, rows }) => {
  await api.attach(sessionId, cols, rows, (kind, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(kind === 'data' ? 'ssh-data' : 'ssh-status', payload);
    }
  });
  return true;
});

ipcMain.handle('window-set-fullscreen', (_e, on) => {
  if (mainWindow) mainWindow.setFullScreen(!!on);
  return !!on;
});

ipcMain.handle('clipboard-read', () => clipboard.readText());

// Utilities
ipcMain.handle('clipboard-copy', (_e, text) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('export-log', async (_e, { defaultFilename, content }) => {
  if (!mainWindow) return { success: false };
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Session Log',
    defaultPath: defaultFilename || `session-log-${Date.now()}.txt`,
    filters: [{ name: 'Text Files', extensions: ['txt', 'log'] }]
  });

  if (!canceled && filePath) {
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true, filePath };
  }
  return { success: false, canceled: true };
});

// App Lifecycle
app.whenReady().then(async () => {
  try {
    await db.init();
    console.log('[Main] Database initialized successfully.');
  } catch (err) {
    console.error('[Main] Database initialization error:', err);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
