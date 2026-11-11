import express from 'express';
import multer from 'multer';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PORT = Number(process.env.PORT) || 3000;
const SECURE_COOKIE = process.env.NODE_ENV === 'production';
const SESSION_DAYS = 90;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- DB ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'travel.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS trip_members (
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (trip_id, user_id)
);
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  visited_at TEXT,
  comment TEXT,
  category TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  file TEXT NOT NULL,
  thumb TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS trip_invites (
  token TEXT PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_places_trip ON places(trip_id);
CREATE INDEX IF NOT EXISTS idx_photos_place ON photos(place_id);
CREATE INDEX IF NOT EXISTS idx_invites_trip ON trip_invites(trip_id);
`);
const q = (sql) => db.prepare(sql);
const inList = (arr) => arr.map(() => '?').join(',');

// ---------- helpers ----------
const CATEGORIES = ['sight', 'food', 'cafe', 'stay', 'nature', 'etc'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPw(pw, stored) {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setSessionCookie(res, token, maxAge) {
  res.setHeader('Set-Cookie',
    `sid=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${SECURE_COOKIE ? '; Secure' : ''}`);
}
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  q('INSERT INTO sessions(token, user_id) VALUES (?, ?)').run(token, userId);
  setSessionCookie(res, token, SESSION_DAYS * 86400);
}
function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function optDate(v) {
  const s = str(v, 10);
  return DATE_RE.test(s) ? s : null;
}
function removeFiles(rows) {
  for (const r of rows) {
    for (const f of [r.file, r.thumb]) {
      fs.rm(path.join(UPLOAD_DIR, f), { force: true }, () => {});
    }
  }
}

function auth(req, res, next) {
  const sid = cookies(req).sid;
  const user = sid && q(`SELECT u.id, u.username, u.name FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.created_at > datetime('now', '-${SESSION_DAYS} days')`).get(sid);
  if (!user) return res.status(401).json({ error: '로그인이 필요해요' });
  req.user = { ...user };
  req.sid = sid;
  next();
}

function getTripForMember(tripId, userId) {
  const trip = q(`SELECT t.* FROM trips t JOIN trip_members m ON m.trip_id = t.id
    WHERE t.id = ? AND m.user_id = ?`).get(Number(tripId), userId);
  if (!trip) fail(404, '여행을 찾을 수 없어요');
  return trip;
}
function getPlaceForMember(placeId, userId) {
  const place = q(`SELECT p.*, t.owner_id AS trip_owner FROM places p
    JOIN trips t ON t.id = p.trip_id
    JOIN trip_members m ON m.trip_id = p.trip_id AND m.user_id = ?
    WHERE p.id = ?`).get(userId, Number(placeId));
  if (!place) fail(404, '기록을 찾을 수 없어요');
  return place;
}
const canModifyPlace = (place, user) => place.user_id === user.id || place.trip_owner === user.id;

function placesWithPhotos(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const photos = q(`SELECT id, place_id, user_id, file, thumb FROM photos
    WHERE place_id IN (${inList(ids)}) ORDER BY id`).all(...ids);
  const byPlace = new Map(ids.map((id) => [id, []]));
  for (const ph of photos) {
    byPlace.get(ph.place_id).push({
      id: ph.id, user_id: ph.user_id, url: `/uploads/${ph.file}`, thumb: `/uploads/${ph.thumb}`,
    });
  }
  return rows.map((r) => ({ ...r, photos: byPlace.get(r.id) }));
}
const PLACE_SELECT = `SELECT p.id, p.trip_id, p.user_id, p.name, p.lat, p.lng, p.visited_at, p.comment,
  p.category, p.created_at, u.name AS author, t.title AS trip_title
  FROM places p JOIN users u ON u.id = p.user_id JOIN trips t ON t.id = p.trip_id`;

// ---------- uploads (사진은 브라우저에서 이미 줄여서 옴) ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, _file, cb) => cb(null, `${crypto.randomBytes(12).toString('hex')}.jpg`),
  }),
  limits: { fileSize: 4 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'image/jpeg'),
});
const photoFields = upload.fields([{ name: 'photos', maxCount: 10 }, { name: 'thumbs', maxCount: 10 }]);
function withUpload(handler) {
  return (req, res, next) => photoFields(req, res, (err) => {
    const uploaded = [...(req.files?.photos || []), ...(req.files?.thumbs || [])];
    const cleanup = () => uploaded.forEach((f) => fs.rm(f.path, { force: true }, () => {}));
    if (err) {
      cleanup();
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '사진 용량이 너무 커요' : '사진 업로드에 실패했어요';
      return res.status(400).json({ error: msg });
    }
    try { handler(req, res); } catch (e) { cleanup(); next(e); }
  });
}
function savePhotos(placeId, userId, files) {
  const photos = files?.photos || [];
  const thumbs = files?.thumbs || [];
  if (photos.length !== thumbs.length) fail(400, '사진 정보가 맞지 않아요');
  const ins = q('INSERT INTO photos(place_id, user_id, file, thumb) VALUES (?, ?, ?, ?)');
  photos.forEach((p, i) => ins.run(placeId, userId, p.filename, thumbs[i].filename));
}

// ---------- 시도 횟수 제한 (비밀번호 무작위 대입 방지) ----------
function rateLimit({ windowMs, max, key }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let h = hits.get(k);
    if (!h || h.reset < now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(k, h);
    }
    if (++h.count > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: '시도가 너무 많아요. 잠시 후 다시 해 주세요' });
    }
    next();
  };
}
const MIN = 60 * 1000;
const loginPerAccount = rateLimit({ windowMs: 15 * MIN, max: 10, key: (req) => `${req.ip}|${str(req.body.username, 20).toLowerCase()}` });
const loginPerIp = rateLimit({ windowMs: 15 * MIN, max: 50, key: (req) => req.ip });
const signupPerIp = rateLimit({ windowMs: 60 * MIN, max: 10, key: (req) => req.ip });
const passwordPerIp = rateLimit({ windowMs: 15 * MIN, max: 10, key: (req) => req.ip });

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
// 배포 환경(Fly.io/Railway/Render)의 프록시 뒤에서 실제 접속 IP를 쓰기 위함
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? (SECURE_COOKIE ? 1 : 0)));
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  });
  if (SECURE_COOKIE) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.get('/healthz', (_req, res) => {
  q('SELECT 1').get();
  res.json({ ok: true });
});
app.use(express.json({ limit: '100kb' }));
app.use((req, _res, next) => {
  req.body ??= {};
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// 계정
app.post('/api/signup', signupPerIp, (req, res) => {
  const username = str(req.body.username, 20);
  const name = str(req.body.name, 20);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) fail(400, '아이디는 영문/숫자/_ 3~20자로 해주세요');
  if (!name) fail(400, '이름(닉네임)을 입력해 주세요');
  if (password.length < 6) fail(400, '비밀번호는 6자 이상이어야 해요');
  if (q('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, '이미 사용 중인 아이디예요');
  const { lastInsertRowid } = q('INSERT INTO users(username, name, pw_hash) VALUES (?, ?, ?)')
    .run(username, name, hashPw(password));
  startSession(res, Number(lastInsertRowid));
  res.json({ id: Number(lastInsertRowid), username, name });
});

app.post('/api/login', loginPerIp, loginPerAccount, (req, res) => {
  const username = str(req.body.username, 20);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = q('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !checkPw(password, user.pw_hash)) fail(401, '아이디 또는 비밀번호가 틀렸어요');
  startSession(res, user.id);
  res.json({ id: user.id, username: user.username, name: user.name });
});

app.post('/api/logout', (req, res) => {
  const sid = cookies(req).sid;
  if (sid) q('DELETE FROM sessions WHERE token = ?').run(sid);
  setSessionCookie(res, '', 0);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json(req.user));

app.post('/api/password', passwordPerIp, auth, (req, res) => {
  const current = typeof req.body?.current === 'string' ? req.body.current : '';
  const next = typeof req.body?.next === 'string' ? req.body.next : '';
  const { pw_hash } = q('SELECT pw_hash FROM users WHERE id = ?').get(req.user.id);
  if (!checkPw(current, pw_hash)) fail(400, '현재 비밀번호가 틀렸어요');
  if (next.length < 6) fail(400, '새 비밀번호는 6자 이상이어야 해요');
  if (next === current) fail(400, '지금과 다른 비밀번호를 입력해 주세요');
  q('UPDATE users SET pw_hash = ? WHERE id = ?').run(hashPw(next), req.user.id);
  // 지금 쓰는 기기만 남기고 다른 기기는 로그아웃
  const { changes } = q('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(req.user.id, req.sid);
  res.json({ ok: true, signed_out: Number(changes) });
});

// 초대 링크 (7일 동안 유효, 아무 멤버나 만들 수 있음)
function findInvite(token) {
  return q(`SELECT i.token, i.trip_id, i.expires_at, t.title, u.name AS inviter,
      (SELECT COUNT(*) FROM trip_members m WHERE m.trip_id = i.trip_id) AS member_count
    FROM trip_invites i JOIN trips t ON t.id = i.trip_id JOIN users u ON u.id = i.created_by
    WHERE i.token = ? AND i.expires_at > datetime('now')`).get(String(token).slice(0, 64));
}

app.post('/api/trips/:id/invite', auth, (req, res) => {
  const trip = getTripForMember(req.params.id, req.user.id);
  if (req.body?.reset) {
    if (trip.owner_id !== req.user.id) fail(403, '여행을 만든 사람만 링크를 새로 만들 수 있어요');
    q('DELETE FROM trip_invites WHERE trip_id = ?').run(trip.id);
  }
  q("DELETE FROM trip_invites WHERE expires_at <= datetime('now')").run();
  // 하루 이상 남은 링크가 있으면 그대로 다시 씀
  let invite = q(`SELECT token, expires_at FROM trip_invites
    WHERE trip_id = ? AND expires_at > datetime('now', '+1 day') ORDER BY expires_at DESC LIMIT 1`).get(trip.id);
  if (!invite) {
    const token = crypto.randomBytes(18).toString('base64url');
    q(`INSERT INTO trip_invites(token, trip_id, created_by, expires_at)
      VALUES (?, ?, ?, datetime('now', '+7 days'))`).run(token, trip.id, req.user.id);
    invite = q('SELECT token, expires_at FROM trip_invites WHERE token = ?').get(token);
  }
  res.json({ ...invite });
});

app.get('/api/invites/:token', (req, res) => {
  const inv = findInvite(req.params.token);
  if (!inv) fail(404, '초대 링크가 만료됐거나 잘못된 링크예요');
  res.json({ title: inv.title, inviter: inv.inviter, member_count: inv.member_count });
});

app.post('/api/invites/:token/accept', auth, (req, res) => {
  const inv = findInvite(req.params.token);
  if (!inv) fail(404, '초대 링크가 만료됐거나 잘못된 링크예요');
  const { changes } = q('INSERT OR IGNORE INTO trip_members(trip_id, user_id) VALUES (?, ?)').run(inv.trip_id, req.user.id);
  res.json({ trip_id: inv.trip_id, title: inv.title, already: Number(changes) === 0 });
});

// 여행
app.get('/api/trips', auth, (req, res) => {
  const trips = q(`SELECT t.*,
      (SELECT COUNT(*) FROM places p WHERE p.trip_id = t.id) AS place_count,
      (SELECT ph.thumb FROM photos ph JOIN places p ON p.id = ph.place_id
        WHERE p.trip_id = t.id ORDER BY ph.id LIMIT 1) AS cover
    FROM trips t JOIN trip_members m ON m.trip_id = t.id
    WHERE m.user_id = ?
    ORDER BY COALESCE(t.start_date, t.created_at) DESC, t.id DESC`).all(req.user.id);
  if (!trips.length) return res.json([]);
  const ids = trips.map((t) => t.id);
  const members = q(`SELECT m.trip_id, u.id, u.username, u.name FROM trip_members m
    JOIN users u ON u.id = m.user_id WHERE m.trip_id IN (${inList(ids)}) ORDER BY u.name`).all(...ids);
  res.json(trips.map((t) => ({
    ...t,
    cover: t.cover ? `/uploads/${t.cover}` : null,
    members: members.filter((m) => m.trip_id === t.id).map(({ trip_id, ...m }) => m),
  })));
});

app.post('/api/trips', auth, (req, res) => {
  const title = str(req.body.title, 40);
  if (!title) fail(400, '여행 이름을 입력해 주세요');
  const { lastInsertRowid } = q('INSERT INTO trips(title, start_date, end_date, owner_id) VALUES (?, ?, ?, ?)')
    .run(title, optDate(req.body.start_date), optDate(req.body.end_date), req.user.id);
  q('INSERT INTO trip_members(trip_id, user_id) VALUES (?, ?)').run(lastInsertRowid, req.user.id);
  res.json({ id: Number(lastInsertRowid) });
});

app.patch('/api/trips/:id', auth, (req, res) => {
  const trip = getTripForMember(req.params.id, req.user.id);
  const title = str(req.body.title, 40);
  if (!title) fail(400, '여행 이름을 입력해 주세요');
  q('UPDATE trips SET title = ?, start_date = ?, end_date = ? WHERE id = ?')
    .run(title, optDate(req.body.start_date), optDate(req.body.end_date), trip.id);
  res.json({ ok: true });
});

app.delete('/api/trips/:id', auth, (req, res) => {
  const trip = getTripForMember(req.params.id, req.user.id);
  if (trip.owner_id !== req.user.id) fail(403, '여행을 만든 사람만 삭제할 수 있어요');
  const files = q(`SELECT ph.file, ph.thumb FROM photos ph JOIN places p ON p.id = ph.place_id
    WHERE p.trip_id = ?`).all(trip.id);
  q('DELETE FROM trips WHERE id = ?').run(trip.id);
  removeFiles(files);
  res.json({ ok: true });
});

app.post('/api/trips/:id/members', auth, (req, res) => {
  const trip = getTripForMember(req.params.id, req.user.id);
  const user = q('SELECT id, username, name FROM users WHERE username = ?').get(str(req.body.username, 20));
  if (!user) fail(404, '그런 아이디를 가진 사람이 없어요');
  q('INSERT OR IGNORE INTO trip_members(trip_id, user_id) VALUES (?, ?)').run(trip.id, user.id);
  res.json({ ...user });
});

app.delete('/api/trips/:id/members/:userId', auth, (req, res) => {
  const trip = getTripForMember(req.params.id, req.user.id);
  const target = Number(req.params.userId);
  if (target === trip.owner_id) fail(400, '여행을 만든 사람은 나갈 수 없어요. 대신 여행을 삭제해 주세요');
  if (target !== req.user.id && trip.owner_id !== req.user.id) fail(403, '여행을 만든 사람만 멤버를 내보낼 수 있어요');
  q('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?').run(trip.id, target);
  res.json({ ok: true });
});

// 장소
app.get('/api/places', auth, (req, res) => {
  let rows;
  if (req.query.trip) {
    const trip = getTripForMember(req.query.trip, req.user.id);
    rows = q(`${PLACE_SELECT} WHERE p.trip_id = ?`).all(trip.id);
  } else {
    rows = q(`${PLACE_SELECT} JOIN trip_members m ON m.trip_id = p.trip_id WHERE m.user_id = ?`).all(req.user.id);
  }
  res.json(placesWithPhotos(rows));
});

function placeFields(body) {
  const name = str(body.name, 60);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!name) fail(400, '장소 이름을 입력해 주세요');
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) fail(400, '위치를 지도에서 선택해 주세요');
  const category = CATEGORIES.includes(body.category) ? body.category : 'etc';
  return { name, lat, lng, category, comment: str(body.comment, 80), visited_at: optDate(body.visited_at) };
}

app.post('/api/trips/:id/places', auth, withUpload((req, res) => {
  const trip = getTripForMember(req.params.id, req.user.id);
  const f = placeFields(req.body);
  db.exec('BEGIN');
  try {
    const { lastInsertRowid } = q(`INSERT INTO places(trip_id, user_id, name, lat, lng, visited_at, comment, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(trip.id, req.user.id, f.name, f.lat, f.lng, f.visited_at, f.comment, f.category);
    savePhotos(Number(lastInsertRowid), req.user.id, req.files);
    db.exec('COMMIT');
    res.json({ id: Number(lastInsertRowid) });
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}));

