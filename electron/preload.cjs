const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  
  // License API
  license: {
    validate: (licenseKey) => ipcRenderer.invoke('license:validate', licenseKey),
    checkCached: () => ipcRenderer.invoke('license:check-cached'),
    clear: () => ipcRenderer.invoke('license:clear'),
    getDeviceId: () => ipcRenderer.invoke('license:get-device-id'),
    // Listen for license revocation while app is running
    onRevoked: (callback) => {
      ipcRenderer.on('license:revoked', (event, reason) => callback(reason));
    },
  },

  // Media Download API
  media: {
    pickFolder: () => ipcRenderer.invoke('media:pick-folder'),
    downloadFile: (url, savePath) => ipcRenderer.invoke('media:download-file', { url, savePath }),
  },
});
