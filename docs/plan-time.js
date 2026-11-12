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

  const api = { recalcTimes, toMin, toHHMM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlanTime = api;
})(typeof window !== 'undefined' ? window : globalThis);
