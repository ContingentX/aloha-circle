const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kiosk', {
  askReasoner: (prompt) => ipcRenderer.invoke('reasoning:ask', prompt),
  judgeGesture: (imageDataUrl, prompt) =>
    ipcRenderer.invoke('cosmos:judge', imageDataUrl, prompt),
});
