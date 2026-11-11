'use strict';

// ---------- 유틸 ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(url, { method = 'GET', body } = {}) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
  }
  let res;
  try { res = await fetch(url, opts); } catch {
    throw new Error(navigator.onLine === false
      ? '인터넷 연결을 확인해 주세요'
      : '서버에 연결할 수 없어요. 서버(npm start)가 켜져 있는지 확인해 주세요');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.me) { state.me = null; showAuth(); }
  if (!res.ok) throw new Error(data.error || '요청에 실패했어요');
  return data;
}

// ---------- 상태 ----------
const state = { me: null, trips: [], places: [], filter: 'all', view: 'map' };
let map, markerLayer;

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
  const w = img.width;
  const h = img.height;
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
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
function appendPhotos(fd, items) {
  items.forEach((p, i) => {
    fd.append('photos', p.photo, `photo${i}.jpg`);
    fd.append('thumbs', p.thumb, `thumb${i}.jpg`);
  });
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
}
$('#authTabs').onclick = (e) => {
  const b = e.target.closest('[data-mode]');
  if (b) setAuthMode(b.dataset.mode);
};
$('#authForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  try {
    state.me = await api(authMode === 'signup' ? '/api/signup' : '/api/login', {
      method: 'POST',
      body: { username: f.username.value, name: f.name.value, password: f.password.value },
    });
    f.reset();
    showApp();
  } catch (err) { toast(err.message); } finally { btn.disabled = false; }
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
    try { sessionStorage.setItem(INVITE_KEY, t); } catch { /* 저장 불가 */ }
    inviteToken = t;
  } else {
    try { inviteToken = sessionStorage.getItem(INVITE_KEY); } catch { /* 저장 불가 */ }
  }
})();
function clearInvite() {
  inviteToken = null;
  try { sessionStorage.removeItem(INVITE_KEY); } catch { /* 저장 불가 */ }
}
async function showInviteBanner() {
  const el = $('#inviteBanner');
  if (location.protocol === 'file:') {
    el.innerHTML = '이 파일을 직접 열면 로그인할 수 없어요.<br><small>터미널에서 <b>npm start</b>를 실행한 뒤 '
      + '화면에 나오는 주소(예: http://localhost:3000)로 접속해 주세요.</small>';
    el.classList.add('error');
    el.classList.remove('hidden');
    return;
  }
  if (!inviteToken) { el.classList.add('hidden'); return; }
  try {
    const inv = await api(`/api/invites/${encodeURIComponent(inviteToken)}`);
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
    const r = await api(`/api/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' });
    state.filter = r.trip_id;
    toast(r.already ? `이미 ‘${r.title}’ 여행 멤버예요` : `‘${r.title}’ 여행에 참여했어요 🎉`);
  } catch (err) { toast(err.message); }
}

// ---------- 앱 ----------
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
    state.trips = await api('/api/trips');
    if (state.filter !== 'all' && !state.trips.some((t) => t.id === state.filter)) state.filter = 'all';
    const qs = state.filter === 'all' ? '' : `?trip=${state.filter}`;
    state.places = await api(`/api/places${qs}`);
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

$('#meBtn').onclick = () => {
  const body = openSheet(`<h2>${esc(state.me.name)}</h2>
    <p class="muted">아이디: <b>${esc(state.me.username)}</b><br>친구가 여행에 초대할 때 이 아이디를 알려주세요.</p>
    <div class="divider"></div>
    <h3 style="margin:0 0 12px">비밀번호 변경</h3>
    <form id="pwForm">
      <input name="username" autocomplete="username" value="${esc(state.me.username)}" hidden>
      <label class="field"><span>현재 비밀번호</span><input name="current" type="password" autocomplete="current-password" required></label>
      <label class="field"><span>새 비밀번호 (6자 이상)</span><input name="next" type="password" autocomplete="new-password" minlength="6" required></label>
      <label class="field"><span>새 비밀번호 확인</span><input name="confirm" type="password" autocomplete="new-password" minlength="6" required></label>
      <button class="primary" type="submit">비밀번호 바꾸기</button>
      <small class="hint">바꾸면 지금 쓰는 기기를 뺀 다른 기기에서는 로그아웃돼요.</small>
    </form>
    <div class="divider"></div>
    <div class="btn-row"><button class="btn danger" id="logoutBtn">로그아웃</button></div>`);
  $('#pwForm', body).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.next.value !== f.confirm.value) return toast('새 비밀번호가 서로 달라요');
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    try {
      const r = await api('/api/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
      closeSheet();
      toast(r.signed_out ? `비밀번호를 바꿨어요. 다른 기기 ${r.signed_out}곳은 로그아웃됐어요` : '비밀번호를 바꿨어요');
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  };
  $('#logoutBtn', body).onclick = async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    state.me = null;
    state.filter = 'all';
    showAuth();
  };
};

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
        await api(`/api/photos/${del.dataset.photo}`, { method: 'DELETE' });
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
        await api(`/api/places/${p.id}`, { method: 'DELETE' });
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
    toast(`사진 ${files.length}장을 줄이는 중…`);
    try {
      const items = [];
      for (const f of files) items.push(await processPhoto(f));
      const fd = new FormData();
      appendPhotos(fd, items);
      items.forEach((it) => URL.revokeObjectURL(it.preview));
      await api(`/api/places/${p.id}/photos`, { method: 'POST', body: fd });
      toast('사진을 추가했어요');
      await refresh();
      openPlace(id);
    } catch (err) { toast(err.message); }
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
      await api(`/api/places/${p.id}`, {
        method: 'PATCH',
        body: { name: f.name.value, comment: f.comment.value, visited_at: f.visited_at.value, category: f.category.value },
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
        <div class="search-row"><input name="name" maxlength="60" placeholder="예: 오사카성, 성산일출봉" enterkeyhint="search"><button type="button" id="searchBtn">검색</button></div>
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
      const r = await api(`/api/reverse?lat=${lat}&lng=${lng}`);
      if (r.name && !nameTouched && !form.name.value) form.name.value = r.name;
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
      const list = await api(`/api/geocode?q=${encodeURIComponent(qv)}`);
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
    if (!form.name.value.trim()) return toast('장소 이름을 입력해 주세요');
    if (!pos) return toast('지도를 눌러 위치를 정해 주세요');
    const fd = new FormData();
    fd.append('name', form.name.value.trim());
    fd.append('lat', pos.lat);
    fd.append('lng', pos.lng);
    fd.append('visited_at', form.visited_at.value);
    fd.append('category', form.category.value);
    fd.append('comment', form.comment.value.trim());
    appendPhotos(fd, pending);
    const btn = $('#saveBtn', body);
    btn.disabled = true;
    btn.textContent = pending.length ? `사진 ${pending.length}장 올리는 중…` : '저장 중…';
    try {
      const tripId = Number(form.trip.value);
      const { id } = await api(`/api/trips/${tripId}/places`, { method: 'POST', body: fd });
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
        await api(`/api/trips/${trip.id}`, { method: 'PATCH', body: data });
        await refresh();
        openTrip(trip.id);
      } else {
        const { id } = await api('/api/trips', { method: 'POST', body: data });
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
  } catch { /* http 주소에서는 clipboard API가 막혀 있음 → 예전 방식으로 */ }
  input.focus();
  input.select();
  input.setSelectionRange(0, text.length);
  try { return document.execCommand('copy'); } catch { return false; }
}

async function openInviteLink(trip, reset = false) {
  const inv = await api(`/api/trips/${trip.id}/invite`, { method: 'POST', body: { reset } });
  const url = `${location.origin}/?invite=${encodeURIComponent(inv.token)}`;
  const text = `‘${trip.title}’ 여행 기록에 초대할게요! 링크를 눌러 가입하면 같이 기록할 수 있어요.`;
  const expires = Date.parse(`${inv.expires_at.replace(' ', 'T')}Z`);
  const daysLeft = Math.max(1, Math.ceil((expires - Date.now()) / 86400000));
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const isOwner = trip.owner_id === state.me.id;

  const body = openSheet(`<h2>초대 링크</h2>
    <p class="muted" style="margin-top:-6px">‘${esc(trip.title)}’ · 앞으로 ${daysLeft}일 동안 쓸 수 있어요</p>
    ${isLocal ? `<div class="invite-banner error">지금 주소(${esc(location.host)})는 이 컴퓨터에서만 열려요.
      친구가 쓰려면 같은 와이파이에서 PC의 IP 주소로 접속해서 링크를 만들거나, 서버를 배포한 뒤 만들어 주세요.</div>` : ''}
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
        <div class="grow">${esc(m.name)} <small>@${esc(m.username)}${m.id === t.owner_id ? ' · 만든 사람' : ''}</small></div>
        ${isOwner && m.id !== t.owner_id ? `<button data-kick="${m.id}">내보내기</button>` : ''}
      </div>`).join('')}</div>
    <button class="primary" data-act="invite" style="margin-top:14px">🔗 초대 링크 보내기</button>
    <small class="hint">카톡 등으로 링크를 보내면, 친구가 누르고 가입하는 즉시 이 여행에 들어와요.</small>
    <form id="inviteForm" style="margin-top:14px">
      <div class="search-row"><input name="username" placeholder="이미 가입한 친구는 아이디로 초대" autocapitalize="off" required
        style="padding:12px 14px;border:1px solid var(--line);border-radius:12px;font-size:16px"><button type="submit">초대</button></div>
    </form>
    <div class="divider"></div>
    <div class="btn-row">${isOwner
      ? '<button class="btn danger" data-act="delete">여행 삭제</button>'
      : '<button class="btn danger" data-act="leave">이 여행에서 나가기</button>'}</div>`);

  $('#inviteForm', body).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const u = await api(`/api/trips/${id}/members`, { method: 'POST', body: { username: e.target.username.value.trim() } });
      toast(`${u.name}님을 초대했어요`);
      await refresh();
      openTrip(id);
    } catch (err) { toast(err.message); }
  };
  body.onclick = async (e) => {
    const kick = e.target.closest('[data-kick]');
    const act = e.target.closest('[data-act]')?.dataset.act;
    try {
      if (act === 'invite') {
        await openInviteLink(t);
      } else if (kick) {
        if (!confirm('이 사람을 여행에서 내보낼까요? 그 사람이 쓴 기록은 남아요. 초대 링크로 다시 들어오지 못하게 하려면 링크도 새로 만들어 주세요.')) return;
        await api(`/api/trips/${id}/members/${kick.dataset.kick}`, { method: 'DELETE' });
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
        await api(`/api/trips/${id}`, { method: 'DELETE' });
        closeSheet();
        toast('여행을 삭제했어요');
        refresh(true);
      } else if (act === 'leave') {
        if (!confirm('이 여행에서 나갈까요?')) return;
        await api(`/api/trips/${id}/members/${state.me.id}`, { method: 'DELETE' });
        closeSheet();
        refresh(true);
      }
    } catch (err) { toast(err.message); }
  };
}

// ---------- 시작 ----------
(async () => {
  try {
    state.me = await api('/api/me');
    showApp();
  } catch {
    showAuth();
  }
})();
