const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'media', 'volume', 'system', 'clips', 'clip:captured', 'notify', 'charging',
  'demo', 'escape', 'pointer', 'pin', 'settings', 'fullscreen', 'appBelow',
  'snippets', 'snippet:used', 'editor:blur',
]);

contextBridge.exposeInMainWorld('island', {
  init: () => ipcRenderer.invoke('init'),
  setInteractive: (value) => ipcRenderer.send('interactive', !!value),
  setExpanded: (value) => ipcRenderer.send('expanded', !!value),
  unpin: () => ipcRenderer.send('unpin'),
  media: (cmd) => ipcRenderer.send('media:cmd', cmd),
  copyClip: (id) => ipcRenderer.invoke('clip:copy', id),
  clearClips: () => ipcRenderer.send('clip:clear'),
  saveSnippet: (data) => ipcRenderer.invoke('snippet:save', data),
  deleteSnippet: (id) => ipcRenderer.invoke('snippet:delete', id),
  useSnippet: (id) => ipcRenderer.invoke('snippet:use', id),
  snippetFromClip: (clipId) => ipcRenderer.invoke('snippet:fromClip', clipId),
  setEditing: (value) => ipcRenderer.send('editing', !!value),
  on: (channel, handler) => {
    if (!CHANNELS.has(channel)) return;
    ipcRenderer.on(channel, (_event, payload) => handler(payload));
  },
});
