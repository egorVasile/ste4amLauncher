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
  function applyEdgeAccent(imgEl, targetEl) {
    const src = imgEl.src;
    if (!src) return;
    if (ACCENT_CACHE[src] !== undefined) {
      if (ACCENT_CACHE[src]) setAccent(targetEl, ACCENT_CACHE[src]);
      return;
    }
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => {
      try {
        const S = 32;
        const c = document.createElement('canvas');
        c.width = S; c.height = S;
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
        ACCENT_CACHE[src] = cols;
        if (cols) setAccent(targetEl, cols);
      } catch (e) { ACCENT_CACHE[src] = null; }
    };
    im.onerror = () => { ACCENT_CACHE[src] = null; };
    im.src = src;
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
  function versionFilter(v) {
    if (settingsCache.showOldVersions === false && (v.type === 'old_alpha' || v.type === 'old_beta')) return false;
    if (settingsCache.showSnapshots === false && (v.type === 'snapshot' || v.type === 'old_beta' || v.type === 'old_alpha')) return false;
    return true;
  }
  function buildVersionsFromManifest(list) {
    const d = $('#versionsList');
    if (!d) return;
    VERSION_LIST = list;
    renderVersions();
  }
  function renderVersions() {
    const d = $('#versionsList');
    if (!d) return;
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
  let settingsCache = { username: 'Player', ram: 2, mirror: 'auto', theme: 'dark', totalRam: 8, width: '', height: '', launcherMode: 'keep' };

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
      <div class="set-cat">ПРОФИЛЬ</div>
      <div class="set-row"><div><div class="s-label">ИМЯ (OFFLINE)</div><div class="s-desc">Ник для оффлайн-режима</div></div>
      <input type="text" id="nickInput" value="${escapeHtml(settingsCache.username)}" style="background:var(--mc-grey-5);border:2px solid var(--mc-off-black);color:var(--mc-off-white);padding:7px 10px;font-family:var(--mc-font);font-size:13px;width:180px;outline:none"/></div>
      <div class="set-cat">ИГРА</div>
      <div class="set-row"><div><div class="s-label">ПАМЯТЬ (RAM)</div><div class="s-desc">Выделенная память для игры (макс. ${settingsCache.totalRam} GB — реальная)</div></div>
      <input type="range" id="ram2" min="1" max="${settingsCache.totalRam}" step="1" value="${safeRam(settingsCache.ram)}"/><div class="s-value" id="ram2v">${safeRam(settingsCache.ram)} GB</div></div>
      <div class="set-row"><div><div class="s-label">ПОКАЗЫВАТЬ СНАПШОТЫ</div><div class="s-desc">Скрыть нестабильные версии из списка</div></div><div class="switch ${settingsCache.showSnapshots ? 'on' : ''}" id="swSnap"></div></div>
      <div class="set-row"><div><div class="s-label">СТАРЫЕ ВЕРСИИ</div><div class="s-desc">Показывать alpha/beta (2010-2013)</div></div><div class="switch ${settingsCache.showOldVersions ? 'on' : ''}" id="swOld"></div></div>
      <div class="set-row"><div><div class="s-label">ОПТИМИЗАЦИЯ МАЙНКРАФТА</div><div class="s-desc">G1GC-флаги, быстрый запуск, настройки памяти</div></div><div class="switch ${settingsCache.optimize ? 'on' : ''}" id="swOpt"></div></div>
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
    $('#expSw').addEventListener('click', () => {
      settingsCache.experimental = !settingsCache.experimental;
      $('#expSw').classList.toggle('on', settingsCache.experimental);
      api.invoke('settings:set', 'experimental', settingsCache.experimental);
      showBuildsTab(settingsCache.experimental);
      setStatus(settingsCache.experimental ? 'ЭКСПЕРИМЕНТАЛЬНО: ВКЛ' : 'ЭКСПЕРИМЕНТАЛЬНО: ВЫКЛ', '');
    });
    $('#resetBtn').addEventListener('click', () => {
      ram.value = 2; $('#ram2v').textContent = '2 GB';
      settingsCache = { ...settingsCache, ram: 2, jvmArgs: '', showSnapshots: true, optimize: true, width: '', height: '', launcherMode: 'keep' };
      api.invoke('settings:set', 'ram', 2);
      api.invoke('settings:set', 'jvmArgs', '');
      api.invoke('settings:set', 'showSnapshots', true);
      api.invoke('settings:set', 'optimize', true);
      api.invoke('settings:set', 'width', '');
      api.invoke('settings:set', 'height', '');
      api.invoke('settings:set', 'launcherMode', 'keep');
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
  const B_TYPES = [['mod', 'МОДЫ'], ['resourcepack', 'РЕСУРСПАКИ'], ['shaderpack', 'ШЕЙДЕРЫ'], ['datapack', 'ДАТАПАКИ']];
  let B_TYPE = 'mod';
  let INST_QUERY = '';
  let B_CAT = null;

  function refreshBuilds() {
    return api.invoke('builds:list').then(list => {
      BUILD_LIST = Array.isArray(list) ? list : [];
      if (CURRENT_BUILD) {
        const still = BUILD_LIST.find(b => b.id === CURRENT_BUILD.id);
        CURRENT_BUILD = still || null;
      }
      renderBuilds();
      renderDetailBuild();
      if (!CURRENT_BUILD && BUILD_LIST.length) selectBuild(BUILD_LIST[0].id, false);
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
    if (refreshCat !== false) { B_OFFSET = 0; refreshCatalog(); }
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
    list.innerHTML = '';
    if (!BUILD_LIST.length) {
      list.innerHTML = '<div class="b-empty">Сборок пока нет — создайте первую!</div>';
      return;
    }
    BUILD_LIST.forEach((b, i) => {
      const card = document.createElement('div');
      card.className = 'b-card' + (CURRENT_BUILD && CURRENT_BUILD.id === b.id ? ' sel' : '');
      card.style.animationDelay = (i * 0.04) + 's';
      card.innerHTML = `
        <img src="${ic(b.icon || 'Grass.png')}" alt=""/>
        <div class="bc-body">
          <div class="b-name">${escapeHtml(b.name)}</div>
          <div class="b-meta">
            <span class="b-tag green">${escapeHtml(b.gameVersion)}</span>
            <span class="b-tag">${escapeHtml(b.loader)}</span>
            <span class="b-tag">${b.modCount || 0} модов</span>
          </div>
        </div>`;
      card.addEventListener('click', () => selectBuild(b.id));
      list.appendChild(card);
      const cardImg = card.querySelector('img');
      if (cardImg) applyEdgeAccent(cardImg, card);
    });
  }

  function renderDetailBuild() {
    const box = $('#bDetail');
    if (!box) return;
    const b = CURRENT_BUILD;
    if (!b) {
      box.innerHTML = '<div class="b-empty">Выберите сборку слева</div>';
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
        <button class="b-mini del" id="bdDel">&#10005; УДАЛИТЬ</button>
      </div>`;
    const bdImg = box.querySelector('.bd-head img');
    if (bdImg) applyEdgeAccent(bdImg, box.querySelector('.bd-head'));
    $('#bdPlay').addEventListener('click', () => launchBuild(b));
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
      const list = (Array.isArray(mods) ? mods : []).filter(m => !INST_QUERY || (m.filename || "").toLowerCase().includes(INST_QUERY));
      if (cnt) cnt.textContent = list.length ? list.length + ' шт.' : '';
      box.innerHTML = '';
      if (!list.length) {
        box.innerHTML = '<div class="b-empty">' + (B_TYPE === 'mod' ? 'Модов нет — установите из каталога справа' : (B_TYPE === 'resourcepack' ? 'Ресурспаков нет — установите из каталога' : (B_TYPE === 'shaderpack' ? 'Шейдеров нет — установите из каталога' : 'Датапаков нет — установите из каталога'))) + '</div>';
        return;
      }
      list.forEach((m, i) => {
        const row = document.createElement('div');
        row.className = 'b-mod';
        row.style.animationDelay = (i * 0.03) + 's';
        const mb = (m.size / 1048576).toFixed(1);
        const filenameEsc = escapeHtml(m.filename);
        row.innerHTML = `
          <div class="b-mod-img"><img src="${modThumb(m.filename)}" alt="" loading="lazy" onerror="this.style.display='none'"></div>
          <div class="b-mod-content">
            <div class="bm-name" title="${filenameEsc}">${filenameEsc}</div>
            <div class="bm-size">${mb} MB</div>
          </div>
          <button class="bm-x" data-f="${filenameEsc}">&#10005;</button>`;
        row.querySelector('.bm-x').addEventListener('click', () => {
          api.invoke('builds:delete-mod', CURRENT_BUILD.id, m.filename, B_TYPE).then(() => {
            setStatus((B_TYPES.find(t => t[0] === B_TYPE) || ['', 'МОД'])[1] + ' УДАЛЁН', '');
            renderInstalled();
          }).catch(() => {});
        });
        const bImg = row.querySelector('.b-mod-img img');
        if (bImg) applyEdgeAccent(bImg, row);
        box.appendChild(row);
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
      facets.push(['versions:' + CURRENT_BUILD.gameVersion, 'categories:' + CURRENT_BUILD.loader.toLowerCase()]);
    }
    facets.push(['project_type:' + (B_TYPE === 'shaderpack' ? 'shader' : B_TYPE)]);
    if (B_CAT) facets.push(['categories:' + B_CAT]);
    api.invoke('modrinth:search', { query: q, facets, limit: 25, offset: B_OFFSET }).then(res => {
      if (info && res.total_hits) info.textContent = res.total_hits + ' результатов';
      box.innerHTML = '';
      if (!res.hits || !res.hits.length) {
        box.innerHTML = '<div class="b-empty">Ничего не найдено</div>';
        return;
      }
      res.hits.forEach((h, i) => {
        const row = document.createElement('div');
        row.className = 'b-hit';
        row.style.animationDelay = (i * 0.03) + 's';
        const dl = Math.round(h.downloads / 1000) + 'K';
        row.innerHTML = `
          <button class="b-fav" data-slug="${h.slug}" title=""></button>
          <img src="${h.icon_url || ''}" alt=""/>
          <div class="bh-body">
            <div class="bh-name">${escapeHtml(h.title)}</div>
            <div class="bh-desc">${escapeHtml(h.description || '')}</div>
            <div class="bh-meta"><span class="b-tag">${dl} скач.</span>${h.categories && h.categories.length ? '<span class="b-tag">' + escapeHtml(h.categories.join(', ')) + '</span>' : ''}</div>
          </div>`;
        row.addEventListener('click', () => openModPage(h));
        const fbtn = row.querySelector('.b-fav');
        if (fbtn) {
          fbtn.innerHTML = favIcon();
          fbtn.classList.toggle('on', isFav(h.slug));
          fbtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(h, fbtn); });
        }
        const bImg = row.querySelector('.b-mod-img img');
        if (bImg) applyEdgeAccent(bImg, row);
        box.appendChild(row);
        const hitImg = row.querySelector('img');
        if (hitImg && hitImg.src) applyEdgeAccent(hitImg, row);
      });
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
        showToast('\u041c\u043e\u0434 \u00ab' + h.title + '\u00bb \u0443\u0434\u0430\u043b\u0451\u043d \u0438\u0437 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0433\u043e', true);
      } else {
        FAVS = await api.invoke('favs:add', { slug: h.slug, title: h.title, icon_url: h.icon_url || '', description: h.description || '', categories: h.categories || [], project_type: h.project_type || '', btype: B_TYPE });
        showToast('\u041c\u043e\u0434 \u00ab' + h.title + '\u00bb \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d \u0443\u0441\u043f\u0435\u0448\u043d\u043e!', false);
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
    const h = { slug: f.slug, title: f.title, icon_url: f.icon_url, description: f.description, categories: f.categories, downloads: f.downloads || 0, project_type: f.project_type || '' };
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
    if (!any) box.innerHTML = '<div class="b-empty">\u041f\u043e\u043a\u0430 \u043f\u0443\u0441\u0442\u043e \u2014 \u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0439\u0442\u0435 \u043c\u043e\u0434\u044b \u0432 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435 \u0444\u043b\u0430\u0436\u043a\u043e\u043c</div>';
  }

  function openModPage(h) {
    const fam = isFav(h.slug);
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
    box.innerHTML = '<div class="b-empty">\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...</div>';
    if (!CURRENT_BUILD) {
      box.innerHTML = '<div class="b-empty">\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u0431\u043e\u0440\u043a\u0443</div>';
      return;
    }
    api.invoke('modrinth:versions', h.slug, CURRENT_BUILD.gameVersion, B_TYPE === 'mod' ? CURRENT_BUILD.loader.toLowerCase() : null).then(vers => {
      const list = Array.isArray(vers) ? vers : [];
      box.innerHTML = '';
      if (!list.length) {
        box.innerHTML = '<div class="b-empty">\u041d\u0435\u0442 \u0432\u0435\u0440\u0441\u0438\u0439 \u0434\u043b\u044f ' + escapeHtml(CURRENT_BUILD.gameVersion) + (B_TYPE === 'mod' ? ' / ' + escapeHtml(CURRENT_BUILD.loader) : '') + '</div>';
        return;
      }
      list.slice(0, 30).forEach(v => {
        const f = (v.files || []).find(x => x.primary) || (v.files || [])[0];
        const mb = f && f.size ? (f.size / 1048576).toFixed(1) + ' MB' : '';
        const date = fmtDate(v.date_published);
        const type = v.version_type ? (v.version_type.charAt(0).toUpperCase() + v.version_type.slice(1)) : '';
        const gvs = (v.game_versions || []).slice(0, 3).join(', ') + ((v.game_versions || []).length > 3 ? '...' : '');
        const row = document.createElement('div');
        row.className = 'b-mod b-ver-row';
        row.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:3px;min-width:0">
            <div class="bm-name">${escapeHtml(gvs)} &middot; ${escapeHtml((v.loaders || []).join('/'))}</div>
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
    api.invoke('builds:install-mod', { buildId: CURRENT_BUILD.id, project: h.slug, versionId, withDeps, type: B_TYPE })
      .then(r => {
        setStatus('УСТАНОВЛЕНО: ' + (r.count || 1) + ' ФАЙЛ(ОВ)', '');
        hideProgress();
        refreshBuilds();
      })
      .catch(err => {
        setStatus('ОШИБКА: ' + (err.message || err), 'busy');
        hideProgress();
      });
  }

  function updateProgress(p) {
    const box = $('#bProgress');
    if (!box) return;
    box.classList.remove('hidden');
    const fill = $('#bpFill');
    const lbl = $('#bpLabel');
    const frac = typeof p.frac === 'number' ? p.frac : 0;
    const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
    if (fill) fill.style.width = pct + '%';
    if (lbl) lbl.textContent = 'УСТАНОВКА: ' + String(p.name || '').toUpperCase() + ' ' + pct + '%';
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
    $('#bNewBtn').addEventListener('click', openCreateModal);
    $('#bSearchBtn').addEventListener('click', () => { B_OFFSET = 0; refreshCatalog(); });
    $('#bInstSearch').addEventListener('input', (e) => { INST_QUERY = e.target.value.trim().toLowerCase(); renderInstalled(); });
    $('#bSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { B_OFFSET = 0; refreshCatalog(); } });
    $('#bPrev').addEventListener('click', () => { if (B_OFFSET >= 25) { B_OFFSET -= 25; refreshCatalog(); } });
    $('#bNext').addEventListener('click', () => { B_OFFSET += 25; refreshCatalog(); });
    api.on('builds:changed', () => refreshBuilds());
    api.on('mod:progress', (p) => updateProgress(p));
    api.on('builds:progress', (p) => updateProgress(p));
  }

  /* ===== Инициализация ===== */
  function setupPanoParallax() {
    const pv = document.getElementById('versionPreview');
    if (!pv) return;
    let ox = 0, oy = 0, drift = 0, last = performance.now();
    function frame(now) {
      const dt = Math.min((now - last) / 1000, .1);
      last = now;
      drift += 8 * dt;
      pv.style.backgroundPositionX = (-(drift % 256) + ox).toFixed(2) + 'px';
      pv.style.backgroundPositionY = oy.toFixed(2) + 'px';
      requestAnimationFrame(frame);
    }
    pv.addEventListener('mousemove', e => {
      const r = pv.getBoundingClientRect();
      const dx = (e.clientX - r.left) / r.width - .5;
      const dy = (e.clientY - r.top) / r.height - .5;
      ox = dx * -24;
      oy = dy * -16;
    });
    pv.addEventListener('mouseleave', () => { ox = 0; oy = 0; });
    requestAnimationFrame(frame);
  }

  function init() {
    setupPanoParallax();
    buildMods();
    api.invoke('settings:get').then(s => {
      if (s) {
        settingsCache = { ...settingsCache, ...s };
        applyTheme();
        showBuildsTab(!!settingsCache.experimental);
        const acc = $('#topAccent');
        if (acc) acc.textContent = 'Аккаунт: ' + settingsCache.username + ' \u00b7 offline';
        buildSettingsPanel();
      }
    }).catch(() => buildSettingsPanel());

    buildTypeButtons();
    refreshBuilds();
    refreshCatalog();
    api.invoke('update:check').then(u => { if (u && u.version) showUpdateModal(u); });
api.invoke('favs:list').then(f => { FAVS = Array.isArray(f) ? f : []; applyFavsToCards(); }).catch(() => {});
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

  init();
})();