app.patch('/api/places/:id', auth, (req, res) => {
  const place = getPlaceForMember(req.params.id, req.user.id);
  if (!canModifyPlace(place, req.user)) fail(403, '직접 쓴 기록만 고칠 수 있어요');
  const f = placeFields({ lat: place.lat, lng: place.lng, ...req.body });
  q('UPDATE places SET name = ?, lat = ?, lng = ?, visited_at = ?, comment = ?, category = ? WHERE id = ?')
    .run(f.name, f.lat, f.lng, f.visited_at, f.comment, f.category, place.id);
  res.json({ ok: true });
});

app.delete('/api/places/:id', auth, (req, res) => {
  const place = getPlaceForMember(req.params.id, req.user.id);
  if (!canModifyPlace(place, req.user)) fail(403, '직접 쓴 기록만 지울 수 있어요');
  const files = q('SELECT file, thumb FROM photos WHERE place_id = ?').all(place.id);
  q('DELETE FROM places WHERE id = ?').run(place.id);
  removeFiles(files);
  res.json({ ok: true });
});

app.post('/api/places/:id/photos', auth, withUpload((req, res) => {
  const place = getPlaceForMember(req.params.id, req.user.id);
  const count = q('SELECT COUNT(*) AS n FROM photos WHERE place_id = ?').get(place.id).n;
  if (count + (req.files?.photos?.length || 0) > 30) fail(400, '한 장소에는 사진을 30장까지 올릴 수 있어요');
  savePhotos(place.id, req.user.id, req.files);
  res.json({ ok: true });
}));

