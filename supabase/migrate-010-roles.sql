-- =====================================================================
-- 여행 기록 앱 — 공동 여행 역할 (010)
--   멤버 역할: 만든 사람(OWNER) · 편집자(EDITOR) · 보기 전용(VIEWER)
--   · 지금 있는 멤버는 모두 '편집자'로 시작해요 (지금처럼 함께 고칠 수 있음). 만든 사람은 OWNER
--   · 보기 전용은 기록·일정·스크랩북을 볼 수 있고, 한마디와 즐겨찾기만 남길 수 있어요
--   · 초대 링크로 들어오면 기본은 '보기 전용' (링크만으로 편집 권한을 주지 않음). 편집자 링크는 만든 사람만
--   · 역할은 만든 사람만 바꿔요
-- Supabase 대시보드 > SQL Editor > New query 에 붙여넣고 [Run]. 여러 번 실행해도 안전해요.
-- 기존 권한 규칙은 그대로 두고 "편집자만" 규칙을 덧씌워요(restrictive). 되돌리기: supabase/rollback-010-roles.sql
-- =====================================================================

-- ---------- 멤버 역할 ----------
alter table public.trip_members add column if not exists role text not null default 'EDITOR';
do $$ begin
  alter table public.trip_members add constraint trip_members_role_check check (role in ('OWNER', 'EDITOR', 'VIEWER'));
exception when duplicate_object then null; end $$;
update public.trip_members m set role = 'OWNER'
  from public.trips t where t.id = m.trip_id and t.owner_id = m.user_id and m.role <> 'OWNER';

-- 편집할 수 있는 멤버인지 (만든 사람·편집자)
create or replace function public.can_edit_trip(tid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from trip_members where trip_id = tid and user_id = auth.uid() and role in ('OWNER', 'EDITOR'));
$$;
revoke execute on function public.can_edit_trip(bigint) from public, anon;
grant execute on function public.can_edit_trip(bigint) to authenticated;

-- 여행을 만들면 만든 사람은 OWNER
create or replace function public.add_owner_as_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into trip_members (trip_id, user_id, role) values (new.id, new.owner_id, 'OWNER')
  on conflict (trip_id, user_id) do update set role = 'OWNER';
  return new;
end $$;

-- OWNER 는 여행을 만든 사람 한 명뿐 (다른 사람을 OWNER 로, 만든 사람을 다른 역할로 바꿀 수 없음)
create or replace function public.check_member_role() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from trips where id = new.trip_id;
  if (new.role = 'OWNER') is distinct from (new.user_id = v_owner) then
    raise exception using errcode = 'PT400', message = '여행을 만든 사람의 역할은 바꿀 수 없고, 다른 사람을 만든 사람으로 정할 수 없어요';
  end if;
  return new;
end $$;
drop trigger if exists trip_members_role_check on public.trip_members;
create trigger trip_members_role_check before insert or update of role on public.trip_members
  for each row execute function public.check_member_role();
revoke execute on function public.check_member_role() from public, anon;

-- 역할은 만든 사람만 바꿈 (역할 칸만)
revoke update on public.trip_members from anon, authenticated;
grant update (role) on public.trip_members to authenticated;
drop policy if exists "members: 만든 사람이 역할 바꾸기" on public.trip_members;
create policy "members: 만든 사람이 역할 바꾸기" on public.trip_members for update to authenticated
  using (public.is_trip_owner(trip_id)) with check (public.is_trip_owner(trip_id));

