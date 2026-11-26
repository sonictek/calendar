'use strict';
/*
 * Daily Diary – kiosk display + remote admin panel.
 * No external dependencies: run with `node server.js`.
 *
 *   node server.js                         start the server
 *   node server.js add-user <name> <pw>    add an admin user (or reset their password)
 *   node server.js remove-user <name>      remove an admin user
 *   node server.js show-display-link       print the display key
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Shared = require('./public/shared.js');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SECURE_COOKIE = process.env.SECURE_COOKIE === '1';
const SESSION_DAYS = 30;
const APP_VERSION = String(Date.now());

// Helpers that avoid newer Node APIs, so the app runs on Node 10.12 and later.
function randomToken(bytes) {
  return crypto.randomBytes(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomId() {
  const h = crypto.randomBytes(16).toString('hex');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

/* ---------- storage ---------- */

function defaultSettings() {
  return {
    personName: '',
    homeMessage: '',
    clock24: false,
    idleMinutes: 5,
    calendarWeeks: 4,
    displayKey: randomToken(18)
  };
}

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let data = { users: [], events: [], messages: [], settings: defaultSettings(), sessions: {} };
  if (fs.existsSync(DB_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    data = Object.assign(data, loaded);
    data.settings = Object.assign(defaultSettings(), loaded.settings || {});
    data.sessions = loaded.sessions || {};
    if (!Array.isArray(data.messages)) data.messages = [];
  }
  return data;
}

let db = loadDb();
let dataVersion = crypto.randomBytes(6).toString('hex');

// Older versions had a single home-screen message in settings: move it into the
// scheduled messages list as an always-on message.
if (db.settings.homeMessage) {
  db.messages.push({
    id: randomId(), text: db.settings.homeMessage, days: [0, 1, 2, 3, 4, 5, 6],
    start: '', end: '', enabled: true, createdBy: 'earlier setting', createdAt: new Date().toISOString()
  });
  db.settings.homeMessage = '';
  saveDb();
}

function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
  dataVersion = crypto.randomBytes(6).toString('hex');
}

/* ---------- passwords + sessions ---------- */

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(pw, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function findUser(name) {
  const n = String(name || '').trim().toLowerCase();
  return db.users.find(u => u.username.toLowerCase() === n);
}

function pruneSessions() {
  const now = Date.now();
  for (const [tok, s] of Object.entries(db.sessions)) {
    if (s.expires < now || !findUser(s.username)) delete db.sessions[tok];
  }
}

/* ---------- CLI commands ---------- */

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'add-user') {
  const [name, pw] = args;
  if (!name || !pw || pw.length < 8) {
    console.error('Usage: node server.js add-user <username> <password (8+ chars)>');
    process.exit(1);
  }
  const existing = findUser(name);
  if (existing) existing.password = hashPassword(pw);
  else db.users.push({ username: name.trim(), password: hashPassword(pw), created: new Date().toISOString() });
  saveDb();
  console.log(existing ? `Password reset for "${name}".` : `User "${name}" added.`);
  process.exit(0);
}
if (cmd === 'remove-user') {
  db.users = db.users.filter(u => u !== findUser(args[0]));
  saveDb();
  console.log('Done.');
  process.exit(0);
}
if (cmd === 'show-display-link') {
  if (!fs.existsSync(DB_FILE)) saveDb();
  console.log(`Display link:  http://<this-server>:${PORT}/?key=${db.settings.displayKey}`);
  process.exit(0);
}

if (db.users.length === 0) {
  const pw = process.env.ADMIN_PASSWORD || randomToken(9);
  db.users.push({ username: 'admin', password: hashPassword(pw), created: new Date().toISOString() });
  saveDb();
  console.log('\n=====================================================');
  console.log(' First run: created admin user');
  console.log('   username: admin');
  console.log('   password: ' + (process.env.ADMIN_PASSWORD ? '(from ADMIN_PASSWORD)' : pw));
  console.log(' Log in at /admin and change it under "People".');
  console.log('=====================================================\n');
}

