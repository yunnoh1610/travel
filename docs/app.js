'use strict';

// ---------- 유틸 ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CATS = {
  sight: ['📍', '관광'], food: ['🍜', '맛집'], cafe: ['☕', '카페'],
  stay: ['🏨', '숙소'], nature: ['🌿', '자연'], etc: ['✨', '기타'],
};
const catIcon = (c) => (CATS[c] || CATS.etc)[0];
const catLabel = (c) => (CATS[c] || CATS.etc).join(' ');
const pad2 = (n) => String(n).padStart(2, '0');
const toYMD = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = () => toYMD(new Date());
const visitKey = (p) => p.visited_at || (p.created_at || '').slice(0, 10);
const byVisit = (a, b) => visitKey(a).localeCompare(visitKey(b)) || a.id - b.id;
function fmtDate(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const w = '일월화수목금토'[new Date(y, m - 1, d).getDay()];
  return `${y}년 ${m}월 ${d}일 (${w})`;
}
function fmtRange(a, b) {
  if (!a && !b) return '날짜 미정';
  if (a && b && a !== b) return `${a.replaceAll('-', '.')} – ${b.replaceAll('-', '.')}`;
  return (a || b).replaceAll('-', '.');
}
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const initial = (name) => esc((name || '?').trim().charAt(0).toUpperCase());

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ---------- Supabase 연결 ----------
const CFG = window.TRAVEL_CONFIG || {};
const sb = CFG.url && CFG.key && window.supabase
  ? window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
const APP_URL = location.origin + location.pathname.replace(/index\.html$/, '');
const BUCKET = 'photos';

// Supabase 오류를 한국어로
function korean(err) {
  const m = String(err?.message || err || '');
  const table = [
    [/Invalid login credentials/i, '이메일 또는 비밀번호가 틀렸어요'],
    [/already registered|already been registered|already exists/i, '이미 가입된 이메일이에요. 로그인해 주세요'],
    [/Password should be at least|password.*(short|length)/i, '비밀번호는 6자 이상이어야 해요'],
    [/should be different/i, '지금과 다른 비밀번호를 입력해 주세요'],
    [/Email not confirmed/i, '이메일 인증이 아직 안 됐어요. 메일함의 인증 링크를 눌러 주세요'],
    [/rate limit|too many|over_request/i, '시도가 너무 많아요. 잠시 후 다시 해 주세요'],
    [/invalid.*email|email.*invalid|validate email/i, '이메일 주소를 확인해 주세요'],
    [/row-level security|permission denied|not authorized|Unauthorized/i, '권한이 없어요'],
    [/exceeded the maximum allowed size|Payload too large/i, '사진 용량이 너무 커요'],
    [/violates check constraint/i, '입력한 내용을 확인해 주세요 (글자 수 등)'],
    [/Failed to fetch|NetworkError|Load failed|fetch failed/i, '인터넷 연결을 확인해 주세요'],
  ];
  for (const [re, ko] of table) if (re.test(m)) return ko;
  return /[가-힣]/.test(m) ? m : '요청에 실패했어요. 잠시 후 다시 해 주세요';
}
async function q(promise) {
  let res;
  try { res = await promise; } catch (e) { throw new Error(korean(e)); }
  if (res.error) throw new Error(korean(res.error));
  return res.data;
}
// 수정/삭제가 실제로 됐는지 확인 (권한이 없으면 오류 없이 0건이 됨)
async function qChanged(promise) {
  const rows = await q(promise);
  if (!rows || !rows.length) throw new Error('권한이 없거나 이미 지워진 항목이에요');
  return rows;
}

// ---------- 사진 주소 (비공개 저장소 → 6시간짜리 서명 주소, 재사용) ----------
const signed = new Map();
async function signPaths(paths) {
  const now = Date.now();
  const need = [...new Set(paths.filter(Boolean))].filter((p) => !(signed.get(p)?.exp > now + 30 * 60e3));
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const data = await q(sb.storage.from(BUCKET).createSignedUrls(chunk, 6 * 3600));
    data.forEach((d, j) => {
      if (d.signedUrl) signed.set(d.path || chunk[j], { url: d.signedUrl, exp: now + 6 * 3600e3 });
    });
  }
}
const urlOf = (p) => signed.get(p)?.url || '';
async function removeFiles(paths) {
  const list = [...new Set(paths.filter(Boolean))];
  for (let i = 0; i < list.length; i += 100) await q(sb.storage.from(BUCKET).remove(list.slice(i, i + 100)));
  list.forEach((p) => signed.delete(p));
}

