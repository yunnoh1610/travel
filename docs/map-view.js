'use strict';
// =====================================================================
// 지도 탭 (2026-11 지도 UI/UX 개선)
//   · 작은 원형 마커 안에 "날짜-방문순서" 번호 (1-2 = 첫째 날 두 번째 장소, 여행 시작일 기준)
//   · 가까운 마커는 "N곳" 그룹 마커로 묶고, 누르면 확대 → 최대로 확대해도 겹치면 둥글게 펼치기
//   · 전체/예정/완료 + 날짜(전체 날짜·1일차·2일차…) 거르기, 날짜별로 따로 잇는 점선 경로
//   · 마커를 누르면 선택 강조 + 하단 장소 카드 (상세보기 · 타임라인에서 보기)
// 일정·기록 데이터는 읽기만 해요 (저장 방식·순서는 그대로). 타임라인에서 순서를 바꾸면
// refreshPlans → renderMap 으로 번호와 경로가 바로 다시 그려져요.
// 위쪽(MapCore)은 계산만 하는 부분이라 Node 테스트에서도 써요 (tests/map-view.test.mjs).
// =====================================================================
(function (root) {
  /**
   * 화면 픽셀 좌표 [{x, y}] 를 반경 r 안끼리 묶기. 입력 순서대로, 그룹의 첫 점이 기준이라 결과가 흔들리지 않아요.
   * 돌려줌: [[인덱스…], …] (그룹마다 입력 순서)
   */
  function clusterPixels(pts, r) {
    const groups = [];
    pts.forEach((p, i) => {
      const g = groups.find((c) => Math.hypot(c.x - p.x, c.y - p.y) <= r);
      if (g) g.idx.push(i);
      else groups.push({ x: p.x, y: p.y, idx: [i] });
    });
    return groups.map((g) => g.idx);
  }

  /** 여행 시작일 기준 몇째 날인지. 시작일이 없거나 시작일 전이면 days(정렬된 날짜 목록) 안의 순서 */
  function dayNumber(day, start, days) {
    if (start && day >= start) {
      const n = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${String(start).slice(0, 10)}T00:00:00Z`)) / 86400000) + 1;
      if (n >= 1) return n;
    }
    return days.indexOf(day) + 1;
  }

  /**
   * 날짜-방문순서 번호
   *   plans: 타임라인 순서(날짜·sort_order)대로 [{ id, day, cancelled }] — 취소한 일정은 번호 없음
   *   records: 방문 순서대로 [{ id, day, planId }] — 일정에 연결된 기록은 그 일정 번호, 아니면 그날 일정 뒤에 이어서
   * 돌려줌: { plan: Map(id → '1-2'), rec: Map(id → '1-5') }
   */
  function visitLabels(plans, records, start) {
    const days = [...new Set([...plans.map((p) => p.day), ...records.map((r) => r.day)])].filter(Boolean).sort();
    const count = new Map();
    const next = (day) => { const n = (count.get(day) || 0) + 1; count.set(day, n); return `${dayNumber(day, start, days)}-${n}`; };
    const plan = new Map();
    for (const p of plans) if (!p.cancelled && p.day) plan.set(p.id, next(p.day));
    const rec = new Map();
    for (const r of records) {
      if (!r.day) continue;
      rec.set(r.id, (r.planId != null && plan.get(r.planId)) || next(r.day));
    }
    return { plan, rec };
  }

  /** "1시간 30분" */
  function durText(min) {
    if (!Number.isFinite(min) || min <= 0) return '';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h ? `${h}시간` : ''}${h && m ? ' ' : ''}${m ? `${m}분` : ''}`;
  }

  const api = { clusterPixels, visitLabels, dayNumber, durText };
  root.MapCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ---------------------------------------------------------------------
// 브라우저 부분 (app.js 의 state · map · openPlace · openPlanSheet … 를 씀)
// ---------------------------------------------------------------------
if (typeof window !== 'undefined' && typeof L !== 'undefined') {
  const MC = window.MapCore;
  const GROUP_R = 40; // 이 픽셀 안에 있는 마커끼리 묶어요 (마커 지름 30px + 여유)
  const DAY_COLORS = ['#6e5fae', '#e0628a', '#14a38b', '#f08c2e', '#3b82f6', '#a0522d', '#c026d3', '#64748b'];
  const dayColor = (n) => DAY_COLORS[(Math.max(1, n) - 1) % DAY_COLORS.length];
  const VM = {
    bound: false, entries: [], byKey: new Map(), sel: null, spider: null,
    routeLayer: null, mkLayer: null, spiderLayer: null, markers: new Map(), dayNo: new Map(), single: false,
  };
  const ll = (e) => L.latLng(e.lat, e.lng);
  const shortDate = (d) => fmtDate(d).replace(/^\d+년 /, '');

  function bind() {
    if (VM.bound) return;
    VM.bound = true;
    VM.routeLayer = L.layerGroup().addTo(map);
    VM.mkLayer = L.layerGroup().addTo(map);
    VM.spiderLayer = L.layerGroup().addTo(map);
    map.on('zoomstart', () => closeSpider());
    map.on('zoomend', () => layout());
  }

  /** 지금 거르기에 맞는 지도 항목 [{ key, kind, lat, lng, day, label, st, title, it?, p? }] */
  function buildEntries() {
    const single = state.filter !== 'all';
    const t = single ? state.trips.find((x) => x.id === state.filter) : null;
    const planAll = single ? state.plans.filter((i) => i.trip_id === state.filter) : [];
    const recAll = state.places.slice().sort(byVisit);
    const labels = single ? MC.visitLabels(
      planAll.map((i) => ({ id: i.id, day: i.day_date, cancelled: planSt(i) === 'CANCELLED' })),
      recAll.map((p) => ({ id: p.id, day: visitKey(p), planId: p.plan_item_id ?? null })),
      t?.start_date,
    ) : { plan: new Map(), rec: new Map() };
    const planPts = planAll.filter((i) => i.lat != null);
    const days = single ? [...new Set([...planPts.map((i) => i.day_date), ...recAll.filter((p) => p.lat != null).map(visitKey)])].sort() : [];
    const allDays = [...new Set([...planAll.map((i) => i.day_date), ...recAll.map(visitKey)])].sort();
    VM.dayNo = new Map(days.map((d) => [d, MC.dayNumber(d, t?.start_date, allDays)]));
    if (state.mapDay && !days.includes(state.mapDay)) state.mapDay = '';
    const show = planPts.length ? state.mapShow : 'all';
    const onDay = (d) => !state.mapDay || d === state.mapDay;
    const out = [];
    if (show !== 'plan') {
      for (const p of recAll) {
        if (p.lat == null || !onDay(visitKey(p))) continue;
        out.push({ key: `r${p.id}`, kind: 'rec', p, lat: p.lat, lng: p.lng, day: visitKey(p), label: labels.rec.get(p.id) || '', st: 'done', title: p.title || p.name });
      }
    }
    for (const it of planPts) {
      if (!onDay(it.day_date) || recordsOfPlan(it.id).length) continue; // 기록이 연결된 일정은 기록 마커로
      const st = planSt(it);
      if (show === 'plan' ? st !== 'PLANNED' : show === 'done' ? st !== 'DONE' : false) continue;
      out.push({ key: `p${it.id}`, kind: 'plan', it, lat: it.lat, lng: it.lng, day: it.day_date, label: labels.plan.get(it.id) || '', st: st.toLowerCase(), title: it.title });
    }
    // 번호 순서 (날짜 → 방문순서), 번호 없는 것(취소)은 뒤로
    const ord = (e) => { const m = /^(\d+)-(\d+)$/.exec(e.label); return m ? Number(m[1]) * 1000 + Number(m[2]) : 1e9; };
    out.sort((a, b) => a.day.localeCompare(b.day) || ord(a) - ord(b));
    return { out, days, show, single, hasPlans: planPts.length > 0 };
  }

  function markerHtml(e) {
    const sel = VM.sel === e.key;
    if (!VM.single) {
      // 모든 여행: 번호 없이 종류 아이콘
      const icon = e.kind === 'rec' ? catIcon(e.p.category) : ic(PLAN_EMO[e.it.item_type] || '✨');
      return `<div class="mk mk-ic st-${e.st}${sel ? ' sel' : ''}">${icon}</div>`;
    }
    const lab = e.label || '×';
    return `<div class="mk st-${e.st}${e.kind === 'rec' ? ' rec' : ''}${lab.length >= 4 ? ' long' : ''}${sel ? ' sel' : ''}">${esc(lab)}</div>`;
  }
  const mkIcon = (html) => L.divIcon({ html, className: 'mk-wrap', iconSize: [40, 40], iconAnchor: [20, 20] });

  /** 확대 수준에 맞춰 묶기 · 풀기. 바뀐 마커만 더하고 빼서 깜빡이지 않아요 */
  function layout() {
    if (!VM.mkLayer) return;
    const z = map.getZoom();
    const spidered = VM.spider ? new Set(VM.spider.keys) : new Set();
    const list = VM.entries.filter((e) => !spidered.has(e.key));
    const groups = MC.clusterPixels(list.map((e) => map.project(ll(e), z)), GROUP_R).map((g) => g.map((i) => list[i]));
    const want = new Map();
    for (const g of groups) {
      if (g.length === 1) {
        const e = g[0];
        want.set(e.key, { html: markerHtml(e), at: ll(e), title: `${e.label ? `${e.label} ` : ''}${e.title}`, z: VM.sel === e.key ? 1000 : e.st === 'cancelled' ? -100 : 0, click: () => select(e.key) });
      } else {
        const key = `g:${g.map((e) => e.key).join(',')}`;
        const lat = g.reduce((s, e) => s + e.lat, 0) / g.length;
        const lng = g.reduce((s, e) => s + e.lng, 0) / g.length;
        const hasSel = g.some((e) => e.key === VM.sel);
        want.set(key, {
          html: `<div class="mk-group${hasSel ? ' sel' : ''}${g.length >= 10 ? ' big' : ''}">${g.length}곳</div>`, at: L.latLng(lat, lng),
          title: `가까운 장소 ${g.length}곳: ${g.map((e) => e.title).join(', ')}`, z: hasSel ? 900 : 500, click: () => openGroup(g),
        });
      }
    }
    for (const [k, m] of VM.markers) if (!want.has(k)) { VM.mkLayer.removeLayer(m); VM.markers.delete(k); }
    for (const [k, w] of want) {
      let m = VM.markers.get(k);
      if (!m) {
        m = L.marker(w.at, { icon: mkIcon(w.html), title: w.title, keyboard: true, riseOnHover: true, zIndexOffset: w.z });
        m._mkHtml = w.html;
        m.on('click', (ev) => { L.DomEvent.stopPropagation(ev); m._mkClick(); });
        m.addTo(VM.mkLayer);
        VM.markers.set(k, m);
      } else {
        if (m._mkHtml !== w.html) { m.setIcon(mkIcon(w.html)); m._mkHtml = w.html; }
        if (!m.getLatLng().equals(w.at)) m.setLatLng(w.at);
        m.setZIndexOffset(w.z);
        if (m.options.title !== w.title) { m.options.title = w.title; m.getElement()?.setAttribute('title', w.title); }
      }
      m._mkClick = w.click;
    }
  }

  /** 그룹 마커: 풀리는 데까지 확대, 최대로 확대해도 겹치면 둥글게 펼치기 */
  function openGroup(g) {
    const zMax = map.getMaxZoom();
    let zSplit = null;
    for (let z = map.getZoom() + 1; z <= zMax; z++) {
      if (MC.clusterPixels(g.map((e) => map.project(ll(e), z)), GROUP_R).length > 1) { zSplit = z; break; }
    }
    if (zSplit == null) { spiderfy(g); return; }
    const b = L.latLngBounds(g.map(ll));
    const fit = map.getBoundsZoom(b, false, L.point(80, 140));
    map.flyTo(b.getCenter(), Math.min(zMax, Math.max(zSplit, fit)), { duration: 0.45 });
  }

  function spiderfy(g) {
    closeSpider();
    const c = L.latLng(g.reduce((s, e) => s + e.lat, 0) / g.length, g.reduce((s, e) => s + e.lng, 0) / g.length);
    const cp = map.latLngToLayerPoint(c);
    const r = Math.max(42, g.length * 8);
    VM.spider = { keys: g.map((e) => e.key), markers: new Map() };
    g.forEach((e, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / g.length;
      const at = map.layerPointToLatLng(L.point(cp.x + r * Math.cos(a), cp.y + r * Math.sin(a)));
      L.polyline([c, at], { color: '#6e5fae', weight: 1.5, opacity: 0.6, interactive: false }).addTo(VM.spiderLayer);
      const m = L.marker(at, { icon: mkIcon(markerHtml(e)), title: `${e.label ? `${e.label} ` : ''}${e.title}`, keyboard: true, zIndexOffset: VM.sel === e.key ? 1100 : 800 });
      m.on('click', (ev) => { L.DomEvent.stopPropagation(ev); select(e.key, true); });
      m.addTo(VM.spiderLayer);
      VM.spider.markers.set(e.key, m);
    });
    L.marker(c, { icon: L.divIcon({ html: '<div class="mk-spider-c"></div>', className: 'mk-wrap', iconSize: [12, 12], iconAnchor: [6, 6] }), interactive: false }).addTo(VM.spiderLayer);
    layout();
  }
  function closeSpider() {
    if (!VM.spider) return false;
    VM.spider = null;
    VM.spiderLayer?.clearLayers();
    layout();
    return true;
  }

  /** 날짜별 경로: 같은 날만 방문 순서대로 점선으로 잇기. 선택한 장소의 날은 진하게, 다른 날은 흐리게 */
  function drawRoutes() {
    VM.routeLayer.clearLayers();
    if (!VM.single) return;
    const selDay = VM.byKey.get(VM.sel)?.day || null;
    const byDay = new Map();
    for (const e of VM.entries) {
      if (e.st === 'cancelled' || !e.label) continue;
      if (!byDay.has(e.day)) byDay.set(e.day, []);
      byDay.get(e.day).push(e);
    }
    for (const [d, list] of byDay) {
      if (list.length < 2) continue;
      const on = !selDay || selDay === d;
      L.polyline(list.map(ll), {
        color: dayColor(VM.dayNo.get(d) || 1), weight: on && selDay ? 4.5 : 3, opacity: on ? 0.85 : 0.22,
        dashArray: '6 8', lineCap: 'round', interactive: false,
      }).addTo(VM.routeLayer);
    }
  }

  // ---------- 선택 · 하단 카드 ----------
  function select(key, fromSpider) {
    const e = VM.byKey.get(key);
    if (!e) return;
    VM.sel = key;
    $('#map').classList.add('map-has-sel');
    if (fromSpider && VM.spider) {
      // 펼친 마커는 그대로 두고 선택 표시만 바꿔요
      for (const [k, m] of VM.spider.markers) { m.setIcon(mkIcon(markerHtml(VM.byKey.get(k)))); m.setZIndexOffset(k === key ? 1100 : 800); }
    } else closeSpider();
    layout();
    drawRoutes();
    showCard(e);
  }
  function clearSel() {
    if (!VM.sel) return false;
    VM.sel = null;
    $('#map')?.classList.remove('map-has-sel');
    if (VM.spider) for (const [k, m] of VM.spider.markers) { m.setIcon(mkIcon(markerHtml(VM.byKey.get(k)))); m.setZIndexOffset(800); }
    hideCard();
    layout();
    drawRoutes();
    return true;
  }
  function timeInfo(e) {
    const it = e.kind === 'plan' ? e.it : e.p.plan_item_id ? state.plans.find((i) => i.id === e.p.plan_item_id) : null;
    const parts = [];
    if (it?.start_time) {
      const s = window.PlanTime?.toMin(it.start_time);
      const en = window.PlanTime?.toMin(it.end_time);
      const dur = s != null && en != null && en > s ? MC.durText(en - s) : '';
      parts.push(`🕒 ${hhmm(it.start_time)}${it.end_time ? ` – ${hhmm(it.end_time)}` : ''}${dur ? ` · ${dur}` : ''}`);
    } else if (e.kind === 'plan') parts.push('<span class="muted">🕒 시간 미정</span>');
    if (e.kind === 'rec' && e.p.visited_time) parts.push(`📷 ${hhmm(e.p.visited_time)} 방문`);
    return parts.join('<br>');
  }
  function showCard(e) {
    const view = $('#view-map');
    let card = $('#mapCard');
    if (!card) {
      view.insertAdjacentHTML('beforeend', '<div id="mapCard" class="map-card" role="dialog" aria-label="고른 장소"></div>');
      card = $('#mapCard');
      card.onclick = (ev) => {
        const a = ev.target.closest('[data-mc]')?.dataset.mc;
        const cur = VM.byKey.get(VM.sel);
        if (!a || !cur) return;
        if (a === 'close') { clearSel(); return; }
        if (a === 'detail') { if (cur.kind === 'rec') openPlace(cur.p.id); else openPlanSheet(cur.it); return; }
        if (a === 'timeline') {
          const it = cur.kind === 'plan' ? cur.it : state.plans.find((i) => i.id === cur.p.plan_item_id);
          if (!it) return;
          window.Planner?.focus?.(it);
          switchView('timeline');
        }
      };
    }
    const plan = e.kind === 'plan' ? e.it : e.p.plan_item_id ? state.plans.find((i) => i.id === e.p.plan_item_id) : null;
    const dn = VM.dayNo.get(e.day);
    const stLabel = e.kind === 'rec' ? '✓ 완료 · 기록' : e.st === 'done' ? '✓ 완료' : e.st === 'cancelled' ? '취소' : '예정';
    const th = e.kind === 'rec' ? e.p.photos?.[0]?.thumb : null;
    const sub = e.kind === 'rec' && e.p.title && e.p.title !== e.p.name ? e.p.name : e.kind === 'plan' && e.it.place_name && e.it.place_name !== e.it.title ? e.it.place_name : '';
    card.innerHTML = `<div class="mc-row">
        ${th ? `<img class="mc-thumb" src="${esc(th)}" alt="">` : ''}
        <div class="mc-main">
          <div class="mc-title">${VM.single && e.label ? `<span class="mc-no st-${e.st}">${esc(e.label)}</span>` : ''}<b>${esc(e.title)}</b></div>
          ${sub ? `<small class="muted mc-sub">📍 ${esc(sub)}</small>` : ''}
          <div class="mc-meta">${VM.single && dn ? `${dn}일차 · ` : ''}${esc(shortDate(e.day))}${e.label ? ` · ${esc(e.label.split('-')[1])}번째` : ''}
            <span class="mc-st st-${e.st}">${stLabel}</span></div>
          ${timeInfo(e) ? `<div class="mc-time">${timeInfo(e)}</div>` : ''}
        </div>
        <button type="button" class="mc-x" data-mc="close" aria-label="닫기">✕</button>
      </div>
      <div class="mc-actions">
        <button type="button" class="btn" data-mc="detail">상세보기</button>
        ${plan && VM.single ? '<button type="button" class="btn" data-mc="timeline">📋 타임라인에서 보기</button>' : ''}
      </div>`;
    card.classList.remove('hidden');
    document.body.classList.add('map-card-open');
    document.body.style.setProperty('--map-card-h', `${card.offsetHeight}px`);
  }
  function hideCard() {
    $('#mapCard')?.classList.add('hidden');
    document.body.classList.remove('map-card-open');
  }

  // ---------- 위쪽 거르기: 전체·예정·완료 + 날짜 칩 ----------
  function renderBar(days, show, hasPlans) {
    $('#view-map .map-bar')?.remove();
    if (!VM.single || !days.length) return;
    const chip = (v, label, on) => `<button type="button" class="day-pill ${on ? 'on' : ''}" data-mday="${v}" aria-pressed="${on}">${label}</button>`;
    $('#view-map').insertAdjacentHTML('beforeend', `<div class="map-bar">
      ${hasPlans ? `<div class="seg mini-seg" role="group" aria-label="지도에 보일 것">
        ${[['all', '전체'], ['plan', '예정'], ['done', '✓ 완료']].map(([k, l]) => `<button type="button" class="${show === k ? 'on' : ''}" data-mshow="${k}" aria-pressed="${show === k}">${l}</button>`).join('')}
      </div>` : ''}
      ${days.length > 1 ? `<div class="day-pills" role="group" aria-label="날짜">
        ${chip('', '전체 날짜', !state.mapDay)}
        ${days.map((d) => chip(d, `<i style="background:${dayColor(VM.dayNo.get(d))}"></i>${VM.dayNo.get(d)}일차`, d === state.mapDay)).join('')}
      </div>` : ''}
    </div>`);
    const bar = $('#view-map .map-bar');
    L.DomEvent.disableClickPropagation(bar);
    bar.onclick = (ev) => {
      const b = ev.target.closest('[data-mshow]');
      if (b) { state.mapShow = b.dataset.mshow; renderMap(true); return; }
      const d = ev.target.closest('[data-mday]');
      if (d) { state.mapDay = d.dataset.mday; renderMap(true); }
    };
    $('.day-pills .on', bar)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  /** 지도 다시 그리기 (app.js 의 refresh · refreshPlans · 테마 바꿈에서 불러요). fit: 보이는 장소에 맞춰 지도 옮기기 */
  window.renderMap = function renderMap(fit) {
    bind();
    markerLayer?.clearLayers();
    $('#view-map .map-empty')?.remove();
    const { out, days, show, single, hasPlans } = buildEntries();
    // 여행이 바뀌면 마커를 새로 (같은 여행이면 바뀐 것만 고쳐서 깜빡임 없이)
    if (VM.single !== single || VM.trip !== state.filter) {
      VM.mkLayer.clearLayers();
      VM.markers.clear();
      VM.sel = null;
    }
    VM.single = single;
    VM.trip = state.filter;
    VM.entries = out;
    VM.byKey = new Map(out.map((e) => [e.key, e]));
    VM.spider = null;
    VM.spiderLayer.clearLayers();
    if (VM.sel && !VM.byKey.has(VM.sel)) VM.sel = null;
    $('#map').classList.toggle('map-has-sel', !!VM.sel);
    if (VM.sel) showCard(VM.byKey.get(VM.sel)); else hideCard();
    renderBar(days, show, hasPlans);
    drawRoutes();
    if (!state.places.length && !hasPlans) {
      const msg = state.trips.length
        ? '아직 기록이 없어요. 오른쪽 아래 <b>＋</b> 버튼으로 첫 장소를 남겨보세요!'
        : '반가워요! 먼저 위쪽 <b>🧳</b> 버튼에서 여행을 만들고, 함께한 친구를 초대해 보세요.';
      $('#view-map').insertAdjacentHTML('beforeend', `<div class="map-empty">${msg}</div>`);
    } else if (fit && out.length) {
      // 다른 탭에 있을 때(지도가 숨겨진 동안) 애니메이션 오류 방지
      map.fitBounds(out.map(ll), { padding: [60, 60], paddingTopLeft: [40, single && days.length ? 110 : 60], maxZoom: 15, animate: false });
    }
    layout();
  };
  // 다른 탭에서는 ＋ 버튼을 원래 자리로
  window.addEventListener('travel:view', (ev) => {
    document.body.classList.toggle('map-card-open', ev.detail === 'map' && !!VM.sel && !$('#mapCard')?.classList.contains('hidden'));
  });
  /** 지도 빈 곳을 눌렀을 때: 펼친 마커·선택을 먼저 닫아요. 닫은 게 있으면 true */
  window.mapDismiss = () => closeSpider() || clearSel();
}
