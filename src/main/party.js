'use strict';
/* Совместное создание сборки по локальной сети (LAN / Radmin VPN).
 *
 * Модель: один лаунчер создаёт «комнату» и становится ХОСТОМ.
 * Хост = «сеть»: только у него авторитетное состояние (какие моды/ресурспаки/
 * шейдеры добавлены и КТО их добавил). Клиенты спрашивают состояние у сети,
 * сообщают о своих действиях и получают события. На ПК состояние не хранится.
 *
 * Транспорт: UDP (dgram), порт 57410.
 *  - хост раз в 3с броадкастит announce (объявление комнаты);
 *  - клиенты слушают броадкаст → список комнат;
 *  - события ходят юникастом; большие сообщения режутся на части (MTU).
 *
 * Роли в подтверждении удаления:
 *  requester  — тот, кто хочет удалить чужой файл (клиент или сам хост);
 *  owner      — тот, кто файл добавил (клиент; хост-владелец решает сразу).
 */
const dgram = require('dgram');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.ST4AM_PARTY_PORT, 10) || 57410;
const MAGIC = 'ST4AM1';            // префикс всех пакетов — отсекаем чужой трафик
const ANNOUNCE_MS = 3000;          // период объявления комнаты
const PEER_TIMEOUT = 12000;        // клиент молчит столько — считаем вышедшим
const HOST_TIMEOUT = 12000;        // хост молчит столько — клиент отваливается
const DEL_TIMEOUT = 10000;         // таймаут подтверждения удаления
const JOIN_TIMEOUT = 10000;        // таймаут подтверждения входа в комнату
const COOLDOWN_MS = 3000;          // кулдаун за спам-установки
const RATE_WINDOW = 1000;          // окно рейт-лимита
const RATE_MAX = 2;                // максимум событий за окно
const CHUNK = 1200;                // размер части большого сообщения

let usock = null;                  // единственный сокет инстанса
let myUport = 0;
let canHost = false;               // удалось ли занять порт 57410 (порт хоста эксклюзивен)
let emit = () => {};               // (channel, payload) → в рендерер
let me = { id: null, user: 'Player' };

let mode = 'off';                  // 'off' | 'host' | 'client'
let joinedOk = false;              // клиент уже принят в комнату (стоп ретраев)
let room = null;                   // { id, name, buildId, build }
let hostAddr = null;               // { ip, port } для клиента
let lastHostSeen = 0;
let phase = 'lobby';               // 'lobby' | 'building' | 'review' | 'final'
let doneSet = new Set();           // host: кто нажал «Закончил»
let reviewCfg = { enabled: true, sec: 60 }; // таймаут проверки — настройка хоста
const votes = new Map();           // host: reqId → голосование
const discovered = new Map();      // roomId → объявление комнаты
const peers = new Map();           // host: peerId → {user, ip, port, lastSeen, events:[]}
const filesMap = new Map();        // host: 'type|filename' → {…, addedBy, addedByUser, ts}
const pending = new Map();         // reqId → {kind, timer, ...}
const parts = new Map();           // сборка фрагментированных сообщений
// Локальное зеркало пендding-списка (что должно быть в сборке по мнению сети).
// Во время сборки моды НЕ качаются — только пишутся сюда и во временный файл.
let pendingPath = null;
const pendingFiles = new Map();    // 'type|filename' → file

function log(...a) { console.log('[party]', ...a); }
function makeId() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

// Временный файл: список модов комнаты (без скачивания — только запись)
function savePending() {
  if (!pendingPath) return;
  try {
    const files = mode === 'host' ? Array.from(filesMap.values()) : Array.from(pendingFiles.values());
    fs.writeFileSync(pendingPath, JSON.stringify({
      room: room ? room.name : '', updated: Date.now(), phase,
      files: files.map(f => ({ filename: f.filename, type: f.type, title: f.title, source: f.source, ref: f.ref, addedByUser: f.addedByUser }))
    }, null, 1), 'utf8');
  } catch (e) {}
}

function clearPendingFile() {
  pendingFiles.clear();
  if (!pendingPath) return;
  try { fs.unlinkSync(pendingPath); } catch (e) {}
}

function pendingTrack(file) {
  pendingFiles.set(file.type + '|' + file.filename, file);
  savePending();
}

function pendingUntrack(file) {
  pendingFiles.delete(file.type + '|' + file.filename);
  savePending();
}

function localIps() {
  const out = [];
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  } catch (e) {}
  return out.length ? out : ['127.0.0.1'];
}

/* ---------- транспорт ---------- */

function rawSend(msg, ip, port) {
  if (!usock || !ip || !port) return;
  try {
    const buf = Buffer.from(MAGIC + JSON.stringify(msg), 'utf8');
    usock.send(buf, 0, buf.length, port, ip);
  } catch (e) { log('send fail', e.message); }
}

function send(msg, ip, port) {
  const json = JSON.stringify(msg);
  if (json.length <= CHUNK) { rawSend(msg, ip, port); return; }
  const mid = makeId();
  const n = Math.ceil(json.length / CHUNK);
  for (let i = 0; i < n; i++) {
    rawSend({ t: 'part', mid, i, n, d: json.slice(i * CHUNK, (i + 1) * CHUNK) }, ip, port);
  }
}

