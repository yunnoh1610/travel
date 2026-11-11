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
// 기록장 종류
const KINDS = {
  trip: ['🧳', '여행', '예: 2026 오사카 먹방 여행'],
  gathering: ['🎉', '모임·기념일', '예: 우정 10주년 저녁'],
  daily: ['☕', '일상', '예: 2026 우리 동네 맛집'],
};
const kindIcon = (k) => (KINDS[k] || KINDS.trip)[0];
const kindName = (k) => (KINDS[k] || KINDS.trip)[1];
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
      ? await q(sb.from('trip_members').select('trip_id, user_id, profiles(name, username)').in('trip_id', ids))
      : [];
    await signPaths(trips.map((t) => t.cover_path));
    const key = (t) => t.start_date || (t.created_at || '').slice(0, 10);
    return trips
      .map((t) => ({
        ...t,
        place_count: Number(t.place_count) || 0,
        cover: t.cover_path ? urlOf(t.cover_path) : null,
        members: members.filter((m) => m.trip_id === t.id)
          .map((m) => ({ id: m.user_id, name: m.profiles?.name || '?', username: m.profiles?.username || '' }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => key(b).localeCompare(key(a)) || b.id - a.id);
  },
  async places(filter) {
    let qb = sb.from('places')
      .select('id, trip_id, user_id, name, lat, lng, visited_at, comment, memo, category, created_at, author:profiles(name), trip:trips(title), photos(id, user_id, path, thumb_path), place_comments(count)')
      .order('id', { referencedTable: 'photos', ascending: true });
    if (filter !== 'all') qb = qb.eq('trip_id', filter);
    const rows = await q(qb);
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
    const row = await q(sb.from('trips').insert(tripFields(f)).select('id').single());
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
    await qChanged(sb.from('trips').delete().eq('id', id).select('id'));
  },
  async addMemberByUsername(tripId, username) {
    const rows = await q(sb.rpc('add_member_by_username', { p_trip_id: tripId, p_username: username }));
    return rows[0];
  },
  removeMember: (tripId, userId) =>qChanged(sb.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId).select('user_id')),
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

// 여행은 시작일~종료일, 모임·일상은 날짜 하나
function tripFields(f) {
  const kind = KINDS[f.kind] ? f.kind : 'trip';
  return {
    title: String(f.title || '').trim(),
    kind,
    start_date: f.start_date || null,
    end_date: kind === 'trip' ? (f.end_date || null) : null,
  };
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
    el.innerHTML = `<b>${esc(inv.inviter)}</b>님이 <b>‘${esc(inv.title)}’</b> 기록장에 초대했어요.<br>
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
    toast(r.already ? `이미 ‘${r.title}’ 기록장 멤버예요` : `‘${r.title}’ 기록장에 참여했어요 🎉`);
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
  sel.innerHTML = `<option value="all">🌏 모든 기록장 (${total})</option>`
    + state.trips.map((t) => `<option value="${t.id}">${kindIcon(t.kind)} ${esc(t.title)} (${t.place_count})</option>`).join('');
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
      : '반가워요! 먼저 아래 <b>기록장</b> 탭에서 여행이나 모임 기록장을 만들고, 함께한 친구를 초대해 보세요.';
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
      <small>${catLabel(p.category)} · ${esc(p.author)}${state.filter === 'all' ? ` · ${esc(p.trip_title)}` : ''}${p.photos.length > 1 ? ` · 사진 ${p.photos.length}` : ''}${p.comment_count ? ` · 💬 ${p.comment_count}` : ''}${p.memo ? ' · 📝' : ''}</small>
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
  $('#tripStats').innerHTML = `<div><b>${state.trips.length}</b><small>기록장</small></div>
    <div><b>${places}</b><small>장소</small></div><div><b>${friends.size}</b><small>함께한 친구</small></div>`;
  $('#tripList').innerHTML = state.trips.length
    ? state.trips.map((t) => `<button class="card trip-card" data-trip="${t.id}">
        ${t.cover ? `<img class="thumb" src="${esc(t.cover)}" alt="" loading="lazy">` : `<div class="thumb">${kindIcon(t.kind)}</div>`}
        <div class="body">
          <b>${esc(t.title)}</b>
          <small>${kindIcon(t.kind)} ${kindName(t.kind)} · 📅 ${fmtRange(t.start_date, t.end_date)} · 📍 ${t.place_count}곳</small>
          <small>👥 ${t.members.map((m) => esc(m.name)).join(', ')}</small>
        </div></button>`).join('')
    : '<div class="empty"><div class="big">📒</div>첫 기록장을 만들어 보세요<br><small>여행, 모임·기념일, 일상 중에 골라요</small></div>';
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
    <p class="muted">${state.me.userid
      ? `아이디: <b>${esc(state.me.userid)}</b><br>친구가 기록장에 초대할 때 이 아이디를 알려주세요.`
      : esc(state.me.email)}</p>
    <div class="divider"></div>
    <h3 style="margin:0 0 12px">비밀번호 변경</h3>
    <form id="pwForm">
      <input name="username" autocomplete="username" value="${esc(state.me.userid || state.me.email)}" hidden>
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
  const tripOwner = trip?.owner_id === state.me.id;
  const canEdit = p.user_id === state.me.id || tripOwner;
  const body = openSheet(`
    ${p.photos.length ? `<div class="gallery">${p.photos.map((ph) => `<div class="g-item">
        <img src="${esc(ph.url)}" alt="" loading="lazy" data-full="${esc(ph.url)}">
        ${canEdit || ph.user_id === state.me.id ? `<button class="g-del" data-photo="${ph.id}" aria-label="사진 삭제">✕</button>` : ''}
      </div>`).join('')}</div>` : ''}
    <span class="pd-cat">${catLabel(p.category)}</span>
    <h2 class="pd-name">${esc(p.name)}</h2>
    ${p.comment ? `<p class="pd-comment">${esc(p.comment)}</p>` : ''}
    ${p.memo ? `<div class="pd-memo">${esc(p.memo)}</div>` : ''}
    <div class="pd-meta">
      <span>📅 ${fmtDate(visitKey(p))}</span>
      <span>✍️ ${esc(p.author)}</span>
      <span>${kindIcon(trip?.kind)} ${esc(p.trip_title)}</span>
    </div>
    <div class="btn-row">
      <button class="btn" data-act="locate">🗺️ 지도에서 보기</button>
      <label class="btn">📷 사진 추가<input type="file" accept="image/*" multiple hidden></label>
      ${canEdit ? '<button class="btn" data-act="edit">✏️ 수정</button><button class="btn danger" data-act="delete">삭제</button>' : ''}
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
      renderTimeline();
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
        renderTimeline();
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
      <label class="field"><span>이야기 (선택)</span><textarea name="memo" maxlength="2000" rows="4" placeholder="그날 있었던 일, 나눴던 이야기">${esc(p.memo || '')}</textarea></label>
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
        memo: f.memo.value.trim() || null,
        visited_at: f.visited_at.value || null, category: f.category.value,
      });
      await refresh();
      openPlace(p.id);
      toast('수정했어요');
    } catch (err) { toast(err.message); }
  };
}

