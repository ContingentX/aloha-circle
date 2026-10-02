const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kiosk', {
  askReasoner: (prompt) => ipcRenderer.invoke('reasoning:ask', prompt),
});
