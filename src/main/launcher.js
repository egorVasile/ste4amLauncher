'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app } = require('electron');
const os = require('os');
const { execFileSync } = require('child_process');
const store = require('./store');

const MOJANG = {
  manifest: 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json',
  libraries: 'https://libraries.minecraft.net/',
  assets: 'https://resources.download.minecraft.net/',
  piston: 'https://piston-data.mojang.com/',
  meta: 'https://launchermeta.mojang.com/'
};

const BMCLAPI = {
  manifest: 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json',
  libraries: 'https://bmclapi2.bangbang93.com/maven/',
  assets: 'https://bmclapi2.bangbang93.com/assets/',
  piston: 'https://bmclapi2.bangbang93.com/version/',
  meta: 'https://bmclapi2.bangbang93.com/mc/'
};

let ROOT = path.join(app.getPath('appData'), '.st4amlauncher');
function setRoot(dir) { ROOT = dir; }
const dirs = () => ({
  root: ROOT,
  versions: path.join(ROOT, 'versions'),
  libraries: path.join(ROOT, 'libraries'),
  assets: path.join(ROOT, 'assets'),
  game: path.join(ROOT, 'game')
});

function log(...a) { console.log('[launcher]', ...a); }

/* ============ HTTP helpers ============ */

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'st4amLauncher/0.1', ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpGet(res.headers.location, headers));
        res.resume();
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('timeout ' + url)); });
  });
}

async function downloadFile(url, dest, onProgress, label) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const res = await new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'st4amLauncher/0.1' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        resolve(httpGetRedirect(r.headers.location, onProgress));
        return;
      }
      if (r.statusCode !== 200) { r.resume(); reject(new Error(`HTTP ${r.statusCode} ${url}`)); return; }
      resolve(r);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('timeout ' + url)));
  });
  if (Buffer.isBuffer(res)) {
    await fsp.writeFile(tmp, res);
  } else {
    await new Promise((resolve, reject) => {
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      const out = fs.createWriteStream(tmp);
      res.on('data', (c) => {
        got += c.length;
        if (onProgress && total) onProgress(got / total);
      });
      res.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      res.on('error', reject);
    });
  }
  await renameWithRetry(tmp, dest);
  if (onProgress) onProgress(1);
  return dest;
}

async function renameWithRetry(tmp, dest) {
  if (!fs.existsSync(tmp)) throw new Error('Downloaded file missing: ' + tmp);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fsp.copyFile(tmp, dest);
      await fsp.unlink(tmp).catch(() => {});
      return;
    } catch (e) {
      if (attempt === 4) {
        try {
          await fsp.rename(tmp, dest);
          return;
        } catch (e2) {
          throw e2;
        }
      }
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}

function httpGetRedirect(url, onProgress) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'st4amLauncher/0.1' } }, (r) => {
      if (r.statusCode !== 200) { r.resume(); reject(new Error(`HTTP ${r.statusCode} ${url}`)); return; }
      resolve(r);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('timeout ' + url)));
  });
}

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

async function sha1OfFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    const s = fs.createReadStream(file);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

/* ============ Mirror ============ */

function mirrorApi() {
  if (store.get('mirror') === 'bmclapi') return BMCLAPI;
  if (store.get('mirror') === 'mojang') return MOJANG;
  return null; // auto
}

function rewriteUrl(url) {
  const m = mirrorApi();
  if (!m) return url;
  if (url.startsWith(MOJANG.libraries)) return BMCLAPI.libraries + url.slice(MOJANG.libraries.length);
  if (url.startsWith(MOJANG.assets)) return BMCLAPI.assets + url.slice(MOJANG.assets.length);
  if (url.startsWith(MOJANG.piston)) {
    const id = url.split('/').filter(Boolean).slice(1).join('/');
    return BMCLAPI.piston + id;
  }
  return url;
}

// Возвращает URL того же файла на ДРУГОМ зеркале (для автоматического отката).
// Умеет и «кривой» формат BMCLAPI (/version/piston-data.mojang.com/...), из-за
// которого файлы не качались, когда у зеркала нет нужного объекта.
function altMirrorUrl(url) {
  const m = /^https:\/\/bmclapi2\.bangbang93\.com\/version\/(piston-data\.mojang\.com\/.+)$/.exec(url);
  if (m) return 'https://' + m[1];
  if (url.startsWith('https://piston-data.mojang.com/')) return 'https://bmclapi2.bangbang93.com/version/' + url.slice('https://piston-data.mojang.com/'.length);
  if (url.startsWith('https://bmclapi2.bangbang93.com/version/')) return 'https://piston-data.mojang.com/' + url.slice('https://bmclapi2.bangbang93.com/version/'.length);
  if (url.startsWith(MOJANG.libraries)) return BMCLAPI.libraries + url.slice(MOJANG.libraries.length);
  if (url.startsWith(BMCLAPI.libraries)) return MOJANG.libraries + url.slice(BMCLAPI.libraries.length);
  if (url.startsWith(MOJANG.assets)) return BMCLAPI.assets + url.slice(MOJANG.assets.length);
  if (url.startsWith(BMCLAPI.assets)) return MOJANG.assets + url.slice(BMCLAPI.assets.length);
  return null;
}

