-- =====================================================================
-- 여행 기록 앱 — AI 여행 계획 · 예산 · 체크리스트 · 스크랩북 (004)
-- Supabase 대시보드 > SQL Editor > New query 에 붙여넣고 [Run]. 여러 번 실행해도 안전해요.
--
-- ※ 기존 테이블(trips, trip_members, places, photos, trip_invites, place_comments)과
--   기존 권한 규칙·뷰는 바꾸지 않아요. 새 테이블·함수만 추가하고, 회원 탈퇴용
--   my_storage_paths() 에 스크랩북 사진 경로를 더해요(기존 결과는 그대로 포함).
-- ※ 실행 전 백업: Database > Backups (유료 플랜) 또는
--   pg_dump "<연결 문자열>" --schema=public --data-only > backup.sql
-- ※ 되돌리기: supabase/rollback-004-planner-scrapbook.sql
--
-- 권한 원칙 (기존 앱과 같게)
--   · 보기: 같은 여행(기록장) 멤버만 (is_trip_member)
--   · 일정·체크리스트·스크랩북: 함께 쓰는 계획이라 멤버 누구나 추가·수정·삭제
--   · 지출: 멤버가 기록, 쓴 사람/여행 만든 사람만 수정·삭제 (places 와 같은 방식)
--   · AI 초안: 서버(Edge Function, service_role)만 만들고, 만든 사람만 보고 적용
-- =====================================================================

-- gen_random_uuid() 는 PostgreSQL 13+ 기본 함수라 확장 설치가 필요 없어요

-- ---------- 공통 함수 ----------
-- 여행의 날짜 범위 (모임·일상처럼 종료일이 없으면 시작일 하루)
create or replace function public.trip_date_ok(tid bigint, d date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from trips t
    where t.id = tid and t.start_date is not null
      and d between t.start_date and coalesce(t.end_date, t.start_date)
  );
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- 1) 여행 계획 설정 + 일정 버전(revision) ----------
create table if not exists public.trip_plans (
  trip_id bigint primary key references public.trips(id) on delete cascade,
  revision integer not null default 0,
  prefs jsonb not null default '{}'::jsonb check (pg_column_size(prefs) <= 8000),
  updated_at timestamptz not null default now()
);

create table if not exists public.itinerary_items (
  id bigint generated always as identity primary key,
  trip_id bigint not null references public.trips(id) on delete cascade,
  day_date date not null,
  sort_order integer not null default 0,
  item_type text not null default 'PLACE'
    check (item_type in ('PLACE', 'MEAL', 'CAFE', 'MOVE', 'STAY', 'REST', 'ETC')),
  title text not null check (char_length(title) between 1 and 80),
  start_time time,
  end_time time,
  place_id bigint references public.places(id) on delete set null,
  place_name text check (place_name is null or char_length(place_name) <= 120),
  address text check (address is null or char_length(address) <= 200),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  verification_status text not null default 'UNVERIFIED'
    check (verification_status in ('VERIFIED', 'UNVERIFIED', 'MANUAL')),
  cost_estimate numeric(12, 2) check (cost_estimate is null or cost_estimate >= 0),
  currency text not null default 'KRW' check (currency ~ '^[A-Z]{3}$'),
  notes text check (notes is null or char_length(notes) <= 500),
  source text not null default 'MANUAL' check (source in ('MANUAL', 'AI')),
  user_edited boolean not null default false, -- AI가 만든 일정을 사람이 고쳤는지 (AI 수정 때 보존 표시)
  ai_draft_id uuid,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint itinerary_time_order check (start_time is null or end_time is null or end_time >= start_time),
  constraint itinerary_latlng_pair check ((lat is null) = (lng is null))
);
create index if not exists itinerary_items_day_idx on public.itinerary_items (trip_id, day_date, sort_order);

