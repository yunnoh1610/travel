'use strict';

// ---------- 유틸 ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CATS = {
  sight: ['📍', '관광'], food: ['🍜', '맛집'], cafe: ['☕', '카페'],
  stay: ['🏨', '숙소'], nature: ['🌿', '자연'], etc: ['✨', '기타'],
};
// 글래스 테마에서는 이모지 대신 icons/*.svg 그림을 씀 (다른 테마는 이모지 그대로)
const GLASS_ICONS = {
  '📍': 'sight', '🍜': 'food', '☕': 'cafe', '🏨': 'stay', '🌿': 'nature', '✨': 'etc',
  '🧳': 'trip', '🎉': 'gathering', '📒': 'book', '🗺️': 'map',
};
const ic = (emoji) => (currentTheme === 'glass' && GLASS_ICONS[emoji]
  ? `<img class="ic" src="icons/${GLASS_ICONS[emoji]}.svg" alt="">` : emoji);
const catIcon = (c) => ic((CATS[c] || CATS.etc)[0]);
const catLabel = (c) => `${catIcon(c)} ${(CATS[c] || CATS.etc)[1]}`;
// 여행 종류
const KINDS = {
  trip: ['🧳', '여행', '예: 2026 오사카 먹방 여행'],
  gathering: ['🎉', '모임·기념일', '예: 우정 10주년 저녁'],
  daily: ['☕', '일상', '예: 2026 우리 동네 맛집'],
};
const kindEmoji = (k) => (KINDS[k] || KINDS.trip)[0]; // <option> 안처럼 그림을 못 넣는 곳
const kindIcon = (k) => ic(kindEmoji(k));
const kindName = (k) => (KINDS[k] || KINDS.trip)[1];

