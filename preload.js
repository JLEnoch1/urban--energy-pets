'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // 点击穿透:ignore=true 时鼠标事件穿过窗口;forward=true 仍向页面派发 mousemove 供命中测试
  setIgnoreMouse: (ignore, forward) => ipcRenderer.send('ignore-mouse', ignore, forward),
  moveWindow: (x, y) => ipcRenderer.send('move-window', x, y),
  getLayout: () => ipcRenderer.invoke('get-layout'),
  getSkin: () => ipcRenderer.invoke('skins:get'),
  showMenu: () => ipcRenderer.send('show-menu'),
  openAccessibility: () => ipcRenderer.send('open-accessibility'),
  ready: () => ipcRenderer.send('renderer-ready'),
  onKey: (cb) => ipcRenderer.on('key', (_e, d) => cb(d)),
  onCmd: (cb) => ipcRenderer.on('cmd', (_e, d) => cb(d)),
})