-- 일정 날짜는 여행 기간 안, 연결한 장소 기록은 같은 여행 것만
create or replace function public.check_itinerary_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.trip_date_ok(new.trip_id, new.day_date) then
    raise exception using errcode = 'PT400', message = '일정 날짜가 여행 기간 밖이에요 (여행 날짜를 먼저 정해 주세요)';
  end if;
  if new.place_id is not null and not exists (select 1 from places p where p.id = new.place_id and p.trip_id = new.trip_id) then
    raise exception using errcode = 'PT400', message = '다른 기록장의 장소는 연결할 수 없어요';
  end if;
  if tg_op = 'UPDATE' and new.trip_id <> old.trip_id then
    raise exception using errcode = 'PT400', message = '일정을 다른 기록장으로 옮길 수 없어요';
  end if;
  return new;
end $$;
drop trigger if exists itinerary_check on public.itinerary_items;
create trigger itinerary_check before insert or update on public.itinerary_items
  for each row execute function public.check_itinerary_item();
drop trigger if exists itinerary_touch on public.itinerary_items;
create trigger itinerary_touch before update on public.itinerary_items
  for each row execute function public.touch_updated_at();

-- 일정이 바뀔 때마다 여행 계획 버전 +1 (AI 초안 적용 전 충돌 확인용)
create or replace function public.bump_plan_revision() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_trip bigint := coalesce(new.trip_id, old.trip_id);
begin
  update trip_plans set revision = revision + 1, updated_at = now() where trip_id = v_trip;
  if not found then
    -- 여행을 지우는 중(연쇄 삭제)이면 trips 행이 이미 없으므로 만들지 않음
    insert into trip_plans (trip_id, revision)
    select v_trip, 1 where exists (select 1 from trips where id = v_trip)
    on conflict (trip_id) do update set revision = trip_plans.revision + 1, updated_at = now();
  end if;
  return null;
end $$;
drop trigger if exists itinerary_bump on public.itinerary_items;
create trigger itinerary_bump after insert or update or delete on public.itinerary_items
  for each row execute function public.bump_plan_revision();

-- ---------- 2) AI 초안 / 사용 기록 ----------
create table if not exists public.ai_drafts (
  id uuid primary key default gen_random_uuid(),
  trip_id bigint not null references public.trips(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('GENERATE', 'REVISE')),
  request_json jsonb not null,
  result_json jsonb not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPLIED', 'DISCARDED')),
  base_revision integer not null,
  applied_at timestamptz,
  expires_at timestamptz not null default now() + interval '1 day',
  created_at timestamptz not null default now()
);
create index if not exists ai_drafts_trip_idx on public.ai_drafts (trip_id, created_at desc);

-- 사용량·오류 추적 (요청 본문은 저장하지 않음). 앱(브라우저)에서는 읽고 쓸 수 없음
create table if not exists public.ai_request_log (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  trip_id bigint references public.trips(id) on delete set null,
  feature text not null,
  status text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  error_code text,
  created_at timestamptz not null default now()
);
create index if not exists ai_request_log_user_idx on public.ai_request_log (user_id, created_at desc);

