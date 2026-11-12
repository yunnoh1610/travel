// DB 마이그레이션·권한(RLS) 테스트
// 실제 Supabase 대신 PGlite(브라우저/Node용 PostgreSQL)에 Supabase의 역할·auth.uid()·storage 를 흉내 내고
// schema.sql → 002 → 003 → 004 를 실행한 뒤 권한·버전 충돌 시나리오를 확인해요.
// 실행: npm test   (node --test tests/)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8');
const A = '00000000-0000-0000-0000-00000000000a'; // 여행 만든 사람
const B = '00000000-0000-0000-0000-00000000000b'; // 멤버
const C = '00000000-0000-0000-0000-00000000000c'; // 남

let db;
let trip;      // A의 여행 (2026-11-21 ~ 11-23), B 멤버
let otherTrip; // C의 여행

// Supabase 흉내
const SUPABASE_STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage; create schema extensions;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', encrypted_password text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text);
alter table storage.objects enable row level security;
grant all on storage.objects to authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

async function as(uid, fn) {
  await db.exec(uid === 'service' ? 'set role service_role' : `set role authenticated; set request.jwt.claim.sub = '${uid}'`);
  try { return await fn(); } finally { await db.exec("reset role; set request.jwt.claim.sub = ''"); }
}
const rows = async (uid, text, params) => as(uid, async () => (await db.query(text, params)).rows);
async function fails(uid, text, params, re) {
  await assert.rejects(() => rows(uid, text, params), re);
}
const rev = async () => (await db.query('select revision from trip_plans where trip_id = $1', [trip])).rows[0]?.revision ?? 0;

before(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const f of ['schema.sql', 'migrate-002-username.sql', 'migrate-003-memories.sql', 'migrate-004-planner-scrapbook.sql']) {
    await db.exec(sql(f));
  }
  // 004 를 한 번 더 실행해도 안전한지
  await db.exec(sql('migrate-004-planner-scrapbook.sql'));
  await db.exec(sql('migrate-005-record-time-plan-link.sql'));
  await db.exec(sql('migrate-005-record-time-plan-link.sql'));
  await db.exec(sql('migrate-006-scrapbook-design.sql'));
  await db.exec(sql('migrate-006-scrapbook-design.sql'));
  await db.exec(sql('migrate-007-trip-info.sql'));
  await db.exec(sql('migrate-007-trip-info.sql'));

  for (const [id, name] of [[A, 'aa'], [B, 'bb'], [C, 'cc']]) {
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object('name', $3::text))",
      [id, `${name}@travel-diary.example.com`, name]);
  }
  trip = (await rows(A, "insert into trips (title, start_date, end_date) values ('공주 여행', '2026-11-21', '2026-11-23') returning id"))[0].id;
  otherTrip = (await rows(C, "insert into trips (title, start_date, end_date) values ('남의 여행', '2026-11-21', '2026-11-22') returning id"))[0].id;
  await rows(A, 'select * from add_member_by_username($1, $2)', [trip, 'bb']);
});

test('기존 기능: 장소 기록과 목록 뷰가 그대로 동작', async () => {
  const p = await rows(B, "insert into places (trip_id, name, lat, lng) values ($1, '공산성', 36.46, 127.12) returning id", [trip]);
  assert.ok(p[0].id);
  const list = await rows(B, 'select id, place_count from trip_list where id = $1', [trip]);
  assert.equal(Number(list[0].place_count), 1);
  assert.equal((await rows(C, 'select id from places where trip_id = $1', [trip])).length, 0);
});

