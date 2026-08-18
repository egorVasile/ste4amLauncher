'use strict';
// Анализатор ошибок запуска: парсит вывод игры + crash-reports + logs/latest.log,
// распознаёт типовые ошибки загрузчиков (Fabric/Quilt/Forge/NeoForge), ошибки модов
// (отсутствующие зависимости, конфликты, несовпадение версий), системные проблемы
// (Java, память, графика, нативные библиотеки, повреждённые файлы) и формирует
// отчёт для UI с кнопками действий (скачать / обновить / удалить).
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

/* ============ Справочник modId -> slug Modrinth ============ */
// modId (как он пишется в логах/метаданных) часто не совпадает со slug'ом проекта.
// null = «это не мод» (загрузчик/игра) — в список модов не включаем.
const ID_ALIASES = {
  minecraft: null,
  fabricloader: null, 'fabric-loader': null,
  quilt_loader: null, 'quilt-loader': null,
  forge: null, fml: null, modlauncher: null, securejarhandler: null, neoforge: null,
  optifine: null,
  'fabric-api': 'fabric-api',
  'cloth-config': 'cloth-config',
  architectury: 'architectury-api',
  yacl: 'yet-another-config-lib',
  'yet-another-config-lib': 'yet-another-config-lib',
  rei: 'roughly-enough-items',
  'roughly-enough-items': 'roughly-enough-items',
  jei: 'jei',
  emi: 'emi',
  wthit: 'wthit',
  hwyla: 'wthit',
  jade: 'jade',
  c2me: 'c2me-fabric',
  optifabric: 'optifabric',
  indium: 'indium',
  'sodium-extra': 'sodium-extra',
  'reeses-sodium-options': 'reeses-sodium-options',
  'fabric-language-kotlin': 'fabric-language-kotlin',
  'language-kotlin': 'fabric-language-kotlin',
  'owo-lib': 'owo-lib',
  kubejs: 'kubejs',
  rhino: 'rhino',
  geckolib: 'geckolib',
  'player-animator': 'playeranimator',
  playeranimator: 'playeranimator',
  ferritecore: 'ferritecore',
  modernfix: 'modernfix',
  lithium: 'lithium',
  phosphor: 'phosphor',
  starlight: 'starlight',
  lazydfu: 'lazydfu',
  immediatelyfast: 'immediatelyfast',
  entityculling: 'entityculling',
  'dynamic-fps': 'dynamic-fps',
  spark: 'spark',
  smoothboot: 'smoothboot-fabric',
  memoryleakfix: 'memoryleakfix',
  debugify: 'debugify',
  'fixmyfabric': 'fixmyfabric',
  mixinbooter: 'mixinbooter',
  connector: 'connector',
  'sinytra-connector': 'sinytra-connector',
  appleskin: 'appleskin',
  zoomify: 'zoomify',
  midnightlib: 'midnightlib',
  'cc-tweaked': 'cc-tweaked',
  mekanism: 'mekanism',
  create: 'create',
  'create-fabric': 'create-fabric',
  '3dskinlayers': '3dskinlayers',
  sodium: 'sodium',
  iris: 'iris',
  modmenu: 'modmenu',
  fallingleaves: 'fallingleaves',
  cristellib: 'cristellib',
  bookself: 'bookself',
  silk: 'silk-api',
  'silk-api': 'silk-api',
  blueprint: 'blueprint',
  cameraoverhaul: 'cameraoverhaul'
};

function aliasFor(modId) {
  const id = String(modId || '').trim().toLowerCase();
  if (!id) return undefined;
  if (Object.prototype.hasOwnProperty.call(ID_ALIASES, id)) return ID_ALIASES[id];
  // Модули Fabric API вида fabric-xxx-vN / fabric-xxx-api -> весь Fabric API
  if (/^fabric-.+-v\d+$/.test(id) || /^fabric-(api|command|data|rendering|transfer|resource|registry|screen|networking)-/.test(id)) return 'fabric-api';
  if (/^fabric-language-/.test(id)) return 'fabric-language-kotlin';
  return id; // неизвестный id — пробуем как есть
}

