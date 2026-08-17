'use strict';
// Анализатор ошибок запуска: парсит вывод игры + crash-reports + logs/latest.log,
// распознаёт типовые ошибки загрузчиков (Fabric/Forge/NeoForge/Quilt) и системные,
// находит нужные моды на Modrinth и формирует отчёт для UI.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const mods = require('./mods');

function log(...a) { console.log('[diag]', ...a); }

// Моды-оптимизаторы памяти для OOM
const OOM_MODS = [
  { slug: 'ferritecore', action: 'install' },
  { slug: 'modernfix', action: 'install' }
];

// Разрешение modId -> slug Modrinth (с кешем на один вызов)
class Resolver {
  constructor() { this.cache = new Map(); }
  async resolve(modId) {
    if (!modId) return null;
    const key = String(modId).toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key);
    let out = null;
    try {
      const p = await mods.mrProject(modId);
      if (p && p.slug) out = { slug: p.slug, title: p.title, icon_url: p.icon_url };
    } catch (e) {}
    if (!out) {
      try {
        const r = await mods.mrSearch({ query: modId, facets: [], limit: 5, offset: 0 });
        const hits = r && r.hits;
        if (hits && hits.length) {
          const h = hits.find(x => (x.slug || '').toLowerCase() === key || (x.project_id || '').toLowerCase() === key) || hits[0];
          out = { slug: h.slug, title: h.title, icon_url: h.icon_url };
        }
      } catch (e) {}
    }
    this.cache.set(key, out);
    return out;
  }
}

