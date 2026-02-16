const { contextBridge, ipcRenderer } = require('electron');

console.log('preload: initializing inventory context bridge');

contextBridge.exposeInMainWorld('inventory', {
  getServerUrl: () => ipcRenderer.invoke('app:getServerUrl'),
  getLanBaseUrl: () => ipcRenderer.invoke('app:getLanBaseUrl'),
  onTunnelStatusChanged: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('tunnel-status-changed', subscription);
    return () => ipcRenderer.removeListener('tunnel-status-changed', subscription);
  },
  listInventories: () => ipcRenderer.invoke('inventory:list'),
  createInventory: (name) => ipcRenderer.invoke('inventory:create', name),
  setActiveInventory: (id) => ipcRenderer.invoke('inventory:setActive', id)
});

contextBridge.exposeInMainWorld('setup', {
  getConfigDefaults: () => ipcRenderer.invoke('setup:getConfigDefaults'),
  checkExistingCerts: (options) => ipcRenderer.invoke('setup:checkExistingCerts', options),
  selectFile: (options) => ipcRenderer.invoke('setup:selectFile', options),
  validateAndSave: (config) => ipcRenderer.invoke('setup:validateAndSave', config),
  generateCert: (options) => ipcRenderer.invoke('setup:generateCert', options),
  onCertLog: (callback) => {
    const subscription = (event, msg) => callback(msg);
    ipcRenderer.on('setup:log', subscription);
    return () => ipcRenderer.removeListener('setup:log', subscription);
  }
});
