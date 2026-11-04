// ssh4ai - Preload Context Bridge
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nodeOpsApi', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  toggleZen: () => ipcRenderer.invoke('window-toggle-zen'),
  onMaximizeChange: (cb) => {
    ipcRenderer.on('window-maximize-changed', (_e, isMax) => cb(isMax));
  },

  // Host operations
  getHosts: () => ipcRenderer.invoke('db-get-hosts'),
  saveHost: (data) => ipcRenderer.invoke('db-save-host', data),
  deleteHost: (id) => ipcRenderer.invoke('db-delete-host', id),
  reorderHosts: (orderedIds) => ipcRenderer.invoke('db-reorder-hosts', orderedIds),
  togglePin: (id) => ipcRenderer.invoke('db-toggle-pin', id),

  // SSH Session management
  sshConnect: (tabId, hostId, cols, rows) => ipcRenderer.invoke('ssh-connect', { tabId, hostId, cols, rows }),
  sshWrite: (tabId, data) => ipcRenderer.invoke('ssh-write', { tabId, data }),
  sshResize: (tabId, cols, rows) => ipcRenderer.invoke('ssh-resize', { tabId, cols, rows }),
  sshDisconnect: (tabId) => ipcRenderer.invoke('ssh-disconnect', { tabId }),
  testPing: (hostId) => ipcRenderer.invoke('ssh-test-ping', hostId),

  onSSHData: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('ssh-data', listener);
    return () => ipcRenderer.removeListener('ssh-data', listener);
  },

  onSSHStatus: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('ssh-status', listener);
    return () => ipcRenderer.removeListener('ssh-status', listener);
  },

  // Macros operations
  getMacros: () => ipcRenderer.invoke('db-get-macros'),
  saveMacro: (data) => ipcRenderer.invoke('db-save-macro', data),

  // Scratchpad operations
  getScratchpads: () => ipcRenderer.invoke('db-get-scratchpads'),
  saveScratchpad: (bucketIndex, title, content) => ipcRenderer.invoke('db-save-scratchpad', { bucketIndex, title, content }),
  clearAllScratchpads: () => ipcRenderer.invoke('db-clear-all-scratchpads'),

  // Settings operations
  getSettings: () => ipcRenderer.invoke('db-get-settings'),
  saveSettings: (settingsMap) => ipcRenderer.invoke('db-save-settings', settingsMap),

  // Web-UI bridge (REST-style API + session streaming)
  apiRequest: (method, path, body) => ipcRenderer.invoke('api-request', { method, path, body }),
  sshAttach: (sessionId, cols, rows) => ipcRenderer.invoke('ssh-attach', { sessionId, cols, rows }),
  setFullscreen: (on) => ipcRenderer.invoke('window-set-fullscreen', !!on),
  readClipboard: () => ipcRenderer.invoke('clipboard-read'),

  // Utilities
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard-copy', text),
  exportLog: (defaultFilename, content) => ipcRenderer.invoke('export-log', { defaultFilename, content })
});
