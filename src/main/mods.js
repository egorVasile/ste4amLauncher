'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { app } = require('electron');
const store = require('./store');

const MR = 'https://api.modrinth.com/v2';
const CDN = 'https://cdn.modrinth.com';
const FABRIC_META = 'https://meta.fabricmc.net/v2';
const QUILT_META = 'https://meta.quiltmc.org/v3';
const UA = 'st4amLauncher/1.0.0';

let ROOT = path.join(app.getPath('appData'), '.st4amlauncher');
function setRoot(dir) { ROOT = dir; }

function log(...a) { console.log('[mods]', ...a); }

function httpGet(url, headers = {}, tries = 5) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(httpGet(res.headers.location, headers, tries));
          res.resume();
          return;
        }
        if (res.statusCode === 429) {
          const reset = parseInt(res.headers['x-ratelimit-reset'] || '2', 10);
          res.resume();
          if (n < tries) {
            log('429 Modrinth, ожидание', reset, 'с');
            setTimeout(() => attempt(n + 1), Math.max(reset, 1) * 1000);
          } else {
            reject(new Error('HTTP 429 (rate limit) для ' + url));
          }
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
      req.setTimeout(60000, () => req.destroy(new Error('timeout ' + url)));
    };
    attempt(0);
  });
}

async function downloadFile(url, dest, onProgress) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const res = await new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': UA } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        const redir = r.headers.location;
        resolve((async () => {
          const b = await httpGet(redir);
          return { buffer: b };
        })());
        r.resume();
        return;
      }
      if (r.statusCode !== 200) { r.resume(); reject(new Error(`HTTP ${r.statusCode} ${url}`)); return; }
      resolve({ stream: r });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout ' + url)));
  });
  if (res.buffer) {
    await fsp.writeFile(tmp, res.buffer);
  } else {
    await new Promise((resolve, reject) => {
      const total = parseInt(res.stream.headers['content-length'] || '0', 10);
      let got = 0;
      const out = fs.createWriteStream(tmp);
      res.stream.on('data', (c) => {
        got += c.length;
        if (onProgress && total) onProgress(got / total);
      });
      res.stream.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      res.stream.on('error', reject);
    });
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await fsp.copyFile(tmp, dest);
      await fsp.unlink(tmp).catch(() => {});
      if (onProgress) onProgress(1);
      return dest;
    } catch (e) {
      if (attempt === 3) {
        try { await fsp.rename(tmp, dest); return dest; } catch (e2) { throw e2; }
      }
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

async function mr(pathname, qs) {
  const q = qs ? '?' + new URLSearchParams(qs) : '';
  const buf = await httpGet(MR + pathname + q);
  return JSON.parse(buf.toString('utf8'));
}

/* ============ Кеширование меты (ускорение создания сборок) ============ */

const CACHE_TTL = {
  manifest: 6 * 3600 * 1000,      // version_manifest_v2.json
  loaderList: 24 * 3600 * 1000,   // списки загрузчиков Fabric/Quilt
  profile: 24 * 3600 * 1000,      // профили загрузчиков
  mavenXml: 6 * 3600 * 1000       // maven-metadata.xml
};

async function cacheRead(name, ttl) {
  const p = path.join(ROOT, 'cache', name);
  try {
    const st = fs.statSync(p);
    if (Date.now() - st.mtimeMs < ttl) return await fsp.readFile(p, 'utf8');
  } catch (e) {}
  return null;
}

async function cacheWrite(name, text) {
  try {
    await fsp.mkdir(path.join(ROOT, 'cache'), { recursive: true });
    await fsp.writeFile(path.join(ROOT, 'cache', name), text);
  } catch (e) {}
}

async function cachedJson(url, name, ttl) {
  const hit = await cacheRead(name, ttl);
  if (hit !== null) { try { return JSON.parse(hit); } catch (e) {} }
  const buf = await httpGet(url);
  const j = JSON.parse(buf.toString('utf8'));
  await cacheWrite(name, JSON.stringify(j));
  return j;
}

async function cachedText(url, name, ttl) {
  const hit = await cacheRead(name, ttl);
  if (hit !== null) return hit;
  const buf = await httpGet(url);
  const txt = buf.toString('utf8');
  await cacheWrite(name, txt);
  return txt;
}

async function cachedManifest() {
  return cachedJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json', 'version_manifest.json', CACHE_TTL.manifest);
}

/* ============ Modrinth: каталог ============ */

async function mrSearch({ query, facets, limit = 30, offset = 0 }) {
  const f = facets || [];
  const body = {
    query: query || '',
    facets: JSON.stringify(f),
    limit, offset,
    index: 'relevance'
  };
  const buf = await httpGet(MR + '/search?' + new URLSearchParams(body));
  return JSON.parse(buf.toString('utf8'));
}

async function mrProject(slug) {
  return mr('/project/' + encodeURIComponent(slug));
}

async function mrProjectVersions(slug, gameVersion, loader) {
  const qs = {};
  if (gameVersion) qs.game_versions = JSON.stringify([gameVersion]);
  if (loader) qs.loaders = JSON.stringify([loader]);
  return mr('/project/' + encodeURIComponent(slug) + '/version', qs);
}

async function mrVersion(versionId) {
  return mr('/version/' + encodeURIComponent(versionId));
}

async function mrCategories() {
  return mr('/tag/category');
}

async function mrLoaders() {
  return mr('/tag/loader');
}

async function mrGameVersions() {
  return mr('/tag/game_version');
}

async function mrBatchProjects(ids) {
  if (!ids || !ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    out.push(...await mr('/projects', { ids: JSON.stringify(ids.slice(i, i + 100)) }));
  }
  return out;
}

async function mrBatchVersions(ids) {
  if (!ids || !ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    out.push(...await mr('/versions', { ids: JSON.stringify(ids.slice(i, i + 100)) }));
  }
  return out;
}

/* ============ Сборки ============ */

function buildsFile() { return path.join(ROOT, 'builds.json'); }
function buildDir(id) { return path.join(ROOT, 'builds', id); }

async function loadBuilds() {
  try { return JSON.parse(await fsp.readFile(buildsFile(), 'utf8')); } catch (e) { return []; }
}

async function saveBuilds(builds) {
  await fsp.writeFile(buildsFile(), JSON.stringify(builds, null, 2));
}

async function buildsList() {
  const builds = await loadBuilds();
  for (const b of builds) {
    b.modCount = await countMods(b.id, 'mod') + await countMods(b.id, 'resourcepack') + await countMods(b.id, 'shaderpack') + await countMods(b.id, 'datapack');
    b.totalSize = await dirSize(path.join(buildDir(b.id), 'game'));
  }
  return builds;
}

async function countMods(id, type) {
  const d = type === 'mod' ? modsDir(id) : packsDir(id, type);
  try {
    let n = 0;
    for (const f of fs.readdirSync(d)) if (f.endsWith('.jar') || f.endsWith('.zip')) n++;
    return n;
  } catch (e) { return 0; }
}

async function dirSize(dir) {
  let total = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      total += fs.statSync(path.join(dir, f)).size;
    }
  } catch (e) {}
  return total;
}

