const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kiosk', {
  askReasoner: (prompt) => ipcRenderer.invoke('reasoning:ask', prompt),
  judgeGesture: (imageDataUrl, prompt) =>
    ipcRenderer.invoke('cosmos:judge', imageDataUrl, prompt),
  describeScene: (imageDataUrl, prompt) =>
    ipcRenderer.invoke('cosmos:describe', imageDataUrl, prompt),
  saveRecording: (buffer, meta) => ipcRenderer.invoke('recording:save', buffer, meta),
  queueRecap: (videoPath, meta) => ipcRenderer.invoke('recap:generate', videoPath, meta),
  // The sandboxed renderer has no process.env — pose backend selection crosses here.
  roboflowInferUrl: process.env.ROBOFLOW_INFER_URL || null,
});