// Широковещательный «кто здесь?»: гости опрашивают сеть, хост(ы) отвечают
// юникастом. Порт 57410 держит только хост — доставка детерминирована.
function bcastTargets() {
  const out = new Set(['255.255.255.255']);
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const ni of list || []) {
        if (ni.family !== 'IPv4' || ni.internal) continue;
        const ip = ni.address.split('.').map(Number);
        const nm = String(ni.netmask || '255.255.255.0').split('.').map(Number);
        out.add(ip.map((o, i) => (o & nm[i]) | (~nm[i] & 255)).join('.'));
      }
    }
  } catch (e) {}
  return Array.from(out);
}

function discover() {
  if (!usock) return;
  const buf = Buffer.from(MAGIC + JSON.stringify({ t: 'discover', from: me.id }), 'utf8');
  const targets = bcastTargets();
  if (process.env.ST4AM_PARTY_DEBUG) log('discover → ' + targets.join(', '));
  for (const ip of targets) {
    try { usock.send(buf, 0, buf.length, PORT, ip); } catch (e) { if (process.env.ST4AM_PARTY_DEBUG) log('discover fail ' + ip + ': ' + e.message); }
  }
}

function onDatagram(buf, rinfo) {
  const s = buf.toString('utf8');
  if (process.env.ST4AM_PARTY_DEBUG) log('recv ' + rinfo.address + ':' + rinfo.port + ' ' + s.slice(0, 80));
  if (!s.startsWith(MAGIC)) return;
  let msg;
  try { msg = JSON.parse(s.slice(MAGIC.length)); } catch (e) { return; }
  if (msg && msg.t === 'part') { assemble(msg, rinfo); return; }
  try { handle(msg, rinfo); } catch (e) { log('handler error', m2t(msg), e.message); }
}
function m2t(m) { return m && m.t || '?'; }

function assemble(p, rinfo) {
  let rec = parts.get(p.mid);
  if (!rec) { rec = { n: p.n, got: new Set(), chunks: [] }; parts.set(p.mid, rec); }
  if (rec.got.has(p.i)) return;
  rec.got.add(p.i); rec.chunks[p.i] = p.d;
  if (rec.got.size === rec.n) {
    parts.delete(p.mid);
    try { handle(JSON.parse(rec.chunks.join('')), rinfo); } catch (e) { log('bad msg', e.message); }
  }
  if (parts.size > 50) parts.delete(parts.keys().next().value);
}

/* ---------- обработка сообщений ---------- */

function handle(m, rinfo) {
  if (!m || typeof m.t !== 'string') return;
  switch (m.t) {
    case 'discover': return onDiscover(m, rinfo);
    case 'announce': return onAnnounce(m, rinfo);
    case 'ping': return onPing(m, rinfo);
    case 'pong': return onPong();
    case 'join_req': return onJoinReq(m, rinfo);
    case 'join_ok': case 'join_no': case 'join_timeout': return onJoinResult(m.t, m);
    case 'state_part': return onStatePart(m);
    case 'event': return onEvent(m);
    case 'add': return onAdd(m, rinfo);
    case 'del_req': return onDelReq(m, rinfo);
    case 'del_ok': case 'del_no': return onDelAnswer(m);
    case 'del_ask': return onDelAsk(m);
    case 'del_result': return onDelResult(m);
    case 'cooldown': return onCooldown(m);
    case 'leave': return onLeave(m);
    case 'done': return onDone(m);
    case 'vote_req': return onVoteReq(m, rinfo);
    case 'vote': return onVote(m);
    case 'phase': return onPhase(m);
    case 'vote_open': return onVoteOpen(m);
    case 'vote_result': return onVoteResult(m);
    case 'chat': return onChat(m, rinfo);
    case 'kick': return onKick();
    case 'rep_req': return onRepReq(m, rinfo);
    case 'rep': return onRep(m);
    case 'rep_open': return onRepOpen(m);
    case 'rep_result': return onRepResult(m);
    default: return;
  }
}

/* ---------- ХОСТ ---------- */

// гость спрашивает «кто здесь?» — хост отвечает объявлением
function onDiscover(m, rinfo) {
  if (mode !== 'host' || !room) return;
  send({
    t: 'announce', roomId: room.id, name: room.name, hostId: me.id, hostUser: me.user,
    members: peers.size + 1, build: room.build, uport: myUport
  }, rinfo.address, rinfo.port);
}

// гость держит соединение: обновляем lastSeen и отвечаем понгом
function onPing(m, rinfo) {
  if (mode !== 'host') return;
  touchPeer(m.peer, m.user, rinfo);
  send({ t: 'pong', room: room.id }, rinfo.address, rinfo.port);
}

function onPong() {
  if (mode !== 'client') return;
  lastHostSeen = Date.now();
}

function onAnnounce(m, rinfo) {
  if (m.hostId === me.id) return; // своё объявление
  discovered.set(m.roomId, {
    id: m.roomId, name: m.name, hostUser: m.hostUser,
    members: m.members, build: m.build, ip: rinfo.address, uport: m.uport || PORT, ts: Date.now()
  });
  emit('party:rooms', roomsList());
}