async function buildCreate({ name, gameVersion, loader, icon, onProgress }) {
  const builds = await loadBuilds();
  const id = 'build-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const b = { id, name: String(name || '').trim() || 'Моя сборка', gameVersion, loader, icon: icon || 'Grass.png', created: Date.now() };
  const bdir = buildDir(id);
  await fsp.mkdir(path.join(bdir, 'game', 'mods'), { recursive: true });
  await fsp.mkdir(path.join(bdir, 'game', 'resourcepacks'), { recursive: true });
  await fsp.mkdir(path.join(bdir, 'game', 'shaderpacks'), { recursive: true });
  await fsp.mkdir(path.join(bdir, 'game', 'datapacks'), { recursive: true });
  await fsp.mkdir(path.join(bdir, 'game'), { recursive: true });

  const vj = await installLoader(b, gameVersion, loader, onProgress);
  b.versionJsonId = vj.id;
  builds.unshift(b);
  await saveBuilds(builds);
  return b;
}

async function installLoader(build, gameVersion, loader, onProgress) {
  const L = loader.toLowerCase();
  if (L === 'fabric' || L === 'quilt') {
    const meta = L === 'fabric' ? FABRIC_META : QUILT_META;
    const url = L === 'fabric'
      ? `${FABRIC_META}/versions/loader/${gameVersion}`
      : `${QUILT_META}/versions/loader/${gameVersion}`;
    const list = await cachedJson(url, 'loader-list-' + L + '-' + gameVersion + '.json', CACHE_TTL.loaderList);
    if (!list.length) throw new Error('Нет загрузчиков для ' + gameVersion);
    const loaderVer = list[0].loader.version;
    const profileUrl = `${meta}/versions/loader/${gameVersion}/${loaderVer}/profile/json`;
    const profile = await cachedJson(profileUrl, 'loader-profile-' + L + '-' + gameVersion + '-' + loaderVer + '.json', CACHE_TTL.profile);
    profile.id = build.id;
    profile.mainClass = L === 'fabric'
      ? 'net.fabricmc.loader.impl.launch.knot.KnotClient'
      : 'org.quiltmc.loader.impl.launch.knot.KnotClient';
    profile.libraries = profile.libraries || [];
    for (const lib of profile.libraries) {
      if (!lib.artifact && lib.url && lib.name) {
        const p = lib.name.split(':');
        lib.artifact = {
          path: p[0].split('.').join('/') + '/' + p[1] + '/' + p[2] + '/' + p[1] + '-' + p[2] + '.jar',
          size: lib.size, sha1: lib.sha1,
          url: lib.url + p[0].split('.').join('/') + '/' + p[1] + '/' + p[2] + '/' + p[1] + '-' + p[2] + '.jar'
        };
        delete lib.size; delete lib.sha1; delete lib.md5; delete lib.url;
      }
    }
    await writeVersionJson(build, gameVersion, profile);
    return profile;
  }
  if (L === 'neoforge' || L === 'forge') {
    const vj = await installForgeLike(build, gameVersion, L, onProgress);
    return vj;
  }
  throw new Error('Неизвестный загрузчик: ' + loader);
}

async function writeVersionJson(build, gameVersion, profile) {
  const vdir = path.join(ROOT, 'versions', build.id);
  await fsp.mkdir(vdir, { recursive: true });
  const base = await readBaseVersion(gameVersion);
  profile.downloads = base.downloads;
  profile.assetIndex = base.assetIndex;
  profile.assets = base.assets;
  profile.javaVersion = base.javaVersion;
  profile.type = 'release';
  profile.minecraftVersion = gameVersion;
  profile.libraries = [...(base.libraries || []), ...(profile.libraries || [])];
  if (!profile.arguments) profile.arguments = {};
  if (!Array.isArray(profile.arguments.game) || profile.arguments.game.length === 0) {
    profile.arguments.game = base.arguments && Array.isArray(base.arguments.game) ? base.arguments.game : [];
  }
  if (!Array.isArray(profile.arguments.jvm) || profile.arguments.jvm.length === 0) {
    profile.arguments.jvm = base.arguments && Array.isArray(base.arguments.jvm) ? base.arguments.jvm : [];
  }
  await fsp.writeFile(path.join(vdir, build.id + '.json'), JSON.stringify(profile, null, 2));
}

async function readBaseVersion(gameVersion) {
  const cache = path.join(ROOT, 'versions', gameVersion, gameVersion + '.json');
  try { return JSON.parse(await fsp.readFile(cache, 'utf8')); } catch (e) {}
  const manifest = await cachedManifest();
  const v = (manifest.versions || []).find(x => x.id === gameVersion);
  if (!v) throw new Error('Версия не найдена: ' + gameVersion);
  const buf = await httpGet(v.url);
  const vj = JSON.parse(buf.toString('utf8'));
  await fsp.mkdir(path.dirname(cache), { recursive: true });
  await fsp.writeFile(cache, JSON.stringify(vj));
  return vj;
}

async function ensureFakeLauncherProfile(gameDir) {
  const p = path.join(gameDir, 'launcher_profiles.json');
  if (fs.existsSync(p)) return;
  await fsp.mkdir(gameDir, { recursive: true });
  const data = {
    profiles: {},
    settings: {
      enableSnapshots: false,
      enableAdvanced: false,
      keepLauncherOpen: false,
      soundOn: false,
      showGameLog: false,
      enableHistorical: false,
      enableReleases: true,
      profileSorting: 'ByLastPlayed',
      showMenu: false,
      crashAssistance: true
    },
    version: 3
  };
  await fsp.writeFile(p, JSON.stringify(data, null, 2));
}

