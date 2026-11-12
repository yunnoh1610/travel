// 브라우저 확인용 가짜 Supabase (메모리). 실제 서버·계정 없이 화면 흐름만 확인해요.
// 권한(RLS)·SQL 동작은 tests/db.test.mjs 에서 실제 PostgreSQL(PGlite)로 따로 확인해요.
// window.MOCK.failAI = true  → AI 호출 실패(502) 흉내
// window.MOCK.bumpRevision() → 다른 기기에서 일정을 고친 것처럼 버전 올리기
(() => {
  const ME = { id: 'u-a', email: 'minji@travel-diary.example.com', user_metadata: { name: '민지' } };
  const now = () => new Date().toISOString();
  const db = {
    profiles: [{ id: 'u-a', name: '민지', username: 'minji' }, { id: 'u-b', name: '서준', username: 'seojun' }],
    trips: [{ id: 1, title: '공주 1박2일', kind: 'trip', start_date: '2026-11-21', end_date: '2026-11-22', owner_id: 'u-a', created_at: now() },
      { id: 2, title: '작년 경주 여행', kind: 'trip', start_date: '2025-10-03', end_date: '2025-10-05', owner_id: 'u-a', created_at: now() }],
    trip_members: [{ trip_id: 1, user_id: 'u-a' }, { trip_id: 1, user_id: 'u-b' }, { trip_id: 2, user_id: 'u-a' }],
    places: [
      { id: 1, trip_id: 1, user_id: 'u-a', name: '공산성', lat: 36.4646, lng: 127.1265, visited_at: '2026-11-21', visited_time: '11:42:00', plan_item_id: 2, comment: '성곽길 산책', memo: null, category: 'sight', created_at: now() },
      { id: 2, trip_id: 1, user_id: 'u-b', name: '공주 산성시장', lat: 36.4560, lng: 127.1250, visited_at: '2026-11-21', visited_time: '13:05:00', plan_item_id: null, comment: '국밥 최고', memo: null, category: 'food', created_at: now() },
      { id: 3, trip_id: 1, user_id: 'u-a', name: '무령왕릉과 왕릉원', lat: 36.4610, lng: 127.1120, visited_at: '2026-11-22', comment: null, memo: null, category: 'sight', created_at: now() },
    ],
    photos: [
      { id: 1, place_id: 1, user_id: 'u-a', path: '1/a.jpg', thumb_path: '1/a_t.jpg' },
      { id: 2, place_id: 1, user_id: 'u-a', path: '1/b.jpg', thumb_path: '1/b_t.jpg' },
      { id: 3, place_id: 2, user_id: 'u-b', path: '1/c.jpg', thumb_path: '1/c_t.jpg' },
      { id: 4, place_id: 3, user_id: 'u-a', path: '1/d.jpg', thumb_path: '1/d_t.jpg' },
    ],
    place_comments: [],
    trip_plans: [],
    itinerary_items: [
      { id: 1, trip_id: 1, day_date: '2026-11-21', sort_order: 1, item_type: 'MOVE', title: '서울 → 공주 버스', start_time: '09:00:00', end_time: '10:30:00', place_id: null, place_name: null, address: null, lat: null, lng: null, verification_status: 'UNVERIFIED', cost_estimate: 11000, currency: 'KRW', notes: null, source: 'MANUAL', user_edited: false, created_by: 'u-a' },
      { id: 2, trip_id: 1, day_date: '2026-11-21', sort_order: 2, item_type: 'PLACE', title: '공산성 산책', start_time: '11:00:00', end_time: '12:30:00', place_id: null, place_name: '공산성', address: null, lat: 36.4646, lng: 127.1265, verification_status: 'VERIFIED', cost_estimate: 1200, currency: 'KRW', notes: null, source: 'AI', user_edited: false, created_by: 'u-a' },
      { id: 3, trip_id: 1, day_date: '2026-11-22', sort_order: 1, item_type: 'PLACE', title: '마곡사', start_time: '10:00:00', end_time: '12:00:00', place_id: null, place_name: '마곡사', address: null, lat: 36.55, lng: 127.0, verification_status: 'UNVERIFIED', cost_estimate: null, currency: 'KRW', notes: null, source: 'AI', user_edited: false, created_by: 'u-a' },
      { id: 4, trip_id: 2, day_date: '2025-10-03', sort_order: 1, item_type: 'PLACE', title: '불국사', start_time: '10:00:00', end_time: '12:00:00', place_id: null, place_name: '불국사', address: null, lat: 35.79, lng: 129.33, verification_status: 'VERIFIED', cost_estimate: 6000, currency: 'KRW', notes: null, source: 'AI', user_edited: false, created_by: 'u-a' },
      { id: 5, trip_id: 2, day_date: '2025-10-05', sort_order: 1, item_type: 'MEAL', title: '황리단길 점심', start_time: '12:00:00', end_time: null, place_id: null, place_name: '황리단길', address: null, lat: 35.83, lng: 129.21, verification_status: 'UNVERIFIED', cost_estimate: 15000, currency: 'KRW', notes: null, source: 'MANUAL', user_edited: false, created_by: 'u-a' },
    ],
    ai_drafts: [],
    trip_expenses: [],
    checklist_items: [],
    scrapbook_pages: [],
    scrapbook_elements: [],
    scrapbooks: [],
    place_favorites: [],
  };
  // DB 설정 010: 멤버 역할 (?no010 이면 그 전 DB). 여행 3은 내가 보기 전용
  db.trips.push({ id: 3, title: '서준의 제주 여행', kind: 'trip', start_date: '2026-12-01', end_date: '2026-12-03', owner_id: 'u-b', created_at: now() });
  db.trip_members.push({ trip_id: 3, user_id: 'u-b' }, { trip_id: 3, user_id: 'u-a' });
  db.places.push({ id: 5, trip_id: 3, user_id: 'u-b', name: '성산일출봉', lat: 33.458, lng: 126.942, visited_at: '2026-12-01', comment: '해 뜨는 거 봤다', memo: null, category: 'nature', created_at: now() });
  if (!/no010/.test(location.search)) {
    db.trip_members.forEach((m) => { m.role = db.trips.find((t) => t.id === m.trip_id)?.owner_id === m.user_id ? 'OWNER' : (m.trip_id === 3 ? 'VIEWER' : 'EDITOR'); });
  }
  // DB 설정 009: 기록 제목·감정·태그·즐겨찾기, 여러 스크랩북 (?no009 이면 그 전 DB)
  if (/no009/.test(location.search)) { delete db.scrapbooks; delete db.place_favorites; } else {
    Object.assign(db.places[0], { title: '성곽 위 첫 산책', mood: 'HAPPY', tags: ['산책', '역사'] });
    Object.assign(db.places[1], { mood: 'YUMMY', tags: ['맛집'], memo: '줄 서서 먹은 국밥. 다들 한 그릇씩 더 먹었다.' });
    db.places.push({ id: 4, trip_id: 1, user_id: 'u-a', name: '숙소', lat: null, lng: null, visited_at: '2026-11-21', visited_time: '21:00:00', plan_item_id: null, title: '비 오는 밤', comment: '창밖 빗소리', memo: null, mood: 'CALM', tags: ['휴식'], category: 'stay', created_at: now() });
    db.place_favorites.push({ user_id: 'u-a', place_id: 1 });
  }
  const seq = {};
  const nextId = (t) => { seq[t] = Math.max(seq[t] || 0, ...db[t].map((r) => (typeof r.id === 'number' ? r.id : 0))) + 1; return seq[t]; };
  const plan = (tid) => { let p = db.trip_plans.find((x) => x.trip_id === tid); if (!p) { p = { trip_id: tid, revision: 0, prefs: {} }; db.trip_plans.push(p); } return p; };
  const bump = (tid) => { plan(tid).revision++; };
  const err = (message, code = 'MOCK') => ({ data: null, error: { message, code } });
  // DB 설정 008: 일정 상태·동행자 (?no008 이면 그 전 DB)
  if (!/no008/.test(location.search)) db.itinerary_items.forEach((i) => { i.status = i.id === 2 ? 'DONE' : 'PLANNED'; i.assignees = null; });
  const ok = (data, extra = {}) => ({ data, error: null, ...extra });
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const tripOk = (tid, d) => { const t = db.trips.find((x) => x.id === tid); return t && d >= t.start_date && d <= (t.end_date || t.start_date); };

  // 가짜 사진 (경로마다 다른 색·비율)
  const imgCache = new Map();
  function fakeImage(path) {
    if (imgCache.has(path)) return imgCache.get(path);
    const h = [...path].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const portrait = h % 3 === 0;
    const c = document.createElement('canvas');
    c.width = portrait ? 300 : 400; c.height = portrait ? 400 : 300;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, c.width, c.height);
    grad.addColorStop(0, `hsl(${h % 360} 70% 70%)`); grad.addColorStop(1, `hsl(${(h * 7) % 360} 60% 45%)`);
    g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
    g.font = '90px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(['🏯', '🍜', '🌿', '📷', '🌸'][h % 5], c.width / 2, c.height / 2);
    const url = c.toDataURL('image/jpeg', 0.8);
    imgCache.set(path, url);
    return url;
  }

  // 테이블별로 app.js 가 기대하는 모양(관계 포함)으로
  function shape(t, r) {
    if (t === 'trip_list') {
      const ps = db.places.filter((p) => p.trip_id === r.id);
      const ph = db.photos.filter((x) => ps.some((p) => p.id === x.place_id)).sort((a, b) => a.id - b.id)[0];
      const chosen = r.cover_photo_id && db.photos.find((x) => x.id === r.cover_photo_id);
      return { ...r, place_count: ps.length, cover_path: chosen?.thumb_path || ph?.thumb_path || null };
    }
    if (t === 'trip_members') { const p = db.profiles.find((x) => x.id === r.user_id); return { ...r, profiles: { name: p?.name, username: p?.username } }; }
    if (t === 'places') {
      return { ...r, author: { name: db.profiles.find((x) => x.id === r.user_id)?.name }, trip: { title: db.trips.find((x) => x.id === r.trip_id)?.title },
        photos: db.photos.filter((x) => x.place_id === r.id).sort((a, b) => a.id - b.id), place_comments: [{ count: db.place_comments.filter((c) => c.place_id === r.id).length }] };
    }
    if (t === 'photos') return { ...r, places: { trip_id: db.places.find((p) => p.id === r.place_id)?.trip_id } };
    return r;
  }

  class QB {
    constructor(t) { this.t = t; this.op = 'select'; this.fs = []; this.ords = []; this.lim = null; this.ret = false; this.one = null; this.head = false; }
    select(c, o) { this.cols = c || ''; if (this.op === 'select') { this.head = !!o?.head; } else this.ret = true; return this; }
    eq(c, v) { this.fs.push((r) => (c.includes('.') ? r[c.split('.')[0]]?.[c.split('.')[1]] : r[c]) == v); return this; }
    neq(c, v) { this.fs.push((r) => r[c] != v); return this; }
    in(c, a) { this.fs.push((r) => a.includes(r[c])); return this; }
    gte(c, v) { this.fs.push((r) => r[c] >= v); return this; }
    not(c, _op, _v) { this.fs.push((r) => r[c] != null); return this; }
    order(c, o = {}) { if (!o.referencedTable) this.ords.push([c, o.ascending !== false]); return this; }
    limit(n) { this.lim = n; return this; }
    single() { this.one = 'single'; return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    insert(rows) { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
    update(v) { this.op = 'update'; this.vals = v; return this; }
    delete() { this.op = 'delete'; return this; }
    then(a, b) { return new Promise((r) => setTimeout(r, 120)).then(() => this.run()).then(a, b); }
    run() {
      const src = this.t === 'trip_list' ? 'trips' : this.t;
      const table = db[src];
      if (!table) return err(`Could not find the table 'public.${this.t}'`, 'PGRST205');
      // MOCK.no005 = true → migrate-005 전 DB 흉내 (새 칸이 없음)
      const new005 = /visited_time|plan_item_id|taken_at/;
      const new007 = /country|cities|party_type|cover_photo_id/;
      if (window.MOCK.no007 && src === 'trips' && (new007.test(this.cols || '') || (this.rows || []).some((r) => Object.keys(r).some((k) => new007.test(k))) || (this.vals && Object.keys(this.vals).some((k) => new007.test(k))))) {
        return err('column trips.country does not exist', '42703');
      }
      // 실제 Supabase 흉내: 009 의 즐겨찾기 표 때문에 places → profiles 연결이 두 갈래가 되어, 어느 연결인지 적지 않으면 실패 (PGRST201)
      if (src === 'places' && db.place_favorites && /(^|[\s,:])profiles\(/.test(this.cols || '')) {
        return err("Could not embed because more than one relationship was found for 'places' and 'profiles'", 'PGRST201');
      }
      const new009 = /(^|,\s*)title\b|\bmood\b|\btags\b/; // trips(title) 처럼 다른 표의 칸은 빼고
      if (window.MOCK.no009 && src === 'places' && (new009.test(this.cols || '') || (this.rows || []).some((r) => Object.keys(r).some((k) => new009.test(k))) || (this.vals && Object.keys(this.vals).some((k) => new009.test(k))))) {
        return err('column places.title does not exist', '42703');
      }
      if (window.MOCK.no010 && src === 'trip_members' && (/\brole\b/.test(this.cols || '') || (this.vals && 'role' in this.vals))) {
        return err('column trip_members.role does not exist', '42703');
      }
      if (window.MOCK.no011 && src === 'itinerary_items' && (/\btransit\b/.test(this.cols || '') || (this.rows || []).some((r) => 'transit' in r) || (this.vals && 'transit' in this.vals))) {
        return err('column itinerary_items.transit does not exist', '42703');
      }
      const new008 = /\bstatus\b|assignees/;
      if (window.MOCK.no008 && src === 'itinerary_items' && (new008.test(this.cols || '') || (this.rows || []).some((r) => Object.keys(r).some((k) => new008.test(k))) || (this.vals && Object.keys(this.vals).some((k) => new008.test(k))))) {
        return err('column itinerary_items.status does not exist', '42703');
      }
      if (window.MOCK.no005 && (new005.test(this.cols || '') || (this.rows || []).some((r) => Object.keys(r).some((k) => new005.test(k))) || (this.vals && Object.keys(this.vals).some((k) => new005.test(k))))) {
        return err('column places.visited_time does not exist', '42703');
      }
      const match = (r) => this.fs.every((f) => f(shape(this.t, r)));
      let out;
      if (this.op === 'insert') {
        out = [];
        for (const row of this.rows) {
          const r = { id: src === 'scrapbook_elements' ? row.id : nextId(src), created_at: now(), created_by: ME.id, ...row };
          if (src === 'itinerary_items') {
            if (!tripOk(r.trip_id, r.day_date)) return err('일정 날짜가 여행 기간 밖이에요 (여행 날짜를 먼저 정해 주세요)', 'PT400');
            Object.assign(r, { verification_status: 'UNVERIFIED', currency: 'KRW', source: 'MANUAL', user_edited: false, sort_order: 0, ...(window.MOCK.no008 ? {} : { status: 'PLANNED', assignees: null }), ...r });
            bump(r.trip_id);
          }
          if (src === 'trip_expenses' && r.amount < 0) return err('violates check constraint', '23514');
          if (src === 'checklist_items') r.checked ??= false;
          if (src === 'place_favorites') r.user_id ??= ME.id;
          if (src === 'scrapbook_pages' && db.scrapbooks && !r.scrapbook_id) {
            let b = db.scrapbooks.filter((x) => x.trip_id === r.trip_id).sort((a, c) => a.sort_order - c.sort_order || a.id - c.id)[0];
            if (!b) { b = { id: nextId('scrapbooks'), trip_id: r.trip_id, title: '기본 스크랩북', sort_order: 0, created_by: ME.id, created_at: now() }; db.scrapbooks.push(b); }
            r.scrapbook_id = b.id;
          }
          if (src === 'places' || src === 'photos') r.user_id ??= ME.id;
          if (src === 'scrapbook_pages') Object.assign(r, { revision: 0, template: 'BLANK', background: 'paper', ...r });
          if (src === 'trips') { db.trip_members.push({ trip_id: r.id, user_id: ME.id }); r.owner_id = ME.id; }
          table.push(r);
          out.push(r);
        }
      } else if (this.op === 'update') {
        out = table.filter(match);
        for (const r of out) {
          if (src === 'itinerary_items' && this.vals.day_date && !tripOk(r.trip_id, this.vals.day_date)) return err('일정 날짜가 여행 기간 밖이에요', 'PT400');
          Object.assign(r, this.vals);
          if (src === 'itinerary_items') bump(r.trip_id);
        }
      } else if (this.op === 'delete') {
        out = table.filter(match);
        db[src] = table.filter((r) => !out.includes(r));
        for (const r of out) {
          if (src === 'itinerary_items') bump(r.trip_id);
          if (src === 'scrapbook_pages') db.scrapbook_elements = db.scrapbook_elements.filter((e) => e.page_id !== r.id);
          if (src === 'scrapbooks') db.scrapbook_pages = db.scrapbook_pages.filter((x) => x.scrapbook_id !== r.id);
          if (src === 'trips') ['places', 'itinerary_items', 'scrapbook_pages', 'checklist_items', 'trip_expenses'].forEach((k) => { db[k] = db[k].filter((x) => x.trip_id !== r.id); });
        }
      } else {
        out = table.filter(match).map((r) => shape(this.t, r));
        for (const [c, asc] of [...this.ords].reverse()) out.sort((a, b) => (a[c] == null ? 1 : b[c] == null ? -1 : (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0)) * (asc ? 1 : -1));
        if (this.lim) out = out.slice(0, this.lim);
        if (this.head) return ok(null, { count: out.length });
      }
      out = clone(out);
      if (this.op !== 'select' && !this.ret) return ok(null);
      if (this.one === 'single') return out.length === 1 ? ok(out[0]) : err('JSON object requested, multiple (or no) rows returned', 'PGRST116');
      if (this.one === 'maybe') return ok(out[0] ?? null);
      return ok(out);
    }
  }

  // ---------- RPC (SQL 함수를 단순화해서 흉내) ----------
  const rpcs = {
    ping: () => 'ok',
    create_invite: ({ p_trip_id, p_role }) => [{ token: `tok-${p_trip_id}-${p_role || 'EDITOR'}`, expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), ...(window.MOCK.no010 ? {} : { role: p_role || 'VIEWER' }) }],
    add_member_by_username: ({ p_trip_id, p_username, p_role }) => {
      const p = db.profiles.find((x) => x.username === p_username);
      if (!p) throw { message: '그런 아이디를 가진 사람이 없어요' };
      if (!db.trip_members.some((m) => m.trip_id === p_trip_id && m.user_id === p.id)) db.trip_members.push({ trip_id: p_trip_id, user_id: p.id, ...(window.MOCK.no010 ? {} : { role: p_role || 'EDITOR' }) });
      return [{ id: p.id, name: p.name, username: p.username }];
    },
    save_plan_prefs: ({ p_trip_id, p_prefs }) => { plan(p_trip_id).prefs = p_prefs; return null; },
    reorder_itinerary: ({ p_trip_id, p_day, p_ids }) => {
      const day = db.itinerary_items.filter((i) => i.trip_id === p_trip_id && i.day_date === p_day);
      if (day.length !== p_ids.length) throw { message: '그 사이 일정이 바뀌었어요. 새로고침 후 다시 해 주세요', code: 'PT409' };
      p_ids.forEach((id, k) => { const it = day.find((x) => x.id === id); it.sort_order = k + 1; bump(p_trip_id); });
      return plan(p_trip_id).revision;
    },
    // DB 설정 012: 순서·시간 한 번에 (?no012 이면 없음 → 앱은 예전 방식으로). MOCK.failReorder = true 면 저장 실패 흉내
    reorder_itinerary_times: ({ p_trip_id, p_day, p_ids, p_starts, p_ends }) => {
      if (window.MOCK.failReorder) throw { message: '네트워크 오류 (흉내)', code: 'MOCK' };
      const day = db.itinerary_items.filter((i) => i.trip_id === p_trip_id && i.day_date === p_day);
      if (day.length !== p_ids.length || p_ids.some((id) => !day.some((x) => x.id === id))) throw { message: '그 사이 일정이 바뀌었어요. 새로고침 후 다시 해 주세요', code: 'PT409' };
      p_ids.forEach((id, k) => {
        const it = day.find((x) => x.id === id);
        it.sort_order = k + 1;
        if (p_starts) {
          const s = `${p_starts[k]}:00`;
          const e = `${p_ends[k]}:00`;
          if (s !== it.start_time || e !== it.end_time) it.user_edited = true;
          it.start_time = s; it.end_time = e;
        }
      });
      bump(p_trip_id);
      return plan(p_trip_id).revision;
    },
    discard_ai_draft: ({ p_draft_id }) => { const d = db.ai_drafts.find((x) => x.id === p_draft_id); if (d?.status === 'DRAFT') d.status = 'DISCARDED'; return null; },
    apply_ai_draft: ({ p_draft_id, p_accepted, p_expected_revision }) => {
      const d = db.ai_drafts.find((x) => x.id === p_draft_id);
      if (!d) throw { message: '이 초안을 적용할 수 없어요', code: 'PT403' };
      if (d.status === 'APPLIED') throw { message: '이미 적용한 초안이에요', code: 'PT409' };
      const p = plan(d.trip_id);
      if (p.revision !== d.base_revision || p.revision !== p_expected_revision) throw { message: '초안을 만든 뒤 다른 곳에서 일정이 바뀌었어요. 새로고침 후 다시 만들어 주세요', code: 'PT409' };
      const ins = (it) => {
        const max = db.itinerary_items.filter((x) => x.trip_id === d.trip_id && x.day_date === it.date).reduce((m, x) => Math.max(m, x.sort_order), 0);
        db.itinerary_items.push({ id: nextId('itinerary_items'), trip_id: d.trip_id, day_date: it.date, sort_order: max + 1, item_type: it.type, title: it.title,
          start_time: it.startTime ? `${it.startTime}:00` : null, end_time: it.endTime ? `${it.endTime}:00` : null, place_id: null, place_name: it.placeName, address: it.address,
          lat: it.lat, lng: it.lng, verification_status: it.verificationStatus, cost_estimate: it.estimatedCost, currency: it.currency, notes: it.notes, source: 'AI', user_edited: false, created_by: ME.id, ...(window.MOCK.no008 ? {} : { status: 'PLANNED', assignees: null }), ...(window.MOCK.no011 ? {} : { transit: it.transit || null }) });
        bump(d.trip_id);
      };
      let n = [0, 0, 0];
      if (d.kind === 'GENERATE') {
        d.result_json.days.flatMap((x) => x.items).filter((it) => p_accepted.includes(it.temporaryId)).forEach((it) => { ins(it); n[0]++; });
      } else {
        for (const o of d.result_json.operations.filter((x) => p_accepted.includes(x.opId))) {
          const row = db.itinerary_items.find((x) => x.id === o.itemId);
          if (o.op === 'add') { ins(o.item); n[0]++; } else if (!row) throw { message: '고치려는 일정이 이미 없어요', code: 'PT409' };
          else if (o.op === 'delete') { db.itinerary_items = db.itinerary_items.filter((x) => x !== row); bump(d.trip_id); n[2]++; } else {
            Object.assign(row, { day_date: o.item.date, item_type: o.item.type, title: o.item.title, start_time: o.item.startTime ? `${o.item.startTime}:00` : null,
              end_time: o.item.endTime ? `${o.item.endTime}:00` : null, place_name: o.item.placeName, lat: o.item.lat, lng: o.item.lng, verification_status: o.item.verificationStatus,
              cost_estimate: o.item.estimatedCost, notes: o.item.notes });
            bump(d.trip_id); n[1]++;
          }
        }
      }
      // 시간순 다시 번호
      const days = new Set(db.itinerary_items.filter((x) => x.trip_id === d.trip_id).map((x) => x.day_date));
      for (const day of days) {
        db.itinerary_items.filter((x) => x.trip_id === d.trip_id && x.day_date === day)
          .sort((a, b) => (a.start_time || '99') .localeCompare(b.start_time || '99') || a.sort_order - b.sort_order)
          .forEach((x, k) => { x.sort_order = k + 1; });
      }
      d.status = 'APPLIED';
      return [{ revision: p.revision, inserted: n[0], updated: n[1], deleted: n[2] }];
    },
    save_scrapbook_page: ({ p_page_id, p_expected_revision, p_elements }) => {
      const pg = db.scrapbook_pages.find((x) => x.id === p_page_id);
      if (pg.revision !== p_expected_revision) throw { message: '다른 사람이 먼저 이 페이지를 고쳤어요. 다시 열어서 고쳐 주세요', code: 'PT409' };
      const old = db.scrapbook_elements.filter((e) => e.page_id === p_page_id).map((e) => e.asset_path).filter(Boolean);
      db.scrapbook_elements = db.scrapbook_elements.filter((e) => e.page_id !== p_page_id);
      for (const e of p_elements) {
        db.scrapbook_elements.push({ id: e.id, page_id: p_page_id, trip_id: pg.trip_id, type: e.type, x: e.x, y: e.y, width: e.width, height: e.height,
          rotation: e.rotation, z_index: e.zIndex, photo_id: e.photoId, asset_path: e.assetPath, content: e.content });
      }
      pg.revision++;
      return [{ revision: pg.revision, orphan_paths: old.filter((p) => !db.scrapbook_elements.some((e) => e.asset_path === p)) }];
    },
    reorder_scrapbook_pages: ({ p_ids }) => { p_ids.forEach((id, k) => { db.scrapbook_pages.find((x) => x.id === id).page_order = k + 1; }); return null; },
    my_storage_paths: () => [],
  };

  // ---------- AI (Edge Function) 흉내 ----------
  function aiGenerate(body) {
    const t = db.trips.find((x) => x.id === body.tripId);
    const it = (tmp, date, type, title, s, e, pq, ver, cost, notes, ll) => ({ temporaryId: tmp, date, type, title, startTime: s, endTime: e, placeQuery: pq,
      placeName: pq, address: ver ? '충남 공주시' : null, lat: ver ? ll[0] : null, lng: ver ? ll[1] : null, matchedPlaceId: ver ? 'kakao:1' : null,
      verificationStatus: ver ? 'VERIFIED' : 'UNVERIFIED', estimatedCost: cost, currency: 'KRW', notes, reason: ver ? '동선이 가깝고 평이 좋아요' : '',
      transit: type === 'REST' ? null : type === 'MEAL' ? { mode: 'WALK', minutes: 10, detail: '성곽길 따라 내려가서' } : { mode: 'BUS', minutes: 20, detail: '공주종합버스터미널에서 시내버스' } });
    const days = [
      { date: t.start_date, items: [
        it('tmp-1', t.start_date, 'PLACE', '공산성 성곽길 산책', '11:00', '12:30', '공산성', true, 1200, '성곽 위 전망 좋음', [36.4646, 127.1265]),
        it('tmp-2', t.start_date, 'MEAL', '산성시장 국밥', '12:40', '13:30', '공주 산성시장', true, 9000, null, [36.456, 127.125]),
        it('tmp-3', t.start_date, 'CAFE', '한옥 카페 "달빛정원"', '14:00', '15:30', '달빛정원 카페', false, 7000, '실존 여부 확인 필요', null),
      ] },
      { date: t.end_date, items: [
        it('tmp-4', t.end_date, 'PLACE', '무령왕릉과 왕릉원', '10:00', '11:30', '무령왕릉과 왕릉원', true, 1500, null, [36.461, 127.112]),
        it('tmp-5', t.end_date, 'REST', '숙소에서 휴식', '15:00', '16:00', null, false, null, null, null),
      ] },
    ];
    const id = `draft-${Date.now()}`;
    db.ai_drafts.push({ id, trip_id: t.id, kind: 'GENERATE', status: 'DRAFT', base_revision: plan(t.id).revision, result_json: { days } });
    return { draftId: id, status: 'DRAFT', baseRevision: plan(t.id).revision, days, warnings: ['장소 1곳은 실제 장소를 찾지 못했어요', '운영시간·요금·이동 소요시간은 AI 추정이에요. 방문 전에 꼭 확인해 주세요'], model: 'mock' };
  }
  function aiAdd(body) {
    if (body.baseRevision !== plan(body.tripId).revision) return { error: { code: 'REVISION_CONFLICT', message: '그 사이 일정이 바뀌었어요. 새로고침 후 다시 요청해 주세요' }, status: 409 };
    const mk = (opId, title, s, e, ver, ll, reason) => ({ opId, op: 'add', itemId: null, reason, before: null,
      item: { date: body.targetDay, type: 'CAFE', title, startTime: s, endTime: e, placeQuery: title, placeName: title, address: null,
        lat: ver ? ll[0] : null, lng: ver ? ll[1] : null, verificationStatus: ver ? 'VERIFIED' : 'UNVERIFIED', estimatedCost: 6500, currency: 'KRW', notes: null, matchedPlaceId: null } });
    // 서버가 예전 버전이면 수정·삭제 제안도 올 수 있어서 하나 섞어 둠 (앱이 걸러야 함)
    const ops = [mk('op-1', '금강 뷰 카페', '16:00', '17:00', true, [36.466, 127.127], '공산성 바로 옆'),
      mk('op-2', '루프탑 카페', '12:00', '13:00', false, null, '점심 뒤'),
      { opId: 'op-3', op: 'delete', itemId: 1, reason: 'x', before: null, item: null }];
    const id = `draft-${Date.now()}`;
    db.ai_drafts.push({ id, trip_id: body.tripId, kind: 'REVISE', status: 'DRAFT', base_revision: plan(body.tripId).revision, result_json: { operations: ops } });
    return { draftId: id, status: 'DRAFT', baseRevision: plan(body.tripId).revision, operations: ops, warnings: [] };
  }
  function aiRevise(body) {
    if (body.mode === 'ADD') return aiAdd(body);
    if (body.baseRevision !== plan(body.tripId).revision) return { error: { code: 'REVISION_CONFLICT', message: '그 사이 일정이 바뀌었어요. 새로고침 후 다시 요청해 주세요' }, status: 409 };
    const items = db.itinerary_items.filter((x) => x.trip_id === body.tripId && (!body.targetDay || x.day_date === body.targetDay));
    const toItem = (r) => ({ date: r.day_date, type: r.item_type, title: r.title, startTime: r.start_time?.slice(0, 5) || null, endTime: r.end_time?.slice(0, 5) || null,
      placeQuery: r.place_name, placeName: r.place_name, address: r.address, lat: r.lat, lng: r.lng, verificationStatus: r.verification_status, estimatedCost: r.cost_estimate,
      currency: r.currency, notes: r.notes, matchedPlaceId: null });
    const ops = [];
    const first = items.find((x) => x.start_time);
    if (first) {
      const b = { ...toItem(first), userEdited: first.source === 'MANUAL' || first.user_edited };
      ops.push({ opId: 'op-1', op: 'update', itemId: first.id, reason: '오전을 여유롭게', before: b, item: { ...toItem(first), startTime: '10:00', endTime: first.end_time ? '11:30' : null } });
    }
    const last = items.at(-1);
    if (last && last !== first) ops.push({ opId: 'op-2', op: 'delete', itemId: last.id, reason: '일정이 빡빡해서', before: { ...toItem(last), userEdited: false }, item: null });
    ops.push({ opId: 'op-3', op: 'add', itemId: null, reason: '쉬어 가기', before: null, item: { date: body.targetDay || items[0]?.day_date || '2026-11-21', type: 'CAFE', title: '금강 뷰 카페', startTime: '15:30', endTime: '16:30', placeQuery: '금강 카페', placeName: '금강 카페', address: null, lat: null, lng: null, verificationStatus: 'UNVERIFIED', estimatedCost: 6000, currency: 'KRW', notes: null, matchedPlaceId: null } });
    const id = `draft-${Date.now()}`;
    db.ai_drafts.push({ id, trip_id: body.tripId, kind: 'REVISE', status: 'DRAFT', base_revision: plan(body.tripId).revision, result_json: { operations: ops } });
    return { draftId: id, status: 'DRAFT', baseRevision: plan(body.tripId).revision, operations: ops, warnings: ops.some((o) => o.before?.userEdited) ? ['직접 고친 일정도 바꾸자는 제안이 있어요. 적용 전에 확인해 주세요'] : [] };
  }

  const files = new Map();
  const client = {
    from: (t) => new QB(t),
    async rpc(name, args) {
      await new Promise((r) => setTimeout(r, 150));
      if (!rpcs[name] || (name === 'reorder_itinerary_times' && /no012/.test(location.search))) return err(`Could not find the function public.${name}`, 'PGRST202');
      try { return ok(clone(rpcs[name](args) ?? null)); } catch (e) { return err(e.message, e.code); }
    },
    functions: {
      async invoke(name, { body }) {
        await new Promise((r) => setTimeout(r, 1200));
        const fail = (status, payload) => ({ data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { name: 'FunctionsHttpError', context: { status, json: async () => payload } }) });
        if (window.MOCK.failAI) return fail(502, { error: { code: 'AI_UNAVAILABLE', message: 'AI가 응답하지 못했어요. 잠시 후 다시 시도해 주세요', requestId: 'req-mock-1' } });
        if (body.action === 'diary') {
          const f = body.facts || {};
          if (!f.comment && !f.memo && !f.tags?.length && !f.mood) return fail(400, { error: { code: 'VALIDATION_ERROR', message: '한줄 코멘트·이야기·기분·태그 중 하나는 적어 주세요' } });
          const short = body.tone === 'SHORT';
          const story = [`${f.date || '그날'} ${f.place || ''}에 갔다.`, f.comment ? `${f.comment}.` : '', f.memo || '', f.mood ? `기분은 ${f.mood}.` : '', short ? '' : '다음에 또 오고 싶다.'].filter(Boolean).join(' ');
          return { data: { title: f.title || `${f.place} 이야기`, story, warnings: ['AI가 정리한 글이에요. 사실과 다른 부분이 없는지 확인해 주세요'], model: 'mock', requestId: 'req-mock' }, error: null };
        }
        const res = body.action === 'generate' ? aiGenerate(body) : aiRevise(body);
        if (res.error) return fail(res.status, { error: { ...res.error, requestId: 'req-mock-2' } });
        return { data: { ...res, requestId: 'req-mock' }, error: null };
      },
    },
    storage: {
      from: () => ({
        async createSignedUrls(paths) { return ok(paths.map((p) => ({ path: p, signedUrl: files.get(p) || fakeImage(p) }))); },
        async upload(path, blob) { files.set(path, URL.createObjectURL(blob)); return ok({ path }); },
        async remove(paths) { window.MOCK.removed.push(...paths); return ok(paths); },
      }),
    },
    auth: {
      async getSession() { return { data: { session: { user: ME } }, error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      async signOut() { return { error: null }; },
      async updateUser() { return { data: {}, error: null }; },
      async signInWithPassword() { return { data: { session: { user: ME } }, error: null }; },
    },
  };
  window.MOCK = { db, failAI: false, no005: /no005/.test(location.search), no007: /no007/.test(location.search), no008: /no008/.test(location.search), no009: /no009/.test(location.search), no010: /no010/.test(location.search), no011: /no011/.test(location.search), removed: [], bumpRevision(tid = 1) { bump(tid); } };
  window.supabase = { createClient: () => client };
  window.TRAVEL_CONFIG = { url: 'https://mock.local', key: 'mock' };
})();