// ---------- 데이터 ----------
const db = {
  async trips() {
    const trips = await q(sb.from('trip_list').select('*'));
    const ids = trips.map((t) => t.id);
    const members = ids.length
      ? await q(sb.from('trip_members').select('trip_id, user_id, profiles(name)').in('trip_id', ids))
      : [];
    await signPaths(trips.map((t) => t.cover_path));
    const key = (t) => t.start_date || (t.created_at || '').slice(0, 10);
    return trips
      .map((t) => ({
        ...t,
        place_count: Number(t.place_count) || 0,
        cover: t.cover_path ? urlOf(t.cover_path) : null,
        members: members.filter((m) => m.trip_id === t.id)
          .map((m) => ({ id: m.user_id, name: m.profiles?.name || '?' }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => key(b).localeCompare(key(a)) || b.id - a.id);
  },
  async places(filter) {
    let qb = sb.from('places')
      .select('id, trip_id, user_id, name, lat, lng, visited_at, comment, category, created_at, author:profiles(name), trip:trips(title), photos(id, user_id, path, thumb_path)')
      .order('id', { referencedTable: 'photos', ascending: true });
    if (filter !== 'all') qb = qb.eq('trip_id', filter);
    const rows = await q(qb);
    await signPaths(rows.flatMap((r) => r.photos.flatMap((ph) => [ph.thumb_path, ph.path])));
    return rows.map((r) => ({
      ...r,
      author: r.author?.name || '(나간 멤버)',
      trip_title: r.trip?.title || '',
      photos: r.photos.map((ph) => ({ ...ph, url: urlOf(ph.path), thumb: urlOf(ph.thumb_path) })),
    }));
  },
  async createTrip(f) {
    const row = await q(sb.from('trips').insert({ title: f.title.trim(), start_date: f.start_date || null, end_date: f.end_date || null })
      .select('id').single());
    return row.id;
  },
  updateTrip: (id, f) => qChanged(sb.from('trips')
    .update({ title: f.title.trim(), start_date: f.start_date || null, end_date: f.end_date || null }).eq('id', id).select('id')),
  async deleteTrip(id) {
    const ph = await q(sb.from('photos').select('path, thumb_path, places!inner(trip_id)').eq('places.trip_id', id));
    await removeFiles(ph.flatMap((x) => [x.path, x.thumb_path]));
    await qChanged(sb.from('trips').delete().eq('id', id).select('id'));
  },
  removeMember: (tripId, userId) => qChanged(sb.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId).select('user_id')),
  async createPlace(tripId, f, items) {
    const row = await q(sb.from('places').insert({ trip_id: tripId, ...f }).select('id').single());
    if (items.length) await db.uploadPhotos(tripId, row.id, items);
    return row.id;
  },
  async uploadPhotos(tripId, placeId, items) {
    const uploaded = [];
    const rows = [];
    try {
      for (const it of items) {
        const base = `${tripId}/${crypto.randomUUID()}`;
        const path = `${base}.jpg`;
        const thumb = `${base}_t.jpg`;
        const opts = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
        await Promise.all([
          q(sb.storage.from(BUCKET).upload(path, it.photo, opts)).then(() => uploaded.push(path)),
          q(sb.storage.from(BUCKET).upload(thumb, it.thumb, opts)).then(() => uploaded.push(thumb)),
        ]);
        rows.push({ place_id: placeId, path, thumb_path: thumb });
      }
      await q(sb.from('photos').insert(rows));
    } catch (e) {
      if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded).catch(() => {});
      throw e;
    }
  },
  updatePlace: (id, f) => qChanged(sb.from('places').update(f).eq('id', id).select('id')),
  async deletePlace(p) {
    await removeFiles(p.photos.flatMap((ph) => [ph.path, ph.thumb_path]));
    await qChanged(sb.from('places').delete().eq('id', p.id).select('id'));
  },
  async deletePhoto(ph) {
    await removeFiles([ph.path, ph.thumb_path]);
    await qChanged(sb.from('photos').delete().eq('id', ph.id).select('id'));
  },
  async createInvite(tripId, reset) {
    const rows = await q(sb.rpc('create_invite', { p_trip_id: tripId, p_reset: !!reset }));
    return rows[0];
  },
  async inviteInfo(token) {
    const rows = await q(sb.rpc('invite_info', { p_token: token }));
    if (!rows?.length) throw new Error('초대 링크가 만료됐거나 잘못된 링크예요');
    return rows[0];
  },
  async acceptInvite(token) {
    const rows = await q(sb.rpc('accept_invite', { p_token: token }));
    return rows[0];
  },
};

// ---------- 장소 검색 (OpenStreetMap Nominatim, 1초에 1번 규칙 지킴) ----------
let nomQueue = Promise.resolve();
let nomLast = 0;
function nominatim(pathAndQuery) {
  const run = async () => {
    const wait = nomLast + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    nomLast = Date.now();
    let r;
    try {
      r = await fetch(`https://nominatim.openstreetmap.org/${pathAndQuery}&format=jsonv2&accept-language=ko`);
    } catch { throw new Error('장소 검색 서버에 연결할 수 없어요'); }
    if (!r.ok) throw new Error('장소 검색 서버에 문제가 있어요. 잠시 후 다시 해 주세요');
    return r.json();
  };
  const p = nomQueue.then(run, run);
  nomQueue = p.catch(() => {});
  return p;
}
// "오사카성;오사카 성"처럼 이름이 여러 개 붙어 있으면 첫 번째만
const shortName = (x) => String(x.name || String(x.display_name || '').split(',')[0]).split(';')[0].trim();
const toPlace = (x, name = shortName(x)) => ({ name, address: x.display_name, lat: Number(x.lat), lng: Number(x.lon) });
const isStation = (x) => (x.category === 'railway' && ['station', 'halt'].includes(x.type))
  || (x.category === 'public_transport' && x.type === 'station');
const searchPlaces = (text) => nominatim(`search?limit=8&q=${encodeURIComponent(text)}`);

async function geocode(query) {
  let list = (await searchPlaces(query)).map((x) => toPlace(x));
  // "공주역"처럼 지도 데이터에는 "역" 없이 "공주"로만 등록된 역이 많음 → "역"을 떼고 다시 찾아 역을 먼저
  const station = !list.length && query.match(/^(.+?)\s*역$/);
  if (station) {
    const found = await searchPlaces(station[1]);
    const stations = found.filter(isStation)
      .map((x) => toPlace(x, /역$/.test(shortName(x)) ? shortName(x) : `${shortName(x)}역`));
    list = stations.length ? stations : found.map((x) => toPlace(x));
  }
  // 띄어쓰기 차이로 못 찾는 경우 ("오사카 성" → "오사카성")
  if (!list.length && /\s/.test(query)) list = (await searchPlaces(query.replace(/\s+/g, ''))).map((x) => toPlace(x));
  // 같은 이름이 400m 안에 여러 번 나오면 하나만
  const near = (a, b) => Math.hypot((a.lat - b.lat) * 111000, (a.lng - b.lng) * 111000 * Math.cos((a.lat * Math.PI) / 180)) < 400;
  const kept = [];
  for (const p of list) if (!kept.some((k) => k.name === p.name && near(k, p))) kept.push(p);
  return kept.slice(0, 6);
}
async function reverseGeocode(lat, lng) {
  const x = await nominatim(`reverse?zoom=17&lat=${lat}&lon=${lng}`);
  return x.error ? '' : shortName(x);
}

// ---------- 상태 ----------
const state = { me: null, trips: [], places: [], filter: 'all', view: 'map' };
let map;
let markerLayer;

// ---------- 바텀 시트 ----------
let sheetHideTimer;
function openSheet(html, onClose) {
  const sheet = $('#sheet');
  sheet._onClose?.();
  clearTimeout(sheetHideTimer);
  const body = $('.sheet-body', sheet);
  body.onclick = null; // 이전 시트의 클릭 처리기가 남지 않도록
  body.innerHTML = `<div class="grabber"></div><button class="sheet-close" aria-label="닫기">✕</button>${html}`;
  body.scrollTop = 0;
  $('.sheet-close', body).onclick = closeSheet;
  sheet._onClose = onClose;
  sheet.classList.remove('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
  return body;
}
function closeSheet() {
  const sheet = $('#sheet');
  sheet.classList.remove('open');
  const cb = sheet._onClose;
  sheet._onClose = null;
  cb?.();
  sheetHideTimer = setTimeout(() => sheet.classList.add('hidden'), 220);
}
$('.sheet-backdrop').onclick = closeSheet;

$('#lightbox').onclick = () => $('#lightbox').classList.add('hidden');
function showPhoto(src) {
  $('#lightbox img').src = src;
  $('#lightbox').classList.remove('hidden');
}

// ---------- 사진 처리: EXIF 읽기 + 용량 줄이기 ----------
const PHOTO_MAX = 1600; // 긴 변 기준 px
const THUMB_MAX = 480;

async function loadImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }
}
function resizeJpeg(img, max, quality) {
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('변환 실패'))), 'image/jpeg', quality));
}
/** 원본 사진 → { photo, thumb, gps, date, before, after }. 캔버스로 다시 그려서 EXIF(위치 포함)는 업로드 파일에서 빠짐 */
async function processPhoto(file) {
  let meta = null;
  try { meta = await window.exifr?.parse(file, { gps: true }); } catch { /* EXIF 없음 */ }
  let img;
  try { img = await loadImage(file); } catch { throw new Error('이 사진 형식은 열 수 없어요 (JPG/PNG로 시도해 주세요)'); }
  const [photo, thumb] = await Promise.all([resizeJpeg(img, PHOTO_MAX, 0.82), resizeJpeg(img, THUMB_MAX, 0.75)]);
  img.close?.();
  const gps = meta && Number.isFinite(meta.latitude) && Number.isFinite(meta.longitude)
    && !(meta.latitude === 0 && meta.longitude === 0)
    ? { lat: meta.latitude, lng: meta.longitude } : null;
  const dt = meta?.DateTimeOriginal || meta?.CreateDate;
  return {
    photo, thumb, gps,
    date: dt instanceof Date && !Number.isNaN(dt.getTime()) ? toYMD(dt) : null,
    before: file.size, after: photo.size,
    preview: URL.createObjectURL(thumb),
  };
}