async function installForgeLike(build, gameVersion, loader, onProgress) {
  const isNeo = loader === 'neoforge';
  let installerUrl = null;
  let installerName = null;
  if (isNeo) {
    const xml = await cachedText('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', 'maven-neoforge.xml', CACHE_TTL.mavenXml);
    const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
    const ver = pickLoaderVersion(all, gameVersion, true);
    if (!ver) throw new Error('NeoForge не поддерживает ' + gameVersion);
    installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${ver}/neoforge-${ver}-installer.jar`;
    installerName = `neoforge-${ver}-installer.jar`;
  } else {
    const xml = await cachedText('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml', 'maven-forge.xml', CACHE_TTL.mavenXml);
    const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
    const ver = pickLoaderVersion(all, gameVersion, false);
    if (!ver) throw new Error('Forge не поддерживает ' + gameVersion);
    installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${ver}/forge-${ver}-installer.jar`;
    installerName = `forge-${ver}-installer.jar`;
  }
  const bdir = buildDir(build.id);
  const installerPath = path.join(bdir, installerName);
  const cacheInstall = path.join(ROOT, 'cache', 'installers', installerName);
  if (onProgress) onProgress(0.03, 'Скачивание установщика ' + loader + '...');
  if (!fs.existsSync(cacheInstall) || fs.statSync(cacheInstall).size === 0) {
    await downloadFile(installerUrl, cacheInstall, (p) => onProgress && onProgress(0.05 + p * 0.25, 'Скачивание установщика ' + loader + '...'));
  } else {
    log('installer из кеша:', installerName);
    if (onProgress) onProgress(0.3, 'Установщик из кеша');
  }
  try { await fsp.copyFile(cacheInstall, installerPath); } catch (e) {}
  const needMajor = forgeJavaMajor(gameVersion);
  let java = await findJavaMajor(needMajor);
  if (!java) {
    if (onProgress) onProgress(0.31, 'Скачивание Java ' + needMajor + '...');
    java = await ensureJavaRuntime(needMajor, (p) => onProgress && onProgress(0.31 + p * 0.45, 'Скачивание Java ' + needMajor + '...'));
  }
  const gameDir = path.join(bdir, 'game');
  await ensureFakeLauncherProfile(gameDir);
  if (onProgress) onProgress(0.78, 'Установка ' + loader + ' (это занимает минуту)...');
  log('запуск установщика', installerName, 'java:', java);
  await new Promise((resolve, reject) => {
    const p = spawn(java, ['-jar', installerPath, '--installClient', gameDir], { windowsHide: true });
    let out = '';
    let last = Date.now();
    const tick = setInterval(() => { if (onProgress) onProgress(Math.min(0.97, 0.78 + (Date.now() - last) / 60000 * 0.18), 'Установка ' + loader + ' (это занимает минуту)...'); }, 250);
    p.stdout.on('data', c => { out += c.toString(); });
    p.stderr.on('data', c => out += c.toString());
    p.on('error', (e) => { clearInterval(tick); reject(e); });
    p.on('close', (code) => {
      clearInterval(tick);
      if (code === 0) resolve();
      else reject(new Error('Установка ' + loader + ' не удалась (код ' + code + '): ' + out.slice(-300)));
    });
  });
  const profile = await buildForgeProfile(build, gameVersion, isNeo);
  await writeVersionJson(build, gameVersion, profile);
  if (onProgress) onProgress(1);
  return profile;
}

function pickLoaderVersion(all, gameVersion, isNeo) {
  const num = (v) => {
    const segs = v.split(/[-.]/).map(s => parseInt(s, 10) || 0);
    let n = 0;
    for (let i = 0; i < segs.length; i++) n += (segs[i] || 0) * Math.pow(100000, 8 - Math.min(i, 8));
    return n;
  };
  const vers = all.filter(v => isNeo ? /^[\d.]+$/.test(v) : v.startsWith(gameVersion + '-'));
  vers.sort((a, b) => num(b) - num(a));
  if (isNeo) {
    const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(gameVersion);
    let prefix = null;
    if (m) {
      if (m[1] === '1' && m[3]) prefix = `${m[2]}.${m[3]}.`;
      else if (m[1] === '1') prefix = `${m[2]}.`;
      else prefix = `${m[1]}.${m[2]}.`;
    }
    return vers.find(v => prefix && v.startsWith(prefix)) || null;
  }
  return vers[0] || null;
}

function forgeJavaMajor(gameVersion) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(gameVersion);
  if (!m) return 21;
  const ma = parseInt(m[1], 10), mi = parseInt(m[2], 10), pa = m[3] ? parseInt(m[3], 10) : null;
  const ver = ma === 1 ? mi + (pa ? pa / 10 : 0) : ma + mi / 100;
  if (ver < 17) return 8;
  if (ver < 20.5) return 17;
  return 21;
}

async function buildForgeProfile(build, gameVersion, isNeo) {
  const base = await readBaseVersion(gameVersion);
  const bdir = buildDir(build.id);
  const gameDir = path.join(bdir, 'game');
  const libraries = [];
  const libRoot = path.join(gameDir, 'libraries');
  if (fs.existsSync(libRoot)) {
    for (const group of fs.readdirSync(libRoot)) {
      collectLibs(path.join(libRoot, group), group, libraries);
    }
  }
  let mainClass = isNeo ? 'net.neoforged.bootstrap.Bootstrap' : 'cpw.mods.bootstraplauncher.Bootstrap';
  let argumentsGame = base.arguments;
  try {
    const vdir = path.join(gameDir, 'versions');
    if (fs.existsSync(vdir)) {
      for (const n of fs.readdirSync(vdir)) {
        const p = path.join(vdir, n, n + '.json');
        if (fs.existsSync(p)) {
          const vj = JSON.parse(await fsp.readFile(p, 'utf8'));
          if (vj && vj.mainClass) {
            mainClass = vj.mainClass;
            if (vj.arguments && Array.isArray(vj.arguments.game)) argumentsGame = vj.arguments;
          }
          break;
        }
      }
    }
  } catch (e) {}
  const profile = {
    id: build.id,
    mainClass,
    libraries,
    arguments: argumentsGame,
    type: 'release',
    minecraftVersion: gameVersion
  };
  return profile;
}

