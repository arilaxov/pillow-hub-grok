'use strict';
/* Pillow Hub — сервер + Telegram-бот в одном процессе. Без зависимостей (Node 18+). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// ---------- env ----------
(function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) { /* .env необязателен */ }
})();

const TOKEN = process.env.BOT_TOKEN || '';
const PORT = +process.env.PORT || 8765;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const TG_BASE = (process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/+$/, '');
const SESSION_TTL = 30 * 864e5;
const AUTH_TTL = 10 * 60e3;
const HTTPS_URL = /^https:\/\//i.test(PUBLIC_URL);

const EXT_NAME = process.env.EXT_FILE || 'Pillow-v192.zip';
const EXT_FILE = path.join(PUBLIC, 'downloads', EXT_NAME);
const EXT_LABEL = (EXT_NAME.match(/v\d+/) || ['v192'])[0];
const DOWNLOADS = { [EXT_NAME]: EXT_FILE };
// для проверки обновлений внутри панели (js/update.js): версия из js/panel.js расширения
const PANEL_VERSION = process.env.PANEL_VERSION || '1.1.1';
const FEEDBACK_CHAT_ID = process.env.FEEDBACK_CHAT_ID || '';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const rnd = (n = 24) => crypto.randomBytes(n).toString('base64url');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

// ---------- db (json) ----------
let db = { counter: 0, users: {}, sessions: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (_) {}
let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db));
      fs.renameSync(DB_FILE + '.tmp', DB_FILE);
    } catch (e) { log('db save error', e.message); }
  }, 200);
}
function upsertUser(from) {
  let u = db.users[from.id];
  if (!u) { u = db.users[from.id] = { id: from.id, number: ++db.counter, joined: Date.now() }; }
  u.username = from.username || null;
  u.first_name = from.first_name || '';
  u.lang = from.language_code || u.lang || 'en';
  saveDb();
  return u;
}
const pubUser = u => ({ id: u.id, username: u.username, name: u.first_name, number: u.number });

// ---------- Telegram API ----------
async function tg(method, params = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const isForm = params instanceof FormData;
    const res = await fetch(`${TG_BASE}/bot${TOKEN}/${method}`, {
      method: 'POST', signal: ctrl.signal,
      headers: isForm ? undefined : { 'content-type': 'application/json' },
      body: isForm ? params : JSON.stringify(params),
    });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) { const e = new Error(j.description || `HTTP ${res.status}`); e.code = j.error_code; throw e; }
    return j.result;
  } finally { clearTimeout(t); }
}