// ---------- 로그인 ----------
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  for (const x of $('#authTabs').children) x.classList.toggle('on', x.dataset.mode === mode);
  const form = $('#authForm');
  $('.signup-only', form).classList.toggle('hidden', authMode !== 'signup');
  form.name.required = authMode === 'signup';
  form.password.autocomplete = authMode === 'signup' ? 'new-password' : 'current-password';
  $('button[type=submit]', form).textContent = authMode === 'signup' ? '가입하고 시작하기' : '로그인';
  $('#forgotBtn').classList.toggle('hidden', authMode === 'signup');
}
$('#authTabs').onclick = (e) => {
  const b = e.target.closest('[data-mode]');
  if (b) setAuthMode(b.dataset.mode);
};
$('#authForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!sb) return toast('아직 Supabase 연결 정보(config.js)가 없어요');
  const f = e.target;
  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  try {
    const email = f.email.value.trim();
    let session;
    if (authMode === 'signup') {
      const name = f.name.value.trim();
      if (!name) throw new Error('이름을 입력해 주세요');
      const data = await q(sb.auth.signUp({ email, password: f.password.value, options: { data: { name }, emailRedirectTo: APP_URL } }));
      session = data.session;
      if (!session) {
        toast('가입 확인 메일을 보냈어요. 메일의 링크를 누르면 로그인돼요');
        return;
      }
    } else {
      session = (await q(sb.auth.signInWithPassword({ email, password: f.password.value }))).session;
    }
    f.reset();
    await enterApp(session.user);
  } catch (err) { toast(err.message); } finally { btn.disabled = false; }
};
$('#forgotBtn').onclick = async () => {
  if (!sb) return;
  const email = $('#authForm').email.value.trim();
  if (!email) return toast('위의 이메일 칸에 가입한 이메일을 먼저 입력해 주세요');
  try {
    await q(sb.auth.resetPasswordForEmail(email, { redirectTo: APP_URL }));
    toast('비밀번호 재설정 메일을 보냈어요. 메일함을 확인해 주세요');
  } catch (err) { toast(err.message); }
};
function showAuth() {
  closeSheet();
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  showInviteBanner();
}

// ---------- 초대 링크로 들어온 경우 ----------
// 주소의 ?invite=토큰 을 기억해 두었다가 (가입/로그인 후에도) 여행에 참여시킴
const INVITE_KEY = 'pendingInvite';
let inviteToken = null;
(function readInviteFromUrl() {
  const params = new URLSearchParams(location.search);
  const t = params.get('invite');
  if (t) {
    params.delete('invite');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
    try { localStorage.setItem(INVITE_KEY, t); } catch { /* 저장 불가 */ }
    inviteToken = t;
  } else {
    try { inviteToken = localStorage.getItem(INVITE_KEY); } catch { /* 저장 불가 */ }
  }
})();
function clearInvite() {
  inviteToken = null;
  try { localStorage.removeItem(INVITE_KEY); } catch { /* 저장 불가 */ }
}
async function showInviteBanner() {
  const el = $('#inviteBanner');
  if (!sb) {
    el.innerHTML = '아직 Supabase 연결 정보가 없어요.<br><small><b>config.js</b>에 Project URL과 키를 넣어 주세요.</small>';
    el.classList.add('error');
    el.classList.remove('hidden');
    return;
  }
  if (!inviteToken) { el.classList.add('hidden'); return; }
  try {
    const inv = await db.inviteInfo(inviteToken);
    el.innerHTML = `<b>${esc(inv.inviter)}</b>님이 <b>‘${esc(inv.title)}’</b> 여행에 초대했어요.<br>
      <small>처음이면 회원가입, 이미 계정이 있으면 로그인하면 바로 참여돼요.</small>`;
    el.classList.remove('error');
    setAuthMode('signup');
  } catch (err) {
    el.textContent = err.message;
    el.classList.add('error');
    clearInvite();
  }
  el.classList.remove('hidden');
}
async function acceptPendingInvite() {
  if (!inviteToken) return;
  const token = inviteToken;
  clearInvite();
  try {
    const r = await db.acceptInvite(token);
    state.filter = Number(r.trip_id);
    toast(r.already ? `이미 ‘${r.title}’ 여행 멤버예요` : `‘${r.title}’ 여행에 참여했어요 🎉`);
  } catch (err) { toast(err.message); }
}