-- ---------- 3) 지출 / 4) 준비물 ----------
create table if not exists public.trip_expenses (
  id bigint generated always as identity primary key,
  trip_id bigint not null references public.trips(id) on delete cascade,
  itinerary_item_id bigint references public.itinerary_items(id) on delete set null,
  category text not null default 'ETC'
    check (category in ('TRANSPORT', 'STAY', 'FOOD', 'SIGHT', 'SHOPPING', 'ETC')),
  title text not null check (char_length(title) between 1 and 60),
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'KRW' check (currency ~ '^[A-Z]{3}$'),
  is_actual boolean not null default true, -- true: 실제 지출, false: 예상 비용
  spent_on date,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists trip_expenses_trip_idx on public.trip_expenses (trip_id);

create table if not exists public.checklist_items (
  id bigint generated always as identity primary key,
  trip_id bigint not null references public.trips(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  checked boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists checklist_items_trip_idx on public.checklist_items (trip_id, sort_order);

-- ---------- 5) 스크랩북 ----------
create table if not exists public.scrapbook_pages (
  id bigint generated always as identity primary key,
  trip_id bigint not null references public.trips(id) on delete cascade,
  page_date date,
  title text not null default '' check (char_length(title) <= 40),
  template text not null default 'BLANK' check (template in ('BLANK', 'POLAROID', 'DAY', 'GRID')),
  background text not null default 'paper' check (background in ('paper', 'grid', 'kraft', 'mint', 'lilac')),
  page_order integer not null default 0,
  revision integer not null default 0,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scrapbook_pages_trip_idx on public.scrapbook_pages (trip_id, page_order);
drop trigger if exists scrapbook_pages_touch on public.scrapbook_pages;
create trigger scrapbook_pages_touch before update on public.scrapbook_pages
  for each row execute function public.touch_updated_at();

create table if not exists public.scrapbook_elements (
  id uuid primary key,
  page_id bigint not null references public.scrapbook_pages(id) on delete cascade,
  trip_id bigint not null references public.trips(id) on delete cascade,
  type text not null check (type in ('IMAGE', 'TEXT', 'STICKER')),
  -- 논리 캔버스 1000×1400 기준 좌표 (조금 밖으로 나가는 것은 허용)
  x real not null check (x between -1000 and 2000),
  y real not null check (y between -1400 and 2800),
  width real not null check (width between 10 and 3000),
  height real not null check (height between 10 and 4200),
  rotation real not null default 0 check (rotation between -180 and 180),
  z_index integer not null default 0,
  photo_id bigint references public.photos(id) on delete set null, -- 기존 사진을 참조 (중복 업로드 없음)
  asset_path text check (asset_path is null or char_length(asset_path) <= 200), -- 스크랩북에서 새로 올린 사진
  content jsonb not null default '{}'::jsonb check (pg_column_size(content) <= 4000)
);
create index if not exists scrapbook_elements_page_idx on public.scrapbook_elements (page_id);
create index if not exists scrapbook_elements_trip_idx on public.scrapbook_elements (trip_id);

-- ---------- 행 단위 보안 ----------
alter table public.trip_plans enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.ai_drafts enable row level security;
alter table public.ai_request_log enable row level security; -- 정책 없음: 서버만
alter table public.trip_expenses enable row level security;
alter table public.checklist_items enable row level security;
alter table public.scrapbook_pages enable row level security;
alter table public.scrapbook_elements enable row level security;

drop policy if exists "plans: 멤버만 보기" on public.trip_plans;
create policy "plans: 멤버만 보기" on public.trip_plans for select to authenticated
  using (public.is_trip_member(trip_id));

drop policy if exists "itinerary: 멤버만 보기" on public.itinerary_items;
create policy "itinerary: 멤버만 보기" on public.itinerary_items for select to authenticated
  using (public.is_trip_member(trip_id));
drop policy if exists "itinerary: 멤버가 추가" on public.itinerary_items;
create policy "itinerary: 멤버가 추가" on public.itinerary_items for insert to authenticated
  with check (public.is_trip_member(trip_id) and created_by = auth.uid());
drop policy if exists "itinerary: 멤버가 수정" on public.itinerary_items;
create policy "itinerary: 멤버가 수정" on public.itinerary_items for update to authenticated
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
drop policy if exists "itinerary: 멤버가 삭제" on public.itinerary_items;
create policy "itinerary: 멤버가 삭제" on public.itinerary_items for delete to authenticated
  using (public.is_trip_member(trip_id));

drop policy if exists "ai_drafts: 만든 사람만 보기" on public.ai_drafts;
create policy "ai_drafts: 만든 사람만 보기" on public.ai_drafts for select to authenticated
  using (created_by = auth.uid() and public.is_trip_member(trip_id));

drop policy if exists "expenses: 멤버만 보기" on public.trip_expenses;
create policy "expenses: 멤버만 보기" on public.trip_expenses for select to authenticated
  using (public.is_trip_member(trip_id));
drop policy if exists "expenses: 멤버가 기록" on public.trip_expenses;
create policy "expenses: 멤버가 기록" on public.trip_expenses for insert to authenticated
  with check (created_by = auth.uid() and public.is_trip_member(trip_id));
drop policy if exists "expenses: 쓴 사람/여행 주인이 수정" on public.trip_expenses;
create policy "expenses: 쓴 사람/여행 주인이 수정" on public.trip_expenses for update to authenticated
  using (public.is_trip_member(trip_id) and (created_by = auth.uid() or public.is_trip_owner(trip_id)))
  with check (public.is_trip_member(trip_id));
drop policy if exists "expenses: 쓴 사람/여행 주인이 삭제" on public.trip_expenses;
create policy "expenses: 쓴 사람/여행 주인이 삭제" on public.trip_expenses for delete to authenticated
  using (public.is_trip_member(trip_id) and (created_by = auth.uid() or public.is_trip_owner(trip_id)));

drop policy if exists "checklist: 멤버만 보기" on public.checklist_items;
create policy "checklist: 멤버만 보기" on public.checklist_items for select to authenticated
  using (public.is_trip_member(trip_id));
drop policy if exists "checklist: 멤버가 추가" on public.checklist_items;
create policy "checklist: 멤버가 추가" on public.checklist_items for insert to authenticated
  with check (public.is_trip_member(trip_id) and created_by = auth.uid());
drop policy if exists "checklist: 멤버가 수정" on public.checklist_items;
create policy "checklist: 멤버가 수정" on public.checklist_items for update to authenticated
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
drop policy if exists "checklist: 멤버가 삭제" on public.checklist_items;
create policy "checklist: 멤버가 삭제" on public.checklist_items for delete to authenticated
  using (public.is_trip_member(trip_id));

drop policy if exists "scrapbook: 멤버만 보기" on public.scrapbook_pages;
create policy "scrapbook: 멤버만 보기" on public.scrapbook_pages for select to authenticated
  using (public.is_trip_member(trip_id));
drop policy if exists "scrapbook: 멤버가 추가" on public.scrapbook_pages;
create policy "scrapbook: 멤버가 추가" on public.scrapbook_pages for insert to authenticated
  with check (public.is_trip_member(trip_id) and created_by = auth.uid());
drop policy if exists "scrapbook: 멤버가 수정" on public.scrapbook_pages;
create policy "scrapbook: 멤버가 수정" on public.scrapbook_pages for update to authenticated
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
drop policy if exists "scrapbook: 멤버가 삭제" on public.scrapbook_pages;
create policy "scrapbook: 멤버가 삭제" on public.scrapbook_pages for delete to authenticated
  using (public.is_trip_member(trip_id));

drop policy if exists "scrapbook 요소: 멤버만 보기" on public.scrapbook_elements;
create policy "scrapbook 요소: 멤버만 보기" on public.scrapbook_elements for select to authenticated
  using (public.is_trip_member(trip_id));
-- 요소 저장은 save_scrapbook_page() 로만 (한 페이지를 한 번에, 버전 확인 후)

-- ---------- 칸 단위 권한 (바꾸면 안 되는 칸은 수정 불가) ----------
revoke all on public.trip_plans, public.itinerary_items, public.ai_drafts, public.ai_request_log,
  public.trip_expenses, public.checklist_items, public.scrapbook_pages, public.scrapbook_elements from anon;
revoke insert, update, delete on public.trip_plans, public.ai_drafts, public.ai_request_log, public.scrapbook_elements from authenticated;
revoke select on public.ai_request_log from authenticated;
grant select on public.trip_plans, public.ai_drafts, public.scrapbook_elements to authenticated;

revoke update on public.itinerary_items, public.trip_expenses, public.checklist_items, public.scrapbook_pages from authenticated;
grant select, insert, delete on public.itinerary_items, public.trip_expenses, public.checklist_items, public.scrapbook_pages to authenticated;
grant update (day_date, sort_order, item_type, title, start_time, end_time, place_id, place_name, address, lat, lng,
  verification_status, cost_estimate, currency, notes, user_edited) on public.itinerary_items to authenticated;
grant update (itinerary_item_id, category, title, amount, currency, is_actual, spent_on) on public.trip_expenses to authenticated;
grant update (title, checked, sort_order) on public.checklist_items to authenticated;
grant update (page_date, title, template, background, page_order) on public.scrapbook_pages to authenticated;

-- ---------- RPC: 여행 조건 저장 ----------
create or replace function public.save_plan_prefs(p_trip_id bigint, p_prefs jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception using errcode = 'PT401', message = '로그인이 필요해요'; end if;
  if not public.is_trip_member(p_trip_id) then raise exception using errcode = 'PT403', message = '이 기록장에 접근할 수 없어요'; end if;
  if jsonb_typeof(p_prefs) <> 'object' or pg_column_size(p_prefs) > 8000 then
    raise exception using errcode = 'PT400', message = '여행 조건이 너무 길어요';
  end if;
  insert into trip_plans (trip_id, prefs) values (p_trip_id, p_prefs)
  on conflict (trip_id) do update set prefs = excluded.prefs, updated_at = now();
end $$;

-- ---------- RPC: 하루 일정 순서 바꾸기 (한 번에) ----------
create or replace function public.reorder_itinerary(p_trip_id bigint, p_day date, p_ids bigint[])
returns integer
language plpgsql security definer set search_path = public as $$
declare v_rev integer;
begin
  if auth.uid() is null then raise exception using errcode = 'PT401', message = '로그인이 필요해요'; end if;
  if not public.is_trip_member(p_trip_id) then raise exception using errcode = 'PT403', message = '이 기록장에 접근할 수 없어요'; end if;
  perform 1 from trip_plans where trip_id = p_trip_id for update;
  if (select array_agg(id order by id) from itinerary_items where trip_id = p_trip_id and day_date = p_day)
     is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception using errcode = 'PT409', message = '그 사이 일정이 바뀌었어요. 새로고침 후 다시 해 주세요';
  end if;
  update itinerary_items i set sort_order = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
    where i.id = o.id and i.sort_order is distinct from o.ord::int;
  select revision into v_rev from trip_plans where trip_id = p_trip_id;
  return coalesce(v_rev, 0);
end $$;

-- 하루 일정을 시간순으로 다시 번호 매김 (시간 없는 일정은 원래 순서대로 뒤에)
create or replace function public.renumber_day(p_trip_id bigint, p_day date) returns void
language sql security definer set search_path = public as $$
  update itinerary_items i set sort_order = s.rn
  from (
    select id, row_number() over (order by start_time nulls last, sort_order, id) as rn
    from itinerary_items where trip_id = p_trip_id and day_date = p_day
  ) s
  where i.id = s.id and i.sort_order is distinct from s.rn::int;
$$;

-- ---------- RPC: AI 초안 적용 (사용자가 고른 항목만, 버전 확인 후, 한 번만) ----------
create or replace function public.apply_ai_draft(p_draft_id uuid, p_accepted text[], p_expected_revision integer)
returns table (revision integer, inserted integer, updated integer, deleted integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  d ai_drafts%rowtype;
  v_rev integer;
  v_ins integer := 0; v_upd integer := 0; v_del integer := 0;
  v_days date[] := '{}';
  it jsonb; op jsonb; v_day date; v_n integer; v_max integer;
begin
  if auth.uid() is null then raise exception using errcode = 'PT401', message = '로그인이 필요해요'; end if;
  select * into d from ai_drafts where id = p_draft_id for update;
  if d.id is null or d.created_by is distinct from auth.uid() or not public.is_trip_member(d.trip_id) then
    raise exception using errcode = 'PT403', message = '이 초안을 적용할 수 없어요';
  end if;
  if d.status = 'APPLIED' then raise exception using errcode = 'PT409', message = '이미 적용한 초안이에요'; end if;
  if d.status <> 'DRAFT' or d.expires_at < now() then
    raise exception using errcode = 'PT410', message = '초안이 만료됐어요. 다시 만들어 주세요';
  end if;
  if p_accepted is null or cardinality(p_accepted) = 0 then
    raise exception using errcode = 'PT400', message = '적용할 항목을 골라 주세요';
  end if;

  -- 버전 확인: 초안을 만든 뒤 누가 일정을 고쳤으면 막음
  insert into trip_plans (trip_id) values (d.trip_id) on conflict do nothing;
  select tp.revision into v_rev from trip_plans tp where tp.trip_id = d.trip_id for update;
  if v_rev <> d.base_revision or v_rev <> p_expected_revision then
    raise exception using errcode = 'PT409', message = '초안을 만든 뒤 다른 곳에서 일정이 바뀌었어요. 새로고침 후 다시 만들어 주세요';
  end if;

  if d.kind = 'GENERATE' then
    for it in
      select x.item from jsonb_array_elements(d.result_json -> 'days') dd(day),
        jsonb_array_elements(dd.day -> 'items') x(item)
      where x.item ->> 'temporaryId' = any (p_accepted)
    loop
      v_day := (it ->> 'date')::date;
      select coalesce(max(sort_order), 0) into v_max from itinerary_items where trip_id = d.trip_id and day_date = v_day;
      insert into itinerary_items (trip_id, day_date, sort_order, item_type, title, start_time, end_time,
        place_name, address, lat, lng, verification_status, cost_estimate, currency, notes, source, ai_draft_id, created_by)
      values (d.trip_id, v_day, v_max + 1, it ->> 'type', it ->> 'title',
        nullif(it ->> 'startTime', '')::time, nullif(it ->> 'endTime', '')::time,
        it ->> 'placeName', it ->> 'address', (it ->> 'lat')::float8, (it ->> 'lng')::float8,
        coalesce(it ->> 'verificationStatus', 'UNVERIFIED'), (it ->> 'estimatedCost')::numeric,
        coalesce(it ->> 'currency', 'KRW'), it ->> 'notes', 'AI', d.id, auth.uid());
      v_ins := v_ins + 1;
      v_days := array_append(v_days, v_day);
    end loop;
  else
    for op in
      select x.op from jsonb_array_elements(d.result_json -> 'operations') x(op)
      where x.op ->> 'opId' = any (p_accepted)
    loop
      it := op -> 'item';
      if op ->> 'op' = 'delete' then
        delete from itinerary_items where id = (op ->> 'itemId')::bigint and trip_id = d.trip_id
          returning day_date into v_day;
        get diagnostics v_n = row_count;
        if v_n = 0 then raise exception using errcode = 'PT409', message = '지우려는 일정이 이미 없어요'; end if;
        v_del := v_del + 1;
      elsif op ->> 'op' = 'update' then
        update itinerary_items set
          day_date = (it ->> 'date')::date, item_type = it ->> 'type', title = it ->> 'title',
          start_time = nullif(it ->> 'startTime', '')::time, end_time = nullif(it ->> 'endTime', '')::time,
          place_name = it ->> 'placeName', address = it ->> 'address',
          lat = (it ->> 'lat')::float8, lng = (it ->> 'lng')::float8,
          verification_status = coalesce(it ->> 'verificationStatus', 'UNVERIFIED'),
          cost_estimate = (it ->> 'estimatedCost')::numeric, currency = coalesce(it ->> 'currency', 'KRW'),
          notes = it ->> 'notes', ai_draft_id = d.id
        where id = (op ->> 'itemId')::bigint and trip_id = d.trip_id
        returning day_date into v_day;
        get diagnostics v_n = row_count;
        if v_n = 0 then raise exception using errcode = 'PT409', message = '고치려는 일정이 이미 없어요'; end if;
        v_upd := v_upd + 1;
      elsif op ->> 'op' = 'add' then
        v_day := (it ->> 'date')::date;
        select coalesce(max(sort_order), 0) into v_max from itinerary_items where trip_id = d.trip_id and day_date = v_day;
        insert into itinerary_items (trip_id, day_date, sort_order, item_type, title, start_time, end_time,
          place_name, address, lat, lng, verification_status, cost_estimate, currency, notes, source, ai_draft_id, created_by)
        values (d.trip_id, v_day, v_max + 1, it ->> 'type', it ->> 'title',
          nullif(it ->> 'startTime', '')::time, nullif(it ->> 'endTime', '')::time,
          it ->> 'placeName', it ->> 'address', (it ->> 'lat')::float8, (it ->> 'lng')::float8,
          coalesce(it ->> 'verificationStatus', 'UNVERIFIED'), (it ->> 'estimatedCost')::numeric,
          coalesce(it ->> 'currency', 'KRW'), it ->> 'notes', 'AI', d.id, auth.uid());
        v_ins := v_ins + 1;
      end if;
      if v_day is not null then v_days := array_append(v_days, v_day); end if;
      if op ->> 'op' = 'update' and (op -> 'before' ->> 'date') is not null then
        v_days := array_append(v_days, (op -> 'before' ->> 'date')::date);
      end if;
    end loop;
  end if;

  if v_ins + v_upd + v_del = 0 then
    raise exception using errcode = 'PT400', message = '적용할 항목을 찾지 못했어요';
  end if;
  perform public.renumber_day(d.trip_id, x) from (select distinct unnest(v_days) x) s;
  update ai_drafts set status = 'APPLIED', applied_at = now() where id = d.id;
  select tp.revision into v_rev from trip_plans tp where tp.trip_id = d.trip_id;
  return query select v_rev, v_ins, v_upd, v_del;
end $$;

create or replace function public.discard_ai_draft(p_draft_id uuid) returns void
language sql security definer set search_path = public as $$
  update ai_drafts set status = 'DISCARDED'
  where id = p_draft_id and created_by = auth.uid() and status = 'DRAFT';
$$;

-- ---------- RPC: 스크랩북 페이지 저장 (요소 전체를 한 번에, 버전 확인) ----------
-- 돌려주는 orphan_paths: 이 저장으로 더 이상 쓰이지 않는 스크랩북 전용 사진 (앱이 저장소에서 지움)
create or replace function public.save_scrapbook_page(p_page_id bigint, p_expected_revision integer, p_elements jsonb)
returns table (revision integer, orphan_paths text[])
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare pg scrapbook_pages%rowtype; v_old text[]; v_orphans text[];
begin
  if auth.uid() is null then raise exception using errcode = 'PT401', message = '로그인이 필요해요'; end if;
  select * into pg from scrapbook_pages where id = p_page_id for update;
  if pg.id is null or not public.is_trip_member(pg.trip_id) then
    raise exception using errcode = 'PT403', message = '이 페이지를 고칠 수 없어요';
  end if;
  if pg.revision <> p_expected_revision then
    raise exception using errcode = 'PT409', message = '다른 사람이 먼저 이 페이지를 고쳤어요. 다시 열어서 고쳐 주세요';
  end if;
  if jsonb_typeof(p_elements) <> 'array' or jsonb_array_length(p_elements) > 200 then
    raise exception using errcode = 'PT400', message = '한 페이지에는 요소를 200개까지 넣을 수 있어요';
  end if;
  -- 사진은 같은 여행의 사진/경로만
  if exists (
    select 1 from jsonb_array_elements(p_elements) e
    where (e ->> 'photoId') is not null and not exists (
      select 1 from photos ph join places p on p.id = ph.place_id
      where ph.id = (e ->> 'photoId')::bigint and p.trip_id = pg.trip_id)
  ) or exists (
    select 1 from jsonb_array_elements(p_elements) e
    where (e ->> 'assetPath') is not null and public.trip_id_from_path(e ->> 'assetPath') is distinct from pg.trip_id
  ) then
    raise exception using errcode = 'PT403', message = '다른 기록장의 사진은 넣을 수 없어요';
  end if;

  select array_agg(asset_path) into v_old from scrapbook_elements where page_id = p_page_id and asset_path is not null;
  delete from scrapbook_elements where page_id = p_page_id;
  insert into scrapbook_elements (id, page_id, trip_id, type, x, y, width, height, rotation, z_index, photo_id, asset_path, content)
  select (e ->> 'id')::uuid, p_page_id, pg.trip_id, e ->> 'type',
    (e ->> 'x')::real, (e ->> 'y')::real, (e ->> 'width')::real, (e ->> 'height')::real,
    coalesce((e ->> 'rotation')::real, 0), coalesce((e ->> 'zIndex')::int, 0),
    (e ->> 'photoId')::bigint, e ->> 'assetPath', coalesce(e -> 'content', '{}'::jsonb)
  from jsonb_array_elements(p_elements) e;

  select array_agg(distinct u.path) into v_orphans from unnest(coalesce(v_old, '{}')) u(path)
  where not exists (select 1 from scrapbook_elements se where se.asset_path = u.path);
  update scrapbook_pages set revision = scrapbook_pages.revision + 1 where id = p_page_id;
  return query select pg.revision + 1, coalesce(v_orphans, '{}');
end $$;

-- 페이지 순서 바꾸기
create or replace function public.reorder_scrapbook_pages(p_trip_id bigint, p_ids bigint[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trip_member(p_trip_id) then raise exception using errcode = 'PT403', message = '이 기록장에 접근할 수 없어요'; end if;
  update scrapbook_pages s set page_order = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
    where s.id = o.id and s.trip_id = p_trip_id;
end $$;

-- ---------- 회원 탈퇴: 지울 사진 파일에 스크랩북 전용 사진도 포함 ----------
create or replace function public.my_storage_paths() returns setof text
language sql stable security definer set search_path = public as $$
  select x from (
    select unnest(array[ph.path, ph.thumb_path]) as x
    from photos ph join places p on p.id = ph.place_id join trips t on t.id = p.trip_id
    where ph.user_id = auth.uid() or p.user_id = auth.uid() or t.owner_id = auth.uid()
    union
    select se.asset_path from scrapbook_elements se join trips t on t.id = se.trip_id
    where se.asset_path is not null and t.owner_id = auth.uid()
  ) s;
$$;

-- 함수 실행 권한
revoke execute on function public.save_plan_prefs(bigint, jsonb), public.reorder_itinerary(bigint, date, bigint[]),
  public.renumber_day(bigint, date), public.apply_ai_draft(uuid, text[], integer), public.discard_ai_draft(uuid),
  public.save_scrapbook_page(bigint, integer, jsonb), public.reorder_scrapbook_pages(bigint, bigint[]),
  public.trip_date_ok(bigint, date), public.bump_plan_revision(), public.check_itinerary_item()
  from public, anon;
grant execute on function public.save_plan_prefs(bigint, jsonb), public.reorder_itinerary(bigint, date, bigint[]),
  public.apply_ai_draft(uuid, text[], integer), public.discard_ai_draft(uuid),
  public.save_scrapbook_page(bigint, integer, jsonb), public.reorder_scrapbook_pages(bigint, bigint[])
  to authenticated;

select '✔ AI 여행 계획·스크랩북 설정 완료' as result;
