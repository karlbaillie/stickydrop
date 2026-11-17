const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('load'),
  saveNotes: (n) => ipcRenderer.send('save-notes', n),
  setSettings: (p) => ipcRenderer.invoke('set-settings', p),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  setPinned: (v) => ipcRenderer.send('pinned', v),
  hide: () => ipcRenderer.send('hide'),
  quit: () => ipcRenderer.send('quit'),
  onShow: (cb) => ipcRenderer.on('show', cb),
});