// ---------- 장소 기록하기 ----------
$('#fab').onclick = () => {
  if (!state.trips.length) {
    toast('먼저 기록장을 만들어 주세요');
    openTripForm();
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
  const listeners = new AbortController(); // 시트를 닫으면 아래 입력 감지도 같이 해제

  const body = openSheet(`<h2>사진으로 한꺼번에 기록</h2>
    <p class="muted" style="margin-top:-6px">그날 찍은 사진을 한 번에 고르면, 찍은 위치별로 장소를 나눠서 기록해 줘요.</p>
    <label class="field"><span>기록장</span><select name="trip" id="bulkTrip">${state.trips.map((t) => `<option value="${t.id}" ${t.id === defTrip ? 'selected' : ''}>${kindIcon(t.kind)} ${esc(t.title)}</option>`).join('')}</select></label>
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
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      status(`사진 정리 중… ${i + 1}/${list.length}`);
      try { items.push(await processPhoto(list[i])); } catch { failed++; }
      if (!body.isConnected) { items.forEach((it) => URL.revokeObjectURL(it.preview)); return; }
    }
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
      c.items.forEach((it) => { it.off = false; });
    });
    leftovers.forEach((it) => { it.off = false; });
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
      if (pts.length > 1) L.polyline(pts, { color: '#0f766e', weight: 3, opacity: 0.75, dashArray: '6 8' }).addTo(bmap);
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
  }, { signal: listeners.signal });
  body.addEventListener('change', (e) => {
    if (e.target.id === 'leftTarget') { updateSaveButton(); return; }
    const card = e.target.closest('[data-c]');
    if (!card) return;
    const c = clusters[Number(card.dataset.c)];
    if (e.target.matches('[data-cat]')) { c.category = e.target.value; c.catTouched = true; }
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
    try {
      for (const { c, photos } of todo) {
        btn.textContent = `기록하는 중… ${done + 1}/${todo.length}곳`;
        const first = photos.find((p) => p.taken != null);
        const id = await db.createPlace(tripId, {
          name: (c.name || '').trim() || `장소 ${done + 1}`,
          lat: c.center.lat,
          lng: c.center.lng,
          visited_at: first ? toYMD(new Date(first.taken)) : today(),
          category: c.category,
          comment: c.comment.trim() || null,
        }, photos.slice(0, 30));
        firstId ??= id;
        done++;
      }
      closeSheet();
      toast(`장소 ${done}곳을 기록했어요 📷`);
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

function openAddPlace() {
  if (!state.trips.length) {
    toast('먼저 기록장을 만들어 주세요');
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
      <label class="field"><span>기록장</span><select name="trip">${state.trips.map((t) => `<option value="${t.id}" ${t.id === defTrip ? 'selected' : ''}>${kindIcon(t.kind)} ${esc(t.title)}</option>`).join('')}</select></label>
      <div class="field"><span>사진 <small id="photoCount"></small></span>
        <div class="photo-strip" id="strip">
          <label class="add-photo">＋<small>사진 선택</small><input type="file" accept="image/*" multiple hidden id="photoInput"></label>
        </div>
        <small class="hint">사진에 위치·날짜 정보가 있으면 자동으로 채워져요. 올릴 때 자동으로 용량을 줄여요.</small>
      </div>
      <div class="field"><span>장소 이름</span>
        <div class="search-row"><input name="name" maxlength="60" placeholder="예: 오사카성, 공주역" enterkeyhint="search"><button type="button" id="searchBtn">검색</button></div>
        <div id="nearby"></div>
        <div id="results" class="results"></div>
      </div>
      <div class="field"><span>위치 <small id="posLabel">지도를 눌러 선택하세요</small></span>
        <div id="miniMap" class="mini-map"></div>
        <button type="button" class="link" id="myPosBtn">📍 지금 있는 위치 사용</button>
      </div>
      <label class="field"><span>날짜</span><input type="date" name="visited_at" value="${today()}"></label>
      <div class="field"><span>종류</span>${catPicker('sight')}</div>
      <label class="field"><span>한줄 코멘트 <small id="cnt">0/80</small></span><input name="comment" maxlength="80" placeholder="이곳에서의 한마디"></label>
      <label class="field"><span>이야기 (선택)</span><textarea name="memo" maxlength="2000" rows="3" placeholder="그날 있었던 일, 나눴던 이야기를 길게 남겨도 돼요"></textarea></label>
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
        memo: form.memo.value.trim() || null,
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
  const kind0 = trip?.kind || 'trip';
  const body = openSheet(`<h2>${trip ? '기록장 정보 수정' : '새 기록장 만들기'}</h2>
    <form id="tripForm">
      <div class="field"><span>종류</span><div class="cats">${Object.entries(KINDS).map(([k, [ic, label]]) => `<label>
        <input type="radio" name="kind" value="${k}" ${k === kind0 ? 'checked' : ''}><span>${ic} ${label}</span></label>`).join('')}</div></div>
      <label class="field"><span>이름</span><input name="title" required maxlength="40" value="${esc(trip?.title || '')}"></label>
      <div class="grid2">
        <label class="field"><span id="startLabel">시작일</span><input type="date" name="start_date" value="${esc(trip?.start_date || '')}"></label>
        <label class="field" id="endField"><span>종료일</span><input type="date" name="end_date" value="${esc(trip?.end_date || '')}"></label>
      </div>
      <button class="primary" type="submit">${trip ? '저장' : '만들기'}</button>
    </form>`);
  const tf = $('#tripForm', body);
  // 여행은 기간, 모임·일상은 날짜 하나
  function applyKind() {
    const k = tf.kind.value;
    tf.title.placeholder = KINDS[k][2];
    $('#startLabel', body).textContent = k === 'trip' ? '시작일' : '날짜';
    $('#endField', body).classList.toggle('hidden', k !== 'trip');
  }
  tf.onchange = (e) => { if (e.target.name === 'kind') applyKind(); };
  applyKind();
  tf.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const data = { title: f.title.value, kind: f.kind.value, start_date: f.start_date.value, end_date: f.end_date.value };
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
        toast('기록장을 만들었어요. 함께한 친구를 초대해 보세요!');
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
  const text = `‘${trip.title}’ 기록장에 초대할게요! 링크를 눌러 가입하면 같이 기록할 수 있어요.`;
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
      <button class="btn" data-act="back">← 기록장으로</button>
    </div>
    ${isOwner ? `<div class="divider"></div>
      <button class="link" data-act="reset" style="color:var(--danger)">링크 새로 만들기</button>
      <small class="hint">지금 링크는 더 이상 쓸 수 없게 돼요. 링크가 엉뚱한 사람에게 갔을 때 쓰세요.</small>` : ''}`);

  body.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'share') {
      try { await navigator.share({ title: '추억 기록 초대', text, url }); } catch { /* 취소 */ }
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
  const body = openSheet(`<h2>${kindIcon(t.kind)} ${esc(t.title)}</h2>
    <p class="muted" style="margin-top:-6px">${kindName(t.kind)} · 📅 ${fmtRange(t.start_date, t.end_date)} · 📍 ${t.place_count}곳</p>
    <div class="btn-row">
      <button class="btn" data-act="view">🗺️ 지도로 보기</button>
      <button class="btn" data-act="edit">✏️ 수정</button>
    </div>
    <div class="divider"></div>
    <h3 style="margin:0 0 6px">함께한 사람 (${t.members.length})</h3>
    <div>${t.members.map((m) => `<div class="member">
        <div class="avatar">${initial(m.name)}</div>
        <div class="grow">${esc(m.name)} <small>${m.username ? `@${esc(m.username)}` : ''}${m.id === t.owner_id ? ' · 만든 사람' : ''}${m.id === state.me.id ? ' (나)' : ''}</small></div>
        ${isOwner && m.id !== t.owner_id ? `<button data-kick="${m.id}">내보내기</button>` : ''}
      </div>`).join('')}</div>
    <button class="primary" data-act="invite" style="margin-top:14px">🔗 초대 링크 보내기</button>
    <small class="hint">카톡 등으로 링크를 보내면, 친구가 누르고 가입하는 즉시 이 기록장에 들어와요.</small>
    <form id="inviteForm" style="margin-top:14px">
      <div class="search-row"><input name="username" placeholder="이미 가입한 친구는 아이디로 초대" autocapitalize="off" autocorrect="off" required
        style="padding:12px 14px;border:1px solid var(--line);border-radius:12px;font-size:16px"><button type="submit">초대</button></div>
    </form>
    <div class="divider"></div>
    <div class="btn-row">${isOwner
      ? '<button class="btn danger" data-act="delete">기록장 삭제</button>'
      : '<button class="btn danger" data-act="leave">이 기록장에서 나가기</button>'}</div>`);

  $('#inviteForm', body).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const u = await db.addMemberByUsername(id, e.target.username.value.trim());
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
        if (!confirm('이 사람을 기록장에서 내보낼까요? 그 사람이 쓴 기록은 남아요. 초대 링크로 다시 들어오지 못하게 하려면 링크도 새로 만들어 주세요.')) return;
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
        if (!confirm(`'${t.title}' 기록장의 모든 기록, 사진, 한마디가 삭제돼요. 되돌릴 수 없어요. 삭제할까요?`)) return;
        await db.deleteTrip(id);
        closeSheet();
        toast('기록장을 삭제했어요');
        refresh(true);
      } else if (act === 'leave') {
        if (!confirm('이 기록장에서 나갈까요?')) return;
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