// Разрешение modId -> slug Modrinth (с кешем на один вызов)
class Resolver {
  constructor() { this.cache = new Map(); }
  async resolve(modId) {
    if (!modId) return null;
    const key = String(modId).toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key);
    let out = null;
    const alias = aliasFor(key);
    if (alias === null) { this.cache.set(key, { skip: true }); return { skip: true }; }
    const searchId = typeof alias === 'string' ? alias : key;
    try {
      const p = await mods.mrProject(searchId);
      if (p && p.slug) out = { slug: p.slug, title: p.title, icon_url: p.icon_url };
    } catch (e) {}
    if (!out) {
      try {
        const r = await mods.mrSearch({ query: key, facets: [['project_type:mod']], limit: 8, offset: 0 });
        const hits = (r && r.hits) || [];
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const keyN = norm(key);
        const h = hits.find(x => String(x.slug || '').toLowerCase() === key || String(x.project_id || '').toLowerCase() === key)
          || hits.find(x => norm(x.slug) === keyN)
          || hits[0];
        if (h) out = { slug: h.slug, title: h.title, icon_url: h.icon_url };
      } catch (e) {}
    }
    this.cache.set(key, out);
    return out;
  }
}

/* ============ Утилиты извлечения ============ */

function uniq(arr) {
  const out = [];
  for (const x of arr) if (x && !out.includes(x)) out.push(x);
  return out;
}

const SKIP_IDS = /^(minecraft|fabricloader|fabric-loader|quiltloader|quilt-loader|forge|neoforge|fml|java|mods?|files?|the|and|for|with|which|but|from|at|by|are|or|each|game|some|your|them|they|this|that|it|be|to|on|in|of|not|all|any|you|version|versions|present|installed|range|compatible|incompatible|missing|found|error|exception|class|mixin|modify|optional)$/i;

function addId(list, id) {
  if (id && /^[a-zA-Z0-9_.-]{2,}$/.test(id) && !/^\d+(?:\.\d+)+$/.test(id) && !SKIP_IDS.test(id) && !list.includes(id)) list.push(id);
}

// Строки секции после заголовка (до пустой строки)
function sectionLines(text, headerRe) {
  const lines = String(text).split(/\r?\n/);
  const idx = lines.findIndex(l => headerRe.test(l));
  if (idx < 0) return [];
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() && out.length) break;
    if (!l.trim()) continue;
    out.push(l);
  }
  return out;
}

