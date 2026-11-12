'use strict';
// =====================================================================
// 타임라인 순서 변경 시 시간 자동 재계산 (드래그 앤 드롭 명세 3장)
//   · 첫 일정의 시작 시간은 고정
//   · 일정마다 원래 소요 시간(duration) 유지
//   · 일정 사이 간격(gap)은 "순서 위치"에 귀속 — 순서가 바뀌어도 같은 위치에는 같은 간격
//   startTime[0] = 원래 첫 시작, endTime[i] = startTime[i] + duration[i], startTime[i] = endTime[i-1] + gap[i-1]
//   · 모두 정수 분으로 계산해서 여러 번 옮겨도 오차가 쌓이지 않아요
// 예외: 시간이 없는 일정(missing) · 원래 시간이 겹침(overlap) · 자정을 넘김(overflow) → 시간은 바꾸지 않아요
// 브라우저(window.PlanTime)와 Node 테스트에서 같이 써요.
// =====================================================================
(function (root) {
  const toMin = (t) => {
    if (!t) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  /**
   * items: 원래 순서의 그날 일정 [{ id, start_time, end_time }]
   * newIds: 바뀐 순서의 id 목록 (같은 일정들)
   * 돌려줌: { ok: true, times: { id: { start, end } }, changed: [id…] }
   *       또는 { ok: false, reason: 'missing' | 'overlap' | 'overflow' | 'mismatch', ids: [...] }
   */
  function recalcTimes(items, newIds) {
    const byId = new Map(items.map((it) => [it.id, it]));
    if (newIds.length !== items.length || newIds.some((id) => !byId.has(id))) return { ok: false, reason: 'mismatch', ids: [] };
    const s = items.map((it) => toMin(it.start_time));
    const e = items.map((it) => toMin(it.end_time));
    const missing = items.filter((_, i) => s[i] == null || e[i] == null).map((it) => it.id);
    if (missing.length) return { ok: false, reason: 'missing', ids: missing };
    const dur = new Map(items.map((it, i) => [it.id, e[i] - s[i]]));
    const gaps = [];
    for (let i = 0; i < items.length - 1; i++) gaps.push(s[i + 1] - e[i]);
    const neg = gaps.map((g, i) => (g < 0 ? [items[i].id, items[i + 1].id] : null)).filter(Boolean);
    if (neg.length) return { ok: false, reason: 'overlap', ids: neg.flat() };
    const times = {};
    let cur = s[0];
    newIds.forEach((id, i) => {
      if (i > 0) cur += gaps[i - 1];
      const start = cur;
      const end = start + dur.get(id);
      times[id] = { start: toHHMM(start), end: toHHMM(end), startMin: start, endMin: end };
      cur = end;
    });
    const over = newIds.filter((id) => times[id].endMin > 24 * 60 - 1 || times[id].startMin > 24 * 60 - 1);
    if (over.length) return { ok: false, reason: 'overflow', ids: over };
    const changed = newIds.filter((id) => {
      const it = byId.get(id);
      return toHHMM(toMin(it.start_time)) !== times[id].start || toHHMM(toMin(it.end_time)) !== times[id].end;
    });
    return { ok: true, times, changed };
  }

  // =====================================================================
  // 일정 사이 이동 수단·시간을 실제 좌표(직선거리)로 계산
  //   AI는 장소 좌표를 모른 채 시간을 짐작해서(대부분 10~15분) 실제와 달라요. 위치가 확인된 뒤 거리로 바로잡아요.
  //   길 거리 ≈ 직선 × 1.3 · 걸어서 1분 75m · 택시·자동차 평균 시속 30km(20km 넘으면 60km) + 3분
  //   버스 시속 18km + 기다림·걷기 13분 · 지하철 시속 30km + 13분 · 자전거 시속 15km
  //   1.2km 안쪽은 걸어서, 걸어서 30분이 넘으면 여행 조건의 교통수단으로 · 기차·배·비행기는 그대로(긴 이동)
  // =====================================================================
  const PREF_MODE = { PUBLIC_TRANSIT: 'BUS', CAR: 'CAR', WALK: 'BUS', TAXI: 'TAXI', BIKE: 'BIKE', MIXED: 'BUS' };
  const LONG = ['TRAIN', 'FERRY', 'FLIGHT'];
  function haversine(a, b) {
    const R = 6371000;
    const r = (d) => (d * Math.PI) / 180;
    const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const round5 = (m) => (m > 20 ? Math.round(m / 5) * 5 : Math.round(m));
  function minutesFor(mode, route) {
    if (mode === 'WALK') return Math.max(1, Math.round(route / 75));
    if (mode === 'CAR' || mode === 'TAXI') return round5(3 + (route <= 20000 ? route / 500 : 40 + (route - 20000) / 1000));
    if (mode === 'BUS') return round5(13 + route / 300);
    if (mode === 'SUBWAY') return round5(13 + route / 500);
    if (mode === 'BIKE') return round5(Math.max(1, route / 250));
    return null;
  }
  /**
   * prev → it 이동을 거리로 계산. old: 지금 이동 정보, pref: 여행 조건 교통수단, segmentChanged: 순서가 바뀌어 앞 일정이 달라짐
   * 돌려줌: 새 이동 정보 { mode, minutes, detail, steps, est: 'DIST' } 또는 null(계산할 수 없음 · 바꿀 필요 없음)
   */
  function estimateTransit(prev, it, pref, old, segmentChanged) {
    if (!prev || prev.lat == null || prev.lng == null || it.lat == null || it.lng == null) return null;
    if (old && LONG.includes(old.mode)) return null;
    const route = haversine(prev, it) * 1.3;
    const walk = Math.max(1, Math.round(route / 75));
    let mode = old?.mode || null;
    if (route <= 1200) mode = 'WALK';
    else if (!mode || (mode === 'WALK' && walk > 30)) mode = PREF_MODE[pref] || 'BUS';
    const minutes = minutesFor(mode, route);
    const keepText = !segmentChanged && old && old.mode === mode;
    return { mode, minutes, detail: keepText ? old.detail || null : null, steps: keepText ? old.steps || [] : [], est: 'DIST' };
  }

  const api = { recalcTimes, toMin, toHHMM, estimateTransit, haversine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlanTime = api;
})(typeof window !== 'undefined' ? window : globalThis);
