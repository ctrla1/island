const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'media', 'volume', 'system', 'clips', 'clip:captured', 'notify', 'charging',
  'demo', 'escape', 'pointer', 'pin', 'settings', 'fullscreen',
]);

contextBridge.exposeInMainWorld('island', {
  init: () => ipcRenderer.invoke('init'),
  setInteractive: (value) => ipcRenderer.send('interactive', !!value),
  setExpanded: (value) => ipcRenderer.send('expanded', !!value),
  unpin: () => ipcRenderer.send('unpin'),
  media: (cmd) => ipcRenderer.send('media:cmd', cmd),
  copyClip: (id) => ipcRenderer.invoke('clip:copy', id),
  clearClips: () => ipcRenderer.send('clip:clear'),
  on: (channel, handler) => {
    if (!CHANNELS.has(channel)) return;
    ipcRenderer.on(channel, (_event, payload) => handler(payload));
  },
});
