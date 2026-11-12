// 타임라인 드래그 순서 변경 → 시간 자동 재계산 (docs/plan-time.js, 명세 3장·4장·TC-04~07·13·15)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.runInNewContext(readFileSync(new URL('../docs/plan-time.js', import.meta.url), 'utf8'), ctx);
const { recalcTimes, toMin } = ctx.PlanTime;
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