function onJoinReq(m, rinfo) {
  if (mode !== 'host') return;
  // повторная заявка от уже принятого клиента — просто подтверждаем ещё раз
  if (peers.has(m.peer)) {
    sendStateTo(rinfo.address, rinfo.port);
    send({ t: 'join_ok', room: room.id }, rinfo.address, rinfo.port);
    return;
  }
  if (phase !== 'lobby' && phase !== 'building') { // в проверке/финале новых не пускаем
    send({ t: 'join_no', room: room.id }, rinfo.address, rinfo.port);
    return;
  }
  const reqId = makeId();
  const rec = {
    kind: 'join', peer: m.peer, user: m.user, ip: rinfo.address, port: rinfo.port,
    timer: setTimeout(() => {
      pending.delete(reqId);
      send({ t: 'join_timeout', room: room.id }, rinfo.address, rinfo.port);
    }, JOIN_TIMEOUT)
  };
  pending.set(reqId, rec);
  emit('party:ask', { reqId, user: m.user, kind: 'join' });
}

function hostBroadcast(msg) {
  for (const p of peers.values()) send(Object.assign({ room: room.id }, msg), p.ip, p.port);
}

function hostState() {
  return {
    files: Array.from(filesMap.values()).map(f => ({
      filename: f.filename, type: f.type, title: f.title, source: f.source,
      ref: f.ref, addedByUser: f.addedByUser
    })),
    peers: Array.from(peers.values()).map(p => p.user)
  };
}

function sendStateTo(ip, port) {
  const st = hostState();
  send({ t: 'state_part', room: room.id, files: st.files, peers: st.peers }, ip, port);
}

function onStatePart(m) {
  if (mode !== 'client') return;
  lastHostSeen = Date.now();
  pendingFiles.clear();
  for (const f of (m.files || [])) pendingFiles.set(f.type + '|' + f.filename, f);
  savePending();
  emit('party:state', { files: m.files || [], peers: m.peers || [] });
}

function hostRemoveFile(key, byUser) {
  const f = filesMap.get(key);
  if (!f) return;
  filesMap.delete(key);
  savePending();
  const ev = { kind: 'remove', user: byUser, file: { filename: f.filename, type: f.type, title: f.title } };
  hostBroadcast({ t: 'event', ...ev });
  emit('party:event', ev);
}

function onAdd(m, rinfo) {
  if (mode !== 'host') return;
  touchPeer(m.peer, m.user, rinfo);
  if (!rateOk(m.peer)) {
    send({ t: 'cooldown', room: room.id, waitMs: COOLDOWN_MS }, rinfo.address, rinfo.port);
    return;
  }
  const key = m.file.type + '|' + m.file.filename;
  if (filesMap.has(key)) return;
  filesMap.set(key, Object.assign({ addedBy: m.peer, addedByUser: m.user, ts: Date.now() }, m.file));
  savePending();
  const ev = { kind: 'add', user: m.user, file: m.file };
  hostBroadcast({ t: 'event', ...ev });
  emit('party:event', ev);
}

// установку делает сам хост
function hostAdd(file) {
  if (mode !== 'host') return;
  const key = file.type + '|' + file.filename;
  if (filesMap.has(key)) return;
  filesMap.set(key, Object.assign({ addedBy: me.id, addedByUser: me.user, ts: Date.now() }, file));
  savePending();
  const ev = { kind: 'add', user: me.user, file };
  hostBroadcast({ t: 'event', ...ev });
  emit('party:event', ev);
}

function onDelReq(m, rinfo) {
  if (mode !== 'host') return;
  touchPeer(m.peer, m.user, rinfo);
  const key = m.file.type + '|' + m.file.filename;
  const f = filesMap.get(key);
  const reqId = m.reqId || makeId();
  if (!f) { // в сети такого файла нет — можно удалять свободно
    send({ t: 'del_result', room: room.id, reqId, result: 'ok', file: m.file }, rinfo.address, rinfo.port);
    return;
  }
  if (f.addedBy === m.peer) { // своё — молча удаляем
    hostRemoveFile(key, m.user);
    send({ t: 'del_result', room: room.id, reqId, result: 'ok', file: m.file }, rinfo.address, rinfo.port);
    return;
  }
  const finish = (result) => send({ t: 'del_result', room: room.id, reqId, result, file: m.file, byUser: f.addedByUser }, rinfo.address, rinfo.port);
  if (f.addedBy === me.id) {
    // владелец — сам хост: спрашиваем через СВОЙ интерфейс (хост тоже участник)
    const rec = {
      kind: 'delHostOwned', key,
      requester: { peer: m.peer, user: m.user, ip: rinfo.address, port: rinfo.port },
      file: { filename: f.filename, type: f.type, title: f.title },
      timer: setTimeout(() => { pending.delete(reqId); finish('timeout'); }, DEL_TIMEOUT)
    };
    pending.set(reqId, rec);
    emit('party:delAsk', { reqId, byUser: m.user, file: rec.file });
    return;
  }
  const owner = peers.get(f.addedBy);
  if (!owner) { finish('timeout'); return; } // владелец вышел из сети
  const rec = {
    kind: 'del', key,
    requester: { peer: m.peer, user: m.user, ip: rinfo.address, port: rinfo.port },
    file: { filename: f.filename, type: f.type, title: f.title },
    timer: setTimeout(() => { pending.delete(reqId); finish('timeout'); }, DEL_TIMEOUT)
  };
  pending.set(reqId, rec);
  send({ t: 'del_ask', room: room.id, reqId, byUser: m.user, file: rec.file }, owner.ip, owner.port);
}

