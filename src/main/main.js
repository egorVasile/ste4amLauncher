'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const maxRamGb = () => Math.max(2, Math.floor(os.totalmem() / 1073741824) - 1);
const store = require('./store');
const launcher = require('./launcher');
const mods = require('./mods');
const updater = require('./update');

function raisePriority(pid) {
  if (!pid) return;
  try {
    execFile('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).PriorityClass='AboveNormal'`], () => {});
  } catch (e) {}
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#303030',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '..', 'preload', 'preload.js')
    }
  });

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.modrinth.com; font-src 'self' data:"
        ]
      }
    });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.toString());
    } catch (e) {}
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function emit(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

const launchEmitter = (type, data) => {
  if (type === 'stage') emit('launch:progress', data);
  else if (type === 'log') emit('launch:log', { line: data.line });
  else if (type === 'error') emit('launch:error', { message: data.message });
  else if (type === 'started') emit('launch:started', { pid: data.pid });
  else if (type === 'exit') emit('launch:exit', { code: data.code });
};

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron
  }));

  ipcMain.handle('settings:get', () => ({
    username: store.get('username'),
    ram: store.get('ram'),
    totalRam: maxRamGb(),
    width: store.get('width'),
    height: store.get('height'),
    launcherMode: store.get('launcherMode') || 'keep',
    mirror: store.get('mirror'),
    javaPath: store.get('javaPath'),
    language: store.get('language'),
    showSnapshots: store.get('showSnapshots'),
    optimize: store.get('optimize'),
    jvmArgs: store.get('jvmArgs'),
    closeLauncherOnGame: store.get('closeLauncherOnGame'),
    showOldVersions: store.get('showOldVersions'),
    experimental: store.get('experimental'),
    theme: store.get('theme')
  }));

  ipcMain.handle('settings:set', (_e, key, value) => {
    const allowed = ['username', 'ram', 'mirror', 'javaPath', 'language', 'showSnapshots', 'optimize', 'jvmArgs', 'closeLauncherOnGame', 'showOldVersions', 'experimental', 'theme', 'width', 'height', 'launcherMode', 'updateUrl'];
    if (!allowed.includes(key)) throw new Error('Bad key');
    store.set(key, value);
    return true;
  });

  ipcMain.handle('versions:list', async () => {
    return launcher.listVersions();
  });

  ipcMain.handle('settings:java-search', () => launcher.findJava());

  ipcMain.handle('game:open-dir', () => {
    const d = launcher.dirs();
    shell.openPath(d.game);
    return true;
  });

  ipcMain.handle('shell:open-root', () => {
    const d = launcher.dirs();
    shell.openPath(d.root);
    return true;
  });

  ipcMain.handle('shell:open-mods', async () => {
    const d = launcher.dirs();
    const p = path.join(d.game, 'mods');
    await fs.promises.mkdir(p, { recursive: true });
    shell.openPath(p);
    return true;
  });

  ipcMain.handle('shell:open-url', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
    return true;
  });

  ipcMain.handle('version:screenshot', async (_e, id, wide) => {
    if (typeof id !== 'string' || !id) return null;
    const p = await launcher.versionScreenshot(id, !!wide);
    return p ? 'file://' + p.replace(/\\/g, '/') : null;
  });

  ipcMain.handle('launch:start', async (_e, opts) => {
    const { version, username, ram } = opts || {};
    if (!version || typeof version !== 'string') throw new Error('Bad version');
    store.set('username', typeof username === 'string' ? username : store.get('username'));
    const safeRam = Math.max(1, Math.min(Number.isFinite(ram) ? ram : store.get('ram'), maxRamGb()));
    store.set('ram', safeRam);
    const resW = parseInt(opts && opts.width, 10);
    const resH = parseInt(opts && opts.height, 10);
    try {
      const pid = await launcher.launchVersion({
        version,
        username: store.get('username'),
        ram: safeRam,
        accessToken: '0',
        uuid: null,
        buildId: typeof opts.buildId === 'string' ? opts.buildId : null,
        resolutionW: Number.isFinite(resW) && resW > 0 ? resW : null,
        resolutionH: Number.isFinite(resH) && resH > 0 ? resH : null
      }, launchEmitter);
      raisePriority(pid);
      const mode = store.get('launcherMode') || 'keep';
      if (mode === 'minimize' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
      } else if (mode === 'close' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }
      return { ok: true };
    } catch (e) {
      emit('launch:error', { message: e.message });
      throw e;
    }
  });

  ipcMain.handle('launch:stop', () => launcher.stopGame());
  ipcMain.handle('launch:running', () => launcher.gameRunning());

  /* ============ Modrinth + сборки ============ */
  ipcMain.handle('modrinth:search', async (_e, opts) => {
    const { query = '', facets = [], limit = 30, offset = 0 } = opts || {};
    return mods.mrSearch({ query, facets, limit, offset });
  });
  ipcMain.handle('modrinth:project', async (_e, slug) => mods.mrProject(slug));
  ipcMain.handle('modrinth:batch-projects', async (_e, ids) => mods.mrBatchProjects(ids));
  ipcMain.handle('modrinth:versions', async (_e, slug, gameVersion, loader) =>
    mods.mrProjectVersions(slug, gameVersion, loader));
  ipcMain.handle('modrinth:categories', () => mods.mrCategories());
  ipcMain.handle('modrinth:loaders', () => mods.mrLoaders());
  ipcMain.handle('modrinth:game-versions', () => mods.mrGameVersions());
  ipcMain.handle('builds:list', () => mods.buildsList());
  ipcMain.handle('builds:create', async (e, opts) => {
    const b = await mods.buildCreate({
      name: opts && opts.name,
      gameVersion: opts && opts.gameVersion,
      loader: opts && opts.loader,
      icon: opts && opts.icon,
      onProgress: fr => e.sender.send('builds:progress', { name: 'Загрузчик', frac: fr })
    });
    emit('builds:changed', {});
    return b;
  });
  ipcMain.handle('builds:delete', async (_e, id) => {
    const ok = await mods.deleteBuild(id);
    emit('builds:changed', {});
    return ok;
  });
  ipcMain.handle('builds:installed', (_e, id, type) => mods.installedMods(id, type));
ipcMain.handle('news:fetch', () => mods.fetchNews());
ipcMain.handle('favs:list', () => mods.favsList());
ipcMain.handle('favs:add', async (_e, item) => mods.favsAdd(item));
ipcMain.handle('favs:remove', async (_e, slug) => mods.favsRemove(slug));

ipcMain.handle('update:check', async () => {
  try { return await updater.checkUpdate(store); } catch (e) { return null; }
});
ipcMain.handle('update:now', async () => {
  try { await updater.launchUpdater(store); return true; } catch (e) { return false; }
});
  ipcMain.handle('builds:install-mod', async (e, opts) => {
    const r = await mods.installProject({
      buildId: opts && opts.buildId,
      project: opts && opts.project,
      versionId: opts && opts.versionId,
      withDeps: !!(opts && opts.withDeps),
      type: (opts && opts.type) || 'mod',
      onProgress: fr => e.sender.send('mod:progress', { name: opts && opts.project, frac: fr })
    });
    emit('builds:changed', {});
    return r;
  });
  ipcMain.handle('builds:delete-mod', async (_e, buildId, filename, type) => {
    const ok = await mods.deleteMod(buildId, filename, type);
    emit('builds:changed', {});
    return ok;
  });
  ipcMain.handle('mods:java', () => mods.findJava());
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
