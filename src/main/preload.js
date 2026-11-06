// 预加载：在 contextIsolation 下向渲染层暴露受控 API
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pianoAPI', {
  // 主进程 -> 渲染层
  onRequestExitPanel: (cb) => ipcRenderer.on('app:request-exit-panel', () => cb()),
  onNotice: (cb) => ipcRenderer.on('app:notice', (_e, data) => cb(data)),

  // 渲染层 -> 主进程
  confirmExit: () => ipcRenderer.send('app:confirm-exit'),

  // 录音持久化（FR-04，userData 目录）
  recordingsList: () => ipcRenderer.invoke('rec:list'),
  recordingSave: (rec) => ipcRenderer.invoke('rec:save', rec),
  recordingLoad: (id) => ipcRenderer.invoke('rec:load', id),
  recordingDelete: (id) => ipcRenderer.invoke('rec:delete', id),

  // P1-1 MIDI 导出
  exportMidi: (payload) => ipcRenderer.invoke('midi:export', payload),

  // 采样目录（打包后 extraResources，file:// 加载）
  getSamplesDir: () => ipcRenderer.invoke('app:get-samples-dir'),
});