// 화면 테마 (내 정보에서 고르기)
// css 파일은 index.html 의 <link id="themeCss-키">. 'basic'은 테마 파일 없이 기본 디자인
const THEMES = {
  glass: {
    name: '보라 글래스', icon: '💜', desc: '보라·초록 포인트, 유리처럼 맑은 아이콘', color: '#6E5FAE', route: '#6E5FAE',
    swatch: ['#6E5FAE', '#0BCE83', '#DDD6F2', '#F6F5F5'],
  },
  sketch: { hidden: true, name: '청량 스케치북', icon: '✏️', desc: '하늘색·민트, 모눈 종이와 손글씨', color: '#2aa7d9', route: '#1479a8', swatch: ['#2aa7d9', '#5fd3bf', '#fff1a1', '#fbfaf4'] },
  passport: {
    // 청량한 빈티지 트래블 스크랩북 (예전 이름: 여권 스크랩북 — 저장된 설정을 그대로 쓰려고 키는 passport 유지)
    hidden: true,
    name: '트래블 스크랩북', icon: '✉️', desc: '청량한 빈티지 · 우표·기차표·항공 우편', color: '#2f6f9f', route: '#1f5378',
    swatch: ['#2f6f9f', '#4a9fd8', '#7fcfc2', '#ef7f68'],
    // 지도 경로: 흰 테두리 위 남색 점선
    routeLines: [
      { color: '#ffffff', weight: 7, opacity: 0.85, lineCap: 'round' },
      { color: '#1f5378', weight: 2.8, opacity: 1, dashArray: '8 7', lineCap: 'round' },
    ],
  },
  basic: { hidden: true, name: '기본', icon: '🌿', desc: '차분한 초록, 깔끔한 글꼴', color: '#0f766e', route: '#0f766e', swatch: ['#0f766e', '#e6f4f1', '#ffffff', '#f6f7f5'] },
};
const THEME_KEY = 'travelTheme';
const DEFAULT_THEME = 'glass'; // 테마를 고른 적 없는 사람에게 보이는 테마 (index.html 과 같게)
const usableTheme = (t) => !!THEMES[t] && !THEMES[t].hidden;
const VISIBLE_THEMES = Object.keys(THEMES).filter(usableTheme);
let currentTheme = usableTheme(document.documentElement.dataset.theme) ? document.documentElement.dataset.theme : DEFAULT_THEME;
const routeColor = () => (THEMES[currentTheme] || THEMES.sketch).route;
// 테마에 맞는 경로선 그리기 (여러 겹이면 겹쳐서)
function drawRoute(points, layer) {
  const t = THEMES[currentTheme] || THEMES.sketch;
  const lines = t.routeLines || [{ color: t.route, weight: 3.5, opacity: 0.8, dashArray: '2 9', lineCap: 'round' }];
  for (const style of lines) L.polyline(points, { ...style, interactive: false }).addTo(layer);
}
function applyTheme(t) {
  if (!usableTheme(t)) t = DEFAULT_THEME;
  currentTheme = t;
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('link[id^="themeCss-"]').forEach((l) => { l.disabled = l.id !== `themeCss-${t}`; });
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEMES[t].color);
  try { localStorage.setItem(THEME_KEY, t); } catch { /* 저장 불가 */ }
  // 지도 경로선 색과 아이콘(글래스 테마는 그림 아이콘)을 다시 그림
  if (typeof map !== 'undefined' && map && state.me) { renderFilter(); renderMap(false); renderJournal(); renderTrips(); }
}
function themePicker() {
  return `<div class="theme-list">${VISIBLE_THEMES.map((k) => [k, THEMES[k]]).map(([k, t]) => `
    <button type="button" class="theme-opt ${k === currentTheme ? 'on' : ''}" data-theme-pick="${k}">
      <span class="swatch">${t.swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
      <span class="theme-txt"><b>${t.icon} ${t.name}</b><small>${t.desc}</small></span>
      <span class="theme-check">${k === currentTheme ? '✓' : ''}</span>
    </button>`).join('')}</div>`;
}
function fmtAgo(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}
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

// 아이디 가입: Supabase 안에서는 "아이디@travel-diary.example.com" 으로 저장 (실제로 메일이 가지 않는 예약 주소)
const ID_DOMAIN = 'travel-diary.example.com';
const ID_RE = /^[a-zA-Z0-9_]{3,20}$/;
const idToEmail = (id) => `${id.trim().toLowerCase()}@${ID_DOMAIN}`;
// 예전에 이메일로 가입한 계정도 로그인되도록, @가 있으면 이메일로 그대로 씀
const loginEmail = (input) => (input.includes('@') ? input.trim().toLowerCase() : idToEmail(input));
const userIdOf = (email) => (email?.endsWith(`@${ID_DOMAIN}`) ? email.split('@')[0] : null);

// Supabase 오류를 한국어로
function korean(err) {
  const m = String(err?.message || err || '');
  const table = [
    [/Invalid login credentials/i, '아이디 또는 비밀번호가 틀렸어요'],
    [/already registered|already been registered|already exists/i, '이미 사용 중인 아이디예요'],
    [/Password should be at least|password.*(short|length)/i, '비밀번호는 6자 이상이어야 해요'],
    [/should be different/i, '지금과 다른 비밀번호를 입력해 주세요'],
    [/Email not confirmed/i, '이메일 인증이 아직 안 됐어요. 메일함의 인증 링크를 눌러 주세요'],
    [/rate limit|too many|over_request/i, '시도가 너무 많아요. 잠시 후 다시 해 주세요'],
    [/invalid.*email|email.*invalid|validate email/i, '아이디는 영문·숫자·_ 3~20자로 해 주세요'],
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
      ? await q(sb.from('trip_members').select(`trip_id, user_id, ${state.v010 ? 'role, ' : ''}profiles(name, username)`).in('trip_id', ids))
      : [];
    await signPaths(trips.map((t) => t.cover_path));
    // 여행별 일정 수 (DB 설정 004 전이면 0)
    const planCount = new Map();
    if (ids.length) {
      try {
        const r = await sb.from('itinerary_items').select('trip_id').in('trip_id', ids);
        for (const x of r.error ? [] : r.data) planCount.set(x.trip_id, (planCount.get(x.trip_id) || 0) + 1);
      } catch { /* 일정 수 없이 */ }
    }
    const key = (t) => t.start_date || (t.created_at || '').slice(0, 10);
    return trips
      .map((t) => ({
        ...t,
        place_count: Number(t.place_count) || 0,
        plan_count: planCount.get(t.id) || 0,
        cover: t.cover_path ? urlOf(t.cover_path) : null,
        members: members.filter((m) => m.trip_id === t.id)
          .map((m) => ({ id: m.user_id, name: m.profiles?.name || '?', username: m.profiles?.username || '',
            role: m.user_id === t.owner_id ? 'OWNER' : (m.role || 'EDITOR') }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .map((t) => ({ ...t, myRole: t.members.find((m) => m.id === state.me.id)?.role || (t.owner_id === state.me.id ? 'OWNER' : 'EDITOR') }))
      .sort((a, b) => key(b).localeCompare(key(a)) || b.id - a.id);
  },
  async places(filter) {
    // 005(기록 시각·일정 연결) 전이면 새 칸 없이 예전처럼 읽음
    const run = (v5) => {
      let qb = sb.from('places')
        .select(`id, trip_id, user_id, name, lat, lng, visited_at, ${v5 ? 'visited_time, plan_item_id, ' : ''}${state.v009 ? 'title, mood, tags, ' : ''}comment, memo, category, created_at, author:profiles!places_user_id_fkey(name), trip:trips(title), photos(id, user_id, path, thumb_path${v5 ? ', taken_at' : ''}), place_comments(count)`)
        .order('id', { referencedTable: 'photos', ascending: true });
      if (filter !== 'all') qb = qb.eq('trip_id', filter);
      return qb;
    };
    let res;
    try { res = await run(state.v005); } catch (e) { throw new Error(korean(e)); }
    if (res.error && state.v005 && /visited_time|plan_item_id|taken_at|42703/.test(`${res.error.code} ${res.error.message}`)) {
      state.v005 = false;
      res = await run(false);
    }
    if (res.error) throw new Error(korean(res.error));
    const rows = res.data;
    await signPaths(rows.flatMap((r) => r.photos.flatMap((ph) => [ph.thumb_path, ph.path])));
    return rows.map((r) => ({
      ...r,
      author: r.author?.name || '(나간 멤버)',
      trip_title: r.trip?.title || '',
      comment_count: r.place_comments?.[0]?.count || 0,
      photos: r.photos.map((ph) => ({ ...ph, url: urlOf(ph.path), thumb: urlOf(ph.thumb_path) })),
    }));
  },
  async createTrip(f) {
    const fields = tripFields(f);
    // 연타·네트워크 재전송으로 같은 여행이 두 번 생기지 않게: 10초 안에 만든 같은 이름이 있으면 그걸 씀
    const since = new Date(Date.now() - 10e3).toISOString();
    const dup = await q(sb.from('trips').select('id').eq('owner_id', state.me.id).eq('title', fields.title)
      .gte('created_at', since).order('id', { ascending: false }).limit(1));
    if (dup.length) return dup[0].id;
    const row = await q(sb.from('trips').insert(fields).select('id').single());
    return row.id;
  },
  updateTrip: (id, f) => qChanged(sb.from('trips').update(tripFields(f)).eq('id', id).select('id')),
  listComments: (placeId) => q(sb.from('place_comments')
    .select('id, user_id, body, created_at, author:profiles(name, username)').eq('place_id', placeId).order('id')),
  addComment: (placeId, body) => q(sb.from('place_comments').insert({ place_id: placeId, body })),
  deleteComment: (id) => qChanged(sb.from('place_comments').delete().eq('id', id).select('id')),
  async deleteTrip(id) {
    const ph = await q(sb.from('photos').select('path, thumb_path, places!inner(trip_id)').eq('places.trip_id', id));
    await removeFiles(ph.flatMap((x) => [x.path, x.thumb_path]));
    // 스크랩북에서 새로 올린 사진 (DB 설정 004 전이면 테이블이 없어서 건너뜀)
    const sbFiles = await sb.from('scrapbook_elements').select('asset_path').eq('trip_id', id).not('asset_path', 'is', null);
    if (!sbFiles.error && sbFiles.data?.length) await removeFiles(sbFiles.data.map((x) => x.asset_path)).catch(() => {});
    await qChanged(sb.from('trips').delete().eq('id', id).select('id'));
  },
  async addMemberByUsername(tripId, username, role) {
    const args = { p_trip_id: tripId, p_username: username };
    if (state.v010 && role) args.p_role = role;
    const rows = await q(sb.rpc('add_member_by_username', args));
    return rows[0];
  },
  setMemberRole: (tripId, userId, role) => qChanged(sb.from('trip_members').update({ role }).eq('trip_id', tripId).eq('user_id', userId).select('user_id')),
  removeMember: (tripId, userId) =>qChanged(sb.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId).select('user_id')),
  /** 장소를 만들고 사진을 올림. 사진 일부가 실패해도 장소와 성공한 사진은 남기고 { id, sent, failed } 를 돌려줌 */
  async createPlace(tripId, f, items, onProgress) {
    const row = await q(sb.from('places').insert(v5({ trip_id: tripId, ...f })).select('id').single());
    const r = items.length ? await db.uploadPhotos(tripId, row.id, items, onProgress) : { sent: 0, failed: 0 };
    return { id: row.id, ...r };
  },
  /** 사진을 UPLOAD_PARALLEL장씩 동시에 올림. 실패한 장은 한 번 더 시도하고, 성공한 것만 고른 순서대로 저장 */
  async uploadPhotos(tripId, placeId, items, onProgress) {
    const opts = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
    const rows = new Array(items.length);
    let done = 0;
    let lastError = null;
    await runPool(items, UPLOAD_PARALLEL, async (it, i) => {
      for (let attempt = 0; attempt < 2 && !rows[i]; attempt++) {
        const base = `${tripId}/${crypto.randomUUID()}`;
        const path = `${base}.jpg`;
        const thumb = `${base}_t.jpg`;
        const res = await Promise.allSettled([
          q(sb.storage.from(BUCKET).upload(path, it.photo, opts)),
          q(sb.storage.from(BUCKET).upload(thumb, it.thumb, opts)),
        ]);
        if (res.every((x) => x.status === 'fulfilled')) {
          rows[i] = { place_id: placeId, path, thumb_path: thumb };
          if (state.v005 && it.taken != null) rows[i].taken_at = new Date(it.taken).toISOString(); // 사진 촬영 일시
        }
        else {
          lastError = res.find((x) => x.status === 'rejected').reason;
          const left = [path, thumb].filter((_, k) => res[k].status === 'fulfilled');
          if (left.length) await sb.storage.from(BUCKET).remove(left).catch(() => {});
        }
      }
      onProgress?.(++done, items.length);
    });
    const ok = rows.filter(Boolean);
    if (ok.length) {
      try { await q(sb.from('photos').insert(ok)); } catch (e) {
        await sb.storage.from(BUCKET).remove(ok.flatMap((r) => [r.path, r.thumb_path])).catch(() => {});
        throw e;
      }
    }
    if (!ok.length && lastError) throw lastError;
    return { sent: ok.length, failed: items.length - ok.length, error: lastError };
  },
  updatePlace: (id, f) => qChanged(sb.from('places').update(v5(f)).eq('id', id).select('id')),
  /** 여행 계획 일정 (기록에 연결된 계획 표시·타임라인). DB 설정 004 전이면 빈 목록 */
  async plans(filter) {
    let qb = sb.from('itinerary_items').select('*').order('day_date').order('sort_order').order('id');
    if (filter !== 'all') qb = qb.eq('trip_id', filter);
    try { const res = await qb; return res.error ? [] : res.data; } catch { return []; }
  },
  async deletePlace(p) {
    await removeFiles(p.photos.flatMap((ph) => [ph.path, ph.thumb_path]));
    await qChanged(sb.from('places').delete().eq('id', p.id).select('id'));
  },
  async deletePhoto(ph) {
    await removeFiles([ph.path, ph.thumb_path]);
    await qChanged(sb.from('photos').delete().eq('id', ph.id).select('id'));
  },
  async createInvite(tripId, reset, role) {
    const args = { p_trip_id: tripId, p_reset: !!reset };
    if (state.v010 && role) args.p_role = role;
    const rows = await q(sb.rpc('create_invite', args));
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

// DB 설정 005 전이면 새 칸(기록 시각·일정 연결)을 빼고 보냄
function v5(f) {
  let out = f;
  if (!state.v005) { const { visited_time, plan_item_id, ...rest } = out; out = rest; } // eslint-disable-line no-unused-vars
  if (!state.v009) { const { title, mood, tags, ...rest } = out; out = rest; } // eslint-disable-line no-unused-vars
  return out;
}

// ---------- 기록 제목·감정·태그 (DB 설정 009) ----------
const MOODS = {
  HAPPY: ['😊', '행복'], EXCITED: ['🥰', '설렘'], CALM: ['😌', '평온'], YUMMY: ['😋', '맛있음'],
  MOVED: ['🤩', '감동'], TIRED: ['😴', '피곤'], SAD: ['😢', '아쉬움'],
};
const parseTags = (v) => [...new Set(String(v || '').split(/[,，#\n]/).map((x) => x.trim().slice(0, 20)).filter(Boolean))].slice(0, 10);
/** 기록 쓰기·수정 창의 제목·감정·태그 칸 (009 전이면 비움) */
function journalFields(p = {}) {
  if (!state.v009) return '';
  return `<label class="field"><span>제목 (선택) <small>40자</small></span><input name="title" maxlength="40" value="${esc(p.title || '')}" placeholder="예: 성곽 위에서 본 노을"></label>
    <div class="field"><span>그때 기분</span><div class="cats moods">
      <label><input type="radio" name="mood" value="" ${p.mood ? '' : 'checked'}><span>없음</span></label>
      ${Object.entries(MOODS).map(([k, [e, l]]) => `<label><input type="radio" name="mood" value="${k}" ${p.mood === k ? 'checked' : ''}><span>${e} ${l}</span></label>`).join('')}</div></div>
    <label class="field"><span>태그 <small>쉼표로 구분 · 10개까지</small></span><input name="tags" maxlength="200" value="${esc((p.tags || []).join(', '))}" placeholder="예: 야경, 산책, 가족"></label>`;
}
function readJournal(f) {
  if (!state.v009) return {};
  const tags = parseTags(f.tags?.value);
  return { title: f.title?.value.trim() || null, mood: f.mood?.value || null, tags: tags.length ? tags : null };
}
const moodHtml = (m) => (MOODS[m] ? `<span class="mood-chip">${MOODS[m][0]} ${MOODS[m][1]}</span>` : '');
const tagsHtml = (tags) => (tags?.length ? `<span class="tag-list">${tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</span>` : '');
async function loadFavs() {
  if (!state.v009) { state.favs = new Set(); return; }
  try {
    const r = await sb.from('place_favorites').select('place_id');
    state.favs = new Set(r.error ? [] : r.data.map((x) => x.place_id));
  } catch { state.favs = new Set(); }
}
async function toggleFav(id) {
  const on = state.favs.has(id);
  const res = on ? await sb.from('place_favorites').delete().eq('place_id', id).eq('user_id', state.me.id)
    : await sb.from('place_favorites').insert({ place_id: id });
  if (res.error) throw new Error(korean(res.error));
  if (on) state.favs.delete(id); else state.favs.add(id);
  renderJournal();
  return !on;
}

// ---------- ✨ AI 일기 도우미: 적어 둔 사실만으로 이야기 초안 (확인 후 반영) ----------
const DIARY_TONES = { WARM: '다정하게', PLAIN: '담백하게', SHORT: '짧게' };
function diaryBox() {
  return state.v009 ? `<div class="diary-ai"><button type="button" class="btn-sub" data-diary>✨ AI로 이야기 정리하기</button><div class="diary-out"></div></div>` : '';
}
/** form: 기록 쓰기/수정 form, ctx(): { tripId, name, date, time, category, plan } */
function bindDiary(form, ctx) {
  const box = form.querySelector('.diary-ai');
  if (!box) return;
  const out = box.querySelector('.diary-out');
  let tone = 'WARM';
  const facts = () => {
    const c = ctx();
    const j = readJournal(form);
    return {
      place: (form.name?.value || c.name || '').trim(), date: c.date || null, time: c.time || null,
      category: CATS[c.category]?.[1] || null, comment: form.comment?.value.trim() || null, memo: form.memo?.value.trim() || null,
      mood: j.mood ? MOODS[j.mood][1] : null, tags: j.tags || [], title: j.title || null, plan: c.plan || null, photoCount: c.photoCount || 0,
    };
  };
  async function run() {
    const f = facts();
    if (!f.comment && !f.memo && !f.tags.length && !f.mood) {
      out.innerHTML = '<div class="hint">한줄 코멘트·이야기·기분·태그 중 하나라도 적어 주세요. 적은 내용만으로 일기를 정리해요 (없는 사실은 만들지 않아요).</div>';
      return;
    }
    if (!navigator.onLine) { out.innerHTML = '<div class="hint">인터넷 연결을 확인해 주세요</div>'; return; }
    out.innerHTML = '<div class="hint"><span class="spinner small"></span> AI가 이야기를 정리하는 중… (10~30초)</div>';
    const { data, error } = await sb.functions.invoke('ai-planner', { body: { action: 'diary', tripId: ctx().tripId, tone, facts: f } });
    if (!box.isConnected) return;
    if (error) {
      let payload = null;
      try { payload = await error.context?.json(); } catch { /* 본문 없음 */ }
      const msg = payload?.error?.message || (error.name === 'FunctionsFetchError' ? 'AI 서버에 연결하지 못했어요' : 'AI 요청에 실패했어요. 잠시 후 다시 시도해 주세요');
      out.innerHTML = `<div class="notice error">${esc(msg)}</div>`;
      return;
    }
    out.innerHTML = `<div class="diary-preview">
      <small class="muted">AI 초안 · 아직 반영 안 됨 · 적어 둔 내용만으로 썼어요</small>
      ${data.title ? `<b>${esc(data.title)}</b>` : ''}
      <p>${esc(data.story || '')}</p>
      ${data.warnings?.length ? `<small class="hint">⚠ ${data.warnings.map(esc).join(' · ')}</small>` : ''}
      <div class="seg mini-seg">${Object.entries(DIARY_TONES).map(([k, l]) => `<button type="button" data-tone="${k}" class="${k === tone ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="btn-row"><button type="button" class="btn" data-dapply>이야기에 넣기</button><button type="button" class="btn" data-dclose>닫기</button></div>
    </div>`;
    out.querySelector('[data-dapply]').onclick = () => {
      if (form.memo.value.trim() && !confirm('지금 적힌 이야기를 AI 초안으로 바꿀까요?')) return;
      form.memo.value = String(data.story || '').slice(0, 2000);
      if (form.title && !form.title.value.trim() && data.title) form.title.value = String(data.title).slice(0, 40);
      out.innerHTML = '<div class="hint">✓ 이야기에 넣었어요. 저장해야 기록에 남아요.</div>';
    };
    out.querySelector('[data-dclose]').onclick = () => { out.innerHTML = ''; };
    out.querySelectorAll('[data-tone]').forEach((b) => { b.onclick = () => { tone = b.dataset.tone; run(); }; });
  }
  box.querySelector('[data-diary]').onclick = run;
}

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
const minutesOf = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const timeOfMs = (ms) => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const normName = (x) => String(x || '').toLowerCase().replace(/[\s·,.()\-_'"]/g, '');
/**
 * 기록(장소·사진)과 가장 잘 맞는 계획 일정. 같은 날짜에서 위치(300m)·이름·시간(앞뒤 1시간)을 보고 점수가 2 이상인 것
 * 계획의 시간은 바꾸지 않고 "연결"만 해요
 */
function matchPlan(items, { date, time, name, pos }) {
  let best = null;
  for (const it of items) {
    if (it.day_date !== date) continue;
    let sc = 0;
    if (pos && it.lat != null && distM(pos, { lat: it.lat, lng: it.lng }) < 300) sc += 3;
    const a = normName(name);
    const names = [it.place_name, it.title].map(normName).filter((x) => x.length >= 2);
    if (a.length >= 2 && names.some((b) => a.includes(b) || b.includes(a))) sc += 2;
    if (time && it.start_time) {
      const m = minutesOf(time);
      const st = minutesOf(hhmm(it.start_time));
      const en = it.end_time ? minutesOf(hhmm(it.end_time)) : st + 60;
      if (m >= st - 60 && m <= en + 60) sc += 1;
    }
    if (sc >= 2 && (!best || sc > best.sc)) best = { it, sc };
  }
  return best?.it || null;
}
const planCache = new Map();
/** 여행의 계획 일정 (화면에 이미 불러온 것이 있으면 그대로) */
async function plansOfTrip(tripId) {
  const have = state.plans.filter((i) => i.trip_id === tripId);
  if (have.length || state.filter === 'all' || state.filter === tripId) return have;
  if (!planCache.has(tripId)) planCache.set(tripId, await db.plans(tripId));
  return planCache.get(tripId);
}
const planLabel = (it) => `${it.start_time ? `${hhmm(it.start_time)} ` : ''}${it.title}`;
/** 계획 연결 칸 (<select>) 내용 */
function planOptions(items, date, chosen) {
  const list = items.filter((i) => i.day_date === date);
  return `<option value="">연결 안 함</option>${list.map((i) => `<option value="${i.id}" ${i.id === chosen ? 'selected' : ''}>${esc(planLabel(i))}</option>`).join('')}`;
}

// ---------- 일정 상태 (DB 설정 008): 예정 / 방문 완료 / 취소 ----------
const PLAN_ST = { PLANNED: '예정', DONE: '방문 완료', CANCELLED: '취소' };
const PLAN_EMO = { PLACE: '📍', MEAL: '🍜', CAFE: '☕', MOVE: '🚌', STAY: '🏨', REST: '🛋️', ETC: '✨' };
const PLAN_TO_CAT = { PLACE: 'sight', MEAL: 'food', CAFE: 'cafe', STAY: 'stay' };
const planSt = (it) => (state.v008 && it?.status) || 'PLANNED';
const planStBadge = (it) => (state.v008
  ? `<span class="pst ${planSt(it).toLowerCase()}">${planSt(it) === 'DONE' ? '✓ ' : ''}${PLAN_ST[planSt(it)]}</span>` : '');
/** 이 일정에 연결된 실제 기록 */
const recordsOfPlan = (id) => state.places.filter((p) => p.plan_item_id === id);
async function setPlanStatus(id, status) {
  if (!state.v008) throw new Error('DB 설정(migrate-008)이 먼저 필요해요');
  const res = await sb.from('itinerary_items').update({ status }).eq('id', id).select('id');
  if (res.error) throw new Error(korean(res.error));
  if (!res.data?.length) throw new Error('권한이 없거나 이미 지워진 일정이에요');
}
/** 기록을 일정에 연결하면 그 일정은 '방문 완료' (실패해도 기록은 그대로) */
async function markPlanVisited(planId) {
  if (!planId || !state.v008) return;
  const it = state.plans.find((i) => i.id === planId);
  if (it && planSt(it) === 'DONE') return;
  try { await setPlanStatus(planId, 'DONE'); } catch { /* 표시만 못 함 */ }
}
/** 일정이 바뀐 뒤: 지도·기록장(state.plans)과 타임라인 탭(planner.js)을 함께 새로 */
async function afterPlanChange() {
  await window.refreshPlans();
  window.dispatchEvent(new CustomEvent('travel:plans'));
}
/** ✓ 방문 완료: 기록을 남기며 완료하거나, 기록 없이 완료만 */
/** 일정의 장소·날짜·시간을 채워서 기록 쓰기 열기 (저장하면 그 일정은 방문 완료) */
function recordFromPlan(it) {
  openAddPlace({
    tripId: it.trip_id, name: it.place_name || it.title, lat: it.lat, lng: it.lng, date: it.day_date,
    time: it.day_date === today() ? timeOfMs(Date.now()) : hhmm(it.start_time),
    planId: it.id, category: PLAN_TO_CAT[it.item_type],
  });
}
function openPlanDone(it) {
  const recs = recordsOfPlan(it.id);
  const body = openSheet(`<h2>✓ 방문 완료</h2>
    <p class="muted" style="margin-top:-4px">${fmtDate(it.day_date)} · ${esc(planLabel(it))}${it.place_name && it.place_name !== it.title ? ` · 📍 ${esc(it.place_name)}` : ''}</p>
    ${recs.length ? `<div class="notice">이미 연결된 기록이 있어요: ${recs.map((p) => esc(p.name)).join(', ')}</div>` : ''}
    <div class="choice-list">
      <button class="choice" data-done="record"><span class="ic">📷</span><span><b>기록 남기고 완료</b><small>장소·날짜·시간이 채워진 기록 화면이 열려요. 사진과 한마디를 더해 보세요</small></span></button>
      <button class="choice" data-done="only"><span class="ic">✓</span><span><b>기록 없이 완료만 표시</b><small>나중에 기록하면서 이 일정과 연결해도 돼요</small></span></button>
    </div>`);
  body.onclick = async (e) => {
    const k = e.target.closest('[data-done]')?.dataset.done;
    if (k === 'record') recordFromPlan(it);
    else if (k === 'only') {
      try {
        await setPlanStatus(it.id, 'DONE');
        closeSheet();
        await afterPlanChange();
        toast('방문 완료로 표시했어요');
      } catch (err) { toast(err.message); }
    }
  };
}
/** 지도에서 일정 핀을 눌렀을 때 */
function openPlanSheet(it) {
  const st = planSt(it);
  const recs = recordsOfPlan(it.id);
  const time = it.start_time ? ` ${hhmm(it.start_time)}${it.end_time ? `~${hhmm(it.end_time)}` : ''}` : '';
  const body = openSheet(`<span class="pd-cat">📋 여행 계획 · ${ic(PLAN_EMO[it.item_type] || '✨')}</span>
    <h2 class="pd-name">${esc(it.title)}</h2>
    <div class="pd-meta">
      <span>📅 ${fmtDate(it.day_date)}${time}</span>
      ${planStBadge(it)}
      ${it.place_name && it.place_name !== it.title ? `<span>📍 ${esc(it.place_name)}</span>` : ''}
    </div>
    ${it.notes ? `<div class="pd-memo">${esc(it.notes)}</div>` : ''}
    ${recs.length ? `<div class="field"><span>실제 기록</span>${recs.map((p) => `<button type="button" class="card" data-rec="${p.id}" style="margin-bottom:6px">
        <div class="body"><b>📷 ${esc(p.name)}</b><small>${fmtDate(visitKey(p))}${p.visited_time ? ` ${hhmm(p.visited_time)} 방문` : ''}</small></div></button>`).join('')}</div>` : ''}
    <div class="btn-row ${canEdit(it.trip_id) ? '' : 'hidden'}">
      ${state.v008 && st !== 'DONE' ? '<button class="btn" data-act="done">✓ 방문 완료</button>' : ''}
      <button class="btn" data-act="edit">✏️ 수정</button>
      ${state.v008 && st === 'PLANNED' ? '<button class="btn" data-act="cancel">취소</button>' : ''}
      ${state.v008 && st !== 'PLANNED' ? '<button class="btn" data-act="planned">↩ 예정으로</button>' : ''}
    </div>`);
  body.onclick = async (e) => {
    const rec = e.target.closest('[data-rec]');
    if (rec) return openPlace(Number(rec.dataset.rec));
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'done') openPlanDone(it);
    else if (act === 'edit') { closeSheet(); window.Planner?.openItem(it); }
    else if (act === 'cancel' || act === 'planned') {
      try {
        await setPlanStatus(it.id, act === 'cancel' ? 'CANCELLED' : 'PLANNED');
        closeSheet();
        await afterPlanChange();
        toast(act === 'cancel' ? '일정을 취소로 표시했어요' : '다시 예정으로 바꿨어요');
      } catch (err) { toast(err.message); }
    }
  };
}

// ---------- 멤버 역할 (DB 설정 010): 만든 사람 · 편집자 · 보기 전용 ----------
const ROLES = { OWNER: ['👑', '만든 사람'], EDITOR: ['✏️', '편집자'], VIEWER: ['👀', '보기 전용'] };
const tripById = (id) => state.trips.find((t) => t.id === id);
/** 이 여행을 고칠 수 있는지 (만든 사람·편집자). 010 전이면 모든 멤버 */
const canEdit = (tOrId) => { const t = typeof tOrId === 'object' ? tOrId : tripById(tOrId); return !!t && t.myRole !== 'VIEWER'; };
const editableTrips = () => state.trips.filter(canEdit);
const roBanner = (t) => (t && !canEdit(t)
  ? '<div class="notice ro-banner">👀 <b>보기 전용</b> 멤버예요. 둘러보고 한마디·즐겨찾기를 남길 수 있어요. 고치려면 여행을 만든 사람에게 편집 권한을 부탁해 주세요.</div>' : '');
/** 지금 고른 여행이 보기 전용이면 화면의 추가·수정 버튼을 숨겨요 (서버에서도 막혀 있어요) */
function applyRoleUi() {
  const t = state.filter !== 'all' ? tripById(state.filter) : null;
  document.body.classList.toggle('read-only', !!t && !canEdit(t));
  if (state.filter === 'all') document.body.classList.toggle('no-edit-trips', state.trips.length > 0 && !editableTrips().length);
  else document.body.classList.remove('no-edit-trips');
}

// 여행은 시작일~종료일, 모임·일상은 날짜 하나
const PARTY = { SOLO: '혼자', COUPLE: '커플', FRIENDS: '친구', FAMILY: '가족', GROUP: '단체' };
const PARTY_PEOPLE = { SOLO: 1, COUPLE: 2 };
const COUNTRIES = ['대한민국', '일본', '중국', '대만', '홍콩', '마카오', '베트남', '태국', '필리핀', '싱가포르', '말레이시아', '인도네시아',
  '라오스', '캄보디아', '몽골', '인도', '튀르키예', '아랍에미리트', '미국', '캐나다', '멕시코', '브라질', '호주', '뉴질랜드', '괌·사이판',
  '영국', '프랑스', '독일', '이탈리아', '스페인', '포르투갈', '스위스', '오스트리아', '체코', '헝가리', '네덜란드', '벨기에', '그리스',
  '크로아티아', '덴마크', '노르웨이', '스웨덴', '핀란드', '아이슬란드', '이집트', '모로코'];
const splitList = (v) => String(v || '').split(/[,，、\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
function tripFields(f) {
  const kind = KINDS[f.kind] ? f.kind : 'trip';
  const out = {
    title: String(f.title || '').trim(),
    kind,
    start_date: f.start_date || null,
    end_date: kind === 'trip' ? (f.end_date || null) : null,
  };
  // 여행 정보 확장 (DB 설정 007 이 있을 때만 보냄)
  if (state.v007 && 'country' in f) {
    out.country = String(f.country || '').trim().slice(0, 40) || null;
    const cities = splitList(f.cities).map((c) => c.slice(0, 40));
    out.cities = cities.length ? cities : null;
    out.party_type = PARTY[f.party_type] ? f.party_type : null;
    if ('cover_photo_id' in f) out.cover_photo_id = f.cover_photo_id ? Number(f.cover_photo_id) : null;
  }
  return out;
}

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

async function geocodeOSM(query) {
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
/**
 * 위치 → 장소 이름
 * 1) 아주 가까운(60m) 식당·카페, 또는 150m 안의 공원·관광지·역·유적 이름
 *    (화장품 가게·미용실 같은 작은 상점은 엉뚱하게 잡히기 쉬워서 쓰지 않음)
 * 2) 없으면 건물·장소 이름, 길 위면 길 이름 대신 "○○동 근처"
 * 3) 고속도로 위면 "이동 중 (○○고속도로)"
 */
const AREA_KEYS = ['neighbourhood', 'quarter', 'suburb', 'village', 'town', 'city_district', 'borough', 'city'];
const MOVING_ROADS = ['motorway', 'motorway_link', 'trunk', 'trunk_link'];
const FOOD = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream', 'biergarten'];
const LANDMARK_CATS = ['tourism', 'leisure', 'historic', 'railway', 'public_transport', 'aeroway', 'natural'];
function poiLimitM(p) {
  if (p.category === 'amenity' && FOOD.includes(p.type)) return 60;
  if (p.category === 'shop' && ['bakery', 'coffee', 'pastry', 'confectionery'].includes(p.type)) return 60;
  if (LANDMARK_CATS.includes(p.category)) return 150;
  if (p.category === 'amenity' && ['theatre', 'cinema', 'arts_centre'].includes(p.type)) return 60;
  if (p.category === 'amenity' && ['place_of_worship', 'university', 'college', 'library', 'museum', 'marketplace'].includes(p.type)) return 150;
  return 0; // 그 밖의 작은 상점·사무실은 쓰지 않음
}
async function reverseGeocode(lat, lng) {
  try {
    const poi = await nominatim(`reverse?zoom=18&layer=poi&lat=${lat}&lon=${lng}`);
    const name = String(poi?.name || '').split(';')[0].trim();
    if (!poi.error && name && distM({ lat, lng }, { lat: Number(poi.lat), lng: Number(poi.lon) }) <= poiLimitM(poi)) return name;
  } catch { /* 아래 주소 방식으로 */ }
  const x = await nominatim(`reverse?zoom=17&addressdetails=1&lat=${lat}&lon=${lng}`);
  if (x.error) return '';
  const a = x.address || {};
  const areaKey = AREA_KEYS.find((k) => a[k]);
  const area = areaKey ? a[areaKey] : '';
  const name = String(x.name || '').split(';')[0].trim();
  if (x.category === 'highway') {
    if (MOVING_ROADS.includes(x.type)) return `이동 중${name ? ` (${name})` : ''}`;
    // 이름 있는 광장·산책길(예: 서울역광장, 여의도공원 산책길)은 그대로, 차도 이름은 쓰지 않음
    if (name && ['pedestrian', 'footway', 'path'].includes(x.type)) return name;
    return area ? `${area} 근처` : name;
  }
  if (['place', 'boundary', 'landuse'].includes(x.category) || !name) return area ? `${area} 근처` : name;
  return name;
}

// ---------- 카카오 장소 검색 (한국) ----------
// config.js 에 kakaoKey 가 있으면 한국 안에서는 카카오 장소 데이터를 먼저 써요. 문제가 생기면 위의 OpenStreetMap 방식으로.
const KAKAO_CATS = { FD6: 'food', CE7: 'cafe', AT4: 'sight', CT1: 'sight', AD5: 'stay', SW8: 'sight' };
let kakaoPromise = null;
function kakaoReady() {
  if (!CFG.kakaoKey) return Promise.resolve(null);
  kakaoPromise ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(CFG.kakaoKey)}&libraries=services&autoload=false`;
    s.onload = () => {
      try { window.kakao.maps.load(() => resolve(window.kakao)); } catch { resolve(null); }
    };
    s.onerror = () => {
      console.warn('카카오 지도 SDK를 불러오지 못했어요. (JavaScript 키, 사이트 도메인 등록, 카카오맵 사용 설정 확인)');
      resolve(null);
    };
    document.head.appendChild(s);
    setTimeout(() => resolve(null), 8000);
  });
  return kakaoPromise;
}
// 대략 한국 범위 (규슈 북부 같은 바로 옆 일본 지역은 빼기)
const isKorea = (lat, lng) => lat >= 33 && lat <= 38.7 && lng >= 124.5 && lng <= 131 && !(lng > 129.6 && lat < 35);
const kakaoToPlace = (d) => ({
  name: d.place_name,
  address: d.road_address_name || d.address_name,
  lat: Number(d.y),
  lng: Number(d.x),
  distance: d.distance ? Number(d.distance) : null,
  category: KAKAO_CATS[d.category_group_code] || null,
});

/** 위치 근처 식당·카페·명소·문화시설·숙소·지하철역 (가까운 순, 최대 6곳). 카카오를 못 쓰면 null */
async function kakaoNearby(lat, lng, radius = 150) {
  if (!isKorea(lat, lng)) return null;
  const k = await kakaoReady();
  if (!k) return null;
  const places = new k.maps.services.Places();
  const location = new k.maps.LatLng(lat, lng);
  const one = (code) => new Promise((res) => {
    places.categorySearch(code, (data, status) => res(status === k.maps.services.Status.OK ? data : []),
      { location, radius, sort: k.maps.services.SortBy.DISTANCE, size: 5 });
  });
  const all = (await Promise.all(Object.keys(KAKAO_CATS).map(one))).flat().map(kakaoToPlace);
  const seen = new Set();
  return all
    .filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)))
    .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9))
    .slice(0, 6);
}

/** 장소 이름 검색 (카카오 키워드 검색). 카카오를 못 쓰면 [] */
async function kakaoKeyword(query) {
  const k = await kakaoReady();
  if (!k) return [];
  const places = new k.maps.services.Places();
  return new Promise((res) => {
    places.keywordSearch(query, (data, status) => res(status === k.maps.services.Status.OK ? data.slice(0, 6).map(kakaoToPlace) : []), { size: 6 });
  });
}

/** 장소 이름 검색: 한국 장소는 카카오 먼저, 해외는 OpenStreetMap 먼저 */
async function geocode(query) {
  const [kk, osm] = await Promise.all([
    kakaoKeyword(query).catch(() => []),
    geocodeOSM(query).catch((e) => e),
  ]);
  const osmList = Array.isArray(osm) ? osm : [];
  if (!kk.length && !Array.isArray(osm)) throw osm;
  const overseasFirst = osmList.length && !isKorea(osmList[0].lat, osmList[0].lng);
  const merged = overseasFirst ? [...osmList, ...kk] : [...kk, ...osmList];
  const out = [];
  for (const p of merged) {
    if (!out.some((o) => o.name === p.name && distM(o, p) < 300)) out.push(p);
  }
  return out.slice(0, 8);
}

/**
 * 위치 → { name, candidates, pick }
 * 한국: 카카오에서 근처 후보를 찾고, 아주 가까운 곳(식당·카페 80m, 그 밖 150m)이 있으면 그 이름
 * 없거나 해외면 OpenStreetMap 방식 이름("○○동 근처", "이동 중" 등)
 */
async function placeNameAt(lat, lng) {
  let candidates = [];
  try { candidates = (await kakaoNearby(lat, lng)) || []; } catch { /* OSM으로 */ }
  const pick = candidates.find((c) => c.distance != null && c.distance <= (['food', 'cafe'].includes(c.category) ? 80 : 150));
  if (pick) return { name: pick.name, candidates, pick };
  const name = await reverseGeocode(lat, lng).catch(() => '');
  return { name, candidates, pick: null };
}
// 근처 후보 버튼들. data-cand="{prefix}{번호}"
function candChips(cands, prefix = '', chosen = '') {
  if (!cands?.length) return '';
  return `<div class="cands"><span class="cands-label">근처</span>${cands.map((c, j) => `<button type="button" class="cand ${c.name === chosen ? 'on' : ''}" data-cand="${prefix}${j}">${esc(c.name)}${c.distance != null ? `<small>${c.distance}m</small>` : ''}</button>`).join('')}</div>`;
}

// ---------- 상태 ----------
const state = { me: null, trips: [], places: [], plans: [], filter: 'all', view: 'map', v005: true, mapShow: 'all', mapDay: '', favs: new Set(), jq: { text: '', fav: false, mood: '', tag: '', plans: false } };
let map;
let markerLayer;

// ---------- 바텀 시트 ----------
let sheetHideTimer;
function openSheet(html, onClose) {
  const sheet = $('#sheet');
  sheet._onClose?.();
  clearTimeout(sheetHideTimer);
  const body = $('.sheet-body', sheet);
  body.onclick = null; // 이전 시트의 처리기가 남지 않도록
  body.onchange = null;
  body.oninput = null;
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
const MAX_PHOTOS = 100;     // 장소 하나에 올릴 수 있는 사진 수
const PROCESS_PARALLEL = 3; // 동시에 줄이는 사진 수 (폰 메모리 고려)
const UPLOAD_PARALLEL = 4;  // 동시에 올리는 사진 수

/** items를 최대 limit개씩 동시에 처리 */
async function runPool(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
/** 사진 여러 장을 동시에 줄임. 열 수 없는 사진은 빼고 고른 순서대로 돌려줌 */
async function processPhotos(files, onProgress, quiet = false) {
  const out = new Array(files.length);
  let done = 0;
  let lastError = null;
  await runPool(files, PROCESS_PARALLEL, async (f, i) => {
    try { out[i] = await processPhoto(f); } catch (err) { lastError = err; }
    onProgress?.(++done, files.length, out[i]);
  });
  const items = out.filter(Boolean);
  if (lastError && !quiet) toast(items.length ? `열 수 없는 사진 ${files.length - items.length}장은 뺐어요` : lastError.message);
  return items;
}
const uploadResultMsg = (r, okMsg) => (r.failed
  ? `사진 ${r.failed}장은 못 올렸어요 (${r.error?.message || '연결 확인'}). 장소를 눌러 다시 추가해 주세요`
  : okMsg);

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
function drawScaled(src, max) {
  const s = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * s);
  c.height = Math.round(src.height * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
const toJpeg = (c, quality) => new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('변환 실패'))), 'image/jpeg', quality));
/** 원본 사진 → { photo, thumb, gps, date, before, after }. 캔버스로 다시 그려서 EXIF(위치 포함)는 업로드 파일에서 빠짐 */
async function processPhoto(file) {
  let meta = null;
  try { meta = await window.exifr?.parse(file, { gps: true }); } catch { /* EXIF 없음 */ }
  let img;
  try { img = await loadImage(file); } catch { throw new Error('이 사진 형식은 열 수 없어요 (JPG/PNG로 시도해 주세요)'); }
  const big = drawScaled(img, PHOTO_MAX);
  img.close?.();
  const small = drawScaled(big, THUMB_MAX);
  const [photo, thumb] = await Promise.all([toJpeg(big, 0.82), toJpeg(small, 0.75)]);
  big.width = big.height = small.width = small.height = 0; // 폰 메모리 바로 반환
  const gps = meta && Number.isFinite(meta.latitude) && Number.isFinite(meta.longitude)
    && !(meta.latitude === 0 && meta.longitude === 0)
    ? { lat: meta.latitude, lng: meta.longitude } : null;
  const dt = meta?.DateTimeOriginal || meta?.CreateDate;
  const valid = dt instanceof Date && !Number.isNaN(dt.getTime());
  return {
    photo, thumb, gps,
    date: valid ? toYMD(dt) : null,
    taken: valid ? dt.getTime() : null, // 찍은 시각 (한꺼번에 기록할 때 순서·묶기에 씀)
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
  for (const el of form.querySelectorAll('.signup-only')) el.classList.toggle('hidden', authMode !== 'signup');
  $('#forgotHint').classList.toggle('hidden', authMode === 'signup');
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
    const userid = f.userid.value.trim();
    let session;
    if (authMode === 'signup') {
      if (!ID_RE.test(userid)) throw new Error('아이디는 영문·숫자·_ 3~20자로 해 주세요');
      const name = f.name.value.trim();
      if (!name) throw new Error('이름을 입력해 주세요');
      const data = await q(sb.auth.signUp({ email: idToEmail(userid), password: f.password.value, options: { data: { name } } }));
      session = data.session;
      // Supabase가 이미 있는 아이디에 대해 오류 대신 빈 계정을 돌려주는 경우
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('이미 사용 중인 아이디예요');
      }
      if (!session) throw new Error('가입은 됐지만 로그인이 안 됐어요. Supabase의 "Confirm email" 설정이 꺼져 있는지 확인해 주세요');
    } else {
      if (!userid) throw new Error('아이디를 입력해 주세요');
      session = (await q(sb.auth.signInWithPassword({ email: loginEmail(userid), password: f.password.value }))).session;
    }
    f.reset();
    await enterApp(session.user);
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
    el.innerHTML = `<b>${esc(inv.inviter)}</b>님이 <b>‘${esc(inv.title)}’</b> 여행에 ${inv.role === 'VIEWER' ? '<b>보기 전용</b>으로 ' : ''}초대했어요.<br>
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
  state.me = { id: user.id, email: user.email, userid: userIdOf(user.email), name };
  // DB 설정 007(여행 국가·도시·유형·대표 사진)이 있는지
  try { const r = await sb.from('trips').select('country').limit(1); state.v007 = !r.error; } catch { state.v007 = false; }
  // DB 설정 008(일정 상태·동행자)이 있는지
  try { const r = await sb.from('itinerary_items').select('status').limit(1); state.v008 = !r.error; } catch { state.v008 = false; }
  // DB 설정 009(기록 제목·감정·태그·즐겨찾기·위치 선택, 여러 스크랩북)가 있는지
  try { const r = await sb.from('scrapbooks').select('id').limit(1); state.v009 = !r.error; } catch { state.v009 = false; }
  // DB 설정 010(멤버 역할: 만든 사람·편집자·보기 전용)이 있는지
  try { const r = await sb.from('trip_members').select('role').limit(1); state.v010 = !r.error; } catch { state.v010 = false; }
  // 계정에 저장된 테마가 있으면 이 기기에도 적용 (다른 기기에서 바꾼 테마 따라가기)
  const savedTheme = user.user_metadata?.theme;
  if (savedTheme && usableTheme(savedTheme) && savedTheme !== currentTheme) applyTheme(savedTheme);
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
  // 한 여행을 고른 상태에서 지도를 누르면 "이 위치를 일정에 추가"
  map.on('click', (e) => {
    if (state.filter === 'all' || !window.Planner || !canEdit(state.filter)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip-btn';
    btn.textContent = '＋ 이 위치를 일정에 추가';
    btn.onclick = () => {
      map.closePopup();
      window.Planner.addAt(state.filter, { lat: e.latlng.lat, lng: e.latlng.lng, day: state.mapDay });
    };
    L.popup({ closeButton: false, className: 'add-plan-pop', offset: [0, -4] }).setLatLng(e.latlng).setContent(btn).openOn(map);
  });
}

async function refresh(fit = false) {
  try {
    state.trips = await db.trips();
    if (state.filter !== 'all' && !state.trips.some((t) => t.id === state.filter)) state.filter = 'all';
    state.places = await db.places(state.filter);
    state.plans = await db.plans(state.filter);
    await loadFavs();
  } catch (err) { toast(err.message); return; }
  applyRoleUi();
  renderFilter();
  renderMap(fit);
  renderJournal();
  renderTrips();
  // 일정·스크랩북 화면(planner.js, scrapbook.js)이 선택한 여행에 맞춰 다시 그리도록 알림
  window.dispatchEvent(new CustomEvent('travel:refresh'));
}

/** "기록 3 · 일정 12" — 일정이 없으면 "기록 3" */
const countLabel = (places, plans) => (plans ? `기록 ${places} · 일정 ${plans}` : `기록 ${places}`);
function renderFilter() {
  const sel = $('#tripFilter');
  const total = state.trips.reduce((n, t) => n + t.place_count, 0);
  const totalPlans = state.trips.reduce((n, t) => n + (t.plan_count || 0), 0);
  sel.innerHTML = `<option value="all">🌏 모든 여행 (${countLabel(total, totalPlans)})</option>`
    + state.trips.map((t) => `<option value="${t.id}">${kindEmoji(t.kind)} ${esc(t.title)} (${countLabel(t.place_count, t.plan_count)})</option>`).join('');
  sel.value = String(state.filter);
}
$('#tripFilter').onchange = (e) => {
  state.filter = e.target.value === 'all' ? 'all' : Number(e.target.value);
  refresh(true);
};

function renderMap(fit) {
  markerLayer.clearLayers();
  $('#view-map .map-empty')?.remove();
  $('#view-map .map-bar')?.remove();
  const single = state.filter !== 'all';
  // 한 여행을 고르면 계획 일정도 지도에: 예정(점선 테두리) · 취소(회색) · 실제 기록(완료)
  const planPts = single ? state.plans.filter((i) => i.trip_id === state.filter && i.lat != null) : [];
  const days = single ? [...new Set([...planPts.map((i) => i.day_date), ...state.places.map(visitKey)])].sort() : [];
  if (state.mapDay && !days.includes(state.mapDay)) state.mapDay = '';
  const show = planPts.length ? state.mapShow : 'all';
  const onDay = (d) => !state.mapDay || d === state.mapDay;
  const all = state.places.filter((p) => p.lat != null).sort(byVisit); // 위치 없는 기록은 기록장에만
  const ordered = show === 'plan' ? [] : all.filter((p) => onDay(visitKey(p)));
  ordered.forEach((p) => {
    const th = p.photos[0]?.thumb;
    const html = `<div class="pin">${th ? `<img src="${esc(th)}" alt="">` : catIcon(p.category)}</div>`
      + (single ? `<div class="pin-num">${all.indexOf(p) + 1}</div>` : '');
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({ html, className: 'pin-wrap', iconSize: [44, 44], iconAnchor: [22, 51] }),
      title: p.name,
    }).on('click', () => openPlace(p.id)).addTo(markerLayer);
  });
  if (single && ordered.length > 1) drawRoute(ordered.map((p) => [p.lat, p.lng]), markerLayer);
  // 계획 일정 핀: 기록이 연결된 완료 일정은 기록 핀으로 보여요
  const plans = planPts.filter((i) => onDay(i.day_date) && (
    show === 'plan' ? planSt(i) === 'PLANNED'
      : show === 'done' ? planSt(i) === 'DONE' && !recordsOfPlan(i.id).length
        : !recordsOfPlan(i.id).length));
  if (show !== 'done') {
    // 일자별 계획 경로 (점선) — 취소한 일정은 빼고 순서대로
    for (const d of days.filter(onDay)) {
      const pts = planPts.filter((i) => i.day_date === d && planSt(i) !== 'CANCELLED');
      if (pts.length > 1) {
        L.polyline(pts.map((i) => [i.lat, i.lng]), { color: '#8f84c9', weight: 3, opacity: 0.75, dashArray: '6 8', interactive: false }).addTo(markerLayer);
      }
    }
  }
  plans.forEach((it) => {
    const st = planSt(it).toLowerCase();
    const no = state.plans.filter((x) => x.day_date === it.day_date && x.trip_id === it.trip_id).indexOf(it) + 1;
    L.marker([it.lat, it.lng], {
      icon: L.divIcon({ html: `<div class="pin plan-pin ${st}">${ic(PLAN_EMO[it.item_type] || '✨')}</div><div class="pin-num plan">${days.indexOf(it.day_date) + 1}-${no}</div>`,
        className: 'pin-wrap plan-wrap', iconSize: [34, 34], iconAnchor: [17, 41] }),
      title: `${PLAN_ST[planSt(it)]}: ${it.title}`,
      zIndexOffset: -100,
    }).on('click', () => openPlanSheet(it)).addTo(markerLayer);
  });
  // 위쪽 거르기: 전체·예정·완료 + 날짜
  if (single && days.length) {
    $('#view-map').insertAdjacentHTML('beforeend', `<div class="map-bar">
      ${planPts.length ? `<div class="seg mini-seg" role="group" aria-label="지도에 보일 것">
        ${[['all', '전체'], ['plan', '📋 예정'], ['done', '✓ 완료']].map(([k, l]) => `<button type="button" class="${show === k ? 'on' : ''}" data-mshow="${k}" aria-pressed="${show === k}">${l}</button>`).join('')}
      </div>` : ''}
      <select data-mday aria-label="날짜"><option value="">모든 날짜</option>
        ${days.map((d, i) => `<option value="${d}" ${d === state.mapDay ? 'selected' : ''}>${i + 1}일차 · ${fmtDate(d).replace(/^\d+년 /, '')}</option>`).join('')}</select>
    </div>`);
    const bar = $('#view-map .map-bar');
    bar.onclick = (e) => {
      const b = e.target.closest('[data-mshow]');
      if (b) { state.mapShow = b.dataset.mshow; renderMap(true); }
    };
    bar.onchange = (e) => { if (e.target.matches('[data-mday]')) { state.mapDay = e.target.value; renderMap(true); } };
  }
  const pts = [...ordered.map((p) => [p.lat, p.lng]), ...plans.map((i) => [i.lat, i.lng])];
  if (!state.places.length && !planPts.length) {
    const msg = state.trips.length
      ? '아직 기록이 없어요. 오른쪽 아래 <b>＋</b> 버튼으로 첫 장소를 남겨보세요!'
      : '반가워요! 먼저 위쪽 <b>🧳</b> 버튼에서 여행을 만들고, 함께한 친구를 초대해 보세요.';
    $('#view-map').insertAdjacentHTML('beforeend', `<div class="map-empty">${msg}</div>`);
  } else if (fit && pts.length) {
    map.fitBounds(pts, { padding: [60, 60], maxZoom: 14, animate: false }); // 다른 탭에 있을 때(지도가 숨겨진 동안) 애니메이션 오류 방지
  }
}

function placeCard(p) {
  const th = p.photos[0]?.thumb;
  const plan = p.plan_item_id ? state.plans.find((i) => i.id === p.plan_item_id) : null;
  return `<button class="card" data-place="${p.id}">
    ${th ? `<img class="thumb" src="${esc(th)}" alt="" loading="lazy">` : `<div class="thumb">${catIcon(p.category)}</div>`}
    <div class="body">
      ${p.visited_time ? `<span class="tl-time">🕒 ${hhmm(p.visited_time)}</span>` : ''}
      <b>${state.favs.has(p.id) ? '<span class="fav-on" aria-label="즐겨찾기">★</span> ' : ''}${esc(p.title || p.name)}${MOODS[p.mood] ? ` ${MOODS[p.mood][0]}` : ''}</b>
      ${p.title ? `<span class="muted card-sub">📍 ${esc(p.name)}${p.lat == null ? ' · 위치 없음' : ''}</span>` : p.lat == null ? '<span class="muted card-sub">위치 없음</span>' : ''}
      ${plan ? `<span class="tl-linked">📋 계획: ${esc(planLabel(plan))}</span>` : ''}
      ${p.comment ? `<span class="comment">${esc(p.comment)}</span>` : ''}
      ${tagsHtml(p.tags)}
      <small>${catLabel(p.category)} · ${esc(p.author)}${state.filter === 'all' ? ` · ${esc(p.trip_title)}` : ''}${p.photos.length > 1 ? ` · 사진 ${p.photos.length}` : ''}${p.comment_count ? ` · 💬 ${p.comment_count}` : ''}${p.memo ? ' · 📝' : ''}</small>
    </div>
  </button>`;
}
/**
 * 기록장 탭 = 실제로 다녀온 기록(장소·사진·이야기). 여행 계획(일정)은 타임라인 탭에 있어요
 * - 기록이 계획 일정에 연결되어 있으면 "📋 계획: 10:00 ○○"로 함께 보여 줘요
 * - 날짜는 최근 날짜가 위, 하루 안에서는 실제 기록(사진 촬영) 시각 순서
 */
function renderJournal() {
  const el = $('#journal');
  if (!el) return;
  const t = state.filter !== 'all' ? state.trips.find((x) => x.id === state.filter) : null;
  const head = `<div class="section-head"><h2>📒 기록장</h2><small class="muted">${t ? esc(t.title) : '모든 여행'} · ${state.places.length}곳</small></div>${roBanner(t)}`;
  if (!state.places.length) {
    // 빈 상태: 실제 기록이 없으면 일정이 있어도 기록장은 비어 있어요 (일정은 타임라인에)
    const n = pendingPlans().length;
    el.innerHTML = `${head}<div class="empty"><div class="big">${ic('🗺️')}</div><b>아직 남긴 기록이 없어요</b><br>
      <small>다녀온 곳의 사진과 한마디를 남기면 여기에 여행 일기처럼 모여요</small>
      ${!t || canEdit(t) ? '<br><button type="button" class="primary small-cta" data-act="add-record">＋ 기록 추가</button>' : ''}
      ${n ? `<br><button type="button" class="link" data-goto="timeline" style="margin-top:8px">📋 예정 일정 ${n}개는 타임라인에 있어요</button>` : ''}</div>`;
    return;
  }
  // 검색 칸은 그대로 두고 목록만 다시 그려요 (입력 중 커서 유지)
  if (!$('#jrList', el)) {
    el.innerHTML = `${head}<div class="jr-bar">
        <input type="search" id="jrSearch" placeholder="제목·장소·이야기·태그 검색" aria-label="기록 검색" enterkeyhint="search">
        <div class="jr-chips" id="jrChips"></div>
      </div><div id="jrList"></div>`;
    $('#jrSearch', el).value = state.jq.text;
  } else {
    $('.ro-banner', el)?.remove();
    $('.section-head', el).outerHTML = head;
  }
  renderJournalChips();
  renderJournalList();
}
/** 한 여행을 골랐을 때, 아직 기록이 없는 예정 일정 (취소·완료·기록 연결된 일정은 빼요) */
function pendingPlans() {
  if (state.filter === 'all') return [];
  return state.plans.filter((i) => i.trip_id === state.filter && planSt(i) === 'PLANNED' && !recordsOfPlan(i.id).length);
}
/** 기록장 카드: 사진 중심 피드 (대표 사진 · 방문일 · 장소 · 짧은 이야기 · 태그 · 즐겨찾기) */
function feedCard(p) {
  const th = p.photos[0]?.thumb;
  const plan = p.plan_item_id ? state.plans.find((i) => i.id === p.plan_item_id) : null;
  const when = `${shortDate(visitKey(p))}${p.visited_time ? ` ${hhmm(p.visited_time)}` : ''}`;
  return `<button class="card feed-card" data-place="${p.id}">
    ${th ? `<div class="feed-photo"><img src="${esc(th)}" alt="" loading="lazy">${p.photos.length > 1 ? `<span class="feed-n">📷 ${p.photos.length}</span>` : ''}
      ${state.favs.has(p.id) ? '<span class="feed-fav" aria-label="즐겨찾기">★</span>' : ''}</div>` : ''}
    <div class="feed-body">
      <div class="feed-meta">🕒 ${when} · 📍 ${esc(p.name)}${p.lat == null ? ' (위치 없음)' : ''}${!th && state.favs.has(p.id) ? ' · <span class="fav-on">★</span>' : ''}</div>
      <b class="feed-title">${esc(p.title || p.name)}${MOODS[p.mood] ? ` ${MOODS[p.mood][0]}` : ''}</b>
      ${p.comment ? `<span class="comment">${esc(p.comment)}</span>` : ''}
      ${p.memo ? `<span class="feed-memo">${esc(p.memo)}</span>` : ''}
      ${tagsHtml(p.tags)}
      <small class="muted">${plan ? `📋 계획: ${esc(planLabel(plan))} · ` : ''}${esc(p.author)}${state.filter === 'all' ? ` · ${esc(p.trip_title)}` : ''}${p.comment_count ? ` · 💬 ${p.comment_count}` : ''}</small>
    </div>
  </button>`;
}
const shortDate = (ymd) => { const d = new Date(`${ymd}T00:00:00`); return `${d.getMonth() + 1}/${d.getDate()} (${'일월화수목금토'[d.getDay()]})`; };
function planCard(it) {
  const time = it.start_time ? `${hhmm(it.start_time)}${it.end_time ? `~${hhmm(it.end_time)}` : ''}` : '시간 미정';
  return `<div class="card plan-card" data-plan="${it.id}" role="button" tabindex="0" aria-label="예정 일정 ${esc(it.title)}">
    <div class="thumb">${ic(PLAN_EMO[it.item_type] || '✨')}</div>
    <div class="body">
      <span class="tl-time plan">📋 예정 · ${time}</span>
      <b>${esc(it.title)}</b>
      ${it.place_name && it.place_name !== it.title ? `<small>📍 ${esc(it.place_name)}</small>` : ''}
    </div>
    ${canEdit(it.trip_id) ? '<button type="button" class="plan-go" data-plan-done aria-label="방문 기록 남기기">✓ 기록</button>' : ''}
  </div>`;
}
function renderJournalChips() {
  const box = $('#jrChips');
  if (!box) return;
  const q = state.jq;
  const count = new Map();
  for (const p of state.places) for (const tg of p.tags || []) count.set(tg, (count.get(tg) || 0) + 1);
  const tags = [...count].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tg]) => tg);
  if (q.tag && !tags.includes(q.tag)) tags.unshift(q.tag);
  const moods = Object.keys(MOODS).filter((m) => state.places.some((p) => p.mood === m));
  const plansChip = pendingPlans().length
    ? `<button type="button" class="jr-chip plan ${q.plans ? 'on' : ''}" data-jf="plans" aria-pressed="${q.plans}">📋 예정 일정 ${pendingPlans().length}</button>` : '';
  box.innerHTML = !state.v009 ? plansChip : `${plansChip}
    <button type="button" class="jr-chip ${q.fav ? 'on' : ''}" data-jf="fav" aria-pressed="${q.fav}">★ 즐겨찾기</button>
    ${moods.map((m) => `<button type="button" class="jr-chip ${q.mood === m ? 'on' : ''}" data-jmood="${m}" aria-pressed="${q.mood === m}">${MOODS[m][0]} ${MOODS[m][1]}</button>`).join('')}
    ${tags.map((tg) => `<button type="button" class="jr-chip ${q.tag === tg ? 'on' : ''}" data-jtag="${esc(tg)}" aria-pressed="${q.tag === tg}">#${esc(tg)}</button>`).join('')}`;
}
function renderJournalList() {
  const box = $('#jrList');
  if (!box) return;
  const q = state.jq;
  const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (p) => [p.title, p.name, p.comment, p.memo, p.author, p.trip_title, ...(p.tags || []), MOODS[p.mood]?.[1]].filter(Boolean).join(' ').toLowerCase();
  const list = state.places.filter((p) => (!q.fav || state.favs.has(p.id)) && (!q.mood || p.mood === q.mood)
    && (!q.tag || p.tags?.includes(q.tag)) && words.every((w) => hay(p).includes(w)));
  const filtered = words.length || q.fav || q.mood || q.tag;
  // 남은 일정: 즐겨찾기·기분·태그로 거를 때는 빼고, 검색어는 일정 이름·장소에도 적용
  const plans = q.plans && !q.fav && !q.mood && !q.tag
    ? pendingPlans().filter((i) => words.every((w) => [i.title, i.place_name, i.notes].filter(Boolean).join(' ').toLowerCase().includes(w))) : [];
  // 예정 일정은 기록과 섞지 않고 맨 위 따로 (필터를 켰을 때만)
  const planBox = plans.length ? `<section class="jr-plans"><h3>📋 아직 기록 전인 예정 일정 <small>${plans.length}</small></h3>
      ${plans.map(planCard).join('')}<small class="hint">✓ 기록을 누르면 장소·날짜가 채워진 기록 화면이 열려요</small></section>` : '';
  if (!list.length) {
    box.innerHTML = planBox + `<div class="empty small">찾는 기록이 없어요${filtered ? '<br><button type="button" class="chip-btn" data-jclear style="margin-top:10px">조건 지우기</button>' : ''}</div>`;
    return;
  }
  const entries = list.map((p) => ({ date: visitKey(p), time: hhmm(p.visited_time), id: p.id, p }));
  entries.sort((a, b) => b.date.localeCompare(a.date)
    || (a.time ? 0 : 1) - (b.time ? 0 : 1) || a.time.localeCompare(b.time) || a.id - b.id);
  let html = planBox + (filtered ? `<div class="jr-count muted">${list.length}개 찾음 <button type="button" class="link" data-jclear>조건 지우기</button></div>` : '');
  let last = null;
  for (const x of entries) {
    if (x.date !== last) { html += `<h3 class="tl-date">${fmtDate(x.date)}</h3>`; last = x.date; }
    html += feedCard(x.p);
  }
  box.innerHTML = html;
}
$('#journal').addEventListener('input', (e) => {
  if (e.target.id !== 'jrSearch') return;
  state.jq.text = e.target.value;
  renderJournalList();
});
$('#journal').onclick = (e) => {
  const q = state.jq;
  const go = e.target.closest('[data-goto]');
  if (go) { switchView(go.dataset.goto); return; }
  if (e.target.closest('[data-act=add-record]')) { $('#fab').click(); return; }
  if (e.target.closest('[data-jclear]')) {
    Object.assign(q, { text: '', fav: false, mood: '', tag: '' });
    const inp = $('#jrSearch');
    if (inp) inp.value = '';
    renderJournalChips(); renderJournalList();
    return;
  }
  const pc = e.target.closest('[data-plan]');
  if (pc) {
    const it = state.plans.find((i) => i.id === Number(pc.dataset.plan));
    if (it) { if (e.target.closest('[data-plan-done]')) openPlanDone(it); else openPlanSheet(it); }
    return;
  }
  const chip = e.target.closest('[data-jf], [data-jmood], [data-jtag]');
  if (chip) {
    if (chip.dataset.jf === 'fav') q.fav = !q.fav;
    if (chip.dataset.jf === 'plans') q.plans = !q.plans;
    if (chip.dataset.jmood) q.mood = q.mood === chip.dataset.jmood ? '' : chip.dataset.jmood;
    if (chip.dataset.jtag != null) q.tag = q.tag === chip.dataset.jtag ? '' : chip.dataset.jtag;
    renderJournalChips(); renderJournalList();
    return;
  }
  const c = e.target.closest('[data-place]');
  if (c) openPlace(Number(c.dataset.place));
};
/** 다른 화면(타임라인 일정)에서 일정을 바꾼 뒤 기록에 붙은 계획 표시만 다시 */
window.refreshPlans = async () => {
  planCache.clear();
  state.plans = await db.plans(state.filter);
  for (const t of state.trips) {
    if (state.filter === 'all' || state.filter === t.id) t.plan_count = state.plans.filter((i) => i.trip_id === t.id).length;
  }
  renderFilter();
  renderTrips();
  renderJournal();
  renderMap(false);
};

// ---------- 여행 상태 (날짜로 자동: 계획 중 / 여행 중 / 여행 완료) ----------
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
function tripStatus(t) {
  if (!t?.start_date) return null;
  const s = t.start_date;
  const e = t.end_date || t.start_date;
  const d = today();
  if (d < s) return { key: 'plan', label: `계획 중 · D-${dayDiff(s, d)}` };
  if (d > e) return { key: 'done', label: t.kind === 'trip' ? '여행 완료' : '지난 기록' };
  if (s === e) return { key: 'now', label: '오늘' };
  return { key: 'now', label: `여행 중 · ${dayDiff(d, s) + 1}일차` };
}
const statusBadge = (t) => { const st = tripStatus(t); return st ? `<span class="trip-status ${st.key}">${st.label}</span>` : ''; };

// ---------- 내 여행 목록 (모든 탭 공통, 위쪽 🧳 버튼) ----------
// ---------- 여행 선택 (모든 탭 공통) ----------
/** 여행을 안 고른 채 타임라인·스크랩북에 들어오면 고를 여행: 여행 중 → 가장 가까운 계획 중 → 가장 최근 */
function defaultTripId() {
  const ts = state.trips;
  const now = ts.find((t) => tripStatus(t)?.key === 'now');
  if (now) return now.id;
  const next = ts.filter((t) => tripStatus(t)?.key === 'plan').sort((x, y) => x.start_date.localeCompare(y.start_date))[0];
  return (next || ts[0])?.id ?? 'all';
}
/** 여행이 하나도 없을 때만 쓰는 대비 화면 (여행이 있으면 자동으로 골라서 바로 내용이 보여요) */
function tripPickerHtml() {
  return `<div class="empty"><div class="big">${ic('📒')}</div>여행을 골라 주세요<br><small>위쪽 선택 칸에서 고를 수 있어요</small></div>`;
}

function tripsListHtml() {
  const places = state.trips.reduce((n, t) => n + t.place_count, 0);
  const friends = new Set(state.trips.flatMap((t) => t.members.map((m) => m.id)).filter((id) => id !== state.me.id));
  const cards = state.trips.map((t) => `<div class="card trip-card ${state.filter === t.id ? 'on' : ''}" data-kind="${esc(t.kind || 'trip')}">
      <button type="button" class="trip-pick" data-trip="${t.id}" aria-label="${esc(t.title)} 고르기">
        ${t.cover ? `<img class="thumb" src="${esc(t.cover)}" alt="" loading="lazy">` : `<div class="thumb">${kindIcon(t.kind)}</div>`}
        <span class="body">
          <b>${esc(t.title)}</b>
          <small>${statusBadge(t)} ${kindIcon(t.kind)} ${kindName(t.kind)} · 📅 ${fmtRange(t.start_date, t.end_date)} · 📍 기록 ${t.place_count}곳${t.plan_count ? ` · 📋 일정 ${t.plan_count}개` : ''}</small>
          ${t.country || t.cities?.length || t.party_type ? `<small>🌏 ${esc([t.cities?.join(', '), t.country].filter(Boolean).join(' · '))}${t.party_type ? ` · ${PARTY[t.party_type] || ''}` : ''}</small>` : ''}
          <small>👥 ${t.members.map((m) => esc(m.name)).join(', ')}</small>
        </span>
      </button>
      <button type="button" class="icon-btn" data-manage="${t.id}" aria-label="${esc(t.title)} 멤버·수정">⋯</button>
    </div>`).join('');
  return `<div class="section-head"><h2>내 여행</h2><button class="chip-btn" data-act="new-trip">＋ 새 여행</button></div>
    <div class="stats"><div><b>${state.trips.length}</b><small>여행</small></div>
      <div><b>${places}</b><small>장소</small></div><div><b>${friends.size}</b><small>함께한 친구</small></div></div>
    ${state.trips.length ? `<button type="button" class="card trip-all ${state.filter === 'all' ? 'on' : ''}" data-trip="all">🌏 모든 여행 함께 보기</button>${cards}`
      : `<div class="empty"><div class="big">${ic('📒')}</div>첫 여행을 만들어 보세요<br><small>여행, 모임·기념일, 일상 중에 골라요</small></div>`}`;
}
function openTripsSheet() {
  const body = openSheet(`<div id="tripsSheet">${tripsListHtml()}</div>`);
  body.onclick = (e) => {
    if (e.target.closest('[data-act=new-trip]')) return openTripForm();
    const m = e.target.closest('[data-manage]');
    if (m) return openTrip(Number(m.dataset.manage));
    const c = e.target.closest('[data-trip]');
    if (!c) return;
    state.filter = c.dataset.trip === 'all' ? 'all' : Number(c.dataset.trip);
    closeSheet();
    refresh(true);
  };
}
// 목록 창이 열려 있으면 새 정보로 다시
function renderTrips() {
  const box = $('#tripsSheet');
  if (box?.isConnected) box.innerHTML = tripsListHtml();
}
$('#tripsBtn').onclick = openTripsSheet;

// 플로팅 + 버튼: 탭마다 하는 일과 이름이 달라요
const FAB_LABEL = { map: '기록 추가', journal: '기록 추가', timeline: '일정 추가' };
function updateFab() {
  const label = state.view === 'scrap' ? (window.Scrapbook?.fabLabel?.() || '페이지 추가') : FAB_LABEL[state.view];
  const fab = $('#fab');
  fab.setAttribute('aria-label', label);
  const l = $('.fab-label', fab);
  if (l) l.textContent = label;
}
function switchView(view) {
  state.view = view;
  let pick = false;
  if (['timeline', 'scrap'].includes(view) && state.filter === 'all' && state.trips.length) {
    state.filter = defaultTripId();
    pick = state.filter !== 'all';
    if (pick) { renderFilter(); applyRoleUi(); }
  }
  for (const v of document.querySelectorAll('main > .view')) v.classList.toggle('hidden', v.id !== `view-${view}`);
  for (const b of document.querySelectorAll('.tabbar button')) b.classList.toggle('on', b.dataset.view === view);
  updateFab();
  if (view === 'map') setTimeout(() => map.invalidateSize(), 0);
  window.dispatchEvent(new CustomEvent('travel:view', { detail: view }));
  if (pick) refresh(); // 고른 여행으로 지도·기록장 자료도 맞춤
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
    <p class="muted">${state.me.userid
      ? `아이디: <b>${esc(state.me.userid)}</b><br>친구가 여행에 초대할 때 이 아이디를 알려주세요.`
      : esc(state.me.email)}</p>
    <div class="divider"></div>
    ${VISIBLE_THEMES.length > 1 ? `<h3 style="margin:0 0 10px">화면 테마</h3>
    <div id="themeBox">${themePicker()}</div>
    <small class="hint">고르면 바로 바뀌어요. 내 계정에 저장돼서 다른 기기에서도 같은 테마로 보여요.</small>
    <div class="divider"></div>` : ''}
    <h3 style="margin:0 0 12px">비밀번호 변경</h3>
    <form id="pwForm">
      <input name="username" autocomplete="username" value="${esc(state.me.userid || state.me.email)}" hidden>
      ${passwordFields(true)}
      <button class="primary" type="submit">비밀번호 바꾸기</button>
      <small class="hint">바꾸면 지금 쓰는 기기를 뺀 다른 기기에서는 로그아웃돼요.</small>
    </form>
    <div class="divider"></div>
    <h3 style="margin:0 0 6px">📦 백업 내보내기</h3>
    <small class="hint">내가 속한 여행의 기록·일정·예산·준비물·스크랩북을 파일로 받아요. 휴대폰보다 컴퓨터에서 받는 걸 추천해요.</small>
    <div class="choice-list" style="margin-top:8px">
      <button class="choice" data-backup="json"><span class="ic">🗂️</span><span><b>모든 여행 자료 (JSON)</b><small>글·일정·스크랩북 배치 정보. 사진은 파일 이름만</small></span></button>
      <button class="choice" data-backup="zip"><span class="ic">🖼️</span><span><b>여행 하나 + 사진 원본 (ZIP)</b><small>고른 여행의 자료와 사진 원본을 한 파일로</small></span></button>
    </div>
    <div id="backupMsg" class="hint"></div>
    <div class="divider"></div>
    <div class="btn-row">
      <button class="btn" id="logoutBtn">로그아웃</button>
      <button class="btn danger" id="leaveBtn">회원 탈퇴</button>
    </div>`);
  if ($('#themeBox', body)) $('#themeBox', body).onclick = async (e) => {
    const b = e.target.closest('[data-theme-pick]');
    if (!b || b.dataset.themePick === currentTheme) return;
    applyTheme(b.dataset.themePick);
    $('#themeBox', body).innerHTML = themePicker();
    toast(`${THEMES[currentTheme].icon} ${THEMES[currentTheme].name} 테마로 바꿨어요`);
    // 계정에 저장 (실패해도 이 기기에는 적용돼 있음)
    try { await q(sb.auth.updateUser({ data: { theme: currentTheme } })); } catch { /* 다음에 다시 */ }
  };
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
  body.querySelectorAll('[data-backup]').forEach((b) => { b.onclick = () => runBackup(b.dataset.backup, body); });
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
  const tripOwner = trip?.owner_id === state.me.id;
  const editor = canEdit(trip);
  const canEditP = editor && (p.user_id === state.me.id || tripOwner);
  const body = openSheet(`
    ${p.photos.length ? `<div class="gallery">${p.photos.map((ph) => `<div class="g-item">
        <img src="${esc(ph.url)}" alt="" loading="lazy" data-full="${esc(ph.url)}">
        ${canEditP || (editor && ph.user_id === state.me.id) ? `<button class="g-del" data-photo="${ph.id}" aria-label="사진 삭제">✕</button>` : ''}
      </div>`).join('')}</div>` : ''}
    <div class="pd-top"><span class="pd-cat">${catLabel(p.category)}</span>
      ${state.v009 ? `<button type="button" class="fav-btn ${state.favs.has(p.id) ? 'on' : ''}" data-act="fav" aria-pressed="${state.favs.has(p.id)}" aria-label="즐겨찾기">${state.favs.has(p.id) ? '★' : '☆'}</button>` : ''}</div>
    <h2 class="pd-name">${esc(p.title || p.name)}${MOODS[p.mood] ? ` <span class="pd-mood" title="${MOODS[p.mood][1]}">${MOODS[p.mood][0]}</span>` : ''}</h2>
    ${p.title ? `<div class="muted pd-place">📍 ${esc(p.name)}</div>` : ''}
    ${p.comment ? `<p class="pd-comment">${esc(p.comment)}</p>` : ''}
    ${p.tags?.length || p.mood ? `<div class="pd-tags">${moodHtml(p.mood)}${tagsHtml(p.tags)}</div>` : ''}
    ${p.memo ? `<div class="pd-memo">${esc(p.memo)}</div>` : ''}
    <div class="pd-meta">
      <span>📅 ${fmtDate(visitKey(p))}${p.visited_time ? ` ${hhmm(p.visited_time)}` : ''}</span>
      ${p.plan_item_id && state.plans.find((i) => i.id === p.plan_item_id) ? `<span>📋 계획: ${esc(planLabel(state.plans.find((i) => i.id === p.plan_item_id)))} ${planStBadge(state.plans.find((i) => i.id === p.plan_item_id))}</span>` : ''}
      <span>✍️ ${esc(p.author)}</span>
      <span>${kindIcon(trip?.kind)} ${esc(p.trip_title)}</span>
    </div>
    <div class="btn-row">
      ${p.lat != null ? `<button class="btn" data-act="locate">${ic('🗺️')} 지도에서 보기</button>` : '<span class="muted small-note">📍 위치 없는 기록 (수정에서 위치를 정할 수 있어요)</span>'}
      ${editor ? `<label class="btn">📷 사진 추가<input type="file" accept="image/*" multiple hidden></label>
      <button class="btn" data-act="to-plan">＋ 일정에 추가</button>` : ''}
      ${canEditP ? '<button class="btn" data-act="edit">✏️ 수정</button><button class="btn danger" data-act="delete">삭제</button>' : ''}
    </div>
    <div class="divider"></div>
    <h3 class="cm-title">💬 함께한 친구들의 한마디 <small id="cmCount"></small></h3>
    <div id="comments" class="comments"><div class="hint">불러오는 중…</div></div>
    <form id="cmForm" class="cm-form" autocomplete="off">
      <input name="body" maxlength="300" placeholder="이날의 한마디를 남겨 보세요" enterkeyhint="send" required>
      <button type="submit">등록</button>
    </form>`);

  async function loadComments() {
    const box = $('#comments', body);
    if (!box) return;
    try {
      const list = await db.listComments(p.id);
      if (!box.isConnected) return;
      $('#cmCount', body).textContent = list.length ? String(list.length) : '';
      box.innerHTML = list.length
        ? list.map((c) => `<div class="cm">
            <div class="avatar">${initial(c.author?.name)}</div>
            <div class="cm-body">
              <div class="cm-head"><b>${esc(c.author?.name || '(나간 멤버)')}</b><small>${fmtAgo(c.created_at)}</small>
                ${c.user_id === state.me.id || tripOwner ? `<button class="cm-del" data-cdel="${c.id}" aria-label="한마디 지우기">지우기</button>` : ''}</div>
              <div class="cm-text">${esc(c.body)}</div>
            </div></div>`).join('')
        : '<div class="hint">아직 한마디가 없어요. 첫 한마디를 남겨 보세요!</div>';
    } catch (err) { box.innerHTML = `<div class="hint">${esc(err.message)}</div>`; }
  }
  loadComments();

  $('#cmForm', body).onsubmit = async (e) => {
    e.preventDefault();
    const input = e.target.body;
    const text = input.value.trim();
    if (!text) return;
    const btn = $('button[type=submit]', e.target);
    btn.disabled = true;
    try {
      await db.addComment(p.id, text);
      input.value = '';
      p.comment_count = (p.comment_count || 0) + 1;
      await loadComments();
      renderJournal();
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  };

  body.onclick = async (e) => {
    const cdel = e.target.closest('[data-cdel]');
    if (cdel) {
      if (!confirm('이 한마디를 지울까요?')) return;
      try {
        await db.deleteComment(Number(cdel.dataset.cdel));
        p.comment_count = Math.max(0, (p.comment_count || 1) - 1);
        await loadComments();
        renderJournal();
      } catch (err) { toast(err.message); }
      return;
    }
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
    } else if (act === 'fav') {
      try {
        const on = await toggleFav(p.id);
        const b = e.target.closest('[data-act=fav]');
        b.classList.toggle('on', on); b.textContent = on ? '★' : '☆'; b.setAttribute('aria-pressed', String(on));
        toast(on ? '즐겨찾기에 넣었어요' : '즐겨찾기에서 뺐어요');
      } catch (err) { toast(err.message); }
    } else if (act === 'to-plan') {
      if (p.lat == null) window.Planner?.addAt(p.trip_id, { name: p.name, placeId: p.id, noLoc: true });
      else window.Planner?.addAt(p.trip_id, { lat: p.lat, lng: p.lng, name: p.name, placeId: p.id });
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
  if ($('input[type=file]', body)) $('input[type=file]', body).onchange = async (e) => {
    let files = [...e.target.files];
    e.target.value = '';
    const room = MAX_PHOTOS - p.photos.length;
    if (files.length > room) toast(`한 장소에는 사진을 ${MAX_PHOTOS}장까지 올릴 수 있어요`);
    files = files.slice(0, Math.max(0, room));
    if (!files.length) return;
    let items = [];
    try {
      items = await processPhotos(files, (n, total) => toast(`사진 줄이는 중… ${n}/${total}`));
      if (!items.length) return;
      const r = await db.uploadPhotos(p.trip_id, p.id, items, (n, total) => toast(`사진 올리는 중… ${n}/${total}`));
      toast(uploadResultMsg(r, `사진 ${r.sent}장을 추가했어요`));
      await refresh();
      openPlace(id);
    } catch (err) { toast(err.message); } finally { items.forEach((it) => URL.revokeObjectURL(it.preview)); }
  };
}

function catPicker(selected) {
  return `<div class="cats">${Object.entries(CATS).map(([k, [, label]]) => `<label>
    <input type="radio" name="category" value="${k}" ${k === selected ? 'checked' : ''}><span>${catIcon(k)} ${label}</span></label>`).join('')}</div>`;
}

function openEditPlace(p) {
  const body = openSheet(`<h2>기록 수정</h2>
    <form id="editForm">
      ${journalFields(p)}
      <label class="field"><span>장소 이름</span><input name="name" required maxlength="60" value="${esc(p.name)}"></label>
      ${state.v009 ? `<div class="field"><span>위치</span><div id="epLoc"></div><div id="epLocResults" class="results"></div></div>` : ''}
      <label class="field"><span>한줄 코멘트</span><input name="comment" maxlength="80" value="${esc(p.comment || '')}"></label>
      <label class="field"><span>이야기 (선택)</span><textarea name="memo" maxlength="2000" rows="4" placeholder="그날 있었던 일, 나눴던 이야기">${esc(p.memo || '')}</textarea></label>
      ${diaryBox()}
      <div class="grid2">
        <label class="field"><span>날짜</span><input type="date" name="visited_at" value="${esc(p.visited_at || '')}"></label>
        <label class="field ${state.v005 ? '' : 'hidden'}"><span>시간</span><input type="time" name="visited_time" value="${hhmm(p.visited_time)}"></label>
      </div>
      <div class="field ${state.v005 ? '' : 'hidden'}" id="epPlanField"><span>여행 계획과 연결</span><select name="plan_item_id"></select>
        <small class="hint">연결해도 계획의 시간은 바뀌지 않아요. 타임라인에서는 실제 기록 시간 순서로 보여요.</small></div>
      <div class="field"><span>종류</span>${catPicker(p.category)}</div>
      <button class="primary" type="submit">저장</button>
    </form>`);
  const ef = $('#editForm', body);
  let tripPlans = [];
  const fillPlans = () => {
    ef.plan_item_id.innerHTML = planOptions(tripPlans, ef.visited_at.value, Number(ef.plan_item_id.value) || p.plan_item_id);
    $('#epPlanField', body).classList.toggle('hidden', !state.v005 || ef.plan_item_id.options.length < 2);
  };
  plansOfTrip(p.trip_id).then((list) => { tripPlans = list; if (body.isConnected) fillPlans(); });
  ef.visited_at.onchange = fillPlans;
  // 위치: 그대로 / 장소 이름으로 찾기 / 지우기 (009)
  let loc = p.lat != null ? { lat: p.lat, lng: p.lng } : null;
  const showLoc = () => {
    const box = $('#epLoc', body);
    if (!box) return;
    box.innerHTML = `<div class="place-now">${loc ? `📍 <b>${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</b>` : '<b>위치 없음</b> <small>지도에는 보이지 않아요</small>'}
      <button type="button" class="link" data-loc="find">장소 이름으로 찾기</button>
      ${loc ? '<button type="button" class="link" data-loc="clear">위치 지우기</button>' : ''}</div>`;
  };
  showLoc();
  const locBox = $('#epLoc', body);
  if (locBox) {
    locBox.onclick = async (e) => {
      const k = e.target.closest('[data-loc]')?.dataset.loc;
      const res = $('#epLocResults', body);
      if (k === 'clear') { loc = null; res.innerHTML = ''; showLoc(); return; }
      if (k !== 'find') return;
      res.innerHTML = '<div class="hint">찾는 중…</div>';
      try {
        const list = await geocode(ef.name.value.trim());
        res.innerHTML = list.length ? list.map((r, i) => `<button type="button" data-li="${i}"><b>${esc(r.name)}</b><small>${esc(r.address || '')}</small></button>`).join('')
          : '<div class="hint">찾지 못했어요. 장소 이름을 바꿔 보세요.</div>';
        res.onclick = (ev) => {
          const b = ev.target.closest('[data-li]');
          if (!b) return;
          const r = list[Number(b.dataset.li)];
          loc = { lat: r.lat, lng: r.lng };
          res.innerHTML = '';
          showLoc();
        };
      } catch (err) { res.innerHTML = `<div class="hint">${esc(err.message)}</div>`; }
    };
  }
  bindDiary(ef, () => ({ tripId: p.trip_id, name: p.name, date: ef.visited_at.value, time: ef.visited_time.value, category: ef.category.value,
    plan: tripPlans.find((i) => i.id === Number(ef.plan_item_id.value))?.title, photoCount: p.photos.length }));
  ef.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await db.updatePlace(p.id, {
        name: f.name.value.trim(), comment: f.comment.value.trim() || null,
        memo: f.memo.value.trim() || null,
        visited_at: f.visited_at.value || null, category: f.category.value,
        visited_time: f.visited_time.value || null,
        plan_item_id: f.plan_item_id.value ? Number(f.plan_item_id.value) : null,
        ...readJournal(f),
        ...(state.v009 ? { lat: loc?.lat ?? null, lng: loc?.lng ?? null } : {}),
      });
      if (f.plan_item_id.value && Number(f.plan_item_id.value) !== p.plan_item_id) await markPlanVisited(Number(f.plan_item_id.value));
      await refresh();
      openPlace(p.id);
      toast('수정했어요');
    } catch (err) { toast(err.message); }
  };
}

// ---------- 📦 백업 내보내기 ----------
// 서버(Supabase)에 남아 있는 내 여행 자료를 파일로 받아 두는 기능. 무료 플랜은 자동 백업을 내려받을 수 없어서 직접 받아 둬요.
async function tripBackupData(tripIds) {
  const pick = async (table, cols = '*', col = 'trip_id') => {
    const r = await sb.from(table).select(cols).in(col, tripIds);
    return r.error ? [] : r.data; // DB 설정 전 테이블은 건너뜀
  };
  const [trips, members, places, plans, items, expenses, checklist, books, pages, els] = await Promise.all([
    pick('trips', '*', 'id'), pick('trip_members', '*, profiles(name, username)'), pick('places', '*, photos(*), place_comments(*)'),
    pick('trip_plans'), pick('itinerary_items'), pick('trip_expenses'), pick('checklist_items'),
    pick('scrapbooks'), pick('scrapbook_pages'), pick('scrapbook_elements'),
  ]);
  return {
    app: '모아로그', version: 1, exported_at: new Date().toISOString(), exported_by: state.me.userid || state.me.email,
    note: '사진 파일은 photos[].path (ZIP 백업이면 photos/ 폴더). 다시 불러오기 기능은 아직 없어요 — 보관용이에요.',
    trips: trips.map((t) => ({
      ...t,
      members: members.filter((m) => m.trip_id === t.id),
      places: places.filter((p) => p.trip_id === t.id),
      plan: plans.find((x) => x.trip_id === t.id) || null,
      itinerary: items.filter((x) => x.trip_id === t.id),
      expenses: expenses.filter((x) => x.trip_id === t.id),
      checklist: checklist.filter((x) => x.trip_id === t.id),
      scrapbooks: books.filter((x) => x.trip_id === t.id),
      scrapbook_pages: pages.filter((x) => x.trip_id === t.id).map((pg) => ({ ...pg, elements: els.filter((e) => e.page_id === pg.id) })),
    })),
  };
}
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
// 압축하지 않는 ZIP (사진은 이미 JPEG 라 압축 효과가 거의 없어요)
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) { // files: [{ name, data: Uint8Array }]
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true); local.setUint32(22, f.data.length, true); local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const size = central.reduce((n, x) => n + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
const stamp = () => today().replace(/-/g, '');
const safeName = (x) => String(x || '여행').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40);
async function runBackup(kind, sheet) {
  const msg = $('#backupMsg', sheet);
  const say = (t) => { if (msg) msg.textContent = t; };
  if (!state.trips.length) return toast('내보낼 여행이 없어요');
  if (kind === 'json') {
    try {
      say('자료를 모으는 중…');
      const data = await tripBackupData(state.trips.map((t) => t.id));
      saveBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `모아로그-백업-${stamp()}.json`);
      say(`✓ 여행 ${data.trips.length}개를 파일로 받았어요`);
    } catch (err) { say(''); toast(err.message); }
    return;
  }
  // ZIP: 여행 하나 고르기
  const t = state.filter !== 'all' ? tripById(state.filter) : null;
  const id = t ? t.id : Number(prompt(`사진까지 받을 여행 번호를 골라 주세요\n${state.trips.map((x, i) => `${i + 1}. ${x.title}`).join('\n')}`, '1') || 0);
  const trip = t || state.trips[id - 1];
  if (!trip) return;
  try {
    say('자료를 모으는 중…');
    const data = await tripBackupData([trip.id]);
    const photos = data.trips[0]?.places.flatMap((p) => p.photos || []) || [];
    const assets = (data.trips[0]?.scrapbook_pages || []).flatMap((pg) => pg.elements.map((e) => e.asset_path)).filter(Boolean);
    const paths = [...new Set([...photos.map((ph) => ph.path), ...assets])];
    await signPaths(paths);
    const files = [{ name: 'backup.json', data: new TextEncoder().encode(JSON.stringify(data, null, 1)) }];
    let done = 0;
    let failed = 0;
    await runPool(paths, 3, async (path) => {
      try {
        const r = await fetch(urlOf(path));
        if (!r.ok) throw new Error(String(r.status));
        files.push({ name: `photos/${path}`, data: new Uint8Array(await r.arrayBuffer()) });
      } catch { failed++; }
      say(`사진 받는 중… ${++done}/${paths.length}`);
    });
    saveBlob(makeZip(files), `모아로그-${safeName(trip.title)}-${stamp()}.zip`);
    say(`✓ ‘${trip.title}’ 자료와 사진 ${paths.length - failed}장을 받았어요${failed ? ` (사진 ${failed}장은 실패)` : ''}`);
  } catch (err) { say(''); toast(err.message); }
}

// ---------- 장소 기록하기 ----------
$('#fab').onclick = () => {
  if (state.view === 'timeline' && state.filter !== 'all') { window.Planner?.addManual(state.filter); return; }
  if (state.view === 'scrap' && window.Scrapbook) { window.Scrapbook.fab(); return; }
  if (!state.trips.length) {
    toast('먼저 여행을 만들어 주세요');
    openTripForm();
    return;
  }
  if (!editableTrips().length || (state.filter !== 'all' && !canEdit(state.filter))) {
    toast('보기 전용 여행이라 기록을 남길 수 없어요');
    return;
  }
  const body = openSheet(`<h2>무엇을 기록할까요?</h2>
    <div class="choice-list">
      <button class="choice" data-pick="one"><span class="ic">📍</span><span><b>장소 하나 기록</b><small>장소를 검색하거나 지도에서 골라 하나씩 남겨요</small></span></button>
      <button class="choice" data-pick="bulk"><span class="ic">📷</span><span><b>사진으로 한꺼번에 기록</b><small>그날 사진을 한 번에 고르면 찍은 위치별로 장소를 나눠 줘요</small></span></button>
    </div>`);
  body.onclick = (e) => {
    const pick = e.target.closest('[data-pick]')?.dataset.pick;
    if (pick === 'one') openAddPlace();
    if (pick === 'bulk') openBulkImport();
  };
};

// 두 지점 사이 거리 (m)
function distM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtTime = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/**
 * 사진들을 찍은 위치·시간으로 장소별로 묶어요.
 * - 시간 순서대로 보면서, 지금 장소에서 120m 안이고 2시간 안에 찍었으면 같은 장소
 * - 위치가 없는 사진은 찍은 시간이 가장 가까운 장소(1시간 이내)에 붙이고, 그래도 없으면 따로 모아둬요
 */
const SAME_PLACE_M = 120;
const SAME_PLACE_GAP_MS = 2 * 3600e3;
function clusterPhotos(items) {
  const withGps = items.filter((it) => it.gps).sort((a, b) => (a.taken ?? Infinity) - (b.taken ?? Infinity));
  const clusters = [];
  for (const it of withGps) {
    const cur = clusters[clusters.length - 1];
    const gapOk = !cur || it.taken == null || cur.end == null || it.taken - cur.end <= SAME_PLACE_GAP_MS;
    if (cur && gapOk && distM(cur.center, it.gps) <= SAME_PLACE_M) {
      cur.items.push(it);
      const n = cur.items.length;
      cur.center = { lat: cur.center.lat + (it.gps.lat - cur.center.lat) / n, lng: cur.center.lng + (it.gps.lng - cur.center.lng) / n };
      if (it.taken != null) { cur.start ??= it.taken; cur.end = it.taken; }
    } else {
      clusters.push({ items: [it], center: { ...it.gps }, start: it.taken, end: it.taken });
    }
  }
  const leftovers = [];
  for (const it of items.filter((x) => !x.gps)) {
    let best = null;
    if (it.taken != null) {
      for (const c of clusters) {
        if (c.start == null) continue;
        const gap = it.taken < c.start ? c.start - it.taken : it.taken > c.end ? it.taken - c.end : 0;
        if (gap <= 3600e3 && (!best || gap < best.gap)) best = { c, gap };
      }
    }
    if (best) { best.c.items.push(it); it.attachedByTime = true; } else leftovers.push(it);
  }
  for (const c of clusters) c.items.sort((a, b) => (a.taken ?? Infinity) - (b.taken ?? Infinity));
  return { clusters, leftovers };
}

// ---------- 사진으로 한꺼번에 기록 ----------
const BULK_MAX = 60;
function openBulkImport() {
  const defTrip = state.filter !== 'all' ? state.filter : state.trips[0].id;
  let items = [];
  let clusters = [];
  let leftovers = [];
  let bmap = null;
  let busy = false;
  let bulkPlans = []; // 고른 여행의 여행 계획 일정 (장소마다 연결 추천)
  const clusterDate = (c) => { const f = c.items.find((it) => it.taken != null); return f ? toYMD(new Date(f.taken)) : today(); };
  const suggestFor = (c) => matchPlan(bulkPlans, { date: clusterDate(c), time: c.time, name: c.name, pos: c.center })?.id || null;
  const listeners = new AbortController(); // 시트를 닫으면 아래 입력 감지도 같이 해제

  const body = openSheet(`<h2>사진으로 한꺼번에 기록</h2>
    <p class="muted" style="margin-top:-6px">그날 찍은 사진을 한 번에 고르면, 찍은 위치별로 장소를 나눠서 기록해 줘요.</p>
    <label class="field"><span>여행</span><select name="trip" id="bulkTrip">${state.trips.map((t) => `<option value="${t.id}" ${t.id === defTrip ? 'selected' : ''}>${kindEmoji(t.kind)} ${esc(t.title)}</option>`).join('')}</select></label>
    <label class="primary pick-btn">📷 사진 고르기 (최대 ${BULK_MAX}장)<input type="file" accept="image/*" multiple hidden id="bulkInput"></label>
    <small class="hint">아이폰은 사진 고르는 화면 위쪽 <b>옵션</b>에서 <b>위치</b>를 켜야 위치 정보가 함께 와요.</small>
    <div id="bulkStatus" class="bulk-status hidden"></div>
    <div id="bulkReview"></div>`, () => {
    listeners.abort();
    bmap?.remove();
    items.forEach((it) => URL.revokeObjectURL(it.preview));
  });

  const status = (html) => {
    const el = $('#bulkStatus', body);
    el.innerHTML = html;
    el.classList.toggle('hidden', !html);
  };

  $('#bulkInput', body).onchange = async (e) => {
    if (busy) return;
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    if (files.length > BULK_MAX) toast(`한 번에 ${BULK_MAX}장까지만 정리할게요`);
    busy = true;
    items.forEach((it) => URL.revokeObjectURL(it.preview));
    items = [];
    bmap?.remove();
    bmap = null;
    $('#bulkReview', body).innerHTML = '';
    const list = files.slice(0, BULK_MAX);
    status(`사진 정리 중… 0/${list.length}`);
    items = await processPhotos(list, (n, total) => { if (body.isConnected) status(`사진 정리 중… ${n}/${total}`); }, true);
    if (!body.isConnected) { items.forEach((it) => URL.revokeObjectURL(it.preview)); return; }
    const failed = list.length - items.length;
    busy = false;
    if (failed) toast(`열 수 없는 사진 ${failed}장은 뺐어요`);
    if (!items.length) { status(''); return; }
    ({ clusters, leftovers } = clusterPhotos(items));
    if (!clusters.length) {
      status(`<b>위치 정보가 있는 사진이 없어요.</b><br>아이폰은 사진 고르는 화면 위쪽 <b>옵션 → 위치</b>를 켜고 다시 골라 주세요.
        안드로이드는 카메라 설정의 <b>위치 태그</b>가 켜져 있어야 해요.`);
      return;
    }
    const tripKind = state.trips.find((t) => t.id === Number($('#bulkTrip', body).value))?.kind;
    clusters.forEach((c) => {
      c.include = true;
      c.name = '';
      c.nameTouched = false;
      c.category = tripKind === 'gathering' ? 'food' : 'sight';
      c.comment = '';
      c.time = c.start != null ? timeOfMs(c.start) : '';
      c.planId = null;
      c.planTouched = false;
      c.items.forEach((it) => { it.off = false; });
    });
    leftovers.forEach((it) => { it.off = false; });
    bulkPlans = await plansOfTrip(Number($('#bulkTrip', body).value));
    if (!body.isConnected) return;
    clusters.forEach((c) => { c.planId = suggestFor(c); });
    status('');
    renderReview();
    nameClusters();
  };

  // 장소 이름을 위치로 자동으로 찾기 (한국은 카카오 근처 후보도 함께)
  async function nameClusters() {
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      if (c.nameTouched || c.name) continue;
      let r = { name: '', candidates: [], pick: null };
      try { r = await placeNameAt(c.center.lat, c.center.lng); } catch { /* 이름은 직접 */ }
      if (!body.isConnected) return;
      c.candidates = r.candidates;
      if (!c.nameTouched && !c.name) c.name = r.name || `장소 ${i + 1}`;
      if (r.pick && !c.catTouched) c.category = r.pick.category || c.category;
      const card = body.querySelector(`[data-c="${i}"]`);
      if (!card) continue;
      const input = card.querySelector('[data-name]');
      if (input && !c.nameTouched) input.value = c.name;
      const sel = card.querySelector('[data-cat]');
      if (sel && !c.catTouched) sel.value = c.category;
      card.querySelector('[data-cands]').innerHTML = candChips(c.candidates, `${i}:`, c.name);
      if (!c.planTouched) { // 이름을 찾은 뒤 계획 연결 추천을 다시
        c.planId = suggestFor(c) || c.planId;
        const ps = card.querySelector('[data-plan]');
        if (ps) ps.value = c.planId || '';
      }
    }
  }
  function chooseCandidate(ci, j) {
    const c = clusters[ci];
    const cand = c.candidates?.[j];
    if (!cand) return;
    c.name = cand.name;
    c.nameTouched = true;
    c.center = { lat: cand.lat, lng: cand.lng }; // 핀을 사진 위치 대신 가게 위치로
    if (cand.category && !c.catTouched) c.category = cand.category;
    const card = body.querySelector(`[data-c="${ci}"]`);
    card.querySelector('[data-name]').value = c.name;
    card.querySelector('[data-cat]').value = c.category;
    card.querySelector('[data-cands]').innerHTML = candChips(c.candidates, `${ci}:`, c.name);
    drawMap();
  }

  function photoCount(c) { return c.items.filter((it) => !it.off).length; }
  function leftoverTarget() { return Number(body.querySelector('#leftTarget')?.value ?? -1); }

  function renderReview() {
    const totalPhotos = clusters.reduce((n, c) => n + (c.include ? photoCount(c) : 0), 0);
    const places = clusters.filter((c) => c.include).length;
    const catOpts = (sel) => Object.entries(CATS).map(([k, [ic, label]]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${ic} ${label}</option>`).join('');
    $('#bulkReview', body).innerHTML = `
      <div class="bulk-summary">📍 장소 <b>${clusters.length}곳</b>으로 나눴어요 · 사진 ${items.length}장${leftovers.length ? ` · 위치 없는 사진 ${leftovers.length}장` : ''}</div>
      <div id="bulkMap" class="mini-map"></div>
      <small class="hint">사진을 누르면 빼거나 다시 넣을 수 있어요. 장소 이름은 위치로 자동으로 찾고, ‘근처’ 후보를 누르면 그 장소로 바꿀 수 있어요.</small>
      ${clusters.map((c, i) => `<div class="bulk-card ${c.include ? '' : 'off'}" data-c="${i}">
        <div class="bulk-head">
          <label class="bulk-check"><input type="checkbox" data-inc ${c.include ? 'checked' : ''}><span class="num">${i + 1}</span></label>
          <input class="bulk-name" data-name maxlength="60" value="${esc(c.name)}" placeholder="장소 이름 찾는 중…">
        </div>
        <div data-cands>${candChips(c.candidates, `${i}:`, c.name)}</div>
        <div class="bulk-meta">${c.start != null ? `🕒 ${fmtTime(c.start)}${c.end !== c.start ? `~${fmtTime(c.end).split(' ')[1]}` : ''} · ` : ''}사진 ${photoCount(c)}장${c.items.some((it) => it.attachedByTime) ? ' · 위치 없는 사진은 시간으로 붙임' : ''}</div>
        <div class="photo-strip">${c.items.map((it, j) => `<button type="button" class="bulk-ph ${it.off ? 'off' : ''}" data-ph="${i}:${j}"><img src="${it.preview}" alt=""></button>`).join('')}</div>
        ${state.v005 ? `<div class="grid2 bulk-plan">
          <label><small>시간</small><input type="time" data-time value="${esc(c.time)}"></label>
          <label><small>여행 계획과 연결</small><select data-plan>${planOptions(bulkPlans, clusterDate(c), c.planId)}</select></label>
        </div>` : ''}
        <div class="grid2">
          <select data-cat>${catOpts(c.category)}</select>
          <input data-cmt maxlength="80" placeholder="한줄 코멘트 (선택)" value="${esc(c.comment)}">
        </div>
      </div>`).join('')}
      ${leftovers.length ? `<div class="bulk-card">
        <div class="bulk-head"><b>📷 위치를 모르는 사진 ${leftovers.length}장</b></div>
        <div class="photo-strip">${leftovers.map((it, j) => `<button type="button" class="bulk-ph ${it.off ? 'off' : ''}" data-lph="${j}"><img src="${it.preview}" alt=""></button>`).join('')}</div>
        <label class="field" style="margin:8px 0 0"><span>이 사진들을 넣을 장소</span>
          <select id="leftTarget"><option value="-1">넣지 않기</option>${clusters.map((c, i) => `<option value="${i}">${i + 1}. ${esc(c.name || `장소 ${i + 1}`)}</option>`).join('')}</select></label>
      </div>` : ''}
      <button class="primary" id="bulkSave" ${places ? '' : 'disabled'}>장소 ${places}곳 · 사진 ${totalPhotos}장 기록하기</button>`;
    drawMap();
  }

  function drawMap() {
    setTimeout(() => {
      const el = $('#bulkMap', body);
      if (!el) return;
      bmap?.remove();
      bmap = L.map(el, { zoomControl: false, attributionControl: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(bmap);
      const pts = [];
      clusters.forEach((c, i) => {
        if (!c.include) return;
        pts.push([c.center.lat, c.center.lng]);
        L.marker([c.center.lat, c.center.lng], {
          icon: L.divIcon({ html: `<div class="pin small">${i + 1}</div>`, className: 'pin-wrap', iconSize: [30, 30], iconAnchor: [15, 30] }),
        }).addTo(bmap);
      });
      if (pts.length > 1) drawRoute(pts, bmap);
      if (pts.length) bmap.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
      else bmap.setView(map.getCenter(), 6);
    }, 50);
  }

  function updateSaveButton() {
    const btn = $('#bulkSave', body);
    if (!btn) return;
    const places = clusters.filter((c) => c.include).length;
    const total = clusters.reduce((n, c) => n + (c.include ? photoCount(c) : 0), 0)
      + (leftoverTarget() >= 0 && clusters[leftoverTarget()]?.include ? leftovers.filter((it) => !it.off).length : 0);
    btn.textContent = `장소 ${places}곳 · 사진 ${total}장 기록하기`;
    btn.disabled = !places;
  }

  body.addEventListener('input', (e) => {
    const card = e.target.closest('[data-c]');
    if (!card) return;
    const c = clusters[Number(card.dataset.c)];
    if (e.target.matches('[data-name]')) { c.name = e.target.value; c.nameTouched = true; }
    if (e.target.matches('[data-cmt]')) c.comment = e.target.value;
    if (e.target.matches('[data-time]')) c.time = e.target.value;
  }, { signal: listeners.signal });
  body.addEventListener('change', (e) => {
    if (e.target.id === 'leftTarget') { updateSaveButton(); return; }
    if (e.target.id === 'bulkTrip' && clusters.length) {
      plansOfTrip(Number(e.target.value)).then((list) => {
        bulkPlans = list;
        clusters.forEach((c) => { c.planId = suggestFor(c); c.planTouched = false; });
        if (body.isConnected) renderReview();
      });
      return;
    }
    const card = e.target.closest('[data-c]');
    if (!card) return;
    const c = clusters[Number(card.dataset.c)];
    if (e.target.matches('[data-cat]')) { c.category = e.target.value; c.catTouched = true; }
    if (e.target.matches('[data-plan]')) { c.planId = Number(e.target.value) || null; c.planTouched = true; }
    if (e.target.matches('[data-inc]')) {
      c.include = e.target.checked;
      card.classList.toggle('off', !c.include);
      updateSaveButton();
      drawMap();
    }
  }, { signal: listeners.signal });
  body.onclick = async (e) => {
    const cand = e.target.closest('[data-cand]');
    if (cand) {
      const [ci, j] = cand.dataset.cand.split(':').map(Number);
      chooseCandidate(ci, j);
      return;
    }
    const ph = e.target.closest('[data-ph]');
    if (ph) {
      const [ci, pi] = ph.dataset.ph.split(':').map(Number);
      const it = clusters[ci].items[pi];
      it.off = !it.off;
      ph.classList.toggle('off', it.off);
      const meta = body.querySelector(`[data-c="${ci}"] .bulk-meta`);
      if (meta) meta.textContent = meta.textContent.replace(/사진 \d+장/, `사진 ${photoCount(clusters[ci])}장`);
      updateSaveButton();
      return;
    }
    const lph = e.target.closest('[data-lph]');
    if (lph) {
      const it = leftovers[Number(lph.dataset.lph)];
      it.off = !it.off;
      lph.classList.toggle('off', it.off);
      updateSaveButton();
      return;
    }
    if (e.target.closest('#bulkSave')) await save();
  };

  async function save() {
    if (busy) return;
    const tripId = Number($('#bulkTrip', body).value);
    const target = leftoverTarget();
    const todo = clusters
      .map((c, i) => ({
        c,
        photos: [...c.items.filter((it) => !it.off), ...(i === target ? leftovers.filter((it) => !it.off) : [])]
          .sort((a, b) => (a.taken ?? Infinity) - (b.taken ?? Infinity)),
      }))
      .filter((x) => x.c.include);
    if (!todo.length) return;
    const btn = $('#bulkSave', body);
    busy = true;
    btn.disabled = true;
    let done = 0;
    let firstId = null;
    let photoFailed = 0;
    try {
      for (const { c, photos } of todo) {
        btn.textContent = `기록하는 중… ${done + 1}/${todo.length}곳`;
        const first = photos.find((p) => p.taken != null);
        const { id, failed } = await db.createPlace(tripId, {
          name: (c.name || '').trim() || `장소 ${done + 1}`,
          lat: c.center.lat,
          lng: c.center.lng,
          visited_at: first ? toYMD(new Date(first.taken)) : today(),
          category: c.category,
          comment: c.comment.trim() || null,
          visited_time: c.time || null,
          plan_item_id: c.planId || null,
        }, photos.slice(0, MAX_PHOTOS), (n, total) => { btn.textContent = `기록하는 중… ${done + 1}/${todo.length}곳 · 사진 ${n}/${total}`; });
        firstId ??= id;
        await markPlanVisited(c.planId);
        photoFailed += failed;
        done++;
      }
      closeSheet();
      toast(photoFailed ? `장소 ${done}곳을 기록했어요. 사진 ${photoFailed}장은 못 올렸어요` : `장소 ${done}곳을 기록했어요 📷`);
      state.filter = tripId;
      await refresh(true);
      switchView('map');
    } catch (err) {
      toast(`${done}곳까지 기록했어요. 나머지는 실패했어요: ${err.message}`);
      btn.disabled = false;
      btn.textContent = '다시 시도';
      // 이미 저장된 곳은 다시 저장되지 않게 빼기
      todo.slice(0, done).forEach(({ c }) => { c.include = false; });
      busy = false;
      await refresh();
    }
  }
}

/**
 * 장소 기록하기. pre: 일정에서 "방문 완료 → 기록 남기기"로 열 때 채울 값
 * { tripId, name, lat, lng, date, time, planId, category }
 */
function openAddPlace(pre = {}) {
  if (!state.trips.length) {
    toast('먼저 여행을 만들어 주세요');
    openTripForm();
    return;
  }
  const tripsW = editableTrips();
  if (!tripsW.length) { toast('보기 전용 여행이라 기록을 남길 수 없어요'); return; }
  const defTrip = pre.tripId || (state.filter !== 'all' && canEdit(state.filter) ? state.filter : tripsW[0].id);
  let processing = 0; // 줄이는 중인 사진 묶음 수 (끝나기 전엔 저장 버튼 잠금)
  const pending = [];
  let pos = pre.lat != null ? { lat: pre.lat, lng: pre.lng } : null;
  let mini = null;
  let miniMarker = null;
  let dateTouched = !!pre.date;
  let nameTouched = !!pre.name;

  const body = openSheet(`<h2>${pre.planId ? '방문 기록 남기기' : '장소 기록하기'}</h2>
    <form id="addForm" autocomplete="off">
      <label class="field"><span>여행</span><select name="trip">${tripsW.map((t) => `<option value="${t.id}" ${t.id === defTrip ? 'selected' : ''}>${kindEmoji(t.kind)} ${esc(t.title)}</option>`).join('')}</select></label>
      <div class="field"><span>사진 <small id="photoCount"></small></span>
        <div class="photo-strip" id="strip">
          <label class="add-photo">＋<small>사진 선택</small><input type="file" accept="image/*" multiple hidden id="photoInput"></label>
        </div>
        <small class="hint">사진에 위치·날짜 정보가 있으면 자동으로 채워져요. 올릴 때 자동으로 용량을 줄여요.</small>
      </div>
      <div class="field"><span>장소 이름</span>
        <div class="search-row"><input name="name" maxlength="60" placeholder="예: 오사카성, 공주역" enterkeyhint="search" value="${esc(pre.name || '')}"><button type="button" id="searchBtn">검색</button></div>
        <div id="nearby"></div>
        <div id="results" class="results"></div>
      </div>
      <div class="field"><span>위치 <small id="posLabel">지도를 눌러 선택하세요</small></span>
        <div id="miniMap" class="mini-map"></div>
        <button type="button" class="link" id="myPosBtn">📍 지금 있는 위치 사용</button>
        ${state.v009 ? '<label class="chk-line"><input type="checkbox" name="noloc"> 위치 없이 기록할래요 <small class="muted">(지도에는 안 보이고 기록장에만)</small></label>' : ''}
      </div>
      <div class="grid2">
        <label class="field"><span>날짜</span><input type="date" name="visited_at" value="${pre.date || today()}"></label>
        <label class="field ${state.v005 ? '' : 'hidden'}"><span>시간 <small id="timeSrc"></small></span><input type="time" name="visited_time"></label>
      </div>
      <div class="field hidden" id="apPlanField"><span>여행 계획과 연결</span><select name="plan_item_id"></select><small class="hint" id="apPlanHint"></small></div>
      <div class="field"><span>종류</span>${catPicker('sight')}</div>
      ${journalFields()}
      <label class="field"><span>한줄 코멘트 <small id="cnt">0/80</small></span><input name="comment" maxlength="80" placeholder="이곳에서의 한마디"></label>
      <label class="field"><span>이야기 (선택)</span><textarea name="memo" maxlength="2000" rows="3" placeholder="그날 있었던 일, 나눴던 이야기를 길게 남겨도 돼요"></textarea></label>
      ${diaryBox()}
      <button class="primary" type="submit" id="saveBtn">기록 남기기</button>
    </form>`, () => {
    mini?.remove();
    pending.forEach((p) => URL.revokeObjectURL(p.preview));
  });

  const form = $('#addForm', body);
  const strip = $('#strip', body);
  const results = $('#results', body);

  // 여행 계획 연결: 날짜가 같고 위치·이름·시간이 비슷한 일정을 추천 (계획 시간은 바꾸지 않음)
  let timeTouched = !!pre.time;
  let planTouched = false;
  let prePlan = pre.planId || null;
  let apPlans = [];
  if (pre.time) form.visited_time.value = pre.time;
  function suggestPlan() {
    if (!body.isConnected || !state.v005) return;
    const date = form.visited_at.value;
    const cur = planTouched ? (Number(form.plan_item_id.value) || null)
      : (matchPlan(apPlans, { date, time: form.visited_time.value, name: form.name.value, pos })?.id || null);
    form.plan_item_id.innerHTML = planOptions(apPlans, date, cur);
    $('#apPlanField', body).classList.toggle('hidden', form.plan_item_id.options.length < 2);
    $('#apPlanHint', body).textContent = !planTouched && cur
      ? '📌 위치·시간이 비슷한 계획을 골라 뒀어요. 연결해도 계획 시간은 바뀌지 않아요.'
      : '연결해도 계획 시간은 바뀌지 않아요. 타임라인은 실제 기록 시간 순서예요.';
  }
  async function loadApPlans() {
    apPlans = await plansOfTrip(Number(form.trip.value));
    planTouched = false;
    if (prePlan && apPlans.some((i) => i.id === prePlan)) {
      form.plan_item_id.innerHTML = planOptions(apPlans, form.visited_at.value, prePlan);
      planTouched = true;
    }
    prePlan = null;
    suggestPlan();
  }
  loadApPlans();
  form.trip.addEventListener('change', loadApPlans);
  form.plan_item_id.addEventListener('change', () => { planTouched = true; suggestPlan(); });
  form.visited_time.addEventListener('input', () => { timeTouched = true; $('#timeSrc', body).textContent = ''; suggestPlan(); });
  form.visited_at.addEventListener('change', suggestPlan);
  form.name.addEventListener('change', suggestPlan);

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
    suggestPlan();
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

  let nearby = [];
  let catTouched = false;
  function setCategory(cat) {
    const r = form.querySelector(`input[name=category][value="${cat}"]`);
    if (r) r.checked = true;
  }
  // 위치로 이름 채우기 + 근처 후보 보여주기 (한국은 카카오)
  async function fillNameFrom(lat, lng) {
    try {
      const r = await placeNameAt(lat, lng);
      if (!body.isConnected) return;
      if (r.name && !nameTouched && !form.name.value) {
        form.name.value = r.name;
        if (r.pick?.category && !catTouched) setCategory(r.pick.category);
      }
      nearby = r.candidates || [];
      $('#nearby', body).innerHTML = candChips(nearby, '', form.name.value);
    } catch { /* 이름은 직접 입력 */ }
  }
  form.addEventListener('change', (e) => { if (e.target.name === 'category') catTouched = true; });
  if (pre.category) { setCategory(pre.category); catTouched = true; }
  bindDiary(form, () => ({ tripId: Number(form.trip.value), date: form.visited_at.value, time: form.visited_time.value, category: form.category.value,
    plan: apPlans.find((i) => i.id === Number(form.plan_item_id.value))?.title, photoCount: pending.length }));
  $('#nearby', body).onclick = (e) => {
    const b = e.target.closest('[data-cand]');
    if (!b) return;
    const c = nearby[Number(b.dataset.cand)];
    form.name.value = c.name;
    nameTouched = true;
    if (c.category && !catTouched) setCategory(c.category);
    setPos(c.lat, c.lng, 17);
    $('#nearby', body).innerHTML = candChips(nearby, '', c.name);
  };

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
    let files = [...e.target.files];
    e.target.value = '';
    const room = MAX_PHOTOS - pending.length;
    if (files.length > room) toast(`한 장소에는 사진을 ${MAX_PHOTOS}장까지 올릴 수 있어요`);
    files = files.slice(0, Math.max(0, room));
    if (!files.length) return;
    const loading = document.createElement('div');
    loading.className = 'ph loading';
    loading.textContent = `줄이는 중 0/${files.length}`;
    strip.querySelector('.add-photo').before(loading);
    const saveBtn = $('#saveBtn', body);
    saveBtn.disabled = true;
    processing++;
    try {
      const items = await processPhotos(files, (n, total, item) => {
        loading.textContent = `줄이는 중 ${n}/${total}`;
        if (!item || !body.isConnected) return;
        if (item.gps && !pos) {
          setPos(item.gps.lat, item.gps.lng, 16);
          fillNameFrom(item.gps.lat, item.gps.lng);
          toast('사진의 위치 정보로 지도에 표시했어요');
        }
        if (item.date && !dateTouched) form.visited_at.value = item.date;
        // 사진 촬영 시각으로 기록 시간 채우기 (없거나 틀리면 직접 고칠 수 있어요)
        if (item.taken != null && !timeTouched && !form.visited_time.value) {
          form.visited_time.value = timeOfMs(item.taken);
          $('#timeSrc', body).textContent = '사진 촬영 시간';
        }
        suggestPlan();
      });
      if (!body.isConnected) { items.forEach((it) => URL.revokeObjectURL(it.preview)); return; }
      pending.push(...items);
    } finally {
      loading.remove();
      if (--processing === 0) saveBtn.disabled = false;
      if (body.isConnected) renderStrip();
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
        if (r.category && !catTouched) setCategory(r.category);
        setPos(r.lat, r.lng, 16);
        results.innerHTML = '';
        $('#nearby', body).innerHTML = '';
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
    const noLoc = !!form.noloc?.checked;
    if (!pos && !noLoc) return toast(state.v009 ? '지도를 눌러 위치를 정하거나 "위치 없이 기록"을 골라 주세요' : '지도를 눌러 위치를 정해 주세요');
    const btn = $('#saveBtn', body);
    if (btn.disabled || processing) return;
    btn.disabled = true;
    btn.textContent = pending.length ? `사진 올리는 중… 0/${pending.length}` : '저장 중…';
    try {
      const tripId = Number(form.trip.value);
      const r = await db.createPlace(tripId, {
        name, lat: noLoc ? null : pos.lat, lng: noLoc ? null : pos.lng,
        ...readJournal(form),
        visited_at: form.visited_at.value || null,
        category: form.category.value,
        comment: form.comment.value.trim() || null,
        memo: form.memo.value.trim() || null,
        visited_time: form.visited_time.value || null,
        plan_item_id: form.plan_item_id.value ? Number(form.plan_item_id.value) : null,
      }, pending, (n, total) => { btn.textContent = `사진 올리는 중… ${n}/${total}`; });
      const id = r.id;
      const planId = form.plan_item_id.value ? Number(form.plan_item_id.value) : null;
      await markPlanVisited(planId);
      closeSheet();
      toast(uploadResultMsg(r, planId && state.v008 ? '기록하고 방문 완료로 표시했어요 ✈️' : '기록했어요 ✈️'));

      if (state.filter !== 'all' && state.filter !== tripId) state.filter = tripId;
      await refresh();
      switchView('map');
      const p = state.places.find((x) => x.id === id);
      if (p?.lat == null) switchView('journal');
      else setTimeout(() => map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 14)), 50);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
      btn.textContent = '기록 남기기';
    }
  };
}

// ---------- 날짜 고르기 (출발일 → 종료일 이어서 고르기) ----------
// 출발일을 누르면 바로 종료일 고르기로 넘어가고, 출발일보다 이른 날은 고를 수 없어요. 종료일을 고르면 달력이 닫혀요.
// single: 모임·일상처럼 날짜 하나만 (고르면 바로 닫힘)
function rangePicker(box, { start = '', end = '', single = false, onChange }) {
  const st = { start, end, single, open: false, mode: 'start', month: null };
  const label = (v) => (v ? fmtDate(v).replace(/^\d+년 /, '') : '');
  const firstOfMonth = (v) => {
    const d = v ? new Date(`${v}T00:00:00`) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  };
  const emit = () => onChange?.(st.start, st.single ? '' : st.end);
  function pill(key, title, value, empty) {
    const on = st.open && st.mode === key;
    return `<button type="button" class="rc-pill ${on ? 'on' : ''}" data-rc="${key}" aria-expanded="${on}">
      <small>${title}</small><b>${label(value) || empty}</b></button>`;
  }
  function calendar() {
    const m = st.month;
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push('<span></span>');
    const now = today();
    const range = !st.single && st.start && st.end;
    for (let d = 1; d <= days; d++) {
      const v = toYMD(new Date(m.getFullYear(), m.getMonth(), d));
      const disabled = st.mode === 'end' && st.start && v < st.start;
      const isStart = v === st.start;
      const isEnd = !st.single && v === st.end;
      const cls = ['rc-day', isStart && 'start', isEnd && 'end', range && v > st.start && v < st.end && 'mid',
        range && st.start !== st.end && 'ranged', v === now && 'today'].filter(Boolean).join(' ');
      cells.push(`<button type="button" class="${cls}" data-day="${v}" ${disabled ? 'disabled' : ''} aria-pressed="${isStart || isEnd}" aria-label="${fmtDate(v)}">${d}</button>`);
    }
    const hint = st.single ? '날짜를 골라 주세요'
      : st.mode === 'start' ? '출발일을 골라 주세요' : '종료일을 골라 주세요 · 당일치기는 출발일을 한 번 더';
    return `<div class="rc-cal">
      <div class="rc-head">
        <button type="button" class="rc-nav" data-rc="prev" aria-label="이전 달">‹</button>
        <b>${m.getFullYear()}년 ${m.getMonth() + 1}월</b>
        <button type="button" class="rc-nav" data-rc="next" aria-label="다음 달">›</button>
      </div>
      <p class="rc-hint" aria-live="polite">${hint}</p>
      <div class="rc-week" aria-hidden="true">${[...'일월화수목금토'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="rc-grid">${cells.join('')}</div>
      <div class="rc-foot"><button type="button" class="link" data-rc="clear">날짜 지우기</button><button type="button" class="link" data-rc="close">닫기</button></div>
    </div>`;
  }
  function render() {
    const pills = st.single
      ? pill('start', '날짜', st.start, '날짜 고르기')
      : `${pill('start', '출발일', st.start, '고르기')}<span class="rc-arrow" aria-hidden="true">→</span>${pill('end', '종료일', st.end, '고르기')}`;
    box.innerHTML = `<div class="rc-pills ${st.single ? 'single' : ''}">${pills}</div>${st.open ? calendar() : ''}`;
  }
  function open(mode) {
    st.mode = !st.single && mode === 'end' && st.start ? 'end' : 'start';
    st.month = firstOfMonth(st.mode === 'end' ? (st.end || st.start) : st.start);
    st.open = true;
    render();
    box.querySelector('.rc-cal')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  box.addEventListener('click', (e) => {
    const day = e.target.closest('[data-day]');
    if (day && !day.disabled) {
      const v = day.dataset.day;
      if (st.single) { st.start = v; st.open = false; } else if (st.mode === 'start') {
        st.start = v;
        if (st.end && st.end < v) st.end = '';
        st.mode = 'end'; // 출발일을 고르면 바로 종료일 고르기
      } else { st.end = v; st.open = false; }
      emit();
      render();
      if (st.open) box.querySelector(`[data-day="${v}"]`)?.focus({ preventScroll: true });
      else box.querySelector(`[data-rc="${st.single ? 'start' : 'end'}"]`)?.focus({ preventScroll: true });
      return;
    }
    const a = e.target.closest('[data-rc]')?.dataset.rc;
    if (!a) return;
    if (a === 'start' || a === 'end') {
      if (st.open && st.mode === a) { st.open = false; render(); } else open(a);
    } else if (a === 'prev' || a === 'next') {
      st.month = new Date(st.month.getFullYear(), st.month.getMonth() + (a === 'prev' ? -1 : 1), 1);
      render();
    } else if (a === 'clear') {
      st.start = ''; st.end = ''; st.mode = 'start'; emit(); render();
    } else if (a === 'close') { st.open = false; render(); }
  });
  render();
  return {
    setSingle(v) {
      if (st.single === v) return;
      st.single = v;
      st.mode = 'start';
      st.open = false;
      emit();
      render();
    },
  };
}

// ---------- 여행 ----------
function openTripForm(trip) {
  const kind0 = trip?.kind || 'trip';
  const body = openSheet(`<h2>${trip ? '여행 정보 수정' : '새 여행 만들기'}</h2>
    <form id="tripForm">
      <div class="field"><span>종류</span><div class="cats">${Object.entries(KINDS).map(([k, [, label]]) => `<label>
        <input type="radio" name="kind" value="${k}" ${k === kind0 ? 'checked' : ''}><span>${kindIcon(k)} ${label}</span></label>`).join('')}</div></div>
      <label class="field"><span>이름</span><input name="title" required maxlength="40" value="${esc(trip?.title || '')}"></label>
      <div class="field"><span>날짜</span><div id="tripDates"></div></div>
      <input type="hidden" name="start_date" value="${esc(trip?.start_date || '')}">
      <input type="hidden" name="end_date" value="${esc(trip?.end_date || '')}">
      ${tripMoreHtml(trip)}
      <button class="primary" type="submit">${trip ? '저장' : '만들기'}</button>
    </form>`);
  const tf = $('#tripForm', body);
  const picker = rangePicker($('#tripDates', body), {
    start: trip?.start_date || '', end: trip?.end_date || '', single: kind0 !== 'trip',
    onChange: (st, en) => { tf.start_date.value = st; tf.end_date.value = en; },
  });
  // 여행은 기간, 모임·일상은 날짜 하나
  function applyKind() {
    const k = tf.kind.value;
    tf.title.placeholder = KINDS[k][2];
    picker.setSingle(k !== 'trip');
  }
  tf.onchange = (e) => { if (e.target.name === 'kind') applyKind(); };
  applyKind();
  if (trip) loadTripPrefs(trip.id, tf); // 저장해 둔 스타일·교통·예산 채우기
  tf.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = $('button[type=submit]', f);
    if (btn.disabled) return; // 연타 방지
    btn.disabled = true;
    const data = { title: f.title.value, kind: f.kind.value, start_date: f.start_date.value, end_date: f.end_date.value };
    if (f.country) Object.assign(data, { country: f.country.value, cities: f.cities.value, party_type: f.party_type.value });
    if (f.cover_photo_id) data.cover_photo_id = f.cover_photo_id.value;
    const more = readTripPrefs(f);
    if (more?.budget === 'bad') { toast('예산은 0 이상으로 입력해 주세요'); btn.disabled = false; return; }
    try {
      if (trip) {
        await db.updateTrip(trip.id, data);
        await saveTripPrefs(trip.id, more, data);
        await refresh();
        openTrip(trip.id);
      } else {
        const id = await db.createTrip(data);
        await saveTripPrefs(id, more, data);
        state.filter = id;
        closeSheet();
        switchView('timeline'); // 타임라인 탭에서 바로 일정 만들기 (친구 초대는 위쪽 👥)
        await refresh(true);
        toast('여행을 만들었어요. 일정을 만들어 보세요 ✨');
      }
    } catch (err) { toast(err.message); btn.disabled = false; }
  };
}

// ---------- 여행 정보 더 넣기 (선택): 국가·도시·유형·스타일·교통·예산·대표 사진 ----------
// 스타일·교통·예산은 AI 일정 조건(trip_plans.prefs)에 저장해서 AI 일정 만들기·예산 화면이 같이 써요
function tripMoreHtml(trip) {
  const P = window.PlannerShared || {};
  const photos = trip ? state.places.filter((p) => p.trip_id === trip.id).flatMap((p) => p.photos.map((ph) => ({ ...ph, place: p.name }))) : [];
  const has = trip && (trip.country || trip.cities?.length || trip.party_type || trip.cover_photo_id);
  return `<details class="more-info" ${has ? 'open' : ''}>
    <summary>여행 정보 더 넣기 <small>(선택)</small></summary>
    ${state.v007 ? `<div class="grid2">
      <label class="field"><span>국가</span><input name="country" list="countryList" maxlength="40" value="${esc(trip?.country || '')}" placeholder="예: 일본"></label>
      <label class="field"><span>도시 <small>쉼표로 여러 곳</small></span><input name="cities" maxlength="200" value="${esc((trip?.cities || []).join(', '))}" placeholder="예: 도쿄, 오사카"></label>
    </div>
    <datalist id="countryList">${COUNTRIES.map((c) => `<option value="${c}">`).join('')}</datalist>
    <div class="field"><span>여행 유형</span><div class="cats">
      <label><input type="radio" name="party_type" value="" ${trip?.party_type ? '' : 'checked'}><span>선택 안 함</span></label>
      ${Object.entries(PARTY).map(([k, l]) => `<label><input type="radio" name="party_type" value="${k}" ${trip?.party_type === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>` : ''}
    ${P.STYLES ? `<div class="field"><span>여행 스타일</span><div class="cats" id="tpStyles">${Object.entries(P.STYLES).map(([k, l]) => `<label><input type="checkbox" name="styles" value="${k}"><span>${l}</span></label>`).join('')}</div></div>
    <div class="grid2">
      <label class="field"><span>교통</span><select name="transport"><option value="">선택 안 함</option>${Object.entries(P.TRANSPORTS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <div class="field"><span>예산</span><div class="budget-in"><input type="number" name="budget" min="0" step="any" inputmode="numeric" placeholder="원" aria-label="예산 금액"><select name="budget_scope" aria-label="예산 기준"><option value="PER_PERSON">1인</option><option value="TOTAL">전체</option></select></div></div>
    </div>` : ''}
    ${state.v007 && trip ? (photos.length ? `<div class="field"><span>대표 사진</span><div class="cover-pick">
        <label><input type="radio" name="cover_photo_id" value="" ${trip.cover_photo_id ? '' : 'checked'}><span class="cover-auto">자동<br><small>첫 사진</small></span></label>
        ${photos.slice(0, 40).map((ph) => `<label><input type="radio" name="cover_photo_id" value="${ph.id}" ${trip.cover_photo_id === ph.id ? 'checked' : ''}><img src="${esc(ph.thumb)}" alt="${esc(ph.place)}"></label>`).join('')}</div></div>`
      : `<small class="hint">대표 사진은 이 여행을 고른 상태에서, 사진을 올린 뒤 고를 수 있어요.</small>`) : ''}
    <small class="hint">스타일·교통·예산은 AI 일정 만들기와 예산 화면에서도 같이 써요.</small>
  </details>`;
}
function readTripPrefs(f) {
  if (!f.transport) return null;
  const styles = [...f.querySelectorAll('[name=styles]:checked')].map((x) => x.value);
  let budget = null;
  if (f.budget.value !== '') {
    const amount = Number(f.budget.value);
    if (!Number.isFinite(amount) || amount < 0) return { budget: 'bad' };
    budget = { amount, currency: 'KRW', scope: f.budget_scope.value };
  }
  return { styles, transport: f.transport.value || null, budget };
}
async function loadTripPrefs(tripId, f) {
  if (!f.transport) return;
  try {
    const r = await sb.from('trip_plans').select('prefs').eq('trip_id', tripId).maybeSingle();
    const pr = r.data?.prefs || {};
    if (!f.isConnected) return;
    (pr.styles || []).forEach((s) => { const c = f.querySelector(`[name=styles][value="${s}"]`); if (c) c.checked = true; });
    if (pr.transport) f.transport.value = pr.transport;
    if (pr.budget?.amount != null) { f.budget.value = pr.budget.amount; f.budget_scope.value = pr.budget.scope || 'PER_PERSON'; }
    if (pr.styles?.length || pr.transport || pr.budget) f.querySelector('.more-info').open = true;
  } catch { /* 004 전이면 없음 */ }
}
/** 기존 AI 조건에 합쳐서 저장 (여행지·인원은 비어 있을 때만 여행 정보로 채움). 실패해도 여행 저장은 그대로 */
async function saveTripPrefs(tripId, more, data) {
  if (!more) return;
  try {
    const r = await sb.from('trip_plans').select('prefs').eq('trip_id', tripId).maybeSingle();
    const old = r.data?.prefs || {};
    const place = [splitList(data.cities).join(', '), String(data.country || '').trim()].filter(Boolean).join(', ');
    const prefs = {
      ...old, styles: more.styles, transport: more.transport || old.transport || null, budget: more.budget,
      destination: old.destination || place || undefined,
      travelerCount: old.travelerCount || PARTY_PEOPLE[data.party_type] || undefined,
    };
    const res = await sb.rpc('save_plan_prefs', { p_trip_id: tripId, p_prefs: prefs });
    if (res.error) throw res.error;
  } catch { /* AI 조건 저장 실패는 조용히 (여행 저장은 이미 됨) */ }
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

async function openInviteLink(trip, reset = false, role) {
  const inv = await db.createInvite(trip.id, reset, role);
  const invRole = inv.role || role;
  const url = `${APP_URL}?invite=${encodeURIComponent(inv.token)}`;
  const text = `‘${trip.title}’ 여행에 초대할게요! 링크를 눌러 가입하면 같이 기록할 수 있어요.`;
  const daysLeft = Math.max(1, Math.ceil((Date.parse(inv.expires_at) - Date.now()) / 86400000));
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const isOwner = trip.owner_id === state.me.id;

  const body = openSheet(`<h2>${invRole && ROLES[invRole] ? `${ROLES[invRole][0]} ${ROLES[invRole][1]} ` : ''}초대 링크</h2>
    <p class="muted" style="margin-top:-6px">‘${esc(trip.title)}’ · 앞으로 ${daysLeft}일 동안 쓸 수 있어요${invRole === 'VIEWER' ? ' · 받은 사람은 보기 전용으로 들어와요' : invRole === 'EDITOR' ? ' · 받은 사람은 함께 고칠 수 있어요' : ''}</p>
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
      try { await navigator.share({ title: '모아로그 초대', text, url }); } catch { /* 취소 */ }
    } else if (act === 'copy') {
      const ok = await copyText(`${text}\n${url}`, $('#inviteUrl', body));
      toast(ok ? '링크를 복사했어요. 카톡에 붙여넣어 보내세요' : '복사가 안 되네요. 링크를 길게 눌러 복사해 주세요');
    } else if (act === 'back') {
      openTrip(trip.id);
    } else if (act === 'reset') {
      if (!confirm('지금 링크를 못 쓰게 하고 새 링크를 만들까요?')) return;
      try {
        await openInviteLink(trip, true, invRole);
        toast('새 링크를 만들었어요');
      } catch (err) { toast(err.message); }
    }
  };
}

function openTrip(id) {
  const t = state.trips.find((x) => x.id === id);
  if (!t) return;
  const isOwner = t.owner_id === state.me.id;
  const editor = canEdit(t);
  const roleOf = (m) => (state.v010 ? `<span class="role-chip ${m.role.toLowerCase()}">${ROLES[m.role][0]} ${ROLES[m.role][1]}</span>` : '');
  const body = openSheet(`<h2>${kindIcon(t.kind)} ${esc(t.title)}</h2>
    <p class="muted" style="margin-top:-6px">${kindName(t.kind)} · 📅 ${fmtRange(t.start_date, t.end_date)} · 📍 기록 ${t.place_count}곳${t.plan_count ? ` · 📋 일정 ${t.plan_count}개` : ''}${state.v010 ? ` · 나: ${ROLES[t.myRole][1]}` : ''}</p>
    ${roBanner(t)}
    <div class="btn-row">
      <button class="btn" data-act="view">${ic('🗺️')} 지도로 보기</button>
      ${editor ? '<button class="btn" data-act="edit">✏️ 수정</button>' : ''}
    </div>
    <div class="divider"></div>
    <h3 style="margin:0 0 6px">함께한 사람 (${t.members.length})</h3>
    <div>${t.members.map((m) => `<div class="member">
        <div class="avatar">${initial(m.name)}</div>
        <div class="grow">${esc(m.name)} <small>${m.username ? `@${esc(m.username)}` : ''}${!state.v010 && m.id === t.owner_id ? ' · 만든 사람' : ''}${m.id === state.me.id ? ' (나)' : ''}</small>
          ${isOwner && state.v010 && m.id !== t.owner_id ? '' : roleOf(m)}</div>
        ${isOwner && state.v010 && m.id !== t.owner_id ? `<select class="role-sel" data-role-of="${m.id}" aria-label="${esc(m.name)} 역할">
          <option value="EDITOR" ${m.role === 'EDITOR' ? 'selected' : ''}>✏️ 편집자</option><option value="VIEWER" ${m.role === 'VIEWER' ? 'selected' : ''}>👀 보기 전용</option></select>` : ''}
        ${isOwner && m.id !== t.owner_id ? `<button data-kick="${m.id}">내보내기</button>` : ''}
      </div>`).join('')}</div>
    ${state.v010 ? '<small class="hint">✏️ 편집자는 기록·일정·스크랩북을 함께 고치고, 👀 보기 전용은 보고 한마디·즐겨찾기만 남겨요. 역할은 만든 사람이 바꿔요.</small>' : ''}
    ${editor ? `${state.v010 ? `<div class="btn-row" style="margin-top:14px">
        <button class="primary" data-act="invite" data-role="VIEWER" style="flex:1">🔗 보기 전용 초대 링크</button>
        ${isOwner ? '<button class="btn" data-act="invite" data-role="EDITOR" style="flex:1">✏️ 편집자 초대 링크</button>' : ''}
      </div>
      <small class="hint">링크를 받은 친구는 가입하는 즉시 이 여행에 들어와요. 링크만으로 편집 권한을 주지 않으려면 보기 전용 링크를 보내세요.</small>`
    : `<button class="primary" data-act="invite" style="margin-top:14px">🔗 초대 링크 보내기</button>
      <small class="hint">카톡 등으로 링크를 보내면, 친구가 누르고 가입하는 즉시 이 여행에 들어와요.</small>`}
    <form id="inviteForm" style="margin-top:14px">
      <div class="search-row"><input name="username" placeholder="이미 가입한 친구는 아이디로 초대" autocapitalize="off" autocorrect="off" required
        style="padding:12px 14px;border:1px solid var(--line);border-radius:12px;font-size:16px">
        ${state.v010 && isOwner ? '<select name="role" class="role-sel" aria-label="초대 역할"><option value="EDITOR">✏️ 편집자</option><option value="VIEWER">👀 보기 전용</option></select>' : ''}
        <button type="submit">초대</button></div>
      ${state.v010 && !isOwner ? '<small class="hint">편집자가 초대하면 보기 전용으로 들어와요.</small>' : ''}
    </form>` : ''}
    <div class="divider"></div>
    <div class="btn-row">${isOwner
      ? '<button class="btn danger" data-act="delete">여행 삭제</button>'
      : '<button class="btn danger" data-act="leave">이 여행에서 나가기</button>'}</div>`);

  if ($('#inviteForm', body)) $('#inviteForm', body).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const u = await db.addMemberByUsername(id, e.target.username.value.trim(), e.target.role?.value);
      toast(`${u.name}님을 초대했어요`);
      await refresh();
      openTrip(id);
    } catch (err) { toast(err.message); }
  };
  body.onchange = async (e) => {
    const sel = e.target.closest('[data-role-of]');
    if (!sel) return;
    const m = t.members.find((x) => x.id === sel.dataset.roleOf);
    try {
      await db.setMemberRole(id, sel.dataset.roleOf, sel.value);
      toast(`${m?.name || '멤버'}님을 ${ROLES[sel.value][1]}(으)로 바꿨어요`);
      await refresh();
      openTrip(id);
    } catch (err) { toast(err.message); sel.value = m?.role || 'EDITOR'; }
  };
  body.onclick = async (e) => {
    const kick = e.target.closest('[data-kick]');
    const act = e.target.closest('[data-act]')?.dataset.act;
    try {
      if (act === 'invite') {
        await openInviteLink(t, false, e.target.closest('[data-act]').dataset.role);
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
        if (!confirm(`'${t.title}' 여행의 모든 기록, 사진, 한마디가 삭제돼요. 되돌릴 수 없어요. 삭제할까요?`)) return;
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