// ---------- 앱 ----------
async function enterApp(user) {
  let name = user.user_metadata?.name || user.email.split('@')[0];
  try {
    const p = await q(sb.from('profiles').select('name').eq('id', user.id).maybeSingle());
    if (p?.name) name = p.name;
  } catch { /* 이름은 가입 정보로 */ }
  state.me = { id: user.id, email: user.email, name };
  await showApp();
}

async function showApp() {
  $('#auth').classList.add('hidden');
  $('#inviteBanner').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#meBtn').innerHTML = initial(state.me.name);
  if (!map) initMap();
  setTimeout(() => map.invalidateSize(), 0);
  await acceptPendingInvite();
  await refresh(true);
}

function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([36.4, 127.9], 7);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
}

async function refresh(fit = false) {
  try {
    state.trips = await db.trips();
    if (state.filter !== 'all' && !state.trips.some((t) => t.id === state.filter)) state.filter = 'all';
    state.places = await db.places(state.filter);
  } catch (err) { toast(err.message); return; }
  renderFilter();
  renderMap(fit);
  renderTimeline();
  renderTrips();
}

function renderFilter() {
  const sel = $('#tripFilter');
  const total = state.trips.reduce((n, t) => n + t.place_count, 0);
  sel.innerHTML = `<option value="all">🌏 모든 여행 (${total})</option>`
    + state.trips.map((t) => `<option value="${t.id}">🧳 ${esc(t.title)} (${t.place_count})</option>`).join('');
  sel.value = String(state.filter);
}
$('#tripFilter').onchange = (e) => {
  state.filter = e.target.value === 'all' ? 'all' : Number(e.target.value);
  refresh(true);
};

function renderMap(fit) {
  markerLayer.clearLayers();
  $('#view-map .map-empty')?.remove();
  const ordered = [...state.places].sort(byVisit);
  const single = state.filter !== 'all';
  ordered.forEach((p, i) => {
    const th = p.photos[0]?.thumb;
    const html = `<div class="pin">${th ? `<img src="${esc(th)}" alt="">` : catIcon(p.category)}</div>`
      + (single ? `<div class="pin-num">${i + 1}</div>` : '');
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({ html, className: 'pin-wrap', iconSize: [44, 44], iconAnchor: [22, 51] }),
      title: p.name,
    }).on('click', () => openPlace(p.id)).addTo(markerLayer);
  });
  if (single && ordered.length > 1) {
    L.polyline(ordered.map((p) => [p.lat, p.lng]), {
      color: '#0f766e', weight: 3, opacity: 0.75, dashArray: '6 8', interactive: false,
    }).addTo(markerLayer);
  }
  if (!ordered.length) {
    const msg = state.trips.length
      ? '아직 기록이 없어요. 오른쪽 아래 <b>＋</b> 버튼으로 첫 장소를 남겨보세요!'
      : '반가워요! 먼저 <b>여행</b> 탭에서 여행을 만들고, 함께 간 친구를 초대해 보세요.';
    $('#view-map').insertAdjacentHTML('beforeend', `<div class="map-empty">${msg}</div>`);
  } else if (fit) {
    map.fitBounds(ordered.map((p) => [p.lat, p.lng]), { padding: [60, 60], maxZoom: 14 });
  }
}

function placeCard(p) {
  const th = p.photos[0]?.thumb;
  return `<button class="card" data-place="${p.id}">
    ${th ? `<img class="thumb" src="${esc(th)}" alt="" loading="lazy">` : `<div class="thumb">${catIcon(p.category)}</div>`}
    <div class="body">
      <b>${esc(p.name)}</b>
      ${p.comment ? `<span class="comment">${esc(p.comment)}</span>` : ''}
      <small>${catLabel(p.category)} · ${esc(p.author)}${state.filter === 'all' ? ` · ${esc(p.trip_title)}` : ''}${p.photos.length > 1 ? ` · 사진 ${p.photos.length}` : ''}</small>
    </div>
  </button>`;
}
function renderTimeline() {
  const el = $('#timeline');
  if (!state.places.length) {
    el.innerHTML = '<div class="empty"><div class="big">🗺️</div>아직 기록이 없어요</div>';
    return;
  }
  const sorted = [...state.places].sort(byVisit).reverse();
  let html = '';
  let last = null;
  for (const p of sorted) {
    const d = visitKey(p);
    if (d !== last) { html += `<h3 class="tl-date">${fmtDate(d)}</h3>`; last = d; }
    html += placeCard(p);
  }
  el.innerHTML = html;
}
$('#timeline').onclick = (e) => {
  const c = e.target.closest('[data-place]');
  if (c) openPlace(Number(c.dataset.place));
};

function renderTrips() {
  const places = state.trips.reduce((n, t) => n + t.place_count, 0);
  const friends = new Set(state.trips.flatMap((t) => t.members.map((m) => m.id)).filter((id) => id !== state.me.id));
  $('#tripStats').innerHTML = `<div><b>${state.trips.length}</b><small>여행</small></div>
    <div><b>${places}</b><small>장소</small></div><div><b>${friends.size}</b><small>함께한 친구</small></div>`;
  $('#tripList').innerHTML = state.trips.length
    ? state.trips.map((t) => `<button class="card trip-card" data-trip="${t.id}">
        ${t.cover ? `<img class="thumb" src="${esc(t.cover)}" alt="" loading="lazy">` : '<div class="thumb">🧳</div>'}
        <div class="body">
          <b>${esc(t.title)}</b>
          <small>📅 ${fmtRange(t.start_date, t.end_date)} · 📍 ${t.place_count}곳</small>
          <small>👥 ${t.members.map((m) => esc(m.name)).join(', ')}</small>
        </div></button>`).join('')
    : '<div class="empty"><div class="big">🧳</div>첫 여행을 만들어 보세요</div>';
}
$('#tripList').onclick = (e) => {
  const c = e.target.closest('[data-trip]');
  if (c) openTrip(Number(c.dataset.trip));
};
$('#newTripBtn').onclick = () => openTripForm();