// владелец-клиент получил вопрос «можно удалить?»
function onDelAsk(m) {
  lastHostSeen = Date.now();
  if (mode === 'client') {
    pending.set(m.reqId, {
      kind: 'delOwner', hostIp: hostAddr ? hostAddr.ip : null, hostPort: hostAddr ? hostAddr.port : PORT,
      timer: setTimeout(() => pending.delete(m.reqId), DEL_TIMEOUT + 2000) // чистка, решает таймер хоста
    });
  }
  emit('party:delAsk', { reqId: m.reqId, byUser: m.byUser, file: m.file });
}

// хост получил ответ владельца
function onDelAnswer(m) {
  if (mode !== 'host') return;
  const rec = pending.get(m.reqId);
  if (!rec) return;
  clearTimeout(rec.timer);
  pending.delete(m.reqId);
  const ok = m.t === 'del_ok';
  if (rec.kind === 'delHost') {
    // проситель — сам хост: результат себе в интерфейс
    if (ok) hostRemoveFile(rec.key, me.user);
    emit('party:delResult', { reqId: m.reqId, result: ok ? 'ok' : 'no', file: rec.file });
    return;
  }
  if (ok) hostRemoveFile(rec.key, rec.requester.user);
  send({ t: 'del_result', room: room.id, reqId: m.reqId, result: ok ? 'ok' : 'no', file: rec.file }, rec.requester.ip, rec.requester.port);
}

// проситель получил вердикт
function onDelResult(m) {
  const rec = pending.get(m.reqId);
  if (rec) { clearTimeout(rec.timer); pending.delete(m.reqId); }
  emit('party:delResult', { reqId: m.reqId, result: m.result, file: m.file, byUser: m.byUser });
}

function onCooldown(m) {
  emit('party:cooldown', { waitMs: m.waitMs || COOLDOWN_MS });
}

function onLeave(m) {
  if (mode !== 'host') return;
  const p = peers.get(m.peer);
  if (!p) return;
  peers.delete(m.peer);
  hostBroadcast({ t: 'event', kind: 'leave', user: p.user });
  emit('party:event', { kind: 'leave', user: p.user });
}

function touchPeer(peer, user, rinfo) {
  let p = peers.get(peer);
  if (!p) {
    p = { user, ip: rinfo.address, port: rinfo.port, lastSeen: Date.now(), events: [] };
    peers.set(peer, p);
    const ev = { kind: 'join', user };
    hostBroadcast({ t: 'event', ...ev });
    emit('party:event', ev);
  } else {
    p.lastSeen = Date.now(); p.user = user; p.ip = rinfo.address; p.port = rinfo.port;
  }
}

function rateOk(peer) {
  const p = peers.get(peer);
  if (!p) return true;
  const now = Date.now();
  p.events = (p.events || []).filter(t => now - t < RATE_WINDOW);
  if (p.events.length >= RATE_MAX) return false;
  p.events.push(now);
  return true;
}

// отдельный лимит для чата: 5 сообщений за 3с (спам фильтруем, болтовню нет)
const chatTimes = new Map();
function chatOk(peer) {
  const now = Date.now();
  const arr = (chatTimes.get(peer) || []).filter(t => now - t < 3000);
  if (arr.length >= 5) return false;
  arr.push(now);
  chatTimes.set(peer, arr);
  return true;
}

/* ---------- фазы: сборка → проверка → финал ---------- */

function onDone(m) {
  if (mode !== 'host' || phase !== 'building') return;
  if (doneSet.has(m.peer)) return; // повторное «закончил» — игнор
  const p = peers.get(m.peer);
  const user = (p && p.user) || m.user || '?';
  doneSet.add(m.peer);
  const ev = { kind: 'done', user };
  hostBroadcast({ t: 'event', ...ev });
  emit('party:event', ev);
  emitDoneUpdate();
  if (allDone()) enterReview();
}

function allDone() {
  if (!doneSet.has(me.id)) return false;
  for (const id of peers.keys()) if (!doneSet.has(id)) return false;
  return true;
}

function emitDoneUpdate() {
  const doneUsers = [];
  if (doneSet.has(me.id)) doneUsers.push(me.user);
  for (const [id, p] of peers) if (doneSet.has(id)) doneUsers.push(p.user);
  emit('party:doneUpdate', { doneUsers, all: allDone() });
}

function enterReview() {
  if (mode !== 'host' || phase !== 'building') return;
  phase = 'review';
  const files = hostState().files;
  hostBroadcast({ t: 'phase', phase: 'review', files });
  emit('party:phase', { phase: 'review', files });
}

