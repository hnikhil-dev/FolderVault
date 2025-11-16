// preload.js - exposes a small, safe API to the renderer via contextBridge
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vault', {
    chooseFolder: async () => {
        return await ipcRenderer.invoke('choose-folder');
    },
    encryptFolder: async (folder, password, options) => {
        return await ipcRenderer.invoke('encrypt-folder', { folder, password, options });
    },
    decryptFolder: async (folder, password, options) => {
        return await ipcRenderer.invoke('decrypt-folder', { folder, password, options });
    },
    onLog: (callback) => {
        const listener = (event, message) => callback(message);
        ipcRenderer.on('vault-log', listener);
        return () => ipcRenderer.removeListener('vault-log', listener);
    }
    ,
    // one-shot log listener (useful for single messages)
    onLogOnce: (callback) => {
        const onceListener = (event, message) => callback(message);
        ipcRenderer.once('vault-log', onceListener);
        return () => ipcRenderer.removeListener('vault-log', onceListener);
    },
    onProgress: (callback) => {
        const listener = (event, data) => callback(data);
        ipcRenderer.on('vault-progress', listener);
        return () => ipcRenderer.removeListener('vault-progress', listener);
    },
    // one-shot progress listener
    onProgressOnce: (callback) => {
        const onceListener = (event, data) => callback(data);
        ipcRenderer.once('vault-progress', onceListener);
        return () => ipcRenderer.removeListener('vault-progress', onceListener);
    },
    openAppFolder: async () => {
        return await ipcRenderer.invoke('open-app-folder');
    }
    ,
    showConfirm: async (title, message) => {
        return await ipcRenderer.invoke('show-confirm', { title, message });
    },
    cancelOperation: async () => {
        return await ipcRenderer.invoke('cancel-operation');
    }
});
