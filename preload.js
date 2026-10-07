'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  savePdf: options => ipcRenderer.invoke('save-pdf', options)
});