// хост нажал «Завершить сборку» — раздать всем
function finalize() {
  if (mode !== 'host') return;
  phase = 'final';
  const files = hostState().files;
  hostBroadcast({ t: 'phase', phase: 'final', files });
  emit('party:phase', { phase: 'final', files });
}

/* ---------- голосование за удаление (фаза проверки) ---------- */

function voteStart(file, byUser) {
  if (mode !== 'host' || phase !== 'review') return;
  const reqId = makeId();
  const total = peers.size + 1; // все клиенты + хост
  const timeoutMs = reviewCfg.enabled ? Math.max(10, Math.min(600, reviewCfg.sec)) * 1000 : 0;
  const rec = { file, votes: new Map(), total, timer: null };
  votes.set(reqId, rec);
  if (timeoutMs) rec.timer = setTimeout(() => closeVote(reqId), timeoutMs);
  hostBroadcast({ t: 'vote_open', reqId, file, byUser, timeoutMs });
  emit('party:voteOpen', { reqId, file, byUser, timeoutMs });
}

function onVoteReq(m, rinfo) {
  if (mode !== 'host') return;
  touchPeer(m.peer, m.user, rinfo);
  voteStart(m.file, m.user);
}

function onVote(m) {
  if (mode !== 'host') return;
  const rec = votes.get(m.reqId);
  if (!rec || rec.votes.has(m.peer)) return;
  rec.votes.set(m.peer, !!m.yes);
  if (rec.votes.size >= rec.total) closeVote(m.reqId);
}

function closeVote(reqId) {
  const rec = votes.get(reqId);
  if (!rec) return;
  if (rec.timer) clearTimeout(rec.timer);
  votes.delete(reqId);
  let yes = 0, no = 0;
  for (const v of rec.votes.values()) (v ? yes++ : no++);
  let result = 'tie';
  if (yes > no) {
    result = 'removed';
    hostRemoveFile(rec.file.type + '|' + rec.file.filename, 'голосование');
  } else if (no > yes) result = 'kept';
  hostBroadcast({ t: 'vote_result', reqId, result, file: rec.file, yes, no });
  emit('party:voteResult', { reqId, result, file: rec.file, yes, no });
}

/* ---------- чат ---------- */

function onChat(m, rinfo) {
  if (mode !== 'host') return;
  touchPeer(m.peer, m.user, rinfo);
  if (!chatOk(m.peer)) {
    send({ t: 'cooldown', room: room.id, waitMs: 2000 }, rinfo.address, rinfo.port);
    return;
  }
  const text = String(m.text || '').slice(0, 300).trim();
  if (!text) return;
  const ev = { kind: 'chat', user: m.user, text };
  hostBroadcast({ t: 'event', ...ev });
  emit('party:event', ev);
}

// клиент инициирует жалобу
function onRepReq(m, rinfo) {
  if (mode !== 'host') return;
  touchPeer(m.peer, m.user, rinfo);
  if (!rateOk(m.peer)) return;
  report(m.target, m.user);
}

function hostChat(text) {
  if (mode !== 'host') return;
  const t = String(text || '').slice(0, 300).trim();
  if (!t) return;
  const ev = { kind: 'chat', user: me.user, text: t };
  hostBroadcast({ t: 'event', ...ev });
  emit('party:event', ev);
}

/* ---------- КЛИЕНТ ---------- */

function onJoinResult(result) {
  if (mode !== 'client') return;
  if (result === 'join_ok') joinedOk = true;
  emit('party:joinResult', { result });
}

function onEvent(m) {
  if (mode !== 'client') return;
  lastHostSeen = Date.now();
  if (m.kind === 'add' && m.file) pendingTrack(m.file);
  if (m.kind === 'remove' && m.file) pendingUntrack(m.file);
  emit('party:event', { kind: m.kind, user: m.user, file: m.file, text: m.text });
}

/* ---------- кик и жалобы ---------- */

const reports = new Map();         // host: reqId → голосование на выгон

// хост исключает игрока
function kick(user) {
  if (mode !== 'host') return { ok: false };
  for (const [pid, p] of peers) {
    if (p.user !== user) continue;
    peers.delete(pid);
    doneSet.delete(pid);
    send({ t: 'kick', room: room.id }, p.ip, p.port);
    const ev = { kind: 'kick', user, byUser: me.user };
    hostBroadcast({ t: 'event', ...ev });
    emit('party:event', ev);
    emit('party:status', status());
    return { ok: true };
  }
  return { ok: false };
}

function onKick() {
  stop('kicked');
  emit('party:kicked', {});
}

// жалоба на игрока: голосование всех, большинство решает
function report(target, byUser) {
  if (mode !== 'host') return { ok: false };
  if (![...peers.values()].some(p => p.user === target)) return { ok: false, error: 'no-user' };
  const reqId = makeId();
  const rec = {
    target, votes: new Map(),
    total: peers.size + 1,
    timer: setTimeout(() => closeReport(reqId), DEL_TIMEOUT)
  };
  reports.set(reqId, rec);
  hostBroadcast({ t: 'rep_open', reqId, target, byUser, timeoutMs: DEL_TIMEOUT });
  emit('party:repOpen', { reqId, target, byUser, timeoutMs: DEL_TIMEOUT });
  return { ok: true };
}