function collectLibs(dir, prefix, out) {
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      collectLibs(p, prefix + '/' + e, out);
    } else if (e.endsWith('.jar')) {
      const rel = path.join(prefix, e).split('/').join('/');
      out.push({
        name: rel.replace(/\.jar$/, ''),
        artifact: { path: rel, size: st.size, url: null, absPath: p }
      });
    }
  }
}

function findJava() {
  const cfg = store.get('javaPath');
  if (cfg && fs.existsSync(cfg)) return cfg;
  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'));
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  for (const r of [pf, pfx]) {
    try {
      for (const n of fs.readdirSync(r)) {
        if (/^(java|jdk|jre|zulu|temurin|corretto|Microsoft|Eclipse Adoptium|Amazon Corretto|ojdkbuild)/i.test(n)) {
          const p = path.join(r, n, 'bin', 'java.exe');
          if (fs.existsSync(p)) candidates.push(p);
        }
      }
    } catch (e) {}
  }
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('where', ['java'], { encoding: 'utf8' });
    for (const line of out.split(/\r?\n/)) if (line.trim()) candidates.push(line.trim());
  } catch (e) {}
  const seen = new Set();
  for (const c of candidates) seen.add(path.resolve(c).toLowerCase());
  return [...seen][0] || null;
}

function javaCandidates() {
  const out = [];
  const seen = new Set();
  const add = (p) => {
    if (!p) return;
    const k = path.resolve(p).toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  };
  const cfg = store.get('javaPath');
  if (cfg && fs.existsSync(cfg)) add(cfg);
  if (process.env.JAVA_HOME) add(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'));
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  for (const r of [pf, pfx]) {
    try {
      for (const n of fs.readdirSync(r)) {
        if (/^(java|jdk|jre|zulu|temurin|corretto|Microsoft|Eclipse Adoptium|Amazon Corretto|ojdkbuild)/i.test(n)) {
          add(path.join(r, n, 'bin', 'java.exe'));
          add(path.join(r, n, 'jre', 'bin', 'java.exe'));
        }
      }
    } catch (e) {}
  }
  const officialRuntime = path.join(pf, 'Minecraft Launcher', 'runtime');
  try {
    for (const n of fs.readdirSync(officialRuntime)) {
      add(path.join(officialRuntime, n, 'bin', 'java.exe'));
    }
  } catch (e) {}
  const appData = process.env.APPDATA || '';
  const tlJre = path.join(appData, '.tlauncher', 'legacy', 'Minecraft', 'jre');
  try {
    if (fs.existsSync(tlJre)) {
      for (const n of fs.readdirSync(tlJre)) {
        if (n.startsWith('java-runtime-')) {
          add(path.join(tlJre, n, 'windows-x64', n, 'bin', 'java.exe'));
        }
      }
      add(path.join(tlJre, 'bin', 'java.exe'));
    }
  } catch (e) {}
  try {
    const jr = path.join(ROOT, 'java');
    for (const n of fs.readdirSync(jr)) {
      add(path.join(jr, n, 'bin', 'java.exe'));
    }
  } catch (e) {}
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('where', ['java'], { encoding: 'utf8' });
    for (const line of out.split(/\r?\n/)) if (line.trim()) add(line.trim());
  } catch (e) {}
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

async function findJavaMajor(major) {
  for (const p of javaCandidates()) {
    const m = await javaMajor(p);
    if (m === major) return p;
  }
  return null;
}

function execOut(cmd, args, opts) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (ok) => { if (!done) { done = true; resolve(ok); } };
    try {
      const p = spawn(cmd, args, { windowsHide: true, ...opts });
      p.on('error', () => fin(false));
      p.on('close', (code) => fin(code === 0));
      setTimeout(() => { try { p.kill(); } catch (e) {} fin(false); }, 300000);
    } catch (e) { fin(false); }
  });
}

async function downloadFileStream(url, dest, onProgress) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  let current = url;
  for (let i = 0; i < 8; i++) {
    const ok = await new Promise((resolve) => {
      const mod = current.startsWith('https') ? https : http;
      const req = mod.get(current, { headers: { 'User-Agent': UA } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          current = r.headers.location;
          r.resume();
          resolve(false);
          return;
        }
        if (r.statusCode !== 200) { r.resume(); resolve(false); return; }
        const total = parseInt(r.headers['content-length'] || '0', 10);
        let got = 0;
        const out = fs.createWriteStream(tmp);
        r.on('data', (c) => {
          got += c.length;
          if (onProgress && total) onProgress(got / total);
        });
        r.pipe(out);
        out.on('finish', () => resolve(true));
        out.on('error', () => resolve(false));
        r.on('error', () => resolve(false));
      });
      req.on('error', () => resolve(false));
      req.setTimeout(120000, () => { try { req.destroy(); } catch (e) {} resolve(false); });
    });
    if (ok) {
      await fsp.copyFile(tmp, dest).catch(() => fsp.rename(tmp, dest));
      await fsp.unlink(tmp).catch(() => {});
      if (onProgress) onProgress(1);
      return dest;
    }
    if (current === url) break;
  }
  throw new Error('Не удалось скачать ' + url);
}

const AZUL_API = (major) => `https://api.azul.com/metadata/v1/zulu/packages/?java_version=${major}&os=windows&arch=x64&java_package_type=jre&archive_type=zip&latest=true&release_status=ga&availability_types=CA&page_size=1`;

async function azulJreUrl(major) {
  const buf = await httpGet(AZUL_API(major));
  const arr = JSON.parse(buf.toString('utf8'));
  if (!Array.isArray(arr) || !arr.length || !arr[0].download_url) throw new Error('Azul не вернул JRE ' + major);
  return arr[0].download_url;
}