// Все id в кавычках + простые «пули» списков
function collectSectionIds(lines) {
  const ids = [];
  const q = /"([a-zA-Z0-9_.-]+)"/g;
  for (const l of lines) {
    let m;
    while ((m = q.exec(l))) addId(ids, m[1]);
    const pm = /(?:^|\s)-{1,2}\s*["']?([a-zA-Z0-9_.-]{2,})["']?\s*$/.exec(l);
    if (pm) addId(ids, pm[1]);
  }
  return ids;
}

// Отсутствующие зависимости (Fabric/Quilt/Forge/NeoForge)
function extractMissingIds(text) {
  const ids = [];
  // Fabric:  - Mod "fabric-api" is required by "sodium" (sodium.jar), but it is missing!
  let m; const re1 = /Mod\s+["']([a-zA-Z0-9_.-]+)["']\s+is required by/g;
  while ((m = re1.exec(text))) addId(ids, m[1]);
  // Fabric (старый формат): required mod "fabric-api" for mod "sodium"
  const re2 = /required mod\s+["']([a-zA-Z0-9_.-]+)["']\s+for mod\s+["']([a-zA-Z0-9_.-]+)["']/g;
  while ((m = re2.exec(text))) addId(ids, m[1]);
  // The mod "X" requires mod "Y", which is missing! / requires any version of "Y"
  const re3 = /requires\s+(?:any\s+version\s+of\s+|mod\s+)?["']?([a-zA-Z0-9_.-]+)["']?,?\s+which is missing/gi;
  while ((m = re3.exec(text))) addId(ids, m[1]);
  const re3b = /requires\s+any\s+version\s+of\s+["']?([a-zA-Z0-9_.-]+)["']?/gi;
  while ((m = re3b.exec(text))) addId(ids, m[1]);
  // Forge/NeoForge: requires mod "X" to be present / requires mod X
  const re4 = /requires\s+mods?\s+["']?([a-zA-Z0-9_.-]+)["']?\s+to be present/gi;
  while ((m = re4.exec(text))) addId(ids, m[1]);
  const re4b = /requires\s+mod\s+["']([a-zA-Z0-9_.-]+)["']/gi;
  while ((m = re4b.exec(text))) addId(ids, m[1]);
  // Quilt: список после заголовка «The following mods ...»
  const sec = sectionLines(text, /The following mods (?:are missing|could not be located|are required)/i);
  for (const id of collectSectionIds(sec)) addId(ids, id);
  // Fabric «Missing mods:» секция — подстраховка для нестандартных формулировок.
  // Берём только НЕДОСТАЮЩИЙ мод (не того, кому он нужен).
  const sec2 = sectionLines(text, /^Missing mods?:/i);
  for (const l of sec2) {
    const rb = /Mod\s+["']([a-zA-Z0-9_.-]+)["']\s+is required by/g.exec(l);
    if (rb) { addId(ids, rb[1]); continue; }
    const fm = /mod\s+["']([a-zA-Z0-9_.-]+)["']\s+for mod\s+["']([a-zA-Z0-9_.-]+)["']/g.exec(l);
    if (fm) { addId(ids, fm[1]); continue; }
    const q = /"([a-zA-Z0-9_.-]+)"/g;
    let qm;
    while ((qm = q.exec(l))) addId(ids, qm[1]);
  }
  return ids;
}

// Id модов из конфликтов
function extractConflictIds(text) {
  const ids = [];
  // - Mod "X" (file.jar) 1.0 is incompatible with [mod] "Y" (file.jar)
  const re1 = /Mod\s+["']([a-zA-Z0-9_.-]+)["'][^\n]*?\s+is incompatible with\s+(?:mod\s+)?["']([a-zA-Z0-9_.-]+)["']/gi;
  let m;
  while ((m = re1.exec(text))) { addId(ids, m[1]); addId(ids, m[2]); }
  // The mod "X" is incompatible with mod "Y" / Mod "X" conflicts with "Y"
  const re2 = /mod\s+["']([a-zA-Z0-9_.-]+)["']\s+(?:is incompatible with|conflicts with)\s+mod\s+["']([a-zA-Z0-9_.-]+)["']/gi;
  while ((m = re2.exec(text))) { addId(ids, m[1]); addId(ids, m[2]); }
  // X conflicts with Y (без кавычек, по два слова подряд)
  const re3 = /["']?([a-zA-Z0-9_.-]{2,})["']?\s+(?:conflicts with|is incompatible with)\s+["']?([a-zA-Z0-9_.-]{2,})["']?/gi;
  while ((m = re3.exec(text))) {
    if (!SKIP_IDS.test(m[1]) && !SKIP_IDS.test(m[2])) { addId(ids, m[1]); addId(ids, m[2]); }
  }
  return ids;
}

// Id модов для «не та версия»
function extractVersionIds(text) {
  const ids = [];
  let m;
  // Mod "X" requires version "V" of "Y"  /  requires version V of "Y"  /  requires version V of Y
  const re1 = /requires\s+version\s+["']?([0-9][^"'\s,;)]*)["']?\s+of\s+["']?([a-zA-Z0-9_.-]+)["']?/gi;
  while ((m = re1.exec(text))) {
    if (!/^(minecraft|fabricloader|fabric-loader|quiltloader|quilt-loader|forge|neoforge)$/i.test(m[2])) addId(ids, m[2]);
  }
  // mod "X" requires mod "Y" version [A,B) to be present
  const re2 = /requires\s+mod\s+["']([a-zA-Z0-9_.-]+)["']\s+version\s+[\[\(][^\]\)]+[\])]/gi;
  while ((m = re2.exec(text))) addId(ids, m[1]);
  // X"@[A,B) (Quilt/Forge)
  const re3 = /["']?([a-zA-Z0-9_.-]{2,})["']?@\[[^\]]+\]/g;
  while ((m = re3.exec(text))) addId(ids, m[1]);
  // version range [A,B) ... рядом с id
  const re4 = /["']?([a-zA-Z0-9_.-]{2,})["']?[^\]\n]*?version range\s*\[[^\]]+\]/g;
  while ((m = re4.exec(text))) addId(ids, m[1]);
  return ids;
}

function extractQuotedIds(text) {
  const ids = [];
  const re = /"([a-zA-Z0-9_.-]+)"/g;
  let m;
  while ((m = re.exec(text))) {
    const id = m[1];
    if (SKIP_IDS.test(id)) continue;
    addId(ids, id);
  }
  return ids;
}

function extractRelations(text) {
  // relations[modId] = { neededBy: [...], conflictsWith: [...] }
  const rel = {};
  const add = (a) => { if (!rel[a]) rel[a] = { neededBy: [], conflictsWith: [] }; return rel[a]; };
  let m;
  // Fabric:  Mod "X" is required by "Y" (file.jar) ... -> Y нужен X
  const re1 = /Mod\s+"([a-zA-Z0-9_.-]+)"\s+is required by\s+"([a-zA-Z0-9_.-]+)"/g;
  while ((m = re1.exec(text))) add(m[1]).neededBy.push(m[2]);
  // Fabric (старый): required mod "X" for mod "Y"
  const re2 = /required mod\s+"([a-zA-Z0-9_.-]+)"\s+for mod\s+"([a-zA-Z0-9_.-]+)"/g;
  while ((m = re2.exec(text))) add(m[1]).neededBy.push(m[2]);
  // The mod "Y" requires mod "X" / Mod "Y" requires version "V" of "X" / requires mod "X" version [..]
  const re3 = /(?:The\s+)?mod\s+"?([a-zA-Z0-9_.-]+)"?\s+requires\s+(?:any\s+version\s+of\s+|mod\s+)?["']?([a-zA-Z0-9_.-]+)["']?/gi;
  while ((m = re3.exec(text))) {
    if (!SKIP_IDS.test(m[1]) && !SKIP_IDS.test(m[2]) && m[1].toLowerCase() !== m[2].toLowerCase()) add(m[2]).neededBy.push(m[1]);
  }
  const re3b = /requires\s+version\s+["']?[0-9][^"']*["']?\s+of\s+"?([a-zA-Z0-9_.-]+)"?\s+for\s+"?([a-zA-Z0-9_.-]+)"?/gi;
  while ((m = re3b.exec(text))) { if (!SKIP_IDS.test(m[1]) && !SKIP_IDS.test(m[2])) add(m[1]).neededBy.push(m[2]); }
  // Conflict: Mod "X" (file) is incompatible with "Y" (file)
  const re4 = /Mod\s+"([a-zA-Z0-9_.-]+)"\s*\([^)]*\)\s+is incompatible with\s+"([a-zA-Z0-9_.-]+)"/gi;
  while ((m = re4.exec(text))) { add(m[1]).conflictsWith.push(m[2]); add(m[2]).conflictsWith.push(m[1]); }
  // Conflict: mod "X" is incompatible with mod "Y" / "X" conflicts with "Y"
  const re5 = /mod\s+["']([a-zA-Z0-9_.-]+)["']\s+(?:is incompatible with|conflicts with)\s+mod\s+["']([a-zA-Z0-9_.-]+)["']/gi;
  while ((m = re5.exec(text))) { add(m[1]).conflictsWith.push(m[2]); add(m[2]).conflictsWith.push(m[1]); }
  const re6 = /["']?([a-zA-Z0-9_.-]{2,})["']?\s+(?:conflicts with|is incompatible with)\s+["']?([a-zA-Z0-9_.-]{2,})["']?/gi;
  while ((m = re6.exec(text))) {
    if (!SKIP_IDS.test(m[1]) && !SKIP_IDS.test(m[2])) { add(m[1]).conflictsWith.push(m[2]); add(m[2]).conflictsWith.push(m[1]); }
  }
  return rel;
}

function extractRanges(text) {
  const ranges = {};
  let m;
  // requires version "V" of "X"
  const re1 = /requires\s+version\s+["']?([0-9][^"'\s,;)]*)["']?\s+of\s+["']?([a-zA-Z0-9_.-]+)["']?/gi;
  while ((m = re1.exec(text))) ranges[m[2].toLowerCase()] = m[1].trim();
  // requires mod "X" version [A,B)
  const re2 = /requires\s+mod\s+"([a-zA-Z0-9_.-]+)"\s+version\s+([\[\(][^\]\)\n]+[\])])/gi;
  while ((m = re2.exec(text))) ranges[m[1].toLowerCase()] = m[2].trim();
  // X"@[A,B)
  const re3 = /["']?([a-zA-Z0-9_.-]+)["']?@\[([^\]]+)\]/g;
  while ((m = re3.exec(text))) if (!ranges[m[1].toLowerCase()]) ranges[m[1].toLowerCase()] = '[' + m[2].trim() + ')';
  // version range [A,B)
  const re4 = /["']?([a-zA-Z0-9_.-]+)["']?[^\]\n]*?version range\s*\[([^\]]+)\]/g;
  while ((m = re4.exec(text))) if (!ranges[m[1].toLowerCase()]) ranges[m[1].toLowerCase()] = '[' + m[2].trim() + ')';
  // version X or later of "Y"
  const re5 = /requires\s+version\s+([0-9][\d.]*)\s+or later\s+of\s+["']?([a-zA-Z0-9_.-]+)["']?/gi;
  while ((m = re5.exec(text))) if (!ranges[m[2].toLowerCase()]) ranges[m[2].toLowerCase()] = '>= ' + m[1].trim();
  return ranges;
}

/* ============ Основной парсер ============ */

function parse(text) {
  if (!text || !String(text).trim()) return Promise.resolve([]);
  const src = String(text);
  const relations = extractRelations(src);
  const ranges = extractRanges(src);

  const candidates = [];
  const cand = (kind, title, detail, ids, actionForMod, extra) => {
    const list = uniq(ids || []);
    // Если у проблемы есть кнопка действия — без модов она бесполезна
    if (actionForMod && !list.length) return;
    candidates.push(Object.assign({ kind, title, detail, ids: list, actionForMod }, extra || {}));
  };

  /* --- Fabric / Quilt / Forge / NeoForge: отсутствующие моды --- */
  if (
    /Missing mods?:/i.test(src) ||
    /required mod\s+"[^"]+"\s+for mod/i.test(src) ||
    /which is missing/i.test(src) ||
    /could not be located/i.test(src) ||
    /Missing or unsupported mandatory dependencies/i.test(src) ||
    /Missing dependency/i.test(src) ||
    /requires (?:mods?|any version of)[^,;]*to be present/i.test(src) ||
    /The following mods (?:are missing|could not be located|are required)/i.test(src)
  ) {
    const ids = extractMissingIds(src);
    if (ids.length) {
      cand('missing_dep', 'Отсутствуют моды-зависимости',
        'Игра не запустилась: не хватает модов, которые нужны другим модам. Установите их — кнопкой «Скачать» рядом с каждым.',
        ids, 'install');
    }
  }

  /* --- Conflict --- */
  // ВАЖНО: «Incompatible mods found!» / «Some of your mods are incompatible with
  // the game or each other!» — это ОБЩИЙ баннер Fabric при любой ошибке резолва
  // модов (не только при конфликте). Поэтому он НЕ должен давать «Конфликт модов».
  // Настоящий конфликт распознаём только по конкретным фразам:
  //   "X conflicts with Y", mod "X" is incompatible with mod "Y",
  //   секции "Conflicts:" / "Conflicting mods".
  if (
    /conflicts with/i.test(src) ||
    /Conflicts?:/i.test(src) ||
    /Conflicting mods?/i.test(src) ||
    /Incompatible set of mods/i.test(src) ||
    /contains conflicting/i.test(src) ||
    /is incompatible with\s+(?:mod\s+)?["'][a-zA-Z0-9_.-]+["']/i.test(src) ||
    /mod\s+["'][a-zA-Z0-9_.-]+["']\s+is incompatible with/i.test(src)
  ) {
    let ids = extractConflictIds(src);
    if (!ids.length) {
      for (const [k, v] of Object.entries(relations)) {
        if (v.conflictsWith.length) { if (!ids.includes(k)) ids.push(k); for (const o of v.conflictsWith) if (!ids.includes(o)) ids.push(o); }
      }
    }
    if (!ids.length) ids = extractQuotedIds(src);
    cand('conflict', 'Конфликт модов',
      'Два мода не могут работать вместе. Удалите один из конфликтующих модов — выберите, какой оставить.',
      ids, ids.length ? 'remove' : null);
  }

  /* --- Duplicate --- */
  if (/Duplicate mods?:/i.test(src) || /was added by multiple mods/i.test(src) || /Duplicate entry/i.test(src) || /Multiple mods provide/i.test(src) || /added multiple times/i.test(src)) {
    const dupIds = extractQuotedIds(src);
    cand('duplicate', 'Дубликаты модов',
      'Мод установлен несколько раз (разные файлы). Удалите лишние копии.',
      dupIds, dupIds.length ? 'remove' : null);
  }

  /* --- Wrong Minecraft version --- */
  const mcVersionReq = /requires\s+version\s+["']?[0-9][^"'\s,;)]*["']?\s+(?:or later\s+)?of\s+["']?minecraft["']?/i;
  if (
    /requires minecraft version/i.test(src) ||
    /requires minecraft\s+["']?[0-9]/i.test(src) ||
    mcVersionReq.test(src) ||
    /minecraft version .* (?:not supported|isn'?t supported|is not supported)/i.test(src) ||
    /needs minecraft/i.test(src)
  ) {
    const ids = extractVersionIds(src).length ? extractVersionIds(src) : extractQuotedIds(src);
    cand('wrong_mc', 'Не та версия Minecraft',
      'Мод не поддерживает эту версию Minecraft. Обновите мод до версии для вашей версии игры — кнопкой «Обновить».',
      ids, 'update');
  }

  /* --- Wrong loader version --- */
  if (
    /requires loader version/i.test(src) ||
    /requires (?:fabric|quilt|forge|neoforge)[- ]?loader/i.test(src) ||
    /loader version .* (?:not supported|isn'?t supported)/i.test(src) ||
    /requires version [^"]* of ["']?(?:fabricloader|quilt_loader)["']?/i.test(src)
  ) {
    cand('wrong_loader', 'Не та версия загрузчика',
      'Мод требует другую версию загрузчика модов. Пересоздайте сборку с актуальным загрузчиком (кнопка «Удалить» на мод и установка заново может не помочь — нужна пересборка).',
      extractQuotedIds(src), 'update');
  }

  /* --- Version mismatch --- */
  const hasVersionClause =
    /requires\s+version\s+["']?[0-9]/i.test(src) ||
    /requires\s+mod\s+"[^"]+"\s+version\s*[\[\(]/i.test(src) ||
    /version range/i.test(src) ||
    /incompatible version/i.test(src) ||
    /installed version/i.test(src) ||
    /but only\s+["']?[0-9]/i.test(src) ||
    /which is not present/i.test(src) ||
    /has invalid version requirements/i.test(src) ||
    /@\[[0-9]/i.test(src);
  const mcVersionExcl = /requires\s+version\s+["']?[0-9][^"'\s,;)]*["']?\s+(?:or later\s+)?of\s+["']?minecraft["']?/i;
  if (hasVersionClause && !mcVersionExcl.test(src)) {
    const ids = extractVersionIds(src);
    cand('version_mismatch', 'Не та версия мода',
      'Установленная версия мода не подходит. Обновите мод до совместимой версии — кнопкой «Обновить».',
      ids, 'update');
  }

  /* --- Mixin errors --- */
  if (
    /Mixin apply failed/i.test(src) ||
    /Mixin transformation of/i.test(src) ||
    /Mixin (?:prepare|inject|init|load) failed/i.test(src) ||
    /Could not load mixin/i.test(src) ||
    /Invalid mixin/i.test(src) ||
    /MixinApplyError/i.test(src) ||
    /mixinextras/i.test(src)
  ) {
    const mixinIds = extractQuotedIds(src);
    cand('mixin', 'Ошибка Mixin (мод не совместим)',
      'Сбой микширования кода — обычно из-за несовместимой версии мода. Обновите указанные моды или удалите несовместимый.',
      mixinIds, mixinIds.length ? 'update' : null);
  }

  /* --- NoClassDefFound / NoSuchMethod (API mismatch) --- */
  if (
    /java\.lang\.NoClassDefFoundError/i.test(src) ||
    /java\.lang\.ClassNotFoundException/i.test(src) ||
    /java\.lang\.NoSuchMethodError/i.test(src) ||
    /java\.lang\.NoSuchFieldError/i.test(src) ||
    /java\.lang\.AbstractMethodError/i.test(src) ||
    /java\.lang\.LinkageError/i.test(src) ||
    /Could not find or load main class/i.test(src)
  ) {
    const clsIds = extractQuotedIds(src);
    cand('no_class', 'Отсутствует класс (библиотека или API)',
      'Игре не хватает класса — обычно это несовместимая версия библиотеки или API-мода. Обновите подозрительные моды или пересоздайте сборку.',
      clsIds, clsIds.length ? 'update' : null);
  }

  /* --- Missing libraries / natives --- */
  if (
    /Could not find library/i.test(src) ||
    /Missing library/i.test(src) ||
    /Failed to find .* in classpath/i.test(src) ||
    /Missing .*\.jar/i.test(src)
  ) {
    cand('missing_lib', 'Отсутствует библиотека',
      'Не найдена библиотека/файл игры. Переустановите версию или пересоздайте сборку.',
      extractQuotedIds(src), null);
  }

  /* --- OOM --- */
  if (
    /OutOfMemoryError/i.test(src) ||
    /Not enough memory/i.test(src) ||
    /Java heap space/i.test(src) ||
    /Could not reserve enough space/i.test(src) ||
    /GC overhead limit exceeded/i.test(src)
  ) {
    cand('oom', 'Не хватает памяти',
      'Игре не хватило оперативной памяти. Увеличьте выделенную RAM в настройках или установите моды-оптимизаторы памяти.',
      OOM_MODS.map(m => m.slug), 'install');
  }

  /* --- Java --- */
  if (
    /Unable to locate a Java Runtime/i.test(src) ||
    /UnsupportedClassVersionError/i.test(src) ||
    /Unrecognized VM option/i.test(src) ||
    /A JNI error has occurred/i.test(src) ||
    /Error: could not open/i.test(src) ||
    /Unsupported Java/i.test(src) ||
    /Error occurred during initialization of VM/i.test(src)
  ) {
    cand('no_java', 'Проблема с Java',
      'Не найдена подходящая Java или она несовместима с этой версией Minecraft. Укажите путь к Java в настройках или установите Java из подсказки.',
      [], null);
  }

  /* --- Assets --- */
  if (
    /Couldn'?t load\s+asset/i.test(src) ||
    /Couldn'?t load.*assets/i.test(src) ||
    /Invalid agent/i.test(src) ||
    /Failed to download/i.test(src) ||
    /No such file or directory.*(assets|libraries)/i.test(src) ||
    /Textures are not loading/i.test(src)
  ) {
    cand('assets', 'Ошибка загрузки ресурсов',
      'Проблема с файлами игры (ассеты/библиотеки). Попробуйте переустановить версию.',
      [], null);
  }

  /* --- Login --- */
  if (
    /Failed to login/i.test(src) ||
    /Invalid session/i.test(src) ||
    /Authentication servers are down/i.test(src) ||
    /Bad Login/i.test(src)
  ) {
    cand('login', 'Не удалось войти в аккаунт',
      'Игра не смогла проверить аккаунт. Это нормально для оффлайн-игры, если версия требует онлайна.',
      [], null);
  }

  /* --- Native libraries --- */
  if (
    /UnsatisfiedLinkError/i.test(src) ||
    /LWJGLException/i.test(src) ||
    /GLFW error/i.test(src) ||
    /Failed to create display/i.test(src) ||
    /Failed to create window/i.test(src) ||
    /Could not load .*\.dll/i.test(src) ||
    /Unable to load .*native/i.test(src) ||
    /Couldn'?t load native/i.test(src)
  ) {
    cand('native', 'Ошибка нативных библиотек',
      'Не удалось загрузить системные библиотеки (графика/звук). Обновите драйверы видеокарты и перезапустите лаунчер.',
      [], null);
  }

  /* --- GPU / Graphics --- */
  if (
    /Could not initialize .* (?:GL|graphics|rendering)/i.test(src) ||
    /GL 33 is not supported/i.test(src) ||
    /OpenGL .* not supported/i.test(src) ||
    /Your graphics card/i.test(src) ||
    /D3D.*not supported/i.test(src) ||
    /Pixel format not accelerated/i.test(src)
  ) {
    cand('gpu', 'Проблема с видеокартой',
      'Видеокарта/драйвер не поддерживает требования игры. Обновите драйверы или включите программный рендеринг (если возможно).',
      [], null);
  }

  /* --- Corrupted files --- */
  if (
    /ZipException/i.test(src) ||
    /invalid END header/i.test(src) ||
    /Unexpected end of ZLIB/i.test(src) ||
    /format error: incorrect header/i.test(src) ||
    /Invalid or corrupt jarfile/i.test(src) ||
    /Cannot determine.*format/i.test(src) ||
    /unable to open .* as zip/i.test(src)
  ) {
    cand('corrupt', 'Повреждённый файл',
      'Файл игры повреждён или скачан не полностью. Переустановите версию или пересоздайте сборку.',
      extractQuotedIds(src), null);
  }

  // Объединяем кандидатов одного типа (собираем все id вместе)
  const merged = new Map();
  for (const c of candidates) {
    if (!merged.has(c.kind)) merged.set(c.kind, Object.assign({}, c, { ids: [] }));
    for (const id of c.ids) if (!merged.get(c.kind).ids.includes(id)) merged.get(c.kind).ids.push(id);
  }

  // Loader crash — только как фолбэк, если конкретных проблем не нашли
  if (merged.size === 0 && (
    /FormattedException/i.test(src) ||
    /ModResolutionException/i.test(src) ||
    /Mod loading error has occurred/i.test(src) ||
    /Mod Loading has failed/i.test(src) ||
    /LoaderException/i.test(src) ||
    /Error loading mods/i.test(src) ||
    /A mod crashed on load/i.test(src) ||
    /Failed to load mod/i.test(src) ||
    /Mod loading is disabled/i.test(src)
  )) {
    merged.set('loader_crash', {
      kind: 'loader_crash', title: 'Сбой загрузчика модов',
      detail: 'Загрузчик модов не смог загрузить сборку. Проверьте список модов — возможно, один из них несовместим.',
      ids: extractQuotedIds(src), actionForMod: null
    });
  }

  const problems = [];
  for (const c of merged.values()) {
    problems.push({ kind: c.kind, title: c.title, detail: c.detail, modIds: c.ids, actionForMod: c.actionForMod, relations, ranges });
  }

  return resolveAll(problems, new Resolver());
}

async function resolveAll(problems, resolver) {
  const out = [];
  for (const p of problems) {
    const rel = p.relations || {};
    const ranges = p.ranges || {};
    const modsList = [];
    const seen = new Set();
    for (const id of (p.modIds || [])) {
      const key = String(id).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const info = await resolver.resolve(id);
      if (info && info.skip) continue; // загрузчик/игра — не мод
      const entry = {
        id,
        slug: (info && info.slug) || id,
        title: (info && info.title) || id,
        icon_url: (info && info.icon_url) || '',
        action: p.actionForMod
      };
      const r = rel[id] || rel[key];
      if (r) {
        if (r.neededBy.length) entry.neededBy = uniq(r.neededBy);
        if (r.conflictsWith.length) entry.conflictsWith = uniq(r.conflictsWith);
      }
      if (ranges[id] || ranges[key]) entry.needVersion = ranges[id] || ranges[key];
      modsList.push(entry);
    }
    out.push({ kind: p.kind, title: p.title, detail: p.detail, mods: modsList });
  }
  return out;
}

/* ============ Чтение файлов ============ */

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
  } catch (e) {}
  // fallback: самый свежий .log в logs/
  try {
    const dir = path.join(gameDir, 'logs');
    const entries = await fsp.readdir(dir);
    const logs = entries.filter(n => n.endsWith('.log')).map(n => ({ n, p: path.join(dir, n), t: fs.statSync(path.join(dir, n)).mtimeMs }));
    logs.sort((a, b) => b.t - a.t);
    if (logs.length) return await fsp.readFile(logs[0].p, 'utf8');
  } catch (e) {}
  return '';
}

async function installedFilenames(buildId) {
  try {
    const raw = await fsp.readFile(path.join(mods.buildDir(buildId), 'installed.json'), 'utf8');
    const reg = JSON.parse(raw);
    return (reg.files || []).filter(f => f.type === 'mod').map(f => ({ slug: f.slug, filename: f.filename }));
  } catch (e) { return []; }
}

/* ============ Главная функция анализа ============ */

async function analyze({ buildId, gameDir, logBuffer }) {
  try {
    const crash = await readLatestCrashReport(gameDir);
    const latest = await readLatestLog(gameDir);
    const text = [logBuffer || '', crash, latest].join('\n');

    const problems = await parse(text);
    const installed = buildId ? await installedFilenames(buildId) : [];

    // Для всех проблем подставляем имя файла из реестра, если известно
    for (const p of problems) {
      if (!buildId) break;
      for (const m of p.mods) {
        const hit = installed.find(i => i.slug === m.slug);
        if (hit) m.filename = hit.filename;
      }
    }

    const report = { buildId: buildId || null, gameDir, problems };
    if (problems.length) {
      // Всегда пишем «последний отчёт» в фиксированное место — по нему ищется напоминание
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