-- ---------- 쓰기는 편집자만 (기존 규칙에 덧씌움: 둘 다 통과해야 함) ----------
-- 한마디(place_comments)·즐겨찾기(place_favorites)는 보기 전용도 남길 수 있어요
drop policy if exists "역할: 편집자만 update" on public.trips;
create policy "역할: 편집자만 update" on public.trips as restrictive for update to authenticated using (public.can_edit_trip(id)) with check (public.can_edit_trip(id));
drop policy if exists "역할: 편집자만 insert" on public.places;
create policy "역할: 편집자만 insert" on public.places as restrictive for insert to authenticated with check (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 update" on public.places;
create policy "역할: 편집자만 update" on public.places as restrictive for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 delete" on public.places;
create policy "역할: 편집자만 delete" on public.places as restrictive for delete to authenticated using (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 insert" on public.itinerary_items;
create policy "역할: 편집자만 insert" on public.itinerary_items as restrictive for insert to authenticated with check (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 update" on public.itinerary_items;
create policy "역할: 편집자만 update" on public.itinerary_items as restrictive for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 delete" on public.itinerary_items;
create policy "역할: 편집자만 delete" on public.itinerary_items as restrictive for delete to authenticated using (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 insert" on public.trip_expenses;
create policy "역할: 편집자만 insert" on public.trip_expenses as restrictive for insert to authenticated with check (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 update" on public.trip_expenses;
create policy "역할: 편집자만 update" on public.trip_expenses as restrictive for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 delete" on public.trip_expenses;
create policy "역할: 편집자만 delete" on public.trip_expenses as restrictive for delete to authenticated using (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 insert" on public.checklist_items;
create policy "역할: 편집자만 insert" on public.checklist_items as restrictive for insert to authenticated with check (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 update" on public.checklist_items;
create policy "역할: 편집자만 update" on public.checklist_items as restrictive for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 delete" on public.checklist_items;
create policy "역할: 편집자만 delete" on public.checklist_items as restrictive for delete to authenticated using (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 insert" on public.scrapbook_pages;
create policy "역할: 편집자만 insert" on public.scrapbook_pages as restrictive for insert to authenticated with check (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 update" on public.scrapbook_pages;
create policy "역할: 편집자만 update" on public.scrapbook_pages as restrictive for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 delete" on public.scrapbook_pages;
create policy "역할: 편집자만 delete" on public.scrapbook_pages as restrictive for delete to authenticated using (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 insert" on public.scrapbooks;
create policy "역할: 편집자만 insert" on public.scrapbooks as restrictive for insert to authenticated with check (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 update" on public.scrapbooks;
create policy "역할: 편집자만 update" on public.scrapbooks as restrictive for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 delete" on public.scrapbooks;
create policy "역할: 편집자만 delete" on public.scrapbooks as restrictive for delete to authenticated using (public.can_edit_trip(trip_id));
drop policy if exists "역할: 편집자만 insert" on public.photos;
create policy "역할: 편집자만 insert" on public.photos as restrictive for insert to authenticated with check (exists (select 1 from public.places p where p.id = place_id and public.can_edit_trip(p.trip_id)));
drop policy if exists "역할: 편집자만 delete" on public.photos;
create policy "역할: 편집자만 delete" on public.photos as restrictive for delete to authenticated using (exists (select 1 from public.places p where p.id = place_id and public.can_edit_trip(p.trip_id)));
drop policy if exists "역할: 편집자만 사진 올리기" on storage.objects;
create policy "역할: 편집자만 사진 올리기" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'photos' or public.can_edit_trip(public.trip_id_from_path(name)));

-- ---------- 함께 쓰는 함수도 편집자만 (내용은 004 와 같고 확인만 바뀜) ----------
create or replace function public.save_plan_prefs(p_trip_id bigint, p_prefs jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception using errcode = 'PT401', message = '로그인이 필요해요'; end if;
  if not public.can_edit_trip(p_trip_id) then raise exception using errcode = 'PT403', message = '이 여행을 고칠 권한이 없어요'; end if;
  if jsonb_typeof(p_prefs) <> 'object' or pg_column_size(p_prefs) > 8000 then
    raise exception using errcode = 'PT400', message = '여행 조건이 너무 길어요';
  end if;
  insert into trip_plans (trip_id, prefs) values (p_trip_id, p_prefs)
  on conflict (trip_id) do update set prefs = excluded.prefs, updated_at = now();
end $$;

create or replace function public.reorder_itinerary(p_trip_id bigint, p_day date, p_ids bigint[])
returns integer
language plpgsql security definer set search_path = public as $$
declare v_rev integer;
begin
  if auth.uid() is null then raise exception using errcode = 'PT401', message = '로그인이 필요해요'; end if;
  if not public.can_edit_trip(p_trip_id) then raise exception using errcode = 'PT403', message = '이 여행을 고칠 권한이 없어요'; end if;
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
  if d.id is null or d.created_by is distinct from auth.uid() or not public.can_edit_trip(d.trip_id) then
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

create or replace function public.save_scrapbook_page(p_page_id bigint, p_expected_revision integer, p_elements jsonb)
returns table (revision integer, orphan_paths text[])
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare pg scrapbook_pages%rowtype; v_old text[]; v_orphans text[];
begin
  if auth.uid() is null then raise exception using errcode = 'PT401', message = '로그인이 필요해요'; end if;
  select * into pg from scrapbook_pages where id = p_page_id for update;
  if pg.id is null or not public.can_edit_trip(pg.trip_id) then
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

create or replace function public.reorder_scrapbook_pages(p_trip_id bigint, p_ids bigint[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit_trip(p_trip_id) then raise exception using errcode = 'PT403', message = '이 여행을 고칠 권한이 없어요'; end if;
  update scrapbook_pages s set page_order = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
    where s.id = o.id and s.trip_id = p_trip_id;
end $$;

-- ---------- 초대: 역할을 담은 링크 ----------
alter table public.trip_invites add column if not exists role text not null default 'EDITOR';
do $$ begin
  alter table public.trip_invites add constraint trip_invites_role_check check (role in ('EDITOR', 'VIEWER'));
exception when duplicate_object then null; end $$;
alter table public.trip_invites alter column role set default 'VIEWER'; -- 이미 보낸 링크는 지금처럼 편집자, 새 링크는 기본 보기 전용

drop function if exists public.create_invite(bigint, boolean);
create or replace function public.create_invite(p_trip_id bigint, p_reset boolean default false, p_role text default 'VIEWER')
returns table (token text, expires_at timestamptz, role text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_role text := upper(coalesce(p_role, 'VIEWER'));
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  if not public.is_trip_member(p_trip_id) then raise exception '여행을 찾을 수 없어요'; end if;
  if v_role not in ('EDITOR', 'VIEWER') then raise exception using errcode = 'PT400', message = '초대 역할이 올바르지 않아요'; end if;
  if not public.can_edit_trip(p_trip_id) then raise exception using errcode = 'PT403', message = '보기 전용 멤버는 초대할 수 없어요'; end if;
  if v_role = 'EDITOR' and not public.is_trip_owner(p_trip_id) then
    raise exception using errcode = 'PT403', message = '편집자 초대 링크는 여행을 만든 사람만 만들 수 있어요';
  end if;
  if p_reset then
    if not public.is_trip_owner(p_trip_id) then raise exception '여행을 만든 사람만 링크를 새로 만들 수 있어요'; end if;
    delete from trip_invites i where i.trip_id = p_trip_id;
  end if;
  delete from trip_invites i where i.expires_at <= now();
  -- 같은 역할로 하루 이상 남은 링크가 있으면 그대로 다시 씀
  return query select i.token, i.expires_at, i.role from trip_invites i
    where i.trip_id = p_trip_id and i.role = v_role and i.expires_at > now() + interval '1 day'
    order by i.expires_at desc limit 1;
  if found then return; end if;
  return query insert into trip_invites as i (token, trip_id, created_by, expires_at, role)
    values (replace(gen_random_uuid()::text, '-', ''), p_trip_id, auth.uid(), now() + interval '7 days', v_role)
    returning i.token, i.expires_at, i.role;
end $$;

drop function if exists public.invite_info(text);
create or replace function public.invite_info(p_token text)
returns table (title text, inviter text, member_count bigint, role text)
language sql stable security definer set search_path = public as $$
  select t.title, p.name, (select count(*) from trip_members m where m.trip_id = t.id), i.role
  from trip_invites i join trips t on t.id = i.trip_id join profiles p on p.id = i.created_by
  where i.token = p_token and i.expires_at > now();
$$;

-- 이미 멤버면 역할은 그대로 (링크로 역할이 바뀌지 않음)
create or replace function public.accept_invite(p_token text)
returns table (trip_id bigint, title text, already boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_trip bigint; v_title text; v_role text; v_n int;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  select i.trip_id, t.title, i.role into v_trip, v_title, v_role
    from trip_invites i join trips t on t.id = i.trip_id
    where i.token = p_token and i.expires_at > now();
  if v_trip is null then raise exception '초대 링크가 만료됐거나 잘못된 링크예요'; end if;
  insert into trip_members (trip_id, user_id, role) values (v_trip, auth.uid(), coalesce(v_role, 'VIEWER')) on conflict do nothing;
  get diagnostics v_n = row_count;
  return query select v_trip, v_title, v_n = 0;
end $$;

-- 아이디로 초대: 만든 사람은 편집자/보기 전용을 고르고(기본 편집자), 편집자는 보기 전용으로만
drop function if exists public.add_member_by_username(bigint, text);
create or replace function public.add_member_by_username(p_trip_id bigint, p_username text, p_role text default null)
returns table (id uuid, name text, username text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_id uuid; v_name text; v_username text;
  v_role text := upper(coalesce(p_role, case when public.is_trip_owner(p_trip_id) then 'EDITOR' else 'VIEWER' end));
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  if not public.is_trip_member(p_trip_id) then raise exception '여행을 찾을 수 없어요'; end if;
  if not public.can_edit_trip(p_trip_id) then raise exception using errcode = 'PT403', message = '보기 전용 멤버는 초대할 수 없어요'; end if;
  if v_role not in ('EDITOR', 'VIEWER') then raise exception using errcode = 'PT400', message = '초대 역할이 올바르지 않아요'; end if;
  if v_role = 'EDITOR' and not public.is_trip_owner(p_trip_id) then
    raise exception using errcode = 'PT403', message = '편집자로 초대하는 것은 여행을 만든 사람만 할 수 있어요';
  end if;
  select p.id, p.name, p.username into v_id, v_name, v_username
    from profiles p where lower(p.username) = lower(trim(p_username));
  if v_id is null then raise exception '그런 아이디를 가진 사람이 없어요'; end if;
  insert into trip_members (trip_id, user_id, role) values (p_trip_id, v_id, v_role) on conflict do nothing;
  return query select v_id, v_name, v_username;
end $$;

revoke execute on function public.create_invite(bigint, boolean, text), public.add_member_by_username(bigint, text, text) from public, anon;
grant execute on function public.create_invite(bigint, boolean, text), public.add_member_by_username(bigint, text, text) to authenticated;
grant execute on function public.invite_info(text) to anon, authenticated;

select '✔ 공동 여행 역할 설정 완료' as result;