function extractQuotedIds(text) {
  const ids = [];
  const re = /"([a-zA-Z0-9_.-]+)"/g;
  let m;
  while ((m = re.exec(text))) {
    const id = m[1];
    if (/^(minecraft|fabric-loader|quilt-loader|fabric-api|minecraft|cotton|java)$/.test(id)) continue;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function extractDepsFromMissingSection(text) {
  // Fabric: [required mod "fabric-api" for mod "sodium"]
  const ids = [];
  const re = /required mod\s+"([a-zA-Z0-9_.-]+)"/g;
  let m;
  while ((m = re.exec(text))) if (!ids.includes(m[1])) ids.push(m[1]);
  // Quilt/Forge строки "- mod "x"" после заголовков
  const re2 = /-\s*(?:mod\s+)?["']?([a-zA-Z0-9_.-]+)["']?\s*(?:@|,|$)/g;
  let m2;
  while ((m2 = re2.exec(text))) {
    const id = m2[1];
    if (/^(mods?|files?)$/i.test(id)) continue;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.filter(id => !/^(minecraft|fabric-loader|quilt-loader)$/.test(id));
}

function extractRelations(text) {
  // relations[modId] = { neededBy: [ids], conflictsWith: [ids] }
  const rel = {};
  const add = (a, b) => { if (!rel[a]) rel[a] = { neededBy: [], conflictsWith: [] }; return rel[a]; };
  // "required mod "X" for mod "Y"" → X нужен для Y (Y требует X)
  const re1 = /required mod\s+"([a-zA-Z0-9_.-]+)"\s+for mod\s+"([a-zA-Z0-9_.-]+)"/g;
  let m1;
  while ((m1 = re1.exec(text))) {
    add(m1[1], null).neededBy.push(m1[2]);
  }
  // "The mod "Y" requires mod "X"" / "The mod Y requires X to be present" → Y требует X
  const re2 = /The mod\s+"?([a-zA-Z0-9_.-]+)"?\s+requires (?:mod\s+)?"?([a-zA-Z0-9_.-]+)"?/gi;
  let m2;
  while ((m2 = re2.exec(text))) {
    add(m2[2], null).neededBy.push(m2[1]);
  }
  // "X conflicts with Y" / "- mod "X" conflicts with mod "Y"" / "X is incompatible with Y"
  const re3 = /(?:mod\s+)?["']?([a-zA-Z0-9_.-]+)["']?\s+(?:conflicts with|is incompatible with)\s+(?:mod\s+)?["']?([a-zA-Z0-9_.-]+)["']?/gi;
  let m3;
  while ((m3 = re3.exec(text))) {
    if (/^(mod|file|files?)$/i.test(m3[1]) || /^(mod|file|files?)$/i.test(m3[2])) continue;
    add(m3[1], null).conflictsWith.push(m3[2]);
    add(m3[2], null).conflictsWith.push(m3[1]);
  }
  return rel;
}

function extractRanges(text) {
  const ranges = {};
  // required mod "X" ... version range [0.83.0,)
  const re = /required mod\s+"([a-zA-Z0-9_.-]+)"[^\]\n]*?version range\s*\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(text))) ranges[m[1]] = m[2].trim();
  // "X"@[4.2.0,)  (Quilt/Forge)
  const re2 = /["']?([a-zA-Z0-9_.-]+)["']?@\[([^\]]+)\]/g;
  let m2;
  while ((m2 = re2.exec(text))) if (!ranges[m2[1]]) ranges[m2[1]] = m2[2].trim();
  return ranges;
}

function parse(text) {
  const problems = [];
  const resolver = new Resolver();
  if (!text || !text.trim()) return Promise.resolve([]);
  const relations = extractRelations(text);
  const ranges = extractRanges(text);

  const push = (kind, title, detail, modIds, actionForMod) => {
    problems.push({ kind, title, detail, modIds, actionForMod, relations, ranges });
  };

  // --- Fabric / Quilt: missing mods ---
  if (/Missing mods:/.test(text) || /required mod\s+"/.test(text) || /requires mod\s+"?[a-zA-Z0-9_.-]+"? to be present/.test(text)) {
    const ids = extractDepsFromMissingSection(text);
    if (ids.length) {
      push('missing_dep', 'Отсутствуют моды-зависимости',
        'Игра не запустилась: не хватает модов, которые нужны другим модам.',
        ids, 'install');
    }
  }

  // --- Forge: missing or unsupported mandatory dependencies ---
  if (/Missing or unsupported mandatory dependencies/i.test(text) || /Mandatory dependencies missing/i.test(text) || /Missing dependency/i.test(text)) {
    const ids = extractDepsFromMissingSection(text);
    if (ids.length) {
      push('missing_dep', 'Отсутствуют обязательные зависимости (Forge)',
        'Один или несколько модов требуют другие моды, которых нет в сборке.',
        ids, 'install');
    }
  }

  // --- Conflict ---
  if (/Incompatible mods found/i.test(text) || /conflicts with/i.test(text) || /Conflicts:/i.test(text) || /is incompatible with/i.test(text)) {
    // Берём пары конфликта из связей, иначе общие id из текста
    let ids = [];
    for (const [k, v] of Object.entries(relations)) {
      if (v.conflictsWith.length) { if (!ids.includes(k)) ids.push(k); for (const o of v.conflictsWith) if (!ids.includes(o)) ids.push(o); }
    }
    if (!ids.length) ids = extractQuotedIds(text);
    push('conflict', 'Конфликт модов',
      'Найден конфликт: два мода не могут работать вместе. Удалите один из них.',
      ids, 'remove');
  }

  // --- Duplicate ---
  if (/Duplicate mods?:/i.test(text) || /was added by multiple mods/i.test(text)) {
    const ids = extractQuotedIds(text);
    push('duplicate', 'Дубликаты модов',
      'Мод установлен несколько раз (разные файлы). Удалите лишние копии.',
      ids, 'remove');
  }

  // --- Version mismatch ---
  if (/requires (?:mod\s+)?["']?[a-zA-Z0-9_.-]+["']?\s*version\s+["']?[0-9.,()\[\]\s-]+/i.test(text) || /requires version/i.test(text) || /version range/i.test(text) || /incompatible version/i.test(text)) {
    const ids = extractQuotedIds(text);
    push('version_mismatch', 'Не та версия мода',
      'Установленная версия мода не подходит. Обновите мод до совместимой версии.',
      ids, 'update');
  }

  // --- Wrong Minecraft version ---
  if (/requires minecraft version/i.test(text) || /requires minecraft\s+["']?[0-9]/i.test(text) || /minecraft version .* is not supported/i.test(text)) {
    const ids = extractQuotedIds(text);
    push('wrong_mc', 'Не та версия Minecraft',
      'Мод не поддерживает эту версию Minecraft. Обновите мод или выберите другую версию игры.',
      ids, 'update');
  }

  // --- Wrong loader version ---
  if (/requires loader version/i.test(text) || /requires (fabric|quilt|forge|neoforge)-?loader/i.test(text) || /loader version .* not supported/i.test(text)) {
    const ids = extractQuotedIds(text);
    push('wrong_loader', 'Не та версия загрузчика',
      'Мод требует другую версию загрузчика модов. Пересоздайте сборку с актуальным загрузчиком.',
      ids, 'update');
  }

  // --- OOM ---
  if (/OutOfMemoryError/i.test(text) || /Not enough memory/i.test(text) || /Java heap space/i.test(text) || /Could not reserve enough space/i.test(text)) {
    push('oom', 'Не хватает памяти',
      'Игре не хватило оперативной памяти. Увеличьте выделенную RAM или установите моды-оптимизаторы памяти.',
      OOM_MODS.map(m => m.slug), 'install');
  }

  // --- Java ---
  if (/Unable to locate a Java Runtime/i.test(text) || /UnsupportedClassVersionError/i.test(text) || /Unrecognized VM option/i.test(text) || /A JNI error has occurred/i.test(text) || /Error: could not open/i.test(text)) {
    push('no_java', 'Проблема с Java',
      'Не найдена подходящая Java или она несовместима с этой версией Minecraft.',
      [], null);
  }

  // --- Assets ---
  if (/Couldn't load.*assets/i.test(text) || /Invalid agent/i.test(text) || /Failed to download.*(assets|libraries)/i.test(text)) {
    push('assets', 'Ошибка загрузки ресурсов',
      'Проблема с файлами игры (ассеты/библиотеки). Попробуйте переустановить версию.',
      [], null);
  }

  // --- Login ---
  if (/Failed to login/i.test(text) || /Invalid session/i.test(text) || /Authentication servers are down/i.test(text) || /Bad Login/i.test(text)) {
    push('login', 'Не удалось войти в аккаунт',
      'Игра не смогла проверить аккаунт. Это нормально для оффлайн-игры, если версия требует онлайна.',
      [], null);
  }

  return resolveAll(problems, resolver);
}

async function resolveAll(problems, resolver) {
  const out = [];
  for (const p of problems) {
    const rel = p.relations || {};
    const ranges = p.ranges || {};
    const modsList = [];
    const seen = new Set();
    for (const id of (p.modIds || [])) {
      if (seen.has(id.toLowerCase())) continue;
      seen.add(id.toLowerCase());
      const info = await resolver.resolve(id);
      const entry = {
        id,
        slug: (info && info.slug) || id,
        title: (info && info.title) || id,
        icon_url: (info && info.icon_url) || '',
        action: p.actionForMod
      };
      const r = rel[id];
      if (r) {
        if (r.neededBy.length) entry.neededBy = r.neededBy;
        if (r.conflictsWith.length) entry.conflictsWith = r.conflictsWith;
      }
      if (ranges[id]) entry.needVersion = ranges[id];
      modsList.push(entry);
    }
    out.push({ kind: p.kind, title: p.title, detail: p.detail, mods: modsList });
  }
  return out;
}

async function readLatestCrashReport(gameDir) {
  const dir = path.join(gameDir, 'crash-reports');
  try {
    const entries = await fsp.readdir(dir);
    const txts = entries.filter(n => n.endsWith('.txt')).map(n => ({ n, p: path.join(dir, n), t: fs.statSync(path.join(dir, n)).mtimeMs }));
    txts.sort((a, b) => b.t - a.t);
    if (txts.length) return await fsp.readFile(txts[0].p, 'utf8');
  } catch (e) {}
  return '';
}

async function readLatestLog(gameDir) {
  try {
    return await fsp.readFile(path.join(gameDir, 'logs', 'latest.log'), 'utf8');
  } catch (e) { return ''; }
}

async function installedFilenames(buildId) {
  try {
    const raw = await fsp.readFile(path.join(mods.buildDir(buildId), 'installed.json'), 'utf8');
    const reg = JSON.parse(raw);
    return (reg.files || []).filter(f => f.type === 'mod').map(f => ({ slug: f.slug, filename: f.filename }));
  } catch (e) { return []; }
}

// Главная функция анализа
async function analyze({ buildId, gameDir, logBuffer }) {
  try {
    const crash = await readLatestCrashReport(gameDir);
    const latest = await readLatestLog(gameDir);
    const text = [logBuffer || '', crash, latest].join('\n');

    const problems = await parse(text);
    const installed = buildId ? await installedFilenames(buildId) : [];

    // Для конфликтов/дубликатов/обновлений подставляем имя файла из реестра
    for (const p of problems) {
      if ((p.kind === 'conflict' || p.kind === 'duplicate' || p.kind === 'version_mismatch' || p.kind === 'wrong_mc' || p.kind === 'wrong_loader') && buildId) {
        for (const m of p.mods) {
          const hit = installed.find(i => i.slug === m.slug);
          if (hit) m.filename = hit.filename;
        }
      }
    }

    const report = { buildId: buildId || null, gameDir, problems };
    if (problems.length) {
      // Всегда пишем "последний отчёт" в фиксированное место — по нему ищется напоминание
      try {
        await fsp.mkdir(mods.buildDir('global'), { recursive: true });
        await fsp.writeFile(path.join(mods.buildDir('global'), 'diagnostics.json'), JSON.stringify(report, null, 2));
      } catch (e) {}
    }
    log('отчёт:', problems.map(p => p.kind + ' (' + p.mods.length + ')').join(', ') || 'пусто');
    return report;
  } catch (e) {
    log('analyze error', e && e.message);
    return { buildId: buildId || null, gameDir, problems: [] };
  }
}

async function pendingReport() {
  // Читаем diagnostics.json из текущей корневой папки лаунчера (создан при прошлом краше)
  try {
    const p = path.join(mods.buildDir('global'), 'diagnostics.json');
    const raw = await fsp.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) { return null; }
}

async function clearPending() {
  try {
    await fsp.unlink(path.join(mods.buildDir('global'), 'diagnostics.json'));
  } catch (e) {}
}

module.exports = { analyze, parse, pendingReport, clearPending };
