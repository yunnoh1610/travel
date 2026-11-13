// 지도 탭 계산 부분 (docs/map-view.js 의 MapCore): 날짜-방문순서 번호 · 가까운 마커 묶기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.runInNewContext(readFileSync(new URL('../docs/map-view.js', import.meta.url), 'utf8'), ctx);
const { clusterPixels, visitLabels, dayNumber, durText } = ctx.MapCore;
const obj = (m) => Object.fromEntries(m);

test('번호는 여행 시작일 기준 "날짜-방문순서" (취소한 일정은 번호 없음)', () => {
  const plans = [
    { id: 1, day: '2026-11-03', cancelled: false },
    { id: 2, day: '2026-11-03', cancelled: true },
    { id: 3, day: '2026-11-03', cancelled: false },
    { id: 4, day: '2026-11-04', cancelled: false },
  ];
  const r = visitLabels(plans, [], '2026-11-03');
  assert.deepEqual(obj(r.plan), { 1: '1-1', 3: '1-2', 4: '2-1' });
});

test('시작일부터 세요: 첫 일정이 둘째 날이면 2-1', () => {
  const r = visitLabels([{ id: 9, day: '2026-11-04', cancelled: false }], [], '2026-11-03');
  assert.equal(r.plan.get(9), '2-1');
});

test('일정에 연결된 기록은 그 일정 번호, 연결 안 된 기록은 그날 일정 뒤에 이어서', () => {
  const plans = [{ id: 1, day: '2026-11-03' }, { id: 2, day: '2026-11-03' }];
  const recs = [{ id: 10, day: '2026-11-03', planId: 2 }, { id: 11, day: '2026-11-03', planId: null }, { id: 12, day: '2026-11-05', planId: null }];
  const r = visitLabels(plans, recs, '2026-11-03');
  assert.equal(r.rec.get(10), '1-2');
  assert.equal(r.rec.get(11), '1-3');
  assert.equal(r.rec.get(12), '3-1');
});

test('타임라인 순서를 바꾸면 번호도 따라 바뀌어요 (공산성 · 카페 · 무령왕릉 → 공산성 · 무령왕릉 · 카페)', () => {
  const d = '2026-11-03';
  const before = visitLabels([{ id: 1, day: d }, { id: 2, day: d }, { id: 3, day: d }], [], d);
  const after = visitLabels([{ id: 1, day: d }, { id: 3, day: d }, { id: 2, day: d }], [], d);
  assert.deepEqual(obj(before.plan), { 1: '1-1', 2: '1-2', 3: '1-3' });
  assert.deepEqual(obj(after.plan), { 1: '1-1', 3: '1-2', 2: '1-3' });
});

test('시작일이 없거나 시작일 전 날짜면 날짜 순서로', () => {
  assert.equal(dayNumber('2026-11-05', null, ['2026-11-01', '2026-11-05']), 2);
  assert.equal(dayNumber('2026-10-30', '2026-11-01', ['2026-10-30', '2026-11-01']), 1);
  assert.equal(dayNumber('2026-11-10', '2026-11-01', []), 10);
});

test('가까운 점끼리 묶고 먼 점은 따로', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 300, y: 0 }, { x: 20, y: -15 }, { x: 305, y: 30 }];
  assert.deepEqual(JSON.parse(JSON.stringify(clusterPixels(pts, 40))), [[0, 1, 3], [2, 4]]);
  assert.equal(clusterPixels(pts, 5).length, 5);
});

test('같은 자리에 있는 점은 아무리 작은 반경이어도 하나로 (→ 최대 확대 때 펼치기)', () => {
  assert.equal(clusterPixels([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }], 1).length, 1);
});

test('소요 시간 글자', () => {
  assert.equal(durText(90), '1시간 30분');
  assert.equal(durText(60), '1시간');
  assert.equal(durText(45), '45분');
  assert.equal(durText(0), '');
});