async function ensureJavaRuntime(major, onProgress) {
  const javaRoot = path.join(ROOT, 'java');
  const home = path.join(javaRoot, String(major));
  const exe = path.join(home, 'bin', 'java.exe');
  if (fs.existsSync(exe)) return exe;
  await fsp.mkdir(javaRoot, { recursive: true });
  const zip = path.join(javaRoot, 'jre-' + major + '.zip');
  if (fs.existsSync(zip) && fs.statSync(zip).size > 100000) {
    log('jre-' + major + '.zip из кеша');
  } else {
    log('поиск ссылки JRE', major, 'на Azul CDN');
    if (onProgress) onProgress(0.03);
    let src;
    try { src = await azulJreUrl(major); }
    catch (e) {
      log('Azul недоступен, фолбэк на Adoptium:', e.message);
      src = `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jre/hotspot/normal/eclipse`;
    }
    await downloadFileStream(src, zip, (p) => onProgress && onProgress(0.03 + 0.92 * p));
  }
  if (onProgress) onProgress(0.96);
  const tmp = path.join(javaRoot, 'tmp-' + major + '-' + Date.now());
  await fsp.mkdir(tmp, { recursive: true });
  const ok = await execOut('powershell.exe', [
    '-NoProfile', '-Command',
    'Expand-Archive -LiteralPath ' + JSON.stringify(zip) + ' -DestinationPath ' + JSON.stringify(tmp) + ' -Force'
  ]);
  if (!ok) throw new Error('Не удалось распаковать Java ' + major);
  let src = null;
  try {
    for (const n of fs.readdirSync(tmp)) {
      const p = path.join(tmp, n, 'bin', 'java.exe');
      if (fs.existsSync(p)) { src = path.join(tmp, n); break; }
    }
  } catch (e) {}
  if (!src) throw new Error('Содержимое Java ' + major + ' не найдено после распаковки');
  await fsp.rename(src, home);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  await fsp.unlink(zip).catch(() => {});
  log('Java', major, 'установлена:', exe);
  return exe;
}

/* ============ Моды в сборке ============ */

function modsDir(id) { return path.join(buildDir(id), 'game', 'mods'); }
const PACK_DIRS = { resourcepack: 'resourcepacks', shaderpack: 'shaderpacks', datapack: 'datapacks' };
function packsDir(id, type) { return path.join(buildDir(id), 'game', PACK_DIRS[type] || type); }

async function installedMods(buildId, type) {
  const dir = (type && type !== 'mod') ? packsDir(buildId, type) : modsDir(buildId);
  const out = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      out.push({ filename: f, size: st.size });
    }
  } catch (e) {}
  return out;
}

async function installProject({ buildId, project, versionId, withDeps, type = 'mod', onProgress }) {
  const build = (await loadBuilds()).find(b => b.id === buildId);
  if (!build) throw new Error('Сборка не найдена');
  const isMod = type === 'mod';
  const dir = isMod ? modsDir(buildId) : packsDir(buildId, type);
  await fsp.mkdir(dir, { recursive: true });
  const loader = isMod ? build.loader.toLowerCase() : null;
  const queue = [];
  const seen = new Set();
  const verCache = new Map();
  async function pushDep(projectId) {
    if (seen.has(projectId)) return;
    seen.add(projectId);
    let vers = verCache.get(projectId);
    if (!vers) {
      const qs = { game_versions: JSON.stringify([build.gameVersion]) };
      if (loader) qs.loaders = JSON.stringify([loader]);
      vers = await mr('/project/' + encodeURIComponent(projectId) + '/version', qs);
      verCache.set(projectId, vers);
    }
    const v = vers && vers[0];
    if (!v || !v.files || !v.files[0]) return;
    queue.push({ projectId, version: v });
  }
  async function pushMain() {
    const v = versionId
      ? await mrVersion(versionId)
      : (await mrProjectVersions(project, build.gameVersion, loader))[0];
    if (!v || !v.files || !v.files[0]) throw new Error('Нет подходящей версии ' + (isMod ? 'мода' : 'пака'));
    queue.push({ projectId: project, version: v });
    if (withDeps) {
      for (const d of v.dependencies || []) {
        if (d.dependency_type === 'required' && d.project_id) await pushDep(d.project_id);
      }
    }
  }
  await pushMain();
  const installed = [];
  for (const item of queue) {
    const f = item.version.files.find(x => x.primary) || item.version.files[0];
    const dest = path.join(dir, f.filename);
    if (fs.existsSync(dest) && fs.statSync(dest).size === f.size) {
      installed.push({ projectId: item.projectId, filename: f.filename, already: true });
      continue;
    }
    await downloadFile(f.url, dest, fr => onProgress && onProgress(fr));
    installed.push({ projectId: item.projectId, filename: f.filename, size: f.size });
  }
  // Сохраняем название (slug) проекта в реестр сборки — при экспорте берём отсюда
  await recordInstalled(buildId, type, installed);
  return { installed, count: queue.length };
}

async function deleteMod(buildId, filename, type) {
  const dir = (type && type !== 'mod') ? packsDir(buildId, type) : modsDir(buildId);
  const p = path.join(dir, path.basename(filename));
  try { await fsp.unlink(p); } catch (e) {}
  await removeInstalled(buildId, path.basename(filename), type);
  return true;
}

async function deleteBuild(buildId) {
  const builds = await loadBuilds();
  const next = builds.filter(b => b.id !== buildId);
  await saveBuilds(next);
  await fsp.rm(buildDir(buildId), { recursive: true, force: true }).catch(() => {});
  await fsp.rm(path.join(ROOT, 'versions', buildId), { recursive: true, force: true }).catch(() => {});
  return true;
}

/* ============ Экспорт / Импорт сборки (.st4am) ============ */

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const data = await fsp.readFile(filePath);
  hash.update(data);
  return hash.digest('hex');
}

async function findModrinthByHash(sha256) {
  const url = `https://api.modrinth.com/v2/version_file/${sha256}`;
  try {
    const res = await httpGet(url);
    return JSON.parse(res);
  } catch (e) {
    return null;
  }
}

/* --- Поиск мода по НАЗВАНИЮ (не по файлу/хэшу) --- */

// Достаёт из JAR метаданные мода (fabric.mod.json / META-INF/mods.toml / mcmod.info)
function readJarEntry(filePath, targetName) {
  try {
    const buf = fs.readFileSync(filePath);
    // ищем End of Central Directory
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const cdCount = buf.readUInt16LE(eocd + 10);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    let off = cdOffset;
    for (let n = 0; n < cdCount; n++) {
      if (buf.readUInt32LE(off) !== 0x02014b50) break; // центральный заголовок
      const method = buf.readUInt16LE(off + 10);
      const csize = buf.readUInt32LE(off + 20);
      const fnameLen = buf.readUInt16LE(off + 28);
      const extraLen = buf.readUInt16LE(off + 30);
      const commentLen = buf.readUInt16LE(off + 32);
      const localOff = buf.readUInt32LE(off + 42);
      const fname = buf.toString('utf8', off + 46, off + 46 + fnameLen);
      if (fname === targetName) {
        const lNameLen = buf.readUInt16LE(localOff + 26);
        const lExtraLen = buf.readUInt16LE(localOff + 28);
        const dataStart = localOff + 30 + lNameLen + lExtraLen;
        const comp = buf.subarray(dataStart, dataStart + csize);
        if (method === 0) return comp;                 // stored
        if (method === 8) return zlib.inflateRawSync(comp); // deflate
        return null;
      }
      off += 46 + fnameLen + extraLen + commentLen;
    }
    return null;
  } catch (e) { return null; }
}

