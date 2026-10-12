const { contextBridge, ipcRenderer } = require('electron')
const actions = ['state','createTask','updateTask','deleteTask','restoreTask','addLog','saveSettings','backup']
contextBridge.exposeInMainWorld('taskflow', {
  ...Object.fromEntries(actions.map(action => [action, payload => ipcRenderer.invoke('taskflow:request', action, payload)])),
  exportBackup: () => ipcRenderer.invoke('taskflow:export'),
  importBackup: () => ipcRenderer.invoke('taskflow:import'),
  restoreCloud: payload => ipcRenderer.invoke('taskflow:restore-cloud',payload),
  openDataFolder: () => ipcRenderer.invoke('taskflow:data-folder'),
  saveLocalImage: payload =>
    ipcRenderer.invoke('taskflow:image-save', payload),

  readLocalImage: payload =>
    ipcRenderer.invoke('taskflow:image-read', payload),

  deleteLocalImage: payload =>
    ipcRenderer.invoke('taskflow:image-delete', payload),
  signInGoogle: () =>
    ipcRenderer.invoke('taskflow:google-sign-in'),
})
