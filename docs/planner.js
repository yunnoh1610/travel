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
    if (P.tripId !== id) return; // 그 사이 다른 기록장을 고름
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
  // 일정을 바꾼 뒤: 이 화면과 기록장 타임라인을 함께 새로 (같은 일정 데이터)
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
    if (!root || state.view !== 'trips') return;
    dayMap?.remove();
    dayMap = null;
    // 기록장 탭: 고른 기록장이 없으면 목록(app.js), 있으면 이 일정 화면. ＋(장소 기록) 버튼은 목록에서만
    const show = !!P.tripId;
    $('#tripsHome').classList.toggle('hidden', show);
    root.classList.toggle('hidden', !show);
    $('#fab').classList.toggle('hidden', show);
    if (!show) return;
    const t = trip();
    if (!t) { root.innerHTML = '<div class="empty">기록장을 찾을 수 없어요</div>'; return; }
    const head = `<div class="plan-nav">
        <button type="button" class="link" data-act="back">← 전체 기록장</button>
        <button type="button" class="chip-btn" data-act="members">👥 멤버·초대</button>
      </div>
      <div class="plan-head">
        <h2>${kindIcon(t.kind)} ${esc(t.title)}</h2>
        <small class="muted">📅 ${fmtRange(t.start_date, t.end_date)} · 👥 ${t.members.length}명</small>
      </div>
      <div class="seg plan-seg" role="tablist">
        ${[['days', '일자별 일정'], ['budget', '예산'], ['check', '준비물']].map(([k, label]) =>
          `<button type="button" role="tab" aria-selected="${P.tab === k}" class="${P.tab === k ? 'on' : ''}" data-tab="${k}">${label}</button>`).join('')}
      </div>
      ${navigator.onLine ? '' : '<div class="notice warn">오프라인이에요. 연결되면 다시 불러와 주세요.</div>'}`;
    if (P.loading) { root.innerHTML = `${head}<div class="empty"><div class="spinner"></div>불러오는 중…</div>`; return; }
    if (P.error) { root.innerHTML = head + errorHtml(P.error); return; }
    let body = '';
    if (P.tab === 'days') body = daysHtml(t);
    else if (P.tab === 'budget') body = budgetHtml(t);
    else body = checklistHtml();
    root.innerHTML = head + body;
    if (P.tab === 'days') drawDayMap();
  }

  function pickTripHtml(what) {
    if (!state.trips.length) {
      return `<div class="empty"><div class="big">${ic('📒')}</div>먼저 기록장을 만들어 주세요<br>
        <button class="chip-btn" data-act="new-trip" style="margin-top:12px">＋ 새 기록장</button></div>`;
    }
    return `<h2>${what} 볼 기록장을 골라 주세요</h2>
      <p class="muted" style="margin-top:-6px">위쪽 선택 칸에서 골라도 돼요.</p>
      ${state.trips.map((t) => `<button class="card trip-card" data-pick-trip="${t.id}">
        <div class="thumb">${kindIcon(t.kind)}</div>
        <div class="body"><b>${esc(t.title)}</b><small>📅 ${fmtRange(t.start_date, t.end_date)}</small></div></button>`).join('')}`;
  }
  window.PlannerShared = { pickTripHtml, tripDays, pq, money, hhmm, short, wday };

  function errorHtml(err) {
    if (err.code === 'NEEDS_MIGRATION') {
      return `<div class="notice warn"><b>새 기능을 쓰려면 DB 설정이 하나 더 필요해요.</b><br>
        Supabase SQL Editor에서 <code>supabase/migrate-004-planner-scrapbook.sql</code>을 실행해 주세요.</div>`;
    }
    return `<div class="notice error">${esc(err.message)}<br><button class="btn" data-act="reload" style="margin-top:8px">다시 불러오기</button></div>`;
  }

  // ----- 일자별 일정 -----
  const dayItems = (d) => P.items.filter((i) => i.day_date === d).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

  function daysHtml(t) {
    const days = tripDays(t);
    if (!days.length) {
      return `<div class="empty"><div class="big">🗓️</div>여행 날짜가 정해지지 않았어요<br>
        <small>날짜를 정하면 일자별 일정을 만들 수 있어요</small><br>
        <button class="chip-btn" data-act="edit-trip" style="margin-top:12px">📅 날짜 정하기</button></div>`;
    }
    const list = dayItems(P.day);
    const unknownCost = list.filter((i) => PLACE_TYPES.includes(i.item_type) && i.cost_estimate == null).length;
    const actions = P.items.length ? `
      <div class="plan-actions">
        <button class="primary ai-btn" data-act="ai-generate">✨ AI 일정 만들기</button>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn" data-act="add-item">＋ 일정 추가</button>
          <button class="btn" data-act="ai-add">✨ AI로 일정 추가</button>
          <button class="btn" data-act="ai-revise">🪄 AI에게 수정 요청</button>
        </div>
        <button type="button" class="link" data-act="import">📥 다른 기록장 일정 불러오기</button>
      </div>` : `
      <div class="start-card">
        <b>이 기록장의 일정을 만들어 볼까요?</b>
        <small class="muted">여기서 만든 일정은 기록장 타임라인에도 바로 보여요.</small>
        <div class="choice-list">
          <button class="choice" data-act="ai-generate"><span class="ic">✨</span><span><b>AI로 일정 만들기</b><small>여행지·이동 수단·취향을 알려 주면 날짜별 초안을 만들어요</small></span></button>
          <button class="choice" data-act="add-item"><span class="ic">＋</span><span><b>직접 일정 추가</b><small>시간·장소·예상 비용을 직접 적어요</small></span></button>
          <button class="choice" data-act="import"><span class="ic">📥</span><span><b>다른 기록장 일정 불러오기</b><small>예전에 만든 여행 계획을 이 기록장 날짜에 맞춰 복사해요</small></span></button>
        </div>
      </div>`;
    return `${actions}
      <div class="day-chips" role="tablist" aria-label="날짜">
        ${days.map((d, i) => `<button type="button" role="tab" aria-selected="${d === P.day}" class="day-chip ${d === P.day ? 'on' : ''}" data-day="${d}">
          <b>${i + 1}일차</b><small>${short(d)} (${wday(d)})</small>${P.items.some((x) => x.day_date === d) ? '<i class="dot"></i>' : ''}</button>`).join('')}
      </div>
      <h3 class="tl-date">${fmtDate(P.day)}</h3>
      ${list.some((i) => i.lat != null) ? '<div id="planMap" class="mini-map plan-map" aria-label="이날 일정 지도"></div>' : ''}
      ${list.length ? `<ol class="plan-list">${list.map((it, idx) => itemHtml(it, idx, list.length)).join('')}</ol>`
        : `<div class="empty small">이날 일정이 아직 없어요.<br><small>‘일정 추가’로 직접 넣거나 AI에게 만들어 달라고 해 보세요.</small></div>`}
      ${unknownCost ? `<small class="hint">💡 예상 비용이 없는 일정 ${unknownCost}개는 예산 합계에서 빠져요 (금액 미확인).</small>` : ''}`;
  }

  function vBadge(it) {
    if (!PLACE_TYPES.includes(it.item_type) && !it.place_name) return '';
    if (it.verification_status === 'VERIFIED') return '<span class="vbadge ok" title="지도 검색에서 실제 장소를 찾았어요 (영업시간·요금은 확인 안 됨)">✓ 장소 확인</span>';
    if (it.verification_status === 'MANUAL') return '<span class="vbadge" title="직접 입력한 장소">직접 입력</span>';
    return '<span class="vbadge warn" title="실제 장소와 맞춰 보지 못했어요. 방문 전에 확인해 주세요">⚠ 미확인 장소</span>';
  }

  function itemHtml(it, idx, n) {
    const time = it.start_time ? `${hhmm(it.start_time)}${it.end_time ? `<br><small>~${hhmm(it.end_time)}</small>` : ''}` : '<small>시간<br>미정</small>';
    return `<li class="plan-item" data-item="${it.id}">
      <div class="pi-time">${time}</div>
      <div class="pi-body">
        <div class="pi-title">${typeIcon(it.item_type)} <b>${esc(it.title)}</b></div>
        <div class="pi-meta">
          <span>${typeLabel(it.item_type)}</span>
          ${it.place_name && it.place_name !== it.title ? `<span>📍 ${esc(it.place_name)}</span>` : ''}
          ${it.cost_estimate != null ? `<span>💰 ${money(it.cost_estimate, it.currency)}${it.source === 'AI' && !it.user_edited ? ' (AI 추정)' : ''}</span>` : ''}
          ${vBadge(it)}
          ${it.source === 'AI' ? `<span class="vbadge ai" title="AI가 만든 일정${it.user_edited ? ' · 직접 고침' : ''}">AI${it.user_edited ? '·고침' : ''}</span>` : ''}
        </div>
        ${it.notes ? `<div class="pi-notes">${esc(it.notes)}</div>` : ''}
      </div>
      <div class="pi-tools">
        <button class="icon-btn" data-move="-1" ${idx === 0 ? 'disabled' : ''} aria-label="위로">▲</button>
        <button class="icon-btn" data-move="1" ${idx === n - 1 ? 'disabled' : ''} aria-label="아래로">▼</button>
        <button class="icon-btn" data-edit aria-label="수정">✏️</button>
      </div>
    </li>`;
  }

  function drawDayMap() {
    const box = $('#planMap');
    if (!box) return;
    const pts = dayItems(P.day).map((it, i) => ({ ...it, no: i + 1 })).filter((i) => i.lat != null);
    setTimeout(() => {
      if (!box.isConnected) return;
      dayMap = L.map(box, { zoomControl: false, attributionControl: false, scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(dayMap);
      pts.forEach((p) => L.marker([p.lat, p.lng], {
        icon: L.divIcon({ html: `<div class="pin small ${p.verification_status === 'VERIFIED' ? '' : 'unverified'}">${p.no}</div>`, className: 'pin-wrap', iconSize: [30, 30], iconAnchor: [15, 30] }),
        title: p.title,
      }).addTo(dayMap));
      if (pts.length > 1) drawRoute(pts.map((p) => [p.lat, p.lng]), dayMap);
      dayMap.fitBounds(pts.map((p) => [p.lat, p.lng]), { padding: [30, 30], maxZoom: 15 });
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
    root.addEventListener('click', async (e) => {
      const pick = e.target.closest('[data-pick-trip]');
      if (pick) { state.filter = Number(pick.dataset.pickTrip); refresh(true); return; }
      const tab = e.target.closest('[data-tab]');
      if (tab) { P.tab = tab.dataset.tab; render(); return; }
      const day = e.target.closest('[data-day]');
      if (day) { P.day = day.dataset.day; render(); return; }
      const pp = e.target.closest('[data-pp]');
      if (pp) { P.perPerson = pp.dataset.pp === '1'; render(); return; }
      const item = e.target.closest('[data-item]');
      if (item && e.target.closest('[data-move]')) { await moveItem(Number(item.dataset.item), Number(e.target.closest('[data-move]').dataset.move)); return; }
      if (item && e.target.closest('[data-edit]')) { openItemForm(P.items.find((x) => x.id === Number(item.dataset.item))); return; }
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
      else if (act === 'add-expense') openExpenseForm(null);
      else if (act === 'ck-defaults') addDefaultChecks();
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
  function openItemForm(it) {
    const t = trip();
    const days = tripDays(t);
    let place = it ? { place_name: it.place_name, address: it.address, lat: it.lat, lng: it.lng, verification_status: it.verification_status } : null;
    let placeTouched = false; // 장소를 바꾸지 않으면 검증 상태(미확인 등)를 그대로 둠
    const tripPlaces = state.places.filter((p) => p.trip_id === P.tripId);
    const body = openSheet(`<h2>${it ? '일정 수정' : '일정 추가'}</h2>
      <form id="itemForm" autocomplete="off">
        <div class="grid2">
          <label class="field"><span>날짜</span><select name="day_date">${days.map((d, i) => `<option value="${d}" ${d === (it?.day_date || P.day) ? 'selected' : ''}>${i + 1}일차 ${short(d)} (${wday(d)})</option>`).join('')}</select></label>
          <label class="field"><span>종류</span><select name="item_type">${Object.entries(ITYPES).map(([k, [e, l]]) => `<option value="${k}" ${k === (it?.item_type || 'PLACE') ? 'selected' : ''}>${e} ${l}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>일정 이름 <small>80자</small></span><input name="title" maxlength="80" required value="${esc(it?.title || '')}" placeholder="예: 공산성 산책"></label>
        <div class="grid2">
          <label class="field"><span>시작</span><input type="time" name="start_time" value="${hhmm(it?.start_time)}"></label>
          <label class="field"><span>끝</span><input type="time" name="end_time" value="${hhmm(it?.end_time)}"></label>
        </div>
        <div class="field"><span>장소 (선택)</span>
          <div id="placeNow"></div>
          <div class="search-row"><input name="q" maxlength="60" placeholder="장소 이름 검색" enterkeyhint="search"><button type="button" id="plSearch">검색</button></div>
          <div id="plResults" class="results"></div>
          ${tripPlaces.length ? `<label class="field" style="margin:8px 0 0"><span>기록한 장소와 연결</span><select name="place_id"><option value="">연결 안 함</option>
            ${tripPlaces.map((p) => `<option value="${p.id}" ${p.id === it?.place_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
        </div>
        <div class="grid2">
          <label class="field"><span>1인 예상 비용</span><input type="number" name="cost" min="0" step="any" inputmode="decimal" value="${it?.cost_estimate ?? ''}" placeholder="모르면 비워 두기"></label>
          <label class="field"><span>통화</span><input name="currency" maxlength="3" value="${esc(it?.currency || 'KRW')}" autocapitalize="characters"></label>
        </div>
        <label class="field"><span>메모</span><textarea name="notes" maxlength="500" rows="2">${esc(it?.notes || '')}</textarea></label>
        <button class="primary" type="submit">${it ? '저장' : '추가'}</button>
        ${it ? '<button type="button" class="btn danger" id="itemDel" style="margin-top:10px;width:100%">이 일정 삭제</button>' : ''}
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
      if (start && end && end < start) return toast('끝 시간이 시작보다 빨라요. 자정을 넘기면 다음 날 일정으로 나눠 주세요');
      const cost = f.cost.value === '' ? null : Number(f.cost.value);
      if (cost != null && (!Number.isFinite(cost) || cost < 0)) return toast('비용은 0 이상으로 입력해 주세요');
      const currency = (f.currency.value || 'KRW').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) return toast('통화는 KRW, USD, JPY처럼 3글자로 입력해 주세요');
      const placeId = f.place_id?.value ? Number(f.place_id.value) : null;
      let pl = place;
      if (pl?.lat == null && placeId && placeId !== it?.place_id) { // 기록한 장소와 새로 연결하면 그 위치를 씀
        const p = tripPlaces.find((x) => x.id === placeId);
        if (p) { pl = { place_name: p.name, address: null, lat: p.lat, lng: p.lng, verification_status: 'VERIFIED' }; placeTouched = true; }
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

  async function moveItem(id, dir) {
    const list = dayItems(P.day);
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    try {
      await pq(sb.rpc('reorder_itinerary', { p_trip_id: P.tripId, p_day: P.day, p_ids: list.map((x) => x.id) }));
      await reload();
      el().querySelector(`[data-item="${id}"] [data-move="${dir}"]`)?.focus();
    } catch (err) { toast(err.message); if (err.code === 'PT409') reload(); }
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
      ${unverified ? `<div class="notice">⚠ 실제 장소를 찾지 못한 일정 ${unverified}개는 <b>미확인</b>으로 표시돼요.</div>` : ''}
      ${res.days.map((d, di) => `<div class="draft-day"><h4>${di + 1}일차 · ${fmtDate(d.date)}</h4>
        ${d.items.length ? d.items.map((it) => `<label class="draft-item">
          <input type="checkbox" data-tmp="${esc(it.temporaryId)}" checked>
          <span class="pi-time">${it.startTime ? `${esc(it.startTime)}${it.endTime ? `<br><small>~${esc(it.endTime)}</small>` : ''}` : '<small>시간<br>미정</small>'}</span>
          <span class="pi-body"><span class="pi-title">${typeIcon(it.type)} <b>${esc(it.title)}</b></span>
            <span class="pi-meta">
              ${it.placeName && it.placeName !== it.title ? `<span>📍 ${esc(it.placeName)}</span>` : ''}
              ${PLACE_TYPES.includes(it.type) && it.placeQuery ? (it.verificationStatus === 'VERIFIED' ? '<span class="vbadge ok">✓ 장소 확인</span>' : '<span class="vbadge warn">⚠ 미확인 장소</span>') : ''}
              ${it.estimatedCost != null ? `<span>💰 약 ${money(it.estimatedCost, it.currency)} (AI 추정)</span>` : ''}
            </span>
            ${it.notes ? `<span class="pi-notes">${esc(it.notes)}</span>` : ''}</span>
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

  // ---------- 다른 기록장 일정 불러오기 (날짜는 이 기록장 1일차부터 차례로 맞춤, 지금 일정은 그대로) ----------
  async function openImport() {
    const target = trip();
    const days = tripDays(target);
    if (!days.length) { toast('먼저 여행 날짜를 정해 주세요'); openTripForm(target); return; }
    const body = openSheet(`<h2>📥 다른 기록장 일정 불러오기</h2>
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
      : '<div class="empty small">불러올 수 있는 다른 기록장 일정이 없어요</div>';
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
    $('#impBody', body).innerHTML = `<div class="notice">‘${esc(src.title)}’ 일정 <b>${mapped.length}개</b>를 넣어요${skipped ? ` · ${skipped}개는 이 기록장 기간을 넘어서 빼요` : ''}</div>
      <ul class="imp-days">${perDay.map(([k, d, c]) => `<li>${k}일차 ${short(d)} (${wday(d)}) · ${c}개</li>`).join('')}</ul>
      <small class="hint">시간·장소·메모를 그대로 복사해요. 불러온 뒤에는 이 기록장 일정으로 따로 고칠 수 있어요.</small>
      <div class="sticky-actions"><button class="primary" id="impGo" ${mapped.length ? '' : 'disabled'}>일정 ${mapped.length}개 불러오기</button>
        <div class="btn-row"><button class="btn" id="impBack">← 다른 기록장 고르기</button></div></div>`;
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
              ${o.conflict ? '<span class="vbadge warn">⚠ 지금 일정과 시간이 겹쳐요</span>' : ''}
            </span>
            ${o.reason ? `<span class="pi-notes">💬 ${esc(o.reason)}</span>` : ''}</span>
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
    addWithAI: guard(async (tripId) => { await ensure(tripId); openAiAdd(); }),
  };

  // ---------- 연결 ----------
  bind();
  window.addEventListener('travel:view', (e) => { if (e.detail === 'trips') load(); else { dayMap?.remove(); dayMap = null; } });
  window.addEventListener('travel:refresh', () => {
    // 기록장을 바꾸거나 기록장 정보(날짜)를 고친 뒤
    if (state.view === 'trips') load(true);
    else P.loadedFor = null;
  });
  window.addEventListener('online', () => { if (state.view === 'trips') render(); });
  window.addEventListener('offline', () => { if (state.view === 'trips') render(); });
})();
