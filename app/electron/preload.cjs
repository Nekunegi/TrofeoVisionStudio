// Preload script — runs in the sandboxed renderer with access to a limited
// set of Electron APIs. Exposes a minimal contextBridge surface for the
// auto-updater bell button; nothing else. No Node globals leak to the page.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('updater', {
  // Latest snapshot of the main-process updater state machine.
  get: () => ipcRenderer.invoke('updater:get'),
  // Trigger a manual check (auto-check runs on startup + every 6h).
  check: () => ipcRenderer.invoke('updater:check'),
  // Quit and install the downloaded update. Only meaningful when state==='ready'.
  install: () => ipcRenderer.invoke('updater:install'),
  // Subscribe to state changes. Returns an unsubscribe fn.
  onStatus: (cb) => {
    const handler = (_e, s) => cb(s)
    ipcRenderer.on('updater:status', handler)
    return () => ipcRenderer.removeListener('updater:status', handler)
  },
})