function modIdFromJar(filePath) {
  try {
    const fab = readJarEntry(filePath, 'fabric.mod.json');
    if (fab) {
      const j = JSON.parse(fab.toString('utf8'));
      return String(j.id || j.name || '').trim() || null;
    }
  } catch (e) {}
  try {
    const toml = readJarEntry(filePath, 'META-INF/mods.toml');
    if (toml) {
      const t = toml.toString('utf8');
      const m = /modId\s*=\s*"([^"]+)"/.exec(t);
      if (m) return m[1].trim();
    }
  } catch (e) {}
  try {
    const info = readJarEntry(filePath, 'mcmod.info');
    if (info) {
      const j = JSON.parse(info.toString('utf8'));
      const first = Array.isArray(j) ? j[0] : j;
      if (first && (first.modid || first.name)) return String(first.modid || first.name).trim();
    }
  } catch (e) {}
  return null;
}

// Достаёт настоящее название пакa из его внутренних метаданных (.zip)
// resourcepacks / datapacks -> pack.mcmeta -> description
// shaders -> shaders/shaders.txt (OptiFine #N# ...) , Iris manifest
function packNameFromZip(filePath) {
  function tryParsePackMeta(buf) {
    try {
      const j = JSON.parse(buf.toString('utf8'));
      const p = j && j.pack;
      if (!p) return null;
      let d = p.description;
      if (typeof d === 'string') d = d.trim();
      else if (typeof d === 'object' && d) {
        const txt = d.text || d.fallback || '';
        if (typeof txt === 'string' && txt.trim()) d = txt.trim();
        else d = null;
      }
      return d || null;
    } catch (e) { return null; }
  }
  const metaBuf = readJarEntry(filePath, 'pack.mcmeta');
  if (metaBuf) {
    const name = tryParsePackMeta(metaBuf);
    if (name) return name;
  }
  const st = readJarEntry(filePath, 'shaders/shaders.txt');
  if (st) {
    const lines = st.toString('utf8').split(/\r?\n/);
    const nline = lines.find(l => /^#N# /.test(l));
    if (nline) {
      const name = nline.replace(/^#N# /, '').trim();
      if (name) return name;
    }
  }
  const irr = readJarEntry(filePath, 'shaders/Iris/manifest.json');
  if (irr) {
    try {
      const j = JSON.parse(irr.toString('utf8'));
      if (j && typeof j.name === 'string' && j.name.trim()) return j.name.trim();
    } catch (e) {}
  }
  const meta2 = readJarEntry(filePath, 'META-INF/natives.json');
  if (meta2) {
    try {
      const j = JSON.parse(meta2.toString('utf8'));
      if (j.shader && typeof j.shader === 'string' && j.shader.trim()) return j.shader.trim();
    } catch (e) {}
  }
  return null;
}

// Чистит имя файла от версии/суффиксов → получаем название проекта для поиска
// Примеры: "sodium-fabric-0.5.11.jar" → "sodium" ; "Fresh Animations.zip" → "Fresh Animations"
function cleanProjectName(raw) {
  let s = String(raw || '');
  s = s.replace(/\.(jar|zip)$/i, '');                     // убрать расширение
  s = s.replace(/[-_.](?:v?\d+(?:\.\d+){1,3}(?:[-_.][a-z0-9]+)*)$/i, ''); // хвост-версия
  s = s.replace(/[-_.]mc[-_.]\d+(?:\.\d+)+/i, '');        // -mc1.20.1 / _mc1_20_1
  s = s.replace(/[-_.](fabric|forge|neoforge|quilt|iris|optifine|fapi|fabric-api)$/i, '');
  s = s.replace(/[-_]+/g, ' ').trim();
  return s;
}

// Ищет проект на Modrinth по названию/id мода (fallback к поиску по имени)
async function findModrinthByName(name, type) {
  if (!name) return null;
  const variants = [];
  // варианты slug: точное, без пробелов, с подчёркиваниями, lower-case
  const base = String(name).trim();
  variants.push(base);
  if (/ /.test(base)) {
    variants.push(base.replace(/ /g, '-'));
    variants.push(base.replace(/ /g, '_'));
  }
  if (/[A-Z]/.test(base)) variants.push(base.toLowerCase());
  if (/[-_]/.test(base)) variants.push(base.replace(/[-_]+/g, ' '));

  for (const v of variants) {
    try {
      const p = await mrProject(v);
      if (p && p.slug) return { slug: p.slug };
    } catch (e) {}
  }

  // поиск по названию; для ресурспаков предпочтительнее проекты типа resource_pack
  try {
    const r = await mrSearch({ query: base, facets: [], limit: 5, offset: 0 });
    const hits = r && r.hits;
    if (hits && hits.length) {
      const exact = hits.find(h => h.slug === base || h.project_id === base);
      if (exact) return { slug: exact.slug };
      if (type === 'resourcepack') {
        const rp = hits.find(h => (h.project_type || '').toLowerCase() === 'resource_pack');
        if (rp) return { slug: rp.slug };
      }
      return { slug: hits[0].slug };
    }
  } catch (e) {}

  return null;
}

async function packConfigs(buildId) {
  const bdir = buildDir(buildId);
  const gameDir = path.join(bdir, 'game');
  const entries = [];
  const configPaths = [
    { src: path.join(gameDir, 'config'), prefix: 'config/' },
    { src: path.join(gameDir, 'options.txt'), prefix: 'options.txt' },
    { src: path.join(gameDir, 'keybinds.txt'), prefix: 'keybinds.txt' }
  ];
  for (const cp of configPaths) {
    try {
      const stat = await fsp.stat(cp.src);
      if (stat.isDirectory()) {
        const files = await fsp.readdir(cp.src, { recursive: true });
        for (const f of files) {
          const fpath = path.join(cp.src, f);
          const fstat = await fsp.stat(fpath);
          if (fstat.isFile()) {
            const data = await fsp.readFile(fpath);
            entries.push({ name: cp.prefix + f, data });
          }
        }
      } else if (stat.isFile()) {
        const data = await fsp.readFile(cp.src);
        entries.push({ name: cp.prefix, data });
      }
    } catch (e) {}
  }
  if (!entries.length) return '';
  // Minimal ustar tar
  const blocks = [];
  for (const e of entries) {
    const name = e.name;
    const data = e.data;
    const size = data.length;
    const header = Buffer.alloc(512);
    Buffer.from(name).copy(header, 0, 0, Math.min(100, name.length));
    header.writeUInt32octal(size, 124, 11);
    header[156] = 48; // ustar typeflag '0'
    'ustar  \0'.split('').forEach((c, i) => header[257 + i] = c.charCodeAt(0));
    const pad = (512 - (size % 512)) % 512;
    blocks.push(header, data, Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024)); // end of archive
  const tar = Buffer.concat(blocks);
  const gz = zlib.gzipSync(tar);
  return gz.toString('base64');
}

async function unpackConfigs(buildId, base64gz) {
  if (!base64gz) return;
  const bdir = buildDir(buildId);
  const gameDir = path.join(bdir, 'game');
  await fsp.mkdir(gameDir, { recursive: true });
  const gz = Buffer.from(base64gz, 'base64');
  const tar = zlib.gunzipSync(gz);
  let offset = 0;
  while (offset < tar.length) {
    if (offset + 512 > tar.length) break;
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break;
    const sizeStr = header.subarray(124, 136).toString('utf8').trim();
    const size = parseInt(sizeStr, 8) || 0;
    offset += 512;
    const data = tar.subarray(offset, offset + size);
    offset += size;
    const pad = (512 - (size % 512)) % 512;
    offset += pad;
    const dest = path.join(gameDir, name);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, data);
  }
}

// ============ Реестр установленного (для экспорта по названию) ============
// При скачивании мода/пакa запоминаем НАЗВАНИЕ (slug проекта) в per-build файл.
// Экспорт берёт название отсюда — оно гарантированно существует на Modrinth.
function installedFile(id) { return path.join(buildDir(id), 'installed.json'); }

async function loadInstalled(id) {
  try { return JSON.parse(await fsp.readFile(installedFile(id), 'utf8')); } catch (e) { return { files: [] }; }
}

async function saveInstalled(id, reg) {
  try { await fsp.writeFile(installedFile(id), JSON.stringify(reg, null, 2)); } catch (e) {}
}

async function recordInstalled(buildId, type, installed) {
  try {
    const reg = await loadInstalled(buildId);
    for (const item of installed) {
      const slug = item.projectId;
      if (!slug) continue;
      // заменяем запись с тем же типом и slug (идемпотентно)
      reg.files = reg.files.filter(x => !(x.type === type && x.slug === slug));
      reg.files.push({ type, slug, filename: item.filename });
    }
    await saveInstalled(buildId, reg);
  } catch (e) {}
}

async function removeInstalled(buildId, filename, type) {
  try {
    const reg = await loadInstalled(buildId);
    reg.files = reg.files.filter(x => !(x.type === type && x.filename === filename));
    await saveInstalled(buildId, reg);
  } catch (e) {}
}

async function exportBuild(buildId) {
  const builds = await loadBuilds();
  const build = builds.find(b => b.id === buildId);
  if (!build) throw new Error('Сборка не найдена');

  const bdir = buildDir(buildId);
  const gameDir = path.join(bdir, 'game');
  const typeDirs = {
    mod: path.join(gameDir, 'mods'),
    resourcepack: path.join(gameDir, 'resourcepacks'),
    shaderpack: path.join(gameDir, 'shaderpacks'),
    datapack: path.join(gameDir, 'datapacks')
  };

  const files = [];
  const skipped = [];

  // Реестр установленного: название (slug) каждого мода/пакa, сохранённое
  // при скачивании. Это ПРИОРИТЕТНЫЙ источник — файл точно есть на Modrinth.
  const registry = await loadInstalled(buildId);
  const regByKey = new Map();
  for (const r of registry.files || []) {
    regByKey.set(r.type + '|' + r.filename, r.slug);
  }

  for (const [type, dir] of Object.entries(typeDirs)) {
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (!['.jar', '.zip'].includes(ext)) continue;
        const fpath = path.join(dir, e.name);

        // 1) ПРИОРИТЕТ: название из реестра (запомнено при скачивании)
        let slug = regByKey.get(type + '|' + e.name) || null;

        // 2) Файлы вне реестра (добавлены вручную) — старый путь: хэш/название
        if (!slug) {
          const sha = await sha256File(fpath);
          if (type === 'mod') {
            const mrf = await findModrinthByHash(sha);
            if (mrf && mrf.project_id) slug = mrf.project_id;
          }
        }

        if (!slug) {
          // Читаем идентичность из метаданных файла, затем ищем по названию
          const internalName = type === 'mod' ? modIdFromJar(fpath) : packNameFromZip(fpath);
          const nameCandidates = [];
          if (internalName) nameCandidates.push(internalName);
          nameCandidates.push(cleanProjectName(e.name));
          nameCandidates.push(path.basename(e.name, path.extname(e.name)));

          const seen = new Set();
          const unique = [];
          for (const n of nameCandidates) {
            if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); unique.push(n); }
          }
          for (const name of unique) {
            const byName = await findModrinthByName(name, type);
            if (byName) { slug = byName.slug; break; }
          }
        }

        if (slug) {
          // Запоминаем НАЗВАНИЕ (slug проекта), а не файл/версию.
          // versionId намеренно НЕ сохраняем: при импорте ищется по имени
          // и Modrinth сам подберёт версию под целевую сборку.
          files.push({
            type,
            slug,
            filename: e.name
          });
          // Пишем название обратно в реестр, если его там ещё не было —
          // чтобы следующий экспорт брал его из реестра мгновенно.
          if (!regByKey.has(type + '|' + e.name)) {
            await recordInstalled(buildId, type, [{ projectId: slug, filename: e.name }]);
            regByKey.set(type + '|' + e.name, slug);
          }
        } else {
          skipped.push(e.name);
        }
      }
    } catch (e) {}
  }

  const configArchive = await packConfigs(buildId);

  const manifest = {
    formatVersion: 1,
    name: build.name,
    gameVersion: build.gameVersion,
    loader: build.loader,
    icon: build.icon || 'Grass.png',
    files,
    configArchive
  };

  // safety check
  const json = JSON.stringify(manifest, null, 2);
  console.log('[exportBuild]', buildId, manifest.name, files.length + ' файлов, пропущено:', skipped.length, 'конфиг:', !!configArchive);

  return { ok: true, manifest, skipped };
}