function switchView(view) {
  state.view = view;
  for (const v of ['map', 'timeline', 'trips']) $(`#view-${v}`).classList.toggle('hidden', v !== view);
  for (const b of document.querySelectorAll('.tabbar button')) b.classList.toggle('on', b.dataset.view === view);
  if (view === 'map') setTimeout(() => map.invalidateSize(), 0);
}
document.querySelector('.tabbar').onclick = (e) => {
  const b = e.target.closest('[data-view]');
  if (b) switchView(b.dataset.view);
};

// ---------- 내 정보 ----------
function passwordFields(withCurrent) {
  return `${withCurrent ? '<label class="field"><span>현재 비밀번호</span><input name="current" type="password" autocomplete="current-password" required></label>' : ''}
    <label class="field"><span>새 비밀번호 (6자 이상)</span><input name="next" type="password" autocomplete="new-password" minlength="6" required></label>
    <label class="field"><span>새 비밀번호 확인</span><input name="confirm" type="password" autocomplete="new-password" minlength="6" required></label>`;
}

$('#meBtn').onclick = () => {
  const body = openSheet(`<h2>${esc(state.me.name)}</h2>
    <p class="muted">${esc(state.me.email)}</p>
    <div class="divider"></div>
    <h3 style="margin:0 0 12px">비밀번호 변경</h3>
    <form id="pwForm">
      <input name="email" autocomplete="username" value="${esc(state.me.email)}" hidden>
      ${passwordFields(true)}
      <button class="primary" type="submit">비밀번호 바꾸기</button>
      <small class="hint">바꾸면 지금 쓰는 기기를 뺀 다른 기기에서는 로그아웃돼요.</small>
    </form>
    <div class="divider"></div>
    <div class="btn-row">
      <button class="btn" id="logoutBtn">로그아웃</button>
      <button class="btn danger" id="leaveBtn">회원 탈퇴</button>
    </div>`);
  $('#pwForm', body).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.next.value !== f.confirm.value) return toast('새 비밀번호가 서로 달라요');
    if (f.next.value === f.current.value) return toast('지금과 다른 비밀번호를 입력해 주세요');
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    try {
      // 현재 비밀번호가 맞는지 먼저 확인
      const check = await sb.auth.signInWithPassword({ email: state.me.email, password: f.current.value });
      if (check.error) throw new Error('현재 비밀번호가 틀렸어요');
      await q(sb.auth.updateUser({ password: f.next.value }));
      await sb.auth.signOut({ scope: 'others' }).catch(() => {});
      closeSheet();
      toast('비밀번호를 바꿨어요. 다른 기기에서는 로그아웃됐어요');
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  };
  $('#logoutBtn', body).onclick = async () => {
    await sb.auth.signOut().catch(() => {});
    state.me = null;
    state.filter = 'all';
    showAuth();
  };
  $('#leaveBtn', body).onclick = async () => {
    const typed = prompt('탈퇴하면 계정, 내가 만든 여행, 내가 쓴 기록과 사진이 모두 지워지고 되돌릴 수 없어요.\n계속하려면 "탈퇴"라고 입력해 주세요.');
    if (typed?.trim() !== '탈퇴') return;
    try {
      const paths = await q(sb.rpc('my_storage_paths'));
      await removeFiles((paths || []).map((x) => (typeof x === 'string' ? x : Object.values(x)[0])));
      await q(sb.rpc('delete_my_account'));
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      state.me = null;
      state.filter = 'all';
      showAuth();
      toast('탈퇴했어요. 그동안 고마웠어요');
    } catch (err) { toast(err.message); }
  };
};

// 비밀번호 재설정 메일의 링크로 들어온 경우
function openNewPassword() {
  const body = openSheet(`<h2>새 비밀번호 정하기</h2>
    <form id="newPwForm">${passwordFields(false)}<button class="primary" type="submit">저장</button></form>`);
  $('#newPwForm', body).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.next.value !== f.confirm.value) return toast('새 비밀번호가 서로 달라요');
    try {
      await q(sb.auth.updateUser({ password: f.next.value }));
      closeSheet();
      toast('새 비밀번호로 바꿨어요');
    } catch (err) { toast(err.message); }
  };
}

// ---------- 장소 상세 ----------
function openPlace(id) {
  const p = state.places.find((x) => x.id === id);
  if (!p) return;
  const trip = state.trips.find((t) => t.id === p.trip_id);
  const canEdit = p.user_id === state.me.id || trip?.owner_id === state.me.id;
  const body = openSheet(`
    ${p.photos.length ? `<div class="gallery">${p.photos.map((ph) => `<div class="g-item">
        <img src="${esc(ph.url)}" alt="" loading="lazy" data-full="${esc(ph.url)}">
        ${canEdit || ph.user_id === state.me.id ? `<button class="g-del" data-photo="${ph.id}" aria-label="사진 삭제">✕</button>` : ''}
      </div>`).join('')}</div>` : ''}
    <span class="pd-cat">${catLabel(p.category)}</span>
    <h2 class="pd-name">${esc(p.name)}</h2>
    ${p.comment ? `<p class="pd-comment">${esc(p.comment)}</p>` : ''}
    <div class="pd-meta">
      <span>📅 ${fmtDate(visitKey(p))}</span>
      <span>✍️ ${esc(p.author)}</span>
      <span>🧳 ${esc(p.trip_title)}</span>
    </div>
    <div class="btn-row">
      <button class="btn" data-act="locate">🗺️ 지도에서 보기</button>
      <label class="btn">📷 사진 추가<input type="file" accept="image/*" multiple hidden></label>
      ${canEdit ? '<button class="btn" data-act="edit">✏️ 수정</button><button class="btn danger" data-act="delete">삭제</button>' : ''}
    </div>`);

  body.onclick = async (e) => {
    const img = e.target.closest('[data-full]');
    if (img) return showPhoto(img.dataset.full);
    const del = e.target.closest('[data-photo]');
    if (del) {
      if (!confirm('이 사진을 삭제할까요?')) return;
      try {
        await db.deletePhoto(p.photos.find((ph) => ph.id === Number(del.dataset.photo)));
        await refresh();
        openPlace(id);
      } catch (err) { toast(err.message); }
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'locate') {
      closeSheet();
      switchView('map');
      setTimeout(() => map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 15)), 50);
    } else if (act === 'edit') {
      openEditPlace(p);
    } else if (act === 'delete') {
      if (!confirm(`'${p.name}' 기록과 사진을 모두 삭제할까요? 되돌릴 수 없어요.`)) return;
      try {
        await db.deletePlace(p);
        closeSheet();
        toast('삭제했어요');
        refresh();
      } catch (err) { toast(err.message); }
    }
  };
  $('input[type=file]', body).onchange = async (e) => {
    const files = [...e.target.files].slice(0, 10);
    e.target.value = '';
    if (!files.length) return;
    if (p.photos.length + files.length > 30) return toast('한 장소에는 사진을 30장까지 올릴 수 있어요');
    toast(`사진 ${files.length}장을 줄여서 올리는 중…`);
    const items = [];
    try {
      for (const f of files) items.push(await processPhoto(f));
      await db.uploadPhotos(p.trip_id, p.id, items);
      toast('사진을 추가했어요');
      await refresh();
      openPlace(id);
    } catch (err) { toast(err.message); } finally { items.forEach((it) => URL.revokeObjectURL(it.preview)); }
  };
}