// ---------- тексты бота ----------
const RU = new Set(['ru', 'uk', 'be', 'kk']);
const L = lang => (RU.has(String(lang || '').slice(0, 2)) ? 'ru' : 'en');
const TXT = {
  ru: {
    welcome: n => `<b>Pillow Hub</b> 🫧\nПривет, ${n}! Расширение Pillow для After Effects и инструменты для видео. Всё доступно бесплатно.`,
    ok: (n, num) => `✅ <b>Готово, ${n}!</b>\nВход в Pillow Hub выполнен.`,
    okNoLink: (n, num) => `<b>Pillow Hub</b> 🫧\nПривет, ${n}!`,
    expired: 'Эта ссылка устарела. Вернись на сайт и открой бота ещё раз.',
    tools: '🛠 <b>Tools</b>: Upscaler и Beat Marker. Enhanced Method — подготовка видео с Pillow AI. Файлы обрабатываются в браузере.',
    extCaption: () => `Pillow ${EXT_LABEL} — расширение для After Effects.\nУстановка: INSTALL-MAC.txt / INSTALL-WINDOWS.txt в архиве` + (HTTPS_URL ? ` или ${PUBLIC_URL}/extension.html#install` : ''),
    help: '/start — Pillow Hub\n/app — открыть Mini App\n/extension — получить расширение\n/tools — инструменты\n/method — Enhanced Method\n/status — мой профиль',
    status: (n, num, since) => `<b>Pillow Hub · #${String(num).padStart(4, '0')}</b>\n${n}\nС нами с ${since}`,
    noApp: 'Mini App включится, когда у сервера будет HTTPS-адрес (PUBLIC_URL).',
    btnApp: '🫧 Открыть Mini App', btnSite: '🌐 Сайт', btnExt: '🧩 Расширение', btnTools: '🛠 Tools', btnMethod: '✳ Enhanced Method',
  },
  en: {
    welcome: n => `<b>Pillow Hub</b> 🫧\nHi ${n}! Get Pillow for After Effects and local video tools. Everything is free to use.`,
    ok: (n, num) => `✅ <b>Ready, ${n}!</b>\nYou are signed in to Pillow Hub.`,
    okNoLink: (n, num) => `<b>Pillow Hub</b> 🫧\nHi ${n}!`,
    expired: 'This link has expired. Go back to the site and open the bot again.',
    tools: '🛠 <b>Tools</b>: Upscaler and Beat Marker. Enhanced Method prepares video with Pillow AI. Files are processed in your browser.',
    extCaption: () => `Pillow ${EXT_LABEL} — After Effects extension.\nInstall: INSTALL-MAC.txt / INSTALL-WINDOWS.txt in the archive` + (HTTPS_URL ? ` or ${PUBLIC_URL}/extension.html#install` : ''),
    help: '/start — Pillow Hub\n/app — open Mini App\n/extension — get the extension\n/tools — tools\n/method — Enhanced Method\n/status — my profile',
    status: (n, num, since) => `<b>Pillow Hub · #${String(num).padStart(4, '0')}</b>\n${n}\nMember since ${since}`,
    noApp: 'Mini App will be enabled once the server has an HTTPS address (PUBLIC_URL).',
    btnApp: '🫧 Open Mini App', btnSite: '🌐 Website', btnExt: '🧩 Extension', btnTools: '🛠 Tools', btnMethod: '✳ Enhanced Method',
  },
};

// ---------- auth: ожидающие входы с сайта ----------
const pending = new Map(); // token -> {created, uid, verified}
setInterval(() => { const now = Date.now(); for (const [k, v] of pending) if (now - v.created > AUTH_TTL) pending.delete(k); }, 60e3).unref();

function menuKeyboard(lang) {
  const t = TXT[L(lang)]; const rows = [];
  if (HTTPS_URL) rows.push([{ text: t.btnApp, web_app: { url: PUBLIC_URL + '/?tg=1' } }]);
  if (HTTPS_URL) rows.push([{ text: t.btnSite, url: PUBLIC_URL + '/' }]);
  const last = [{ text: t.btnExt, callback_data: 'ext' }];
  if (HTTPS_URL) last.push({ text: t.btnTools, url: PUBLIC_URL + '/tools.html' });
  rows.push(last);
  return { inline_keyboard: rows };
}
async function completeLogin(chatId, from, payload, editMsg) {
  const lang = from.language_code; const t = TXT[L(lang)];
  const user = upsertUser(from);
  const name = esc(from.first_name || from.username || '');
  let p = null;
  const getFile = payload === 'get';
  if (payload && payload !== '-' && !getFile) {
    p = pending.get(payload);
    if (!p || Date.now() - p.created > AUTH_TTL) {
      return send(chatId, t.expired, undefined, editMsg);
    }
  }
  if (p) { p.uid = from.id; p.verified = true; }
  if (!user.verified) { user.verified = true; saveDb(); }
  await send(chatId, p ? t.ok(name, user.number) : t.okNoLink(name, user.number), menuKeyboard(lang), editMsg);
  if (getFile) return sendExtension(chatId, lang);
}

async function send(chatId, text, markup, editMsg) {
  const params = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (markup) params.reply_markup = markup;
  if (editMsg) {
    try { return await tg('editMessageText', { ...params, message_id: editMsg }); }
    catch (e) { if (/not modified/i.test(e.message)) return; /* иначе — шлём новое */ }
  }
  return tg('sendMessage', params);
}

