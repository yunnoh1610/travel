'use strict';
// =====================================================================
// 일정 탭: 일자별 일정 편집 · AI 일정 만들기/수정 제안 · 예산 · 준비물
// app.js 의 도우미($, esc, sb, state, openSheet, toast, geocode, ic …)를 그대로 써요.
// 데이터는 Supabase 테이블(itinerary_items 등, migrate-004)과 Edge Function(ai-planner)에 있어요.
// =====================================================================
(() => {
  const ITYPES = {
    PLACE: ['📍', '관광'], MEAL: ['🍜', '식사'], CAFE: ['☕', '카페'], MOVE: ['🚌', '이동'],
    STAY: ['🏨', '숙소'], REST: ['🛋️', '휴식'], ETC: ['✨', '기타'],
  };
  const PLACE_TYPES = ['PLACE', 'MEAL', 'CAFE', 'STAY'];
  const TRANSPORTS = { PUBLIC_TRANSIT: '대중교통', CAR: '자동차', WALK: '도보', TAXI: '택시', BIKE: '자전거', MIXED: '섞어서' };
  const STYLES = {
    FOOD: '맛집', CAFE: '카페', PHOTO: '사진', NATURE: '자연', HISTORY: '역사·문화', SHOPPING: '쇼핑',
    ACTIVITY: '액티비티', RELAX: '여유롭게', NIGHT: '야경·밤', KIDS: '아이와 함께',
  };
  const EXP_CATS = { TRANSPORT: ['🚌', '교통'], STAY: ['🏨', '숙박'], FOOD: ['🍜', '식비'], SIGHT: ['🎫', '관광·입장'], SHOPPING: ['🛍️', '쇼핑'], ETC: ['✨', '기타'] };
  const TYPE_TO_CAT = { PLACE: 'SIGHT', MEAL: 'FOOD', CAFE: 'FOOD', MOVE: 'TRANSPORT', STAY: 'STAY', REST: 'ETC', ETC: 'ETC' };
  const DEFAULT_CHECKLIST = ['신분증·여권', '휴대폰 충전기', '보조배터리', '지갑·카드', '상비약', '세면도구', '갈아입을 옷', '우산'];

  const P = {
    tripId: null, loadedFor: null, loading: false, error: null,
    tab: 'days', day: null, revision: 0, prefs: {},
    items: [], expenses: [], checklist: [], perPerson: false,
    sel: null, // 일정 여러 개 고르기 (Set) — null 이면 고르기 아님
  };
  let dayMap = null;

  // ---------- 도우미 ----------
  const el = () => $('#planner');
  const trip = () => state.trips.find((t) => t.id === P.tripId);
  const isOwner = () => trip()?.owner_id === state.me?.id;
  const typeIcon = (t) => ic((ITYPES[t] || ITYPES.ETC)[0]);
  const typeLabel = (t) => (ITYPES[t] || ITYPES.ETC)[1];
  const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
  const short = (ymd) => { const [, m, d] = ymd.split('-').map(Number); return `${m}/${d}`; };
  const wday = (ymd) => '일월화수목금토'[new Date(`${ymd}T00:00:00`).getDay()];
  function tripDays(t) {
    if (!t?.start_date) return [];
    const out = [];
    const d = new Date(`${t.start_date}T00:00:00Z`);
    const end = new Date(`${(t.end_date || t.start_date)}T00:00:00Z`);
    while (d <= end && out.length < 60) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
    return out;
  }
  function money(n, cur = 'KRW') {
    if (n == null || n === '') return '';
    const v = Number(n);
    if (cur === 'KRW') return `${Math.round(v).toLocaleString('ko-KR')}원`;
    try { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: cur }).format(v); } catch { return `${cur} ${v}`; }
  }
  const listInput = (s) => String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 10);

  // Supabase 결과 → 데이터. 오류는 코드(PT409 등)를 살린 채 한국어 메시지로
  async function pq(promise) {
    let res;
    try { res = await promise; } catch (e) { throw Object.assign(new Error(korean(e)), { code: 'NETWORK' }); }
    if (res.error) {
      const e = res.error;
      const missing = e.code === 'PGRST205' || e.code === '42P01' || e.code === 'PGRST202' || /Could not find the (table|function)/i.test(e.message || '');
      throw Object.assign(new Error(missing ? 'NEEDS_MIGRATION' : korean(e)), { code: missing ? 'NEEDS_MIGRATION' : e.code });
    }
    return res.data;
  }
  const changed = async (promise) => {
    const rows = await pq(promise);
    if (!rows?.length) throw new Error('권한이 없거나 이미 지워진 항목이에요');
    return rows;
  };

  // ---------- 불러오기 ----------
  async function loadTrip(id) {
    P.tripId = id;
    const [plan, items, expenses, checklist] = await Promise.all([
        pq(sb.from('trip_plans').select('revision, prefs').eq('trip_id', id).maybeSingle()),
        pq(sb.from('itinerary_items').select('*').eq('trip_id', id).order('day_date').order('sort_order').order('id')),
        pq(sb.from('trip_expenses').select('*').eq('trip_id', id).order('id')),
        pq(sb.from('checklist_items').select('*').eq('trip_id', id).order('sort_order').order('id')),
    ]);
    if (P.tripId !== id) return; // 그 사이 다른 여행을 고름
    Object.assign(P, { revision: plan?.revision ?? 0, prefs: plan?.prefs || {}, items, expenses, checklist, loadedFor: id, error: null });
    const days = tripDays(trip());
    if (!days.includes(P.day)) P.day = days.includes(today()) ? today() : days[0] || null;
  }
  async function load(force = false) {
    const id = state.filter === 'all' ? null : state.filter;
    P.tripId = id;
    if (!id) { render(); return; }
    if (!force && P.loadedFor === id) { render(); return; }
    P.loading = true;
    P.error = null;
    render();
    try { await loadTrip(id); } catch (err) {
      P.error = err;
      P.loadedFor = null;
    } finally {
      P.loading = false;
    }
    render();
  }
  // 일정을 바꾼 뒤: 이 화면과 여행 타임라인을 함께 새로 (같은 일정 데이터)
  async function reload() {
    if (P.tripId) {
      try { await loadTrip(P.tripId); } catch (err) { P.error = err; P.loadedFor = null; }
    }
    render();
    window.refreshPlans?.();
  }

  // ---------- 그리기 ----------
  function render() {
    const root = el();
    if (!root || state.view !== 'timeline') return;
    dayMap?.remove();
    dayMap = null;
    // 타임라인 탭: 고른 여행이 없으면 여행 고르기, 있으면 그 여행의 일정·예산·준비물
    if (!P.tripId) { root.innerHTML = pickTripHtml('일정을'); return; }
    const t = trip();
    if (!t) { root.innerHTML = '<div class="empty">여행을 찾을 수 없어요</div>'; return; }
    const head = `<div class="plan-top">
        <div class="plan-title">
          <h2>${kindIcon(t.kind)} ${esc(t.title)}</h2>
          <small>${typeof statusBadge === 'function' ? statusBadge(t) : ''} ${fmtRange(t.start_date, t.end_date)} · ${t.members.length}명</small>
        </div>
        <button type="button" class="icon-btn ghost" data-act="members" aria-label="멤버·초대">👥</button>
        <button type="button" class="icon-btn ghost" data-act="more" aria-label="더보기" aria-haspopup="dialog">⋯</button>
      </div>
      <div class="seg plan-seg" role="tablist">
        ${[['days', '일정'], ['budget', '예산'], ['check', '준비물']].map(([k, label]) =>
          `<button type="button" role="tab" aria-selected="${P.tab === k}" class="${P.tab === k ? 'on' : ''}" data-tab="${k}">${label}</button>`).join('')}
      </div>
      ${navigator.onLine ? '' : '<div class="notice warn">오프라인이에요. 연결되면 다시 불러와 주세요.</div>'}
      ${typeof roBanner === 'function' ? roBanner(t) : ''}`;
    if (P.loading) { root.innerHTML = `${head}<div class="empty"><div class="spinner"></div>불러오는 중…</div>`; return; }
    if (P.error) { root.innerHTML = head + errorHtml(P.error); return; }
    let body = '';
    if (P.tab === 'days') body = daysHtml(t);
    else if (P.tab === 'budget') body = budgetHtml(t);
    else body = checklistHtml();
    const selBar = P.tab === 'days' && P.sel ? bulkBarHtml(P.sel.size, dayItems(P.day).length, '일정') : '';
    root.innerHTML = head + body + selBar;
    setSelecting(!!selBar);
    if (P.tab === 'days') drawDayMap();
  }

  function pickTripHtml(what) {
    if (!state.trips.length) {
      return `<div class="empty"><div class="big">${ic('📒')}</div>먼저 여행을 만들어 주세요<br>
        <button class="chip-btn" data-act="new-trip" style="margin-top:12px">＋ 새 여행</button></div>`;
    }
    if (typeof tripPickerHtml === 'function') return tripPickerHtml(state.view);
    return `<h2>${what} 볼 여행을 골라 주세요</h2>
      <p class="muted" style="margin-top:-6px">위쪽 선택 칸에서 골라도 돼요.</p>
      ${state.trips.map((t) => `<button class="card trip-card" data-pick-trip="${t.id}">
        <div class="thumb">${kindIcon(t.kind)}</div>
        <div class="body"><b>${esc(t.title)}</b><small>📅 ${fmtRange(t.start_date, t.end_date)}</small></div></button>`).join('')}`;
  }
  window.PlannerShared = { pickTripHtml, tripDays, pq, money, hhmm, short, wday, STYLES, TRANSPORTS };

  function errorHtml(err) {
    if (err.code === 'NEEDS_MIGRATION') {
      return `<div class="notice warn"><b>새 기능을 쓰려면 DB 설정이 하나 더 필요해요.</b><br>
        Supabase SQL Editor에서 <code>supabase/migrate-004-planner-scrapbook.sql</code>을 실행해 주세요.</div>`;
    }
    return `<div class="notice error">${esc(err.message)}<br><button class="btn" data-act="reload" style="margin-top:8px">다시 불러오기</button></div>`;
  }

  // ----- 일자별 일정 -----
  const dayItems = (d) => P.items.filter((i) => i.day_date === d).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

  // ---------- 일정 사이 이동 방법 (DB 설정 011) ----------
  const TRANSIT = {
    WALK: ['🚶', '걸어서'], BUS: ['🚌', '버스'], SUBWAY: ['🚇', '지하철'], TRAIN: ['🚆', '기차'], TAXI: ['🚕', '택시'],
    CAR: ['🚗', '자동차'], BIKE: ['🚲', '자전거'], FERRY: ['⛴️', '배'], FLIGHT: ['✈️', '비행기'],
  };
  const transitText = (t) => (t && TRANSIT[t.mode]
    ? `${TRANSIT[t.mode][0]} ${TRANSIT[t.mode][1]}${t.minutes ? ` 약 ${t.minutes}분` : ''}${t.detail ? ` · ${esc(t.detail)}` : ''}` : '');
  const kmText = (m) => (m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`);
  /** 일정 사이 줄: 이동 방법(AI 추정 또는 직접 적은 것) + 앞 장소와의 직선거리 */
  function moveRow(prev, it) {
    const dist = prev && prev.lat != null && it.lat != null ? distM(prev, it) : null;
    if (!it.transit && dist == null) return '';
    const ai = it.transit && it.source === 'AI' && !it.user_edited;
    return `<li class="pi-move" aria-label="이동">
      ${it.transit ? `<span>${transitText(it.transit)}</span>${ai ? '<small class="muted">AI 추정</small>' : ''}` : '<span class="muted">이동 방법 미정</span>'}
      ${dist != null && dist > 30 ? `<small class="muted">📏 직선 ${kmText(dist)}</small>` : ''}
    </li>`;
  }
  function planListHtml(list) {
    let prev = null;
    return list.map((it, idx) => {
      const row = (idx > 0 || it.transit) && planSt(it) !== 'CANCELLED' ? moveRow(prev, it) : '';
      if (planSt(it) !== 'CANCELLED') prev = it;
      return row + itemHtml(it, idx, list.length);
    }).join('');
  }

  // ---------- 미확인 장소 다시 찾기 ----------
  // AI 서버의 장소 확인은 서버용 카카오 키가 없으면 OpenStreetMap 만 써서 한국 장소를 잘 못 찾아요.
  // 앱에 있는 카카오 지도 검색(geocode)으로 이름이 맞고 여행지 근처(100km 안)인 장소를 찾으면 '장소 확인'으로 바꿔요.
  const vCache = new Map();
  let verifying = false;
  const unverifiedItems = () => P.items.filter((i) => PLACE_TYPES.includes(i.item_type) && i.place_name
    && i.verification_status === 'UNVERIFIED' && planSt(i) !== 'CANCELLED');
  function tripCenter() {
    const pts = [...P.items.filter((i) => i.lat != null && i.verification_status === 'VERIFIED'),
      ...state.places.filter((p) => p.trip_id === P.tripId && p.lat != null)];
    if (!pts.length) return null;
    return { lat: pts.reduce((a, x) => a + x.lat, 0) / pts.length, lng: pts.reduce((a, x) => a + x.lng, 0) / pts.length };
  }
  async function findPlace(q, center) {
    if (vCache.has(q)) return vCache.get(q);
    const nq = normName(q);
    const ok = (r) => {
      const n = normName(r.name);
      return n.length >= 2 && nq.length >= 2 && (n.includes(nq) || nq.includes(n)) && (!center || distM(center, r) < 100000);
    };
    const dest = String(P.prefs.destination || '').trim();
    let hit = null;
    for (const query of [q, dest && !q.includes(dest) ? `${dest} ${q}` : null].filter(Boolean)) {
      let list = [];
      try { list = await geocode(query); } catch { /* 다음 방법으로 */ }
      hit = list.find(ok) || null;
      if (hit) break;
      await sleep(1100); // OpenStreetMap 은 1초에 1번
    }
    vCache.set(q, hit);
    return hit;
  }
  function verifyHint() {
    const n = unverifiedItems().length;
    if (!n || !canEdit(P.tripId)) return '';
    return `<div class="verify-hint">⚠ 미확인 장소 ${n}곳 ${verifying ? '<span class="muted">· 지도에서 찾는 중…</span>'
      : '<button type="button" class="chip-btn" data-act="verify-places">🔍 지도에서 다시 찾기</button>'}</div>`;
  }
  async function verifyPlaces(silent) {
    const list = unverifiedItems();
    if (verifying || !list.length || !canEdit(P.tripId)) { if (!silent && !list.length) toast('미확인 장소가 없어요'); return; }
    verifying = true;
    render();
    const center = tripCenter();
    let n = 0;
    try {
      for (const it of list) {
        const hit = await findPlace(it.place_name, center);
        if (!hit) continue;
        try {
          await changed(sb.from('itinerary_items').update({
            place_name: String(hit.name).slice(0, 80), address: hit.address ? String(hit.address).slice(0, 200) : null,
            lat: hit.lat, lng: hit.lng, verification_status: 'VERIFIED',
          }).eq('id', it.id).select('id'));
          n++;
        } catch { /* 다음 일정 */ }
      }
    } finally { verifying = false; }
    await reload();
    if (n) toast(`미확인 장소 ${n}곳을 지도에서 찾아 확인했어요${list.length > n ? ` · ${list.length - n}곳은 못 찾았어요` : ''}`);
    else if (!silent) toast('지도 검색으로도 찾지 못했어요. 일정을 눌러 장소를 직접 검색해 주세요');
  }

  function daysHtml(t) {
    const days = tripDays(t);
    if (!days.length) {
      return `<div class="empty"><div class="big">🗓️</div>여행 날짜가 정해지지 않았어요<br>
        <small>날짜를 정하면 일자별 일정을 만들 수 있어요</small><br>
        <button class="chip-btn" data-act="edit-trip" style="margin-top:12px">📅 날짜 정하기</button></div>`;
    }
    const list = dayItems(P.day);
    // 일정이 하나도 없는데 이미 다녀온 여행이면: 기록장 안내
    const st = typeof tripStatus === 'function' ? tripStatus(t)?.key : null;
    const noPlanNote = !P.items.length && st && st !== 'plan'
      ? `<div class="notice">📒 이 여행은 계획 없이 다녀왔어요. 다녀온 기록은 <b>기록장</b>에 있어요.
          <div class="btn-row" style="margin-top:8px"><button type="button" class="btn" data-act="goto-journal">📒 기록장 보기</button></div>
          <small class="hint">지금이라도 일정을 남기고 싶으면 아래 ＋ 일정 추가를 눌러요.</small></div>` : '';
    const unknownCost = list.filter((i) => PLACE_TYPES.includes(i.item_type) && i.cost_estimate == null && planSt(i) !== 'CANCELLED').length;
    // 일정 추가(주 동작) + AI 일정 도우미(만들기·추가·수정 요청을 한곳에)
    const actions = `<div class="plan-actions">
        <button type="button" class="btn-main" data-act="add-item">＋ 일정 추가</button>
        <button type="button" class="btn-sub" data-act="ai-helper">✨ AI 일정 도우미</button>
      </div>`;
    return `${noPlanNote}
      <div class="day-chips" role="tablist" aria-label="날짜">
        ${days.map((d, i) => `<button type="button" role="tab" aria-selected="${d === P.day}" class="day-chip ${d === P.day ? 'on' : ''}" data-day="${d}" aria-label="${i + 1}일차 ${fmtDate(d)}">
          <b>${i + 1}일차</b><small>${short(d)} ${wday(d)}</small>${P.items.some((x) => x.day_date === d) ? '<i class="dot" aria-hidden="true"></i>' : ''}</button>`).join('')}
      </div>
      <div class="day-head"><h3>${fmtDate(P.day)}</h3>${list.length ? `<small>일정 ${list.length}개</small>
        ${canEdit(P.tripId) ? `<button type="button" class="chip-btn" data-act="${P.sel ? 'sel-off' : 'sel-on'}">${P.sel ? '선택 끝' : '☑ 선택'}</button>` : ''}` : ''}</div>
      ${list.length ? `${actions}
        ${list.some((i) => i.lat != null) ? '<div id="planMap" class="mini-map plan-map" aria-label="이날 일정 지도"></div>' : ''}
        <ol class="plan-list">${planListHtml(list)}</ol>
        ${unknownCost ? `<small class="hint">💡 예상 비용이 없는 일정 ${unknownCost}개는 예산 합계에서 빠져요 (금액 미확인).</small>` : ''}
        ${verifyHint()}`
      : `<div class="day-empty">
          <p>이날 일정이 아직 없어요</p>
          ${actions}
        </div>`}`;
  }

  function vBadge(it) {
    if (!PLACE_TYPES.includes(it.item_type) && !it.place_name) return '';
    if (it.verification_status === 'VERIFIED') return '<span class="vbadge ok" title="지도 검색에서 실제 장소를 찾았어요 (영업시간·요금은 확인 안 됨)">✓ 장소 확인</span>';
    if (it.verification_status === 'MANUAL') return '<span class="vbadge" title="직접 입력한 장소">직접 입력</span>';
    return '<span class="vbadge warn" title="실제 장소와 맞춰 보지 못했어요. 방문 전에 확인해 주세요">⚠ 미확인 장소</span>';
  }

  const memberName = (id) => trip()?.members.find((m) => m.id === id)?.name;
  function itemHtml(it, idx, n) {
    const time = it.start_time ? `${hhmm(it.start_time)}${it.end_time ? `<br><small>~${hhmm(it.end_time)}</small>` : ''}` : '<small>시간<br>미정</small>';
    const st = planSt(it);
    const recs = recordsOfPlan(it.id);
    const who = (it.assignees || []).map(memberName).filter(Boolean);
    const picked = P.sel?.has(it.id);
    return `<li class="plan-item st-${st.toLowerCase()} ${P.sel ? (picked ? 'picked' : 'pickable') : ''}" data-item="${it.id}" ${P.sel ? `aria-pressed="${!!picked}"` : ''}>
      ${P.sel ? `<span class="sel-box ${picked ? 'on' : ''}" aria-hidden="true"></span>` : ''}
      <div class="pi-time">${time}</div>
      <div class="pi-body">
        <div class="pi-title">${typeIcon(it.item_type)} <b>${esc(it.title)}</b></div>
        <div class="pi-meta">
          ${st !== 'PLANNED' ? planStBadge(it) : ''}
          <span>${typeLabel(it.item_type)}</span>
          ${it.place_name && it.place_name !== it.title ? `<span>📍 ${esc(it.place_name)}</span>` : ''}
          ${it.cost_estimate != null ? `<span>💰 ${money(it.cost_estimate, it.currency)}${it.source === 'AI' && !it.user_edited ? ' (AI 추정)' : ''}</span>` : ''}
          ${vBadge(it)}
          ${it.source === 'AI' ? `<span class="vbadge ai" title="AI가 만든 일정${it.user_edited ? ' · 직접 고침' : ''}">AI${it.user_edited ? '·고침' : ''}</span>` : ''}
        </div>
        ${who.length ? `<div class="pi-who">👤 ${who.map(esc).join(', ')}</div>` : ''}
        ${it.notes ? `<div class="pi-notes">${esc(it.notes)}</div>` : ''}
        ${recs.map((p) => `<button type="button" class="pi-rec" data-rec="${p.id}">📷 실제 ${p.visited_time ? `${hhmm(p.visited_time)} 방문` : '방문'} · ${esc(p.name)} <span aria-hidden="true">›</span></button>`).join('')}
        ${st === 'DONE' && !recs.length && canEdit(P.tripId) ? '<button type="button" class="pi-rec add" data-record>📷 실제 기록 남기기</button>' : ''}
      </div>
      <div class="pi-tools ${state.v008 ? 'four' : ''} ${P.sel ? 'hidden' : ''}">
        ${state.v008 ? `<button class="icon-btn done-btn" data-done ${st === 'PLANNED' ? '' : 'disabled'} aria-label="방문 완료" title="방문 완료">✓</button>` : ''}
        <button type="button" class="icon-btn drag-handle" data-handle aria-label="순서 바꾸기: 끌거나 카드를 길게 눌러 옮겨요 (키보드 ↑↓)" title="끌어서 순서 바꾸기">⠿</button>
        <button class="icon-btn" data-edit aria-label="수정">✏️</button>
      </div>
    </li>`;
  }

  function drawDayMap() {
    const box = $('#planMap');
    if (!box) return;
    const pts = dayItems(P.day).map((it, i) => ({ ...it, no: i + 1 })).filter((i) => i.lat != null);
    const route = pts.filter((p) => planSt(p) !== 'CANCELLED');
    setTimeout(() => {
      if (!box.isConnected) return;
      dayMap = L.map(box, { zoomControl: false, attributionControl: false, scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(dayMap);
      pts.forEach((p) => L.marker([p.lat, p.lng], {
        icon: L.divIcon({ html: `<div class="pin small ${p.verification_status === 'VERIFIED' ? '' : 'unverified'} st-${planSt(p).toLowerCase()}">${planSt(p) === 'DONE' ? '✓' : p.no}</div>`, className: 'pin-wrap', iconSize: [30, 30], iconAnchor: [15, 30] }),
        title: p.title,
      }).addTo(dayMap));
      if (route.length > 1) drawRoute(route.map((p) => [p.lat, p.lng]), dayMap);
      dayMap.fitBounds(pts.map((p) => [p.lat, p.lng]), { padding: [30, 30], maxZoom: 15, animate: false });
    }, 30);
  }

  // ----- 예산 -----
  function budgetHtml(t) {
    const n = Math.max(1, Number(P.prefs.travelerCount) || t.members.length || 1);
    const k = P.perPerson ? 1 / n : 1;
    const sums = {}; // currency → { cat → {est, act} }
    const add = (cur, cat, field, v) => {
      sums[cur] ??= {};
      sums[cur][cat] ??= { est: 0, act: 0 };
      sums[cur][cat][field] += v;
    };
    let unknown = 0;
    for (const it of P.items) {
      if (planSt(it) === 'CANCELLED') continue; // 취소한 일정은 예산에서 빼요
      if (it.cost_estimate == null) { if (PLACE_TYPES.includes(it.item_type)) unknown++; continue; }
      add(it.currency, TYPE_TO_CAT[it.item_type] || 'ETC', 'est', Number(it.cost_estimate) * n); // 일정 비용은 1인 기준
    }
    for (const e of P.expenses) add(e.currency, e.category, e.is_actual ? 'act' : 'est', Number(e.amount));
    const budget = P.prefs.budget?.amount ? P.prefs.budget : null;
    const budgetTotal = budget ? (budget.scope === 'TOTAL' ? budget.amount : budget.amount * n) : null;
    const curs = Object.keys(sums).sort((a, b) => (a === 'KRW' ? -1 : b === 'KRW' ? 1 : a.localeCompare(b)));
    if (!curs.length) curs.push('KRW');
    const tables = curs.map((cur) => {
      const rows = sums[cur] || {};
      const est = Object.values(rows).reduce((s, r) => s + r.est, 0);
      const act = Object.values(rows).reduce((s, r) => s + r.act, 0);
      const bud = cur === (budget?.currency || 'KRW') ? budgetTotal : null;
      return `<div class="budget-cards">
          <div><small>예상</small><b>${money(est * k, cur)}</b></div>
          <div><small>실제 지출</small><b>${money(act * k, cur)}</b></div>
          ${bud != null ? `<div class="${act > bud ? 'over' : ''}"><small>예산 대비 남은 돈</small><b>${money((bud - act) * k, cur)}</b></div>` : ''}
        </div>
        <table class="budget-table"><thead><tr><th>분류</th><th>예상</th><th>실제</th></tr></thead><tbody>
        ${Object.keys(EXP_CATS).filter((c) => rows[c]).map((c) => `<tr><td>${EXP_CATS[c][0]} ${EXP_CATS[c][1]}</td>
          <td>${money(rows[c].est * k, cur)}</td><td>${money(rows[c].act * k, cur)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">아직 금액이 없어요</td></tr>'}
        </tbody></table>`;
    }).join('');
    const canEdit = (e) => e.created_by === state.me.id || isOwner();
    return `
      <div class="seg mini-seg">
        <button type="button" class="${P.perPerson ? '' : 'on'}" data-pp="0">전체 (${n}명)</button>
        <button type="button" class="${P.perPerson ? 'on' : ''}" data-pp="1">1인당</button>
      </div>
      ${budget ? `<small class="hint" style="margin-bottom:8px">예산: ${money(budget.amount, budget.currency)} (${budget.scope === 'TOTAL' ? '전체' : '1인'}) · AI 일정 조건에서 바꿀 수 있어요</small>` : ''}
      ${tables}
      ${unknown ? `<div class="notice">💡 예상 비용을 모르는 일정 ${unknown}개는 합계에 들어가지 않았어요 (금액 미확인).</div>` : ''}
      <small class="hint">일정의 예상 비용은 1인 기준으로 적고 인원수(${n}명)를 곱해 합쳐요. 다른 통화는 따로 합쳐요.</small>
      <div class="section-head" style="margin-top:18px"><h3>지출 기록</h3><button class="chip-btn" data-act="add-expense">＋ 지출 추가</button></div>
      ${P.expenses.length ? P.expenses.slice().sort((a, b) => String(b.spent_on || '').localeCompare(String(a.spent_on || '')) || b.id - a.id).map((e) => `
        <div class="exp-row">
          <span class="exp-ic">${EXP_CATS[e.category]?.[0] || '✨'}</span>
          <div class="grow"><b>${esc(e.title)}</b><small class="muted">${e.is_actual ? '실제' : '예상'}${e.spent_on ? ` · ${short(e.spent_on)}` : ''} · ${EXP_CATS[e.category]?.[1] || '기타'}</small></div>
          <b class="${e.is_actual ? '' : 'muted'}">${money(e.amount, e.currency)}</b>
          ${canEdit(e) ? `<button class="icon-btn" data-exp="${e.id}" aria-label="지출 수정">✏️</button>` : ''}
        </div>`).join('') : '<div class="empty small">아직 지출 기록이 없어요</div>'}`;
  }

  // ----- 준비물 -----
  function checklistHtml() {
    const done = P.checklist.filter((c) => c.checked).length;
    return `
      <form id="ckForm" class="search-row ck-add" autocomplete="off">
        <input name="title" maxlength="80" placeholder="준비물 추가 (예: 우산)" aria-label="준비물 이름" required>
        <button type="submit">추가</button>
      </form>
      ${P.checklist.length ? `<div class="ck-progress"><span style="width:${Math.round((done / P.checklist.length) * 100)}%"></span></div>
        <small class="hint">${done}/${P.checklist.length} 챙겼어요</small>` : ''}
      <ul class="ck-list">${P.checklist.map((c) => `<li class="${c.checked ? 'done' : ''}">
          <label><input type="checkbox" data-ck="${c.id}" ${c.checked ? 'checked' : ''}><span>${esc(c.title)}</span></label>
          <button class="icon-btn" data-ckdel="${c.id}" aria-label="${esc(c.title)} 지우기">✕</button></li>`).join('')}</ul>
      ${P.checklist.length ? '' : '<div class="empty small">함께 챙길 준비물을 적어 보세요</div>'}
      <button class="btn" data-act="ck-defaults" style="margin-top:8px">📋 기본 준비물 넣기</button>`;
  }

  // ---------- 화면 이벤트 ----------
  function bind() {
    const root = el();
    setupDrag(root);
    root.addEventListener('click', async (e) => {
      if (Date.now() - dragEndedAt < 450) { e.preventDefault(); e.stopPropagation(); return; } // 끌어서 놓은 직후의 클릭
      const pick = e.target.closest('[data-pick-trip]');
      if (pick) { state.filter = Number(pick.dataset.pickTrip); refresh(true); return; }
      const tab = e.target.closest('[data-tab]');
      if (tab) { P.tab = tab.dataset.tab; P.sel = null; render(); return; }
      const day = e.target.closest('[data-day]');
      if (day) { P.day = day.dataset.day; if (P.sel) P.sel = new Set(); render(); return; }
      // 일정 여러 개 고르기
      const bulk = e.target.closest('[data-bulk]')?.dataset.bulk;
      if (bulk && P.sel) {
        const all = dayItems(P.day).map((x) => x.id);
        if (bulk === 'all') P.sel = P.sel.size === all.length ? new Set() : new Set(all);
        if (bulk === 'cancel') P.sel = null;
        if (bulk === 'del') { await deleteSelectedItems(); return; }
        render();
        return;
      }
      if (P.sel) {
        const li = e.target.closest('[data-item]');
        if (li) {
          const id = Number(li.dataset.item);
          if (P.sel.has(id)) P.sel.delete(id); else P.sel.add(id);
          render();
          return;
        }
      }
      const pp = e.target.closest('[data-pp]');
      if (pp) { P.perPerson = pp.dataset.pp === '1'; render(); return; }
      const item = e.target.closest('[data-item]');
      if (item && e.target.closest('[data-edit]')) { openItemForm(P.items.find((x) => x.id === Number(item.dataset.item))); return; }
      if (item && e.target.closest('[data-done]')) { openPlanDone(P.items.find((x) => x.id === Number(item.dataset.item))); return; }
      const rec = e.target.closest('[data-rec]');
      if (rec) { openPlace(Number(rec.dataset.rec)); return; }
      if (item && e.target.closest('[data-record]')) { recordFromPlan(P.items.find((x) => x.id === Number(item.dataset.item))); return; }
      const exp = e.target.closest('[data-exp]');
      if (exp) { openExpenseForm(P.expenses.find((x) => x.id === Number(exp.dataset.exp))); return; }
      const ckdel = e.target.closest('[data-ckdel]');
      if (ckdel) { await deleteCheck(Number(ckdel.dataset.ckdel)); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'new-trip') openTripForm();
      else if (act === 'edit-trip') openTripForm(trip());
      else if (act === 'back') { state.filter = 'all'; refresh(true); }
      else if (act === 'members') openTrip(P.tripId);
      else if (act === 'reload') reload();
      else if (act === 'add-item') openItemForm(null);
      else if (act === 'ai-generate') openGenerate();
      else if (act === 'ai-revise') openRevise();
      else if (act === 'ai-add') openAiAdd();
      else if (act === 'import') openImport();
      else if (act === 'ai-helper') openAiHelper();
      else if (act === 'more') openMore();
      else if (act === 'add-expense') openExpenseForm(null);
      else if (act === 'ck-defaults') addDefaultChecks();
      else if (act === 'goto-journal') switchView('journal');
      else if (act === 'sel-on') { P.sel = new Set(); render(); }
      else if (act === 'sel-off') { P.sel = null; render(); }
      else if (act === 'verify-places') verifyPlaces(false);
    });
    root.addEventListener('change', async (e) => {
      const ck = e.target.closest('[data-ck]');
      if (ck) await toggleCheck(Number(ck.dataset.ck), ck.checked, ck);
    });
    root.addEventListener('submit', async (e) => {
      if (e.target.id !== 'ckForm') return;
      e.preventDefault();
      const input = e.target.title;
      const title = input.value.trim();
      if (!title) return;
      const btn = $('button', e.target);
      btn.disabled = true;
      try {
        const max = P.checklist.reduce((m, c) => Math.max(m, c.sort_order), 0);
        const [row] = await pq(sb.from('checklist_items').insert({ trip_id: P.tripId, title, sort_order: max + 1 }).select());
        P.checklist.push(row);
        render();
        $('#ckForm input')?.focus();
      } catch (err) { toast(err.message); btn.disabled = false; }
    });
  }

  // ---------- 일정 추가·수정 ----------
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  /** 같은 날 시간이 겹치는 일정 (취소한 일정 빼고). 끝 시간이 없으면 30분으로 봐요 */
  function overlapping(day, start, end, selfId) {
    if (!start) return [];
    const a0 = toMin(start);
    const a1 = end ? toMin(end) : a0 + 30;
    return dayItems(day).filter((x) => x.id !== selfId && x.start_time && planSt(x) !== 'CANCELLED').filter((x) => {
      const b0 = toMin(hhmm(x.start_time));
      const b1 = x.end_time ? toMin(hhmm(x.end_time)) : b0 + 30;
      return a0 < Math.max(b1, b0 + 1) && b0 < Math.max(a1, a0 + 1);
    });
  }

  /**
   * opts (새 일정): { place: {place_name, lat, lng, …}, title, placeId, lookup }
   * — 지도에서 고른 위치·기록한 장소로 일정을 만들 때
   */
  function openItemForm(it, opts = {}) {
    const t = trip();
    const days = tripDays(t);
    let place = it ? { place_name: it.place_name, address: it.address, lat: it.lat, lng: it.lng, verification_status: it.verification_status }
      : opts.place ? { ...opts.place } : null;
    let placeTouched = !it && !!opts.place; // 장소를 바꾸지 않으면 검증 상태(미확인 등)를 그대로 둠
    const members = t.members || [];
    const showWho = state.v008 && members.length > 1;
    const tripPlaces = state.places.filter((p) => p.trip_id === P.tripId);
    const body = openSheet(`<h2>${it ? '일정 수정' : '일정 추가'}</h2>
      <form id="itemForm" autocomplete="off">
        <div class="grid2">
          <label class="field"><span>날짜</span><select name="day_date">${days.map((d, i) => `<option value="${d}" ${d === (it?.day_date || P.day) ? 'selected' : ''}>${i + 1}일차 ${short(d)} (${wday(d)})</option>`).join('')}</select></label>
          <label class="field"><span>종류</span><select name="item_type">${Object.entries(ITYPES).map(([k, [e, l]]) => `<option value="${k}" ${k === (it?.item_type || 'PLACE') ? 'selected' : ''}>${e} ${l}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>일정 이름 <small>80자</small></span><input name="title" maxlength="80" required value="${esc(it?.title || opts.title || '')}" placeholder="예: 공산성 산책"></label>
        <div class="grid2">
          <label class="field"><span>시작 시간</span><input type="time" name="start_time" value="${hhmm(it?.start_time)}"></label>
          <label class="field"><span>종료 시간</span><input type="time" name="end_time" value="${hhmm(it?.end_time)}"></label>
        </div>
        <div class="field"><span>장소 (선택)</span>
          <div id="placeNow"></div>
          <div class="search-row"><input name="q" maxlength="60" placeholder="장소 이름 검색" enterkeyhint="search"><button type="button" id="plSearch">검색</button></div>
          <div id="plResults" class="results"></div>
          ${tripPlaces.length ? `<label class="field" style="margin:8px 0 0"><span>기록한 장소와 연결</span><select name="place_id"><option value="">연결 안 함</option>
            ${tripPlaces.map((p) => `<option value="${p.id}" ${p.id === (it ? it.place_id : opts.placeId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
        </div>
        <div class="grid2">
          <label class="field"><span>1인 예상 비용</span><input type="number" name="cost" min="0" step="any" inputmode="decimal" value="${it?.cost_estimate ?? ''}" placeholder="모르면 비워 두기"></label>
          <label class="field"><span>통화</span><input name="currency" maxlength="3" value="${esc(it?.currency || 'KRW')}" autocapitalize="characters"></label>
        </div>
        ${state.v011 ? `<div class="field"><span>여기까지 이동 <small>앞 일정에서 오는 방법</small></span>
          <div class="grid2 transit-grid">
            <select name="t_mode" aria-label="이동 수단"><option value="">정하지 않음</option>${Object.entries(TRANSIT).map(([k, [e, l]]) => `<option value="${k}" ${it?.transit?.mode === k ? 'selected' : ''}>${e} ${l}</option>`).join('')}</select>
            <input type="number" name="t_min" min="1" max="1440" inputmode="numeric" placeholder="걸리는 시간(분)" value="${it?.transit?.minutes ?? ''}" aria-label="걸리는 시간(분)">
          </div>
          <input name="t_detail" maxlength="80" placeholder="예: 공주종합버스터미널에서 시내버스" value="${esc(it?.transit?.detail || '')}" style="margin-top:6px" aria-label="이동 설명"></div>` : ''}
        <label class="field"><span>메모</span><textarea name="notes" maxlength="500" rows="2">${esc(it?.notes || '')}</textarea></label>
        ${showWho ? `<div class="field"><span>함께 가는 사람 <small>안 고르면 모두 함께</small></span><div class="who-pick">
          ${members.map((m) => `<label class="chk"><input type="checkbox" name="who" value="${m.id}" ${it?.assignees?.includes(m.id) ? 'checked' : ''}><span>${esc(m.name)}</span></label>`).join('')}</div></div>` : ''}
        ${it && state.v008 ? `<label class="field"><span>상태</span><select name="status">
          ${Object.entries(PLAN_ST).map(([k, l]) => `<option value="${k}" ${k === planSt(it) ? 'selected' : ''}>${k === 'DONE' ? '✓ ' : ''}${l}</option>`).join('')}</select></label>` : ''}
        <button class="primary" type="submit">${it ? '저장' : '추가'}</button>
        ${it ? `<div class="btn-row" style="margin-top:10px">
          <button type="button" class="btn" id="itemDup">⧉ 복제 <small>(고른 날짜에)</small></button>
          <button type="button" class="btn danger" id="itemDel">이 일정 삭제</button></div>` : ''}
      </form>`);
    const f = $('#itemForm', body);
    const showPlace = () => {
      $('#placeNow', body).innerHTML = place?.place_name
        ? `<div class="place-now">${place.verification_status === 'VERIFIED' ? '✓' : '📍'} <b>${esc(place.place_name)}</b>
            ${place.address ? `<small>${esc(place.address)}</small>` : ''}<button type="button" class="link" id="plClear">연결 해제</button></div>` : '';
      const c = $('#plClear', body);
      if (c) c.onclick = () => { place = null; placeTouched = true; showPlace(); };
    };
    showPlace();
    // 지도에서 고른 위치: 이름을 찾아 채워 봐요
    if (opts.lookup && place?.lat != null && typeof placeNameAt === 'function') {
      placeNameAt(place.lat, place.lng).then((r) => {
        if (!body.isConnected || !r?.name || !place || place.place_name !== opts.place.place_name) return;
        place.place_name = r.name;
        if (!f.title.value.trim()) f.title.value = r.name;
        showPlace();
      }).catch(() => { /* 이름은 직접 */ });
    }
    async function search() {
      const qv = f.q.value.trim() || f.title.value.trim();
      if (!qv) return toast('검색할 장소 이름을 입력해 주세요');
      const box = $('#plResults', body);
      box.innerHTML = '<div class="hint">검색 중…</div>';
      try {
        const list = await geocode(qv);
        box.innerHTML = list.length ? list.map((r, i) => `<button type="button" data-i="${i}"><b>${esc(r.name)}</b><small>${esc(r.address || '')}</small></button>`).join('')
          : '<div class="hint">검색 결과가 없어요. 장소 없이 저장해도 돼요.</div>';
        box.onclick = (ev) => {
          const b = ev.target.closest('[data-i]');
          if (!b) return;
          const r = list[Number(b.dataset.i)];
          place = { place_name: r.name, address: r.address || null, lat: r.lat, lng: r.lng, verification_status: 'VERIFIED' };
          placeTouched = true;
          if (!f.title.value.trim()) f.title.value = r.name;
          box.innerHTML = '';
          showPlace();
        };
      } catch (err) { box.innerHTML = `<div class="hint">${esc(err.message)}</div>`; }
    }
    $('#plSearch', body).onclick = search;
    f.q.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const start = f.start_time.value || null;
      const end = f.end_time.value || null;
      if (start && end && end < start) return toast('종료 시간이 시작 시간보다 빨라요. 자정을 넘기면 다음 날 일정으로 나눠 주세요');
      const cost = f.cost.value === '' ? null : Number(f.cost.value);
      if (cost != null && (!Number.isFinite(cost) || cost < 0)) return toast('비용은 0 이상으로 입력해 주세요');
      const currency = (f.currency.value || 'KRW').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) return toast('통화는 KRW, USD, JPY처럼 3글자로 입력해 주세요');
      const placeId = f.place_id?.value ? Number(f.place_id.value) : null;
      let pl = place;
      if (pl?.lat == null && placeId && placeId !== it?.place_id) { // 기록한 장소와 새로 연결하면 그 위치를 씀
        const p = tripPlaces.find((x) => x.id === placeId);
        if (p && p.lat != null) { pl = { place_name: p.name, address: null, lat: p.lat, lng: p.lng, verification_status: 'VERIFIED' }; placeTouched = true; }
      }
      const status = !placeTouched && it ? it.verification_status
        : pl?.lat != null ? (pl.verification_status || 'VERIFIED') : (pl?.place_name ? 'MANUAL' : 'UNVERIFIED');
      const row = {
        day_date: f.day_date.value, item_type: f.item_type.value, title: f.title.value.trim(),
        start_time: start, end_time: end, place_id: placeId,
        place_name: pl?.place_name || null, address: pl?.address || null, lat: pl?.lat ?? null, lng: pl?.lng ?? null,
        verification_status: status,
        cost_estimate: cost, currency, notes: f.notes.value.trim() || null,
      };
      if (state.v011) {
        const mode = f.t_mode.value;
        const mins = Number(f.t_min.value);
        row.transit = mode ? { mode, minutes: Number.isInteger(mins) && mins >= 1 && mins <= 1440 ? mins : null, detail: f.t_detail.value.trim() || null } : null;
      }
      if (state.v008) {
        if (f.status) row.status = f.status.value;
        if (showWho) {
          const who = [...f.querySelectorAll('input[name=who]:checked')].map((x) => x.value);
          row.assignees = who.length && who.length < members.length ? who : null;
        }
      }
      // 시간 겹침 안내 (새 일정이거나 날짜·시간을 바꿨을 때만)
      const timeChanged = !it || it.day_date !== row.day_date || hhmm(it.start_time) !== (start || '') || hhmm(it.end_time) !== (end || '');
      if (timeChanged && (row.status || planSt(it)) !== 'CANCELLED') {
        const hits = overlapping(row.day_date, start, end, it?.id);
        if (hits.length && !confirm(`이 시간에 다른 일정이 있어요.\n${hits.map((x) => `· ${hhmm(x.start_time)}${x.end_time ? `~${hhmm(x.end_time)}` : ''} ${x.title}`).join('\n')}\n\n그대로 저장할까요?`)) return;
      }
      const btn = $('button[type=submit]', f);
      btn.disabled = true;
      try {
        if (it) {
          await changed(sb.from('itinerary_items').update({ ...row, user_edited: true }).eq('id', it.id).select('id'));
        } else {
          const max = dayItems(row.day_date).reduce((m, x) => Math.max(m, x.sort_order), 0);
          await pq(sb.from('itinerary_items').insert({ trip_id: P.tripId, ...row, sort_order: max + 1 }).select('id'));
        }
        closeSheet();
        P.day = row.day_date;
        await reload();
        toast(it ? '일정을 저장했어요' : '일정을 추가했어요');
      } catch (err) { toast(err.message); btn.disabled = false; }
    };
    const dup = $('#itemDup', body);
    if (dup) dup.onclick = async () => {
      const day = f.day_date.value;
      const max = dayItems(day).reduce((m, x) => Math.max(m, x.sort_order), 0);
      const copy = {
        trip_id: P.tripId, day_date: day, sort_order: max + 1, item_type: it.item_type, title: it.title,
        start_time: it.start_time, end_time: it.end_time, place_id: it.place_id, place_name: it.place_name, address: it.address,
        lat: it.lat, lng: it.lng, verification_status: it.verification_status, cost_estimate: it.cost_estimate,
        currency: it.currency, notes: it.notes,
      };
      if (state.v011 && it.transit) copy.transit = it.transit;
      if (state.v008 && it.assignees?.length) copy.assignees = it.assignees;
      dup.disabled = true;
      try {
        await pq(sb.from('itinerary_items').insert(copy).select('id'));
        closeSheet();
        P.day = day;
        await reload();
        toast(`${short(day)} 일정 맨 뒤에 복제했어요`);
      } catch (err) { toast(err.message); dup.disabled = false; }
    };
    const del = $('#itemDel', body);
    if (del) del.onclick = async () => {
      if (!confirm(`'${it.title}' 일정을 삭제할까요?`)) return;
      try {
        await changed(sb.from('itinerary_items').delete().eq('id', it.id).select('id'));
        closeSheet();
        await reload();
        toast('일정을 삭제했어요');
      } catch (err) { toast(err.message); }
    };
  }

  async function deleteSelectedItems() {
    const ids = [...P.sel];
    if (!ids.length) return;
    const done = P.items.filter((i) => ids.includes(i.id) && recordsOfPlan(i.id).length).length;
    if (!confirm(`일정 ${ids.length}개를 삭제할까요? 되돌릴 수 없어요.${done ? `\n(연결된 기록 ${done}개는 그대로 남고, 일정 연결만 풀려요)` : ''}`)) return;
    try {
      const rows = await pq(sb.from('itinerary_items').delete().in('id', ids).select('id'));
      P.sel = null;
      await reload();
      toast(rows.length === ids.length ? `일정 ${rows.length}개를 삭제했어요` : `일정 ${rows.length}개를 삭제했어요 · ${ids.length - rows.length}개는 권한이 없거나 이미 지워졌어요`);
    } catch (err) { toast(err.message); }
  }
  // 키보드(핸들에서 ↑↓)로 한 칸 옮기기 — 드래그와 같은 저장·시간 계산
  async function moveItem(id, dir) {
    const ids = dayItems(P.day).map((x) => x.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await commitOrder(ids);
    el().querySelector(`[data-item="${id}"] [data-handle]`)?.focus();
  }

  // =====================================================================
  // 순서 바꾸기 저장: 새 순서 → 시간 다시 계산(plan-time.js) → 순서·시간을 한 번에 저장
  // 화면은 먼저 바꾸고(낙관적), 저장에 실패하면 원래 순서·시간으로 되돌려요
  // =====================================================================
  const TIME_NOTE = {
    missing: '시간이 없는 일정이 있어서 순서만 바꾸고 시간은 그대로 두었어요',
    overlap: '원래 시간이 겹치는 일정이 있어서 순서만 바꾸고 시간은 그대로 두었어요. 겹치는 시간을 먼저 고쳐 주세요',
  };
  let saving = false;
  async function commitOrder(newIds) {
    if (saving) return;
    const list = dayItems(P.day);
    if (newIds.join() === list.map((x) => x.id).join()) { render(); return; }
    const r = window.PlanTime.recalcTimes(list, newIds);
    if (!r.ok && (r.reason === 'overflow' || r.reason === 'mismatch')) {
      render();
      toast(r.reason === 'overflow' ? '시간을 다시 맞추면 자정을 넘겨서 저장하지 않았어요. 다음 날로 옮길 일정은 수정에서 날짜를 바꿔 주세요' : '일정 목록이 바뀌었어요. 다시 해 주세요');
      return;
    }
    const backup = list.map((x) => ({ id: x.id, sort_order: x.sort_order, start_time: x.start_time, end_time: x.end_time, user_edited: x.user_edited }));
    // 화면 먼저
    newIds.forEach((id, k) => {
      const it = P.items.find((x) => x.id === id);
      it.sort_order = k + 1;
      if (r.ok) { it.start_time = `${r.times[id].start}:00`; it.end_time = `${r.times[id].end}:00`; }
    });
    render();
    saving = true;
    try {
      const starts = r.ok ? newIds.map((id) => r.times[id].start) : null;
      const ends = r.ok ? newIds.map((id) => r.times[id].end) : null;
      try {
        await pq(sb.rpc('reorder_itinerary_times', { p_trip_id: P.tripId, p_day: P.day, p_ids: newIds, p_starts: starts, p_ends: ends }));
      } catch (err) {
        if (err.code !== 'NEEDS_MIGRATION') throw err;
        await saveOrderFallback(newIds, r, backup); // DB 설정 012 전
      }
      await reload();
      if (!r.ok) toast(TIME_NOTE[r.reason]);
      else toast(r.changed.length ? `순서를 바꾸고 일정 ${r.changed.length}개의 시간을 다시 맞췄어요` : '순서를 바꿨어요');
    } catch (err) {
      // 저장 실패 → 원래대로
      for (const b of backup) Object.assign(P.items.find((x) => x.id === b.id) || {}, b);
      render();
      toast(err.code === 'PT409' ? err.message : `저장하지 못해서 원래대로 돌렸어요: ${err.message}`);
      if (err.code === 'PT409') reload();
    } finally { saving = false; }
  }
  // migrate-012 전: 순서 저장 → 시간 저장, 중간에 실패하면 원래 순서·시간으로 되돌리기 시도
  async function saveOrderFallback(newIds, r, backup) {
    await pq(sb.rpc('reorder_itinerary', { p_trip_id: P.tripId, p_day: P.day, p_ids: newIds }));
    if (!r.ok) return;
    const done = [];
    try {
      for (const id of r.changed) {
        await changed(sb.from('itinerary_items').update({ start_time: r.times[id].start, end_time: r.times[id].end, user_edited: true }).eq('id', id).select('id'));
        done.push(id);
      }
    } catch (err) {
      for (const b of backup.filter((x) => done.includes(x.id))) {
        await sb.from('itinerary_items').update({ start_time: b.start_time, end_time: b.end_time, user_edited: b.user_edited }).eq('id', b.id).then(() => {}, () => {});
      }
      await sb.rpc('reorder_itinerary', { p_trip_id: P.tripId, p_day: P.day, p_ids: backup.map((x) => x.id) }).then(() => {}, () => {});
      throw err;
    }
  }

  // =====================================================================
  // 드래그 앤 드롭: 휴대폰은 카드를 0.4초 길게 누르기, PC 는 ⠿ 핸들을 마우스로 끌기
  // (라이브러리 없이 터치·포인터 이벤트로. 스크롤과 충돌하지 않게 길게 누르기 전에 움직이면 스크롤로 봐요)
  // =====================================================================
  const LONG_PRESS = 400;
  let drag = null;
  let press = null;
  let dragEndedAt = 0;
  const canDrag = (li) => li && P.tab === 'days' && !P.sel && !saving && canEdit(P.tripId) && li.closest('.plan-list');
  const scroller = () => $('#view-timeline');

  function beginDrag(li, y) {
    const ol = li.closest('.plan-list');
    ol.classList.add('dragging');                     // 이동 줄(🚌…)은 잠깐 숨기고 카드만
    const items = [...ol.querySelectorAll('li.plan-item')];
    const rects = items.map((x) => x.getBoundingClientRect());
    const from = items.indexOf(li);
    const step = items.length > 1 ? rects[1].top - rects[0].top - rects[0].height + rects[from].height : rects[from].height;
    drag = { li, items, rects, from, to: from, startY: y, lastY: y, startScroll: scroller()?.scrollTop || 0, step, raf: 0 };
    li.classList.add('drag-active');
    document.body.classList.add('plan-dragging');
    navigator.vibrate?.(15);
    autoScroll();
  }
  function moveDrag(y) {
    if (!drag) return;
    drag.lastY = y;
    const sc = scroller();
    const dy = y - drag.startY + ((sc?.scrollTop || 0) - drag.startScroll);
    const { li, items, rects, from } = drag;
    li.style.transform = `translateY(${dy}px) scale(1.02)`;
    const center = rects[from].top + rects[from].height / 2 + dy;
    let to = 0;
    items.forEach((x, k) => { if (k !== from && rects[k].top + rects[k].height / 2 < center) to++; });
    drag.to = to;
    items.forEach((x, k) => {
      if (k === from) return;
      let shift = 0;
      if (from < to && k > from && k <= to) shift = -drag.step;
      if (to < from && k >= to && k < from) shift = drag.step;
      x.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }
  // 화면 위·아래 끝에 가까우면 저절로 스크롤
  function autoScroll() {
    if (!drag) return;
    const sc = scroller();
    if (sc) {
      const box = sc.getBoundingClientRect();
      const bottom = Math.min(box.bottom, window.innerHeight) - 90; // 하단 탭 위
      const top = box.top + 70;
      let v = 0;
      if (drag.lastY < top) v = -Math.ceil((top - drag.lastY) / 6);
      else if (drag.lastY > bottom) v = Math.ceil((drag.lastY - bottom) / 6);
      if (v) { sc.scrollTop += Math.max(-18, Math.min(18, v)); moveDrag(drag.lastY); }
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }
  function endDrag(cancel) {
    if (!drag) return;
    const { li, items, from, to } = drag;
    cancelAnimationFrame(drag.raf);
    items.forEach((x) => { x.style.transform = ''; });
    li.classList.remove('drag-active');
    li.closest('.plan-list')?.classList.remove('dragging');
    document.body.classList.remove('plan-dragging');
    drag = null;
    dragEndedAt = Date.now();
    if (cancel || from === to) { render(); return; }  // 취소 → 원래 순서
    const ids = items.map((x) => Number(x.dataset.item));
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    commitOrder(ids);
  }
  function clearPress() { if (press) clearTimeout(press.timer); press = null; }

  function setupDrag(root) {
    // --- 터치: 길게 누르기(카드) 또는 핸들 바로 끌기 ---
    root.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { clearPress(); return; }
      const li = e.target.closest('li.plan-item');
      if (!canDrag(li)) return;
      const onHandle = !!e.target.closest('[data-handle]');
      if (!onHandle && e.target.closest('button, a, input, select, textarea, label')) return; // 완료·수정 버튼은 그대로
      const y = e.touches[0].clientY;
      const x = e.touches[0].clientX;
      clearPress();
      if (onHandle) { beginDrag(li, y); return; }
      press = { li, x, y, timer: setTimeout(() => { if (press?.li === li) { const p = press; press = null; beginDrag(li, p.y); } }, LONG_PRESS) };
    }, { passive: true });
    root.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (press && (Math.abs(t.clientY - press.y) > 8 || Math.abs(t.clientX - press.x) > 8)) clearPress(); // 스크롤로 봄
      if (drag) { e.preventDefault(); moveDrag(t.clientY); }
    }, { passive: false });
    root.addEventListener('touchend', () => { clearPress(); if (drag) endDrag(false); });
    root.addEventListener('touchcancel', () => { clearPress(); if (drag) endDrag(true); });
    // 길게 눌렀을 때 뜨는 글자 선택·메뉴 막기
    root.addEventListener('contextmenu', (e) => { if (drag || press) e.preventDefault(); });
    // --- 마우스·펜: 핸들 끌기 ---
    root.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      const h = e.target.closest('[data-handle]');
      const li = h?.closest('li.plan-item');
      if (!h || !canDrag(li)) return;
      e.preventDefault();
      beginDrag(li, e.clientY);
      const mv = (ev) => moveDrag(ev.clientY);
      const up = (ev) => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('keydown', esc);
        endDrag(ev.type !== 'pointerup');
      };
      const esc = (ev) => { if (ev.key === 'Escape') up({ type: 'cancel' }); };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
      window.addEventListener('keydown', esc);
    });
    // --- 키보드: 핸들에서 ↑↓ ---
    root.addEventListener('keydown', (e) => {
      const h = e.target.closest('[data-handle]');
      if (!h || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      moveItem(Number(h.closest('[data-item]').dataset.item), e.key === 'ArrowUp' ? -1 : 1);
    });
  }

  // ---------- AI 호출 ----------
  async function callAI(body) {
    if (!navigator.onLine) throw Object.assign(new Error('인터넷 연결을 확인해 주세요'), { code: 'OFFLINE' });
    const { data, error } = await sb.functions.invoke('ai-planner', { body });
    if (error) {
      let payload = null;
      try { payload = await error.context?.json(); } catch { /* 본문 없음 */ }
      const msg = payload?.error?.message
        || (error.name === 'FunctionsFetchError' ? 'AI 서버에 연결하지 못했어요 (AI 기능이 아직 설치되지 않았을 수 있어요)' : 'AI 요청에 실패했어요. 잠시 후 다시 시도해 주세요');
      throw Object.assign(new Error(msg), { code: payload?.error?.code || error.name, requestId: payload?.error?.requestId });
    }
    return data;
  }
  const aiErrorHtml = (err) => `<div class="notice error">${esc(err.message)}
    ${err.requestId ? `<br><small>문의 번호: ${esc(err.requestId)}</small>` : ''}
    <div class="btn-row"><button class="btn" data-ai="retry">다시 시도</button><button class="btn" data-ai="manual">직접 일정 추가</button></div></div>`;

  // ---------- AI 일정 만들기 (조건 → 미리보기 → 고른 것만 저장) ----------
  function openGenerate() {
    const t = trip();
    const days = tripDays(t);
    if (!days.length) { toast('먼저 여행 날짜를 정해 주세요'); openTripForm(t); return; }
    if (days.length > 10) toast('AI 일정은 10일까지 만들 수 있어요. 기간을 나눠 주세요');
    const pr = P.prefs || {};
    const body = openSheet(`<h2>✨ AI 일정 만들기</h2>
      <p class="muted" style="margin-top:-6px">📅 ${fmtRange(t.start_date, t.end_date)} · ${days.length}일 <button type="button" class="link" id="genDates">날짜 바꾸기</button></p>
      <form id="genForm" autocomplete="off">
        <label class="field"><span>여행지 *</span><input name="destination" maxlength="60" required value="${esc(pr.destination || '')}" placeholder="예: 충청남도 공주"></label>
        <div class="grid2">
          <label class="field"><span>인원</span><input type="number" name="travelerCount" min="1" max="30" value="${esc(pr.travelerCount || t.members.length || 2)}"></label>
          <label class="field"><span>출발지 (선택)</span><input name="departure" maxlength="40" value="${esc(pr.departure || '')}" placeholder="예: 서울"></label>
        </div>
        <label class="field"><span>교통</span><select name="transport">${Object.entries(TRANSPORTS).map(([k, l]) => `<option value="${k}" ${k === (pr.transport || 'PUBLIC_TRANSIT') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="field"><span>예산 (선택)</span>
          <div class="grid2">
            <input type="number" name="budget" min="0" step="any" inputmode="numeric" value="${esc(pr.budget?.amount ?? '')}" placeholder="예: 200000" aria-label="예산 금액">
            <select name="scope" aria-label="예산 기준"><option value="PER_PERSON" ${pr.budget?.scope !== 'TOTAL' ? 'selected' : ''}>1인 기준</option><option value="TOTAL" ${pr.budget?.scope === 'TOTAL' ? 'selected' : ''}>전체 합계</option></select>
          </div>
        </div>
        <div class="field"><span>취향</span><div class="cats">${Object.entries(STYLES).map(([k, l]) => `<label><input type="checkbox" name="styles" value="${k}" ${(pr.styles || []).includes(k) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
        <label class="field"><span>꼭 가볼 곳 (쉼표로 구분)</span><input name="mustVisit" maxlength="300" value="${esc((pr.mustVisit || []).join(', '))}" placeholder="예: 공산성, 무령왕릉"></label>
        <label class="field"><span>피하고 싶은 것</span><input name="avoid" maxlength="300" value="${esc((pr.avoid || []).join(', '))}" placeholder="예: 급한 일정, 오래 걷기"></label>
        <label class="field"><span>요청 사항 <small>300자</small></span><textarea name="instructions" maxlength="300" rows="2" placeholder="예: 오후에는 여유롭게">${esc(pr.instructions || '')}</textarea></label>
        <button class="primary" type="submit">AI 일정 만들기</button>
        <small class="hint">AI가 초안을 만들면 미리 보고 고른 일정만 저장해요. 지금 있는 일정은 바뀌지 않아요.</small>
      </form>
      <div id="genOut"></div>`);
    $('#genDates', body).onclick = () => openTripForm(t);
    const f = $('#genForm', body);
    const run = async (req) => {
      const out = $('#genOut', body);
      f.classList.add('hidden');
      out.innerHTML = `<div class="ai-loading"><div class="spinner"></div><b>AI가 ${days.length}일 일정을 짜고 있어요…</b>
        <small>장소 확인까지 30초~1분쯤 걸려요. 이 창을 닫아도 지금 일정은 바뀌지 않아요.</small></div>`;
      try {
        const res = await callAI({ action: 'generate', ...req });
        if (!body.isConnected) return;
        showDraft(body, res);
      } catch (err) {
        if (!body.isConnected) return;
        out.innerHTML = aiErrorHtml(err);
        out.onclick = (e) => {
          const a = e.target.closest('[data-ai]')?.dataset.ai;
          if (a === 'retry') { f.classList.remove('hidden'); out.innerHTML = ''; }
          if (a === 'manual') openItemForm(null);
        };
      }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const budget = f.budget.value === '' ? null : { amount: Number(f.budget.value), currency: 'KRW', scope: f.scope.value };
      if (budget && (!Number.isFinite(budget.amount) || budget.amount < 0)) return toast('예산은 0 이상으로 입력해 주세요');
      const req = {
        tripId: P.tripId, destination: f.destination.value.trim(), travelerCount: Number(f.travelerCount.value) || 1,
        departure: f.departure.value.trim() || null, transport: f.transport.value, budget,
        styles: [...f.querySelectorAll('[name=styles]:checked')].map((x) => x.value),
        mustVisit: listInput(f.mustVisit.value), avoid: listInput(f.avoid.value), instructions: f.instructions.value.trim() || null,
      };
      if (!req.destination) return toast('여행지를 입력해 주세요');
      // 조건은 다음에 다시 쓰도록 저장 (실패해도 AI 요청은 계속)
      const { tripId, ...prefs } = req;
      try { await pq(sb.rpc('save_plan_prefs', { p_trip_id: tripId, p_prefs: prefs })); P.prefs = prefs; } catch (err) {
        if (err.code === 'NEEDS_MIGRATION') { toast('DB 설정(migrate-004)이 먼저 필요해요'); return; }
      }
      run(req);
    };
  }

  function showDraft(body, res) {
    const out = $('#genOut', body);
    const all = res.days.flatMap((d) => d.items);
    const chosen = new Set(all.map((i) => i.temporaryId));
    const unverified = all.filter((i) => PLACE_TYPES.includes(i.type) && i.placeQuery && i.verificationStatus !== 'VERIFIED').length;
    out.innerHTML = `
      <h3>AI 초안 미리보기 <small class="muted">(아직 저장 안 됨)</small></h3>
      ${res.warnings?.length ? `<div class="notice warn"><b>확인해 주세요</b><ul>${res.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
      ${unverified ? `<div class="notice">⚠ AI 서버가 실제 장소를 찾지 못한 일정 ${unverified}개는 <b>미확인</b>으로 보여요. 저장하면 앱의 지도 검색으로 한 번 더 찾아 확인해요.</div>` : ''}
      ${res.days.map((d, di) => `<div class="draft-day"><h4>${di + 1}일차 · ${fmtDate(d.date)}</h4>
        ${d.items.length ? d.items.map((it) => `<label class="draft-item">
          <input type="checkbox" data-tmp="${esc(it.temporaryId)}" checked>
          <span class="pi-time">${it.startTime ? `${esc(it.startTime)}${it.endTime ? `<br><small>~${esc(it.endTime)}</small>` : ''}` : '<small>시간<br>미정</small>'}</span>
          <span class="pi-body"><span class="pi-title">${typeIcon(it.type)} <b>${esc(it.title)}</b></span>
            <span class="pi-meta">
              ${it.placeName && it.placeName !== it.title ? `<span>📍 ${esc(it.placeName)}</span>` : ''}
              ${PLACE_TYPES.includes(it.type) && it.placeQuery ? (it.verificationStatus === 'VERIFIED' ? '<span class="vbadge ok">✓ 장소 확인</span>' : '<span class="vbadge warn">⚠ 미확인 장소</span>') : ''}
              ${it.estimatedCost != null ? `<span>💰 약 ${money(it.estimatedCost, it.currency)} (AI 추정)</span>` : ''}
              ${it.transit ? `<span class="pv-move">${transitText(it.transit)}</span>` : ''}
            </span>
            ${it.notes ? `<span class="pi-notes">${esc(it.notes)}</span>` : ''}
            ${it.reason ? `<span class="pi-reason">💬 ${esc(it.reason)}</span>` : ''}</span>
        </label>`).join('') : '<div class="hint">이날은 제안이 없어요</div>'}</div>`).join('')}
      <div class="sticky-actions">
        <button class="primary" id="draftApply">선택한 일정 ${chosen.size}개 저장</button>
        <div class="btn-row"><button class="btn" id="draftRetry">조건 바꿔 다시 만들기</button><button class="btn" id="draftDiscard">버리기</button></div>
      </div>`;
    const btn = $('#draftApply', out);
    out.onchange = (e) => {
      const c = e.target.closest('[data-tmp]');
      if (!c) return;
      if (c.checked) chosen.add(c.dataset.tmp); else chosen.delete(c.dataset.tmp);
      btn.textContent = `선택한 일정 ${chosen.size}개 저장`;
      btn.disabled = !chosen.size;
    };
    out.onclick = async (e) => {
      if (e.target.id === 'draftRetry') { await discard(res.draftId); $('#genForm', body).classList.remove('hidden'); out.innerHTML = ''; body.scrollTop = 0; }
      if (e.target.id === 'draftDiscard') { await discard(res.draftId); closeSheet(); toast('초안을 버렸어요. 일정은 그대로예요'); }
      if (e.target.id === 'draftApply') await applyDraft(res, [...chosen], btn, `${chosen.size}개 일정을 저장했어요`);
    };
  }

  async function discard(draftId) {
    try { await pq(sb.rpc('discard_ai_draft', { p_draft_id: draftId })); } catch { /* 만료되면 어차피 못 씀 */ }
  }

  async function applyDraft(res, accepted, btn, okMsg) {
    if (!accepted.length) return toast('저장할 항목을 골라 주세요');
    if (btn.disabled) return;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '저장 중…';
    try {
      const rows = await pq(sb.rpc('apply_ai_draft', { p_draft_id: res.draftId, p_accepted: accepted, p_expected_revision: res.baseRevision }));
      const r = rows?.[0];
      if (!r) throw new Error('저장 결과를 확인하지 못했어요. 새로고침해서 확인해 주세요');
      closeSheet();
      await reload(); // 저장된 결과를 서버에서 다시 읽은 뒤 성공 표시
      toast(okMsg);
      // AI 서버가 확인하지 못한 장소는 앱의 지도 검색(카카오)으로 한 번 더 찾아요
      if (unverifiedItems().length) setTimeout(() => verifyPlaces(true), 1500);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = label;
      if (err.code === 'PT409' || err.code === 'PT410') {
        toast(err.message);
        await reload();
      } else toast(err.message);
    }
  }

  // ---------- AI에게 부분 수정 요청 (변경 전후 비교 → 고른 것만 적용) ----------
  function openRevise() {
    const days = tripDays(trip());
    const body = openSheet(`<h2>🪄 AI에게 수정 요청</h2>
      <form id="revForm" autocomplete="off">
        <label class="field"><span>고칠 범위</span><select name="scope">
          <option value="${P.day}">${days.indexOf(P.day) + 1}일차 · ${short(P.day)} 일정만</option>
          <option value="">여행 전체</option></select></label>
        <label class="field"><span>어떻게 고칠까요? <small>300자</small></span>
          <textarea name="instruction" maxlength="300" rows="3" required placeholder="예: 오후 일정을 여유롭게 바꿔 줘"></textarea></label>
        <div class="cands">${['오후 일정을 여유롭게', '비 오면 실내 위주로', '점심을 1시간 늦춰 줘', '카페 한 곳 넣어 줘'].map((s) => `<button type="button" class="cand" data-ex="${esc(s)}">${esc(s)}</button>`).join('')}</div>
        <button class="primary" type="submit" style="margin-top:12px">수정 제안 받기</button>
        <small class="hint">AI 제안은 바로 저장되지 않아요. 바뀌는 내용을 보고 고른 것만 적용해요. 직접 고친 일정은 따로 표시돼요.</small>
      </form>
      <div id="revOut"></div>`);
    const f = $('#revForm', body);
    f.onclick = (e) => {
      const ex = e.target.closest('[data-ex]');
      if (ex) f.instruction.value = ex.dataset.ex;
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const instruction = f.instruction.value.trim();
      if (!instruction) return;
      const out = $('#revOut', body);
      f.classList.add('hidden');
      out.innerHTML = '<div class="ai-loading"><div class="spinner"></div><b>AI가 수정안을 만들고 있어요…</b><small>지금 일정은 바뀌지 않아요.</small></div>';
      try {
        const res = await callAI({ action: 'revise', tripId: P.tripId, targetDay: f.scope.value || null, instruction, baseRevision: P.revision });
        if (body.isConnected) showDiff(body, res);
      } catch (err) {
        if (!body.isConnected) return;
        out.innerHTML = aiErrorHtml(err);
        if (err.code === 'REVISION_CONFLICT') reload();
        out.onclick = (ev) => {
          const a = ev.target.closest('[data-ai]')?.dataset.ai;
          if (a === 'retry') { f.classList.remove('hidden'); out.innerHTML = ''; }
          if (a === 'manual') openItemForm(null);
        };
      }
    };
  }

  function fieldDiff(b, a) {
    const rows = [];
    const cmp = (label, x, y) => { if ((x ?? '') !== (y ?? '')) rows.push(`<tr><th>${label}</th><td><del>${esc(x ?? '없음')}</del></td><td><ins>${esc(y ?? '없음')}</ins></td></tr>`); };
    cmp('날짜', b.date && short(b.date), a.date && short(a.date));
    cmp('이름', b.title, a.title);
    cmp('시간', [b.startTime, b.endTime].filter(Boolean).join('~'), [a.startTime, a.endTime].filter(Boolean).join('~'));
    cmp('종류', typeLabel(b.type), typeLabel(a.type));
    cmp('장소', b.placeName, a.placeName);
    cmp('비용', b.estimatedCost == null ? null : money(b.estimatedCost, b.currency), a.estimatedCost == null ? null : money(a.estimatedCost, a.currency));
    cmp('메모', b.notes, a.notes);
    return rows.length ? `<table class="diff">${rows.join('')}</table>` : '';
  }

  function showDiff(body, res) {
    const out = $('#revOut', body);
    const chosen = new Set(res.operations.map((o) => o.opId));
    const label = { update: ['수정', 'upd'], add: ['추가', 'add'], delete: ['삭제', 'del'] };
    out.innerHTML = `<h3>수정 제안 <small class="muted">(아직 적용 안 됨)</small></h3>
      ${res.warnings?.length ? `<div class="notice warn"><ul>${res.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
      ${res.operations.map((o) => {
        const it = o.item || o.before;
        return `<label class="diff-card ${label[o.op][1]}">
          <input type="checkbox" data-op="${esc(o.opId)}" checked>
          <div class="grow">
            <div><span class="op-badge ${label[o.op][1]}">${label[o.op][0]}</span> <b>${esc(it.title)}</b>
              ${o.before?.userEdited ? '<span class="vbadge warn">직접 고친 일정</span>' : ''}
              ${o.item && PLACE_TYPES.includes(o.item.type) && o.item.placeQuery ? (o.item.verificationStatus === 'VERIFIED' ? '<span class="vbadge ok">✓ 장소 확인</span>' : '<span class="vbadge warn">⚠ 미확인 장소</span>') : ''}</div>
            ${o.op === 'update' ? fieldDiff(o.before, o.item) : ''}
            ${o.op === 'add' ? `<small class="muted">${short(o.item.date)} ${esc(o.item.startTime || '')}${o.item.endTime ? `~${esc(o.item.endTime)}` : ''} ${o.item.placeName ? `· 📍 ${esc(o.item.placeName)}` : ''}</small>` : ''}
            ${o.op === 'delete' ? `<small class="muted">${short(o.before.date)} ${esc(o.before.startTime || '')} 일정을 지워요</small>` : ''}
            ${o.reason ? `<small class="hint">💬 ${esc(o.reason)}</small>` : ''}
          </div></label>`;
      }).join('')}
      ${res.operations.length ? `<div class="sticky-actions"><button class="primary" id="revApply">선택한 변경 ${chosen.size}개 적용</button>
        <div class="btn-row"><button class="btn" id="revCancel">취소 (그대로 두기)</button></div></div>`
        : '<button class="btn" id="revCancel">닫기</button>'}`;
    const btn = $('#revApply', out);
    out.onchange = (e) => {
      const c = e.target.closest('[data-op]');
      if (!c) return;
      if (c.checked) chosen.add(c.dataset.op); else chosen.delete(c.dataset.op);
      btn.textContent = `선택한 변경 ${chosen.size}개 적용`;
      btn.disabled = !chosen.size;
    };
    out.onclick = async (e) => {
      if (e.target.id === 'revCancel') { await discard(res.draftId); closeSheet(); toast('적용하지 않았어요. 일정은 그대로예요'); }
      if (e.target.id === 'revApply') await applyDraft(res, [...chosen], btn, '수정 제안을 적용했어요');
    };
  }

  // ---------- AI 일정 도우미: 만들기 · 추가 · 수정 요청을 한 창에서 고르기 ----------
  function openAiHelper() {
    const has = P.items.length > 0;
    const days = tripDays(trip());
    const dayLabel = P.day ? `${days.indexOf(P.day) + 1}일차 ${short(P.day)} (${wday(P.day)})` : '';
    const body = openSheet(`<h2>✨ AI 일정 도우미</h2>
      <p class="muted" style="margin-top:-6px">AI가 만든 내용은 바로 저장되지 않아요. 미리 보고 고른 것만 반영해요.</p>
      <div class="choice-list">
        <button class="choice" data-h="generate"><span class="ic">🗓️</span><span><b>전체 일정 만들기</b><small>여행지·이동 수단·취향으로 날짜별 초안을 만들어요${has ? '. 지금 일정은 그대로 두고 더해요' : ''}</small></span></button>
        <button class="choice" data-h="add"><span class="ic">＋</span><span><b>일정 추가 추천</b><small>${esc(dayLabel)} 빈 시간에, 지금 동선에서 가까운 곳으로 추천해요</small></span></button>
        <button class="choice" data-h="revise" ${has ? '' : 'disabled'}><span class="ic">🪄</span><span><b>일정 수정 요청</b><small>${has ? '바뀌는 내용을 전후로 비교하고 고른 것만 적용해요' : '일정이 생기면 쓸 수 있어요'}</small></span></button>
      </div>`);
    body.onclick = (e) => {
      const h = e.target.closest('[data-h]:not([disabled])')?.dataset.h;
      if (h === 'generate') openGenerate();
      else if (h === 'add') openAiAdd();
      else if (h === 'revise') openRevise();
    };
  }

  // ---------- 더보기: 멤버·초대 / 여행 정보 수정 / 다른 여행 일정 불러오기 ----------
  function openMore() {
    const body = openSheet(`<h2>더보기</h2>
      <div class="choice-list">
        <button class="choice" data-m="members"><span class="ic">👥</span><span><b>멤버·초대</b><small>초대 링크 보내기, 멤버 관리, 여행 나가기·삭제</small></span></button>
        <button class="choice" data-m="edit"><span class="ic">✏️</span><span><b>여행 정보 수정</b><small>이름·종류·날짜</small></span></button>
        <button class="choice" data-m="import"><span class="ic">📥</span><span><b>다른 여행 일정 불러오기</b><small>예전 여행 계획을 이 여행 날짜에 맞춰 복사해요</small></span></button>
      </div>`);
    body.onclick = (e) => {
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (m === 'members') openTrip(P.tripId);
      else if (m === 'edit') openTripForm(trip());
      else if (m === 'import') openImport();
    };
  }

  // ---------- 다른 여행 일정 불러오기 (날짜는 이 여행 1일차부터 차례로 맞춤, 지금 일정은 그대로) ----------
  async function openImport() {
    const target = trip();
    const days = tripDays(target);
    if (!days.length) { toast('먼저 여행 날짜를 정해 주세요'); openTripForm(target); return; }
    const body = openSheet(`<h2>📥 다른 여행 일정 불러오기</h2>
      <p class="muted" style="margin-top:-6px">‘${esc(target.title)}’ (${days.length}일)에 넣어요. 지금 있는 일정은 그대로예요.</p>
      <div id="impBody"><div class="hint">불러오는 중…</div></div>`);
    let rows;
    try { rows = await pq(sb.from('itinerary_items').select('trip_id, day_date').neq('trip_id', P.tripId)); } catch (err) {
      $('#impBody', body).innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
      return;
    }
    const counts = {};
    for (const r of rows) counts[r.trip_id] = (counts[r.trip_id] || 0) + 1;
    const list = state.trips.filter((t) => counts[t.id]);
    if (!body.isConnected) return;
    $('#impBody', body).innerHTML = list.length ? list.map((t) => `<button class="card trip-card" data-src="${t.id}">
        <div class="thumb">${kindIcon(t.kind)}</div>
        <div class="body"><b>${esc(t.title)}</b><small>📅 ${fmtRange(t.start_date, t.end_date)} · 일정 ${counts[t.id]}개</small></div></button>`).join('')
      : '<div class="empty small">불러올 수 있는 다른 여행 일정이 없어요</div>';
    body.onclick = async (e) => {
      const b = e.target.closest('[data-src]');
      if (b) return previewImport(body, state.trips.find((t) => t.id === Number(b.dataset.src)), days);
      if (e.target.id === 'impBack') return openImport();
    };
  }

  async function previewImport(body, src, days) {
    const items = await pq(sb.from('itinerary_items').select('*').eq('trip_id', src.id).order('day_date').order('sort_order').order('id'));
    const srcDays = tripDays(src).length ? tripDays(src) : [...new Set(items.map((i) => i.day_date))].sort();
    const mapped = items.map((i) => ({ i, to: days[srcDays.indexOf(i.day_date)] })).filter((x) => x.to);
    const skipped = items.length - mapped.length;
    const perDay = days.map((d, k) => [k + 1, d, mapped.filter((x) => x.to === d).length]).filter((x) => x[2]);
    $('#impBody', body).innerHTML = `<div class="notice">‘${esc(src.title)}’ 일정 <b>${mapped.length}개</b>를 넣어요${skipped ? ` · ${skipped}개는 이 여행 기간을 넘어서 빼요` : ''}</div>
      <ul class="imp-days">${perDay.map(([k, d, c]) => `<li>${k}일차 ${short(d)} (${wday(d)}) · ${c}개</li>`).join('')}</ul>
      <small class="hint">시간·장소·메모를 그대로 복사해요. 불러온 뒤에는 이 여행 일정으로 따로 고칠 수 있어요.</small>
      <div class="sticky-actions"><button class="primary" id="impGo" ${mapped.length ? '' : 'disabled'}>일정 ${mapped.length}개 불러오기</button>
        <div class="btn-row"><button class="btn" id="impBack">← 다른 여행 고르기</button></div></div>`;
    $('#impGo', body).onclick = async (e) => {
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = '불러오는 중…';
      const base = {};
      for (const d of days) base[d] = dayItems(d).reduce((m, x) => Math.max(m, x.sort_order), 0);
      const rows = mapped.map(({ i, to }) => ({
        trip_id: P.tripId, day_date: to, sort_order: ++base[to], item_type: i.item_type, title: i.title,
        start_time: i.start_time, end_time: i.end_time, place_name: i.place_name, address: i.address, lat: i.lat, lng: i.lng,
        verification_status: i.verification_status, cost_estimate: i.cost_estimate, currency: i.currency, notes: i.notes, source: i.source,
        ...(state.v011 && i.transit ? { transit: i.transit } : {}),
      }));
      try {
        await pq(sb.from('itinerary_items').insert(rows).select('id'));
        closeSheet();
        await reload();
        toast(`일정 ${rows.length}개를 불러왔어요`);
      } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = `일정 ${mapped.length}개 불러오기`; }
    };
  }

  // ---------- AI로 일정 추가 (지금 일정은 그대로, 겹치지 않게·가까운 곳으로 추천 → 고른 것만 추가) ----------
  function openAiAdd() {
    const days = tripDays(trip());
    if (!days.length) { toast('먼저 여행 날짜를 정해 주세요'); openTripForm(trip()); return; }
    const day0 = days.includes(P.day) ? P.day : days[0];
    const body = openSheet(`<h2>✨ AI로 일정 추가</h2>
      <p class="muted" style="margin-top:-6px">지금 일정과 시간이 겹치지 않고 동선에서 가까운 곳으로 추천해요. 지금 일정과 기록은 바뀌지 않아요.</p>
      <form id="aiAddForm" autocomplete="off">
        <label class="field"><span>날짜</span><select name="day">${days.map((d, i) => `<option value="${d}" ${d === day0 ? 'selected' : ''}>${i + 1}일차 ${short(d)} (${wday(d)}) · 일정 ${dayItems(d).length}개</option>`).join('')}</select></label>
        <label class="field"><span>무엇을 추가할까요? <small>300자</small></span>
          <textarea name="instruction" maxlength="300" rows="2" required placeholder="예: 근처 카페 추가해 줘"></textarea></label>
        <div class="cands">${['근처 카페 추가해 줘', '오후 일정 추천해 줘', '저녁 맛집 추천해 줘', '비 오면 갈 만한 곳'].map((x) => `<button type="button" class="cand" data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <button class="primary" type="submit" style="margin-top:12px">추천 받기</button>
        <small class="hint">여행지·이동 수단·취향은 ‘AI 일정 만들기’ 때 적은 조건을 써요.</small>
      </form>
      <div id="aiAddOut"></div>`);
    const f = $('#aiAddForm', body);
    f.onclick = (e) => { const ex = e.target.closest('[data-ex]'); if (ex) f.instruction.value = ex.dataset.ex; };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const instruction = f.instruction.value.trim();
      if (!instruction) return;
      const out = $('#aiAddOut', body);
      const day = f.day.value;
      f.classList.add('hidden');
      out.innerHTML = '<div class="ai-loading"><div class="spinner"></div><b>AI가 추천할 일정을 찾고 있어요…</b><small>지금 일정은 바뀌지 않아요.</small></div>';
      try {
        const res = await callAI({ action: 'revise', mode: 'ADD', tripId: P.tripId, targetDay: day, instruction, baseRevision: P.revision });
        if (body.isConnected) showAddPreview(body, res, day);
      } catch (err) {
        if (!body.isConnected) return;
        out.innerHTML = aiErrorHtml(err);
        if (err.code === 'REVISION_CONFLICT') reload();
        out.onclick = (ev) => {
          const a = ev.target.closest('[data-ai]')?.dataset.ai;
          if (a === 'retry') { f.classList.remove('hidden'); out.innerHTML = ''; }
          if (a === 'manual') openItemForm(null);
        };
      }
    };
  }

  const mins = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
  /** 추천 일정이 지금 일정과 시간이 겹치는지, 지금 동선(좌표 있는 일정)에서 얼마나 먼지 */
  function annotateAdd(o) {
    const it = o.item;
    const same = dayItems(it.date);
    const s0 = mins(it.startTime);
    const e0 = it.endTime ? mins(it.endTime) : s0 != null ? s0 + 60 : null;
    if (s0 != null) {
      o.conflict = o.conflict || same.some((x) => {
        const s1 = mins(hhmm(x.start_time));
        if (s1 == null) return false;
        const e1 = x.end_time ? mins(hhmm(x.end_time)) : s1 + 60;
        return s0 < e1 && s1 < e0;
      });
    }
    if (o.distanceKm == null && it.lat != null) {
      const pts = same.filter((x) => x.lat != null);
      if (pts.length) o.distanceKm = Math.round(Math.min(...pts.map((x) => distM({ lat: it.lat, lng: it.lng }, x))) / 100) / 10;
    }
    return o;
  }

  function showAddPreview(body, res, day) {
    const out = $('#aiAddOut', body);
    // 추가만 받음 (지금 일정을 고치거나 지우는 제안은 보여 주지 않음)
    const ops = (res.operations || []).filter((o) => o.op === 'add' && o.item).map(annotateAdd);
    const chosen = new Set(ops.filter((o) => !o.conflict).map((o) => o.opId));
    out.innerHTML = `<h3>추천 일정 <small class="muted">(아직 추가 안 됨)</small></h3>
      ${res.warnings?.length ? `<div class="notice warn"><ul>${res.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
      ${ops.length ? ops.map((o) => {
        const it = o.item;
        return `<label class="draft-item">
          <input type="checkbox" data-op="${esc(o.opId)}" ${chosen.has(o.opId) ? 'checked' : ''}>
          <span class="pi-time">${it.startTime ? `${esc(it.startTime)}${it.endTime ? `<br><small>~${esc(it.endTime)}</small>` : ''}` : '<small>시간<br>미정</small>'}</span>
          <span class="pi-body"><span class="pi-title">${typeIcon(it.type)} <b>${esc(it.title)}</b></span>
            <span class="pi-meta">
              ${it.placeName && it.placeName !== it.title ? `<span>📍 ${esc(it.placeName)}</span>` : ''}
              ${PLACE_TYPES.includes(it.type) && it.placeQuery ? (it.verificationStatus === 'VERIFIED' ? '<span class="vbadge ok">✓ 장소 확인</span>' : '<span class="vbadge warn">⚠ 미확인 장소</span>') : ''}
              ${o.distanceKm != null ? `<span>📏 지금 동선에서 약 ${o.distanceKm}km</span>${o.distanceKm > 10 ? '<span class="vbadge warn">동선에서 멀어요</span>' : ''}` : ''}
              ${it.estimatedCost != null ? `<span>💰 약 ${money(it.estimatedCost, it.currency)} (AI 추정)</span>` : ''}
              ${it.transit ? `<span class="pv-move">${transitText(it.transit)}</span>` : ''}
              ${o.conflict ? '<span class="vbadge warn">⚠ 지금 일정과 시간이 겹쳐요</span>' : ''}
            </span>
            ${o.reason || it.reason ? `<span class="pi-reason">💬 ${esc(o.reason || it.reason)}</span>` : ''}</span>
        </label>`;
      }).join('') : '<div class="empty small">추천할 일정을 찾지 못했어요. 요청을 조금 바꿔 보세요.</div>'}
      <div class="sticky-actions">
        ${ops.length ? `<button class="primary" id="addApply" ${chosen.size ? '' : 'disabled'}>선택한 일정 ${chosen.size}개 추가</button>` : ''}
        <div class="btn-row"><button class="btn" id="addRetry">다시 요청</button><button class="btn" id="addCancel">취소</button></div>
      </div>`;
    const btn = $('#addApply', out);
    out.onchange = (e) => {
      const c = e.target.closest('[data-op]');
      if (!c) return;
      if (c.checked) chosen.add(c.dataset.op); else chosen.delete(c.dataset.op);
      btn.textContent = `선택한 일정 ${chosen.size}개 추가`;
      btn.disabled = !chosen.size;
    };
    out.onclick = async (e) => {
      if (e.target.id === 'addCancel') { await discard(res.draftId); closeSheet(); toast('추가하지 않았어요. 일정은 그대로예요'); }
      if (e.target.id === 'addRetry') { await discard(res.draftId); out.innerHTML = ''; $('#aiAddForm', body).classList.remove('hidden'); }
      if (e.target.id === 'addApply') {
        P.day = day;
        await applyDraft(res, [...chosen], btn, `일정 ${chosen.size}개를 추가했어요`);
      }
    };
  }

  // ---------- 지출 ----------
  function openExpenseForm(x) {
    const days = tripDays(trip());
    const body = openSheet(`<h2>${x ? '지출 수정' : '지출 추가'}</h2>
      <form id="expForm" autocomplete="off">
        <div class="seg mini-seg" role="radiogroup">
          <label><input type="radio" name="is_actual" value="1" ${x?.is_actual === false ? '' : 'checked'}><span>실제 지출</span></label>
          <label><input type="radio" name="is_actual" value="0" ${x?.is_actual === false ? 'checked' : ''}><span>예상 비용</span></label>
        </div>
        <label class="field"><span>내용</span><input name="title" maxlength="60" required value="${esc(x?.title || '')}" placeholder="예: KTX 왕복"></label>
        <div class="grid2">
          <label class="field"><span>금액</span><input type="number" name="amount" min="0" step="any" inputmode="decimal" required value="${x?.amount ?? ''}"></label>
          <label class="field"><span>통화</span><input name="currency" maxlength="3" value="${esc(x?.currency || 'KRW')}" autocapitalize="characters"></label>
        </div>
        <div class="grid2">
          <label class="field"><span>분류</span><select name="category">${Object.entries(EXP_CATS).map(([k, [e, l]]) => `<option value="${k}" ${k === (x?.category || 'FOOD') ? 'selected' : ''}>${e} ${l}</option>`).join('')}</select></label>
          <label class="field"><span>날짜</span><select name="spent_on"><option value="">없음</option>${days.map((d, i) => `<option value="${d}" ${d === (x ? x.spent_on : P.day) ? 'selected' : ''}>${i + 1}일차 ${short(d)}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>연결할 일정 (선택)</span><select name="itinerary_item_id"><option value="">없음</option>
          ${P.items.map((i) => `<option value="${i.id}" ${i.id === x?.itinerary_item_id ? 'selected' : ''}>${short(i.day_date)} ${esc(i.title)}</option>`).join('')}</select></label>
        <button class="primary" type="submit">저장</button>
        ${x ? '<button type="button" class="btn danger" id="expDel" style="margin-top:10px;width:100%">삭제</button>' : ''}
      </form>`);
    const f = $('#expForm', body);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const amount = Number(f.amount.value);
      if (f.amount.value === '' || !Number.isFinite(amount) || amount < 0) return toast('금액은 0 이상으로 입력해 주세요');
      const currency = (f.currency.value || 'KRW').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) return toast('통화는 KRW, USD, JPY처럼 3글자로 입력해 주세요');
      const row = {
        title: f.title.value.trim(), amount, currency, category: f.category.value,
        is_actual: f.is_actual.value === '1', spent_on: f.spent_on.value || null,
        itinerary_item_id: f.itinerary_item_id.value ? Number(f.itinerary_item_id.value) : null,
      };
      const btn = $('button[type=submit]', f);
      btn.disabled = true;
      try {
        if (x) await changed(sb.from('trip_expenses').update(row).eq('id', x.id).select('id'));
        else await pq(sb.from('trip_expenses').insert({ trip_id: P.tripId, ...row }).select('id'));
        closeSheet();
        await reload();
        toast('지출을 저장했어요');
      } catch (err) { toast(err.message); btn.disabled = false; }
    };
    const del = $('#expDel', body);
    if (del) del.onclick = async () => {
      if (!confirm('이 지출을 삭제할까요?')) return;
      try {
        await changed(sb.from('trip_expenses').delete().eq('id', x.id).select('id'));
        closeSheet();
        await reload();
      } catch (err) { toast(err.message); }
    };
  }

  // ---------- 준비물 ----------
  async function toggleCheck(id, checked, input) {
    const c = P.checklist.find((x) => x.id === id);
    try {
      await changed(sb.from('checklist_items').update({ checked }).eq('id', id).select('id'));
      c.checked = checked;
      render();
    } catch (err) { input.checked = !checked; toast(err.message); }
  }
  async function deleteCheck(id) {
    try {
      await changed(sb.from('checklist_items').delete().eq('id', id).select('id'));
      P.checklist = P.checklist.filter((x) => x.id !== id);
      render();
    } catch (err) { toast(err.message); }
  }
  async function addDefaultChecks() {
    const have = new Set(P.checklist.map((c) => c.title));
    const todo = DEFAULT_CHECKLIST.filter((t) => !have.has(t));
    if (!todo.length) return toast('기본 준비물이 이미 다 있어요');
    const max = P.checklist.reduce((m, c) => Math.max(m, c.sort_order), 0);
    try {
      const rows = await pq(sb.from('checklist_items').insert(todo.map((title, i) => ({ trip_id: P.tripId, title, sort_order: max + i + 1 }))).select());
      P.checklist.push(...rows);
      render();
      toast(`${rows.length}개를 넣었어요`);
    } catch (err) { toast(err.message); }
  }

  // ---------- 타임라인 등 다른 화면에서 쓰는 입구 (같은 일정 데이터를 고침) ----------
  async function ensure(tripId) {
    if (P.tripId !== tripId || P.loadedFor !== tripId) await loadTrip(tripId);
  }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (err) { toast(err.message === 'NEEDS_MIGRATION' ? 'DB 설정(migrate-004)이 먼저 필요해요' : err.message); } };
  window.Planner = {
    openItem: guard(async (item) => {
      if (!item) return;
      await ensure(item.trip_id);
      P.day = item.day_date;
      openItemForm(P.items.find((x) => x.id === item.id) || item);
    }),
    addManual: guard(async (tripId) => { await ensure(tripId); openItemForm(null); }),
    /** 지도에서 고른 위치·기록한 장소를 일정으로: at = { lat, lng, name?, placeId?, day? } */
    addAt: guard(async (tripId, at) => {
      await ensure(tripId);
      const days = tripDays(trip());
      if (!days.length) { toast('여행 날짜를 먼저 정해 주세요'); return; }
      if (at.day && days.includes(at.day)) P.day = at.day;
      if (!days.includes(P.day)) P.day = days.includes(today()) ? today() : days[0];
      openItemForm(null, {
        place: { place_name: at.name || '지도에서 고른 위치', address: null, lat: at.lat, lng: at.lng, verification_status: at.name ? 'VERIFIED' : 'MANUAL' },
        title: at.name || '', placeId: at.placeId, lookup: !at.name,
      });
    }),
    addWithAI: guard(async (tripId) => { await ensure(tripId); openAiAdd(); }),
  };

  // ---------- 연결 ----------
  bind();
  window.addEventListener('travel:view', (e) => { P.sel = null; if (e.detail === 'timeline') load(); else { dayMap?.remove(); dayMap = null; } });
  window.addEventListener('travel:refresh', () => {
    if (P.tripId !== (state.filter === 'all' ? null : state.filter)) P.sel = null;
    // 여행을 바꾸거나 여행 정보(날짜)를 고친 뒤
    if (state.view === 'timeline') load(true);
    else P.loadedFor = null;
  });
  // 지도에서 일정 상태를 바꾼 뒤
  window.addEventListener('travel:plans', async () => {
    if (state.view !== 'timeline' || !P.tripId) { P.loadedFor = null; return; }
    try { await loadTrip(P.tripId); } catch (err) { P.error = err; P.loadedFor = null; }
    render();
  });
  window.addEventListener('online', () => { if (state.view === 'timeline') render(); });
  window.addEventListener('offline', () => { if (state.view === 'timeline') render(); });
})();
