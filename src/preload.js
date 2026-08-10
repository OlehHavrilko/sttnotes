const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('notesAPI', {
  list: () => ipcRenderer.invoke('notes:list'),
  save: notes => ipcRenderer.invoke('notes:save', notes),
  history: id => ipcRenderer.invoke('notes:history', id),
  restore: version => ipcRenderer.invoke('notes:restore', version),
  openFile: () => ipcRenderer.invoke('file:open'),
  readText: file => ipcRenderer.invoke('file:readText', file),
  saveAudio: payload => ipcRenderer.invoke('audio:save', payload),
  transcribe: payload => ipcRenderer.invoke('transcribe:run', payload)
  ,chooseModelDirectory: () => ipcRenderer.invoke('models:choose'),
  scanModelDirectory: dir => ipcRenderer.invoke('models:scan', dir)
  ,downloadModel: payload => ipcRenderer.invoke('models:download', payload)
  ,installEngine: () => ipcRenderer.invoke('models:installEngine')
  ,onModelProgress: cb => ipcRenderer.on('models:progress', (_, value) => cb(value))
  ,saveAttachment: payload => ipcRenderer.invoke('attachment:save', payload),
  openAttachment: () => ipcRenderer.invoke('attachment:open'),
  deleteAttachment: file => ipcRenderer.invoke('notes:deleteAttachment', file)
  ,copyAttachment: file => ipcRenderer.invoke('attachment:copy', file)
  ,backups: {
    list: () => ipcRenderer.invoke('backups:list'),
    create: () => ipcRenderer.invoke('backups:create'),
    restore: file => ipcRenderer.invoke('backups:restore', file)
  },
  exportWorkspace: passphrase => ipcRenderer.invoke('workspace:export', passphrase),
  importWorkspace: passphrase => ipcRenderer.invoke('workspace:import', passphrase),
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    run: payload => ipcRenderer.invoke('ai:run', payload)
  }
  ,plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    installZip: () => ipcRenderer.invoke('plugins:chooseInstall'),
    installFolder: () => ipcRenderer.invoke('plugins:chooseFolderInstall'),
    setEnabled: (id, enabled) => ipcRenderer.invoke('plugins:setEnabled', id, !!enabled),
    remove: id => ipcRenderer.invoke('plugins:remove', id),
    state: () => ipcRenderer.invoke('plugins:getState')
  }
});