test('일정: 멤버는 추가·수정, 남은 볼 수도 쓸 수도 없음 (TC-09)', async () => {
  const r0 = await rev();
  const it = await rows(B, "insert into itinerary_items (trip_id, day_date, title, start_time) values ($1, '2026-11-21', '공산성 산책', '14:00') returning id, created_by", [trip]);
  assert.equal(it[0].created_by, B);
  assert.equal(await rev(), r0 + 1, '일정이 바뀌면 버전이 올라가야 함');
  assert.equal((await rows(C, 'select * from itinerary_items where trip_id = $1', [trip])).length, 0);
  await fails(C, "insert into itinerary_items (trip_id, day_date, title) values ($1, '2026-11-21', 'x')", [trip], /row-level security/);
  assert.equal((await rows(C, "update itinerary_items set title = 'hack' where trip_id = $1 returning id", [trip])).length, 0);
  assert.equal((await rows(C, 'delete from itinerary_items where trip_id = $1 returning id', [trip])).length, 0);
  // 멤버 A 는 B 가 쓴 일정을 고칠 수 있음 (함께 쓰는 계획)
  assert.equal((await rows(A, "update itinerary_items set title = '공산성 한 바퀴', user_edited = true where id = $1 returning id", [it[0].id])).length, 1);
  // 바꾸면 안 되는 칸
  await fails(A, 'update itinerary_items set trip_id = $1 where id = $2', [otherTrip, it[0].id], /permission denied/);
  await fails(A, "update itinerary_items set source = 'AI' where id = $1", [it[0].id], /permission denied/);
});

test('일정: 여행 기간 밖·시간 역순·음수 비용은 거부 (TC-04 검증)', async () => {
  await fails(B, "insert into itinerary_items (trip_id, day_date, title) values ($1, '2026-11-24', 'x')", [trip], /여행 기간 밖/);
  await fails(B, "insert into itinerary_items (trip_id, day_date, title, start_time, end_time) values ($1, '2026-11-21', 'x', '15:00', '14:00')", [trip], /itinerary_time_order/);
  await fails(B, "insert into itinerary_items (trip_id, day_date, title, cost_estimate) values ($1, '2026-11-21', 'x', -1)", [trip], /check constraint/);
  // 위치 없는 일정 허용
  assert.equal((await rows(B, "insert into itinerary_items (trip_id, day_date, title, item_type) values ($1, '2026-11-22', '버스 이동', 'MOVE') returning id", [trip])).length, 1);
});

test('일정 순서 바꾸기는 그날 일정 전체를 한 번에', async () => {
  const ids = (await rows(B, "select id from itinerary_items where trip_id = $1 and day_date = '2026-11-21' order by sort_order", [trip])).map((r) => r.id);
  const extra = (await rows(B, "insert into itinerary_items (trip_id, day_date, title) values ($1, '2026-11-21', '카페') returning id", [trip]))[0].id;
  const order = [extra, ...ids];
  await rows(B, 'select reorder_itinerary($1, $2, $3)', [trip, '2026-11-21', order]);
  const now = (await rows(B, "select id from itinerary_items where trip_id = $1 and day_date = '2026-11-21' order by sort_order", [trip])).map((r) => r.id);
  assert.deepEqual(now, order);
  await fails(B, 'select reorder_itinerary($1, $2, $3)', [trip, '2026-11-21', ids], /바뀌었어요/);
  await fails(C, 'select reorder_itinerary($1, $2, $3)', [trip, '2026-11-21', order], /접근할 수 없어요/);
});

async function makeDraft(kind, result, owner = A) {
  const r = await rev();
  const d = await rows('service', `insert into ai_drafts (trip_id, created_by, kind, request_json, result_json, base_revision)
    values ($1, $2, $3, '{}', $4, $5) returning id`, [trip, owner, kind, JSON.stringify(result), r]);
  return { id: d[0].id, rev: r };
}
const genResult = {
  days: [{ date: '2026-11-22', items: [
    { temporaryId: 'tmp-1', date: '2026-11-22', type: 'PLACE', title: '무령왕릉', startTime: '10:00', endTime: '11:30', verificationStatus: 'VERIFIED', lat: 36.46, lng: 127.11, placeName: '무령왕릉과 왕릉원', estimatedCost: 3000, currency: 'KRW', notes: null },
    { temporaryId: 'tmp-2', date: '2026-11-22', type: 'MEAL', title: '국밥', startTime: '12:00', endTime: '13:00', verificationStatus: 'UNVERIFIED', estimatedCost: null, currency: 'KRW', notes: '운영시간 확인 필요' },
  ] }],
};

