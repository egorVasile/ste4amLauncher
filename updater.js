'use strict';
// ============================================================
//  updater.js — самодостаточный установщик обновления лаунчера
//  Запуск: electron.exe updater.js <launcherDir> <pid> <manifest>
//  Не зависит от кода лаунчера (только встроенные модули).
// ============================================================
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { spawn, exec } = require('child_process');

const args = process.argv.slice(2);
const launcherDir = args[0] || process.cwd();
const launcherPid = parseInt(args[1], 10) || 0;
const manifestPath = args[2] || path.join(launcherDir, 'update', 'manifest.json');

const UI_TITLE = '\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 \u043b\u0430\u0443\u043d\u0447\u0435\u0440\u0430... \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0430';
const UI_FAILED = 'failed!';

const pageHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    background: #3a3a3a;
    font-family: "Segoe UI", Tahoma, sans-serif;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 16px; user-select: none;
  }
  #status { color: #e8e8e8; font-size: 15px; text-align: center; padding: 0 20px; }
  #status.fail { color: #ff6b5e; font-weight: bold; }
  .track {
    width: 300px; height: 18px;
    background: #1f1f1f;
    border: 2px solid #0f0f0f;
    box-shadow: inset 0 2px 4px rgba(0,0,0,.6);
    padding: 2px;
  }
  #bar {
    width: 0%; height: 100%;
    background: #5bd450;
    box-shadow: inset 0 -3px 0 rgba(0,0,0,.25);
    transition: width .15s linear;
  }
</style>
</head>
<body>
  <div id="status">${UI_TITLE}</div>
  <div class="track"><div id="bar"></div></div>
</body>
</html>`;

let win = null;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function setProgress(pct) {
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  if (win && !win.isDestroyed()) {
    win.webContents.executeJavaScript(
      "document.getElementById('bar').style.width='" + pct + "%'"
    ).catch(() => {});
  }
}

function setStatus(text, fail) {
  if (win && !win.isDestroyed()) {
    const cls = fail ? 'fail' : '';
    win.webContents.executeJavaScript(
      "var s=document.getElementById('status');s.textContent=" +
      JSON.stringify(text) + ";s.className='" + cls + "'"
    ).catch(() => {});
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const tmp = dest + '.part';
    const out = fs.createWriteStream(tmp);
    const req = mod.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        out.destroy();
        try { fs.unlinkSync(tmp); } catch (e) { /* noop */ }
        return reject(new Error('HTTP ' + res.statusCode + ' ' + url));
      }
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(tmp)));
      out.on('error', (err) => {
        try { fs.unlinkSync(tmp); } catch (e) { /* noop */ }
        reject(err);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => {
      try { fs.unlinkSync(tmp); } catch (e) { /* noop */ }
      reject(err);
    });
  });
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function killProcess(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    const p = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { windowsHide: true });
    p.on('close', resolve);
    p.on('error', resolve);
  });
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

async function waitGone(pid, timeoutMs) {
  const start = Date.now();
  while (isAlive(pid) && Date.now() - start < timeoutMs) {
    await sleep(300);
  }
}

function copyTree(srcDir, destRoot) {
  if (!fs.existsSync(srcDir)) return;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(srcDir, e.name);
    const d = path.join(destRoot, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }
}

function runNpm(cwd) {
  return new Promise((resolve, reject) => {
    exec('npm install', { cwd, timeout: 300000, windowsHide: true }, (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

function relaunchLauncher() {
  try {
    const p = spawn(process.execPath, ['.'], {
      cwd: launcherDir,
      detached: true,
      stdio: 'ignore'
    });
    p.unref();
  } catch (e) { /* noop */ }
}

async function runUpdate() {
  const backupDir = path.join(launcherDir, 'backup');
  const updateDir = path.dirname(manifestPath);
  const lockPath = path.join(updateDir, 'updater.lock');
  try {
    // lock-защита от двух апдейтеров
    if (fs.existsSync(lockPath)) {
      const oldPid = parseInt(fs.readFileSync(lockPath, 'utf8'), 10) || 0;
      let alive = false;
      try { process.kill(oldPid, 0); alive = true; } catch (e) { alive = false; }
      if (alive) {
        setStatus(UI_FAILED, true);
        await sleep(1200);
        app.exit(1);
        return;
      }
      try { fs.unlinkSync(lockPath); } catch (e) { /* noop */ }
    }
    fs.mkdirSync(updateDir, { recursive: true });
    fs.writeFileSync(lockPath, String(process.pid), 'utf8');

    setStatus(UI_TITLE, false);
    setProgress(2);

    // даём окну появиться, затем закрываем лаунчер
    await sleep(1800);
    await killProcess(launcherPid);
    await waitGone(launcherPid, 12000);

    // манифест
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const files = Array.isArray(manifest.files) ? manifest.files : [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const rel = String(f.path || '').replace(/\\/g, '/');
      if (!rel) continue;
      const dest = path.join(launcherDir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });

      setProgress((i / files.length) * 90);

      // качаем (1 повтор при несовпадении хэша)
      let tmp = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        tmp = await download(f.url, dest);
        if (!f.sha256) break;
        if (sha256File(tmp).toLowerCase() === String(f.sha256).toLowerCase()) break;
        try { fs.unlinkSync(tmp); } catch (e) { /* noop */ }
        if (attempt === 1) throw new Error('hash mismatch: ' + rel);
      }

      // бэкап старого файла
      if (fs.existsSync(dest)) {
        const bak = path.join(backupDir, rel);
        fs.mkdirSync(path.dirname(bak), { recursive: true });
        fs.copyFileSync(dest, bak);
      }

      fs.renameSync(tmp, dest);
      setProgress(((i + 1) / files.length) * 90);
    }

    // новые npm-зависимости, если манифест просит
    if (manifest.npmInstall) {
      setStatus('npm install...', false);
      await runNpm(launcherDir);
    }

    setProgress(100);
    await sleep(400);

    try { fs.unlinkSync(lockPath); } catch (e) { /* noop */ }
    relaunchLauncher();
    app.exit(0);
  } catch (err) {
    // откат: восстанавливаем бэкап, показываем failed!
    try {
      copyTree(backupDir, launcherDir);
    } catch (e) { /* noop */ }
    try { fs.unlinkSync(lockPath); } catch (e) { /* noop */ }
    try { fs.writeFileSync(path.join(updateDir, 'updater-error.log'), String(err && err.stack || err), 'utf8'); } catch (e) { /* noop */ }
    setStatus(UI_FAILED + ' ' + String(err && err.message || err), true);
    await sleep(1800);
    relaunchLauncher();
    app.exit(0);
  }
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 460,
    height: 190,
    resizable: false,
    frame: true,
    autoHideMenuBar: true,
    title: 'Update',
    backgroundColor: '#3a3a3a'
  });
  win.setMenuBarVisibility(false);
  win.removeMenu();
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pageHtml));
  runUpdate();
});