function onRepOpen(m) {
  if (mode !== 'client') return;
  lastHostSeen = Date.now();
  emit('party:repOpen', { reqId: m.reqId, target: m.target, byUser: m.byUser, timeoutMs: m.timeoutMs });
}

function repVote(reqId, yes) {
  if (mode === 'client' && hostAddr) {
    send({ t: 'rep', room: room.id, peer: me.id, user: me.user, reqId, yes }, hostAddr.ip, hostAddr.port);
    return { ok: true };
  }
  if (mode === 'host') {
    const rec = reports.get(reqId);
    if (rec && !rec.votes.has(me.id)) {
      rec.votes.set(me.id, !!yes);
      if (rec.votes.size >= rec.total) closeReport(reqId);
    }
    return { ok: true };
  }
  return { ok: false };
}

function onRep(m) {
  if (mode !== 'host') return;
  const rec = reports.get(m.reqId);
  if (!rec || rec.votes.has(m.peer)) return;
  rec.votes.set(m.peer, !!m.yes);
  if (rec.votes.size >= rec.total) closeReport(m.reqId);
}

function closeReport(reqId) {
  const rec = reports.get(reqId);
  if (!rec) return;
  if (rec.timer) clearTimeout(rec.timer);
  reports.delete(reqId);
  let yes = 0, no = 0;
  for (const v of rec.votes.values()) (v ? yes++ : no++);
  const kicked = yes > no;
  if (kicked) {
    for (const [pid, p] of peers) {
      if (p.user !== rec.target) continue;
      peers.delete(pid);
      doneSet.delete(pid);
      send({ t: 'kick', room: room.id }, p.ip, p.port);
      break;
    }
  }
  const ev = { kind: 'rep_result', target: rec.target, result: kicked ? 'kicked' : 'kept', yes, no, byUser: rec.byUser };
  hostBroadcast({ t: 'rep_result', reqId, result: ev.result, target: rec.target, yes, no, byUser: rec.byUser });
  emit('party:event', ev);
}

function onRepResult(m) {
  if (mode !== 'client') return;
  lastHostSeen = Date.now();
  emit('party:event', { kind: 'rep_result', target: m.target, result: m.result, yes: m.yes, no: m.no, byUser: m.byUser });
}

function onPhase(m) {
  if (mode !== 'client') return;
  lastHostSeen = Date.now();
  phase = m.phase;
  emit('party:phase', { phase: m.phase, files: m.files || [] });
}

function onVoteOpen(m) {
  if (mode !== 'client') return;
  lastHostSeen = Date.now();
  emit('party:voteOpen', { reqId: m.reqId, file: m.file, byUser: m.byUser, timeoutMs: m.timeoutMs });
}

function onVoteResult(m) {
  if (mode !== 'client') return;
  lastHostSeen = Date.now();
  emit('party:voteResult', { reqId: m.reqId, result: m.result, file: m.file, yes: m.yes, no: m.no });
}

/* ---------- публичный API ---------- */

function start(eventSink, username, pendingFile) {
  emit = eventSink || emit;
  if (pendingFile) pendingPath = pendingFile;
  me = { id: me.id || makeId(), user: username || 'Player' };
  if (usock) return;
  // Порт 57410 — эксклюзивный у хоста. Занят (на этом ПК уже хостят) →
  // гостевой режим на эфемерном порту: можно только присоединяться.
  const s = dgram.createSocket({ type: 'udp4' });
  usock = s; // send до bind сам вызовет авто-привязку
  s.on('message', onDatagram);
  s.on('error', (e) => {
    if (!bindDone && String(e.code) === 'EADDRINUSE') {
      log('порт ' + PORT + ' занят → гостевой режим');
      canHost = false;
      try { s.close(); } catch (er) {}
      const s2 = dgram.createSocket({ type: 'udp4' });
      s2.on('message', onDatagram);
      s2.on('error', (er2) => log('socket error', er2.message));
      s2.bind(0, () => {
        usock = s2; myUport = s2.address().port;
        try { s2.setBroadcast(true); } catch (ee) {}
        log('гостевой udp:' + myUport);
        bindResolve();
      });
      return;
    }
    log('socket error', e.message);
  });
  s.bind(PORT, () => {
    canHost = true; myUport = PORT;
    try { s.setBroadcast(true); } catch (e) {}
    log('порт хоста udp:' + PORT + ' — можно создавать комнаты');
    bindResolve();
  });
  startTicker();
}

let bindDone = false;
let bindResolve = null;
const bindReady = new Promise((res) => { bindResolve = () => { bindDone = true; res(); }; });

let tickerStarted = false;
function startTicker() {
  if (tickerStarted) return;
  tickerStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, r] of discovered) if (now - r.ts > PEER_TIMEOUT) discovered.delete(id);
    if (mode === 'host') {
      for (const [pid, p] of peers) {
        if (now - p.lastSeen > PEER_TIMEOUT) {
          peers.delete(pid);
          doneSet.delete(pid);
          const ev = { kind: 'leave', user: p.user };
          hostBroadcast({ t: 'event', ...ev });
          emit('party:event', ev);
          emit('party:status', status());
        }
      }
    }
    if (mode === 'client' && hostAddr) {
      send({ t: 'ping', room: room.id, peer: me.id, user: me.user }, hostAddr.ip, hostAddr.port);
      if (now - lastHostSeen > HOST_TIMEOUT) {
        const nm = room && room.name;
        stop('host-lost');
        emit('party:event', { kind: 'host-lost', user: nm || 'хост' });
      }
    }
    if (mode !== 'off' && discovered.size) emit('party:rooms', roomsList());
  }, ANNOUNCE_MS);
}

