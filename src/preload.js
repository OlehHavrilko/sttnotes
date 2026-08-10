const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('notesAPI', {
  list: () => ipcRenderer.invoke('notes:list'),
  save: notes => ipcRenderer.invoke('notes:save', notes),
  openFile: () => ipcRenderer.invoke('file:open'),
  readText: file => ipcRenderer.invoke('file:readText', file),
  saveAudio: payload => ipcRenderer.invoke('audio:save', payload),
  transcribe: payload => ipcRenderer.invoke('transcribe:run', payload)
  ,chooseModelDirectory: () => ipcRenderer.invoke('models:choose'),
  scanModelDirectory: dir => ipcRenderer.invoke('models:scan', dir)
  ,saveAttachment: payload => ipcRenderer.invoke('attachment:save', payload),
  openAttachment: () => ipcRenderer.invoke('attachment:open'),
  deleteAttachment: file => ipcRenderer.invoke('notes:deleteAttachment', file)
  ,copyAttachment: file => ipcRenderer.invoke('attachment:copy', file)
});