function catPicker(selected) {
  return `<div class="cats">${Object.entries(CATS).map(([k, [ic, label]]) => `<label>
    <input type="radio" name="category" value="${k}" ${k === selected ? 'checked' : ''}><span>${ic} ${label}</span></label>`).join('')}</div>`;
}

function openEditPlace(p) {
  const body = openSheet(`<h2>기록 수정</h2>
    <form id="editForm">
      <label class="field"><span>장소 이름</span><input name="name" required maxlength="60" value="${esc(p.name)}"></label>
      <label class="field"><span>한줄 코멘트</span><input name="comment" maxlength="80" value="${esc(p.comment || '')}"></label>
      <label class="field"><span>날짜</span><input type="date" name="visited_at" value="${esc(p.visited_at || '')}"></label>
      <div class="field"><span>종류</span>${catPicker(p.category)}</div>
      <button class="primary" type="submit">저장</button>
    </form>`);
  $('#editForm', body).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await db.updatePlace(p.id, {
        name: f.name.value.trim(), comment: f.comment.value.trim() || null,
        visited_at: f.visited_at.value || null, category: f.category.value,
      });
      await refresh();
      openPlace(p.id);
      toast('수정했어요');
    } catch (err) { toast(err.message); }
  };
}

// ---------- 장소 기록하기 ----------
$('#fab').onclick = () => openAddPlace();