/* ---------- validation ---------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function userError(msg) { const e = new Error(msg); e.userFacing = true; return e; }
function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function validDate(v) {
  if (!DATE_RE.test(v)) return false;
  const d = Shared.parseDate(v);
  return Shared.toDateStr(d) === v;
}

function cleanEvent(input, existing) {
  const ev = {
    id: existing ? existing.id : randomId(),
    title: str(input.title, 120),
    date: str(input.date, 10),
    time: str(input.time, 5),
    endTime: str(input.endTime, 5),
    icon: str(input.icon, 16),
    notes: str(input.notes, 600),
    repeat: Shared.REPEATS.includes(input.repeat) ? input.repeat : 'none',
    repeatUntil: str(input.repeatUntil, 10),
    skipDates: Array.isArray(input.skipDates)
      ? [...new Set(input.skipDates.filter(d => typeof d === 'string' && validDate(d)))].sort().slice(-500)
      : (existing ? existing.skipDates || [] : []),
    important: !!input.important
  };
  if (!ev.title) throw userError('Please enter a title.');
  if (!validDate(ev.date)) throw userError('Please choose a valid date.');
  if (ev.time && !TIME_RE.test(ev.time)) throw userError('Start time is not valid.');
  if (ev.endTime && !TIME_RE.test(ev.endTime)) throw userError('End time is not valid.');
  if (ev.endTime && !ev.time) throw userError('Add a start time if you set an end time.');
  if (ev.endTime && ev.endTime <= ev.time) throw userError('End time must be after the start time.');
  if (ev.repeat === 'none') ev.repeatUntil = '';
  if (ev.repeatUntil && !validDate(ev.repeatUntil)) throw userError('"Repeat until" date is not valid.');
  if (ev.repeatUntil && ev.repeatUntil < ev.date) throw userError('"Repeat until" must be after the start date.');
  return ev;
}

function cleanMessage(input, existing) {
  const days = Array.isArray(input.days)
    ? [...new Set(input.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  const msg = {
    id: existing ? existing.id : randomId(),
    text: str(input.text, 300),
    days,
    start: str(input.start, 5),
    end: str(input.end, 5),
    enabled: input.enabled !== false
  };
  if (!msg.text) throw userError('Please type the message.');
  if (!msg.days.length) throw userError('Choose at least one day.');
  if (msg.start || msg.end) {
    if (!TIME_RE.test(msg.start) || !TIME_RE.test(msg.end)) throw userError('Set both a "from" and an "until" time, or tick "All day".');
    if (msg.start === msg.end) throw userError('"From" and "until" can\'t be the same time.');
  }
  return msg;
}

function cleanSettings(input) {
  const s = db.settings;
  if ('personName' in input) s.personName = str(input.personName, 60);
  if ('clock24' in input) s.clock24 = !!input.clock24;
  if ('idleMinutes' in input) {
    const n = Math.round(Number(input.idleMinutes));
    s.idleMinutes = Math.min(60, Math.max(1, n || 5));
  }
  if ('calendarWeeks' in input) {
    const n = Math.round(Number(input.calendarWeeks));
    s.calendarWeeks = Math.min(8, Math.max(2, n || 4));
  }
  if (input.regenerateKey) s.displayKey = randomToken(18);
}

/* ---------- HTTP helpers ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({}, SECURITY_HEADERS, headers));
  res.end(body);
}
function json(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, headers));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 200 * 1024) { reject(userError('Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(userError('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function currentUser(req) {
  const tok = parseCookies(req).diary_session;
  if (!tok) return null;
  const s = db.sessions[tok];
  if (!s || s.expires < Date.now()) return null;
  const u = findUser(s.username);
  return u ? { user: u, token: tok } : null;
}

const loginFailures = new Map(); // ip -> { count, until }
function clientIp(req) {
  return (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || '?';
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath === '/admin' || urlPath === '/admin/' ? '/admin.html' : urlPath;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    send(res, 200, data, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
  });
}

/* ---------- API ---------- */