test('AI 초안 적용: 만든 사람만, 고른 항목만, 한 번만 (TC-07, TC-08)', async () => {
  const d = await makeDraft('GENERATE', genResult);
  // 클라이언트는 초안을 만들 수 없음
  await fails(A, "insert into ai_drafts (trip_id, created_by, kind, request_json, result_json, base_revision) values ($1, $2, 'GENERATE', '{}', '{}', 0)", [trip, A], /permission denied/);
  // 다른 멤버(B)는 A의 초안을 보지도 적용하지도 못함
  assert.equal((await rows(B, 'select id from ai_drafts where id = $1', [d.id])).length, 0);
  await fails(B, 'select * from apply_ai_draft($1, $2, $3)', [d.id, ['tmp-1'], d.rev], /적용할 수 없어요/);
  await fails(C, 'select * from apply_ai_draft($1, $2, $3)', [d.id, ['tmp-1'], d.rev], /적용할 수 없어요/);
  // 버전이 다르면 거부
  await fails(A, 'select * from apply_ai_draft($1, $2, $3)', [d.id, ['tmp-1'], d.rev - 1], /바뀌었어요/);
  const before = (await rows(A, 'select count(*)::int n from itinerary_items where trip_id = $1', [trip]))[0].n;
  const r = await rows(A, 'select * from apply_ai_draft($1, $2, $3)', [d.id, ['tmp-1'], d.rev]);
  assert.equal(r[0].inserted, 1);
  const after = await rows(A, "select title, source, verification_status, lat from itinerary_items where trip_id = $1 and day_date = '2026-11-22' and source = 'AI'", [trip]);
  assert.equal(after.length, 1);
  assert.equal(after[0].title, '무령왕릉');
  assert.equal(after[0].verification_status, 'VERIFIED');
  assert.equal((await rows(A, 'select count(*)::int n from itinerary_items where trip_id = $1', [trip]))[0].n, before + 1);
  await fails(A, 'select * from apply_ai_draft($1, $2, $3)', [d.id, ['tmp-2'], r[0].revision], /이미 적용/);
});

test('AI 초안: 초안을 만든 뒤 다른 기기에서 일정을 고치면 충돌 (TC-08)', async () => {
  const d = await makeDraft('GENERATE', genResult);
  await rows(B, "insert into itinerary_items (trip_id, day_date, title) values ($1, '2026-11-23', '다른 기기에서 추가') ", [trip]);
  await fails(A, 'select * from apply_ai_draft($1, $2, $3)', [d.id, ['tmp-1'], d.rev], /바뀌었어요/);
  // 취소(버리기)하면 일정은 그대로 (TC-07)
  const n0 = (await rows(A, 'select count(*)::int n from itinerary_items where trip_id = $1', [trip]))[0].n;
  await rows(A, 'select discard_ai_draft($1)', [d.id]);
  assert.equal((await rows(A, 'select status from ai_drafts where id = $1', [d.id]))[0].status, 'DISCARDED');
  assert.equal((await rows(A, 'select count(*)::int n from itinerary_items where trip_id = $1', [trip]))[0].n, n0);
});

