const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // App data communication
  toggleTracking: () => ipcRenderer.send('toggle-tracking'),
  onUpdateData: (callback) => ipcRenderer.on('update-data', (_event, data) => callback(data)),

  // --- NEW: EXPOSE WINDOW ACTIONS ---
  window: {
    minimize: () => ipcRenderer.send('minimize-window'),
    maximize: () => ipcRenderer.send('maximize-window'),
    close: () => ipcRenderer.send('close-window'),
  },
});
