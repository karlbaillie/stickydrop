const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('load'),
  saveNotes: (n) => ipcRenderer.send('save-notes', n),
  saveColumns: (c) => ipcRenderer.send('save-columns', c),
  setSettings: (p) => ipcRenderer.invoke('set-settings', p),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  resizeHeight: (px, commit) => ipcRenderer.invoke('resize-height', px, commit),
  setPinned: (v) => ipcRenderer.send('pinned', v),
  hide: () => ipcRenderer.send('hide'),
  quit: () => ipcRenderer.send('quit'),
  onShow: (cb) => ipcRenderer.on('show', cb),
});