test('AI 부분 수정: 수정·삭제·추가 중 고른 것만, 나머지는 보존', async () => {
  const day = await rows(A, "select id, title from itinerary_items where trip_id = $1 and day_date = '2026-11-22' order by sort_order", [trip]);
  const target = day.find((x) => x.title === '무령왕릉');
  const keep = day.find((x) => x.title === '버스 이동');
  const d = await makeDraft('REVISE', { operations: [
    { opId: 'op-1', op: 'update', itemId: target.id, before: { date: '2026-11-22' }, item: { date: '2026-11-22', type: 'PLACE', title: '무령왕릉 (오전)', startTime: '09:30', endTime: '11:00', verificationStatus: 'VERIFIED', lat: 36.46, lng: 127.11, currency: 'KRW' } },
    { opId: 'op-2', op: 'delete', itemId: keep.id },
    { opId: 'op-3', op: 'add', item: { date: '2026-11-22', type: 'CAFE', title: '카페 휴식', startTime: '15:00', endTime: '16:00', verificationStatus: 'UNVERIFIED', currency: 'KRW' } },
  ] });
  // op-2(삭제)는 고르지 않음
  const r = await rows(A, 'select * from apply_ai_draft($1, $2, $3)', [d.id, ['op-1', 'op-3'], d.rev]);
  assert.deepEqual([r[0].inserted, r[0].updated, r[0].deleted], [1, 1, 0]);
  const now = await rows(A, "select title from itinerary_items where trip_id = $1 and day_date = '2026-11-22' order by sort_order", [trip]);
  assert.deepEqual(now.map((x) => x.title), ['무령왕릉 (오전)', '국밥', '카페 휴식', '버스 이동'].filter((t) => now.some((x) => x.title === t)));
  assert.ok(now.some((x) => x.title === '버스 이동'), '고르지 않은 삭제는 적용되면 안 됨');
  // 다른 여행의 일정 id를 넣은 초안은 아무것도 못 고침
  const otherItem = (await rows(C, "insert into itinerary_items (trip_id, day_date, title) values ($1, '2026-11-21', 'C 일정') returning id", [otherTrip]))[0].id;
  const bad = await makeDraft('REVISE', { operations: [{ opId: 'op-x', op: 'delete', itemId: otherItem }] });
  await fails(A, 'select * from apply_ai_draft($1, $2, $3)', [bad.id, ['op-x'], bad.rev], /이미 없어요/);
  assert.equal((await rows(C, 'select id from itinerary_items where id = $1', [otherItem])).length, 1);
});

test('AI 사용 기록은 앱에서 읽을 수 없음', async () => {
  await rows('service', "insert into ai_request_log (user_id, trip_id, feature, status) values ($1, $2, 'generate', 'ok')", [A, trip]);
  await fails(A, 'select * from ai_request_log', [], /permission denied/);
});

test('지출: 음수 금지, 쓴 사람/여행 주인만 수정·삭제 (Phase 4)', async () => {
  await fails(B, "insert into trip_expenses (trip_id, title, amount) values ($1, 'x', -100)", [trip], /check constraint/);
  const e = (await rows(B, "insert into trip_expenses (trip_id, title, amount, category) values ($1, '버스표', 12000, 'TRANSPORT') returning id", [trip]))[0].id;
  assert.equal((await rows(C, 'select id from trip_expenses where trip_id = $1', [trip])).length, 0);
  await fails(C, "insert into trip_expenses (trip_id, title, amount) values ($1, 'x', 1)", [trip], /row-level security/);
  const e2 = (await rows(A, "insert into trip_expenses (trip_id, title, amount) values ($1, '숙소', 80000) returning id", [trip]))[0].id;
  assert.equal((await rows(B, 'update trip_expenses set amount = 1 where id = $1 returning id', [e2])).length, 0, 'B는 A의 지출을 못 고침');
  assert.equal((await rows(A, 'update trip_expenses set amount = 13000 where id = $1 returning id', [e])).length, 1, '여행 주인은 고칠 수 있음');
  assert.equal((await rows(B, 'delete from trip_expenses where id = $1 returning id', [e])).length, 1);
});

test('체크리스트: 멤버 누구나, 남은 불가 (Phase 4)', async () => {
  const c = (await rows(B, "insert into checklist_items (trip_id, title) values ($1, '보조배터리') returning id", [trip]))[0].id;
  assert.equal((await rows(A, 'update checklist_items set checked = true where id = $1 returning checked', [c]))[0].checked, true);
  assert.equal((await rows(C, 'update checklist_items set checked = false where id = $1 returning id', [c])).length, 0);
  await fails(C, "insert into checklist_items (trip_id, title) values ($1, 'x')", [trip], /row-level security/);
});

