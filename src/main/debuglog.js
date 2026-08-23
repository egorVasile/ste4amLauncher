// Файловый лог отладки: всё о запуске лаунчера и Minecraft в один файл
// %APPDATA%\.st4amlauncher\logs\debug.log (ротация при >8МБ -> debug.old.log)
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let LOG_DIR = null;
try { LOG_DIR = path.join(app.getPath('userData'), 'logs'); } catch (e) {
  try { LOG_DIR = path.join(process.env.APPDATA || '.', '.st4amlauncher', 'logs'); } catch (e2) { LOG_DIR = null; }
}

function logfile() {
  return LOG_DIR ? path.join(LOG_DIR, 'debug.log') : null;
}

function rotateIfNeeded(file) {
  try {
    const st = fs.statSync(file);
    if (st.size > 8 * 1024 * 1024) {
      const old = path.join(path.dirname(file), 'debug.old.log');
      try { fs.unlinkSync(old); } catch (e) {}
      fs.renameSync(file, old);
    }
  } catch (e) {}
}

function fmt(p) {
  if (typeof p === 'string') return p;
  try { return JSON.stringify(p); } catch (e) { return String(p); }
}

function dlog(...parts) {
  const file = logfile();
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotateIfNeeded(file);
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
    fs.appendFileSync(file, '[' + ts + '] ' + parts.map(fmt).join(' ') + '\n', 'utf8');
  } catch (e) { /* логирование не должно падать */ }
}

module.exports = { dlog, logfile };