function openAddPlace() {
  if (!state.trips.length) {
    toast('먼저 여행을 만들어 주세요');
    openTripForm();
    return;
  }
  const defTrip = state.filter !== 'all' ? state.filter : state.trips[0].id;
  const pending = [];
  let pos = null;
  let mini = null;
  let miniMarker = null;
  let dateTouched = false;
  let nameTouched = false;

  const body = openSheet(`<h2>장소 기록하기</h2>
    <form id="addForm" autocomplete="off">
      <label class="field"><span>여행</span><select name="trip">${state.trips.map((t) => `<option value="${t.id}" ${t.id === defTrip ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select></label>
      <div class="field"><span>사진 <small id="photoCount"></small></span>
        <div class="photo-strip" id="strip">
          <label class="add-photo">＋<small>사진 선택</small><input type="file" accept="image/*" multiple hidden id="photoInput"></label>
        </div>
        <small class="hint">사진에 위치·날짜 정보가 있으면 자동으로 채워져요. 올릴 때 자동으로 용량을 줄여요.</small>
      </div>
      <div class="field"><span>장소 이름</span>
        <div class="search-row"><input name="name" maxlength="60" placeholder="예: 오사카성, 공주역" enterkeyhint="search"><button type="button" id="searchBtn">검색</button></div>
        <div id="results" class="results"></div>
      </div>
      <div class="field"><span>위치 <small id="posLabel">지도를 눌러 선택하세요</small></span>
        <div id="miniMap" class="mini-map"></div>
        <button type="button" class="link" id="myPosBtn">📍 지금 있는 위치 사용</button>
      </div>
      <label class="field"><span>날짜</span><input type="date" name="visited_at" value="${today()}"></label>
      <div class="field"><span>종류</span>${catPicker('sight')}</div>
      <label class="field"><span>한줄 코멘트 <small id="cnt">0/80</small></span><input name="comment" maxlength="80" placeholder="이곳에서의 한마디"></label>
      <button class="primary" type="submit" id="saveBtn">기록 남기기</button>
    </form>`, () => {
    mini?.remove();
    pending.forEach((p) => URL.revokeObjectURL(p.preview));
  });

  const form = $('#addForm', body);
  const strip = $('#strip', body);
  const results = $('#results', body);

  // 미니 지도 (시트가 올라온 뒤 생성해야 크기가 맞음)
  setTimeout(() => {
    if (!body.isConnected || !$('#miniMap', body)) return;
    mini = L.map($('#miniMap', body), { zoomControl: false, attributionControl: false })
      .setView(map.getCenter(), Math.max(map.getZoom(), 5));
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mini);
    mini.on('click', (e) => setPos(e.latlng.lat, e.latlng.lng));
    if (pos) setPos(pos.lat, pos.lng, 15);
  }, 260);

  function setPos(lat, lng, zoom) {
    pos = { lat, lng };
    $('#posLabel', body).textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)} (핀을 끌어서 조정)`;
    if (!mini) return;
    if (!miniMarker) {
      miniMarker = L.marker([lat, lng], { draggable: true }).addTo(mini);
      miniMarker.on('dragend', () => {
        const ll = miniMarker.getLatLng();
        setPos(ll.lat, ll.lng);
      });
    } else miniMarker.setLatLng([lat, lng]);
    if (zoom) mini.setView([lat, lng], zoom);
  }

  async function fillNameFrom(lat, lng) {
    if (nameTouched || form.name.value) return;
    try {
      const name = await reverseGeocode(lat, lng);
      if (name && !nameTouched && !form.name.value) form.name.value = name;
    } catch { /* 이름은 직접 입력 */ }
  }

  function renderStrip() {
    strip.querySelectorAll('.ph').forEach((el) => el.remove());
    const add = strip.querySelector('.add-photo');
    pending.forEach((p, i) => {
      add.insertAdjacentHTML('beforebegin', `<div class="ph"><img src="${p.preview}" alt="">
        <span class="size">${fmtSize(p.before)}→${fmtSize(p.after)}</span>
        <button type="button" class="x" data-rm="${i}" aria-label="빼기">✕</button></div>`);
    });
    const before = pending.reduce((n, p) => n + p.before, 0);
    const after = pending.reduce((n, p) => n + p.after, 0);
    $('#photoCount', body).textContent = pending.length ? `${pending.length}장 · ${fmtSize(before)} → ${fmtSize(after)}` : '';
  }
  strip.onclick = (e) => {
    const rm = e.target.closest('[data-rm]');
    if (!rm) return;
    const [removed] = pending.splice(Number(rm.dataset.rm), 1);
    URL.revokeObjectURL(removed.preview);
    renderStrip();
  };

  $('#photoInput', body).onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const file of files) {
      if (pending.length >= 10) { toast('한 번에 10장까지 올릴 수 있어요'); break; }
      const loading = document.createElement('div');
      loading.className = 'ph loading';
      loading.textContent = '줄이는 중…';
      strip.querySelector('.add-photo').before(loading);
      try {
        const item = await processPhoto(file);
        if (!body.isConnected) { URL.revokeObjectURL(item.preview); return; }
        pending.push(item);
        if (item.gps && !pos) {
          setPos(item.gps.lat, item.gps.lng, 16);
          fillNameFrom(item.gps.lat, item.gps.lng);
          toast('사진의 위치 정보로 지도에 표시했어요');
        }
        if (item.date && !dateTouched) form.visited_at.value = item.date;
      } catch (err) { toast(err.message); } finally { loading.remove(); }
      renderStrip();
    }
  };

  form.visited_at.oninput = () => { dateTouched = true; };
  form.name.oninput = () => { nameTouched = true; };
  form.comment.oninput = () => { $('#cnt', body).textContent = `${form.comment.value.length}/80`; };

  async function doSearch() {
    const qv = form.name.value.trim();
    if (!qv) return toast('검색할 장소 이름을 입력해 주세요');
    results.innerHTML = '<div class="hint">검색 중…</div>';
    try {
      const list = await geocode(qv);
      results.innerHTML = list.length
        ? list.map((r, i) => `<button type="button" data-i="${i}"><b>${esc(r.name)}</b><small>${esc(r.address)}</small></button>`).join('')
        : '<div class="hint">검색 결과가 없어요. 지도를 직접 눌러 위치를 정해 주세요.</div>';
      results.onclick = (ev) => {
        const b = ev.target.closest('[data-i]');
        if (!b) return;
        const r = list[Number(b.dataset.i)];
        form.name.value = r.name;
        nameTouched = true;
        setPos(r.lat, r.lng, 16);
        results.innerHTML = '';
      };
    } catch (err) { results.innerHTML = `<div class="hint">${esc(err.message)}</div>`; }
  }
  $('#searchBtn', body).onclick = doSearch;
  form.name.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
  };

  $('#myPosBtn', body).onclick = () => {
    if (!window.isSecureContext || !navigator.geolocation) {
      return toast('현재 위치는 https 주소에서만 쓸 수 있어요');
    }
    toast('위치를 찾는 중…');
    navigator.geolocation.getCurrentPosition(
      (g) => {
        setPos(g.coords.latitude, g.coords.longitude, 17);
        fillNameFrom(g.coords.latitude, g.coords.longitude);
      },
      () => toast('위치를 가져오지 못했어요. 위치 권한을 확인해 주세요'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) return toast('장소 이름을 입력해 주세요');
    if (!pos) return toast('지도를 눌러 위치를 정해 주세요');
    const btn = $('#saveBtn', body);
    btn.disabled = true;
    btn.textContent = pending.length ? `사진 ${pending.length}장 올리는 중…` : '저장 중…';
    try {
      const tripId = Number(form.trip.value);
      const id = await db.createPlace(tripId, {
        name, lat: pos.lat, lng: pos.lng,
        visited_at: form.visited_at.value || null,
        category: form.category.value,
        comment: form.comment.value.trim() || null,
      }, pending);
      closeSheet();
      toast('기록했어요 ✈️');
      if (state.filter !== 'all' && state.filter !== tripId) state.filter = tripId;
      await refresh();
      switchView('map');
      const p = state.places.find((x) => x.id === id);
      if (p) setTimeout(() => map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 14)), 50);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
      btn.textContent = '기록 남기기';
    }
  };
}

// ---------- 여행 ----------
function openTripForm(trip) {
  const body = openSheet(`<h2>${trip ? '여행 정보 수정' : '새 여행 만들기'}</h2>
    <form id="tripForm">
      <label class="field"><span>여행 이름</span><input name="title" required maxlength="40" placeholder="예: 2025 오사카 먹방 여행" value="${esc(trip?.title || '')}"></label>
      <div class="grid2">
        <label class="field"><span>시작일</span><input type="date" name="start_date" value="${esc(trip?.start_date || '')}"></label>
        <label class="field"><span>종료일</span><input type="date" name="end_date" value="${esc(trip?.end_date || '')}"></label>
      </div>
      <button class="primary" type="submit">${trip ? '저장' : '만들기'}</button>
    </form>`);
  $('#tripForm', body).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const data = { title: f.title.value, start_date: f.start_date.value, end_date: f.end_date.value };
    try {
      if (trip) {
        await db.updateTrip(trip.id, data);
        await refresh();
        openTrip(trip.id);
      } else {
        const id = await db.createTrip(data);
        state.filter = id;
        await refresh(true);
        openTrip(id);
        toast('여행을 만들었어요. 함께 간 친구를 초대해 보세요!');
      }
    } catch (err) { toast(err.message); }
  };
}