test('스크랩북: 저장·버전 충돌·다른 여행 사진 차단·고아 파일 (Phase 5, TC-11)', async () => {
  const page = (await rows(B, "insert into scrapbook_pages (trip_id, title, page_date) values ($1, '첫날', '2026-11-21') returning id, revision", [trip]))[0];
  const myPhoto = (await rows(B, `insert into photos (place_id, path, thumb_path)
    select id, $2 || '/a.jpg', $2 || '/a_t.jpg' from places where trip_id = $1 limit 1 returning id`, [trip, String(trip)]))[0].id;
  const otherPlace = (await rows(C, "insert into places (trip_id, name, lat, lng) values ($1, 'x', 1, 1) returning id", [otherTrip]))[0].id;
  const otherPhoto = (await rows(C, 'insert into photos (place_id, path, thumb_path) values ($1, $2, $3) returning id', [otherPlace, `${otherTrip}/b.jpg`, `${otherTrip}/b_t.jpg`]))[0].id;

  const el = (id, extra) => ({ id, type: 'IMAGE', x: 40, y: 80, width: 400, height: 300, rotation: -4, zIndex: 1, ...extra });
  const els = [
    el('11111111-1111-1111-1111-111111111111', { photoId: myPhoto }),
    el('22222222-2222-2222-2222-222222222222', { assetPath: `${trip}/sb_x.jpg` }),
    { id: '33333333-3333-3333-3333-333333333333', type: 'TEXT', x: 50, y: 430, width: 500, height: 70, rotation: 0, zIndex: 2, content: { text: '공주 여행 첫날' } },
  ];
  const s1 = await rows(B, 'select * from save_scrapbook_page($1, $2, $3)', [page.id, page.revision, JSON.stringify(els)]);
  assert.equal(s1[0].revision, page.revision + 1);
  const saved = await rows(A, 'select type, x, rotation, content from scrapbook_elements where page_id = $1 order by z_index', [page.id]);
  assert.equal(saved.length, 3);
  assert.equal(saved[2].content.text, '공주 여행 첫날');
  assert.equal(saved[0].rotation, -4);
  // 옛 버전으로 저장하면 충돌
  await fails(A, 'select * from save_scrapbook_page($1, $2, $3)', [page.id, page.revision, '[]'], /먼저 이 페이지를/);
  // 다른 여행 사진/경로는 거부
  await fails(B, 'select * from save_scrapbook_page($1, $2, $3)', [page.id, s1[0].revision, JSON.stringify([el('44444444-4444-4444-4444-444444444444', { photoId: otherPhoto })])], /다른 기록장/);
  await fails(B, 'select * from save_scrapbook_page($1, $2, $3)', [page.id, s1[0].revision, JSON.stringify([el('44444444-4444-4444-4444-444444444444', { assetPath: `${otherTrip}/z.jpg` })])], /다른 기록장/);
  // 남은 못 봄 / 못 저장
  assert.equal((await rows(C, 'select id from scrapbook_elements where page_id = $1', [page.id])).length, 0);
  await fails(C, 'select * from save_scrapbook_page($1, $2, $3)', [page.id, s1[0].revision, '[]'], /고칠 수 없어요/);
  await fails(B, 'insert into scrapbook_elements (id, page_id, trip_id, type, x, y, width, height) values (gen_random_uuid(), $1, $2, \'TEXT\', 0, 0, 10, 10)', [page.id, trip], /permission denied/);
  // 스크랩북 전용 사진을 뺀 채 저장하면 그 경로를 돌려줌
  const s2 = await rows(B, 'select * from save_scrapbook_page($1, $2, $3)', [page.id, s1[0].revision, JSON.stringify([els[0], els[2]])]);
  assert.deepEqual(s2[0].orphan_paths, [`${trip}/sb_x.jpg`]);
});