app.delete('/api/photos/:id', auth, (req, res) => {
  const photo = q('SELECT * FROM photos WHERE id = ?').get(Number(req.params.id));
  if (!photo) fail(404, '사진을 찾을 수 없어요');
  const place = getPlaceForMember(photo.place_id, req.user.id);
  if (photo.user_id !== req.user.id && !canModifyPlace(place, req.user)) fail(403, '직접 올린 사진만 지울 수 있어요');
  q('DELETE FROM photos WHERE id = ?').run(photo.id);
  removeFiles([photo]);
  res.json({ ok: true });
});

// 사진 파일: 같은 여행 멤버만 볼 수 있음
app.get('/uploads/:file', auth, (req, res) => {
  const file = req.params.file;
  if (!/^[a-f0-9]{24}\.jpg$/.test(file)) return res.sendStatus(404);
  const row = q(`SELECT 1 FROM photos ph JOIN places p ON p.id = ph.place_id
    JOIN trip_members m ON m.trip_id = p.trip_id AND m.user_id = ?
    WHERE ph.file = ? OR ph.thumb = ? LIMIT 1`).get(req.user.id, file, file);
  if (!row) return res.sendStatus(404);
  res.set('Cache-Control', 'private, max-age=2592000, immutable');
  res.sendFile(path.join(UPLOAD_DIR, file), { cacheControl: false });
});