function countDownload() { db.downloads = (db.downloads || 0) + 1; saveDb(); }
async function sendExtension(chatId, lang) {
  const t = TXT[L(lang)];
  countDownload();
  // после первой отправки Telegram отдаёт file_id — дальше шлём по нему, без повторной загрузки 8 МБ
  const cached = db.extFile && db.extFile.name === EXT_NAME && db.extFile.id;
  if (cached) {
    try { return await tg('sendDocument', { chat_id: chatId, document: cached, caption: t.extCaption() }); }
    catch (e) { log('cached file_id failed, re-uploading:', e.message); db.extFile = null; }
  }
  const buf = fs.readFileSync(EXT_FILE);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', t.extCaption());
  form.append('document', new Blob([buf], { type: 'application/zip' }), EXT_NAME);
  const sent = await tg('sendDocument', form, 60000);
  if (sent && sent.document && sent.document.file_id) { db.extFile = { name: EXT_NAME, id: sent.document.file_id }; saveDb(); }
  return sent;
}

async function onMessage(m) {
  if (!m.chat || m.chat.type !== 'private' || !m.from) return;
  const lang = m.from.language_code; const t = TXT[L(lang)];
  const text = (m.text || '').trim();
  const cmd = (text.match(/^\/([a-z_]+)(?:@\w+)?(?:\s+(.*))?$/i) || []);
  const name = esc(m.from.first_name || m.from.username || '');
  upsertUser(m.from);

  switch ((cmd[1] || '').toLowerCase()) {
    case 'start': {
      const payload = (cmd[2] || '').trim();
      if (payload.startsWith('login_') || payload === 'get') return completeLogin(m.chat.id, m.from, payload);
      return completeLogin(m.chat.id, m.from, null);
    }
    case 'app':
      if (!HTTPS_URL) return send(m.chat.id, t.noApp);
      return send(m.chat.id, '🫧', { inline_keyboard: [[{ text: t.btnApp, web_app: { url: PUBLIC_URL + '/?tg=1' } }]] });
    case 'extension': return sendExtension(m.chat.id, lang);
    case 'method': return send(m.chat.id, t.btnMethod, HTTPS_URL ? { inline_keyboard: [[{ text: t.btnMethod, url: PUBLIC_URL + '/method.html' }]] } : undefined);
    case 'tools': return send(m.chat.id, t.tools, HTTPS_URL ? { inline_keyboard: [[{ text: t.btnTools, url: PUBLIC_URL + '/tools.html' }]] } : undefined);
    case 'status': {
      const u = db.users[m.from.id];
      const since = new Date(u.joined).toLocaleDateString(L(lang) === 'ru' ? 'ru-RU' : 'en-GB');
      return send(m.chat.id, t.status(name, u.number, since));
    }
    case 'help': return send(m.chat.id, t.help);
    default: return send(m.chat.id, t.welcome(name), menuKeyboard(lang));
  }
}

async function onCallback(q) {
  const lang = q.from.language_code;
  const chatId = q.message && q.message.chat.id;
  const data = q.data || '';
  upsertUser(q.from);
  if (data === 'ext') {
    await tg('answerCallbackQuery', { callback_query_id: q.id });
    return sendExtension(chatId, lang);
  }
  return tg('answerCallbackQuery', { callback_query_id: q.id });
}

let botInfo = null;
async function startBot() {
  if (!TOKEN) { log('⚠️  BOT_TOKEN не задан — бот выключен (сайт и скачивание работают без Telegram)'); return; }
  try {
    botInfo = await tg('getMe');
    log(`🤖 Бот @${botInfo.username} подключён`);
    await tg('deleteWebhook', { drop_pending_updates: false }).catch(() => {});
    await tg('setMyCommands', { commands: [
      { command: 'start', description: 'Открыть Pillow Hub' },
      { command: 'app', description: 'Открыть Mini App' },
      { command: 'extension', description: 'Получить расширение Pillow' },
      { command: 'tools', description: 'Tools: Upscaler, Beat Marker' },
      { command: 'method', description: 'Enhanced Method · Pillow AI' },
      { command: 'status', description: 'Мой профиль' },
    ] }).catch(e => log('setMyCommands:', e.message));
    await tg('setMyShortDescription', { short_description: 'Pillow — расширение для After Effects: кривые, отскоки, текст, звуки, биты и Liquid Glass 🫧' }).catch(() => {});
    await tg('setChatMenuButton', { menu_button: HTTPS_URL
      ? { type: 'web_app', text: 'Pillow Hub', web_app: { url: PUBLIC_URL + '/?tg=1' } }
      : { type: 'commands' } }).catch(e => log('setChatMenuButton:', e.message));
    if (!HTTPS_URL) log('ℹ️  PUBLIC_URL (https) не задан — кнопка Mini App отключена. Вход с сайта через бота работает.');
  } catch (e) { log('❌ Не удалось запустить бота:', e.message); }
  poll();
}
async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const ups = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 40000);
      for (const u of ups) {
        offset = u.update_id + 1;
        (u.message ? onMessage(u.message) : u.callback_query ? onCallback(u.callback_query) : Promise.resolve())
          .catch(e => log('update error:', e.message));
      }
    } catch (e) {
      log('getUpdates:', e.message + (e.code === 409 ? ' (запущен второй экземпляр бота?)' : ''));
      await sleep(e.code === 409 ? 10000 : 3000);
    }
  }
}