function stop(reason) {
  if (mode === 'client' && hostAddr && room) send({ t: 'leave', room: room.id, peer: me.id }, hostAddr.ip, hostAddr.port);
  for (const [, rec] of pending) clearTimeout(rec.timer);
  for (const [, rec] of reports) if (rec.timer) clearTimeout(rec.timer);
  pending.clear(); reports.clear(); peers.clear(); filesMap.clear(); discovered.clear();
  doneSet.clear(); votes.clear(); phase = 'lobby'; joinedOk = false;
  clearPendingFile();
  const was = mode;
  mode = 'off'; room = null; hostAddr = null;
  if (was !== 'off') emit('party:closed', { reason: reason || 'leave' });
}

async function create({ name, buildId, user, review }) {
  await bindReady;
  if (!canHost) return { ok: false, error: 'port-busy' };
  me.user = user || me.user;
  room = { id: 'room-' + makeId().slice(0, 8), name: (name || 'Совместная сборка').slice(0, 40), buildId, build: (name || 'Совместная сборка') };
  mode = 'host';
  phase = 'lobby';
  doneSet.clear(); votes.clear();
  if (review) reviewCfg = { enabled: !!review.enabled, sec: Math.max(10, Math.min(600, parseInt(review.sec, 10) || 60)) };
  peers.clear(); filesMap.clear();
  emit('party:status', status());
  return { roomId: room.id };
}

// хост нажал «Начать!» — лобби переходит к сборке
function startBuilding() {
  if (mode !== 'host' || phase !== 'lobby') return { ok: false };
  phase = 'building';
  hostBroadcast({ t: 'phase', phase: 'building' });
  emit('party:phase', { phase: 'building', files: [] });
  emit('party:status', status());
  return { ok: true };
}

async function join({ roomId, ip, port, user, buildId }) {
  await bindReady;
  me.user = user || me.user;
  const d = discovered.get(roomId) || {};
  room = { id: roomId, name: d.name || 'Комната', buildId, build: d.build };
  // порт из объявления = персональный юникаст-порт хоста
  hostAddr = { ip: ip || d.ip, port: port || d.uport || null };
  if (!hostAddr.ip || !hostAddr.port) { stop('no-host'); return { ok: false }; }
  mode = 'client';
  phase = 'lobby';
  joinedOk = false;
  lastHostSeen = Date.now();
  let tries = 0;
  const tryJoin = () => {
    if (mode !== 'client' || joinedOk) return;
    if (++tries > 5) { stop('no-answer'); return; }
    send({ t: 'join_req', room: roomId, peer: me.id, user: me.user }, hostAddr.ip, hostAddr.port);
  };
  tryJoin();
  const retry = setInterval(() => {
    if (mode !== 'client' || joinedOk) { clearInterval(retry); return; }
    tryJoin();
    if (tries > 5) clearInterval(retry);
  }, 1300);
  emit('party:status', status());
  return { ok: true };
}

// хост отвечает на заявку входа
function answer({ reqId, ok }) {
  if (mode !== 'host') return;
  const rec = pending.get(reqId);
  if (!rec || rec.kind !== 'join') return;
  clearTimeout(rec.timer);
  pending.delete(reqId);
  if (ok) {
    peers.set(rec.peer, { user: rec.user, ip: rec.ip, port: rec.port, lastSeen: Date.now(), events: [] });
    const ev = { kind: 'join', user: rec.user };
    hostBroadcast({ t: 'event', ...ev });
    emit('party:event', ev);
    sendStateTo(rec.ip, rec.port);
    send({ t: 'join_ok', room: room.id }, rec.ip, rec.port);
    emit('party:status', status());
  } else {
    send({ t: 'join_no', room: room.id }, rec.ip, rec.port);
  }
}

// владелец мода отвечает на запрос удаления (клиент-владелец или сам хост)
function delAnswer({ reqId, ok }) {
  const rec = pending.get(reqId);
  if (!rec) return;
  if (rec.kind === 'delOwner') {
    clearTimeout(rec.timer);
    pending.delete(reqId);
    rawSend({ t: ok ? 'del_ok' : 'del_no', room: room ? room.id : '', reqId }, rec.hostIp, rec.hostPort);
    return;
  }
  if (rec.kind === 'delHostOwned') {
    // хост — владелец файла; решаем сами и отвечаем просителю
    clearTimeout(rec.timer);
    pending.delete(reqId);
    const okRes = !!ok;
    if (okRes) hostRemoveFile(rec.key, rec.requester.user);
    send({ t: 'del_result', room: room.id, reqId, result: okRes ? 'ok' : 'no', file: rec.file }, rec.requester.ip, rec.requester.port);
  }
}