async function copyText(text, input) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* 일부 브라우저는 clipboard API가 막혀 있음 → 예전 방식으로 */ }
  input.focus();
  input.select();
  input.setSelectionRange(0, text.length);
  try { return document.execCommand('copy'); } catch { return false; }
}

async function openInviteLink(trip, reset = false) {
  const inv = await db.createInvite(trip.id, reset);
  const url = `${APP_URL}?invite=${encodeURIComponent(inv.token)}`;
  const text = `‘${trip.title}’ 여행 기록에 초대할게요! 링크를 눌러 가입하면 같이 기록할 수 있어요.`;
  const daysLeft = Math.max(1, Math.ceil((Date.parse(inv.expires_at) - Date.now()) / 86400000));
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const isOwner = trip.owner_id === state.me.id;

  const body = openSheet(`<h2>초대 링크</h2>
    <p class="muted" style="margin-top:-6px">‘${esc(trip.title)}’ · 앞으로 ${daysLeft}일 동안 쓸 수 있어요</p>
    ${isLocal ? `<div class="invite-banner error">지금 주소(${esc(location.host)})는 이 컴퓨터에서만 열려요.
      친구에게는 GitHub Pages 주소에서 만든 링크를 보내 주세요.</div>` : ''}
    <input class="link-box" id="inviteUrl" readonly value="${esc(url)}">
    <div class="btn-row">
      ${navigator.share ? '<button class="btn" data-act="share">📤 공유하기</button>' : ''}
      <button class="btn" data-act="copy">📋 링크 복사</button>
      <button class="btn" data-act="back">← 여행으로</button>
    </div>
    ${isOwner ? `<div class="divider"></div>
      <button class="link" data-act="reset" style="color:var(--danger)">링크 새로 만들기</button>
      <small class="hint">지금 링크는 더 이상 쓸 수 없게 돼요. 링크가 엉뚱한 사람에게 갔을 때 쓰세요.</small>` : ''}`);

  body.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'share') {
      try { await navigator.share({ title: '여행 기록 초대', text, url }); } catch { /* 취소 */ }
    } else if (act === 'copy') {
      const ok = await copyText(`${text}\n${url}`, $('#inviteUrl', body));
      toast(ok ? '링크를 복사했어요. 카톡에 붙여넣어 보내세요' : '복사가 안 되네요. 링크를 길게 눌러 복사해 주세요');
    } else if (act === 'back') {
      openTrip(trip.id);
    } else if (act === 'reset') {
      if (!confirm('지금 링크를 못 쓰게 하고 새 링크를 만들까요?')) return;
      try {
        await openInviteLink(trip, true);
        toast('새 링크를 만들었어요');
      } catch (err) { toast(err.message); }
    }
  };
}

function openTrip(id) {
  const t = state.trips.find((x) => x.id === id);
  if (!t) return;
  const isOwner = t.owner_id === state.me.id;
  const body = openSheet(`<h2>${esc(t.title)}</h2>
    <p class="muted" style="margin-top:-6px">📅 ${fmtRange(t.start_date, t.end_date)} · 📍 ${t.place_count}곳</p>
    <div class="btn-row">
      <button class="btn" data-act="view">🗺️ 이 여행 지도로 보기</button>
      <button class="btn" data-act="edit">✏️ 수정</button>
    </div>
    <div class="divider"></div>
    <h3 style="margin:0 0 6px">함께한 사람 (${t.members.length})</h3>
    <div>${t.members.map((m) => `<div class="member">
        <div class="avatar">${initial(m.name)}</div>
        <div class="grow">${esc(m.name)}${m.id === t.owner_id ? ' <small>· 만든 사람</small>' : ''}${m.id === state.me.id ? ' <small>(나)</small>' : ''}</div>
        ${isOwner && m.id !== t.owner_id ? `<button data-kick="${m.id}">내보내기</button>` : ''}
      </div>`).join('')}</div>
    <button class="primary" data-act="invite" style="margin-top:14px">🔗 초대 링크 보내기</button>
    <small class="hint">카톡 등으로 링크를 보내면, 친구가 누르고 가입하는 즉시 이 여행에 들어와요.</small>
    <div class="divider"></div>
    <div class="btn-row">${isOwner
      ? '<button class="btn danger" data-act="delete">여행 삭제</button>'
      : '<button class="btn danger" data-act="leave">이 여행에서 나가기</button>'}</div>`);

  body.onclick = async (e) => {
    const kick = e.target.closest('[data-kick]');
    const act = e.target.closest('[data-act]')?.dataset.act;
    try {
      if (act === 'invite') {
        await openInviteLink(t);
      } else if (kick) {
        if (!confirm('이 사람을 여행에서 내보낼까요? 그 사람이 쓴 기록은 남아요. 초대 링크로 다시 들어오지 못하게 하려면 링크도 새로 만들어 주세요.')) return;
        await db.removeMember(id, kick.dataset.kick);
        await refresh();
        openTrip(id);
      } else if (act === 'view') {
        state.filter = id;
        closeSheet();
        switchView('map');
        await refresh(true);
      } else if (act === 'edit') {
        openTripForm(t);
      } else if (act === 'delete') {
        if (!confirm(`'${t.title}' 여행의 모든 기록과 사진이 삭제돼요. 되돌릴 수 없어요. 삭제할까요?`)) return;
        await db.deleteTrip(id);
        closeSheet();
        toast('여행을 삭제했어요');
        refresh(true);
      } else if (act === 'leave') {
        if (!confirm('이 여행에서 나갈까요?')) return;
        await db.removeMember(id, state.me.id);
        closeSheet();
        refresh(true);
      }
    } catch (err) { toast(err.message); }
  };
}

// ---------- 시작 ----------
(async () => {
  if (!sb) { showAuth(); return; }
  sb.auth.onAuthStateChange((event) => {
    // 이 안에서 바로 Supabase를 부르면 멈출 수 있어서 setTimeout으로 미룸
    if (event === 'PASSWORD_RECOVERY') setTimeout(openNewPassword, 400);
    if (event === 'SIGNED_OUT' && state.me) setTimeout(() => { state.me = null; showAuth(); }, 0);
  });
  try {
    const { data } = await sb.auth.getSession();
    if (data.session) await enterApp(data.session.user);
    else showAuth();
  } catch {
    showAuth();
  }
})();
