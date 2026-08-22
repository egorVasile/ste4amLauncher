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
  'builds:update-meta',
  'builds:install-modpack',
  'builds:installed',
  'builds:registry',
  'builds:install-mod',
  'builds:delete-mod',
  'builds:update-mod',
  'diagnosis:pending',
  'diagnosis:clear',
  'diagnosis:relaunch',
  'builds:export',
  'builds:import',
  'mods:import-mrpack',
  'mods:java',
  'game:open-dir',
  'shell:open-root',
  'shell:open-mods',

  'shell:open-url',

  'news:fetch',

  'skin:fetch',

  'favs:list',

  'favs:add',

  'favs:remove',
  'update:check',
  'update:now',
  'update:status',
  'dialog:saveFile',
  'dialog:openFile'
];

const RECEIVE = [
  'launch:progress',
  'launch:log',
  'launch:error',
  'launch:started',
  'launch:exit',
  'builds:changed',
  'mod:progress',
  'builds:progress',
  'launch:diagnosis'
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
