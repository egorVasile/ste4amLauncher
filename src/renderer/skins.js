'use strict';
/* Canvas-рендер Minecraft-скина для превью профиля (кастомизация 0.2.8).
   Тексельные координаты — стандартная карта 64x64 (формат 1.8+).
   Поддержка: front/back, шапка (hat), плащ (cape), классик/слим. */
window.SkinRenderer = (function () {
  const P = (ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) => ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);

  // Для старых скинов 64x32 левые конечности — зеркало правых (по карте 64x64),
  // поэтому рисуем правую текстуру с горизонтальным отражением.
  function mirrorP(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) {
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
    ctx.restore();
  }

  function draw(ctx, img, cx, cy, scale, opts) {
    const o = opts || {};
    const slim = !!o.slim;
    const back = !!o.back;
    const newFmt = img.height >= 64;
    const armW = slim ? 3 : 4;
    const u = scale;
    const totalW = 8 + armW * 2;
    const x0 = cx - (totalW * u) / 2;
    const y0 = cy - (32 * u) / 2;
    const bodyX = cx - 4 * u;
    const aw = armW * u;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // --- задний слой: плащ (виден только со спины) ---
    if (back && o.capeImg) {
      ctx.globalAlpha = 0.95;
      ctx.drawImage(o.capeImg, bodyX - u, y0 + 6 * u, 10 * u, 17 * u);
      ctx.globalAlpha = 1;
    }

    // --- ноги ---
    if (back) {
      // правая нога (у зрителя слева) — задняя грань
      P(ctx, img, 12, 20, 4, 12, bodyX, y0 + 20 * u, 4 * u, 12 * u);
      // левая нога — задняя грань
      if (newFmt) P(ctx, img, 28, 52, 4, 12, bodyX + 4 * u, y0 + 20 * u, 4 * u, 12 * u);
      else mirrorP(ctx, img, 12, 20, 4, 12, bodyX + 4 * u, y0 + 20 * u, 4 * u, 12 * u);
    } else {
      // правая нога — передняя грань
      P(ctx, img, 4, 20, 4, 12, bodyX, y0 + 20 * u, 4 * u, 12 * u);
      // левая нога — передняя грань
      if (newFmt) P(ctx, img, 20, 52, 4, 12, bodyX + 4 * u, y0 + 20 * u, 4 * u, 12 * u);
      else mirrorP(ctx, img, 4, 20, 4, 12, bodyX + 4 * u, y0 + 20 * u, 4 * u, 12 * u);
    }

    // --- руки ---
    if (back) {
      P(ctx, img, 52, 20, armW, 12, x0, y0 + 8 * u, aw, 12 * u);           // правая (зад)
      if (newFmt) P(ctx, img, 44, 52, armW, 12, x0 + totalW * u - aw, y0 + 8 * u, aw, 12 * u); // левая (зад)
      else mirrorP(ctx, img, 52, 20, armW, 12, x0 + totalW * u - aw, y0 + 8 * u, aw, 12 * u);
    } else {
      P(ctx, img, 44, 20, armW, 12, x0, y0 + 8 * u, aw, 12 * u);            // правая (пер)
      if (newFmt) P(ctx, img, 36, 52, armW, 12, x0 + totalW * u - aw, y0 + 8 * u, aw, 12 * u); // левая (пер)
      else mirrorP(ctx, img, 44, 20, armW, 12, x0 + totalW * u - aw, y0 + 8 * u, aw, 12 * u);
    }

    // --- тело ---
    if (back) P(ctx, img, 32, 20, 8, 12, bodyX, y0 + 8 * u, 8 * u, 12 * u);
    else P(ctx, img, 20, 20, 8, 12, bodyX, y0 + 8 * u, 8 * u, 12 * u);

    // --- голова ---
    if (back) P(ctx, img, 24, 8, 8, 8, cx - 4 * u, y0, 8 * u, 8 * u);
    else P(ctx, img, 8, 8, 8, 8, cx - 4 * u, y0, 8 * u, 8 * u);

    // --- шапка (слой поверх головы) ---
    if (o.showHat) {
      if (back) P(ctx, img, 56, 8, 8, 8, cx - 4 * u, y0, 8 * u, 8 * u);
      else P(ctx, img, 40, 8, 8, 8, cx - 4 * u, y0, 8 * u, 8 * u);
    }
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image load failed'));
      im.src = src;
    });
  }

  // Рисует скин в canvas с подложкой и тенью. opts: { slim, back, hat, cape }.
  // texture/cape — data-URL PNG. Возвращает Promise.
  function render(canvas, texture, opts) {
    const o = opts || {};
    return loadImage(texture).then(img => {
      const w = canvas.width, h = canvas.height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);

      // подложка (как кнопка Minecraft)
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,.08)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);

      const slim = !!o.slim;
      const u = Math.min(w / (8 + (slim ? 3 : 4) * 2 + 2), h / (32 + 2));
      const cx = w / 2;
      const cy = h / 2 + u * 0.5;

      let capeImg = null;
      if (o.cape) {
        return loadImage(o.cape)
          .then(c => { capeImg = c; })
          .catch(() => { capeImg = null; })
          .then(() => {
            draw(ctx, img, cx, cy, u, { slim, back: o.back, showHat: o.hat, capeImg });
            return true;
          });
      }
      draw(ctx, img, cx, cy, u, { slim, back: o.back, showHat: o.hat, capeImg: null });
      return true;
    });
  }

  return { render, loadImage };
})();