// 장소 검색 (OpenStreetMap Nominatim)
// 이용 규칙: 1초에 1번까지 → 요청을 한 줄로 세워서 간격을 지킴
let nominatimQueue = Promise.resolve();
let nominatimLast = 0;
function nominatim(pathAndQuery) {
  const run = async () => {
    const wait = nominatimLast + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    nominatimLast = Date.now();
    const r = await fetch(`https://nominatim.openstreetmap.org/${pathAndQuery}&format=jsonv2&accept-language=ko`, {
      headers: { 'User-Agent': 'travel-log-app/0.1' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) fail(502, '장소 검색 서버에 문제가 있어요');
    return r.json();
  };
  const p = nominatimQueue.then(run, run);
  nominatimQueue = p.catch(() => {});
  return p;
}
// "오사카성;오사카 성"처럼 이름이 여러 개 붙어 있으면 첫 번째만
const shortName = (x) => String(x.name || String(x.display_name || '').split(',')[0]).split(';')[0].trim();
const toPlace = (x, name = shortName(x)) => ({ name, address: x.display_name, lat: Number(x.lat), lng: Number(x.lon) });
const isStation = (x) => (x.category === 'railway' && ['station', 'halt'].includes(x.type))
  || (x.category === 'public_transport' && x.type === 'station');
const searchPlaces = (text) => nominatim(`search?limit=8&q=${encodeURIComponent(text)}`);

app.get('/api/geocode', auth, async (req, res) => {
  const query = str(req.query.q, 100);
  if (!query) return res.json([]);
  let list = (await searchPlaces(query)).map((x) => toPlace(x));

  // "공주역"처럼 지도 데이터에는 "역" 없이 "공주"로만 등록된 역이 많음
  // → "역"을 떼고 다시 찾아서 기차역·지하철역을 먼저 보여줌
  const station = !list.length && query.match(/^(.+?)\s*역$/);
  if (station) {
    const found = await searchPlaces(station[1]);
    const stations = found.filter(isStation)
      .map((x) => toPlace(x, /역$/.test(shortName(x)) ? shortName(x) : `${shortName(x)}역`));
    list = stations.length ? stations : found.map((x) => toPlace(x));
  }

  // 띄어쓰기 차이로 못 찾는 경우 ("오사카 성" → "오사카성")
  if (!list.length && /\s/.test(query)) {
    list = (await searchPlaces(query.replace(/\s+/g, ''))).map((x) => toPlace(x));
  }
  // 같은 이름이 400m 안에 여러 번 나오면 하나만 (서울역 KTX·1호선·4호선처럼 따로 등록된 경우)
  const near = (a, b) => {
    const dy = (a.lat - b.lat) * 111000;
    const dx = (a.lng - b.lng) * 111000 * Math.cos((a.lat * Math.PI) / 180);
    return Math.hypot(dx, dy) < 400;
  };
  const kept = [];
  for (const p of list) {
    if (!kept.some((k) => k.name === p.name && near(k, p))) kept.push(p);
  }
  list = kept;
  res.json(list.slice(0, 6));
});

app.get('/api/reverse', auth, async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) fail(400, '좌표가 올바르지 않아요');
  const x = await nominatim(`reverse?zoom=17&lat=${lat}&lon=${lng}`);
  res.json({ name: x.error ? '' : shortName(x), address: x.display_name || '' });
});

app.use('/api', (_req, res) => res.status(404).json({ error: '없는 주소예요' }));
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '잘못된 요청이에요' });
  console.error(err);
  res.status(500).json({ error: '서버 오류가 났어요' });
});

// HOST=127.0.0.1 이면 서버 안에서만 접속 가능 (운영에서는 Caddy가 https로 받아서 넘겨줌)
const HOST = process.env.HOST;
const server = app.listen(PORT, ...(HOST ? [HOST] : []), () => {
  console.log(`여행 기록 앱: http://localhost:${PORT}`);
  console.log(`앱 폴더: ${__dirname}`);
  console.log(`데이터 폴더: ${DATA_DIR}`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n포트 ${PORT}을(를) 이미 다른 프로그램이 쓰고 있어요.`);
    console.error('다른 포트로 실행해 보세요. 예) PowerShell:  $env:PORT=3001; npm start\n');
    process.exit(1);
  }
  throw err;
});

// 배포 플랫폼이 재시작할 때 DB를 깔끔하게 닫음
q(`DELETE FROM sessions WHERE created_at <= datetime('now', '-${SESSION_DAYS} days')`).run();
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
