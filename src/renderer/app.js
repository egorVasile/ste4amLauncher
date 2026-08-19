'use strict';
(function () {
  const hasElectron = typeof window !== 'undefined' && !!window.st4am;
  const api = window.st4am || {
    invoke: () => Promise.reject(new Error('no electron')),
    on: () => () => {}
  };

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  let CURRENT_VERSION = '1.21.4';
  let STATE = { running: false, launching: false };

  const VER_TYPES = {
    release: ['РЕЛИЗ', 'release'],
    snapshot: ['СНАПШОТ', 'snapshot'],
    old_beta: ['БЕТА', 'beta'],
    old_alpha: ['АЛЬФА', 'beta'],
    beta: ['БЕТА', 'beta']
  };
  const typeOf = t => VER_TYPES[t] || ['РЕЛИЗ', 'release'];

  /* ===== Акцентный цвет иконки (края/углы) ===== */
  const ACCENT_CACHE = {};
  // Очередь с лимитом: декодирование картинок и чтение пикселей — CPU-bound,
  // обрабатываем понемногу, чтобы не создавать пиков при отрисовке списков
  const accentQueue = [];
  let accentBusy = 0;
  const ACCENT_MAX = 4;
  function applyEdgeAccent(imgEl, targetEl) {
    if (getCustom().accentEdges === false) return;
    const src = imgEl && imgEl.src;
    if (!src) return;
    if (ACCENT_CACHE[src] !== undefined) {
      if (ACCENT_CACHE[src]) setAccent(targetEl, ACCENT_CACHE[src]);
      return;
    }
    accentQueue.push({ src, targetEl });
    pumpAccent();
  }
  function pumpAccent() {
    while (accentBusy < ACCENT_MAX && accentQueue.length) {
      const job = accentQueue.shift();
      accentBusy++;
      const im = new Image();
      im.decoding = 'async';
      im.crossOrigin = 'anonymous';
      im.onload = () => {
        try {
          const S = 32;
          const c = new OffscreenCanvas(S, S);
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(im, 0, 0, S, S);
          const d = ctx.getImageData(0, 0, S, S).data;
          const bins = {};
          const E = 7; // толщина краевой рамки в пикселях
          for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
              // берём только края и углы, центр пропускаем
              if (x >= E && x < S - E && y >= E && y < S - E) continue;
              const i = (y * S + x) * 4;
              const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
              if (a < 200) continue;
              const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
              const sat = mx === 0 ? 0 : (mx - mn) / mx;
              // отбрасываем белый/серый/почти чёрный
              if (sat < 0.25 || mx < 50 || (mx > 235 && sat < 0.35)) continue;
              // вес: угловые пиксели важнее + насыщенность + яркость
              const corner = (x < E || x >= S - E) && (y < E || y >= S - E) ? 1.6 : 1;
              const h = rgbHue(r, g, b);
              const bin = Math.round(h / 15) * 15;
              const w = corner * sat * (mx / 255);
              if (!bins[bin]) bins[bin] = { w: 0, r: 0, g: 0, b: 0, n: 0 };
              bins[bin].w += w;
              bins[bin].r += r; bins[bin].g += g; bins[bin].b += b; bins[bin].n++;
            }
          }
          const top = Object.values(bins).sort((a, b) => b.w - a.w).slice(0, 3).filter(x => x.n);
          let cols = null;
          if (top.length) {
            cols = top.map(x => {
              const r = Math.round(x.r / x.n), g = Math.round(x.g / x.n), b = Math.round(x.b / x.n);
              const h = rgbHue(r, g, b);
              return 'hsl(' + Math.round(h) + ',72%,55%)';
            });
          }
          ACCENT_CACHE[job.src] = cols;
          if (cols) setAccent(job.targetEl, cols);
        } catch (e) { ACCENT_CACHE[job.src] = null; }
        accentBusy--;
        pumpAccent();
      };
      im.onerror = () => { ACCENT_CACHE[job.src] = null; accentBusy--; pumpAccent(); };
      im.src = job.src;
    }
  }
  function rgbHue(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), df = mx - mn;
    if (!df) return 0;
    let h;
    if (mx === r) h = ((g - b) / df) % 6;
    else if (mx === g) h = (b - r) / df + 2;
    else h = (r - g) / df + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  }
  function setAccent(el, cols) {
    if (!el || !el.isConnected) return;
    const arr = Array.isArray(cols) ? cols : [cols];
    el.style.setProperty('--accent', arr[0]);
    el.style.setProperty('--a1', arr[0]);
    el.style.setProperty('--a2', arr[1] || arr[0]);
    el.style.setProperty('--a3', arr[2] || arr[1] || arr[0]);
    el.classList.add('has-accent');
  }

  function modThumb(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const hue1 = h % 360;
    const hue2 = (hue1 + 40 + ((h >>> 8) % 60)) % 360;
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(' + hue1 + ',55%,32%)"/><stop offset="1" stop-color="hsl(' + hue2 + ',60%,20%)"/></linearGradient></defs><rect width="160" height="90" fill="url(#g)"/></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function setStatus(text, mode) {
    const dot = $('#statusDot');
    const txt = $('#statusText');
    if (!dot || !txt) return;
    dot.className = 'dot' + (mode ? ' ' + mode : '');
    txt.textContent = text;
    txt.style.animation = 'none';
    void txt.offsetWidth;
    txt.style.animation = 'mc-fade-down .25s ease';
  }

  /* ===== Табы ===== */
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      $$('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.tab-panel').forEach(p => p.classList.remove('active'));
      const panel = $('#tab-' + btn.dataset.tab);
      if (panel) panel.classList.add('active');
      if (btn.dataset.tab === 'favs') renderFavs();
      if (btn.dataset.tab === 'versions' && !VERSIONS_RENDERED) {
        VERSIONS_RENDERED = true;
        renderVersions();
      }
      setStatus('РАЗДЕЛ: ' + btn.dataset.tab.toUpperCase(), '');
    });
  });

  $('#logoBtn').addEventListener('click', () => {
    $$('.nav-item').forEach(b => b.classList.remove('active'));
    const p = $('.nav-item[data-tab="play"]');
    if (p) p.classList.add('active');
    $$('.tab-panel').forEach(x => x.classList.remove('active'));
    const tp = $('#tab-play');
    if (tp) tp.classList.add('active');
    setStatus('ОБНОВЛЕНО ТОЛЬКО ЧТО', '');
  });

  $('#brandBtn').addEventListener('click', () => {
    $('#brandBtn').style.animation = 'none';
    void $('#brandBtn').offsetWidth;
    $('#brandBtn').style.animation = 'mc-wiggle .4s ease';
  });

  /* ===== Аватар-меню ===== */
  const avatarBtn = $('#avatarBtn');
  const avatarMenu = $('#avatarMenu');
  if (avatarBtn) {
    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      avatarMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => avatarMenu.classList.add('hidden'));
    avatarMenu.addEventListener('click', (e) => e.stopPropagation());
    $$('#avatarMenu .am-item').forEach(item => {
      item.addEventListener('click', () => {
        avatarMenu.classList.add('hidden');
        if (item.dataset.act === 'logout') {
          setStatus('АККАУНТ СМЕНЁН \u00b7 ОФФЛАЙН', 'busy');
          setTimeout(() => setStatus('ГОТОВО К ИГРЕ', ''), 1500);
        }
      });
    });
  }

  /* ===== Dropdown версий ===== */
  const ddBtn = $('#versionDropdown');
  const ddMenu = $('#versionMenu');
  ddBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ddMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', () => ddMenu.classList.add('hidden'));
  ddMenu.addEventListener('click', (e) => e.stopPropagation());

  function applyVersion(id) {
    CURRENT_VERSION = id;
    ddBtn.innerHTML = '&#9662; ' + id;
    ddMenu.classList.add('hidden');
    $$('#versionMenu .dm-item').forEach(i => i.classList.toggle('selected', i.dataset.ver === id));
    if (!CURRENT_BUILD) {
      $('#versionTitle').textContent = 'Minecraft ' + id;
      $('#versionBadge').textContent = 'РЕЛИЗ';
      $('#topAccent').textContent = 'Minecraft ' + id;
      loadScreenshot(id, false);
    }
  }

  let CURRENT_PREVIEW_ID = null;
  function loadScreenshot(id, modded) {
    const prev = $('#versionPreview');
    if (!prev) return;
    CURRENT_PREVIEW_ID = id;
    const oldImg = prev.querySelector('img.shot');
    if (oldImg) oldImg.remove();
    prev.classList.toggle('modded', !!modded);
    if (modded) {
      const icon = CURRENT_BUILD && CURRENT_BUILD.icon ? ic(CURRENT_BUILD.icon) : ic('Grass.png');
      let iconEl = prev.querySelector('.shot-icon');
      if (!iconEl) {
        iconEl = document.createElement('img');
        iconEl.className = 'shot-icon';
        iconEl.alt = '';
        prev.appendChild(iconEl);
      }
      iconEl.src = icon;
      let label = prev.querySelector('.shot-icon-label');
      if (!label) {
        label = document.createElement('div');
        label.className = 'shot-icon-label';
        prev.appendChild(label);
      }
      label.textContent = CURRENT_BUILD ? CURRENT_BUILD.name : 'Minecraft ' + id;
    } else {
      const iconEl = prev.querySelector('.shot-icon');
      if (iconEl) iconEl.remove();
      const label = prev.querySelector('.shot-icon-label');
      if (label) label.remove();
    }
    api.invoke('version:screenshot', id, modded).then(url => {
      if (CURRENT_PREVIEW_ID !== id) return;
      if (prev.querySelector('img.shot')) return;
      const img = document.createElement('img');
      img.className = 'shot';
      img.src = url;
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
      prev.appendChild(img);
    }).catch(() => {});
  }

  $$('#versionMenu .dm-item').forEach(item => {
    item.addEventListener('click', () => applyVersion(item.dataset.ver));
  });

  /* ===== Реальные версии (из манифеста) ===== */
  let VERSION_LIST = [];
  let VERSIONS_RENDERED = false;
  function versionFilter(v) {
    if (settingsCache.showOldVersions === false && (v.type === 'old_alpha' || v.type === 'old_beta')) return false;
    if (settingsCache.showSnapshots === false && (v.type === 'snapshot' || v.type === 'old_beta' || v.type === 'old_alpha')) return false;
    return true;
  }
  function buildVersionsFromManifest(list) {
    VERSION_LIST = list;
    // Ленивый рендер: строим сотни строк версий только при первом открытии вкладки
    if (VERSIONS_RENDERED) renderVersions();
  }
  function renderVersions() {
    const d = $('#versionsList');
    if (!d) return;
    VERSIONS_RENDERED = true;
    d.innerHTML = '';
    const shown = VERSION_LIST.filter(versionFilter);
    shown.forEach((v, idx) => {
      const t = typeOf(v.type);
      const row = document.createElement('div');
      row.className = 'ver-row';
      row.style.animationDelay = (idx * 0.02) + 's';
      const icon = ['Diamond_Ore.png','Gold_Ore.png','Iron_Ore.png','Redstone_Ore.png','Emerald_Ore.png','Coal_Ore.png'][idx % 6];
      row.innerHTML = `
        <div class="v-icon" style="background-image:url('${ic(icon)}')"></div>
        <div class="v-name">${v.id}</div>
        <div class="v-type ${t[1]}">${t[0]}</div>
        <div class="v-play" data-v="${v.id}">&#9654; ИГРАТЬ</div>`;
      row.addEventListener('click', () => row.querySelector('.v-play').click());
      d.appendChild(row);
    });
    $$('#versionsList .v-play').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyVersion(btn.dataset.v);
        $('#versionDropdown').innerHTML = '&#9662; ' + btn.dataset.v;
        startLaunch();
      });
    });
  }

  /* ===== Моды (заглушка: fabric/vanilla) ===== */
  const MODS = [
    ['Fabric Loader', '0.16.9 \u00b7 скоро', 'Log_Oak.png', true],
    ['Forge', '50.1.0 \u00b7 скоро', 'Furnace.png', false],
    ['NeoForge', '21.1.0 \u00b7 скоро', 'Obsidian.png', false],
    ['Quilt Loader', '0.27.1 \u00b7 скоро', 'Wool.png', false],
    ['OptiFine', 'HD U I6 \u00b7 скоро', 'Glass.png', false],
    ['Sodium', '0.6.3 \u00b7 скоро', 'Redstone_Block.png', false]
  ];
  function buildMods() {
    const list = $('#modsList');
    if (!list) return;
    list.innerHTML = '';
    MODS.forEach((m, idx) => {
      const row = document.createElement('div');
      row.className = 'mod-row';
      row.style.animationDelay = (idx * 0.05) + 's';
      row.innerHTML = `
        <div class="m-icon" style="background-image:url('${ic(m[2])}')"></div>
        <div><div class="m-name">${m[0]}</div><div class="m-sub">${m[1]}</div></div>
        <div class="switch ${m[3] ? 'on' : ''}"></div>`;
      const sw = row.querySelector('.switch');
      sw.addEventListener('click', (e) => {
        e.stopPropagation();
        sw.classList.toggle('on');
        setStatus(m[0].toUpperCase() + ' ВКЛЮЧЁН', '');
      });
      list.appendChild(row);
    });
  }

  /* ===== Новости (заглушка) ===== */
  const NEWS = [
    ['Вышла Minecraft 1.21.4', 'Прыгающие блоки, новые испытания и многое другое.', '03.12.2024', 'Diamond_Ore.png'],
    ['Скидки на бандлы', 'Маркетплейс запускает осеннюю распродажу.', '28.11.2024', 'Gold_Ore.png'],
    ['Обновление Fabric 0.16.9', 'Поддержка новых версий и исправления.', '20.11.2024', 'Iron_Ore.png'],
    ['Оптимизация лаунчера', 'Теперь игра запускается в 2 раза быстрее.', '15.11.2024', 'Redstone_Ore.png']
  ];
  const NEWS_ICONS = ['Diamond_Ore.png', 'Gold_Ore.png', 'Iron_Ore.png', 'Redstone_Ore.png'];
  function buildNews() {
    const mk = (n, i) => {
      const isArr = Array.isArray(n);
      const title = escapeHtml(isArr ? n[0] : (n.title || ''));
      const desc = escapeHtml(isArr ? (n[1] || '') : (n.desc || ''));
      const date = isArr ? n[2] : (n.date || '');
      const img = !isArr && n.images && n.images[0] ? n.images[0] : '';
      const icon = isArr && n[3] ? n[3] : NEWS_ICONS[i % NEWS_ICONS.length];
      const idx = isArr ? -1 : i;
      const thumb = img
        ? `<div class="news-thumb" style="background-image:url('${img}')"></div>`
        : `<div class="news-thumb" style="background-image:url('${ic(icon)}')"></div>`;
      return `
      <div class="news-item" data-idx="${idx}">
        ${thumb}
        <div>
          <h4>${title}</h4>
          <p>${desc}</p>
          <div class="date">${date}</div>
        </div>
      </div>`;
    };
    const wire = (box, arr) => {
      if (!box) return;
      box.innerHTML = '';
      arr.forEach((n, i) => box.insertAdjacentHTML('beforeend', mk(n, i)));
      box.querySelectorAll('.news-item').forEach(it => {
        const idx = parseInt(it.getAttribute('data-idx'), 10);
        if (isNaN(idx) || idx < 0 || !arr[idx]) return;
        it.style.cursor = 'pointer';
        it.addEventListener('click', () => openNewsModal(arr[idx]));
      });
    };
    const list = $('#newsList');
    const full = $('#newsFullList');
    api.invoke('news:fetch').then(ns => {
      const arr = Array.isArray(ns) && ns.length ? ns : NEWS;
      wire(list, arr);
      wire(full, arr);
    }).catch(() => {
      wire(list, NEWS);
      wire(full, NEWS);
    });
  }
  function openNewsModal(n) {
    if (!n || Array.isArray(n)) return;
    const images = Array.isArray(n.images) ? n.images.filter(Boolean) : [];
    const title = escapeHtml(n.title || '');
    const date = n.date || '';
    const text = (n.text || n.desc || '').split('\n').map(l => escapeHtml(l)).join('<br>');
    let gallery = '';
    if (images.length) {
      const dots = images.map((_, i) => `<span class="nw-dot${i === 0 ? ' on' : ''}" data-i="${i}"></span>`).join('');
      gallery = `
        <div class="nw-gallery">
          <div class="nw-img" id="nwImg" style="background-image:url('${images[0]}')"></div>
          ${images.length > 1 ? '<button class="nw-nav nw-prev" id="nwPrev">&#9664;</button><button class="nw-nav nw-next" id="nwNext">&#9654;</button>' : ''}
          ${images.length > 1 ? `<div class="nw-dots">${dots}</div>` : ''}
        </div>`;
    }
    const html = `
      <div class="nw-box">
        ${gallery}
        <div class="nw-title">${title}</div>
        <div class="nw-date">${date}</div>
        <div class="nw-text">${text}</div>
      </div>`;
    openModal('НОВОСТЬ', html);
    if (images.length > 1) {
      let cur = 0;
      const img = $('#nwImg');
      const dots = $$('.nw-dot');
      const show = (i) => {
        cur = (i + images.length) % images.length;
        img.style.backgroundImage = "url('" + images[cur] + "')";
        dots.forEach((d, di) => d.classList.toggle('on', di === cur));
      };
      const prev = $('#nwPrev'), next = $('#nwNext');
      if (prev) prev.addEventListener('click', (e) => { e.stopPropagation(); show(cur - 1); });
      if (next) next.addEventListener('click', (e) => { e.stopPropagation(); show(cur + 1); });
      dots.forEach(d => d.addEventListener('click', (e) => { e.stopPropagation(); show(parseInt(d.dataset.i, 10)); }));
    }
  }
  buildNews();
  const refreshNewsBtn = $('#refreshNews');
  if (refreshNewsBtn) refreshNewsBtn.addEventListener('click', () => {
    refreshNewsBtn.style.animation = 'none';
    void refreshNewsBtn.offsetWidth;
    refreshNewsBtn.style.animation = 'mc-spin .6s ease';
    buildNews();
    setStatus('НОВОСТИ ОБНОВЛЕНЫ', '');
  });

  /* ===== Настройки (реальные) ===== */
  const modal = $('#modalBackdrop');
  let settingsCache = { username: 'Player', ram: 2, mirror: 'auto', theme: 'dark', totalRam: 8, width: '', height: '', launcherMode: 'keep', economy: false, custom: null };

  /* ===== Кастомизация (0.2.8) ===== */
  const CUSTOM_DEFAULTS = {
    skinUuid: '', skinNickname: '', skinModel: 'classic', skinTexture: '', skinCape: '', skinInGame: false,
    cardSize: 'md', cardLayout: 'default', hover: 'lift',
    cardAnim: true, accentEdges: true, galleryZoom: true
  };
  function getCustom() {
    return { ...CUSTOM_DEFAULTS, ...(settingsCache.custom || {}) };
  }
  function saveCustom(c) {
    const merged = { ...CUSTOM_DEFAULTS, ...(c || settingsCache.custom || {}) };
    settingsCache.custom = merged;
    api.invoke('settings:set', 'custom', merged).catch(() => {});
    applyCustom();
    return merged;
  }
  function applyCustom() {
    const c = getCustom();
    const root = document.documentElement;
    root.classList.toggle('cust-sm', c.cardSize === 'sm');
    root.classList.toggle('cust-lg', c.cardSize === 'lg');
    root.classList.toggle('cust-hover-lift', c.hover === 'lift');
    root.classList.toggle('cust-hover-glow', c.hover === 'glow');
    root.classList.toggle('cust-hover-none', c.hover === 'none');
    root.classList.toggle('cust-noanim', c.cardAnim === false);
    root.classList.toggle('cust-noaccent', c.accentEdges === false);
  }

  function safeRam(r) {
    const n = parseInt(r, 10);
    if (!Number.isFinite(n)) return 2;
    return Math.max(1, Math.min(n, settingsCache.totalRam || 8));
  }

  function buildSettingsPanel() {
    const panel = $('#settingsPanel');
    if (!panel) return;
    panel.innerHTML = `
      <div class="set-cat">ВНЕШНИЙ ВИД</div>
      <div class="set-row"><div><div class="s-label">ТЕМА</div><div class="s-desc">Официальная светлая или тёмная (как в лаунчере Mojang)</div></div>
      <div class="theme-seg" id="themeSeg"><button class="b-type-btn t-opt${settingsCache.theme === 'light' ? ' sel' : ''}" data-t="light">СВЕТЛАЯ</button><button class="b-type-btn t-opt${settingsCache.theme === 'dark' ? ' sel' : ''}" data-t="dark">ТЁМНАЯ</button><button class="b-type-btn t-opt${settingsCache.theme === 'system' ? ' sel' : ''}" data-t="system">СИСТЕМА</button></div></div>
      <div class="set-row"><div><div class="s-label">КАСТОМИЗАЦИЯ</div><div class="s-desc">Скин профиля и оформление кнопок</div></div><button class="dropdown" style="padding:7px 12px;font-size:13px" id="custBtn">НАСТРОИТЬ</button></div>
      <div class="set-cat">ПРОФИЛЬ</div>
      <div class="set-row"><div><div class="s-label">ИМЯ (OFFLINE)</div><div class="s-desc">Ник для оффлайн-режима</div></div>
      <input type="text" id="nickInput" value="${escapeHtml(settingsCache.username)}" style="background:var(--mc-grey-5);border:2px solid var(--mc-off-black);color:var(--mc-off-white);padding:7px 10px;font-family:var(--mc-font);font-size:13px;width:180px;outline:none"/></div>
      <div class="set-cat">ИГРА</div>
      <div class="set-row"><div><div class="s-label">ПАМЯТЬ (RAM)</div><div class="s-desc">Выделенная память для игры (макс. ${settingsCache.totalRam} GB — реальная)</div></div>
      <input type="range" id="ram2" min="1" max="${settingsCache.totalRam}" step="1" value="${safeRam(settingsCache.ram)}"/><div class="s-value" id="ram2v">${safeRam(settingsCache.ram)} GB</div></div>
      <div class="set-row"><div><div class="s-label">ПОКАЗЫВАТЬ СНАПШОТЫ</div><div class="s-desc">Скрыть нестабильные версии из списка</div></div><div class="switch ${settingsCache.showSnapshots ? 'on' : ''}" id="swSnap"></div></div>
      <div class="set-row"><div><div class="s-label">СТАРЫЕ ВЕРСИИ</div><div class="s-desc">Показывать alpha/beta (2010-2013)</div></div><div class="switch ${settingsCache.showOldVersions ? 'on' : ''}" id="swOld"></div></div>
      <div class="set-row"><div><div class="s-label">ОПТИМИЗАЦИЯ МАЙНКРАФТА</div><div class="s-desc">G1GC-флаги, быстрый запуск, настройки памяти</div></div><div class="switch ${settingsCache.optimize ? 'on' : ''}" id="swOpt"></div></div>
      <div class="set-row"><div><div class="s-label">ЭКОНОМИЯ CPU</div><div class="s-desc" style="color:var(--mc-green-2)">Отключить декоративные анимации и дрифт фона — меньше нагрузка на процессор</div></div><div class="switch ${settingsCache.economy ? 'on' : ''}" id="swEco"></div></div>
      <div class="set-row"><div><div class="s-label">JVM-АРГУМЕНТЫ</div><div class="s-desc">Дополнительные флаги для Java (через пробел)</div></div><input type="text" id="jvmInput" value="${escapeHtml(settingsCache.jvmArgs)}" placeholder="-XX:+UseZGC ..." style="background:var(--mc-grey-5);border:2px solid var(--mc-off-black);color:var(--mc-off-white);padding:7px 10px;font-family:Consolas,monospace;font-size:12px;width:220px;outline:none"/></div>
      <div class="set-row"><div><div class="s-label">ЗЕРКАЛО</div><div class="s-desc">auto = Mojang, при ошибке BMCLAPI</div></div><div class="dropdown" style="padding:7px 12px;font-size:13px" id="mirrorDD">&#9662; ${settingsCache.mirror}</div></div>
      <div class="set-row"><div><div class="s-label">JAVA</div><div class="s-desc">Найденная Java при запуске</div></div><button class="dropdown" style="padding:7px 12px;font-size:13px" id="javaBtn">НАЙТИ JAVA</button></div>
      <div class="set-row"><div><div class="s-label">РАЗРЕШЕНИЕ ЭКРАНА</div><div class="s-desc">Ширина x Высота (пусто = как в игре)</div></div><div style="display:flex;align-items:center;gap:6px"><input type="text" id="resW" inputmode="numeric" placeholder="1280" value="${escapeHtml(settingsCache.width || '')}" style="width:70px;background:var(--mc-grey-5);border:2px solid var(--mc-off-black);color:var(--mc-off-white);padding:7px 6px;font-family:var(--mc-font);font-size:12px;text-align:center;outline:none"/><span style="color:var(--mc-grey-3)">x</span><input type="text" id="resH" inputmode="numeric" placeholder="720" value="${escapeHtml(settingsCache.height || '')}" style="width:70px;background:var(--mc-grey-5);border:2px solid var(--mc-off-black);color:var(--mc-off-white);padding:7px 6px;font-family:var(--mc-font);font-size:12px;text-align:center;outline:none"/></div></div>
      <div class="set-cat">ЗАПУСК</div>
      <div class="set-row"><div><div class="s-label">ЛАУНЧЕР ПОСЛЕ ЗАПУСКА</div><div class="s-desc">Как вести себя после старта игры</div></div>
      <div class="theme-seg" id="lmSeg"><button class="b-type-btn t-opt${settingsCache.launcherMode === 'keep' ? ' sel' : ''}" data-lm="keep">ОСТАВИТЬ</button><button class="b-type-btn t-opt${settingsCache.launcherMode === 'minimize' ? ' sel' : ''}" data-lm="minimize">СВЕРНУТЬ</button><button class="b-type-btn t-opt${settingsCache.launcherMode === 'close' ? ' sel' : ''}" data-lm="close">ЗАКРЫТЬ</button></div></div>
      
      <div class="set-cat">ПАПКИ</div>
<div class="set-row"><div><div class="s-label">КАТАЛОГ ИГРЫ</div><div class="s-desc">Открыть папку .st4amlauncher/game</div></div><button class="dropdown" 
      style="padding:7px 12px;font-size:13px" id="openDirBtn">ОТКРЫТЬ</button></div>
      <div class="set-row"><div><div class="s-label">ПАПКИ ЛАУНЧЕРА</div><div class="s-desc">Открыть корневую папку или папку модов</div></div><div style="display:flex;gap:8px"><button class="dropdown" style="padding:7px 12px;font-size:13px;flex:1" id="openRootBtn">КОРНЕВАЯ</button><button class="dropdown" style="padding:7px 12px;font-size:13px;flex:1" id="openModsBtn">MODS</button></div></div>
      
      <div class="set-cat">СИСТЕМА</div><div class="set-row" id="expRow"><div><div class="s-label">ЭКСПЕРИМЕНТАЛЬНО</div><div class="s-desc" style="color:var(--mc-green-2)">Сборки модов, каталог Modrinth, многое другое</div></div><div class="switch ${settingsCache.experimental ? 'on' : ''}" id="expSw"></div></div>
      <div class="set-row"><div><div class="s-label">СБРОСИТЬ</div><div class="s-desc">Вернуть значения по умолчанию</div></div><button class="dropdown" style="padding:7px 12px;font-size:13px" id="resetBtn">СБРОС</button></div>`;

    const ram = $('#ram2');
    ram.addEventListener('input', () => {
      const v = safeRam(ram.value);
      ram.value = v;
      $('#ram2v').textContent = v + ' GB';
      settingsCache.ram = v;
      api.invoke('settings:set', 'ram', v);
    });
    $('#nickInput').addEventListener('change', (e) => {
      const v = (e.target.value || 'Player').trim() || 'Player';
      api.invoke('settings:set', 'username', v);
      settingsCache.username = v;
      setStatus('ИМЯ СОХРАНЕНО: ' + v.toUpperCase(), '');
    });
    $('#jvmInput').addEventListener('change', (e) => {
      const v = (e.target.value || '').trim();
      api.invoke('settings:set', 'jvmArgs', v);
      settingsCache.jvmArgs = v;
      setStatus('JVM-АРГУМЕНТЫ СОХРАНЕНЫ', '');
    });
    $('#swSnap').addEventListener('click', () => {
      settingsCache.showSnapshots = !settingsCache.showSnapshots;
      $('#swSnap').classList.toggle('on', settingsCache.showSnapshots);
      api.invoke('settings:set', 'showSnapshots', settingsCache.showSnapshots);
      renderVersions();
      setStatus(settingsCache.showSnapshots ? 'СНАПШОТЫ ВИДНЫ' : 'СНАПШОТЫ СКРЫТЫ', '');
    });
    $('#swOld').addEventListener('click', () => {
      settingsCache.showOldVersions = !settingsCache.showOldVersions;
      $('#swOld').classList.toggle('on', settingsCache.showOldVersions);
      api.invoke('settings:set', 'showOldVersions', settingsCache.showOldVersions);
      renderVersions();
      setStatus(settingsCache.showOldVersions ? 'СТАРЫЕ ВЕРСИИ ВИДНЫ' : 'СТАРЫЕ ВЕРСИИ СКРЫТЫ', '');
    });
    $('#swOpt').addEventListener('click', () => {
      settingsCache.optimize = !settingsCache.optimize;
      $('#swOpt').classList.toggle('on', settingsCache.optimize);
      api.invoke('settings:set', 'optimize', settingsCache.optimize);
      setStatus(settingsCache.optimize ? 'ОПТИМИЗАЦИЯ ВКЛЮЧЕНА' : 'ОПТИМИЗАЦИЯ ВЫКЛЮЧЕНА', '');
    });
    const ecoSw = $('#swEco');
    if (ecoSw) ecoSw.addEventListener('click', () => {
      settingsCache.economy = !settingsCache.economy;
      ecoSw.classList.toggle('on', settingsCache.economy);
      api.invoke('settings:set', 'economy', settingsCache.economy);
      applyEco();
      setStatus(settingsCache.economy ? 'ЭКОНОМИЯ CPU: ВКЛ' : 'ЭКОНОМИЯ CPU: ВЫКЛ', '');
    });
    $('#mirrorDD').addEventListener('click', () => {
      const next = settingsCache.mirror === 'auto' ? 'bmclapi' : (settingsCache.mirror === 'bmclapi' ? 'mojang' : 'auto');
      settingsCache.mirror = next;
      $('#mirrorDD').innerHTML = '&#9662; ' + next;
      api.invoke('settings:set', 'mirror', next);
      setStatus('ЗЕРКАЛО: ' + next.toUpperCase(), '');
    });
    $('#javaBtn').addEventListener('click', () => {
      setStatus('ИЩУ JAVA...', 'busy');
      api.invoke('settings:java-search').then(java => {
        setStatus(java ? 'JAVA: ' + java.split('\\').pop() : 'JAVA НЕ НАЙДЕНА', '');
      });
    });
    const saveRes = (key, input) => {
      const v = (input.value || '').trim().replace(/\D/g, '');
      input.value = v;
      settingsCache[key] = v;
      api.invoke('settings:set', key, v);
    };
    const resW = $('#resW');
    const resH = $('#resH');
    if (resW && resH) {
      resW.addEventListener('change', () => saveRes('width', resW));
      resH.addEventListener('change', () => saveRes('height', resH));
    }
    $('#lmSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('.t-opt');
      if (!btn) return;
      settingsCache.launcherMode = btn.dataset.lm;
      $('#lmSeg').querySelectorAll('.t-opt').forEach(b => b.classList.toggle('sel', b.dataset.lm === settingsCache.launcherMode));
      api.invoke('settings:set', 'launcherMode', settingsCache.launcherMode);
      setStatus('ЛАУНЧЕР: ' + btn.dataset.lm.toUpperCase(), '');
    });
    $('#openDirBtn').addEventListener('click', () => {
      api.invoke('game:open-dir').then(() => setStatus('КАТАЛОГ ИГРЫ ОТКРЫТ', ''));
    });
    $('#openRootBtn').addEventListener('click', () => {
      api.invoke('shell:open-root').then(() => setStatus('КОРНЕВАЯ ПАПКА ОТКРЫТА', ''));
    });
    $('#openModsBtn').addEventListener('click', () => {
      api.invoke('shell:open-mods').then(() => setStatus('ПАПКА MODS ОТКРЫТА', ''));
    });
    $('#themeSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('.t-opt');
      if (!btn) return;
      settingsCache.theme = btn.dataset.t;
      api.invoke('settings:set', 'theme', settingsCache.theme);
      applyTheme();
      setStatus('ТЕМА: ' + btn.dataset.t.toUpperCase(), '');
    });
    const custBtn = $('#custBtn');
    if (custBtn) custBtn.addEventListener('click', () => openCustModal());
    $('#expSw').addEventListener('click', () => {
      settingsCache.experimental = !settingsCache.experimental;
      $('#expSw').classList.toggle('on', settingsCache.experimental);
      api.invoke('settings:set', 'experimental', settingsCache.experimental);
      showBuildsTab(settingsCache.experimental);
      setStatus(settingsCache.experimental ? 'ЭКСПЕРИМЕНТАЛЬНО: ВКЛ' : 'ЭКСПЕРИМЕНТАЛЬНО: ВЫКЛ', '');
    });
    $('#resetBtn').addEventListener('click', () => {
      ram.value = 2; $('#ram2v').textContent = '2 GB';
      settingsCache = { ...settingsCache, ram: 2, jvmArgs: '', showSnapshots: true, optimize: true, width: '', height: '', launcherMode: 'keep', economy: false };
      api.invoke('settings:set', 'ram', 2);
      api.invoke('settings:set', 'jvmArgs', '');
      api.invoke('settings:set', 'showSnapshots', true);
      api.invoke('settings:set', 'optimize', true);
      api.invoke('settings:set', 'width', '');
      api.invoke('settings:set', 'height', '');
      api.invoke('settings:set', 'launcherMode', 'keep');
      api.invoke('settings:set', 'economy', false);
      applyEco();
      settingsCache.custom = { ...CUSTOM_DEFAULTS };
      api.invoke('settings:set', 'custom', settingsCache.custom);
      applyCustom();
      $('#lmSeg').querySelectorAll('.t-opt').forEach(b => b.classList.toggle('sel', b.dataset.lm === 'keep'));
      const rW = $('#resW'), rH = $('#resH');
      if (rW) rW.value = '';
      if (rH) rH.value = '';
      setStatus('НАСТРОЙКИ СБРОШЕНЫ', 'busy');
      setTimeout(() => setStatus('ГОТОВО', ''), 1200);
    });
  }

  function applyTheme() {
    const pref = settingsCache.theme || 'dark';
    const sys = window.matchMedia('(prefers-color-scheme: light)').matches;
    const eff = pref === 'system' ? (sys ? 'light' : 'dark') : pref;
    const root = document.documentElement;
    root.classList.add('theming');
    root.dataset.theme = eff;
    clearTimeout(applyTheme._t);
    applyTheme._t = setTimeout(() => root.classList.remove('theming'), 300);
    const seg = $('#themeSeg');
    if (seg) seg.querySelectorAll('.t-opt').forEach(b => b.classList.toggle('sel', b.dataset.t === pref));
  }
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (settingsCache.theme === 'system') applyTheme();
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ===== Модалка ===== */
  function openModal(title, bodyHtml, wide) {
    if (!modal) return;
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHtml;
    const mb = modal.querySelector('.modal');
    if (mb) mb.classList.toggle('wide', !!wide);
    modal.classList.remove('show');
    void modal.offsetWidth;
    modal.classList.add('show');
    const ram = $('#ramSlider');
    if (ram) {
      ram.addEventListener('input', () => { $('#ramValue').textContent = ram.value + ' GB'; });
    }
  }
  window.mcModalClose = () => modal && modal.classList.remove('show');
  window.mcToast = (msg) => setStatus(String(msg).toUpperCase(), 'busy');
  $('#modalClose').addEventListener('click', () => modal.classList.remove('show'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });
  $('#optionsBtn').addEventListener('click', () => {
    openModal('Настройки запуска', `
      <div class="set-row"><div><div class="s-label">ПАМЯТЬ (RAM)</div><div class="s-desc">Выделенная память для игры (макс. ${settingsCache.totalRam} GB — реальная)</div></div><input type="range" id="ramSlider" min="1" max="${settingsCache.totalRam}" step="1" value="${safeRam(settingsCache.ram)}"/><div class="s-value" id="ramValue">${safeRam(settingsCache.ram)} GB</div></div>
      <div class="set-row"><div><div class="s-label">ИМЯ</div><div class="s-desc">Оффлайн-аккаунт</div></div><input type="text" id="mNick" value="${escapeHtml(settingsCache.username)}" style="background:var(--mc-grey-5);border:2px solid var(--mc-off-black);color:var(--mc-off-white);padding:6px 10px;font-family:var(--mc-font);font-size:12px;width:160px"/></div>
      <button class="secondary-btn" style="margin-top:4px" id="mDoneBtn">ГОТОВО</button>
    `);
    $('#mDoneBtn').addEventListener('click', () => modal.classList.remove('show'));
    const ram = $('#ramSlider');
    ram.addEventListener('input', () => {
      const v = safeRam(ram.value);
      ram.value = v;
      $('#ramValue').textContent = v + ' GB';
      settingsCache.ram = v;
      api.invoke('settings:set', 'ram', v);
    });
    $('#mNick').addEventListener('change', (e) => {
      const v = (e.target.value || 'Player').trim() || 'Player';
      settingsCache.username = v;
      api.invoke('settings:set', 'username', v);
    });
  });

  /* ===== PLAY ===== */
  const playBtn = $('#playBtn');
  const launchPanel = $('#launchPanel');
  const lpFill = $('#lpFill');
  const lpPct = $('#lpPct');
  const lpStage = $('#lpStage');
  const lpLog = $('#lpLog');

  function setLaunching(busy) {
    STATE.launching = busy;
    playBtn.classList.toggle('busy', busy);
    if (busy) {
      playBtn.innerHTML = '&#9696; ЗАПУСК...';
      launchPanel.classList.add('show');
      lpFill.style.width = '0%';
      lpPct.textContent = '0%';
      lpLog.innerHTML = '';
    }
  }

  function addLog(line) {
    if (!lpLog) return;
    const div = document.createElement('div');
    div.textContent = String(line);
    lpLog.appendChild(div);
    while (lpLog.children.length > 4) lpLog.removeChild(lpLog.firstChild);
    lpLog.scrollTop = lpLog.scrollHeight;
  }

  function startLaunch() {
    if (STATE.launching || STATE.running) return;
    setLaunching(true);
    setStatus('ИНИЦИАЛИЗАЦИЯ', 'busy');
    addLog('> st4amLauncher: запуск ' + CURRENT_VERSION);
    addLog('> аккаунт: ' + settingsCache.username + ' (offline)');
    api.invoke('launch:start', {
      version: CURRENT_VERSION,
      username: settingsCache.username,
      ram: settingsCache.ram,
      width: settingsCache.width || null,
      height: settingsCache.height || null,
      launcherMode: settingsCache.launcherMode
    }).catch(() => {
      setLaunching(false);
    });
  }

  playBtn.addEventListener('click', () => {
    if (STATE.running) {
      api.invoke('launch:stop');
      return;
    }
    startLaunch();
  });

  /* ===== События от main ===== */
  api.on('launch:progress', (data) => {
    if (!data) return;
    lpStage.textContent = data.stage || '';
    const pct = Math.max(0, Math.min(1, data.pct || 0));
    lpFill.style.width = Math.round(pct * 100) + '%';
    lpPct.textContent = Math.round(pct * 100) + '%';
  });
  api.on('launch:log', (data) => {
    if (data && data.line) addLog(data.line);
  });
  api.on('launch:error', (data) => {
    setLaunching(false);
    playBtn.innerHTML = '&#9654; PLAY';
    launchPanel.classList.remove('show');
    setStatus('ОШИБКА: ' + (data && data.message || 'неизвестно'), 'busy');
    addLog('> ОШИБКА: ' + (data && data.message));
  });
  api.on('launch:started', (data) => {
    setLaunching(false);
    STATE.running = true;
    playBtn.classList.remove('busy');
    playBtn.classList.add('running');
    playBtn.innerHTML = '&#9726; ОСТАНОВИТЬ';
    setStatus('ИГРА ЗАПУЩЕНА (PID ' + data.pid + ')', 'running');
    lpStage.textContent = 'В ИГРЕ';
    lpPct.textContent = '100%';
  });
  api.on('launch:exit', () => {
    STATE.running = false;
    playBtn.classList.remove('running');
    playBtn.innerHTML = '&#9654; PLAY';
    launchPanel.classList.remove('show');
    setStatus('ОБНОВЛЕНО ТОЛЬКО ЧТО', '');
  });

  /* ===== Диагностика ошибок запуска ===== */
  const DIAG_META = {
    missing_dep:     { label: 'ОТСУТСТВУЮТ МОДЫ-ЗАВИСИМОСТИ', color: '#ca3636' },
    conflict:        { label: 'КОНФЛИКТ МОДОВ', color: '#ca3636' },
    duplicate:       { label: 'ДУБЛИКАТЫ МОДОВ', color: '#ca3636' },
    version_mismatch:{ label: 'НЕ ТА ВЕРСИЯ МОДА', color: '#d8a03a' },
    wrong_mc:        { label: 'НЕ ТА ВЕРСИЯ MINECRAFT', color: '#d8a03a' },
    wrong_loader:    { label: 'НЕ ТА ВЕРСИЯ ЗАГРУЗЧИКА', color: '#d8a03a' },
    oom:             { label: 'НЕ ХВАТАЕТ ПАМЯТИ', color: '#d8a03a' },
    no_java:         { label: 'ПРОБЛЕМА С JAVA', color: '#d8a03a' },
    assets:          { label: 'ОШИБКА РЕСУРСОВ', color: '#d8a03a' },
    login:           { label: 'ПРОБЛЕМА С АККАУНТОМ', color: '#d8a03a' },
    mixin:           { label: 'ОШИБКА MIXIN', color: '#ca3636' },
    no_class:        { label: 'НЕТ КЛАССА / API', color: '#d8a03a' },
    missing_lib:     { label: 'НЕТ БИБЛИОТЕКИ', color: '#d8a03a' },
    loader_crash:    { label: 'СБОЙ ЗАГРУЗЧИКА МОДОВ', color: '#d8a03a' },
    native:          { label: 'ОШИБКА СИСТЕМНЫХ БИБЛИОТЕК', color: '#d8a03a' },
    gpu:             { label: 'ПРОБЛЕМА С ВИДЕОКАРТОЙ', color: '#d8a03a' },
    corrupt:         { label: 'ПОВРЕЖДЁННЫЙ ФАЙЛ', color: '#d8a03a' }
  };
  const DIAG_BTN = {
    install: { text: '\u2795 \u0421\u041a\u0410\u0427\u0410\u0422\u042c', cls: 'play' },
    update:  { text: '\u21bb \u041e\u0411\u041d\u041e\u0412\u0418\u0422\u042c', cls: '' },
    remove:  { text: '\u2715 \u0423\u0414\u0410\u041b\u0418\u0422\u042c', cls: 'del' }
  };

  function diagAction(problem, m) {
    const buildId = problem.buildId;
    if (!buildId) return;
    const btn = m && m._btn;
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    if (m.action === 'remove') {
      api.invoke('builds:delete-mod', buildId, m.filename, 'mod').then(() => {
        setStatus('\u041c\u041e\u0414 \u0423\u0414\u0410\u041b\u0415\u041d', '');
        if (btn) { btn.textContent = '\u2713 \u0423\u0414\u0410\u041b\u0415\u041d'; }
        refreshBuilds();
      }).catch(err => {
        if (btn) { btn.disabled = false; btn.textContent = (DIAG_BTN[m.action] || {}).text || ''; }
        setStatus('\u041e\u0428\u0418\u0411\u041a\u0410: ' + (err && err.message || err), 'busy');
      });
    } else if (m.action === 'update') {
      api.invoke('builds:update-mod', { buildId, slug: m.slug, filename: m.filename, type: 'mod' }).then(() => {
        setStatus('\u041c\u041e\u0414 \u041e\u0411\u041d\u041e\u0412\u041b\u0415\u041d', '');
        if (btn) { btn.textContent = '\u2713 \u041e\u0411\u041d\u041e\u0412\u041b\u0415\u041d'; }
        refreshBuilds();
      }).catch(err => {
        if (btn) { btn.disabled = false; btn.textContent = (DIAG_BTN[m.action] || {}).text || ''; }
        setStatus('\u041e\u0428\u0418\u0411\u041a\u0410: ' + (err && err.message || err), 'busy');
      });
    } else {
      api.invoke('builds:install-mod', { buildId, project: m.slug, versionId: null, withDeps: true, type: 'mod' }).then(() => {
        setStatus('\u041c\u041e\u0414 \u0423\u0421\u0422\u0410\u041d\u041e\u0412\u041b\u0415\u041d: ' + m.title, '');
        if (btn) { btn.textContent = '\u2713 \u0423\u0421\u0422\u0410\u041d\u041e\u0412\u041b\u0415\u041d'; }
        refreshBuilds();
      }).catch(err => {
        if (btn) { btn.disabled = false; btn.textContent = (DIAG_BTN[m.action] || {}).text || ''; }
        setStatus('\u041e\u0428\u0418\u0411\u041a\u0410: ' + (err && err.message || err), 'busy');
      });
    }
  }

  function showDiagnostics(report) {
    if (!report || !report.problems || !report.problems.length) return;
    const buildId = report.buildId;
    let html = '<div style="display:flex;flex-direction:column;gap:14px;max-height:62vh;overflow-y:auto;padding-right:4px">';
    report.problems.forEach(p => {
      const meta = DIAG_META[p.kind] || { label: 'ОШИБКА', color: '#ca3636' };
      html += `
        <div style="border:2px solid var(--mc-off-black);background:var(--mc-grey-5);padding:10px 12px;border-left:6px solid ${meta.color}">
          <div style="font-family:var(--mc-font);font-size:13px;letter-spacing:.06em;color:${meta.color}">${meta.label}</div>
          <div style="font-family:var(--mc-font-body);font-size:11px;color:var(--mc-grey-2);margin-top:3px;line-height:1.45">${escapeHtml(p.detail)}</div>`;
      if (p.mods && p.mods.length) {
        html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:9px">';
        p.mods.forEach(m => {
          const b = DIAG_BTN[m.action] || { text: '\u041f\u041e\u0414\u0420\u041e\u0411\u041d\u0415\u0415', cls: '' };
          const relParts = [];
          if (m.neededBy && m.neededBy.length) {
            relParts.push('<span class="b-tag" style="color:var(--mc-green-2)">\u043d\u0443\u0436\u0435\u043d \u0434\u043b\u044f: ' + escapeHtml(m.neededBy.join(', ')) + '</span>');
          }
          if (m.conflictsWith && m.conflictsWith.length) {
            relParts.push('<span class="b-tag" style="color:var(--mc-default-warning,#ca3636)">\u043a\u043e\u043d\u0444\u043b\u0438\u043a\u0442\u0443\u0435\u0442 \u0441: ' + escapeHtml(m.conflictsWith.join(', ')) + '</span>');
          }
          if (m.needVersion) {
            relParts.push('<span class="b-tag" style="color:#4db8ff">\u043d\u0443\u0436\u043d\u0430 \u0432\u0435\u0440\u0441\u0438\u044f: ' + escapeHtml(m.needVersion) + '</span>');
          }
          html += `
            <div class="b-hit" data-slug="${escapeHtml(m.slug)}" style="cursor:pointer">
              <img src="${m.icon_url || modThumb(m.slug + '.jar')}" alt=""/>
              <div class="bh-body" style="min-width:0">
                <div class="bh-name" style="font-size:12px">${escapeHtml(m.title)}</div>
                <div class="bh-meta" style="flex-wrap:wrap">${relParts.join('')}</div>
              </div>
              <button class="b-mini ${b.cls}" style="flex:0 0 auto;padding:6px 10px;font-size:11px">${b.text}</button>
            </div>`;
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    if (buildId) {
      html += `
        <button class="play-btn" id="diagRelaunch" style="margin-top:14px;width:100%">&#9654; \u0417\u0410\u041f\u0423\u0421\u0422\u0418\u0422\u042c \u0418\u0413\u0420\u0423 \u0421\u041d\u041e\u0412\u0410</button>`;
    }
    if (report.problems.some(p => p.kind === 'oom')) {
      html += `<button class="secondary-btn" id="diagRam" style="margin-top:8px;width:100%">\u041e\u0422\u041a\u0420\u042b\u0422\u042c \u041d\u0410\u0421\u0422\u0420\u041e\u0419\u041a\u0418 RAM</button>`;
    }
    html += `<button class="secondary-btn" id="diagClose" style="margin-top:8px;width:100%">\u0417\u0410\u041a\u0420\u042b\u0422\u042c</button>`;
    openModal('\u041f\u0420\u041e\u0411\u041b\u0415\u041c\u0410 \u041f\u0420\u0418 \u0417\u0410\u041f\u0423\u0421\u041a\u0415', html, true);
    const mb = modal.querySelector('.modal');
    if (mb) mb.classList.add('wide');
    // клик по карточке → страница мода (с подсветкой нужной версии при несовпадении)
    $$('.b-hit[data-slug]').forEach(card => {
      const slug = card.dataset.slug;
      const findMod = () => report.problems
        .flatMap(x => (x.mods || []).map(mm => Object.assign({}, mm)))
        .find(mm => mm.slug === slug);
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const m = findMod() || {};
        openModPage({ slug, title: card.querySelector('.bh-name') ? card.querySelector('.bh-name').textContent : slug, icon_url: card.querySelector('img') ? card.querySelector('img').src : '', description: '', downloads: 0, categories: [] }, m.needVersion ? { needVersion: m.needVersion } : null);
      });
      const btn = card.querySelector('button');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const m = findMod();
          if (m) diagAction(report, m);
        });
      }
    });
    const rc = $('#diagRelaunch');
    if (rc) rc.addEventListener('click', () => {
      modal.classList.remove('show');
      api.invoke('diagnosis:relaunch', { buildId, username: settingsCache.username, ram: settingsCache.ram }).catch(() => {});
      setStatus('\u041f\u0415\u0420\u0415\u0417\u0410\u041f\u0423\u0421\u041a...', 'busy');
    });
    const rr = $('#diagRam');
    if (rr) rr.addEventListener('click', () => {
      modal.classList.remove('show');
      const s = $('.nav-item[data-tab="settings"]');
      if (s) s.click();
    });
    $('#diagClose').addEventListener('click', () => {
      modal.classList.remove('show');
      api.invoke('diagnosis:clear').catch(() => {});
    });
  }
  api.on('launch:diagnosis', (report) => showDiagnostics(report));

  /* ===== Сборки (экспериментально) ===== */
  const buildsNav = $('#buildsNav');
  const buildsNavIcon = $('#buildsNavIcon');
  if (buildsNavIcon) buildsNavIcon.src = ic('Grass.png');

  function showBuildsTab(on) {
    if (buildsNav) buildsNav.style.display = on ? '' : 'none';
  }

  let BUILD_LIST = [];
  let CURRENT_BUILD = null;
  let B_OFFSET = 0;
  let B_CAT = null;
  const CAT_CACHE = {}; // кэш результатов поиска Modrinth (по ключу запроса)
  const B_TYPES = [['mod', 'МОДЫ'], ['resourcepack', 'РЕСУРСПАКИ'], ['shaderpack', 'ШЕЙДЕРЫ'], ['datapack', 'ДАТАПАКИ']];
  let B_TYPE = 'mod';
  let INST_QUERY = '';

  // Тип проекта для установки/поиска версий: у карточки из «Избранного» своя категория
  // (btype/project_type), её нельзя заменять текущей вкладкой каталога (B_TYPE).
  function itemType(h) {
    let t = (h && (h.btype || h.project_type)) || B_TYPE;
    if (t === 'shader') t = 'shaderpack'; // API Modrinth отдаёт 'shader', в приложении 'shaderpack'
    return t;
  }
  // Русское слово для типа в тостах/сообщениях (мини-фикс: «Мод» -> правильный тип)
  const TYPE_WORDS = { mod: '\u041c\u043e\u0434', resourcepack: '\u0420\u0435\u0441\u0443\u0440\u0441\u043f\u0430\u043a', shaderpack: '\u0428\u0435\u0439\u0434\u0435\u0440', datapack: '\u0414\u0430\u0442\u0430\u043f\u0430\u043a' };
  function typeWord(h) { return TYPE_WORDS[itemType(h)] || '\u042d\u043b\u0435\u043c\u0435\u043d\u0442'; }

  function refreshBuilds() {
    return api.invoke('builds:list').then(list => {
      BUILD_LIST = Array.isArray(list) ? list : [];
      if (CURRENT_BUILD) {
        const still = BUILD_LIST.find(b => b.id === CURRENT_BUILD.id);
        CURRENT_BUILD = still || null;
      }
      renderBuilds();
      renderDetailBuild();
      if (!CURRENT_BUILD && BUILD_LIST.length) selectBuild(BUILD_LIST[0].id);
      else renderInstalled();
    }).catch(() => {
      BUILD_LIST = [];
      renderBuilds();
    });
  }

  function selectBuild(id, refreshCat) {
    CURRENT_BUILD = BUILD_LIST.find(b => b.id === id) || null;
    renderBuilds();
    renderDetailBuild();
    renderInstalled();
    if (refreshCat === true) { B_OFFSET = 0; refreshCatalog(); }
    if (CURRENT_BUILD) {
      const b = CURRENT_BUILD;
      $('#versionTitle').textContent = b.name;
      $('#versionBadge').textContent = 'СБОРКА';
      const sub = $('#versionSub');
      if (sub) sub.textContent = b.gameVersion + ' \u00b7 ' + b.loader;
      loadScreenshot(b.gameVersion, true);
    }
  }

  function renderBuilds() {
    const list = $('#bList');
    if (!list) return;
    if (!BUILD_LIST.length) {
      list.innerHTML = '<div class="b-empty">Сборок пока нет — создайте первую!</div>';
      return;
    }
    // Собираем HTML одним куском — меньше layout/GC; стаггер только первых 8
    let html = '';
    BUILD_LIST.forEach((b, i) => {
      const sel = CURRENT_BUILD && CURRENT_BUILD.id === b.id ? ' sel' : '';
      const delay = i < 8 ? ';animation-delay:' + (i * 0.04).toFixed(2) + 's' : '';
      html += `
        <div class="b-card${sel}" data-bid="${escapeHtml(b.id)}" style="${delay}">
          <img src="${ic(b.icon || 'Grass.png')}" alt="" loading="lazy" decoding="async"/>
          <div class="bc-body">
            <div class="b-name">${escapeHtml(b.name)}</div>
            <div class="b-meta">
              <span class="b-tag green">${escapeHtml(b.gameVersion)}</span>
              <span class="b-tag">${escapeHtml(b.loader)}</span>
              <span class="b-tag">${b.modCount || 0} модов</span>
            </div>
          </div>
        </div>`;
    });
    list.innerHTML = html;
    list.querySelectorAll('.b-card').forEach(card => {
      const bid = card.dataset.bid;
      card.addEventListener('click', () => selectBuild(bid));
      const cardImg = card.querySelector('img');
      if (cardImg) applyEdgeAccent(cardImg, card);
    });
  }

  async function handleExport() {
    if (!CURRENT_BUILD) {
      mcToast('СНАЧАЛА ВЫБЕРИТЕ СБОРКУ');
      return;
    }
    const res = await api.invoke('builds:export', CURRENT_BUILD.id);
    if (res.canceled) return;
    if (!res.ok) {
      openModal('Ошибка экспорта', `
        <div style="color:var(--mc-default-warning,#ca3636);font-family:var(--mc-font-body);font-size:11px">${escapeHtml(res.error || 'Неизвестная ошибка')}</div>
        <button class="secondary-btn" style="margin-top:10px;width:100%" onclick="mcModalClose()">ОК</button>
      `);
      return;
    }
    if (res.skipped && res.skipped.length) {
      openModal('Экспорт завершён', `
        <div style="font-family:var(--mc-font-body);font-size:11px;color:var(--mc-grey-2);line-height:1.5">
          Файл: ${escapeHtml(res.path)}<br>
          <span style="color:var(--mc-default-warning,#ca3636)">Пропущено модов (не найдены на Modrinth): ${res.skipped.length}</span><br>
          ${res.skipped.map(s => '&#8226; ' + escapeHtml(s)).join('<br>')}
        </div>
        <button class="secondary-btn" style="margin-top:10px;width:100%" onclick="mcModalClose()">ПОНЯТНО</button>
      `);
    } else {
      mcToast('ЭКСПОРТ УСПЕШЕН: ' + res.path);
    }
  }

  async function handleImport() {
    const filePath = await api.invoke('dialog:openFile');
    if (!filePath) return;
    openModal('Импорт сборки', `
      <div class="upd-box">
        <div class="upd-text">Подготовка...</div>
        <div class="lp-bar"><div class="fill" id="impFill"></div></div>
        <div id="impStage" style="font-family:var(--mc-font);font-size:10px;color:var(--mc-grey-3);margin-top:6px"></div>
      </div>
    `, true);
    const off = api.on('builds:progress', d => {
      const fill = $('#impFill');
      const stage = $('#impStage');
      if (fill) fill.style.width = Math.round(d.frac * 100) + '%';
      if (stage) stage.textContent = d.file || '';
    });
    const res = filePath.toLowerCase().endsWith('.mrpack')
      ? await api.invoke('mods:import-mrpack', filePath)
      : await api.invoke('builds:import', filePath);
    off();
    if (res.ok) {
      mcToast('СБОРКА ИМПОРТИРОВАНА: ' + res.buildId);
      refreshBuilds();
      setTimeout(() => modal && modal.classList.remove('show'), 500);
    } else {
      openModal('Ошибка импорта', `
        <div style="color:var(--mc-default-warning,#ca3636);font-family:var(--mc-font-body);font-size:11px">${escapeHtml(res.error || 'Неизвестная ошибка')}</div>
        <button class="secondary-btn" style="margin-top:10px;width:100%" onclick="mcModalClose()">ОК</button>
      `);
    }
  }

  function renderDetailBuild() {
    const box = $('#bDetail');
    if (!box) return;
    const b = CURRENT_BUILD;
    if (!b) {
      box.innerHTML = `
        <div class="b-empty">Выберите сборку слева</div>
        <div class="bd-btns">
          <button class="b-mini" id="bdExport" title="Экспорт активной сборки">&#128463; ЭКСПОРТ</button>
          <button class="b-mini" id="bdImport">&#128462; ИМПОРТ</button>
        </div>`;
      $('#bdExport').addEventListener('click', handleExport);
      $('#bdImport').addEventListener('click', handleImport);
      return;
    }
    box.innerHTML = `
      <div class="bd-head">
        <img src="${ic(b.icon || 'Grass.png')}" alt=""/>
        <div class="bd-body">
          <div class="bd-name">${escapeHtml(b.name)}</div>
          <div class="b-meta">
            <span class="b-tag green">${escapeHtml(b.gameVersion)}</span>
            <span class="b-tag">${escapeHtml(b.loader)}</span>
            <span class="b-tag">${b.modCount || 0} модов</span>
          </div>
        </div>
      </div>
      <div class="bd-btns">
        <button class="b-mini play" id="bdPlay">&#9654; ИГРАТЬ</button>
        <button class="b-mini" id="bdExport">&#128463; ЭКСПОРТ</button>
        <button class="b-mini" id="bdImport">&#128462; ИМПОРТ</button>
        <button class="b-mini del" id="bdDel">&#10005; УДАЛИТЬ</button>
      </div>`;
    const bdImg = box.querySelector('.bd-head img');
    if (bdImg) applyEdgeAccent(bdImg, box.querySelector('.bd-head'));
    $('#bdPlay').addEventListener('click', () => launchBuild(b));
    $('#bdExport').addEventListener('click', handleExport);
    $('#bdImport').addEventListener('click', handleImport);
    $('#bdDel').addEventListener('click', () => {
      api.invoke('builds:delete', b.id).then(() => {
        if (CURRENT_BUILD && CURRENT_BUILD.id === b.id) CURRENT_BUILD = null;
        setStatus('СБОРКА УДАЛЕНА: ' + b.name, '');
        refreshBuilds();
      }).catch(err => setStatus('ОШИБКА: ' + err.message, 'busy'));
    });
  }

  function renderInstalled() {
    const box = $('#bInstalled');
    const cnt = $('#bModsCount');
    const title = $('#bModsTitle');
    const label = (B_TYPES.find(t => t[0] === B_TYPE) || [null, 'МОДЫ'])[1];
    if (title) title.textContent = label + ' СБОРКИ';
    if (!box) return;
    if (!CURRENT_BUILD) {
      box.innerHTML = '<div class="b-empty">Выберите сборку слева</div>';
      if (cnt) cnt.textContent = '';
      return;
    }
    api.invoke('builds:installed', CURRENT_BUILD.id, B_TYPE).then(mods => {
      const all = Array.isArray(mods) ? mods : [];
      const list = INST_QUERY ? all.filter(m => (m.filename || "").toLowerCase().includes(INST_QUERY)) : all;
      if (cnt) cnt.textContent = list.length ? list.length + ' шт.' : '';
      if (!list.length) {
        box.innerHTML = '<div class="b-empty">' + (B_TYPE === 'mod' ? 'Модов нет — установите из каталога справа' : (B_TYPE === 'resourcepack' ? 'Ресурспаков нет — установите из каталога' : (B_TYPE === 'shaderpack' ? 'Шейдеров нет — установите из каталога' : 'Датапаков нет — установите из каталога'))) + '</div>';
        return;
      }
      // Собираем HTML одним куском — меньше layout/GC; стаггер только первых 8
      let html = '';
      list.forEach((m, i) => {
        const mb = (m.size / 1048576).toFixed(1);
        const filenameEsc = escapeHtml(m.filename);
        const delay = i < 8 ? ';animation-delay:' + (i * 0.03).toFixed(2) + 's' : '';
        html += `
          <div class="b-mod" data-f="${filenameEsc}" style="${delay}">
            <div class="b-mod-img"><img src="${modThumb(m.filename)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'"></div>
            <div class="b-mod-content">
              <div class="bm-name" title="${filenameEsc}">${filenameEsc}</div>
              <div class="bm-size">${mb} MB</div>
            </div>
            <button class="bm-x" data-f="${filenameEsc}">&#10005;</button>
          </div>`;
      });
      box.innerHTML = html;
      box.querySelectorAll('.b-mod').forEach(row => {
        const f = row.dataset.f;
        const x = row.querySelector('.bm-x');
        if (x) x.addEventListener('click', () => {
          api.invoke('builds:delete-mod', CURRENT_BUILD.id, f, B_TYPE).then(() => {
            setStatus((B_TYPES.find(t => t[0] === B_TYPE) || ['', 'МОД'])[1] + ' УДАЛЁН', '');
            renderInstalled();
          }).catch(() => {});
        });
        const bImg = row.querySelector('.b-mod-img img');
        if (bImg) applyEdgeAccent(bImg, row);
      });
    }).catch(err => {
      box.innerHTML = '<div class=\x22b-empty\x22>ERR: ' + escapeHtml((err && err.message) || String(err)) + '</div>';
    });
  }

  function launchBuild(b) {
    if (STATE.launching || STATE.running) return;
    setLaunching(true);
    setStatus('ЗАПУСК СБОРКИ: ' + b.name, 'busy');
    addLog('> st4amLauncher: сборка ' + b.name + ' (' + b.gameVersion + ' / ' + b.loader + ')');
    addLog('> аккаунт: ' + settingsCache.username + ' (offline)');
    api.invoke('launch:start', {
      version: b.id,
      buildId: b.id,
      username: settingsCache.username,
      ram: settingsCache.ram,
      width: settingsCache.width || null,
      height: settingsCache.height || null,
      launcherMode: settingsCache.launcherMode
    }).catch(() => {
      setLaunching(false);
    });
  }

  /* --- каталог Modrinth --- */
  function buildTypeButtons() {
    const box = $('#bTypes');
    if (!box) return;
    box.innerHTML = '';
    B_TYPES.forEach(t => {
      const btn = document.createElement('div');
      btn.className = 'b-type-btn' + (B_TYPE === t[0] ? ' sel' : '');
      btn.textContent = t[1];
      btn.addEventListener('click', () => {
        B_TYPE = t[0];
        B_CAT = null;
        B_OFFSET = 0;
        buildTypeButtons();
        refreshCatalog();
        renderInstalled();
      });
      box.appendChild(btn);
    });
  }

  function refreshCatalog() {
    const box = $('#bResults');
    const info = $('#bResultInfo');
    if (!box) return;
    box.innerHTML = '<div class="b-empty">Поиск...</div>';
    if (info) info.textContent = '';
    const q = ($('#bSearch').value || '').trim();
    const facets = [];
    if (CURRENT_BUILD) {
      facets.push(['versions:' + CURRENT_BUILD.gameVersion]);
      if (B_TYPE === 'mod') facets.push(['categories:' + CURRENT_BUILD.loader.toLowerCase()]);
    }
    facets.push(['project_type:' + (B_TYPE === 'shaderpack' ? 'shader' : B_TYPE)]);
    if (B_CAT) facets.push(['categories:' + B_CAT]);
    const cacheKey = q + '|' + JSON.stringify(facets) + '|' + B_OFFSET;
    const render = res => {
      if (info && res.total_hits) info.textContent = res.total_hits + ' результатов';
      if (!res.hits || !res.hits.length) {
        box.innerHTML = '<div class="b-empty">Ничего не найдено</div>';
        return;
      }
      // Собираем HTML одним куском; стаггер только первых 8
      let html = '';
      res.hits.forEach((h, i) => {
        const dl = Math.round(h.downloads / 1000) + 'K';
        const delay = i < 8 ? ';animation-delay:' + (i * 0.03).toFixed(2) + 's' : '';
        html += `
          <div class="b-hit" data-slug="${escapeHtml(h.slug)}" style="cursor:pointer;${delay}">
            <button class="b-fav" data-slug="${escapeHtml(h.slug)}" title=""></button>
            <img src="${h.icon_url || ''}" alt="" loading="lazy" decoding="async"/>
            <div class="bh-body">
              <div class="bh-name">${escapeHtml(h.title)}</div>
              <div class="bh-desc">${escapeHtml(h.description || '')}</div>
              <div class="bh-meta"><span class="b-tag">${dl} скач.</span>${h.categories && h.categories.length ? '<span class="b-tag">' + escapeHtml(h.categories.join(', ')) + '</span>' : ''}</div>
            </div>
          </div>`;
      });
      box.innerHTML = html;
      box.querySelectorAll('.b-hit').forEach(row => {
        const slug = row.dataset.slug;
        const hh = (res.hits || []).find(x => x.slug === slug);
        row.addEventListener('click', () => openModPage(hh));
        const fbtn = row.querySelector('.b-fav');
        if (fbtn) {
          fbtn.innerHTML = favIcon();
          fbtn.classList.toggle('on', isFav(slug));
          fbtn.addEventListener('click', (e) => { e.stopPropagation(); if (hh) toggleFav(hh, fbtn); });
        }
        const hitImg = row.querySelector('img');
        if (hitImg && hitImg.src) applyEdgeAccent(hitImg, row);
      });
    };
    if (CAT_CACHE[cacheKey]) { render(CAT_CACHE[cacheKey]); return; }
    api.invoke('modrinth:search', { query: q, facets, limit: 25, offset: B_OFFSET }).then(res => {
      CAT_CACHE[cacheKey] = res;
      const keys = Object.keys(CAT_CACHE);
      if (keys.length > 50) delete CAT_CACHE[keys[0]];
      render(res);
    }).catch(err => {
      box.innerHTML = '<div class="b-empty">Ошибка: ' + escapeHtml(err.message || err) + '</div>';
    });
  }

  function openModPage(h) {
    openModal(escapeHtml(h.title), `
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px">
        <img src="${h.icon_url || ''}" alt="" style="width:52px;height:52px;image-rendering:pixelated;border:2px solid var(--mc-off-black);background:var(--mc-grey-5)"/>
        <div>
          <div style="font-family:var(--mc-font);font-size:15px">${escapeHtml(h.title)}</div>
          <div style="font-family:var(--mc-font-body);font-size:10px;color:var(--mc-grey-3)">${h.downloads} скачиваний &middot; ${escapeHtml((h.categories || []).join(', '))}</div>
        </div>
      </div>
      <div style="font-family:var(--mc-font-body);font-size:11.5px;color:var(--mc-grey-2);line-height:1.55;max-height:110px;overflow-y:auto">${escapeHtml((h.description || '').slice(0, 600))}</div>
      <div style="font-family:var(--mc-font);font-size:11px;letter-spacing:.08em;color:var(--mc-grey-3);margin:10px 0 6px">ВЕРСИИ ДЛЯ ВАШЕЙ СБОРКИ ${CURRENT_BUILD ? '(' + escapeHtml(CURRENT_BUILD.gameVersion) + ' / ' + escapeHtml(CURRENT_BUILD.loader) + ')' : ''}</div>
      <div style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto" id="mVers"></div>
    `);
    const box = $('#mVers');
    box.innerHTML = '<div class="b-empty">Поиск версий...</div>';
    if (!CURRENT_BUILD) {
      box.innerHTML = '<div class="b-empty">Сначала выберите сборку</div>';
      return;
    }
    api.invoke('modrinth:versions', h.slug, CURRENT_BUILD.gameVersion, B_TYPE === 'mod' ? CURRENT_BUILD.loader.toLowerCase() : null).then(vers => {
      const list = Array.isArray(vers) ? vers : [];
      box.innerHTML = '';
      if (!list.length) {
        box.innerHTML = '<div class="b-empty">Нет версий для ' + escapeHtml(CURRENT_BUILD.gameVersion) + (B_TYPE === 'mod' ? ' / ' + escapeHtml(CURRENT_BUILD.loader) : '') + '</div>';
        return;
      }
      list.forEach(v => {
        const f = (v.files || []).find(x => x.primary) || (v.files || [])[0];
        const mb = f && f.size ? (f.size / 1048576).toFixed(1) + ' MB' : '';
        const row = document.createElement('div');
        row.className = 'b-mod b-ver-row';
        row.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px">
            <div class="bm-name">${escapeHtml(v.game_versions.slice(0, 3).join(', '))} &middot; ${escapeHtml((v.loaders || []).join('/'))}</div>
            <div class="bm-size">${mb}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="b-mini play" data-dep="0">СКАЧАТЬ</button>
            <button class="b-mini" data-dep="1">С ЗАВИСИМОСТЯМИ</button>
          </div>`;
        row.querySelector('[data-dep="0"]').addEventListener('click', () => doInstall(h, v, false));
        row.querySelector('[data-dep="1"]').addEventListener('click', () => doInstall(h, v, true));
        const bImg = row.querySelector('.b-mod-img img');
        if (bImg) applyEdgeAccent(bImg, row);
        box.appendChild(row);
      });
    }).catch(err => {
      box.innerHTML = '<div class="b-empty">Ошибка: ' + escapeHtml(err.message || err) + '</div>';
    });
  }

  /* ===== Избранное ===== */
  let FAVS = [];

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '.' + mm + '.' + d.getFullYear();
  }

  function showToast(msg, isRemove) {
    let t = $('#toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.className = 'show' + (isRemove ? ' rem' : '');
    t.innerHTML = '<span class="t-dot"></span><span class="t-txt">' + escapeHtml(String(msg)) + '</span>';
    clearTimeout(t._tm);
    t._tm = setTimeout(() => { t.classList.remove('show'); }, 3200);
  }

  function favIcon() {
    return '<svg viewBox="0 0 16 16" shape-rendering="crispEdges"><rect x="2" y="2" width="2" height="12" fill="currentColor"/><rect x="4" y="2" width="8" height="2" fill="currentColor"/><rect x="4" y="4" width="6" height="2" fill="currentColor"/><rect x="4" y="6" width="4" height="2" fill="currentColor"/></svg>';
  }

  function isFav(slug) {
    return !!(FAVS || []).some(f => f.slug === slug);
  }

  function applyFavsToCards() {
    $$('.b-fav').forEach(b => { b.classList.toggle('on', isFav(b.dataset.slug)); });
  }

  async function toggleFav(h, btn) {
    const exists = isFav(h.slug);
    try {
      if (exists) {
        FAVS = await api.invoke('favs:remove', h.slug);
        showToast(typeWord(h) + ' \u00ab' + h.title + '\u00bb \u0443\u0434\u0430\u043b\u0451\u043d \u0438\u0437 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0433\u043e', true);
      } else {
        FAVS = await api.invoke('favs:add', { slug: h.slug, title: h.title, icon_url: h.icon_url || '', description: h.description || '', categories: h.categories || [], project_type: h.project_type || '', btype: B_TYPE });
        showToast(typeWord(h) + ' \u00ab' + h.title + '\u00bb \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d \u0443\u0441\u043f\u0435\u0448\u043d\u043e!', false);
      }
    } catch (err) {
      showToast('\u041e\u0448\u0438\u0431\u043a\u0430: ' + (err.message || err), true);
      return;
    }
    if (btn) {
      btn.classList.toggle('on', !exists);
      const t = btn.querySelector('.mp-fav-t');
      if (t) t.textContent = exists ? '\u0412 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435' : '\u0412 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u043c';
    }
  }

  function favCard(f) {
    const row = document.createElement('div');
    row.className = 'b-hit';
    const h = { slug: f.slug, title: f.title, icon_url: f.icon_url, description: f.description, categories: f.categories, downloads: f.downloads || 0, project_type: f.project_type || '', btype: itemType(f) };
    row.innerHTML = `
      <button class="b-fav on" data-slug="${escapeHtml(f.slug)}"></button>
      <img src="${f.icon_url || ''}" alt=""/>
      <div class="bh-body">
        <div class="bh-name">${escapeHtml(f.title)}</div>
        <div class="bh-desc">${escapeHtml(f.description || '')}</div>
      </div>`;
    row.addEventListener('click', () => openModPage(h));
    const fb = row.querySelector('.b-fav');
    fb.innerHTML = favIcon();
    fb.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(h, fb); });
    const hitImg = row.querySelector('img');
    if (hitImg && hitImg.src) applyEdgeAccent(hitImg, row);
    return row;
  }

  function renderFavs() {
    const box = $('#favsList');
    if (!box) return;
    box.innerHTML = '';
    const order = ['mod', 'resourcepack', 'shaderpack', 'datapack'];
    const titles = { mod: '\u041c\u043e\u0434\u044b', resourcepack: '\u0420\u0435\u0441\u0443\u0440\u0441\u043f\u0430\u043a\u0438', shaderpack: '\u0428\u0435\u0439\u0434\u0435\u0440\u044b', datapack: '\u0414\u0430\u0442\u0430\u043f\u0430\u043a\u0438' };
    const groups = {};
    order.forEach(t => groups[t] = []);
    (FAVS || []).forEach(f => {
      const t = f.btype || f.project_type || 'mod';
      if (groups[t]) groups[t].push(f); else groups.mod.push(f);
    });
    let any = false;
    order.forEach(t => {
      if (!groups[t].length) return;
      any = true;
      const sec = document.createElement('div');
      sec.className = 'fav-sec';
      const st = document.createElement('div');
      st.className = 'fav-sec-title';
      st.innerHTML = '<span>' + titles[t] + '</span><span class="cnt">' + groups[t].length + '</span>';
      sec.appendChild(st);
      groups[t].forEach(f => sec.appendChild(favCard(f)));
      box.appendChild(sec);
    });
    if (!any) box.innerHTML = '<div class="b-empty">\u041f\u043e\u043a\u0430 \u043f\u0443\u0441\u0442\u043e \u2014 \u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0439\u0442\u0435 \u043c\u043e\u0434\u044b, \u0440\u0435\u0441\u0443\u0440\u0441\u043f\u0430\u043a\u0438, \u0448\u0435\u0439\u0434\u0435\u0440\u044b \u0438 \u0434\u0430\u0442\u0430\u043f\u0430\u043a\u0438 \u0444\u043b\u0430\u0436\u043a\u043e\u043c</div>';
  }

  /* ---- Сравнение версий для подсветки нужной из диагноза ---- */
  function cmpVer(a, b) {
    const pa = String(a).split(/[.\-]/).map(n => parseInt(n, 10) || 0);
    const pb = String(b).split(/[.\-]/).map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }
  function versionMatchesRange(version, range) {
    const r0 = String(range || '').replace(/[[\])]/g, '').trim();
    const commaIndex = r0.indexOf(',');
    if (commaIndex === -1) return cmpVer(version, r0) === 0; // точная версия
    const lower = r0.slice(0, commaIndex).trim();
    const upper = r0.slice(commaIndex + 1).trim();
    let ok = true;
    if (lower) ok = ok && cmpVer(version, lower) >= 0; // [a, ...)
    if (upper) ok = ok && cmpVer(version, upper) < 0;  // ..., b)
    return ok;
  }

  /* ---- Требования: каким установленным модам нужен этот мод/версия ---- */
  // REQS[projectId] = [{ neededBy, range, versionId }] — проекты и версии, которые требуют этот мод
  let REQS = {};
  let REQS_READY = false;
  let REQS_PROMISE = null;
  let REQ_SIG = null;
  const REQ_VER_CACHE = {}; // кеш версий Modrinth по buildId|slug
  let OPEN_MOD = null; // открытая страница мода: { h, hl }
  let driftCtl = null; // управление дрифтом фона (старт/стоп)

  function invalidateReqs() {
    REQS_READY = false;
    REQS_PROMISE = null;
  }

  function reqsPromise() {
    if (REQS_PROMISE) return REQS_PROMISE;
    REQS_PROMISE = buildRequirements()
      .then(reqs => { REQS = reqs; REQS_READY = true; return reqs; })
      .catch(err => { REQS = {}; REQS_READY = false; return REQS; });
    return REQS_PROMISE;
  }

  // Сканируем установленные моды, для каждого находим установленную версию
  // и собираем её required-зависимости. Зависимость, уже установленная,
  // не считается «нужной».
  async function buildRequirements() {
    const reqs = {};
    if (!CURRENT_BUILD) return reqs;
    const b = CURRENT_BUILD;
    const reg = await api.invoke('builds:registry', b.id).catch(() => null);
    const files = (reg && Array.isArray(reg.files) ? reg.files : [])
      .filter(f => f.type === 'mod' && f.slug && f.filename);
    const sig = files.map(f => f.slug + ':' + f.filename).sort().join('|');
    if (REQS_READY && sig === REQ_SIG) return REQS; // набор модов не менялся
    if (!files.length) { REQ_SIG = sig; return reqs; }
    // Кеш на диск: при холодном старте не переспрашиваем Modrinth, если набор модов тот же
    const lsKey = 'reqsCache_v1_' + b.id;
    if (!REQS_READY) {
      try {
        const st = JSON.parse(localStorage.getItem(lsKey) || 'null');
        if (st && st.sig === sig && st.reqs) { REQ_SIG = sig; return st.reqs; }
      } catch (e) {}
    }
    const loader = b.loader ? String(b.loader).toLowerCase() : null;
    const entries = [];
    for (const f of files) {
      const key = b.id + '|' + f.slug;
      if (!REQ_VER_CACHE[key]) {
        try { REQ_VER_CACHE[key] = await api.invoke('modrinth:versions', f.slug, b.gameVersion, loader); }
        catch (e) { REQ_VER_CACHE[key] = []; }
      }
      const vers = Array.isArray(REQ_VER_CACHE[key]) ? REQ_VER_CACHE[key] : [];
      const iv = vers.find(v => (v.files || []).some(x => x.filename === f.filename));
      if (iv) entries.push({ f, iv });
    }
    // заголовки установленных модов (для надписи «нужен для ...»)
    const titlesById = {};
    try {
      const ids = entries.map(x => x.iv.project_id).filter(Boolean);
      if (ids.length) {
        const projs = await api.invoke('modrinth:batch-projects', ids);
        (projs || []).forEach(p => { if (p && p.id) titlesById[p.id] = p.title || p.slug; });
      }
    } catch (e) {}
    const installedIds = new Set();
    for (const x of entries) { if (x.iv.project_id) installedIds.add(x.iv.project_id); }
    for (const x of entries) {
      const pid = x.iv.project_id;
      const title = titlesById[pid] || x.f.slug;
      const deps = (x.iv.dependencies || [])
        .filter(d => d.dependency_type === 'required' && d.project_id)
        .filter(d => !installedIds.has(d.project_id)); // уже стоит — не «нужна»
      for (const d of deps) {
        const entry = { neededBy: title, range: d.version_range || null, versionId: d.version_id || null };
        if (!reqs[d.project_id]) reqs[d.project_id] = [];
        if (!reqs[d.project_id].some(r => r.neededBy === entry.neededBy && r.range === entry.range && r.versionId === entry.versionId)) {
          reqs[d.project_id].push(entry);
        }
      }
    }
    REQ_SIG = sig;
    try { localStorage.setItem(lsKey, JSON.stringify({ sig: sig, reqs: reqs })); } catch (e) {}
    return reqs;
  }

  // Есть ли у версии v конкретное требование (золотая подсветка)
  function versionNeed(needed, v) {
    const out = { gold: false, neededBy: [], range: null };
    for (const n of (needed || [])) {
      const ok = n.versionId ? n.versionId === v.id
        : (n.range ? versionMatchesRange(v.version_number, n.range) : false);
      if (!ok) continue;
      out.gold = true;
      if (!out.neededBy.includes(n.neededBy)) out.neededBy.push(n.neededBy);
      if (n.range && !out.range) out.range = n.range;
    }
    return out;
  }

  // Рендер списка версий с золотой подсветкой нужной версии и надписью «нужен для ...»
  function renderModVersions(box, h, hl) {
    box.innerHTML = '<div class="b-empty">\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...</div>';
    if (!CURRENT_BUILD) {
      box.innerHTML = '<div class="b-empty">\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u0431\u043e\u0440\u043a\u0443</div>';
      return;
    }
    reqsPromise().then(reqs => api.invoke('modrinth:versions', h.slug, CURRENT_BUILD.gameVersion, itemType(h) === 'mod' ? CURRENT_BUILD.loader.toLowerCase() : null)
      .then(vers => {
        const list = Array.isArray(vers) ? vers : [];
        const pid = (list[0] && list[0].project_id) || null;
        return { list, needed: pid ? (reqs[pid] || []) : [] };
      })
    ).then(({ list, needed }) => {
      box.innerHTML = '';
      if (!list.length) {
        box.innerHTML = '<div class="b-empty">Нет версий для ' + escapeHtml(CURRENT_BUILD.gameVersion) + (itemType(h) === 'mod' ? ' / ' + escapeHtml(CURRENT_BUILD.loader) : '') + '</div>';
        return;
      }
      // требование «любая версия» (без диапазона) -> плашка над списком, не золотая подсветка
      const anyNeeded = needed.filter(n => !n.range && !n.versionId);
      const specificNeeded = needed.filter(n => n.range || n.versionId);
      if (anyNeeded.length) {
        const who = [...new Set(anyNeeded.map(n => n.neededBy))];
        const ban = document.createElement('div');
        ban.style.cssText = 'border:1px dashed rgba(240,185,11,.55);background:rgba(240,185,11,.08);border-radius:6px;padding:7px 10px;margin-bottom:8px;font-family:var(--mc-font-body);font-size:11px;color:var(--mc-grey-1);line-height:1.5';
        ban.innerHTML = '<span style="color:#f0b90b;font-weight:600">\u041d\u0423\u0416\u0415\u041d \u0414\u041b\u042f:</span> ' + escapeHtml(who.join(', ')) + ' (\u043b\u044e\u0431\u0430\u044f \u0432\u0435\u0440\u0441\u0438\u044f)';
        box.appendChild(ban);
      }
      list.slice(0, 30).forEach(v => {
        const f = (v.files || []).find(x => x.primary) || (v.files || [])[0];
        const mb = f && f.size ? (f.size / 1048576).toFixed(1) + ' MB' : '';
        const date = fmtDate(v.date_published);
        const type = v.version_type ? (v.version_type.charAt(0).toUpperCase() + v.version_type.slice(1)) : '';
        const gvs = (v.game_versions || []).slice(0, 3).join(', ') + ((v.game_versions || []).length > 3 ? '...' : '');
        // подсветка: нужная по диагнозу ИЛИ требуемая установленным модом
        const need = versionNeed(specificNeeded, v);
        const diagMatch = !!(hl && hl.needVersion && versionMatchesRange(v.version_number, hl.needVersion));
        const gold = need.gold || diagMatch;
        const row = document.createElement('div');
        row.className = 'b-mod b-ver-row' + (gold ? ' hl' : '');
        row.dataset.vid = v.id || '';
        let tags = '';
        if (diagMatch) tags += '<span class="b-tag" style="color:#f0b90b">\u2713 \u041d\u0443\u0436\u043d\u0430\u044f \u0432\u0435\u0440\u0441\u0438\u044f</span>';
        if (need.gold && need.neededBy.length) {
          tags += '<span class="b-tag" style="color:#f0b90b">\u043d\u0443\u0436\u0435\u043d \u0434\u043b\u044f: ' + escapeHtml(need.neededBy.join(', ')) + (need.range ? ' &middot; \u0432\u0435\u0440\u0441\u0438\u044f ' + escapeHtml(need.range) : '') + '</span>';
        }
        row.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:3px;min-width:0">
            <div class="bm-name">${escapeHtml(gvs)} &middot; ${escapeHtml((v.loaders || []).join('/'))} ${tags}</div>
            <div class="bm-meta">${type ? escapeHtml(type) + ' &middot; ' : ''}${date}${mb ? ' &middot; ' + mb : ''}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;margin-top:2px">
            <button class="b-mini play" data-dep="0" style="width:100%">\u0423\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c</button>
            <button class="b-mini" data-dep="1" style="width:100%">\u0421 \u0437\u0430\u0432\u0438\u0441\u0438\u043c\u043e\u0441\u0442\u044f\u043c\u0438</button>
          </div>`;
        row.querySelector('[data-dep="0"]').addEventListener('click', () => doInstall(h, v, false));
        row.querySelector('[data-dep="1"]').addEventListener('click', () => doInstall(h, v, true));
        box.appendChild(row);
      });
    }).catch(err => {
      box.innerHTML = '<div class="b-empty">\u041e\u0448\u0438\u0431\u043a\u0430: ' + escapeHtml(err.message || err) + '</div>';
    });
  }

  function openModPage(h, hl) {
    const fam = isFav(h.slug);
    OPEN_MOD = { h, hl: hl || null };
    openModal(escapeHtml(h.title), `
      <div class="mp-head">
        <img class="mp-icon" src="${h.icon_url || ''}" alt=""/>
        <div class="mp-titles">
          <div class="mp-name">${escapeHtml(h.title)}</div>
          <div class="mp-sub" id="mpSub">${h.downloads ? h.downloads + ' \u0441\u043a\u0430\u0447\u0438\u0432\u0430\u043d\u0438\u0439' : ''}${(h.categories || []).length ? ' &middot; ' + escapeHtml((h.categories || []).join(', ')) : ''}</div>
        </div>
        <button class="mp-fav ${fam ? 'on' : ''}" id="mpFavBtn">${favIcon()}<span class="mp-fav-t">${fam ? '\u0412 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u043c' : '\u0412 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435'}</span></button>
      </div>
      <div class="mp-grid">
        <div class="mp-col-left">
          <div class="mp-gallery" id="mpGallery" style="display:none">
            <img class="mp-main" id="mpMain" src="" alt=""/>
            <div class="mp-thumbs" id="mpThumbs"></div>
          </div>
        </div>
        <div class="mp-col-mid">
          <div class="mp-vtitle">\u0412\u0435\u0440\u0441\u0438\u0438 \u043c\u043e\u0434\u0430</div>
          <div id="mVers" class="mp-vlist"></div>
        </div>
        <div class="mp-col-right">
          <div class="mp-vtitle">\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435</div>
          <div class="mp-body" id="mpBody"></div>
        </div>
      </div>
    `, true);const mb2 = modal.querySelector('.modal');
    if (mb2) mb2.classList.add('wide');
    if (getCustom().cardLayout === 'center' && mb2) mb2.classList.add('mp-cust-center');
    const fb = $('#mpFavBtn');
    if (fb) fb.addEventListener('click', () => toggleFav(h, fb));
    api.invoke('modrinth:project', h.slug).then(p => {
      if (!p) return;
      const sub = $('#mpSub');
      if (sub) {
        const bits = [];
        if (p.author) bits.push(escapeHtml(p.author));
        if (p.downloads) bits.push((p.downloads / 1000).toFixed(1) + 'K \u0441\u043a\u0430\u0447\u0438\u0432\u0430\u043d\u0438\u0439');
        if (p.followers) bits.push(escapeHtml(String(p.followers)) + ' \u0432 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u043c');
        if (bits.length) sub.innerHTML = bits.join(' &middot; ');
      }
      const colL = document.querySelector('.mp-col-left');
      if (colL) colL.style.display = 'none';
      const g = $('#mpGallery');
      if (g && Array.isArray(p.gallery) && p.gallery.length) {
        const imgs = p.gallery.map(x => x.url).filter(Boolean);
        if (imgs.length) {
          if (colL) colL.style.display = 'flex';
          g.style.display = '';
          const main = $('#mpMain');
          main.src = imgs[0];
          // Галерея на весь экран: долгое наведение на фото (кастомизация)
          let gzTimer = 0;
          const openLightbox = (src) => {
            const lb = document.createElement('div');
            lb.className = 'cust-lightbox';
            lb.innerHTML = '<img src="' + src + '" alt=""/><div class="lb-x">&#10005;</div>';
            lb.addEventListener('click', () => lb.remove());
            document.body.appendChild(lb);
          };
          main.addEventListener('mouseenter', () => {
            if (!getCustom().galleryZoom || !main.src) return;
            gzTimer = setTimeout(() => openLightbox(main.src), 600);
          });
          main.addEventListener('mouseleave', () => clearTimeout(gzTimer));
          const th = $('#mpThumbs');
          imgs.forEach((u, i) => {
            const t = document.createElement('img');
            t.src = u; t.className = 'mp-thumb' + (i === 0 ? ' on' : '');
            t.addEventListener('click', () => { main.src = u; th.querySelectorAll('.mp-thumb').forEach(x => x.classList.remove('on')); t.classList.add('on'); });
            th.appendChild(t);
          });
        }
      }
      const body = $('#mpBody');
      if (body) {
        if (p.body && p.body.trim()) {
          body.innerHTML = p.body;
          body.querySelectorAll('img').forEach(img => { img.style.maxWidth = '100%'; img.style.height = 'auto'; });
          body.querySelectorAll('a').forEach(a => { a.target = '_blank'; });
        } else {
          body.innerHTML = '<div style="font-family:var(--mc-font-body);font-size:11.5px;color:var(--mc-grey-2);line-height:1.55">' + escapeHtml(h.description || '') + '</div>';
        }
      }
    }).catch(() => {});
    const box = $('#mVers');
    renderModVersions(box, h, hl || null);
  }

  function doInstall(h, version, withDeps) {
    const deps = (version.dependencies || []).filter(d => d.dependency_type === 'required' && d.project_id);
    if (!withDeps && deps.length) {
      const ids = deps.map(d => d.project_id);
      api.invoke('modrinth:batch-projects', ids)
        .then(projs => {
          const names = (projs || []).map(p => p && p.title).filter(Boolean);
          openModal('Зависимости', `
            <div style="font-family:var(--mc-font-body);font-size:12px;line-height:1.6;color:var(--mc-grey-2)">
              <div style="font-family:var(--mc-font);color:var(--mc-green-2);font-size:13px;margin-bottom:8px;letter-spacing:.06em">${escapeHtml(h.title)} требует:</div>
              <ul style="margin:0 0 4px 18px">${names.map(n => '<li>' + escapeHtml(n) + '</li>').join('') || '<li>зависимости</li>'}</ul>
              <p style="margin-top:8px;color:var(--mc-grey-3);font-size:11px">Без них мод может не работать.</p>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="secondary-btn" id="mDepNo" style="margin:0;flex:1">ТОЛЬКО МОД</button>
              <button class="play-btn" id="mDepYes" style="margin:0;flex:1;font-size:14px">С ЗАВИСИМОСТЯМИ</button>
            </div>
          `);
          $('#mDepNo').addEventListener('click', () => { modal.classList.remove('show'); installNow(h, version.id, false); });
          $('#mDepYes').addEventListener('click', () => { modal.classList.remove('show'); installNow(h, version.id, true); });
        });
      return;
    }
    installNow(h, version.id, withDeps);
  }

  function installNow(h, versionId, withDeps) {
    if (!CURRENT_BUILD) return;
    setStatus('УСТАНОВКА: ' + h.title.toUpperCase(), 'busy');
    updateProgress({ name: h.title, frac: 0 });
    api.invoke('builds:install-mod', { buildId: CURRENT_BUILD.id, project: h.slug, versionId, withDeps, type: itemType(h) })
      .then(r => {
        setStatus('УСТАНОВЛЕНО: ' + (r.count || 1) + ' ФАЙЛ(ОВ)', '');
        hideProgress();
        afterModInstalled(h, versionId);
        refreshBuilds();
      })
      .catch(err => {
        setStatus('ОШИБКА: ' + (err.message || err), 'busy');
        hideProgress();
      });
  }

  // После установки: плавно золото -> зелёный -> обычная на нужной версии,
  // затем пересчёт требований (зависимость установлена — подсветка уходит)
  function afterModInstalled(h, versionId) {
    if ($('#mVers')) {
      const rows = versionId
        ? Array.from(document.querySelectorAll('#mVers [data-vid="' + CSS.escape(versionId) + '"]'))
        : Array.from(document.querySelectorAll('#mVers .b-ver-row.hl'));
      rows.forEach(row => {
        row.classList.add('req-done');
        setTimeout(() => row.classList.remove('hl', 'req', 'req-done'), 1800);
      });
    }
    if (OPEN_MOD) OPEN_MOD.hl = null;
    invalidateReqs();
    setTimeout(() => {
      reqsPromise().then(() => {
        if (OPEN_MOD && $('#mVers')) renderModVersions($('#mVers'), OPEN_MOD.h, OPEN_MOD.hl);
      });
    }, 2000);
  }

  let _upLast = 0;
  function updateProgress(p) {
    // троттлинг: не чаще 100 мс — частые IPC-события прогресса не перегружают layout
    const now = performance.now();
    if (now - _upLast < 100) return;
    _upLast = now;
    const box = $('#bProgress');
    if (!box) return;
    box.classList.remove('hidden');
    const fill = $('#bpFill');
    const lbl = $('#bpLabel');
    const frac = typeof p.frac === 'number' ? p.frac : 0;
    const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
    if (fill) fill.style.width = pct + '%';
    const name = String(p.name || '').toUpperCase();
    if (lbl) lbl.textContent = 'УСТАНОВКА: ' + (name === 'ЗАГРУЗЧИК' ? 'ЗАГРУЗЧИК' : name) + ' ' + pct + '%';
  }

  function hideProgress() {
    const box = $('#bProgress');
    if (box) box.classList.add('hidden');
  }

  function openCreateModal() {
    const rel = VERSION_LIST.filter(versionFilter).filter(v => v.type === 'release');
    const opts = rel.length
      ? rel.map(v => '<option value="' + v.id + '">' + v.id + '</option>').join('')
      : '<option value="1.21.4">1.21.4</option>';
    const iconNames = Object.keys(__I || {});
    openModal('Создание сборки', `
      <div class="set-row"><div><div class="s-label">НАЗВАНИЕ</div><div class="s-desc">Имя сборки</div></div><input type="text" id="bName" value="Моя сборка" style="background:var(--mc-grey-5);border:2px solid var(--mc-off-black);color:var(--mc-off-white);padding:7px 10px;font-family:var(--mc-font);font-size:12px;width:170px;outline:none"/></div>
      <div class="set-row"><div><div class="s-label">ВЕРСИЯ ИГРЫ</div><div class="s-desc">Релизная версия для сборки</div></div><select id="bGameVer" style="background:var(--mc-grey-5);border:2px solid var(--mc-off-black);color:var(--mc-off-white);padding:7px 10px;font-family:var(--mc-font);font-size:12px;outline:none">${opts}</select></div>
      <div class="set-row"><div><div class="s-label">ЗАГРУЗЧИК</div><div class="s-desc">Fabric / Forge / NeoForge / Quilt</div></div><select id="bLoader" style="background:var(--mc-grey-5);border:2px solid var(--mc-off-black);color:var(--mc-off-white);padding:7px 10px;font-family:var(--mc-font);font-size:12px;outline:none"><option>Fabric</option><option>Forge</option><option>NeoForge</option><option>Quilt</option></select></div>
      <div class="set-row"><div><div class="s-label">ИКОНКА ПРОФИЛЯ</div><div class="s-desc">Как в официальном лаунчере</div></div><div id="bIconPick" style="display:flex;flex-wrap:wrap;gap:4px;max-width:220px"></div></div>
      <button class="play-btn" id="bCreateBtn" style="font-size:15px;margin-top:16px;letter-spacing:.1em">СОЗДАТЬ СБОРКУ</button>
    `);
    let pickedIcon = 'Grass.png';
    const pick = $('#bIconPick');
    if (pick && iconNames.length) {
      pick.innerHTML = '';
      iconNames.forEach(name => {
        const img = document.createElement('img');
        img.src = ic(name);
        img.style.cssText = 'width:34px;height:34px;image-rendering:pixelated;background:var(--mc-grey-5);border:2px solid var(--mc-off-black);cursor:pointer';
        img.addEventListener('click', () => {
          pickedIcon = name;
          pick.querySelectorAll('img').forEach(i => i.style.borderColor = 'var(--mc-off-black)');
          img.style.borderColor = 'var(--mc-green-4)';
        });
        pick.appendChild(img);
      });
    }
    const btn = $('#bCreateBtn');
    btn.addEventListener('click', () => {
      const name = ($('#bName').value || '').trim();
      const gameVersion = $('#bGameVer').value;
      const loader = $('#bLoader').value;
      btn.textContent = 'УСТАНОВКА ЗАГРУЗЧИКА...';
      btn.disabled = true;
      setStatus('СОЗДАНИЕ СБОРКИ: ' + name, 'busy');
      api.invoke('builds:create', { name, gameVersion, loader, icon: pickedIcon })
        .then(b => {
          modal.classList.remove('show');
          setStatus('СБОРКА СОЗДАНА: ' + b.name, '');
          refreshBuilds().then(() => selectBuild(b.id));
        })
        .catch(err => {
          setStatus('ОШИБКА: ' + (err.message || err), 'busy');
          btn.textContent = 'СОЗДАТЬ СБОРКУ';
          btn.disabled = false;
        });
    });
  }

  if ($('#bNewBtn')) {
    let instSearchT = null;
    $('#bNewBtn').addEventListener('click', openCreateModal);
    $('#bSearchBtn').addEventListener('click', () => { B_OFFSET = 0; refreshCatalog(); });
    $('#bInstSearch').addEventListener('input', (e) => {
      clearTimeout(instSearchT);
      instSearchT = setTimeout(() => { INST_QUERY = e.target.value.trim().toLowerCase(); renderInstalled(); }, 180);
    });
    $('#bSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { B_OFFSET = 0; refreshCatalog(); } });
    $('#bPrev').addEventListener('click', () => { if (B_OFFSET >= 25) { B_OFFSET -= 25; refreshCatalog(); } });
    $('#bNext').addEventListener('click', () => { B_OFFSET += 25; refreshCatalog(); });
    let bcTimer = null;
    api.on('builds:changed', () => {
      // дебаунс: серия событий (установка/удаление) → один пересчёт
      clearTimeout(bcTimer);
      bcTimer = setTimeout(() => {
        invalidateReqs();
        refreshBuilds().then(() => {
          if (OPEN_MOD && $('#mVers')) renderModVersions($('#mVers'), OPEN_MOD.h, OPEN_MOD.hl);
        });
      }, 150);
    });
    api.on('mod:progress', (p) => updateProgress(p));
    api.on('builds:progress', (p) => updateProgress(p));
  }

  /* ===== Инициализация ===== */
  // Режим «Экономия»: единый выключатель всего декоративного
  function applyEco() {
    document.documentElement.classList.toggle('eco', !!settingsCache.economy);
    if (driftCtl) {
      if (settingsCache.economy) driftCtl.stop(); else driftCtl.start();
    }
  }

  // Лёгкая самодиагностика: замер FPS ~1.5с, при низком FPS предложим экономию
  function measureFps(duration) {
    return new Promise(resolve => {
      let frames = 0;
      const start = performance.now();
      const loop = () => {
        frames++;
        const now = performance.now();
        if (now - start >= (duration || 1500)) {
          resolve(frames / ((now - start) / 1000));
          return;
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  }

  function setupPanoParallax() {
    const pv = document.getElementById('versionPreview');
    if (!pv) return;
    // Панорама на отдельном GPU-слое: анимируем transform, а не background-position
    const baseBg = getComputedStyle(pv).background;
    const bg = document.createElement('div');
    bg.className = 'vp-bg';
    const syncBg = () => {
      if (pv.classList.contains('modded')) {
        bg.style.background = 'linear-gradient(180deg, hsla(0,0%,0%,.35), hsla(0,0%,0%,.6)), var(--mc-grey-6)';
      } else {
        bg.style.background = baseBg;
      }
    };
    syncBg();
    pv.classList.add('vp-strip');
    pv.appendChild(bg);
    const obs = new MutationObserver(syncBg);
    obs.observe(pv, { attributes: true, attributeFilter: ['class'] });
    let ox = 0, oy = 0, drift = 0, last = performance.now(), timer = 0, running = false;
    const tick = () => {
      // пауза: окно скрыто/свёрнуто, неактивно или включена экономия — CPU в фоне ~0
      if (running && !settingsCache.economy && !document.hidden && document.hasFocus() && pv.offsetParent !== null) {
        const now = performance.now();
        const dt = Math.min((now - last) / 1000, .1);
        last = now;
        drift += 8 * dt;
        bg.style.transform = 'translate3d(' + (-(drift % 256) + ox).toFixed(2) + 'px,' + oy.toFixed(2) + 'px,0)';
      }
      if (running) timer = setTimeout(tick, 100); // 10 Гц — дрейф медленный, глазу не отличить
    };
    const ctl = {
      start() { if (running) return; running = true; last = performance.now(); timer = setTimeout(tick, 100); },
      stop() { running = false; clearTimeout(timer); }
    };
    driftCtl = ctl;
    pv.addEventListener('mousemove', e => {
      const r = pv.getBoundingClientRect();
      const dx = (e.clientX - r.left) / r.width - .5;
      const dy = (e.clientY - r.top) / r.height - .5;
      ox = dx * -24;
      oy = dy * -16;
    });
    pv.addEventListener('mouseleave', () => { ox = 0; oy = 0; });
    if (!settingsCache.economy) ctl.start();
  }

  function init() {
    // Окно скрыто/свернуто/неактивно → пауза всем CSS-анимациям (экономия CPU в фоне)
    const togglePaused = () => document.documentElement.classList.toggle('anim-paused', document.hidden || !document.hasFocus());
    document.addEventListener('visibilitychange', togglePaused);
    window.addEventListener('blur', togglePaused);
    window.addEventListener('focus', togglePaused);
    togglePaused();
    setupPanoParallax();
    buildMods();
    api.invoke('settings:get').then(s => {
      if (s) {
        settingsCache = { ...settingsCache, ...s };
        applyTheme();
        applyEco();
        applyCustom();
        showBuildsTab(!!settingsCache.experimental);
        const acc = $('#topAccent');
        if (acc) acc.textContent = 'Аккаунт: ' + settingsCache.username + ' \u00b7 offline';
        buildSettingsPanel();
      }
    }).catch(() => buildSettingsPanel());
    // Программный рендер (нет GPU-ускорения) → включаем экономию автоматически
    api.invoke('system:gpu').then(g => {
      if (g && g.software && !settingsCache.economy) {
        settingsCache.economy = true;
        api.invoke('settings:set', 'economy', true).catch(() => {});
        applyEco();
        buildSettingsPanel();
        mcToast('GPU-УСКОРЕНИЕ НЕДОСТУПНО — ВКЛЮЧЕНА ЭКОНОМИЯ CPU');
      }
    }).catch(() => {});

    buildTypeButtons();
    refreshBuilds();
    api.invoke('update:check').then(u => { if (u && u.version) showUpdateModal(u); });
    // Версия лаунчера в статус-баре (реальная, из package.json)
    api.invoke('app:info').then(i => {
      if (i && i.version) $('#appVersion').textContent = 'v' + i.version + ' · st4amLauncher';
    }).catch(() => { $('#appVersion').textContent = 'st4amLauncher'; });
    // Статус последнего запуска обновления: успех или причина ошибки
    api.invoke('update:status').then(s => {
      if (s && s.error) showToast('ОШИБКА ОБНОВЛЕНИЯ: ' + String(s.error).slice(0, 220), true);
      else if (s && s.ok) showToast('ЛАУНЧЕР УСПЕШНО ОБНОВЛЁН', false);
    }).catch(() => {});
    setTimeout(() => refreshCatalog(), 1500);
api.invoke('favs:list').then(f => { FAVS = Array.isArray(f) ? f : []; applyFavsToCards(); }).catch(() => {});
    // Если после прошлого краша остался необработанный диагноз — напомним
    api.invoke('diagnosis:pending').then(r => { if (r) setTimeout(() => showDiagnostics(r), 1200); }).catch(() => {});
    // Самодиагностика: через 4с замеряем FPS, при низком — предлагаем экономию
    setTimeout(() => {
      if (settingsCache.economy) return;
      measureFps(1500).then(fps => {
        if (fps < 45 && settingsCache.economy !== true) {
          mcToast('НИЗКИЙ FPS (' + Math.round(fps) + ') — ВКЛЮЧИТЕ ЭКОНОМИЮ CPU В НАСТРОЙКАХ');
        }
      });
    }, 4000);
    api.invoke('versions:list').then(list => {
      if (Array.isArray(list) && list.length) {
        VERSION_LIST = list;
        const visible = list.filter(versionFilter);
        const releases = visible.filter(v => v.type === 'release');
        const latest = releases.length ? releases[0].id : (visible.length ? visible[0].id : '1.21.4');
        CURRENT_VERSION = latest;
        applyVersion(latest);
        renderVersions();
        const menu = $('#versionMenu');
        if (menu) {
          menu.innerHTML = '';
          visible.forEach(v => {
            const t = typeOf(v.type);
            const div = document.createElement('div');
            div.className = 'dm-item';
            div.dataset.ver = v.id;
            div.innerHTML = `<span>${v.id}</span><span class="tag">${t[0].toLowerCase()}</span>`;
            div.addEventListener('click', () => applyVersion(v.id));
            menu.appendChild(div);
          });
        }
      }
    }).catch(() => setStatus('НЕТ СЕТИ: БЕЗ СПИСКА ВЕРСИЙ', 'busy'));
  }

function showUpdateModal(u) {
    openModal(
      '\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 \u043b\u0430\u0443\u043d\u0447\u0435\u0440\u0430',
      '<div class="upd-box">' +
        '<div class="upd-text">\u0412\u044b\u0448\u043b\u0430 \u043d\u043e\u0432\u0430\u044f \u0432\u0435\u0440\u0441\u0438\u044f <b>' + escapeHtml(u.version) + '</b>!</div>' +
        '<button class="play-btn upd-btn" id="updYes">\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0441\u0435\u0439\u0447\u0430\u0441</button>' +
        '<button class="secondary-btn upd-btn" id="updNo">\u041f\u043e\u0437\u0436\u0435</button>' +
      '</div>',
      false
    );
    const yes = $('#updYes');
    if (yes) yes.addEventListener('click', () => {
      $('#modalBackdrop').classList.remove('show');
      showToast('\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 \u0437\u0430\u043f\u0443\u0449\u0435\u043d\u043e... \u041b\u0430\u0443\u043d\u0447\u0435\u0440 \u0437\u0430\u043a\u0440\u043e\u0435\u0442\u0441\u044f \u0441\u0430\u043c');
      api.invoke('update:now').then(ok => {
        if (!ok) showToast('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435');
      });
    });
    const no = $('#updNo');
    if (no) no.addEventListener('click', () => $('#modalBackdrop').classList.remove('show'));
  }

  /* ===== Модалка кастомизации (0.2.8) ===== */
  function initSkinPanel(c) {
    const canvas = $('#skinCanvas');
    const msg = $('#skinMsg');
    const modelLbl = $('#skinModel');
    const nick = $('#skinNick');
    let skinTexture = c.skinTexture || '';
    let skinCape = c.skinCape || '';
    let model = c.skinModel || 'classic';

    const drawPreview = () => {
      const ctx = canvas.getContext('2d');
      if (!skinTexture) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (modelLbl) modelLbl.textContent = '—';
        return;
      }
      if (modelLbl) modelLbl.textContent = model === 'slim' ? 'СЛИМ' : 'КЛАССИЧЕСКИЙ';
      const hat = $('#skinHat') ? $('#skinHat').checked : true;
      const back = $('#skinBack') ? $('#skinBack').checked : false;
      const cape = ($('#skinCape') && $('#skinCape').checked) ? skinCape : '';
      window.SkinRenderer.render(canvas, skinTexture, { slim: model === 'slim', back, hat, cape }).catch(() => {});
    };
    const hatEl = $('#skinHat'), backEl = $('#skinBack'), capeEl = $('#skinCape');
    if (hatEl) hatEl.addEventListener('change', drawPreview);
    if (backEl) backEl.addEventListener('change', drawPreview);
    if (capeEl) capeEl.addEventListener('change', drawPreview);
    const inGameEl = $('#skinInGame');
    if (inGameEl) inGameEl.addEventListener('change', () => {
      c.skinInGame = inGameEl.checked;
      const note = $('#skinNote');
      if (note) note.style.display = inGameEl.checked ? '' : 'none';
      if (inGameEl.checked && !c.skinNickname) {
        msg.textContent = 'Сначала загрузите скин — ник игрока возьмётся из него';
        msg.classList.add('err');
      }
      saveCustom(c);
    });

    const loadBtn = $('#skinLoad');
    if (loadBtn) loadBtn.addEventListener('click', () => {
      const n = (nick ? nick.value : '').trim();
      if (!n) { msg.textContent = 'Укажите ник игрока'; msg.classList.add('err'); return; }
      msg.textContent = 'ЗАГРУЗКА...';
      msg.classList.remove('err');
      api.invoke('skin:fetch', n).then(r => {
        if (r && r.ok) {
          skinTexture = r.texture;
          skinCape = r.cape || '';
          model = r.model || 'classic';
          c.skinNickname = n;
          c.skinUuid = r.uuid || '';
          c.skinTexture = skinTexture;
          c.skinCape = skinCape;
          c.skinModel = model;
          saveCustom(c);
          msg.textContent = 'СКИН ЗАГРУЖЕН (ID: ' + (r.uuid || '—').slice(0, 8) + ')';
          msg.classList.remove('err');
          drawPreview();
        } else {
          msg.textContent = (r && r.error) || 'ОШИБКА';
          msg.classList.add('err');
        }
      }).catch(() => { msg.textContent = 'ОШИБКА СЕТИ'; msg.classList.add('err'); });
    });

    const clearBtn = $('#skinClear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      skinTexture = ''; skinCape = ''; model = 'classic';
      c.skinNickname = ''; c.skinUuid = ''; c.skinTexture = ''; c.skinCape = ''; c.skinModel = 'classic';
      if (nick) nick.value = '';
      saveCustom(c);
      msg.textContent = '';
      msg.classList.remove('err');
      drawPreview();
    });

    drawPreview();
  }

  function openCustModal() {
    const c = getCustom();
    openModal('КАСТОМИЗАЦИЯ', `
      <div class="cust-modal">
        <div class="cust-tabs">
          <button class="cust-tab sel" data-tab="profile">КАСТОМИЗИРОВАТЬ ПРОФИЛЬ</button>
          <button class="cust-tab" data-tab="buttons">КАСТОМИЗИРОВАТЬ КНОПКИ</button>
        </div>
        <div class="cust-pane" data-pane="profile">
          <div class="cust-profile">
            <div class="cust-skin-box">
              <canvas id="skinCanvas" width="132" height="150"></canvas>
              <div class="cust-skin-model" id="skinModel">&mdash;</div>
            </div>
            <div class="cust-profile-right">
              <div class="cust-h">ВВЕДИТЕ НИК ИГРОКА (ELY.BY)</div>
              <div class="cust-nick-line">
                <input type="text" id="skinNick" placeholder="Ник игрока" value="${escapeHtml(c.skinNickname)}"/>
                <button class="play-btn" id="skinLoad">ЗАГРУЗИТЬ</button>
              </div>
              <div class="cust-skin-msg" id="skinMsg"></div>
              <div class="cust-skin-opts">
                <label><input type="checkbox" id="skinHat" checked/> Шапка</label>
                <label><input type="checkbox" id="skinBack"/> Сзади</label>
                <label><input type="checkbox" id="skinCape"/> Плащ</label>
                <label><input type="checkbox" id="skinInGame"${c.skinInGame ? ' checked' : ''}/> Скин в игре</label>
              </div>
              <div class="cust-skin-note" id="skinNote" style="display:${c.skinInGame ? '' : 'none'}">При запуске ник игрока будет заменён на ник скина, а в сборку автоматически установится CustomSkinLoader с ely.by.</div>
              <button class="secondary-btn" id="skinClear" style="align-self:flex-start">СБРОСИТЬ СКИН</button>
            </div>
          </div>
        </div>
        <div class="cust-pane" data-pane="buttons" style="display:none">
          <div class="cust-h">РАЗМЕР КАРТОЧЕК</div>
          <div class="cust-seg" id="custSizeSeg">
            <button data-size="sm">МАЛЕНЬКИЕ</button>
            <button data-size="md"${c.cardSize === 'md' ? ' class="sel"' : ''}>СРЕДНИЕ</button>
            <button data-size="lg">БОЛЬШИЕ</button>
          </div>
          <div class="cust-h">РАСКЛАДКА СТРАНИЦЫ МОДА</div>
          <div class="cust-seg" id="custLayoutSeg">
            <button data-layout="default"${c.cardLayout === 'default' ? ' class="sel"' : ''}>СТАНДАРТНАЯ</button>
            <button data-layout="center">ФОТО ПО ЦЕНТРУ</button>
          </div>
          <div class="cust-h">ЭФФЕКТ ПРИ НАВЕДЕНИИ</div>
          <div class="cust-seg" id="custHoverSeg">
            <button data-hover="lift"${c.hover === 'lift' ? ' class="sel"' : ''}>ПОДЪЁМ</button>
            <button data-hover="glow">СВЕЧЕНИЕ</button>
            <button data-hover="none">БЕЗ ЭФФЕКТА</button>
          </div>
          <div class="set-row"><div><div class="s-label">АНИМАЦИИ КАРТОЧЕК</div><div class="s-desc">Появление и переходы карточек</div></div><div class="switch ${c.cardAnim ? 'on' : ''}" id="custAnim"></div></div>
          <div class="set-row"><div><div class="s-label">ЦВЕТНЫЕ КРАЯ ИКОНОК</div><div class="s-desc">Акцентная рамка по цвету иконки</div></div><div class="switch ${c.accentEdges ? 'on' : ''}" id="custAccent"></div></div>
          <div class="set-row"><div><div class="s-label">ГАЛЕРЕЯ НА ВЕСЬ ЭКРАН</div><div class="s-desc">Долгое наведение на фото мода</div></div><div class="switch ${c.galleryZoom ? 'on' : ''}" id="custZoom"></div></div>
          <button class="secondary-btn" id="custReset" style="align-self:flex-start">СБРОСИТЬ КНОПКИ</button>
        </div>
      </div>
    `, false);

    $$('.cust-tab').forEach(tab => tab.addEventListener('click', () => {
      $$('.cust-tab').forEach(t => t.classList.toggle('sel', t === tab));
      $$('.cust-pane').forEach(p => { p.style.display = p.dataset.pane === tab.dataset.tab ? '' : 'none'; });
    }));

    initSkinPanel(c);

    const seg = (id, key, valKey) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const val = btn.dataset[valKey];
        c[key] = val;
        el.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset[valKey] === val));
        saveCustom(c);
        setStatus('НАСТРОЙКИ КНОПОК СОХРАНЕНЫ', '');
      });
    };
    seg('#custSizeSeg', 'cardSize', 'size');
    seg('#custLayoutSeg', 'cardLayout', 'layout');
    seg('#custHoverSeg', 'hover', 'hover');

    const sw = (id, key) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('click', () => {
        c[key] = !c[key];
        el.classList.toggle('on', c[key]);
        saveCustom(c);
        setStatus((c[key] ? 'ВКЛ: ' : 'ВЫКЛ: ') + key.toUpperCase(), '');
      });
    };
    sw('#custAnim', 'cardAnim');
    sw('#custAccent', 'accentEdges');
    sw('#custZoom', 'galleryZoom');

    const resetBtns = $('#custReset');
    if (resetBtns) resetBtns.addEventListener('click', () => {
      c.cardSize = 'md'; c.cardLayout = 'default'; c.hover = 'lift';
      c.cardAnim = true; c.accentEdges = true; c.galleryZoom = true;
      saveCustom(c);
      openCustModal();
    });
  }

  init();
})();