// Скачивание с умным откатом: не вышло с одного зеркала (404/timeout) — пробуем другое
async function downloadMirrored(url, dest, onProgress) {
  const alts = [url, altMirrorUrl(url)].filter(Boolean);
  let lastErr = null;
  for (const u of alts) {
    try {
      await downloadFile(u, dest, onProgress);
      return dest;
    } catch (e) {
      lastErr = e;
      log('fallback:', u, '->', e.message);
    }
  }
  throw lastErr || new Error('Download failed: ' + url);
}

// httpGet с откатом на другое зеркало
async function httpGetMirrored(url, headers = {}) {
  const alts = [url, altMirrorUrl(url)].filter(Boolean);
  let lastErr = null;
  for (const u of alts) {
    try { return await httpGet(u, headers); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Request failed: ' + url);
}

// Быстрая проверка, есть ли интернет (для умной подсказки об ошибке скачивания)
async function checkNet() {
  const probes = [
    'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json',
    'https://api.modrinth.com/v2/tag/game_version'
  ];
  for (const u of probes) {
    try {
      await new Promise((resolve, reject) => {
        const mod = u.startsWith('https') ? https : http;
        const req = mod.get(u, { headers: { 'User-Agent': 'st4amLauncher/0.1' } }, (res) => {
          res.resume();
          resolve(res.statusCode >= 200 && res.statusCode < 500);
        });
        req.on('error', reject);
        req.setTimeout(4000, () => { req.destroy(new Error('timeout')); });
      });
      return true;
    } catch (e) { /* пробуем следующий */ }
  }
  return false;
}

/* ============ Version manifest ============ */

async function fetchManifest() {
  const api = mirrorApi();
  const urls = [];
  if (api) urls.push(api.manifest);
  else urls.push(MOJANG.manifest, BMCLAPI.manifest);
  let lastErr = null;
  for (const u of urls) {
    try {
      const buf = await httpGet(u);
      return JSON.parse(buf.toString('utf8'));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Cannot fetch manifest');
}

async function listVersions() {
  const m = await fetchManifest();
  return (m.versions || []).map(v => ({
    id: v.id, type: v.type, releaseTime: v.releaseTime, url: v.url
  }));
}

async function getVersionJson(id) {
  const list = await listVersions();
  const meta = list.find(v => v.id === id);
  const d = dirs();
  const cacheFile = path.join(d.versions, id, id + '.json');
  let vj = null;
  try { vj = JSON.parse(await fsp.readFile(cacheFile, 'utf8')); } catch (e) { /* noop */ }
  if (vj) return vj;
  if (!meta) throw new Error('Version not found: ' + id);
  const buf = await httpGet(meta.url);
  vj = JSON.parse(buf.toString('utf8'));
  await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
  await fsp.writeFile(cacheFile, JSON.stringify(vj, null, 2));
  return vj;
}

/* ============ Assets ============ */

async function ensureAssets(vj, onProgress) {
  const d = dirs();
  const ai = vj.assetIndex;
  const indexFile = path.join(d.assets, 'indexes', ai.id + '.json');
  let index = null;
  try { index = JSON.parse(await fsp.readFile(indexFile, 'utf8')); } catch (e) { /* noop */ }
  if (!index) {
    onProgress('СКАЧИВАНИЕ ИНДЕКСА АССЕТОВ', 0);
    const buf = await httpGetMirrored(rewriteUrl(ai.url));
    index = JSON.parse(buf.toString('utf8'));
    await fsp.mkdir(path.dirname(indexFile), { recursive: true });
    await fsp.writeFile(indexFile, JSON.stringify(index));
  }
  const objs = index.objects || {};
  const keys = Object.keys(objs);
  let done = 0;
  const CONC = 24;
  const already = [];
  for (const k of keys) {
    const o = objs[k];
    const p = path.join(d.assets, 'objects', o.hash.slice(0, 2), o.hash);
    if (fs.existsSync(p)) {
      try {
        const st = fs.statSync(p);
        if (st.size === (o.size || 0)) { done++; continue; }
      } catch (e) {}
    }
    already.push([k, o]);
  }
  let i = 0;
  const total = already.length;
  async function worker() {
    while (i < total) {
      const [k, o] = already[i++];
      const p = path.join(d.assets, 'objects', o.hash.slice(0, 2), o.hash);
      try {
        await downloadMirrored(rewriteUrl(MOJANG.assets + o.hash.slice(0, 2) + '/' + o.hash), p);
      } catch (e) { log('asset fail', k, e.message); }
      done++;
      if (done % 50 === 0 || done === keys.length) {
        onProgress('АССЕТЫ', done / keys.length);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  onProgress('АССЕТЫ', 1);
  return indexFile;
}

async function ensureVirtualAssets(vj, indexFile, gameDir) {
  let index = null;
  try { index = JSON.parse(await fsp.readFile(indexFile, 'utf8')); } catch (e) { return null; }
  if (!index || !(index.mapToResources || index.virtual)) return null;
  const d = dirs();
  const root = index.mapToResources
    ? path.join(gameDir, 'resources')
    : path.join(d.assets, 'virtual', (vj.assetIndex || {}).id || 'legacy');
  await fsp.mkdir(root, { recursive: true });
  const objs = index.objects || {};
  let copied = 0;
  for (const key of Object.keys(objs)) {
    const o = objs[key];
    const target = path.join(root, key);
    if (fs.existsSync(target)) continue;
    const src = path.join(d.assets, 'objects', o.hash.slice(0, 2), o.hash);
    if (!fs.existsSync(src)) continue;
    try {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(src, target);
      copied++;
    } catch (e) {}
  }
  if (copied) log('virtual assets copied', copied, '->', root);
  return root;
}

/* ============ Libraries ============ */

function libFileName(lib) {
  const artifact = (lib.downloads && lib.downloads.artifact) || lib.artifact;
  if (artifact && artifact.path) {
    return {
      dir: path.dirname(artifact.path.split('/').join(path.sep)),
      file: path.basename(artifact.path),
      isNative: /-natives-/.test(artifact.path) || !!lib.classifiers,
      artifact
    };
  }
  const p = lib.name.split(':');
  const group = p[0].split('.').join('/');
  const name = p[1];
  const ver = p[2];
  let classifier = '';
  if (lib.natives) {
    const key = lib.natives.windows;
    if (key) classifier = '-' + key.replace('${arch}', process.arch === 'x64' ? '64' : '32');
  } else if (lib.classifiers && lib.classifiers['natives-windows']) {
    classifier = '-' + lib.classifiers['natives-windows'].replace('${arch}', process.arch === 'x64' ? '64' : '32');
  }
  return { dir: path.join(group, name, ver), file: `${name}-${ver}${classifier}.jar`, isNative: !!classifier, artifact: null };
}

async function ensureLibraries(vj, onProgress) {
  const d = dirs();
  const libs = vj.libraries || [];
  const toDownload = [];
  for (const lib of libs) {
    if (lib.rules && !rulesAllow(lib.rules, 'windows')) continue;
    const { dir, file, isNative, artifact } = libFileName(lib);
    if (isNative && !nativeForUs(file)) continue;
    if (artifact && artifact.absPath && fs.existsSync(artifact.absPath)) continue;
    const jarPath = path.join(d.libraries, dir, file);
    let ok = false;
    if (fs.existsSync(jarPath)) {
      try {
        const st = fs.statSync(jarPath);
        const wantSize = artifact && artifact.size;
        if (wantSize) ok = st.size === wantSize;
        else ok = st.size > 0;
      } catch (e) {}
    }
    if (ok) continue;
    const url = artifact && artifact.url
      ? artifact.url
      : MOJANG.libraries + dir.split(path.sep).join('/') + '/' + file;
    toDownload.push({ url, dest: jarPath, isNative });
  }
  let done = 0;
  const CONC = 16;
  let i = 0;
  async function worker() {
    while (i < toDownload.length) {
      const item = toDownload[i++];
      try { await downloadMirrored(rewriteUrl(item.url), item.dest); } catch (e) { log('lib fail', item.url, e.message); }
      done++;
      onProgress('БИБЛИОТЕКИ', done / Math.max(1, toDownload.length));
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  return libs;
}

function nativeForUs(file) {
  if (!/-natives-windows/.test(file)) return true;
  if (/-natives-windows-arm64\.jar$/.test(file)) return process.arch === 'arm64';
  if (/-natives-windows-x86\.jar$/.test(file)) return process.arch === 'ia32';
  return true;
}

function rulesAllow(rules, osName, features) {
  if (!rules || !rules.length) return true;
  const applicable = rules.filter(r => {
    if (r.os && r.os.name && r.os.name !== osName) return false;
    if (r.features) {
      for (const k of Object.keys(r.features)) {
        if (!!features[k] !== !!r.features[k]) return false;
      }
    }
    return true;
  });
  if (applicable.length === 0) return false;
  let allow = true;
  for (const r of applicable) {
    if (r.action === 'disallow') allow = false;
    if (r.action === 'allow') allow = true;
  }
  return allow;
}

/* ============ Natives ============ */

async function extractNatives(vj) {
  const d = dirs();
  const nativesDir = path.join(d.versions, vj.id, 'natives');
  await fsp.mkdir(nativesDir, { recursive: true });
  const libs = vj.libraries || [];
  for (const lib of libs) {
    if (lib.rules && !rulesAllow(lib.rules, 'windows')) continue;
    const { dir, file, isNative } = libFileName(lib);
    if (!isNative || !nativeForUs(file)) continue;
    const jarPath = path.join(d.libraries, dir, file);
    if (!fs.existsSync(jarPath)) continue;
    await extractJar(jarPath, nativesDir);
  }
  return nativesDir;
}

function execOut(cmd, args, opts) {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...opts });
      let done = false;
      const fin = (code) => { if (!done) { done = true; resolve(code === 0); } };
      p.on('error', () => fin(false));
      p.on('close', fin);
      setTimeout(() => { try { p.kill(); } catch (e) {} fin(false); }, 120000);
    } catch (e) { resolve(false); }
  });
}

async function extractJar(jar, dest) {
  const java = findJava();
  const candidates = [];
  if (java) candidates.push({ cmd: path.join(path.dirname(java), 'jar.exe'), args: ['xf', jar] });
  candidates.push({ cmd: 'tar', args: ['-xf', jar, '-C', dest] });
  candidates.push({
    cmd: 'powershell.exe',
    args: ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath ' + JSON.stringify(jar) + ' -DestinationPath ' + JSON.stringify(dest) + ' -Force']
  });
  for (const c of candidates) {
    try {
      if (await execOut(c.cmd, c.args, { cwd: dest })) return true;
    } catch (e) {}
  }
  return false;
}

/* ============ Java discovery ============ */

function findJavaCandidates() {
  const candidates = [];
  const cfg = store.get('javaPath');
  if (cfg && fs.existsSync(cfg)) candidates.push(cfg);
  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'));
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const roots = [pf, pfx];
  const jdkDirs = [];
  for (const r of roots) {
    try {
      for (const n of fs.readdirSync(r)) {
        if (/^(java|jdk|jre|zulu|temurin|corretto|Microsoft|Eclipse Adoptium|Amazon Corretto|ojdkbuild)/i.test(n)) {
          jdkDirs.push(path.join(r, n));
          const bin = path.join(r, n, 'bin', 'java.exe');
          if (fs.existsSync(bin)) candidates.push(bin);
        }
      }
    } catch (e) {}
  }
  for (const dir of jdkDirs) {
    for (const sub of ['jre', 'bin']) {
      const p = path.join(dir, sub, 'java.exe');
      if (fs.existsSync(p)) candidates.push(p);
    }
  }
  try {
    const out = execFileSync('where', ['java'], { encoding: 'utf8' });
    for (const line of out.split(/\r?\n/)) {
      if (line.trim()) candidates.push(line.trim());
    }
  } catch (e) {}
  const officialRuntime = path.join(pf, 'Minecraft Launcher', 'runtime');
  try {
    for (const n of fs.readdirSync(officialRuntime)) {
      const p = path.join(officialRuntime, n, 'bin', 'java.exe');
      if (fs.existsSync(p)) candidates.push(p);
    }
  } catch (e) {}
  const appData = process.env.APPDATA || '';
  const tlJre = path.join(appData, '.tlauncher', 'legacy', 'Minecraft', 'jre');
  try {
    if (fs.existsSync(tlJre)) {
      for (const n of fs.readdirSync(tlJre)) {
        if (n.startsWith('java-runtime-')) {
          const b = path.join(tlJre, n, 'windows-x64', n, 'bin', 'java.exe');
          if (fs.existsSync(b)) candidates.push(b);
        }
      }
      const base = path.join(tlJre, 'bin', 'java.exe');
      if (fs.existsSync(base)) candidates.push(base);
    }
  } catch (e) {}
  try {
    const jr = path.join(ROOT, 'java');
    for (const n of fs.readdirSync(jr)) {
      const p = path.join(jr, n, 'bin', 'java.exe');
      if (fs.existsSync(p)) candidates.push(p);
    }
  } catch (e) {}
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const key = path.resolve(c).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

function javaMajor(p) {
  return new Promise((res) => {
    let buf = '';
    let done = false;
    const fin = (m) => { if (!done) { done = true; res(m); } };
    try {
      const pr = spawn(p, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      pr.stdout.on('data', (c) => { buf += c; });
      pr.stderr.on('data', (c) => { buf += c; });
      pr.on('error', () => fin(0));
      pr.on('close', () => {
        const m = /version "?(\d+)(?:\.(\d+))?/.exec(buf);
        if (m && m[1] === '1') fin(parseInt(m[2] || '0', 10));
        else if (m) fin(parseInt(m[1], 10));
        else fin(0);
      });
      setTimeout(() => { try { pr.kill(); } catch (e) {} fin(0); }, 8000);
    } catch (e) { fin(0); }
  });
}

function javaVersionNeeded(vj) {
  if (vj.javaVersion && vj.javaVersion.majorVersion) return vj.javaVersion.majorVersion;
  if (vj.releaseTime) {
    const t = String(vj.releaseTime).slice(0, 10);
    if (t < '2021-06-08') return 8;
    if (t < '2024-04-23') return 17;
    return 21;
  }
  return 0;
}

function findJava() {
  return findJavaCandidates()[0] || null;
}

async function findJavaFor(vj, onProgress) {
  const want = javaVersionNeeded(vj);
  const cands = findJavaCandidates();
  if (!want) return cands[0] || null;
  for (const p of cands) {
    const maj = await javaMajor(p);
    if (maj === want) return p;
  }
  try {
    const mods = require('./mods');
    return await mods.ensureJavaRuntime(want, onProgress);
  } catch (e) {
    log('автоскачивание Java', want, 'не удалось:', e.message);
    return null;
  }
}

/* ============ Launch ============ */

// Базовое имя библиотеки без версии: 'asm-9.3' -> 'asm' (для сопоставления модулей)
function baseLibName(file) {
  return String(file).replace(/\.jar$/i, '').replace(/-([\d][\w.]*)$/, '');
}

function buildClasspath(vj, moduleJars) {
  const d = dirs();
  const parts = [path.join(d.versions, vj.id, vj.id + '.jar')];
  // Джарники с модульного пути (-p) нельзя дублировать в classpath —
  // BootstrapLauncher падает с 'Module already on module path'
  const modBases = new Set([...(moduleJars || [])].map(p => baseLibName(path.basename(p))));
  const libs = vj.libraries || [];
  for (const lib of libs) {
    if (lib.rules && !rulesAllow(lib.rules, 'windows')) continue;
    const { dir, file, isNative, artifact } = libFileName(lib);
    if (isNative && !nativeForUs(file)) continue;
    const abs = artifact && artifact.absPath;
    const p = abs && fs.existsSync(abs) ? abs : path.join(d.libraries, dir, file);
    if (moduleJars && moduleJars.size) {
      if (modBases.has(baseLibName(file))) continue;
    }
    if (fs.existsSync(p)) parts.push(p);
  }
  return parts.join(';');
}

function jvmArgs(vj, ramGb, javaMajorVer, ctx) {
  const d = dirs();
  const natives = path.join(d.versions, vj.id, 'natives');
  const ramMb = Math.round(ramGb * 1024);
  const base = [
    `-Xmx${ramMb}M`,
    '-Dfile.encoding=UTF-8',
    `-Djava.library.path=${natives}`,
    '-Dminecraft.launcher.brand=st4amLauncher',
    '-Dminecraft.launcher.version=0.1.0'
  ];
  if (store.get('optimize') && (javaMajorVer || 0) >= 8) {
    base.push(`-Xms${Math.min(ramMb, 2048)}M`);
    base.push(
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC',
      '-XX:MaxGCPauseMillis=50',
      '-XX:+AlwaysPreTouch',
      '-XX:+ParallelRefProcEnabled'
    );
    if (ramMb < 12288) {
      base.push(
        '-XX:+UseG1GC',
        '-XX:G1NewSizePercent=20',
        '-XX:G1MaxNewSizePercent=40',
        '-XX:G1HeapRegionSize=8M',
        '-XX:G1ReservePercent=20',
        '-XX:InitiatingHeapOccupancyPercent=15'
      );
    } else {
      base.push(
        '-XX:+UseG1GC',
        '-XX:G1NewSizePercent=30',
        '-XX:G1MaxNewSizePercent=50',
        '-XX:G1HeapRegionSize=16M',
        '-XX:G1ReservePercent=15',
        '-XX:InitiatingHeapOccupancyPercent=20'
      );
    }
    base.push(
      '-XX:G1HeapWastePercent=5',
      '-XX:G1MixedGCCountTarget=4',
      '-XX:G1MixedGCLiveThresholdPercent=90',
      '-XX:G1RSetUpdatingPauseTimePercent=5',
      '-XX:+UseStringDeduplication',
      '-XX:MaxTenuringThreshold=1',
      '-XX:SurvivorRatio=32'
    );
    if (ramMb >= 2048) base.push('-Xss2M');
  }
  const custom = String(store.get('jvmArgs') || '').trim();
  if (custom) base.push(...custom.split(/\s+/));
  const fromJson = [];
  // Карта подстановки для JVM-плейсхолдеров NeoForge/Forge:
  // ${library_directory}, ${classpath_separator}, ${version_name} и др.
  const jmap = {
    libraryDir: (ctx && ctx.libraryDir) || path.join(d.libraries),
    gameDir: (ctx && ctx.gameDir) || d.game,
    version: vj.id,
    nativesDir: natives,
    assetsDir: path.join(d.assets),
    assetIndex: (vj.assetIndex || {}).id || 'legacy',
    launcherName: 'st4amLauncher',
    launcherVersion: '0.1.0'
  };
  // Ванильный json заканчивается на "-cp ${classpath}" — пару пропускаем,
  // свой -cp launchVersion добавит сам после всех jvm-аргументов
  const pushJ = (v) => { if (v !== '') fromJson.push(v); };
  if (vj.arguments && Array.isArray(vj.arguments.jvm)) {
    for (let i = 0; i < vj.arguments.jvm.length; i++) {
      const a = vj.arguments.jvm[i];
      if (typeof a === 'string') {
        if (a === '-cp' && vj.arguments.jvm[i + 1] === '${classpath}') { i++; continue; }
        pushJ(subst(a, jmap));
      } else if (a.rules && rulesAllow(a.rules, 'windows') && Array.isArray(a.value)) {
        for (const v of a.value) pushJ(subst(v, jmap));
      }
    }
  } else if (vj.minecraftArguments) {
    fromJson.push('-Dlegacy.javaClasspath=');
  }
  const l4j = log4jCoreMinor(vj);
  if (l4j >= 10 && l4j < 15) base.push('-Dlog4j2.formatMsgNoLookups=true');
  return [...base, ...fromJson];
}

function log4jCoreMinor(vj) {
  for (const lib of vj.libraries || []) {
    if (lib.rules && !rulesAllow(lib.rules, 'windows')) continue;
    if (lib.name && lib.name.startsWith('org.apache.logging.log4j:log4j-core:')) {
      const v = lib.name.split(':')[2] || '';
      const m = /^2\.(\d+)/.exec(v);
      if (m) return parseInt(m[1], 10);
    }
  }
  return 0;
}

function gameArgs(vj, opts) {
  const d = dirs();
  const args = {
    username: opts.username || 'Player',
    version: vj.id,
    gameDir: opts.gameDir || d.game,
    gameAssets: opts.gameAssets || '',
    assetsDir: path.join(d.assets),
    assetIndex: (vj.assetIndex || {}).id || 'legacy',
    uuid: opts.uuid || crypto.randomUUID().replace(/-/g, ''),
    accessToken: opts.accessToken || '0',
    userType: 'legacy',
    versionType: vj.type || 'release',
    resolutionWidth: opts.resolutionW || '',
    resolutionHeight: opts.resolutionH || '',
    nativesDir: path.join(d.versions, vj.id, 'natives'),
    libraryDir: (opts.gameDir && fs.existsSync(path.join(opts.gameDir, 'libraries')))
      ? path.join(opts.gameDir, 'libraries')
      : path.join(d.libraries),
    launcherName: 'st4amLauncher',
    launcherVersion: '0.1.0',
    primaryJar: path.join(d.versions, vj.id, vj.id + '.jar')
  };
  const out = [];
  const features = {
    is_demo_user: false,
    has_custom_resolution: !!(opts.resolutionW && opts.resolutionH),
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false
  };
  if (vj.arguments && Array.isArray(vj.arguments.game)) {
    for (const a of vj.arguments.game) {
      if (typeof a === 'string') out.push(subst(a, args));
      else if (a.rules && rulesAllow(a.rules, 'windows', features) && Array.isArray(a.value)) {
        for (const v of a.value) out.push(subst(v, args));
      }
    }
  } else if (vj.minecraftArguments) {
    for (const a of vj.minecraftArguments.split(' ')) out.push(subst(a, args));
  }
  if (opts.resolutionW && opts.resolutionH) {
    out.push('--width', String(opts.resolutionW), '--height', String(opts.resolutionH));
  }
  return out;
}

function subst(s, map) {
  // Замена плейсхолдеров ВНУТРИ строк (например '-Djava.library.path=${natives_directory}'),
  // а не только строк-плейсхолдеров целиком
  const full = {
    auth_player_name: map.username, version_name: map.version, game_directory: map.gameDir,
    game_assets: map.gameAssets || '', assets_root: map.assetsDir, assets_index_name: map.assetIndex,
    auth_uuid: map.uuid, auth_access_token: map.accessToken, auth_xuid: '', clientid: '',
    user_type: map.userType, version_type: map.versionType,
    resolution_width: map.resolutionWidth || '', resolution_height: map.resolutionHeight || '',
    natives_directory: map.nativesDir || '', library_directory: map.libraryDir || '',
    game_libraries_directory: map.libraryDir || '', launcher_name: map.launcherName || '',
    launcher_version: map.launcherVersion || '', primary_jar: map.primaryJar || '',
    profile_name: map.username, user_properties: '{}', classpath_separator: ';',
    classpath_directory: map.classpathDir || '', classpath: map.classpath || ''
  };
  return String(s).replace(/\$\{([a-zA-Z0-9_]+)\}/g, (m, k) => (k in full) ? String(full[k]) : '');
}

/* ============ Version art (official launcher images) ============ */

const ART_URL = 'https://launchercontent.mojang.com/v2/javaPatchNotes.json';
// Новости берём с GitHub (см. news.json в репозитории) — без зависимости от серверов Mojang
const NEWS_URL = 'https://raw.githubusercontent.com/egorVasile/ste4amLauncher/main/news.json';
const UA = { 'User-Agent': 'st4amLauncher/0.1' };

async function getPatchNotes() {
  const cache = path.join(dirs().assets, 'screenshots', 'patchNotes.json');
  try {
    const st = fs.statSync(cache);
    if (Date.now() - st.mtimeMs < 6 * 3600 * 1000) {
      return JSON.parse(await fsp.readFile(cache, 'utf8'));
    }
  } catch (e) {}
  try {
    const buf = await httpGet(ART_URL, UA);
    const j = JSON.parse(buf.toString('utf8'));
    await fsp.mkdir(path.dirname(cache), { recursive: true });
    await fsp.writeFile(cache, JSON.stringify(j));
    return j;
  } catch (e) {
    log('patchNotes fail', e.message);
    try { return JSON.parse(await fsp.readFile(cache, 'utf8')); } catch (e2) { return { entries: [] }; }
  }
}

async function getNews() {
  const cache = path.join(dirs().assets, 'news.json');
  try {
    const st = fs.statSync(cache);
    if (Date.now() - st.mtimeMs < 6 * 3600 * 1000) {
      return JSON.parse(await fsp.readFile(cache, 'utf8'));
    }
  } catch (e) {}
  try {
    const buf = await httpGet(NEWS_URL, UA);
    const j = JSON.parse(buf.toString('utf8'));
    await fsp.writeFile(cache, JSON.stringify(j));
    return j;
  } catch (e) {
    log('news fail', e.message);
    try { return JSON.parse(await fsp.readFile(cache, 'utf8')); } catch (e2) { return { entries: [] }; }
  }
}

async function defaultWallpaper() {
  const d = dirs();
  const candidates = [
    path.join(d.root, 'default_wallpaper.png'),
    path.join(d.assets, 'default_wallpaper.png')
  ];
  for (const w of candidates) {
    if (fs.existsSync(w)) return w;
  }
  return null;
}

const ART_OVERRIDES = {
  '1.20': 'https://launchercontent.mojang.com/images/5jduuXO70xxs9XbpOIKVHZ-MinecraftTrails&TalesLauncher700x466.jpeg',
  '1.20.1': 'https://launchercontent.mojang.com/images/5jduuXO70xxs9XbpOIKVHZ-MinecraftTrails&TalesLauncher700x466.jpeg',
  '1.21.5': 'https://launchercontent.mojang.com/v2/images/MCVSpringDropMinecraftLauncher700x466.jpg',
  '1.21.6': 'https://launchercontent.mojang.com/v2/images/MCVSummerDropSecondaryLauncher700x4661.png',
  '1.21.7': 'https://launchercontent.mojang.com/v2/images/MCVSummerDropSecondaryLauncher700x4661.png',
  '1.21.8': 'https://launchercontent.mojang.com/v2/images/MCVSummerDropSecondaryLauncher700x4661.png',
  '1.21.9': 'https://launchercontent.mojang.com/v2/images/MinecraftFallDropCampaignKeyArtMinecraftLauncher700x466.png',
  '1.21.10': 'https://launchercontent.mojang.com/v2/images/MinecraftFallDropCampaignKeyArtMinecraftLauncher700x466.png',
  '1.21.11': 'https://launchercontent.mojang.com/v2/images/MinecraftMountsOfMayhemLauncher700x466.png',
  '26.1': 'https://launchercontent.mojang.com/v2/images/SpringDrop2026Launcher700x466.png',
  '26.1.1': 'https://launchercontent.mojang.com/v2/images/SpringDrop2026Launcher700x466.png',
  '26.1.2': 'https://launchercontent.mojang.com/v2/images/SpringDrop2026Launcher700x466.png',
  '26.2': 'https://launchercontent.mojang.com/v2/images/MCVSummerDropKeyArtMinecraftLauncher700x466v2.png'
};

async function versionScreenshot(id, wide) {
  const d = dirs();
  const dir = path.join(d.assets, 'screenshots');
  const file = path.join(dir, id + (wide ? '_w' : '') + '.png');
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
  try {
    const put = async (url) => {
      await fsp.mkdir(dir, { recursive: true });
      const img = await httpGet(url, UA);
      if (img && img.length >= 1000) {
        await fsp.writeFile(file, img);
        return file;
      }
      return null;
    };
    const over = ART_OVERRIDES[String(id)];
    if (over) {
      const got = await put(over);
      if (got) return got;
    }
    const clean = String(id).replace(/[^0-9.]/g, '');
    const notes = await getPatchNotes();
    const entries = notes.entries || [];
    let entry = null;
    for (const e of entries) {
      if (e.version === id || (clean && e.version === clean)) { entry = e; break; }
    }
    if (entry && entry.image && entry.image.url) {
      const got = await put('https://launchercontent.mojang.com' + entry.image.url);
      if (got) return got;
    }
  } catch (e) {
    log('screenshot fail', id, e.message);
  }
  return defaultWallpaper();
}

/* ============ Main entry ============ */

let currentProcess = null;

async function launchVersion(opts, onEvent) {
  if (currentProcess) throw new Error('Игра уже запущена');
  const { dlog } = require('./debuglog');
  const emit = (type, data) => {
    if (type === 'log' && data && data.line) dlog('[лог]', String(data.line));
    else if (type === 'stage') dlog('[этап]', (data && data.stage) || '', data && Math.round((data.pct || 0) * 100) + '%');
    else if (type === 'error') dlog('[ОШИБКА]', data);
    else if (type === 'exit') dlog('[выход] код', data && data.code);
    else if (type === 'diagnosis') dlog('[диагноз]', JSON.stringify(data).slice(0, 2000));
    onEvent && onEvent(type, data);
  };
  dlog('===== ЗАПУСК ИГРЫ =====', 'version:', opts.version, '| buildId:', opts.buildId || '-', '| ник:', opts.username || '-', '| RAM:', opts.ram, 'GB');

  const vj = await getVersionJson(opts.version);
  const wantJava = javaVersionNeeded(vj);
  emit('stage', { stage: wantJava ? 'ПРОВЕРКА JAVA ' + wantJava : 'ПРОВЕРКА JAVA', pct: 0 });
  const java = await findJavaFor(vj, (fr) => {
    emit('stage', { stage: 'СКАЧИВАНИЕ JAVA ' + wantJava, pct: fr * 0.04 });
  });
  if (!java) {
    const want = javaVersionNeeded(vj);
    emit('error', {
      message: want
        ? `Для версии ${vj.id} нужна Java ${want}. Установите её или укажите путь в настройках`
        : 'Java не найдена. Установите Java 21 с https://adoptium.net'
    });
    return;
  }
  emit('log', { line: '> java: ' + java });

  emit('stage', { stage: 'СКАЧИВАНИЕ КЛИЕНТА', pct: 0.05 });
  const d = dirs();
  const gameDir = opts.buildId
    ? path.join(d.root, 'builds', opts.buildId, 'game')
    : d.game;
  const clientJar = path.join(d.versions, vj.id, vj.id + '.jar');
  const cInfo = vj.downloads && vj.downloads.client;
  let needClient = true;
  if (fs.existsSync(clientJar)) {
    try {
      const st = fs.statSync(clientJar);
      if (cInfo && cInfo.size) needClient = st.size !== cInfo.size;
      else if (st.size > 1000000) needClient = false;
    } catch (e) {}
  }
  if (needClient) {
    const cUrl = cInfo && cInfo.url;
    if (!cUrl) throw new Error('Нет URL клиента в манифесте');
    emit('log', { line: '> скачивание клиента ' + vj.id + ' (' + Math.round((cInfo && cInfo.size || 0) / 1048576) + ' MB)...' });
    await downloadMirrored(rewriteUrl(cUrl), clientJar, (p) => {
      emit('stage', { stage: 'СКАЧИВАНИЕ КЛИЕНТА', pct: 0.05 + p * 0.1 });
    });
  } else {
    emit('log', { line: '> клиент ' + vj.id + ' уже на месте' });
  }

  const indexFile = await ensureAssets(vj, (stage, pct) => emit('stage', { stage, pct: 0.15 + pct * 0.5 }));
  const virtAssets = await ensureVirtualAssets(vj, indexFile, gameDir);
  await ensureLibraries(vj, (stage, pct) => emit('stage', { stage, pct: 0.65 + pct * 0.3 }));
  await extractNatives(vj);
  emit('stage', { stage: 'ПОДГОТОВКА', pct: 0.96 });

  const cp0 = vj.arguments && Array.isArray(vj.arguments.jvm) ? vj.arguments.jvm : [];
  const moduleJars = new Set();
  for (let i = 0; i < cp0.length; i++) {
    if (cp0[i] === '-p' && typeof cp0[i + 1] === 'string') {
      // пути разделены ; или плейсхолдером ${classpath_separator} (в сыром json)
      String(cp0[i + 1]).split(/;|\$\{classpath_separator\}/).forEach(x => {
        const b = path.basename(x.trim());
        if (b && b.indexOf('${') === -1) moduleJars.add(b);
      });
    }
  }
  const cp = buildClasspath(vj, moduleJars);
  const jreMajor = await javaMajor(java);
  const jvm = jvmArgs(vj, opts.ram || 2, jreMajor, {
    // У сборок Forge/NeoForge модульные джарники лежат в libraries самой сборки
    libraryDir: opts.buildId && fs.existsSync(path.join(gameDir, 'libraries'))
      ? path.join(gameDir, 'libraries')
      : path.join(d.libraries),
    gameDir
  });
  const gargs = gameArgs(vj, { ...opts, gameDir, gameAssets: virtAssets });
  const all = [...jvm, '-cp', cp, vj.mainClass || 'net.minecraft.client.main.Main', ...gargs];
  const an = (vj.assetIndex || {}).id || 'legacy';
  emit('log', { line: `> assets: ${path.join(d.assets)} index: ${an} gameDir: ${gameDir}` });
  emit('log', { line: '> java ' + all.join(' ') });

  await fsp.mkdir(gameDir, { recursive: true });
  emit('stage', { stage: 'ЗАПУСК', pct: 1 });
  emit('log', { line: '> Minecraft ' + vj.id + ' запускается...' });

  const env = { ...process.env, _JAVA_OPTIONS: '' };
  currentProcess = spawn(java, all, {
    cwd: gameDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false
  });
  // Буфер вывода для анализа ошибок после падения
  let outBuf = '';
  const BUF_MAX = 200000;
  const onOut = (c) => {
    const s = c.toString();
    outBuf = (outBuf + s).slice(-BUF_MAX);
    emit('log', { line: s.trimEnd() });
  };
  currentProcess.stdout.on('data', onOut);
  currentProcess.stderr.on('data', onOut);
  currentProcess.on('close', (code) => {
    emit('log', { line: '> Процесс завершён (код ' + code + ')' });
    emit('exit', { code });
    currentProcess = null;
    // При падении с ошибкой — автоматический анализ (мод-ошибки, OOM, Java и т.д.)
    if (code !== 0) {
      try {
        const diag = require('./diag');
        diag.analyze({ buildId: opts.buildId, gameDir, logBuffer: outBuf })
          .then(report => {
            if (report && report.problems && report.problems.length) emit('diagnosis', report);
          })
          .catch(e => log('diagnosis error', e && e.message));
      } catch (e) { log('diag require error', e && e.message); }
      // Хвост лога игры в файл (для анализа после закрытия лаунчера)
      try {
        dlog('[хвост вывода игры]', String(outBuf).slice(-4000));
        const hs = path.join(gameDir, 'hs_err_pid*.log');
        const files = fs.existsSync(path.dirname(hs)) ? fs.readdirSync(path.dirname(hs)).filter(f => f.startsWith('hs_err_pid')) : [];
        for (const f of files) {
          try {
            const full = path.join(gameDir, f);
            dlog('[краш-файл ' + f + ']', fs.readFileSync(full, 'utf8').split(/\r?\n/).slice(0, 40).join('\n'));
            break;
          } catch (e) {}
        }
      } catch (e) {}
    }
  });
  emit('started', { pid: currentProcess.pid });
  return currentProcess.pid;
}

function stopGame() {
  if (currentProcess) {
    try { currentProcess.kill(); } catch (e) {}
    return true;
  }
  return false;
}

function gameRunning() {
  return !!currentProcess;
}

module.exports = {
  setRoot, dirs, listVersions, getVersionJson, launchVersion, stopGame, gameRunning, findJava, versionScreenshot, checkNet
};