// ---------- Mini App initData ----------
function validateInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash'); if (!hash) return null;
    params.delete('hash');
    const str = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    const calc = crypto.createHmac('sha256', secret).update(str).digest('hex');
    const a = Buffer.from(calc), b = Buffer.from(hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const age = Date.now() / 1000 - Number(params.get('auth_date'));
    if (!Number.isFinite(age) || age > 86400 || age < -60) return null;
    const user = JSON.parse(params.get('user') || 'null');
    return user && user.id ? user : null;
  } catch (_) { return null; }
}

// ---------- сессии ----------
function newSession(uid) {
  const token = rnd(32);
  db.sessions[sha(token)] = { uid, created: Date.now(), checked: Date.now() };
  saveDb();
  return token;
}
function readToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)ph_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
async function getSession(req) {
  const token = readToken(req); if (!token) return null;
  const key = sha(token); const s = db.sessions[key];
  if (!s || Date.now() - s.created > SESSION_TTL) { if (s) { delete db.sessions[key]; saveDb(); } return null; }
  const user = db.users[s.uid];
  return user ? { token, user } : null;
}
const isSecure = req => (req.headers['x-forwarded-proto'] || '').includes('https') || HTTPS_URL && (req.headers.host || '').includes(PUBLIC_URL.replace(/^https:\/\//, ''));
function cookie(req, token) {
  return `ph_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000 | 0}${isSecure(req) ? '; Secure' : ''}`;
}

// ---------- одноразовые билеты на скачивание ----------
const tickets = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of tickets) if (now > v.exp) tickets.delete(k); }, 60e3).unref();

// ---------- rate limit ----------
const hits = new Map();
function limited(req, key, max, windowMs) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const k = key + ip; const now = Date.now();
  const arr = (hits.get(k) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(k, arr);
  return arr.length > max;
}
setInterval(() => hits.clear(), 10 * 60e3).unref();