test('005: 장소 기록 시각·일정 연결 (같은 기록장만, 계획 시간은 그대로)', async () => {
  const item = (await rows(A, "insert into itinerary_items (trip_id, day_date, title, start_time, end_time) values ($1, '2026-11-23', '부여 궁남지', '10:00', '11:00') returning id, start_time", [trip]))[0];
  const p = (await rows(B, `insert into places (trip_id, name, lat, lng, visited_at, visited_time, plan_item_id)
    values ($1, '궁남지', 36.27, 126.91, '2026-11-23', '10:47', $2) returning id, visited_time, plan_item_id`, [trip, item.id]))[0];
  assert.equal(p.visited_time, '10:47:00');
  assert.equal(p.plan_item_id, item.id);
  // 계획 시간은 바뀌지 않음
  assert.equal((await rows(A, 'select start_time from itinerary_items where id = $1', [item.id]))[0].start_time, '10:00:00');
  // 다른 기록장의 일정에는 연결 불가
  const otherItem = (await rows(C, "insert into itinerary_items (trip_id, day_date, title) values ($1, '2026-11-21', 'C 일정') returning id", [otherTrip]))[0].id;
  await fails(B, 'update places set plan_item_id = $1 where id = $2', [otherItem, p.id], /다른 기록장의 일정/);
  // 쓴 사람은 시간을 고칠 수 있고, 남은 못 고침
  assert.equal((await rows(B, "update places set visited_time = '11:05' where id = $1 returning id", [p.id])).length, 1);
  assert.equal((await rows(C, "update places set visited_time = '01:00' where id = $1 returning id", [p.id])).length, 0);
  // 사진 촬영 일시
  const ph = (await rows(B, 'insert into photos (place_id, path, thumb_path, taken_at) values ($1, $2, $3, $4) returning taken_at', [p.id, `${trip}/t.jpg`, `${trip}/t_t.jpg`, '2026-11-23T01:47:00Z']))[0];
  assert.ok(ph.taken_at);
  // 일정을 지우면 기록은 남고 연결만 풀림
  await rows(A, 'delete from itinerary_items where id = $1', [item.id]);
  const after = (await rows(B, 'select plan_item_id, name from places where id = $1', [p.id]))[0];
  assert.equal(after.plan_item_id, null);
  assert.equal(after.name, '궁남지');
});

test('006: 새 템플릿·배경은 저장되고 모르는 값은 거부', async () => {
  const p = await rows(B, "insert into scrapbook_pages (trip_id, title, template, background) values ($1, '일기', 'DIARY', 'lined') returning template, background", [trip]);
  assert.deepEqual([p[0].template, p[0].background], ['DIARY', 'lined']);
  for (const bg of ['white', 'cream', 'sky', 'peach', 'night', 'dots', 'stripe', 'check', 'linen', 'paper']) {
    assert.equal((await rows(B, 'insert into scrapbook_pages (trip_id, template, background) values ($1, $2, $3) returning id', [trip, 'COLLAGE', bg])).length, 1, bg);
  }
  await fails(B, "insert into scrapbook_pages (trip_id, background) values ($1, 'neon')", [trip], /check constraint/);
  await fails(B, "insert into scrapbook_pages (trip_id, template) values ($1, 'MAGAZINE')", [trip], /check constraint/);
});

