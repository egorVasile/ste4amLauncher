'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = [
  'app:info',
  'settings:get',
  'settings:set',
  'settings:java-search',
  'version:screenshot',
  'versions:list',
  'launch:start',
  'launch:stop',
  'launch:running',
  'modrinth:search',
  'modrinth:project',
  'modrinth:batch-projects',
  'modrinth:versions',
  'modrinth:categories',
  'modrinth:loaders',
  'modrinth:game-versions',
  'builds:list',
  'builds:create',
  'builds:delete',
  'builds:installed',
  'builds:install-mod',
  'builds:delete-mod',
  'mods:java',
  'game:open-dir',
  'shell:open-root',
  'shell:open-mods',
  'shell:open-url',
  'news:fetch',
  'favs:list',
  'favs:add',
  'favs:remove',
  'update:check',
  'update:now'
];

const RECEIVE = [
  'launch:progress',
  'launch:log',
  'launch:error',
  'launch:started',
  'launch:exit',
  'builds:changed',
  'mod:progress',
  'builds:progress'
];

contextBridge.exposeInMainWorld('st4am', {
  invoke: (channel, ...args) => {
    if (!INVOKE.includes(channel)) return Promise.reject(new Error('Bad channel: ' + channel));
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, cb) => {
    if (!RECEIVE.includes(channel)) return () => {};
    const listener = (_e, data) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
