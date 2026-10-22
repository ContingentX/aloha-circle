const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kiosk', {
  askReasoner: (prompt) => ipcRenderer.invoke('reasoning:ask', prompt),
  judgeGesture: (imageDataUrl, prompt) =>
    ipcRenderer.invoke('cosmos:judge', imageDataUrl, prompt),
  describeScene: (imageDataUrl, prompt) =>
    ipcRenderer.invoke('cosmos:describe', imageDataUrl, prompt),
  analyzeBrands: (imageDataUrl) => ipcRenderer.invoke('brands:analyze', imageDataUrl),
  saveRecording: (buffer, meta) => ipcRenderer.invoke('recording:save', buffer, meta),
  onPowerResume: (cb) => ipcRenderer.on('power:resume', () => cb()),
  queueRecap: (videoPath, meta) => ipcRenderer.invoke('recap:generate', videoPath, meta),
  // The sandboxed renderer has no process.env — pose backend selection crosses here.
  roboflowInferUrl: process.env.ROBOFLOW_INFER_URL || null,
});