async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  // Writes must be JSON (blocks simple cross-site form posts).
  if (m !== 'GET' && !(req.headers['content-type'] || '').startsWith('application/json')) {
    return json(res, 415, { error: 'Expected JSON' });
  }

  // The display (no login, uses the secret display key)
  if (p === '/api/display' && m === 'GET') {
    const key = req.headers['x-display-key'] || '';
    if (!safeEqual(key, db.settings.displayKey)) return json(res, 403, { error: 'bad-key' });
    const s = db.settings;
    return json(res, 200, {
      appVersion: APP_VERSION,
      dataVersion,
      settings: {
        personName: s.personName, clock24: s.clock24,
        idleMinutes: s.idleMinutes, calendarWeeks: s.calendarWeeks
      },
      messages: db.messages.filter(msg => msg.enabled !== false)
        .map(({ id, text, days, start, end }) => ({ id, text, days, start, end })),
      events: db.events.map(({ id, title, date, time, endTime, icon, notes, repeat, repeatUntil, skipDates, important }) =>
        ({ id, title, date, time, endTime, icon, notes, repeat, repeatUntil, skipDates, important }))
    });
  }

  if (p === '/api/login' && m === 'POST') {
    const ip = clientIp(req);
    const f = loginFailures.get(ip);
    if (f && f.until > Date.now()) {
      return json(res, 429, { error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    const body = await readBody(req);
    const u = findUser(body.username);
    const ok = u && typeof body.password === 'string' && verifyPassword(body.password, u.password);
    if (!ok) {
      const rec = f && f.until > Date.now() - 15 * 60000 ? f : { count: 0, until: 0 };
      rec.count++;
      if (rec.count >= 5) { rec.until = Date.now() + 5 * 60000; rec.count = 0; }
      loginFailures.set(ip, rec);
      return json(res, 401, { error: 'Username or password is not right.' });
    }
    loginFailures.delete(ip);
    pruneSessions();
    const token = randomToken(32);
    db.sessions[token] = { username: u.username, expires: Date.now() + SESSION_DAYS * 86400000 };
    saveDb();
    const cookie = `diary_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}` + (SECURE_COOKIE ? '; Secure' : '');
    return json(res, 200, { username: u.username }, { 'Set-Cookie': cookie });
  }

  const auth = currentUser(req);
  if (!auth) return json(res, 401, { error: 'Please log in.' });
  const me = auth.user;

  if (p === '/api/logout' && m === 'POST') {
    delete db.sessions[auth.token];
    saveDb();
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'diary_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (p === '/api/me' && m === 'GET') return json(res, 200, { username: me.username });

  if (p === '/api/events' && m === 'GET') return json(res, 200, { events: db.events });

  if (p === '/api/events' && m === 'POST') {
    const ev = cleanEvent(await readBody(req));
    ev.createdBy = ev.updatedBy = me.username;
    ev.createdAt = ev.updatedAt = new Date().toISOString();
    db.events.push(ev);
    saveDb();
    return json(res, 201, { event: ev });
  }

  const evMatch = p.match(/^\/api\/events\/([\w-]+)(\/skip)?$/);
  if (evMatch) {
    const idx = db.events.findIndex(e => e.id === evMatch[1]);
    if (idx === -1) return json(res, 404, { error: 'That entry no longer exists.' });
    const existing = db.events[idx];

    if (evMatch[2] && m === 'POST') { // skip / un-skip one date of a repeating entry
      const body = await readBody(req);
      if (!validDate(body.date)) return json(res, 400, { error: 'Bad date' });
      const set = new Set(existing.skipDates || []);
      if (body.undo) set.delete(body.date); else set.add(body.date);
      existing.skipDates = [...set].sort();
      existing.updatedBy = me.username; existing.updatedAt = new Date().toISOString();
      saveDb();
      return json(res, 200, { event: existing });
    }
    if (!evMatch[2] && m === 'PUT') {
      const ev = cleanEvent(await readBody(req), existing);
      ev.createdBy = existing.createdBy; ev.createdAt = existing.createdAt;
      ev.updatedBy = me.username; ev.updatedAt = new Date().toISOString();
      db.events[idx] = ev;
      saveDb();
      return json(res, 200, { event: ev });
    }
    if (!evMatch[2] && m === 'DELETE') {
      db.events.splice(idx, 1);
      saveDb();
      return json(res, 200, { ok: true });
    }
  }

  if (p === '/api/messages' && m === 'GET') return json(res, 200, { messages: db.messages });
  if (p === '/api/messages' && m === 'POST') {
    const msg = cleanMessage(await readBody(req));
    msg.createdBy = msg.updatedBy = me.username;
    msg.createdAt = msg.updatedAt = new Date().toISOString();
    db.messages.push(msg);
    saveDb();
    return json(res, 201, { message: msg });
  }
  const msgMatch = p.match(/^\/api\/messages\/([\w-]+)$/);
  if (msgMatch) {
    const idx = db.messages.findIndex(x => x.id === msgMatch[1]);
    if (idx === -1) return json(res, 404, { error: 'That message no longer exists.' });
    const existing = db.messages[idx];
    if (m === 'PUT') {
      const msg = cleanMessage(await readBody(req), existing);
      msg.createdBy = existing.createdBy; msg.createdAt = existing.createdAt;
      msg.updatedBy = me.username; msg.updatedAt = new Date().toISOString();
      db.messages[idx] = msg;
      saveDb();
      return json(res, 200, { message: msg });
    }
    if (m === 'DELETE') {
      db.messages.splice(idx, 1);
      saveDb();
      return json(res, 200, { ok: true });
    }
  }

  if (p === '/api/settings' && m === 'GET') return json(res, 200, { settings: db.settings });
  if (p === '/api/settings' && m === 'PUT') {
    cleanSettings(await readBody(req));
    saveDb();
    return json(res, 200, { settings: db.settings });
  }

  if (p === '/api/users' && m === 'GET') {
    return json(res, 200, { users: db.users.map(u => ({ username: u.username, created: u.created })) });
  }
  if (p === '/api/users' && m === 'POST') {
    const body = await readBody(req);
    const name = str(body.username, 40);
    if (!/^[\w .@-]{2,40}$/.test(name)) return json(res, 400, { error: 'Username should be 2–40 letters, numbers, spaces, . @ - or _.' });
    if (findUser(name)) return json(res, 400, { error: 'That username is already taken.' });
    if (typeof body.password !== 'string' || body.password.length < 8) return json(res, 400, { error: 'Password must be at least 8 characters.' });
    db.users.push({ username: name, password: hashPassword(body.password), created: new Date().toISOString(), createdBy: me.username });
    saveDb();
    return json(res, 201, { ok: true });
  }
  if (p === '/api/users/me/password' && m === 'PUT') {
    const body = await readBody(req);
    if (typeof body.current !== 'string' || !verifyPassword(body.current, me.password)) return json(res, 400, { error: 'Current password is not right.' });
    if (typeof body.password !== 'string' || body.password.length < 8) return json(res, 400, { error: 'New password must be at least 8 characters.' });
    me.password = hashPassword(body.password);
    for (const [tok, s] of Object.entries(db.sessions)) if (s.username === me.username && tok !== auth.token) delete db.sessions[tok];
    saveDb();
    return json(res, 200, { ok: true });
  }
  const userMatch = p.match(/^\/api\/users\/(.+)$/);
  if (userMatch && m === 'DELETE') {
    const target = findUser(decodeURIComponent(userMatch[1]));
    if (!target) return json(res, 404, { error: 'No such user.' });
    if (target === me) return json(res, 400, { error: 'You cannot remove yourself.' });
    db.users = db.users.filter(u => u !== target);
    pruneSessions();
    saveDb();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, 'Bad request'); }
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (e.userFacing) return json(res, 400, { error: e.message });
    console.error(e);
    json(res, 500, { error: 'Something went wrong on the server.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Daily Diary running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Display:  /?key=${db.settings.displayKey}`);
  console.log(`  Admin:    /admin`);
});
