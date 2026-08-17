'use strict';
// updater.js - чистый Node-скрипт обновления (без electron API)
// Запуск: <electron|exe> updater.js <launcherDir> <pid> <manifest>  (env ELECTRON_RUN_AS_NODE=1)
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
  while (isAlive(pid) && Date.now() - start < timeoutMs) await sleep(300);
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
    const env = Object.assign({}, process.env);
    delete env.ELECTRON_RUN_AS_NODE;
    const p = spawn(process.execPath, ['.'], { cwd: launcherDir, detached: true, stdio: 'ignore', env });
    p.unref();
  } catch (e) { /* noop */ }
}

async function runUpdate() {
  const backupDir = path.join(launcherDir, 'backup');
  const updateDir = path.dirname(manifestPath);
  const lockPath = path.join(updateDir, 'updater.lock');
  const log = (...a) => { try { fs.appendFileSync(path.join(updateDir, 'updater.log'), a.join(' ') + '\n'); } catch (e) {} };
  log('start', new Date().toISOString(), launcherDir, launcherPid, manifestPath);
  try {
    if (fs.existsSync(lockPath)) {
      const oldPid = parseInt(fs.readFileSync(lockPath, 'utf8'), 10) || 0;
      let alive = false;
      try { process.kill(oldPid, 0); alive = true; } catch (e) { alive = false; }
      if (alive) { log('already running'); await sleep(1200); process.exit(1); return; }
      try { fs.unlinkSync(lockPath); } catch (e) { /* noop */ }
    }
    fs.mkdirSync(updateDir, { recursive: true });
    fs.writeFileSync(lockPath, String(process.pid), 'utf8');

    await sleep(1800);
    await killProcess(launcherPid);
    await waitGone(launcherPid, 12000);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const files = Array.isArray(manifest.files) ? manifest.files : [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const rel = String(f.path || '').replace(/\\/g, '/');
      if (!rel) continue;
      const dest = path.join(launcherDir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      let tmp = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        tmp = await download(f.url, dest);
        if (!f.sha256) break;
        if (sha256File(tmp).toLowerCase() === String(f.sha256).toLowerCase()) break;
        try { fs.unlinkSync(tmp); } catch (e) { /* noop */ }
        if (attempt === 1) throw new Error('hash mismatch: ' + rel);
      }
      if (fs.existsSync(dest)) {
        const bak = path.join(backupDir, rel);
        fs.mkdirSync(path.dirname(bak), { recursive: true });
        fs.copyFileSync(dest, bak);
      }
      fs.renameSync(tmp, dest);
      log('updated', rel);
    }

    if (manifest.npmInstall) await runNpm(launcherDir);

    try { fs.unlinkSync(lockPath); } catch (e) { /* noop */ }
    log('done');
    relaunchLauncher();
    process.exit(0);
  } catch (err) {
    try { copyTree(backupDir, launcherDir); } catch (e) { /* noop */ }
    try { fs.unlinkSync(lockPath); } catch (e) { /* noop */ }
    try { fs.writeFileSync(path.join(updateDir, 'updater-error.log'), String(err && err.stack || err), 'utf8'); } catch (e) { /* noop */ }
    log('error', err && err.message);
    await sleep(1200);
    relaunchLauncher();
    process.exit(0);
  }
}

runUpdate();