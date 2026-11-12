// 타임라인 드래그 순서 변경 → 시간 자동 재계산 (docs/plan-time.js, 명세 3장·4장·TC-04~07·13·15)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.runInNewContext(readFileSync(new URL('../docs/plan-time.js', import.meta.url), 'utf8'), ctx);
const { recalcTimes, toMin, estimateTransit } = ctx.PlanTime;
const t = (id, s, e) => ({ id, start_time: s ? `${s}:00` : null, end_time: e ? `${e}:00` : null });
const view = (r, ids) => ids.map((id) => `${r.times[id].start}~${r.times[id].end}`);

test('명세 3-2 예시: C를 2번째로 옮기면 소요 시간·간격 유지, 첫 시작 고정', () => {
  const items = [t('A', '11:00', '11:10'), t('B', '12:00', '13:30'), t('C', '14:00', '15:00')];
  const r = recalcTimes(items, ['A', 'C', 'B']);
  assert.equal(r.ok, true);
  assert.deepEqual(view(r, ['A', 'C', 'B']), ['11:00~11:10', '12:00~13:00', '13:30~15:00']);
  assert.deepEqual([...r.changed].sort(), ['B', 'C']);
});

test('첫 일정이 바뀌어도 첫 시작 시간(11:00)은 그대로, 위치별 간격 적용', () => {
  const items = [t('A', '11:00', '11:10'), t('B', '12:00', '13:30'), t('C', '14:00', '15:00')];
  const r = recalcTimes(items, ['C', 'A', 'B']);
  // C 60분 → 12:00 끝, +50분 → A 12:50~13:00, +30분 → B 13:30~15:00
  assert.deepEqual(view(r, ['C', 'A', 'B']), ['11:00~12:00', '12:50~13:00', '13:30~15:00']);
});

test('여러 번 옮겨도 오차가 쌓이지 않음 (원래 순서로 돌아오면 원래 시간)', () => {
  let items = [t('A', '09:05', '09:47'), t('B', '10:13', '11:59'), t('C', '12:31', '12:32'), t('D', '13:00', '14:17')];
  const orig = items.map((x) => `${x.start_time}-${x.end_time}`);
  for (const order of [['B', 'A', 'C', 'D'], ['D', 'C', 'B', 'A'], ['C', 'A', 'D', 'B'], ['A', 'B', 'C', 'D']]) {
    const r = recalcTimes(items, order);
    assert.equal(r.ok, true);
    items = order.map((id) => ({ id, start_time: `${r.times[id].start}:00`, end_time: `${r.times[id].end}:00` }));
  }
  assert.deepEqual(items.map((x) => `${x.start_time}-${x.end_time}`), orig);
});

test('예외: 시간 없는 일정 → 재계산 안 함 (missing)', () => {
  const r = recalcTimes([t('A', '10:00', '11:00'), t('B', '12:00', null), t('C', null, null)], ['B', 'A', 'C']);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing');
  assert.deepEqual([...r.ids], ['B', 'C']);
});

test('예외: 원래 시간이 겹침(간격이 음수) → 고치지 않고 알려 줌 (overlap)', () => {
  const r = recalcTimes([t('A', '10:00', '11:30'), t('B', '11:00', '12:00')], ['B', 'A']);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'overlap');
  assert.deepEqual([...r.ids], ['A', 'B']);
});

test('자정을 넘지 않음: 소요 시간·간격 합이 같아서 마지막 일정의 끝 시간은 항상 그대로', () => {
  const items = [t('A', '20:00', '20:10'), t('B', '22:00', '23:50'), t('C', '23:52', '23:58')];
  for (const order of [['B', 'A', 'C'], ['C', 'B', 'A'], ['B', 'C', 'A']]) {
    const r = recalcTimes(items, order);
    assert.equal(r.ok, true);
    assert.equal(r.times[order[2]].end, '23:58');
    assert.ok(order.every((id) => r.times[id].endMin < 24 * 60));
  }
});

test('예외: 목록이 맞지 않으면 거부 (mismatch), 분 변환', () => {
  assert.equal(recalcTimes([t('A', '10:00', '11:00')], ['A', 'B']).reason, 'mismatch');
  assert.equal(toMin('09:05:00'), 545);
  assert.equal(toMin(null), null);
});

// ---------- 이동 수단·시간을 거리로 계산 ----------
const P0 = { lat: 36.4646, lng: 127.1265 };
const at = (dLatM) => ({ lat: P0.lat + dLatM / 111320, lng: P0.lng }); // 북쪽으로 dLatM 미터
const plain = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);

test('이동 계산: 1.2km 안쪽은 걸어서 (택시라고 해도), 시간은 거리로', () => {
  const r = plain(estimateTransit(P0, at(900), 'PUBLIC_TRANSIT', { mode: 'TAXI', minutes: 15, detail: '택시로', steps: [] }));
  assert.equal(r.mode, 'WALK');
  assert.equal(r.minutes, 16); // 900m × 1.3 / 75
  assert.equal(r.detail, null, '수단이 바뀌면 예전 설명은 지움');
  assert.equal(r.est, 'DIST');
});

test('이동 계산: 걸어서 30분이 넘으면 여행 조건 교통수단으로, 긴 이동(기차)은 그대로', () => {
  const r = plain(estimateTransit(P0, at(4300), 'TAXI', { mode: 'WALK', minutes: 10, detail: '', steps: [] }));
  assert.equal(r.mode, 'TAXI');
  assert.equal(r.minutes, 14); // 3 + 5590/500 ≈ 14
  const far = plain(estimateTransit(P0, at(2045), 'PUBLIC_TRANSIT', { mode: 'WALK', minutes: 15 }));
  assert.deepEqual([far.mode, far.minutes], ['BUS', 20], '2km(걸어서 약 35분)는 버스로');
  const near = plain(estimateTransit(P0, at(1500), 'PUBLIC_TRANSIT', { mode: 'WALK', minutes: 10 }));
  assert.deepEqual([near.mode, near.minutes], ['WALK', 26], '1.5km 는 걸어서 약 26분 그대로');
  assert.equal(estimateTransit(P0, at(50000), 'CAR', { mode: 'TRAIN', minutes: 240 }), null);
  assert.equal(estimateTransit(P0, { lat: null, lng: null }, 'CAR', { mode: 'BUS' }), null, '위치가 없으면 계산 안 함');
});

test('이동 계산: 같은 수단이면 설명·단계 유지, 순서가 바뀐 구간은 지움', () => {
  const old = { mode: 'BUS', minutes: 20, detail: '터미널에서 시내버스', steps: ['터미널 앞 탑승', '하차'] };
  const keep = plain(estimateTransit(P0, at(3000), 'PUBLIC_TRANSIT', old));
  assert.equal(keep.mode, 'BUS');
  assert.equal(keep.minutes, 25); // 13 + 3900/300 = 26 → 25
  assert.deepEqual(keep.steps, ['터미널 앞 탑승', '하차']);
  const moved = plain(estimateTransit(P0, at(3000), 'PUBLIC_TRANSIT', old, true));
  assert.equal(moved.detail, null);
  assert.deepEqual(moved.steps, []);
});
