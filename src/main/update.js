'use strict';
// Модуль проверки и запуска обновления лаунчера.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

let lastManifest = null;

function getUpdateUrl(store) {
  const url = (store.get('updateUrl') || '').toString().trim();
  if (!url) return null;
  return url.endsWith('/') ? url : url + '/';
}

function fetchJson(url, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data.replace(/^\\uFEFF/, ''))); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

async function checkUpdate(store) {
  try {
    const base = getUpdateUrl(store);
    if (!base) return null;
    const manifest = await fetchJson(base + 'version.json');
    if (!manifest || !manifest.version || !Array.isArray(manifest.files)) return null;
    if (compareVersions(manifest.version, app.getVersion()) <= 0) return null;
    lastManifest = manifest;
    return {
      version: manifest.version,
      files: manifest.files,
      npmInstall: !!manifest.npmInstall
    };
  } catch (e) {
    console.error('[update:check]', e && e.message);
    return null;
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const tmp = dest + '.part';
    const out = fs.createWriteStream(tmp);
    const req = mod.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        out.destroy();
        try { fs.unlinkSync(tmp); } catch (e) { /* noop */ }
        return reject(new Error('HTTP ' + res.statusCode));
      }
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          try {
            fs.renameSync(tmp, dest);
            resolve(dest);
          } catch (e) {
            reject(e);
          }
        });
      });
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

async function launchUpdater(store) {
  const base = getUpdateUrl(store);
  if (!base) throw new Error('no update url');
  const manifest = lastManifest || (await fetchJson(base + 'version.json'));
  if (!manifest || !Array.isArray(manifest.files)) throw new Error('bad manifest');

  const launcherDir = path.resolve(__dirname, '..', '..');
  const updateDir = path.join(launcherDir, 'update');
  fs.mkdirSync(updateDir, { recursive: true });

  const updaterPath = path.join(updateDir, 'updater.js');
  await downloadFile(base + 'updater.js', updaterPath);
  fs.writeFileSync(path.join(updateDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const args = [updaterPath, launcherDir, String(process.pid), path.join(updateDir, 'manifest.json')];
  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return true;
}

module.exports = { checkUpdate, launchUpdater };