async function importBuild(manifest, onProgress) {
  console.log('[importBuild] вызов, formatVersion:', manifest && manifest.formatVersion, 'name:', manifest && manifest.name);
  if (!manifest || manifest.formatVersion !== 1) throw new Error('Неверный формат файла: formatVersion=' + (manifest && manifest.formatVersion));
  if (!manifest.name || !manifest.gameVersion || !manifest.loader || !Array.isArray(manifest.files)) {
    throw new Error('Некорректный манифест: name=' + manifest.name + ', gameVersion=' + manifest.gameVersion + ', loader=' + manifest.loader + ', files=' + (manifest && manifest.files));
  }

  // Create build (similar to buildCreate but without onProgress for loader)
  const builds = await loadBuilds();
  const id = 'build-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const b = {
    id,
    name: String(manifest.name || '').trim() || 'Импортированная сборка',
    gameVersion: manifest.gameVersion,
    loader: manifest.loader,
    icon: manifest.icon || 'Grass.png',
    created: Date.now()
  };
  console.log('[importBuild] создание сборки:', id, b.name, b.gameVersion, b.loader);
  const bdir = buildDir(id);

  // создаём папку
  await fsp.mkdir(path.join(bdir, 'game', 'mods'), { recursive: true });
  await fsp.mkdir(path.join(bdir, 'game', 'resourcepacks'), { recursive: true });
  await fsp.mkdir(path.join(bdir, 'game', 'shaderpacks'), { recursive: true });
  await fsp.mkdir(path.join(bdir, 'game', 'datapacks'), { recursive: true });
  await fsp.mkdir(path.join(bdir, 'game'), { recursive: true });

  // Install loader
  await installLoader(b, manifest.gameVersion, manifest.loader, null);

  builds.unshift(b);
  await saveBuilds(builds);

  // Download files
  const total = manifest.files.length;
  let done = 0;
  for (const f of manifest.files) {
    done++;
    if (onProgress) onProgress(done / total, f.filename);
    try {
      // Ищем мод по НАЗВАНИЮ (f.slug = имя проекта), а не по файлу/версии.
      // versionId не передаём — Modrinth сам подберёт версию под эту сборку (gameVersion + loader).
      await installProject({
        buildId: id,
        project: f.slug,
        versionId: null,
        withDeps: false,
        type: f.type,
        onProgress: null
      });
    } catch (e) {
      log('import file error', f.slug, f.filename, e.message);
    }
  }

  // Unpack configs
  if (manifest.configArchive) {
    await unpackConfigs(id, manifest.configArchive);
  }

  return id;
}

