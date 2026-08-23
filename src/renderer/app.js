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

  // ===== «Что нового»: показывается при первом запуске версии =====
  // (после обновления лаунчера и после установки)
  // Текст берётся с GitHub (whatsnew.json), чтобы с каждой новой версией
  // было свежее описание — без переустановки лаунчера.
  let APP_VERSION = '';
  const WHATSNEW_URL = 'https://raw.githubusercontent.com/egorVasile/ste4amLauncher/main/whatsnew.json';
  const NEWS_NOTES = {
    '3.0.11': "3.0.11 — умная диагностика с автопочинкой.\n\nДиагностика теперь распознаёт конфликты модов Fabric (Incompatible mods found) и показывает, какой мод не хватает, какой кого ломает.\n\nНОВАЯ КНОПКА «СДЕЛАТЬ ВСЁ АВТОМАТИЧЕСКИ»:\n— установит недостающие моды-зависимости;\n— скачает нужную Java и пропишет путь;\n— очистит кэш повреждённых библиотек;\n— при конфликте модов спросит, какой удалить (ничего не удаляется без вашего согласия).",
    '3.0.10': "3.0.10 — аккуратная раскладка кнопок.\n\n— «⇄ Перенести» переехала в карточку сборки, под кнопку «✎ Изменить»\n— Ряд кнопок (Играть/Экспорт/Импорт/Удалить) больше не переполняется\n— Кнопка «Объединить» аккуратно встала в шапке списка сборок",
    '3.0.9': "3.0.9 — перенос и объединение сборок.\n\n1) ПЕРЕНОС СБОРКИ\nКнопка «⇄ Перенести» в сборке: выбери новую версию Minecraft — лаунчер проверит каждый мод, найдёт его версию под новую игру и создаст новую сборку (старая останется). Миры и настройки переносятся по галочке. Моды, которых нет под новую версию, будут перечислены в конце.\n\n2) ОБЪЕДИНЕНИЕ СБОРКИ\nКнопка «🔗 Объединить»: выбери две или более сборок — из их модов соберётся новая. Повторяющиеся моды покажем списком — реши, что оставить. Конфиги и ресурспаки — по галочке.\n\n3) Читаемые названия модов во всех списках вместо ID.",
    '3.0.8': "3.0.8 — улучшенная диагностика.\n\nУмная диагностика крашей теперь распознаёт больше типов ошибок:\n— повреждённые нативные библиотеки (lwjgl.dll и др.) с подсказкой решения;\n— краши модов при старте (Sodium и др.).\n\nЛожные срабатывания при успешном запуске по-прежнему исключены.",
    '3.0.7': "3.0.7 — критическое исправление запуска сборок.\n\nИсправлена ошибка «Failed to locate library: lwjgl.dll» (краш всех сборок на старте, ошибка Sodium при запуске).\n\nПричина: нативные библиотеки (lwjgl.dll и др.) терялись при подготовке сборки. Теперь:\n— нативные библиотеки больше не пропадают;\n— DLL распаковываются всегда в правильное место, независимо от структуры скачанного файла;\n— все библиотеки проверяются по контрольной сумме — битые перекачиваются автоматически.\n\nЕсли сборка всё ещё не запускается — удалите её и создайте заново.",
    '3.0.6': "3.0.6 — исправление обновления.\n\nИсправлен краш «Cannot find module debuglog» после обновления до 3.0.5: в список обновления добавлен пропущенный файл, а лаунчер теперь устойчив к неполным обновлениям (не падает и может самообновиться).\n\nВсе функции 3.0.5 на месте: запуск Forge/NeoForge с модами, фильтры модпаков, автоиконки, файловые логи.",
    '3.0.5': "3.0.5 — большие исправления запуска сборок.\n\n1) ЗАГРУЗЧИКИ FORGE/NEOFORGE РАБОТАЮТ\nПолностью переписана установка: модпаки и сборки на NeoForge/Forge запускаются с модами (раньше падали с «Version not found» и ошибками модулей).\n\n2) ВАНИЛЬНЫЕ СБОРКИ\nСоздание обычной сборки без модов больше не даёт ошибку «Неизвестный загрузчик».\n\n3) ФИЛЬТРЫ МОДПАКОВ\nВ каталоге МОДПАКОВ: выбор загрузчика (Fabric/Forge/NeoForge/Quilt) и версии игры.\n\n4) АВТОИКОНКИ\nИконка мода сама становится обложкой сборки. При импорте — обложка ищется по названию. При экспорте со случайной иконкой — предупреждение.\n\n5) ЛОГИ\nВесь запуск пишется в logs/debug.log — при ошибке пришлите файл, и мы быстро починим.\n\n6) Честная диагностика: «не хватает класса» больше не появляется при успешном запуске.",
    '3.0.4': "3.0.4 — исправление установки модпаков.\n\n1) ЗАГРУЗЧИКИ FORGE И NEOFORGE ТЕПЕРЬ РАБОТАЮТ\nИсправлена ошибка, из-за которой модпаки с Forge/NeoForge не получали загрузчик и не запускались («Version not found»). Теперь профиль ставится корректно.\n\n2) АВТОДОРАБОТКА ПРИ ЗАПУСКЕ\nЕсли сборке не хватило лоадера (например, из-за сбоя сети при импорте), лаунчер сам доустановит его при нажатии «Играть».\n\n3) НАДЁЖНОСТЬ\nУстановка лоадера при импорте модпака повторяется до 3 раз при сбоях сети.",
    '3.0.3': '3.0.3 — скачивание модпаков из каталога.\n\n1) ВКЛАДКА «МОДПАКИ» В КАТАЛОГЕ\nСправа в каталоге вместо датапаков появилась вкладка МОДПАКИ: тысячи готовых сборок Modrinth (Fabulously Optimized, Cobblemon и др.) с обложками.\n\n2) УСТАНОВКА ОДНИМ КЛИКОМ\nОткройте модпак, выберите версию MINECRAFT и загрузчик из доступных — кнопка «Установить как сборку» скачает пакет и создаст готовую сборку.\n\n3) УМНОЕ КОПИРОВАНИЕ\nМоды, уже скачанные в другие сборки с той же версией игры, копируются мгновенно без повторного скачивания.',
    '3.0.2': '3.0.2 — импорт .mrpack и удобство.\n\n' +
      '1) ИМПОРТ МОДПАКОВ .mrpack ПОЧИНЕН\nВерсия игры теперь берётся из манифеста модпака (раньше подставлялась версия самого пакета — сборка получалась нерабочей). Установка лоадера показывает прогресс по этапам и не блокирует импорт при ошибке.\n\n' +
      '2) УМНОЕ КОПИРОВАНИЕ МОДОВ\nПри импорте лаунчер находит уже скачанные моды в ваших сборках (совпадает версия игры) и копирует их вместо повторного скачивания.\n\n' +
      '3) РЕДАКТИРОВАНИЕ СБОРКИ\nКнопка «Изменить» в шапке сборки: переименуйте её, смените готовую иконку или загрузите свою картинку.\n\n' +
      '4) НОВОСТИ ПО ДАТЕ\nСвежие новости сверху. В Java-ленте — новые версии игры и снапшоты.',
    '3.0.1': '3.0.1 — умная диагностика и понятные версии модов.\n\n' +
      '1) УМНЫЙ АНАЛИЗ ОШИБОК ЗАПУСКА\n' +
      'Если игра не запустилась, лаунчер теперь разбирает краш-отчёт глубоко и показывает РЕАЛЬНУЮ причину: какой мод виноват, с чем конфликтует и что именно сломалось. И главное — блок «КАК ИСПРАВИТЬ» с конкретными шагами.\n\n' +
      '2) ТИПЫ ВЕРСИЙ МОДОВ\n' +
      'У версий модов появились цветные метки: зелёный РЕЛИЗ, оранжевый БЕТА, синий АЛЬФА. Сначала показываются релизы, потом беты, потом альфы.\n\n' +
      '3) ПРЕДУПРЕЖДЕНИЕ О НЕСТАБИЛЬНЫХ ВЕРСИЯХ\n' +
      'При установке беты или альфы лаунчер предупредит: такая версия может работать неисправно.\n\n' +
      '4) НОВОСТИ ПО КАТЕГОРИЯМ\n' +
      'Лента новостей: ЛАУНЧЕР + Java + Bedrock с фильтрами.',
    '3.0.0': '3.0.0 — большая версия на собственных файлах.\n\n' +
      '1) СВОЙ ШРИФТ\n' +
      'Лаунчер больше не использует шрифты Mojang. Поставлен свободный пиксельный шрифт (лицензия OFL) в том же стиле — вид тот же, но без чужих файлов.\n\n' +
      '2) НОВОСТИ И «ЧТО НОВОГО!» — С GITHUB\n' +
      'Окно «Что нового!» и новости лаунчера теперь приходят из репозитория. Текст обновляется без переустановки лаунчера.\n\n' +
      '3) УМНОЕ ЗЕРКАЛО СКАЧИВАНИЯ\n' +
      'Раньше если у зеркала (Mojang или BMCLAPI) не было файла, игра не запускалась с ошибкой 404. Теперь лаунчер сам пробует другое зеркало — автоматически, без ваших действий.\n\n' +
      '4) ОБЩИЙ КЭШ ВЕРСИЙ FORGE/NEOFORGE\n' +
      'Патченный клиент устанавливается один раз в общий кэш, а новые сборки той же версии просто копируют готовый. Создание сборок стало намного быстрее.\n\n' +
      '5) ИМПОРТ МОДПАКОВ .mrpack (Modrinth)\n' +
      'В окне импорта сборки можно выбрать файл .mrpack — лаунчер сам определит версию игры и лоадер, создаст сборку, скачает моды и разложит конфиги.\n\n' +
      '6) МЕЛОЧИ\n' +
      'В шапке показывается реальная версия лаунчера вместо «v0.1.0».',
    '0.2.10': 'В этом обновлении мы починили главную боль — скачивание файлов игры.\n\n' +
      '1) УМНОЕ ЗЕРКАЛО СКАЧИВАНИЯ\n' +
      'Раньше если у зеркала (Mojang или BMCLAPI) не было файла, игра не запускалась с ошибкой 404. Теперь лаунчер сам пробует другое зеркало — автоматически, без ваших действий. Если скачать всё равно не вышло, лаунчер проверит интернет и подскажет, что делать: поставить зеркало «Авто» в настройках или включить интернет.\n\n' +
      '2) ОБЩИЙ КЭШ ВЕРСИЙ FORGE/NEOFORGE\n' +
      'Раньше каждая новая сборка заново скачивала и устанавливала патченный клиент — это долго. Теперь установка происходит один раз в общий кэш, а новые сборки той же версии просто копируют готовый клиент. Создание сборок стало намного быстрее.\n\n' +
      '3) ИМПОРТ МОДПАКОВ .mrpack (Modrinth)\n' +
      'В окне импорта сборки можно выбрать файл .mrpack. Лаунчер сам определит версию игры и лоадер (Fabric/Quilt/Forge/NeoForge), создаст сборку, скачает все моды и разложит конфиги (overrides).\n\n' +
      '4) МЕЛОЧИ\n' +
      'В шапке теперь показывается реальная версия лаунчера вместо старой надписи «v0.1.0».'
  };
  // Показывает окно «Что нового!» один раз для каждой новой версии
  function maybeShowNews(version) {
    if (!version) return;
    let seen = '';
    try { seen = localStorage.getItem('newsSeenVersion') || ''; } catch (e) {}
    if (seen === version) return;
    const fallback = NEWS_NOTES[version] || ('Лаунчер обновлён до версии ' + version + '.');
    const show = (text) => {
      openModal('Что нового!', `
        <div class="upd-box">
          <div class="upd-text" style="font-size:14px;line-height:1.8;white-space:pre-line;text-align:left">${escapeHtml(text)}</div>
          <button class="secondary-btn" style="margin-top:12px;width:100%" id="newsOkBtn">ПОНЯТНО</button>
        </div>
      `, false, () => {
        // компактная ширина под текст новостей + запрет inline onclick по CSP — вешаем обработчик явно
        const mbx = modal.querySelector('.modal');
        if (mbx) mbx.style.width = '600px';
        const nb = $('#newsOkBtn');
        if (nb) nb.addEventListener('click', () => modal && modal.classList.remove('show'));
      });
      try { localStorage.setItem('newsSeenVersion', version); } catch (e) {}
    };
    // Сначала пробуем свежий текст с GitHub, при любой ошибке — локальный
    fetch(WHATSNEW_URL)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(j => show((j && j[version]) ? j[version] : fallback))
      .catch(() => show(fallback));
  }

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
        if (STATE.running) {
          api.invoke('launch:stop');
          return;
        }
        applyVersion(btn.dataset.v);
        $('#versionDropdown').innerHTML = '&#9662; ' + btn.dataset.v;
        startLaunch();
      });
    });
    syncPlayButtons();
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
  const CAT_LABEL = { launcher: 'ЛАУНЧЕР', java: 'JAVA', bedrock: 'BEDROCK' };
  // даты в формате DD.MM.YYYY — свежие сверху
  function sortByDateDesc(arr) {
    const ts = (d) => {
      const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(String(d || ''));
      return m ? +m[3] * 1e4 + +m[2] * 100 + +m[1] : 0;
    };
    return (arr || []).slice().sort((a, b) => ts(b.date) - ts(a.date));
  }
  function buildNews() {
    const mk = (n, i) => {
      const isArr = Array.isArray(n);
      const title = escapeHtml(isArr ? n[0] : (n.title || ''));
      const desc = escapeHtml(isArr ? (n[1] || '') : (n.desc || ''));
      const date = isArr ? n[2] : (n.date || '');
      const img = !isArr && n.images && n.images[0] ? n.images[0] : '';
      const icon = isArr && n[3] ? n[3] : NEWS_ICONS[i % NEWS_ICONS.length];
      const idx = isArr ? -1 : i;
      const cat = !isArr && n.category ? `<span class="news-cat ${escapeHtml(n.category)}">${CAT_LABEL[n.category] || escapeHtml(n.category)}</span>` : '';
      const thumb = img
        ? `<div class="news-thumb" style="background-image:url('${img}')"></div>`
        : `<div class="news-thumb" style="background-image:url('${ic(icon)}')"></div>`;
      return `
      <div class="news-item" data-idx="${idx}">
        ${thumb}
        <div>
          <h4>${title}${cat}</h4>
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
    const full = $('#newsFullList');
    const filters = $('#newsFilters');
    const state = { all: [], launcher: [], java: [], bedrock: [] };
    let cur = 'all';
    const render = () => wire(full, state[cur] || []);
    api.invoke('news:fetch').then(data => {
      const l = (data && Array.isArray(data.launcher)) ? data.launcher : [];
      const jv = (data && Array.isArray(data.java)) ? data.java : [];
      const bd = (data && Array.isArray(data.bedrock)) ? data.bedrock : [];
      state.launcher = sortByDateDesc(l);
      state.java = sortByDateDesc(jv);
      state.bedrock = sortByDateDesc(bd);
      const jvKeys = new Set(state.java.map(x => x.title));
      // общая лента — строго по дате (свежие сверху)
      state.all = sortByDateDesc(state.launcher.concat(state.java).concat(state.bedrock.filter(x => !jvKeys.has(x.title))));
      render();
    }).catch(() => {
      state.all = NEWS;
      state.launcher = NEWS;
      render();
    });
    if (filters) filters.querySelectorAll('.nf-btn').forEach(b => b.addEventListener('click', () => {
      filters.querySelectorAll('.nf-btn').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      cur = b.dataset.f;
      render();
    }));
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
    openModal('НОВОСТЬ', html, false, () => {
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
    });
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

  /* ===== Модалка (с очередью: если уже открыта — покажем следующую после закрытия) ===== */
  const modalQueue = [];
  function openModal(title, bodyHtml, wide, onShow) {
    if (!modal) return;
    if (modal.classList.contains('show')) {
      modalQueue.push({ title, bodyHtml, wide, onShow });
      return;
    }
    doOpenModal(title, bodyHtml, wide);
    if (onShow) onShow();
  }
  function doOpenModal(title, bodyHtml, wide) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHtml;
    const mb = modal.querySelector('.modal');
    if (mb) {
      mb.style.width = ''; // сбрасываем инлайн-ширину (например, от окна новостей)
      mb.classList.toggle('wide', !!wide);
    }
    modal.classList.remove('show');
    void modal.offsetWidth;
    modal.classList.add('show');
    const ram = $('#ramSlider');
    if (ram) {
      ram.addEventListener('input', () => { $('#ramValue').textContent = ram.value + ' GB'; });
    }
  }
  new MutationObserver(() => {
    if (!modal.classList.contains('show') && modalQueue.length) {
      const next = modalQueue.shift();
      doOpenModal(next.title, next.bodyHtml, next.wide);
      if (next.onShow) next.onShow();
    }
  }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  window.mcModalClose = () => modal && modal.classList.remove('show');
  window.mcToast = (msg) => setStatus(String(msg).toUpperCase(), 'busy');
  $('#modalClose').addEventListener('click', () => modal.classList.remove('show'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });
  $('#optionsBtn').addEventListener('click', () => {
    openModal('Настройки запуска', `
      <div class="set-row"><div><div class="s-label">ПАМЯТЬ (RAM)</div><div class="s-desc">Выделенная память для игры (макс. ${settingsCache.totalRam} GB — реальная)</div></div><input type="range" id="ramSlider" min="1" max="${settingsCache.totalRam}" step="1" value="${safeRam(settingsCache.ram)}"/><div class="s-value" id="ramValue">${safeRam(settingsCache.ram)} GB</div></div>
      <div class="set-row"><div><div class="s-label">ИМЯ</div><div class="s-desc">Оффлайн-аккаунт</div></div><input type="text" id="mNick" value="${escapeHtml(settingsCache.username)}" style="background:var(--mc-grey-5);border:2px solid var(--mc-off-black);color:var(--mc-off-white);padding:6px 10px;font-family:var(--mc-font);font-size:12px;width:160px"/></div>
      <button class="secondary-btn" style="margin-top:4px" id="mDoneBtn">ГОТОВО</button>
    `, false, () => {
      const doneBtn = $('#mDoneBtn');
      if (doneBtn) doneBtn.addEventListener('click', () => modal.classList.remove('show'));
      const ram = $('#ramSlider');
      if (ram) ram.addEventListener('input', () => {
        const v = safeRam(ram.value);
        ram.value = v;
        $('#ramValue').textContent = v + ' GB';
        settingsCache.ram = v;
        api.invoke('settings:set', 'ram', v);
      });
      const nick = $('#mNick');
      if (nick) nick.addEventListener('change', (e) => {
        const v = (e.target.value || 'Player').trim() || 'Player';
        settingsCache.username = v;
        api.invoke('settings:set', 'username', v);
      });
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
    if (busy) {
      launchPanel.classList.add('show');
      lpFill.style.width = '0%';
      lpPct.textContent = '0%';
      lpLog.innerHTML = '';
    }
    syncPlayButtons();
  }

  // Одна кнопка запуска/остановки во всех местах (Играть, Сборки, Версии),
  // чтобы «ОСТАНОВИТЬ» не улетала на другую вкладку
  function syncPlayButtons() {
    const running = !!STATE.running;
    const launching = !!STATE.launching;
    playBtn.classList.toggle('busy', launching);
    playBtn.classList.toggle('running', running);
    playBtn.innerHTML = running ? '&#9726; ОСТАНОВИТЬ' : (launching ? '&#9696; ЗАПУСК...' : '&#9654; PLAY');
    const bp = $('#bdPlay');
    if (bp) {
      bp.classList.toggle('busy', launching);
      bp.innerHTML = running ? '&#9726; ОСТАНОВИТЬ' : (launching ? '&#9696; ЗАПУСК...' : '&#9654; ИГРАТЬ');
    }
    $$('#versionsList .v-play').forEach(b => {
      b.innerHTML = running ? '&#9726; ОСТАНОВИТЬ' : (launching ? '&#9696; ЗАПУСК...' : '&#9654; ИГРАТЬ');
    });
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
    STATE.running = false;
    launchPanel.classList.remove('show');
    syncPlayButtons();
    setStatus('ОШИБКА: ' + (data && data.message || 'неизвестно'), 'busy');
    addLog('> ОШИБКА: ' + (data && data.message));
  });
  api.on('launch:started', (data) => {
    setLaunching(false);
    STATE.running = true;
    syncPlayButtons();
    setStatus('ИГРА ЗАПУЩЕНА (PID ' + data.pid + ')', 'running');
    lpStage.textContent = 'В ИГРЕ';
    lpPct.textContent = '100%';
  });
  api.on('launch:exit', () => {
    STATE.running = false;
    launchPanel.classList.remove('show');
    syncPlayButtons();
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
    corrupt:         { label: 'ПОВРЕЖДЁННЫЙ ФАЙЛ', color: '#d8a03a' },
    natives:         { label: 'ПОВРЕЖДЁННЫЕ БИБЛИОТЕКИ', color: '#d8a03a' },
    mod_conflict:    { label: 'КОНФЛИКТ МОДОВ', color: '#ca3636' }
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
          <div style="font-family:var(--mc-font-body);font-size:11px;color:var(--mc-grey-2);margin-top:3px;line-height:1.45">${escapeHtml(p.detail)}</div>
          ${p.fix ? `<div style="border-left:3px solid var(--mc-green-4);background:rgba(60,133,39,.12);padding:7px 10px;margin-top:8px;font-family:var(--mc-font-body);font-size:11px;color:var(--mc-grey-1);line-height:1.5"><span style="color:var(--mc-green-2);font-weight:600">КАК ИСПРАВИТЬ:</span> ${escapeHtml(p.fix)}</div>` : ''}`;
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
    html += `<button class="play-btn" id="diagAutoFix" style="margin-top:8px;width:100%;font-size:14px">&#9881; СДЕЛАТЬ ВСЁ АВТОМАТИЧЕСКИ</button>`;
    html += `<button class="secondary-btn" id="diagClose" style="margin-top:8px;width:100%">\u0417\u0410\u041a\u0420\u042b\u0422\u042c</button>`;
    openModal('\u041f\u0420\u041e\u0411\u041b\u0415\u041c\u0410 \u041f\u0420\u0418 \u0417\u0410\u041f\u0423\u0421\u041a\u0415', html, true, () => {
    const mb = modal.querySelector('.modal');
    if (mb) mb.classList.add('wide');
    const afBtn = $('#diagAutoFix');
    if (afBtn) afBtn.addEventListener('click', () => runDiagAutofix(report));
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
    const dc = $('#diagClose');
    if (dc) dc.addEventListener('click', () => {
      modal.classList.remove('show');
      api.invoke('diagnosis:clear').catch(() => {});
    });
  }); // onShow
  }
  api.on('launch:diagnosis', (report) => showDiagnostics(report));

  /* ===== Сборки (экспериментально) ===== */
  const buildsNav = $('#buildsNav');
  const buildsNavIcon = $('#buildsNavIcon');
  if (buildsNavIcon) buildsNavIcon.src = ic('Grass.png');

  // Автопочинка по отчёту диагностики: зависимости, Java, кэш нативов.
  // Удаление модов — ТОЛЬКО с явного согласия пользователя
  function runDiagAutofix(report) {
    openModal('АВТОПОЧИНКА', `
      <div class="mig-prog">
        <div class="lp-bar"><div class="fill" id="afFill" style="width:0%"></div></div>
        <div id="afStage" style="font-family:var(--mc-font-body);font-size:10.5px;color:var(--mc-grey-3);margin-top:8px">Выполняю...</div>
      </div>
    `, true);
    const off = api.on('diag:autofix-progress', p => {
      const f = $('#afFill'), s = $('#afStage');
      if (f) f.style.width = Math.round((p.frac || 0) * 100) + '%';
      if (s && p.stage) s.textContent = p.stage;
    });
    api.invoke('diag:autofix', { buildId: report.buildId, problems: report.problems })
      .then(res => {
        off();
        const acts = res.actions || [];
        const nc = res.needConsent || [];
        const consentHtml = nc.length ? `
          <div style="margin-top:10px;color:#f0b90b;font-weight:600;font-family:var(--mc-font-body);font-size:11.5px">Обнаружены конфликты модов. Отметьте, какие УДАЛИТЬ (ничего не удаляется без вашего согласия):</div>
          <div style="max-height:150px;overflow:auto;background:var(--mc-grey-5);border-radius:4px;padding:8px;margin-top:6px;display:flex;flex-direction:column;gap:4px">
            ${nc.map(c2 => `<label style="display:flex;gap:8px;align-items:center;font-family:var(--mc-font-body);font-size:11px;color:var(--mc-off-white)"><input type="checkbox" class="afDel" data-slug="${escapeHtml(c2.slug)}" style="accent-color:#ca3636"/> ${escapeHtml(c2.slug)} <span style="color:var(--mc-grey-3)">(ломает ${escapeHtml(c2.breaks)})</span></label>`).join('')}
          </div>` : '';
        openModal('АВТОПОЧИНКА ЗАВЕРШЕНА', `
          <div style="font-family:var(--mc-font-body);font-size:11.5px;line-height:1.6;color:var(--mc-grey-2)">
            ${acts.length ? acts.map(a => '✓ ' + escapeHtml(a)).join('<br/>') : 'Действий не потребовалось.'}
            ${consentHtml}
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            ${nc.length ? '<button class="secondary-btn" id="afDelBtn" style="margin:0;flex:1;color:#ca3636">УДАЛИТЬ ОТМЕЧЕННЫЕ</button>' : ''}
            <button class="play-btn" id="afDone" style="margin:0;flex:1;font-size:14px">ГОТОВО</button>
          </div>
        `, false, () => {
          const d = $('#afDone');
          if (d) d.addEventListener('click', () => modal.classList.remove('show'));
          const del = $('#afDelBtn');
          if (del) del.addEventListener('click', () => {
            const rm = Array.from(document.querySelectorAll('.afDel:checked')).map(c => c.dataset.slug);
            modal.classList.remove('show');
            if (rm.length && report.buildId) {
              (async () => {
                let inst = null;
                try { inst = await api.invoke('builds:installed', report.buildId); } catch (e) {}
                const files = (inst && inst.files) || inst || [];
                for (const s of rm) {
                  const entry = files.find(x => x.slug === s);
                  if (entry && entry.filename) {
                    try { await api.invoke('builds:delete-mod', report.buildId, entry.filename, 'mod'); } catch (e) {}
                  }
                }
                mcToast('УДАЛЕНО: ' + rm.length);
                refreshBuilds();
              })();
            }
          });
        });
      })
      .catch(err => {
        off();
        modal.classList.remove('show');
        mcToast('ОШИБКА АВТОПОЧИНКИ: ' + (err.message || err));
      });
  }

  function showBuildsTab(on) {
    if (buildsNav) buildsNav.style.display = on ? '' : 'none';
  }

  let BUILD_LIST = [];
  let CURRENT_BUILD = null;
  let B_OFFSET = 0;
  let B_CAT = null;
  const CAT_CACHE = {}; // кэш результатов поиска Modrinth (по ключу запроса)
  const B_TYPES = [['mod', 'МОДЫ'], ['resourcepack', 'РЕСУРСПАКИ'], ['shaderpack', 'ШЕЙДЕРЫ'], ['modpack', 'МОДПАКИ']];
  let B_TYPE = 'mod';
  let MP_LOADER = '';
  let MP_VERSION = '';
  let MP_VERSIONS_FILLED = false;
  let INST_QUERY = '';
  // Кэш названий/иконок модов с Modrinth (по slug) — чтобы не дёргать API на каждом рендере
  const instInfoCache = {};

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
    // Предупреждение: у сборки случайная/стандартная иконка — при импорте
    // у друга будет серая обложка (иконка не переносится как файл мода)
    if (String(CURRENT_BUILD.icon || '').indexOf('data:') !== 0) {
      openModal('Иконка сборки', `
        <div style="font-family:var(--mc-font-body);font-size:12px;line-height:1.6;color:var(--mc-grey-2)">
          У сборки «${escapeHtml(CURRENT_BUILD.name)}» стоит <b>случайная иконка</b>.
          После импорта на другом компьютере обложки не будет — поставьте свою картинку
          через ✎ ИЗМЕНИТЬ → СВОЯ ИКОНКА, либо мы попробуем найти обложку по названию автоматически.
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="secondary-btn" id="expIconCancel" style="margin:0;flex:1">ОТМЕНА</button>
          <button class="play-btn" id="expIconGo" style="margin:0;flex:1;font-size:14px">ЭКСПОРТИРОВАТЬ</button>
        </div>
      `, false, () => {
        const cc = $('#expIconCancel');
        const gg = $('#expIconGo');
        if (cc) cc.addEventListener('click', () => modal.classList.remove('show'));
        if (gg) gg.addEventListener('click', () => { modal.classList.remove('show'); doExport(); });
      });
      return;
    }
    doExport();
  }

  async function doExport() {
    const res = await api.invoke('builds:export', CURRENT_BUILD.id);
    if (res.canceled) return;
    if (!res.ok) {
      openModal('Ошибка экспорта', `
        <div style="color:var(--mc-default-warning,#ca3636);font-family:var(--mc-font-body);font-size:11px">${escapeHtml(res.error || 'Неизвестная ошибка')}</div>
        <button class="secondary-btn" style="margin-top:10px;width:100%" id="expErrBtn">ОК</button>
      `, false, () => {
        const eb = $('#expErrBtn');
        if (eb) eb.addEventListener('click', () => modal.classList.remove('show'));
      });
      return;
    }
    if (res.skipped && res.skipped.length) {
      openModal('Экспорт завершён', `
        <div style="font-family:var(--mc-font-body);font-size:11px;color:var(--mc-grey-2);line-height:1.5">
          Файл: ${escapeHtml(res.path)}<br>
          <span style="color:var(--mc-default-warning,#ca3636)">Пропущено модов (не найдены на Modrinth): ${res.skipped.length}</span><br>
          ${res.skipped.map(s => '&#8226; ' + escapeHtml(s)).join('<br>')}
        </div>
        <button class="secondary-btn" style="margin-top:10px;width:100%" id="expSkipBtn">ПОНЯТНО</button>
      `, false, () => {
        const sb = $('#expSkipBtn');
        if (sb) sb.addEventListener('click', () => modal.classList.remove('show'));
      });
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
      // Иконка по названию: если у импортированной сборки случайная иконка —
      // ищем модпак с тем же названием в каталоге и ставим его обложку
      if (res.buildId) {
        api.invoke('builds:set-icon-by-name', { buildId: res.buildId, name: res.name || '' })
          .then(b => { if (b && b.icon) refreshBuilds(); })
          .catch(() => {});
      }
      setTimeout(() => modal && modal.classList.remove('show'), 500);
    } else {
      openModal('Ошибка импорта', `
        <div style="color:var(--mc-default-warning,#ca3636);font-family:var(--mc-font-body);font-size:11px">${escapeHtml(res.error || 'Неизвестная ошибка')}</div>
        <button class="secondary-btn" style="margin-top:10px;width:100%" id="impErrBtn">ОК</button>
      `, false, () => {
        const ib = $('#impErrBtn');
        if (ib) ib.addEventListener('click', () => modal.classList.remove('show'));
      });
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
        <div class="bd-actions">
          <button class="b-mini play" id="bdEdit" title="Изменить название и иконку">&#9998; ИЗМЕНИТЬ</button>
          <button class="b-mini" id="bdMigrate" title="Перенести сборку на другую версию Minecraft">&#8646; ПЕРЕНЕСТИ</button>
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
    $('#bdPlay').addEventListener('click', () => {
      if (STATE.running) {
        api.invoke('launch:stop');
        return;
      }
      launchBuild(b);
    });
    syncPlayButtons();
    const be = $('#bdEdit');
    if (be) be.addEventListener('click', () => openEditBuildModal(b));
    const bm = $('#bdMigrate');
    if (bm) bm.addEventListener('click', () => openMigrateModal(b));
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

  // Редактирование сборки: название и иконка
  function openEditBuildModal(b) {
    openModal('ИЗМЕНИТЬ СБОРКУ', `
      <div class="set-row"><div><div class="s-label">НАЗВАНИЕ</div><div class="s-desc">Как сборка называется в списке</div></div>
        <input id="ebName" value="${escapeHtml(b.name || '')}" maxlength="48" style="background:var(--mc-grey-5);border:2px solid var(--mc-off-black);color:var(--mc-off-white);padding:7px 10px;font-family:var(--mc-font);font-size:12px;outline:none;width:220px"/>
      </div>
      <div class="set-row"><div><div class="s-label">ИКОНКА</div><div class="s-desc">Выберите из готовых или загрузите свою</div></div><div id="ebIconPick" style="display:flex;flex-wrap:wrap;gap:4px;max-width:240px"></div></div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
        <img id="ebCustomPrev" src="" alt="" style="display:none;width:44px;height:44px;image-rendering:auto;background:var(--mc-grey-5);border:2px solid var(--mc-green-4)"/>
        <button class="b-mini" id="ebCustomBtn" style="padding:8px 12px">&#128247; СВОЯ ИКОНКА</button>
        <input type="file" id="ebCustomFile" accept="image/png,image/jpeg,image/webp" style="display:none"/>
        <span id="ebCustomHint" style="font-family:var(--mc-font-body);font-size:10.5px;color:var(--mc-grey-3)">PNG/JPG, до ~400 КБ</span>
      </div>
      <button class="play-btn" id="ebSave" style="font-size:14px;margin-top:14px;width:100%;letter-spacing:.1em">СОХРАНИТЬ</button>
    `, false, () => {
      const mb = modal.querySelector('.modal');
      if (mb) mb.style.width = '560px';
      let pickedIcon = b.icon || 'Grass.png';
      let customIcon = null; // dataURL своей иконки
      const pick = $('#ebIconPick');
      const iconNames = Object.keys(typeof __I !== 'undefined' ? __I : {});
      if (pick && iconNames.length) {
        pick.innerHTML = '';
        iconNames.forEach(name => {
          const img = document.createElement('img');
          img.src = ic(name);
          img.style.cssText = 'width:34px;height:34px;image-rendering:pixelated;background:var(--mc-grey-5);border:2px solid ' + (!customIcon && name === pickedIcon ? 'var(--mc-green-4)' : 'var(--mc-off-black)') + ';cursor:pointer';
          img.addEventListener('click', () => {
            pickedIcon = name;
            customIcon = null;
            const prev = $('#ebCustomPrev');
            if (prev) { prev.style.display = 'none'; prev.src = ''; }
            pick.querySelectorAll('img').forEach(i => i.style.borderColor = 'var(--mc-off-black)');
            img.style.borderColor = 'var(--mc-green-4)';
          });
          pick.appendChild(img);
        });
      }
      const fileInput = $('#ebCustomFile');
      const cb = $('#ebCustomBtn');
      if (cb && fileInput) {
        cb.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
          const f = fileInput.files && fileInput.files[0];
          if (!f) return;
          if (f.size > 400 * 1024) { setStatus('ИКОНКА СЛИШКОМ БОЛЬШАЯ (ДО 400 КБ)', 'busy'); return; }
          const rd = new FileReader();
          rd.onload = () => {
            customIcon = String(rd.result || '');
            pickedIcon = null;
            const prev = $('#ebCustomPrev');
            if (prev) { prev.src = customIcon; prev.style.display = ''; }
            if (pick) pick.querySelectorAll('img').forEach(i => i.style.borderColor = 'var(--mc-off-black)');
            setStatus('СВОЯ ИКОНКА ВЫБРАНА', '');
          };
          rd.readAsDataURL(f);
        });
      }
      const btn = $('#ebSave');
      if (btn) btn.addEventListener('click', () => {
        const name = ($('#ebName').value || '').trim();
        if (!name) { setStatus('ВВЕДИТЕ НАЗВАНИЕ', 'busy'); return; }
        const icon = customIcon || pickedIcon || b.icon;
        btn.disabled = true;
        btn.textContent = 'СОХРАНЕНИЕ...';
        api.invoke('builds:update-meta', b.id, { name, icon }).then(nb => {
          modal.classList.remove('show');
          setStatus('СБОРКА ОБНОВЛЕНА: ' + nb.name, '');
          refreshBuilds().then(() => selectBuild(b.id));
        }).catch(err => {
          setStatus('ОШИБКА: ' + (err.message || err), 'busy');
          btn.disabled = false;
          btn.textContent = 'СОХРАНИТЬ';
        });
      });
    });
  }

  // ===== ПЕРЕНОС СБОРКИ на другую версию Minecraft =====
  function openMigrateModal(b) {
    const releases = (Array.isArray(VERSION_LIST) ? VERSION_LIST : []).filter(v => v.type === 'release').slice(0, 60);
    openModal('ПЕРЕНОС СБОРКИ', `
      <div class="mig-head">
        <img src="${ic(b.icon || 'Grass.png')}" alt=""/>
        <div>
          <div class="mig-t">${escapeHtml(b.name)}</div>
          <div class="mig-s">Сейчас: ${escapeHtml(b.gameVersion)} &middot; ${escapeHtml(b.loader)} &middot; ${b.modCount || 0} модов</div>
        </div>
      </div>
      <div style="font-family:var(--mc-font-body);font-size:11.5px;color:var(--mc-grey-2);line-height:1.55;margin-bottom:10px">
        Будет создана <b>новая сборка</b> под выбранную версию — текущая останется нетронутой.
        Лаунчер проверит каждый мод и найдёт его версию под новую игру. Моды, которых нет — будут перечислены в конце.
      </div>
      <div class="set-row"><div class="s-label">ЦЕЛЕВАЯ ВЕРСИЯ MINECRAFT</div>
        <select id="migVersion" style="background:var(--mc-grey-5);border:2px solid var(--mc-off-black);color:var(--mc-off-white);padding:8px 9px;font-family:var(--mc-font);font-size:12px;outline:none;width:220px">
          ${releases.map(v => `<option value="${escapeHtml(v.id)}"${v.id === b.gameVersion ? ' selected' : ''}>${escapeHtml(v.id)}</option>`).join('')}
        </select>
      </div>
      <div class="set-row"><div class="s-label">МИРЫ И НАСТРОЙКИ</div><div class="s-desc">Перенести сохранения, конфиги и ресурспаки</div>
        <input type="checkbox" id="migData" checked style="width:18px;height:18px;accent-color:var(--mc-green)"/>
      </div>
      <button class="play-btn" id="migGo" style="width:100%;margin-top:10px;font-size:14px">ПОДТВЕРДИТЬ ПЕРЕНОС</button>
    `, false, () => {
      const go = $('#migGo');
      if (go) go.addEventListener('click', () => {
        const tv = $('#migVersion').value;
        const wd = $('#migData').checked;
        modal.classList.remove('show');
        runMigrate(b, tv, wd);
      });
    });
  }

  function runMigrate(b, targetVersion, withData) {
    openModal('ПЕРЕНОС СБОРКИ', `
      <div class="mig-prog">
        <div class="mp-lbl">АНАЛИЗ МОДОВ</div>
        <div class="lp-bar alt"><div class="fill" id="migA" style="width:0%"></div></div>
        <div class="mp-lbl">ОБЩИЙ ПРОГРЕСС</div>
        <div class="lp-bar"><div class="fill" id="migO" style="width:0%"></div></div>
        <div id="migStage" style="font-family:var(--mc-font-body);font-size:10.5px;color:var(--mc-grey-3);margin-top:8px">Подготовка...</div>
      </div>
    `, true);
    const off = api.on('builds:migrate-progress', p => {
      const a = $('#migA'), o = $('#migO'), s = $('#migStage');
      if (a) a.style.width = Math.round((p.analysis || 0) * 100) + '%';
      if (o) o.style.width = Math.round((p.overall || 0) * 100) + '%';
      if (s && p.stage) s.textContent = p.stage;
    });
    api.invoke('builds:migrate', { buildId: b.id, targetVersion, withData })
      .then(res => {
        off();
        modal.classList.remove('show');
        refreshBuilds();
        const miss = res.missing || [];
        // ID модов -> человекочитаемые названия
        const ids = [...new Set(miss)].filter(x => !/\.(jar|zip)$/i.test(x));
        api.invoke('modrinth:batch-projects', ids).then(projs => {
          const T = {};
          (projs || []).forEach(pp => { if (pp && pp.id) T[pp.id] = pp.title || pp.slug; });
          const nm = x => T[x] || x;
          openModal('ПЕРЕНОС ЗАВЕРШЁН', `
          <div style="font-family:var(--mc-font-body);font-size:12px;line-height:1.6;color:var(--mc-grey-2)">
            ${res.moved} из ${res.total} модов перенесены на ${escapeHtml(targetVersion)}.
            ${miss.length ? `<div style="margin-top:10px;color:#f0b90b;font-weight:600">Не нашлись под эту версию (${miss.length}):</div>
            <div style="max-height:180px;overflow:auto;background:var(--mc-grey-5);border-radius:4px;padding:8px;margin-top:6px;font-size:11px">${miss.map(m2 => '• ' + escapeHtml(nm(m2))).join('<br/>')}</div>` : '<div style="margin-top:8px;color:var(--mc-green)">Все моды нашлись! 🎉</div>'}
          </div>
          <button class="play-btn" id="migDone" style="width:100%;margin-top:12px;font-size:14px">ГОТОВО</button>
        `, false, () => {
            const d = $('#migDone');
            if (d) d.addEventListener('click', () => modal.classList.remove('show'));
          });
        }).catch(() => {
          openModal('ПЕРЕНОС ЗАВЕРШЁН', `<div style="font-family:var(--mc-font-body);font-size:12px;color:var(--mc-grey-2)">${res.moved} из ${res.total} модов перенесены.</div>
            <button class="play-btn" id="migDone" style="width:100%;margin-top:12px">ГОТОВО</button>`, false, () => {
            const d = $('#migDone');
            if (d) d.addEventListener('click', () => modal.classList.remove('show'));
          });
        });
      })
      .catch(err => {
        off();
        modal.classList.remove('show');
        openModal('Ошибка переноса', `<div style="color:#ca3636;font-family:var(--mc-font-body);font-size:12px">${escapeHtml(err.message || String(err))}</div>
          <button class="secondary-btn" id="migErr" style="width:100%;margin-top:10px">ОК</button>`, false, () => {
          const x = $('#migErr');
          if (x) x.addEventListener('click', () => modal.classList.remove('show'));
        });
      });
  }

  // ===== ОБЪЕДИНЕНИЕ СБОРОК =====
  function openMergeModal() {
    if (BUILD_LIST.length < 2) { mcToast('НУЖНО МИНИМУМ ДВЕ СБОРКИ'); return; }
    const releases = (Array.isArray(VERSION_LIST) ? VERSION_LIST : []).filter(v => v.type === 'release').slice(0, 60);
    openModal('ОБЪЕДИНЕНИЕ СБОРКИ', `
      <div style="font-family:var(--mc-font-body);font-size:11.5px;color:var(--mc-grey-2);line-height:1.55;margin-bottom:10px">
        Выберите <b>две или более</b> сборок — из их модов будет создана новая сборка.
        Загрузчик берётся от первой выбранной. Повторяющиеся моды покажем в конце.
      </div>
      <div id="mrgList" style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow:auto;margin-bottom:10px">
        ${BUILD_LIST.map((b, i) => `
          <label style="display:flex;align-items:center;gap:10px;background:var(--mc-grey-5);border:2px solid var(--mc-off-black);border-radius:4px;padding:8px 10px;cursor:pointer">
            <input type="checkbox" class="mrgChk" data-bid="${escapeHtml(b.id)}" data-gv="${escapeHtml(b.gameVersion)}" data-ld="${escapeHtml(b.loader)}" style="width:16px;height:16px;accent-color:var(--mc-green)"/>
            <img src="${ic(b.icon || 'Grass.png')}" style="width:26px;height:26px;image-rendering:pixelated;border-radius:3px" alt=""/>
            <span style="font-family:var(--mc-font-body);font-size:11.5px;color:var(--mc-off-white);flex:1">${escapeHtml(b.name)}</span>
            <span class="b-tag green">${escapeHtml(b.gameVersion)}</span>
            <span class="b-tag">${escapeHtml(b.loader)}</span>
          </label>`).join('')}
      </div>
      <div id="mrgWarn" style="display:none;font-family:var(--mc-font-body);font-size:11px;color:#f0b90b;background:rgba(240,185,11,.08);border:1px dashed rgba(240,185,11,.5);border-radius:4px;padding:7px 10px;margin-bottom:10px"></div>
      <div class="set-row"><div class="s-label">ОБЪЕДИНИТЬ ПОД ВЕРСИЮ</div>
        <select id="mrgVersion" style="background:var(--mc-grey-5);border:2px solid var(--mc-off-black);color:var(--mc-off-white);padding:8px 9px;font-family:var(--mc-font);font-size:12px;outline:none;width:200px">
          ${releases.map(v => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.id)}</option>`).join('')}
        </select>
      </div>
      <div class="set-row"><div class="s-label">НАЗВАНИЕ</div>
        <input id="mrgName" placeholder="Моя объединённая сборка" maxlength="48" style="background:var(--mc-grey-5);border:2px solid var(--mc-off-black);color:var(--mc-off-white);padding:7px 10px;font-family:var(--mc-font);font-size:12px;outline:none;width:200px"/>
      </div>
      <div class="set-row"><div class="s-label">КОНФИГИ И РЕСУРСПАКИ</div><div class="s-desc">Из первой выбранной сборки</div>
        <input type="checkbox" id="mrgConfigs" style="width:18px;height:18px;accent-color:var(--mc-green)"/>
      </div>
      <button class="play-btn" id="mrgGo" style="width:100%;margin-top:10px;font-size:14px">ОБЪЕДИНИТЬ</button>
    `, false, () => {
      const warn = $('#mrgWarn');
      const checkWarn = () => {
        const sel = Array.from(document.querySelectorAll('.mrgChk:checked'));
        const gvs = [...new Set(sel.map(c => c.dataset.gv))];
        if (warn) {
          warn.style.display = gvs.length > 1 ? 'block' : 'none';
          if (gvs.length > 1) warn.textContent = 'У выбранных сборок разные версии игры (' + gvs.join(', ') + '). Постараемся найти моды под выбранную вами версию.';
        }
      };
      document.querySelectorAll('.mrgChk').forEach(c => c.addEventListener('change', checkWarn));
      const go = $('#mrgGo');
      if (go) go.addEventListener('click', () => {
        const sel = Array.from(document.querySelectorAll('.mrgChk:checked')).map(c => c.dataset.bid);
        if (sel.length < 2) { mcToast('ВЫБЕРИТЕ МИНИМУМ ДВЕ СБОРКИ'); return; }
        const tv = $('#mrgVersion').value;
        const nm = $('#mrgName').value.trim();
        const cfg = $('#mrgConfigs').checked;
        modal.classList.remove('show');
        runMerge(sel, tv, cfg, nm);
      });
    });
  }

  function runMerge(buildIds, targetVersion, withConfigs, name) {
    openModal('ОБЪЕДИНЕНИЕ СБОРКИ', `
      <div class="mig-prog">
        <div class="mp-lbl">АНАЛИЗ МОДОВ</div>
        <div class="lp-bar alt"><div class="fill" id="mrgA" style="width:0%"></div></div>
        <div class="mp-lbl">ОБЩИЙ ПРОГРЕСС</div>
        <div class="lp-bar"><div class="fill" id="mrgO" style="width:0%"></div></div>
        <div id="mrgStage" style="font-family:var(--mc-font-body);font-size:10.5px;color:var(--mc-grey-3);margin-top:8px">Подготовка...</div>
      </div>
    `, true);
    const off = api.on('builds:merge-progress', p => {
      const a = $('#mrgA'), o = $('#mrgO'), s = $('#mrgStage');
      if (a) a.style.width = Math.round((p.analysis || 0) * 100) + '%';
      if (o) o.style.width = Math.round((p.overall || 0) * 100) + '%';
      if (s && p.stage) s.textContent = p.stage;
    });
    api.invoke('builds:merge', { buildIds, targetVersion, withConfigs, name })
      .then(res => {
        off();
        modal.classList.remove('show');
        refreshBuilds();
        const dups = res.duplicates || [];
        const miss = res.missing || [];
        // ID модов -> человекочитаемые названия
        const allIds = [...new Set([...dups, ...miss])].filter(x => !/\.(jar|zip)$/i.test(x));
        api.invoke('modrinth:batch-projects', allIds).then(projs => {
          const T = {};
          (projs || []).forEach(pp => { if (pp && pp.id) T[pp.id] = pp.title || pp.slug; });
          const nm = x => T[x] || x;
          const dupsHtml = dups.length ? `
          <div style="margin-top:10px;color:#f0b90b;font-weight:600;font-family:var(--mc-font-body);font-size:11.5px">Повторяющиеся моды (были в нескольких сборках). Галочка = оставить в сборке:</div>
          <div style="max-height:160px;overflow:auto;background:var(--mc-grey-5);border-radius:4px;padding:8px;margin-top:6px;display:flex;flex-direction:column;gap:4px">
            ${dups.map(d => `<label style="display:flex;gap:8px;align-items:center;font-family:var(--mc-font-body);font-size:11px;color:var(--mc-off-white)"><input type="checkbox" class="dupChk" data-slug="${escapeHtml(d)}" checked style="accent-color:var(--mc-green)"/> ${escapeHtml(nm(d))}</label>`).join('')}
          </div>` : '';
          openModal('ОБЪЕДИНЕНИЕ ЗАВЕРШЕНО', `
          <div style="font-family:var(--mc-font-body);font-size:12px;line-height:1.6;color:var(--mc-grey-2)">
            Установлено ${res.total - miss.length} модов под ${escapeHtml(targetVersion)}.
            ${dupsHtml}
            ${miss.length ? `<div style="margin-top:10px;color:#f0b90b;font-weight:600">Не нашлись под эту версию (${miss.length}):</div>
            <div style="max-height:120px;overflow:auto;background:var(--mc-grey-5);border-radius:4px;padding:8px;margin-top:6px;font-size:11px">${miss.map(m2 => '• ' + escapeHtml(nm(m2))).join('<br/>')}</div>` : ''}
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            ${dups.length ? '<button class="secondary-btn" id="mrgCancelAll" style="margin:0;flex:1;color:#ca3636">ОТМЕНИТЬ ОБЪЕДИНЕНИЕ</button>' : ''}
            <button class="play-btn" id="mrgDone" style="margin:0;flex:1;font-size:14px">ГОТОВО</button>
          </div>
        `, false, () => {
            const done = $('#mrgDone');
            const cancel = $('#mrgCancelAll');
            if (done) done.addEventListener('click', () => {
              // снять галочку = удалить мод из объединённой сборки
              const rm = Array.from(document.querySelectorAll('.dupChk:not(:checked)')).map(c => c.dataset.slug);
              modal.classList.remove('show');
              if (rm.length) {
                (async () => {
                  let inst = null;
                  try { inst = await api.invoke('builds:installed', res.buildId); } catch (e) {}
                  const files = (inst && inst.files) || inst || [];
                  for (const s of rm) {
                    const entry = files.find(x => x.slug === s);
                    if (entry && entry.filename) {
                      try { await api.invoke('builds:delete-mod', res.buildId, entry.filename, 'mod'); } catch (e) {}
                    }
                  }
                  refreshBuilds();
                })();
              }
            });
            if (cancel) cancel.addEventListener('click', () => {
              modal.classList.remove('show');
              api.invoke('builds:delete', res.buildId).then(() => { refreshBuilds(); mcToast('ОБЪЕДИНЕНИЕ ОТМЕНЕНО'); }).catch(() => {});
            });
          });
        }).catch(() => {
          openModal('ОБЪЕДИНЕНИЕ ЗАВЕРШЕНО', `<div style="font-family:var(--mc-font-body);font-size:12px;color:var(--mc-grey-2)">Готово. Установлено ${res.total - miss.length} модов.</div>
            <button class="play-btn" id="mrgDone" style="width:100%;margin-top:12px">ГОТОВО</button>`, false, () => {
            const d = $('#mrgDone');
            if (d) d.addEventListener('click', () => modal.classList.remove('show'));
          });
        });
      })
      .catch(err => {
        off();
        modal.classList.remove('show');
        openModal('Ошибка объединения', `<div style="color:#ca3636;font-family:var(--mc-font-body);font-size:12px">${escapeHtml(err.message || String(err))}</div>
          <button class="secondary-btn" id="mrgErr" style="width:100%;margin-top:10px">ОК</button>`, false, () => {
          const x = $('#mrgErr');
          if (x) x.addEventListener('click', () => modal.classList.remove('show'));
        });
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
          <div class="b-mod" data-f="${filenameEsc}" data-slug="${escapeHtml(m.slug || '')}" style="${delay}">
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
        // клик по карточке → страница мода (название/фото берём из Modrinth)
        const slug = row.dataset.slug;
        if (slug) {
          row.classList.add('clickable');
          row.addEventListener('click', (e) => {
            if (e.target.closest('.bm-x')) return;
            const info = instInfoCache[slug];
            if (info && info.title) {
              openModPage({ slug, title: info.title, icon_url: info.icon_url || '', description: info.description || '', downloads: info.downloads || 0, categories: info.categories || [], project_type: info.project_type || '', btype: itemType({ project_type: info.project_type || '', btype: B_TYPE }) });
            }
          });
        }
      });
      // Асинхронно подменяем иконку и название на реальные с Modrinth
      list.forEach((m, i) => {
        if (!m.slug) return;
        const slug = m.slug;
        const row = box.querySelector('[data-slug="' + CSS.escape(slug) + '"]');
        const enrich = (info) => {
          if (!info || !row) return;
          instInfoCache[slug] = info;
          const img = row.querySelector('.b-mod-img img');
          if (img && info.icon_url) img.src = info.icon_url;
          const nm = row.querySelector('.bm-name');
          if (nm && info.title) {
            nm.textContent = info.title;
            nm.title = info.title;
          }
          if (INST_QUERY && info.title && !info.title.toLowerCase().includes(INST_QUERY)) row.style.display = 'none';
        };
        if (instInfoCache[slug]) { enrich(instInfoCache[slug]); return; }
        api.invoke('modrinth:project', slug).then(enrich).catch(() => {});
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
    const mpf = $('#mpFilters');
    if (mpf) {
      mpf.classList.toggle('hidden', B_TYPE !== 'modpack');
      const mv = $('#mpVersion');
      if (B_TYPE === 'modpack' && mv && typeof mv._fill === 'function') mv._fill();
    }
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
    if (B_TYPE === 'modpack') {
      // модпаки: без привязки к текущей сборке (пак сам несёт версию игры и лоадер)
      facets.push(['project_type:modpack']);
      if (MP_LOADER) facets.push(['categories:' + MP_LOADER]);
      if (MP_VERSION) facets.push(['versions:' + MP_VERSION]);
    } else {
      if (CURRENT_BUILD) {
        facets.push(['versions:' + CURRENT_BUILD.gameVersion]);
        if (B_TYPE === 'mod') facets.push(['categories:' + CURRENT_BUILD.loader.toLowerCase()]);
      }
      facets.push(['project_type:' + (B_TYPE === 'shaderpack' ? 'shader' : B_TYPE)]);
    }
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
      <div style="font-family:var(--mc-font);font-size:11px;letter-spacing:.08em;color:var(--mc-grey-3);margin:10px 0 6px">${B_TYPE === 'modpack' ? 'ВЕРСИИ МОДПАКА' : 'ВЕРСИИ ДЛЯ ВАШЕЙ СБОРКИ ' + (CURRENT_BUILD ? '(' + escapeHtml(CURRENT_BUILD.gameVersion) + ' / ' + escapeHtml(CURRENT_BUILD.loader) + ')' : '')}</div>
      <div style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto" id="mVers"></div>
    `, false, () => {
      const box = $('#mVers');
      if (!box) return;
      box.innerHTML = '<div class="b-empty">Поиск версий...</div>';
      if (B_TYPE === 'modpack') {
        // Модпаки: версии без привязки к сборке; установка = импорт новой сборки
        api.invoke('modrinth:versions', h.slug).then(vers => {
          const list = Array.isArray(vers) ? vers : [];
          box.innerHTML = '';
          if (!list.length) { box.innerHTML = '<div class="b-empty">Версий нет</div>'; return; }
          list.slice(0, 15).forEach(v => {
            const f = (v.files || []).find(x => x.primary) || (v.files || [])[0];
            const mb = f && f.size ? (f.size / 1048576).toFixed(1) + ' MB' : '';
            const row = document.createElement('div');
            row.className = 'b-mod b-ver-row';
            row.innerHTML = `
              <div style="display:flex;align-items:center;gap:8px">
                <div class="bm-name">${escapeHtml(v.version_number)} &middot; ${escapeHtml((v.loaders || []).join('/'))}</div>
                <div class="bm-size">${mb}</div>
              </div>
              <button class="b-mini play">УСТАНОВИТЬ КАК СБОРКУ</button>`;
            row.querySelector('button').addEventListener('click', () => installModpack(h, v));
            box.appendChild(row);
          });
        }).catch(err => { box.innerHTML = '<div class="b-empty">Ошибка: ' + escapeHtml(err.message || err) + '</div>'; });
        return;
      }
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
    }); // onShow
  }

  // Установка модпака из каталога: качаем .mrpack и импортируем как новую сборку
  function installModpack(h, v) {
    if (!h || !v) return;
    setStatus('МОДПАК: ' + h.title.toUpperCase(), 'busy');
    updateProgress({ name: h.title, frac: 0 });
    api.invoke('builds:install-modpack', { slug: h.slug, versionId: v.id }).then(newId => {
      hideProgress();
      setStatus('МОДПАК УСТАНОВЛЕН: ' + h.title, '');
      modal.classList.remove('show');
      refreshBuilds().then(() => selectBuild(newId));
    }).catch(err => {
      hideProgress();
      setStatus('ОШИБКА: ' + (err.message || err), 'busy');
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
    // МОДПАКИ: версии без привязки к сборке; пользователь выбирает версию Minecraft и загрузчик
    if ((h && (h.project_type === 'modpack' || h.btype === 'modpack')) || B_TYPE === 'modpack') {
      api.invoke('modrinth:versions', h.slug).then(vers => {
        const list = Array.isArray(vers) ? vers : [];
        box.innerHTML = '';
        if (!list.length) { box.innerHTML = '<div class="b-empty">Версий нет</div>'; return; }
        // доступные версии Minecraft и загрузчики (из всех версий пакета)
        const mcSeen = new Set(); const ldSeen = new Set();
        list.forEach(v => {
          if (v.version_type !== 'release') return; // приоритет релизным строкам
          (v.game_versions || []).forEach(g => mcSeen.add(g));
          (v.loaders || []).forEach(l => ldSeen.add(l));
        });
        if (!mcSeen.size) list.forEach(v => { (v.game_versions || []).forEach(g => mcSeen.add(g)); (v.loaders || []).forEach(l => ldSeen.add(l)); });
        const mcs = Array.from(mcSeen);
        const lds = Array.from(ldSeen);
        const latest = list.find(v => v.version_type === 'release') || list[0];
        let selMc = (latest.game_versions || [])[0] || mcs[0];
        let selLd = (latest.loaders || [])[0] || lds[0];
        const selStyle = 'background:var(--mc-grey-5);border:2px solid var(--mc-off-black);color:var(--mc-off-white);padding:6px 9px;font-family:var(--mc-font);font-size:11.5px;outline:none';
        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;align-items:center';
        controls.innerHTML = `
          <span style="font-family:var(--mc-font);font-size:10.5px;color:var(--mc-grey-3);letter-spacing:.06em">ВЕРСИЯ MINECRAFT:</span>
          <select id="mpMc" style="${selStyle}">${mcs.map(m => `<option value="${escapeHtml(m)}"${m === selMc ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('')}</select>
          <span style="font-family:var(--mc-font);font-size:10.5px;color:var(--mc-grey-3);letter-spacing:.06em;margin-left:6px">ЗАГРУЗЧИК:</span>
          <select id="mpLd" style="${selStyle}">${lds.map(l => `<option value="${escapeHtml(l)}"${l === selLd ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;
        box.appendChild(controls);
        const listEl = document.createElement('div');
        listEl.style.cssText = 'display:flex;flex-direction:column;gap:6px';
        box.appendChild(listEl);
        const renderMpList = () => {
          const mc = $('#mpMc').value;
          const ld = $('#mpLd').value;
          const filtered = list.filter(v => (v.game_versions || []).includes(mc) && (!ld || (v.loaders || []).includes(ld)));
          listEl.innerHTML = '';
          if (!filtered.length) {
            listEl.innerHTML = '<div class="b-empty">Нет версий для Minecraft ' + escapeHtml(mc) + ' / ' + escapeHtml(ld) + '</div>';
            return;
          }
          filtered.slice(0, 15).forEach(v => {
            const gv = (v.game_versions || []).find(x => x === mc) || mc;
            const f = (v.files || []).find(x => x.primary) || (v.files || [])[0];
            const mb = f && f.size ? (f.size / 1048576).toFixed(1) + ' MB' : '';
            const row = document.createElement('div');
            row.className = 'b-mod b-ver-row';
            row.innerHTML = `
              <div style="display:flex;align-items:center;gap:8px">
                <div class="bm-name">MINECRAFT ${escapeHtml(gv)} &middot; ${escapeHtml((v.loaders || []).join('/'))} &middot; пакет ${escapeHtml(v.version_number)}</div>
                <div class="bm-size">${mb}</div>
              </div>
              <button class="b-mini play">УСТАНОВИТЬ КАК СБОРКУ</button>`;
            row.querySelector('button').addEventListener('click', () => installModpack(h, v));
            listEl.appendChild(row);
          });
        };
        controls.querySelector('#mpMc').addEventListener('change', renderMpList);
        controls.querySelector('#mpLd').addEventListener('change', renderMpList);
        renderMpList();
      }).catch(err => { box.innerHTML = '<div class="b-empty">Ошибка: ' + escapeHtml(err.message || err) + '</div>'; });
      return;
    }
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
      // Сначала релизы, потом беты, потом альфы (внутри группы — по дате, как отдал Modrinth)
      const TYPE_ORDER = { release: 0, beta: 1, alpha: 2 };
      list.sort((a, b) => (TYPE_ORDER[(a.version_type || '').toLowerCase()] ?? 3) - (TYPE_ORDER[(b.version_type || '').toLowerCase()] ?? 3));
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
        const VT_META = { release: { t: 'РЕЛИЗ', bg: '#3c8527' }, beta: { t: 'БЕТА', bg: '#e8862c' }, alpha: { t: 'АЛЬФА', bg: '#1e6eea' } };
        const vm = VT_META[(v.version_type || '').toLowerCase()];
        const typeBadge = vm ? `<span class="ver-badge" style="background:${vm.bg}">${vm.t}</span>` : '';
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
            <div class="bm-meta">${typeBadge}${date}${mb ? ' &middot; ' + mb : ''}</div>
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
`, true, () => {
      const mb2 = modal.querySelector('.modal');
    if (mb2) mb2.classList.add('wide');
    if (getCustom().cardLayout === 'center' && mb2) mb2.classList.add('mp-cust-center');
    const fb = $('#mpFavBtn');
    if (fb) fb.addEventListener('click', () => toggleFav(h, fb));
    });
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
    const vt = (version.version_type || '').toLowerCase();
    if (vt === 'beta' || vt === 'alpha') {
      const label = vt === 'beta' ? 'БЕТА' : 'АЛЬФА';
      const vnum = version.version_number || '';
      openModal('Нестабильная версия', `
        <div style="font-family:var(--mc-font-body);font-size:12px;line-height:1.6;color:var(--mc-grey-2)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span class="ver-badge" style="background:${vt === 'beta' ? '#e8862c' : '#1e6eea'}">${label}</span>
            <span style="font-family:var(--mc-font);color:var(--mc-off-white);font-size:13px">${escapeHtml(vnum)}</span>
          </div>
          Версия мода <b style="color:var(--mc-off-white)">${escapeHtml(h.title)}</b> — это ${label.toLowerCase()}.
          Такие версии находятся в разработке и <b style="color:#e8862c">могут работать неисправно</b>: возможны вылеты, баги и несовместимость с другими модами.
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="secondary-btn" id="mUnstNo" style="margin:0;flex:1">ОТМЕНА</button>
          <button class="play-btn" id="mUnstYes" style="margin:0;flex:1;font-size:14px">ВСЁ РАВНО УСТАНОВИТЬ</button>
        </div>
      `, false, () => {
        const no = $('#mUnstNo');
        if (no) no.addEventListener('click', () => modal.classList.remove('show'));
        const yes = $('#mUnstYes');
        if (yes) yes.addEventListener('click', () => { modal.classList.remove('show'); doInstallChecked(h, version, withDeps); });
      });
      return;
    }
    doInstallChecked(h, version, withDeps);
  }

  function doInstallChecked(h, version, withDeps) {
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
          `, false, () => {
            const dn = $('#mDepNo');
            if (dn) dn.addEventListener('click', () => { modal.classList.remove('show'); installNow(h, version.id, false); });
            const dy = $('#mDepYes');
            if (dy) dy.addEventListener('click', () => { modal.classList.remove('show'); installNow(h, version.id, true); });
          });
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
        autoIconFromMod(h);
        afterModInstalled(h, versionId);
        refreshBuilds();
      })
      .catch(err => {
        setStatus('ОШИБКА: ' + (err.message || err), 'busy');
        hideProgress();
      });
  }

  // Автоиконка: если у сборки случайная/стандартная иконка (не своя картинка),
  // после установки мода ставим обложку этого мода иконкой сборки
  function autoIconFromMod(h) {
    if (!CURRENT_BUILD || !h || !h.icon_url) return;
    if (String(CURRENT_BUILD.icon || '').indexOf('data:') === 0) return; // своя иконка
    api.invoke('builds:set-icon-from-url', { buildId: CURRENT_BUILD.id, url: h.icon_url })
      .then(b => {
        if (b && b.icon) {
          CURRENT_BUILD.icon = b.icon;
          const bb = BUILD_LIST.find(x => x.id === CURRENT_BUILD.id);
          if (bb) bb.icon = b.icon;
          renderBuilds();
          renderDetailBuild();
          mcToast('ИКОНКА СБОРКИ: ОБЛОЖКА МОДА');
        }
      })
      .catch(() => {});
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
    `, false, () => {
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
      if (btn) btn.addEventListener('click', () => {
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
    }); // onShow
  }

  if ($('#bNewBtn')) {
    let instSearchT = null;
    $('#bNewBtn').addEventListener('click', openCreateModal);
    const mb = $('#bMergeBtn');
    if (mb) mb.addEventListener('click', openMergeModal);
    $('#bSearchBtn').addEventListener('click', () => { B_OFFSET = 0; refreshCatalog(); });
    // Фильтры модпаков: загрузчик + версия игры
    const mpLoader = $('#mpLoader');
    const mpVersion = $('#mpVersion');
    if (mpLoader) mpLoader.addEventListener('change', () => { MP_LOADER = mpLoader.value; B_OFFSET = 0; refreshCatalog(); });
    if (mpVersion) {
      mpVersion.addEventListener('change', () => { MP_VERSION = mpVersion.value; B_OFFSET = 0; refreshCatalog(); });
      mpVersion._fill = () => {
        if (MP_VERSIONS_FILLED || !Array.isArray(VERSION_LIST)) return;
        MP_VERSIONS_FILLED = true;
        const releases = VERSION_LIST.filter(v => v.type === 'release').slice(0, 60);
        releases.forEach(v => {
          const o = document.createElement('option');
          o.value = v.id;
          o.textContent = v.id;
          mpVersion.appendChild(o);
        });
      };
    }
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
    api.invoke('update:check').then(u => {
      if (u && u.version) showUpdateModal(u);
      // Если обновления нет — показываем «Что нового» для текущей версии
      else setTimeout(() => maybeShowNews(APP_VERSION), 900);
    }).catch(() => setTimeout(() => maybeShowNews(APP_VERSION), 900));
    // Версия лаунчера в статус-баре (реальная, из package.json)
    api.invoke('app:info').then(i => {
      if (i && i.version) {
        APP_VERSION = i.version;
        $('#appVersion').textContent = 'v' + i.version + ' · st4amLauncher';
      }
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
      false,
      () => {
        const yes = $('#updYes');
        if (yes) yes.addEventListener('click', () => {
          modal.classList.remove('show');
          showToast('\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 \u0437\u0430\u043f\u0443\u0449\u0435\u043d\u043e... \u041b\u0430\u0443\u043d\u0447\u0435\u0440 \u0437\u0430\u043a\u0440\u043e\u0435\u0442\u0441\u044f \u0441\u0430\u043c');
          api.invoke('update:now').then(ok => {
            if (!ok) showToast('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435');
          });
        });
        const no = $('#updNo');
        if (no) no.addEventListener('click', () => modal.classList.remove('show'));
      }
    );
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
    `, false, () => {
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
    }); // onShow
  }

  init();
})();