test('007: 여행 국가·도시·유형·대표 사진 (같은 여행 사진만, 목록에 반영)', async () => {
  const r = await rows(B, "update trips set country = '대한민국', cities = array['공주','부여'], party_type = 'FRIENDS' where id = $1 returning country, cities, party_type", [trip]);
  assert.deepEqual([r[0].country, r[0].cities, r[0].party_type], ['대한민국', ['공주', '부여'], 'FRIENDS']);
  await fails(B, "update trips set party_type = 'ALIEN' where id = $1", [trip], /check constraint/);
  assert.equal((await rows(C, "update trips set country = 'x' where id = $1 returning id", [trip])).length, 0, '남은 못 고침');
  // 대표 사진: 이 여행의 두 번째 사진으로 고르면 목록 표지가 그 사진
  const pid = (await rows(B, "insert into places (trip_id, name, lat, lng) values ($1, '표지 후보', 36.4, 127.1) returning id", [trip]))[0].id;
  const ph = (await rows(B, 'insert into photos (place_id, path, thumb_path) values ($1, $2, $3) returning id', [pid, `${trip}/cover.jpg`, `${trip}/cover_t.jpg`]))[0].id;
  await rows(A, 'update trips set cover_photo_id = $1 where id = $2', [ph, trip]);
  assert.equal((await rows(B, 'select cover_path, country from trip_list where id = $1', [trip]))[0].cover_path, `${trip}/cover_t.jpg`);
  // 다른 여행 사진은 대표 사진 불가
  const op = (await rows(C, "insert into places (trip_id, name, lat, lng) values ($1, 'x', 1, 1) returning id", [otherTrip]))[0].id;
  const oph = (await rows(C, 'insert into photos (place_id, path, thumb_path) values ($1, $2, $3) returning id', [op, `${otherTrip}/o.jpg`, `${otherTrip}/o_t.jpg`]))[0].id;
  await fails(A, 'update trips set cover_photo_id = $1 where id = $2', [oph, trip], /이 여행에 올린 사진만/);
  // 대표 사진을 지우면 표지는 첫 사진으로 돌아감
  await rows(B, 'delete from photos where id = $1', [ph]);
  assert.notEqual((await rows(B, 'select cover_path from trip_list where id = $1', [trip]))[0].cover_path, `${trip}/cover_t.jpg`);
});

test('멤버가 나가면 새 자료도 못 봄 (TC-15)', async () => {
  assert.ok((await rows(B, 'select id from itinerary_items where trip_id = $1', [trip])).length > 0);
  await rows(B, 'delete from trip_members where trip_id = $1 and user_id = $2', [trip, B]);
  for (const t of ['itinerary_items', 'trip_expenses', 'checklist_items', 'scrapbook_pages', 'scrapbook_elements', 'trip_plans']) {
    assert.equal((await rows(B, `select 1 from ${t} where trip_id = $1`, [trip])).length, 0, t);
  }
  await rows(A, 'select * from add_member_by_username($1, $2)', [trip, 'bb']);
});

test('여행을 지우면 새 자료도 함께 지워지고 오류가 없음 (TC-15)', async () => {
  await rows(A, 'delete from trips where id = $1', [trip]);
  for (const t of ['itinerary_items', 'trip_expenses', 'checklist_items', 'scrapbook_pages', 'scrapbook_elements', 'trip_plans', 'ai_drafts']) {
    assert.equal((await db.query(`select 1 from ${t} where trip_id = $1`, [trip])).rows.length, 0, t);
  }
});

test('되돌리기 SQL 이 기존 테이블을 남기고 새 테이블만 지움', async () => {
  const x = new PGlite();
  await x.exec(SUPABASE_STUB);
  for (const f of ['schema.sql', 'migrate-002-username.sql', 'migrate-003-memories.sql', 'migrate-004-planner-scrapbook.sql',
    'migrate-005-record-time-plan-link.sql', 'migrate-006-scrapbook-design.sql', 'migrate-007-trip-info.sql',
    'rollback-007-trip-info.sql', 'rollback-006-scrapbook-design.sql',
    'rollback-005-record-time-plan-link.sql', 'rollback-004-planner-scrapbook.sql']) {
    await x.exec(sql(f));
  }
  const t = (await x.query("select table_name from information_schema.tables where table_schema = 'public' order by 1")).rows.map((r) => r.table_name);
  assert.deepEqual(t, ['photos', 'place_comments', 'places', 'profiles', 'trip_invites', 'trip_list', 'trip_members', 'trips']);
  const cols = (await x.query("select column_name from information_schema.columns where table_name = 'places' and column_name in ('visited_time', 'plan_item_id')")).rows;
  assert.equal(cols.length, 0, '005 되돌리기 후 새 칸 없음');
  await x.close();
});