// ---------- http ----------
const GZIP_EXT = new Set(['.html', '.css', '.js', '.mjs', '.svg', '.json', '.wasm']);
const gzCache = new Map();
const MIME = { '.wasm': 'application/wasm', '.mjs': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webp': 'image/webp', '.json': 'application/json', '.zip': 'application/zip' };

function json(res, code, obj, extra = {}) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(obj));
}
function readBody(req, max = 16384) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > max) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function serveFile(req, res, file, extraHeaders = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    const vendor = file.startsWith(path.join(PUBLIC, 'vendor') + path.sep);
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': vendor ? 'public, max-age=604800' : ['.html','.css','.js','.mjs','.json'].includes(ext) ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff', vary: 'Accept-Encoding', ...extraHeaders,
    };
    // сжимаем текст и wasm (ядро ffmpeg: 32 МБ → ~10 МБ); результат держим в памяти
    if (GZIP_EXT.has(ext) && st.size > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      const key = file + ':' + st.mtimeMs;
      let gz = gzCache.get(key);
      if (!gz) { try { gz = zlib.gzipSync(fs.readFileSync(file), { level: 6 }); gzCache.set(key, gz); } catch (_) { gz = null; } }
      if (gz) {
        res.writeHead(200, { ...headers, 'content-encoding': 'gzip', 'content-length': gz.length });
        return res.end(req.method === 'HEAD' ? undefined : gz);
      }
    }
    res.writeHead(200, { ...headers, 'content-length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

async function api(req, res, url) {
  const p = url.pathname;

  // /api/config.json is the same payload as a static file, so GitHub Pages can serve it.
  if ((p === '/api/config' || p === '/api/config.json') && req.method === 'GET') {
    return json(res, 200, {
      bot: botInfo ? botInfo.username : (process.env.BOT_USERNAME || 'pillow_hub_bot'),
      botEnabled: !!TOKEN, miniApp: HTTPS_URL, downloadsOpen: true,
      stats: { downloads: db.downloads || 0, members: Object.values(db.users).filter(u => u.verified).length },
    });
  }
  if (p === '/api/me' && req.method === 'GET') {
    const s = await getSession(req);
    return json(res, 200, s ? { ok: true, user: pubUser(s.user) } : { ok: false });
  }
  if (p === '/api/logout' && req.method === 'POST') {
    const t = readToken(req); if (t) { delete db.sessions[sha(t)]; saveDb(); }
    return json(res, 200, { ok: true }, { 'set-cookie': 'ph_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
  }
  if (p === '/api/auth/start' && req.method === 'POST') {
    if (!TOKEN) return json(res, 503, { error: 'bot_disabled' });
    if (limited(req, 'start', 20, 60e3)) return json(res, 429, { error: 'rate_limited' });
    const token = 'login_' + rnd(16);
    pending.set(token, { created: Date.now(), verified: false, uid: null });
    const bot = botInfo ? botInfo.username : (process.env.BOT_USERNAME || 'pillow_hub_bot');
    return json(res, 200, { token, link: `https://t.me/${bot}?start=${token}`, deepLink: `tg://resolve?domain=${bot}&start=${token}` });
  }
  if (p === '/api/auth/status' && req.method === 'GET') {
    if (limited(req, 'status', 240, 60e3)) return json(res, 429, { error: 'rate_limited' });
    const token = url.searchParams.get('token') || '';
    const e = pending.get(token);
    if (!e || Date.now() - e.created > AUTH_TTL) return json(res, 200, { status: 'expired' });
    if (!e.verified) return json(res, 200, { status: 'pending' });
    pending.delete(token); // одноразово
    const session = newSession(e.uid);
    return json(res, 200, { status: 'verified', session, user: pubUser(db.users[e.uid]) }, { 'set-cookie': cookie(req, session) });
  }
  if (p === '/api/auth/webapp' && req.method === 'POST') {
    if (limited(req, 'webapp', 60, 60e3)) return json(res, 429, { error: 'rate_limited' });
    let body; try { body = await readBody(req); } catch (_) { return json(res, 400, { error: 'bad_request' }); }
    const tgUser = TOKEN ? validateInitData(String(body.initData || '')) : null;
    if (!tgUser) return json(res, 401, { error: 'bad_init_data' });
    const user = upsertUser(tgUser);
    if (!user.verified) { user.verified = true; saveDb(); }
    const session = newSession(tgUser.id);
    return json(res, 200, { ok: true, session, user: pubUser(user) }, { 'set-cookie': cookie(req, session) });
  }
  if (p === '/api/download-ticket' && req.method === 'POST') {
    let body; try { body = await readBody(req); } catch (_) { return json(res, 400, { error: 'bad_request' }); }
    const file = String(body.file || '');
    if (!DOWNLOADS[file]) return json(res, 404, { error: 'no_such_file' });
    const t = rnd(18); tickets.set(t, { file, exp: Date.now() + 5 * 60e3 });
    return json(res, 200, { url: `/dl/${t}/${encodeURIComponent(file)}` });
  }
  return json(res, 404, { error: 'not_found' });
}

// ---------- API для самой панели Pillow (js/config.js → server) ----------
// CEP-панель ходит с file:// — поэтому CORS открыт только на этих двух адресах.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type', 'access-control-max-age': '86400' };
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);
async function panelApi(req, res, url) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (url.pathname === '/version' && req.method === 'GET') {
    return json(res, 200, {
      version: PANEL_VERSION,
      notes: clip(process.env.PANEL_NOTES || '', 600),
      url: HTTPS_URL ? PUBLIC_URL + '/extension.html#download' : 'https://t.me/' + (botInfo ? botInfo.username : 'pillow_hub_bot'),
    }, CORS);
  }
  if (url.pathname === '/feedback' && req.method === 'POST') {
    if (limited(req, 'fb', 5, 10 * 60e3)) return json(res, 429, { error: 'rate_limited' }, CORS);
    if (!TOKEN || !FEEDBACK_CHAT_ID) return json(res, 503, { error: 'feedback_off' }, CORS); // панель сама скопирует текст и откроет чат
    let m; try { m = await readBody(req, 8192); } catch (_) { return json(res, 400, { error: 'bad_request' }, CORS); }
    const type = m.type === 'review' ? 'review' : m.type === 'problem' ? 'problem' : '';
    const text = clip(m.text, 2000);
    if (!type || text.length < 3) return json(res, 400, { error: 'bad_request' }, CORS);
    const rating = Math.max(0, Math.min(5, parseInt(m.rating, 10) || 0));
    if (type === 'review' && !rating) return json(res, 400, { error: 'no_rating' }, CORS);
    const parts = [type === 'review' ? `⭐ <b>Отзыв о Pillow</b> ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}` : '🛠 <b>Проблема в Pillow</b>', '', esc(text)];
    const name = clip(m.name, 60); if (name) parts.push('', '— ' + esc(name));
    const diag = clip(m.diag, 1500); if (diag) parts.push('', '<pre>' + esc(diag) + '</pre>');
    const ver = clip(m.version, 20); if (ver) parts.push('', '<i>Pillow ' + esc(ver) + '</i>');
    try { await tg('sendMessage', { chat_id: FEEDBACK_CHAT_ID, text: parts.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true }); }
    catch (e) { log('feedback → telegram:', e.message); return json(res, 502, { error: 'telegram_failed' }, CORS); }
    return json(res, 200, { ok: true }, CORS);
  }
  return json(res, 405, { error: 'method_not_allowed' }, CORS);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (['/method','/tiktok-method.html','/upload-method'].includes(url.pathname)) { res.writeHead(302, { location: '/method.html', 'cache-control': 'no-cache' }); return res.end(); }
    if (url.pathname === '/ai') { res.writeHead(302, { location: '/ai.html', 'cache-control': 'no-cache' }); return res.end(); }
    if (url.pathname === '/version' || url.pathname === '/feedback') return await panelApi(req, res, url);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

    // Compressed local WASM, also available through the original raw URL.
    if (url.pathname === '/vendor/core/ffmpeg-core.wasm') {
      return serveFile(req, res, path.join(PUBLIC, 'vendor/core/ffmpeg-core.wasm.gz'), {
        'content-type': 'application/wasm',
        'content-encoding': 'gzip',
        'cache-control': 'public, max-age=604800',
      });
    }

    // скачивание по одноразовому билету (работает и в Mini App / внешнем браузере)
    let m = url.pathname.match(/^\/dl\/([\w-]+)\/([^/]+)$/);
    if (m) {
      const t = tickets.get(m[1]); const name = decodeURIComponent(m[2]);
      if (!t || Date.now() > t.exp || t.file !== name) { res.writeHead(403); return res.end('Link expired'); }
      if (req.method === 'GET') countDownload();
      return serveFile(req, res, DOWNLOADS[name], { 'content-disposition': `attachment; filename="${name}"` });
    }

    let rel; try { rel = decodeURIComponent(url.pathname); } catch (_) { res.writeHead(400); return res.end(); }
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    if (path.relative(PUBLIC, file).split(path.sep)[0] === 'downloads') {
      const name = path.relative(path.join(PUBLIC, 'downloads'), file);
      if (!DOWNLOADS[name]) { res.writeHead(404); return res.end('Not found'); }
      if (req.method === 'GET') countDownload();
      return serveFile(req, res, file, { 'content-disposition': `attachment; filename="${path.basename(file)}"` });
    }
    return serveFile(req, res, file);
  } catch (e) {
    log('http error', e.message);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.listen(PORT, HOST, () => {
  log(`Pillow Hub: http://${HOST}:${PORT}/${PUBLIC_URL ? '   public: ' + PUBLIC_URL : ''}`);
  startBot();
});
process.on('unhandledRejection', e => log('unhandledRejection', e && e.message));