const NEWS_API = 'https://launchercontent.mojang.com/v2/news.json';
function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/g, "'").trim();
}
function fmtNewsDate(pub) {
  const d = new Date(pub);
  if (isNaN(d.getTime())) return String(pub || '').slice(0, 16);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return dd + '.' + mm + '.' + d.getFullYear();
}
async function fetchNews() {
  try {
    const raw = await httpGet(NEWS_API, { Accept: 'application/json' });
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    let txt = buf.toString('utf8');
    if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
    const j = JSON.parse(txt);
    const out = [];
    const entries = Array.isArray(j.entries) ? j.entries : [];
    for (const e of entries) {
      if (out.length >= 10) break;
      const title = stripTags(e.title || '');
      if (!title) continue;
      const text = String(e.text || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .trim();
      const normUrl = (u) => u && u.indexOf('/') === 0 ? 'https://launchercontent.mojang.com' + u : (u || '');
      const pImg = normUrl(e.playPageImage && e.playPageImage.url);
      const nImg = normUrl(e.newsPageImage && e.newsPageImage.url);
      const imgKey = (u) => (u.split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]\d+x\d+$/i, '');
      const images = [];
      if (pImg) images.push(pImg);
      if (nImg && !images.some(x => imgKey(x) === imgKey(nImg))) images.push(nImg);
      out.push({ title: title, desc: text.slice(0, 900), date: fmtNewsDate(e.date || ''), link: '', text: text || '', images: images });
    }
    return out;
  } catch (e) { log('news fetch error', e.message); try { fs.appendFileSync(process.env.TEMP + '/news_err.log', new Date().toISOString() + ' ' + (e && e.message) + '\n' + ((e && e.stack) || '') + '\n'); } catch (e2) {} return []; }
}
function favsFile() { return path.join(ROOT, 'favs.json'); }
async function loadFavs() {
  try {
    const d = JSON.parse(await fsp.readFile(favsFile(), 'utf8'));
    return Array.isArray(d) ? d : [];
  } catch (e) { return []; }
}
async function saveFavs(list) { await fsp.writeFile(favsFile(), JSON.stringify(list, null, 2)); }
async function favsList() { return loadFavs(); }
async function favsAdd(item) {
  if (!item || typeof item.slug !== 'string' || !item.slug) return loadFavs();
  const list = await loadFavs();
  if (!list.some(x => x.slug === item.slug)) { list.unshift(item); await saveFavs(list); }
  return list;
}
async function favsRemove(slug) {
  const list = await loadFavs();
  const out = list.filter(x => x.slug !== slug);
  if (out.length !== list.length) await saveFavs(out);
  return out;
}
module.exports = {
  setRoot,
  mrSearch, mrProject, mrProjectVersions, mrVersion, mrCategories, mrLoaders, mrGameVersions,
  mrBatchProjects, mrBatchVersions,
  buildsList, buildCreate, deleteBuild, installedMods, installProject, deleteMod,
  exportBuild, importBuild, findModrinthByHash, packConfigs, unpackConfigs,
  findJava, findJavaMajor, javaCandidates, javaMajor, ensureJavaRuntime,
  modsDir, packsDir, buildDir, loadBuilds,
  fetchNews, favsList, favsAdd, favsRemove
};