// сообщить сети о своей установке (работает и для клиента, и для хоста)
function reportAdd(file) {
  if (mode === 'client' && hostAddr) {
    send({ t: 'add', room: room.id, peer: me.id, user: me.user, file }, hostAddr.ip, hostAddr.port);
    return { ok: true };
  }
  if (mode === 'host') { hostAdd(file); return { ok: true }; }
  return { ok: false };
}

// запрос на удаление файла; возвращает {mode:'free'|'pending'|'no-room'}
function delReq(file) {
  if (mode === 'off') return { mode: 'no-room' };
  if (mode === 'host') {
    const key = file.type + '|' + file.filename;
    const f = filesMap.get(key);
    if (!f || f.addedBy === me.id) {
      if (f) hostRemoveFile(key, me.user);
      return { mode: 'free' };
    }
    const owner = peers.get(f.addedBy);
    if (!owner) { hostRemoveFile(key, me.user); return { mode: 'free' }; } // владелец вышел
    const reqId = makeId();
    const rec = {
      kind: 'delHost', key,
      timer: setTimeout(() => {
        pending.delete(reqId);
        emit('party:delResult', { reqId, result: 'timeout', file, byUser: f.addedByUser });
      }, DEL_TIMEOUT)
    };
    pending.set(reqId, rec);
    send({ t: 'del_ask', room: room.id, reqId, byUser: me.user, file: { filename: f.filename, type: f.type, title: f.title } }, owner.ip, owner.port);
    return { mode: 'pending', reqId };
  }
  // клиент
  const reqId = makeId();
  const rec = {
    kind: 'delClient',
    timer: setTimeout(() => {
      pending.delete(reqId);
      emit('party:delResult', { reqId, result: 'timeout', file });
    }, DEL_TIMEOUT + 4000)
  };
  pending.set(reqId, rec);
  send({ t: 'del_req', room: room.id, peer: me.id, user: me.user, file, reqId }, hostAddr.ip, hostAddr.port);
  return { mode: 'pending', reqId };
}

function roomsList() {
  const now = Date.now();
  return Array.from(discovered.values())
    .filter(r => now - r.ts < PEER_TIMEOUT)
    .map(r => ({ id: r.id, name: r.name, hostUser: r.hostUser, members: r.members, build: r.build, ip: r.ip, port: r.uport }));
}

// опрос сети гостями: хосты отвечают announce → список комнат обновится
function discoverNow() {
  if (mode !== 'off' && mode !== 'client') return;
  discover();
}

// «Я закончил» — клиент шлёт хосту, хот отмечает себя
function done() {
  if (mode === 'client' && hostAddr) {
    send({ t: 'done', room: room.id, peer: me.id, user: me.user }, hostAddr.ip, hostAddr.port);
    return { ok: true };
  }
  if (mode === 'host' && phase === 'building' && !doneSet.has(me.id)) {
    doneSet.add(me.id);
    const ev = { kind: 'done', user: me.user };
    hostBroadcast({ t: 'event', ...ev });
    emit('party:event', ev);
    emitDoneUpdate();
    if (allDone()) enterReview();
  }
  return { ok: true };
}

// голосование: клиент отдаёт голос, хост голосует напрямую
function vote(reqId, yes) {
  if (mode === 'client' && hostAddr) {
    send({ t: 'vote', room: room.id, peer: me.id, user: me.user, reqId, yes }, hostAddr.ip, hostAddr.port);
    return { ok: true };
  }
  if (mode === 'host') {
    const rec = votes.get(reqId);
    if (rec && !rec.votes.has(me.id)) {
      rec.votes.set(me.id, !!yes);
      if (rec.votes.size >= rec.total) closeVote(reqId);
    }
    return { ok: true };
  }
  return { ok: false };
}

// клиент просит запустить голосование за удаление файла
function voteStartReq(file) {
  if (mode === 'client' && hostAddr) {
    send({ t: 'vote_req', room: room.id, peer: me.id, user: me.user, file }, hostAddr.ip, hostAddr.port);
    return { ok: true };
  }
  if (mode === 'host') { voteStart(file, me.user); return { ok: true }; }
  return { ok: false };
}

function chat(text) {
  if (mode === 'client' && hostAddr) {
    send({ t: 'chat', room: room.id, peer: me.id, user: me.user, text: String(text || '').slice(0, 300) }, hostAddr.ip, hostAddr.port);
    return { ok: true };
  }
  if (mode === 'host') { hostChat(text); return { ok: true }; }
  return { ok: false };
}

function status() {
  return {
    mode, phase, room: room ? { id: room.id, name: room.name, buildId: room.buildId } : null,
    me: me.id, user: me.user,
    members: mode === 'host' ? Array.from(peers.values()).map(p => p.user) : [],
    fileCount: filesMap.size,
    done: doneSet.has(me.id),
    review: reviewCfg
  };
}

function setUser(u) { if (u) me.user = u; }

module.exports = { start, stop, create, join, leave: () => stop('leave'), answer, delAnswer, reportAdd, delReq, roomsList, discoverNow, status, setUser, done, finalize, startBuilding, vote, voteStartReq, chat, kick, report, repVote, clearPendingFile, uport: () => myUport, PORT };
