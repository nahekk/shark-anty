'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The only bridge between the UI and the main process.
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

function on(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('shark', {
  call,
  on: (channel, cb) => {
    const allowed = ['state:running', 'state:changed', 'engine:progress', 'engine:update', 'rpc:status'];
    if (!allowed.includes(channel)) throw new Error('Channel not allowed');
    return on(channel, cb);
  },
  platform: process.platform,
});
