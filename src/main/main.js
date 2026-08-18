'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
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
      spellcheck: false,
      backgroundThrottling: true,
      preload: path.join(__dirname, '..', 'preload', 'preload.js')
    }
  });

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.modrinth.com https://launchercontent.mojang.com; font-src 'self' data:"
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
  else if (type === 'diagnosis') emit('launch:diagnosis', data);
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
    // При изменении username обновляем активный аккаунт, если он существует
    if (key === 'username' && store.get('activeAccountId')) {
      const acct = store.data.accounts.find(a => a.id === store.get('activeAccountId'));
      if (acct) acct.username = value;
    }
    return true;
  });

  // IPC-handlers for accounts management
  ipcMain.handle('accounts:list', () => store.accountsList());

  ipcMain.handle('accounts:add', (_e, account) => {
    // account: { username, userType, accessToken?, uuid? }
    // Если передан accessToken — это ely.by аккаунт, иначе оффлайн
    const isOnline = !!account.accessToken;
    const newAccount = {
      id: 'account-' + Date.now(),
      username: account.username || 'Player',
      userType: isOnline ? 'online' : 'legacy',
      accessToken: isOnline ? account.accessToken : '0',
      uuid: isOnline ? (account.uuid || '00000000-0000-0000-0000-000000000000') : '00000000-0000-0000-0000-000000000000'
    };
    return store.addAccount(newAccount);
  });

  ipcMain.handle('accounts:remove', (_e, accountId) => store.removeAccount(accountId));

  ipcMain.handle('accounts:select', (_e, accountId) => store.setActiveAccount(accountId));

  ipcMain.handle('accounts:update', (_e, accountId, updates) => {
    const account = store.data.accounts.find(a => a.id === accountId);
    if (!account) return false;
    Object.assign(account, updates);
    // Ensure credentials are never missing for online accounts
    if (account.userType === 'online' && (!account.accessToken || account.accessToken === '0')) {
      account.accessToken = '0'; // fallback to offline
      account.userType = 'legacy';
    }
    store.save();
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
      onProgress: (fr, stage) => e.sender.send('builds:progress', { name: stage || 'Загрузчик', frac: fr })
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
  ipcMain.handle('builds:registry', (_e, id) => mods.loadInstalled(id));
ipcMain.handle('news:fetch', () => mods.fetchNews());
  ipcMain.handle('system:gpu', () => {
    try {
      if (!app.getGPUFeatureStatus) return null;
      const s = app.getGPUFeatureStatus();
      return {
        gpu_compositing: s.gpu_compositing || '',
        software: (s.gpu_compositing === 'disabled_software' || s.gpu_compositing === 'disabled_off') ||
                  (s.angle_swiftshader && s.angle_swiftshader === 'disabled_off')
      };
    } catch (e) { return null; }
  });
ipcMain.handle('favs:list', () => mods.favsList());
ipcMain.handle('favs:add', async (_e, item) => mods.favsAdd(item));
ipcMain.handle('favs:remove', async (_e, slug) => mods.favsRemove(slug));

ipcMain.handle('update:check', async () => {
  try { return await updater.checkUpdate(store); } catch (e) { return null; }
});
ipcMain.handle('update:now', async () => {
  try { await updater.launchUpdater(store); return true; } catch (e) { return false; }
});
ipcMain.handle('update:status', () => updater.lastUpdateStatus());
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

  // Export / Import builds
  async function saveDialog(defaultPath) {
    const { dialog } = require('electron');
    const res = await dialog.showSaveDialog({
      defaultPath,
      filters: [{ name: 'st4am', extensions: ['st4am'] }]
    });
    return res.canceled ? null : res.filePath;
  }
  async function openDialog() {
    const { dialog } = require('electron');
    const res = await dialog.showOpenDialog({
      filters: [{ name: 'st4am', extensions: ['st4am'] }],
      properties: ['openFile']
    });
    return res.canceled ? null : res.filePaths[0];
  }
  ipcMain.handle('dialog:saveFile', async (_e, defaultPath) => saveDialog(defaultPath));
  ipcMain.handle('dialog:openFile', async () => openDialog());
  ipcMain.handle('builds:export', async (_e, buildId) => {
    const filePath = await saveDialog(`build-${buildId}.st4am`);
    if (!filePath) return { ok: false, canceled: true };
    try {
      const result = await mods.exportBuild(buildId);
      if (!result.ok) return result;
      await fsp.writeFile(filePath, JSON.stringify(result.manifest, null, 2));
      console.log('[builds:export] записано:', filePath, 'байт:', JSON.stringify(result.manifest).length);
      return { ok: true, path: filePath, skipped: result.skipped };
    } catch (e) {
      console.error('[builds:export]', e && e.stack || e);
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('builds:import', async (e, filePath) => {
    console.log('[builds:import] файл:', filePath);
    try {
      const stat = await fsp.stat(filePath);
      console.log('[builds:import] размер:', stat.size, 'байт');
      const manifest = JSON.parse(await fsp.readFile(filePath, 'utf8'));
      console.log('[builds:import] манифест:', manifest.name, manifest.gameVersion, manifest.loader, manifest.files.length + ' файлов');
      const buildId = await mods.importBuild(manifest, (frac, file) => {
        e.sender.send('builds:progress', { frac, file });
      });
      emit('builds:changed', {});
      console.log('[builds:import] создана сборка:', buildId);
      return { ok: true, buildId };
    } catch (e) {
      console.error('[builds:import]', e && e.stack || e);
      return { ok: false, error: e.message };
    }
  });

  /* ============ Диагностика ошибок запуска ============ */
  ipcMain.handle('builds:update-mod', async (_e, opts) => {
    const { buildId, slug, filename, type } = opts || {};
    if (!buildId || !slug) return { ok: false, error: 'bad args' };
    try {
      // удаляем старый файл, если известен
      if (filename) await mods.deleteMod(buildId, filename, type || 'mod');
      // ставим последнюю совместимую версию по названию
      const r = await mods.installProject({
        buildId, project: slug, versionId: null, withDeps: false, type: type || 'mod', onProgress: null
      });
      emit('builds:changed', {});
      return { ok: true, installed: r.installed };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('diagnosis:pending', async () => {
    const diag = require('./diag');
    return diag.pendingReport();
  });
  ipcMain.handle('diagnosis:clear', async () => {
    const diag = require('./diag');
    return diag.clearPending();
  });
  ipcMain.handle('diagnosis:relaunch', async (_e, opts) => {
    const { buildId, username, ram } = opts || {};
    if (!buildId) return { ok: false, error: 'no buildId' };
    try {
      const pid = await launcher.launchVersion({
        version: buildId,
        buildId,
        username: typeof username === 'string' && username ? username : store.get('username'),
        ram: Math.max(1, Math.min(Number.isFinite(ram) ? ram : store.get('ram'), maxRamGb())),
        accessToken: '0',
        uuid: null,
        resolutionW: null,
        resolutionH: null
      }, launchEmitter);
      raisePriority(pid);
      return { ok: true };
    } catch (e) {
      emit('launch:error', { message: e.message });
      return { ok: false, error: e.message };
    }
  });
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
