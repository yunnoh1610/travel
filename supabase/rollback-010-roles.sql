-- 010 되돌리기: 멤버 역할을 없애고 예전처럼 "멤버 = 함께 고치기"로 (멤버·기록은 그대로)
drop policy if exists "역할: 편집자만 update" on public.trips;
drop policy if exists "역할: 편집자만 insert" on public.places;
drop policy if exists "역할: 편집자만 update" on public.places;
drop policy if exists "역할: 편집자만 delete" on public.places;
drop policy if exists "역할: 편집자만 insert" on public.itinerary_items;
drop policy if exists "역할: 편집자만 update" on public.itinerary_items;
drop policy if exists "역할: 편집자만 delete" on public.itinerary_items;
drop policy if exists "역할: 편집자만 insert" on public.trip_expenses;
drop policy if exists "역할: 편집자만 update" on public.trip_expenses;
drop policy if exists "역할: 편집자만 delete" on public.trip_expenses;
drop policy if exists "역할: 편집자만 insert" on public.checklist_items;
drop policy if exists "역할: 편집자만 update" on public.checklist_items;
drop policy if exists "역할: 편집자만 delete" on public.checklist_items;
drop policy if exists "역할: 편집자만 insert" on public.scrapbook_pages;
drop policy if exists "역할: 편집자만 update" on public.scrapbook_pages;
drop policy if exists "역할: 편집자만 delete" on public.scrapbook_pages;
drop policy if exists "역할: 편집자만 insert" on public.scrapbooks;
drop policy if exists "역할: 편집자만 update" on public.scrapbooks;
drop policy if exists "역할: 편집자만 delete" on public.scrapbooks;
drop policy if exists "역할: 편집자만 insert" on public.photos;
drop policy if exists "역할: 편집자만 delete" on public.photos;
drop policy if exists "역할: 편집자만 사진 올리기" on storage.objects;
drop policy if exists "members: 만든 사람이 역할 바꾸기" on public.trip_members;
revoke update (role) on public.trip_members from authenticated;
drop trigger if exists trip_members_role_check on public.trip_members;
drop function if exists public.check_member_role();

-- 함수들을 004·처음 설정 때 내용으로
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
create or replace function public.reorder_scrapbook_pages(p_trip_id bigint, p_ids bigint[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trip_member(p_trip_id) then raise exception using errcode = 'PT403', message = '이 기록장에 접근할 수 없어요'; end if;
  update scrapbook_pages s set page_order = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
    where s.id = o.id and s.trip_id = p_trip_id;
end $$;

create or replace function public.add_owner_as_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into trip_members (trip_id, user_id) values (new.id, new.owner_id) on conflict do nothing;
  return new;
end $$;

drop function if exists public.create_invite(bigint, boolean, text);
create or replace function public.create_invite(p_trip_id bigint, p_reset boolean default false)
returns table (token text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  if not public.is_trip_member(p_trip_id) then raise exception '여행을 찾을 수 없어요'; end if;
  if p_reset then
    if not public.is_trip_owner(p_trip_id) then raise exception '여행을 만든 사람만 링크를 새로 만들 수 있어요'; end if;
    delete from trip_invites i where i.trip_id = p_trip_id;
  end if;
  delete from trip_invites i where i.expires_at <= now();
  -- 하루 이상 남은 링크가 있으면 그대로 다시 씀
  return query select i.token, i.expires_at from trip_invites i
    where i.trip_id = p_trip_id and i.expires_at > now() + interval '1 day'
    order by i.expires_at desc limit 1;
  if found then return; end if;
  return query insert into trip_invites as i (token, trip_id, created_by, expires_at)
    values (replace(gen_random_uuid()::text, '-', ''), p_trip_id, auth.uid(), now() + interval '7 days')
    returning i.token, i.expires_at;
end $$;

drop function if exists public.invite_info(text);
create or replace function public.invite_info(p_token text)
returns table (title text, inviter text, member_count bigint)
language sql stable security definer set search_path = public as $$
  select t.title, p.name, (select count(*) from trip_members m where m.trip_id = t.id)
  from trip_invites i join trips t on t.id = i.trip_id join profiles p on p.id = i.created_by
  where i.token = p_token and i.expires_at > now();
$$;

create or replace function public.accept_invite(p_token text)
returns table (trip_id bigint, title text, already boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_trip bigint; v_title text; v_n int;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  select i.trip_id, t.title into v_trip, v_title
    from trip_invites i join trips t on t.id = i.trip_id
    where i.token = p_token and i.expires_at > now();
  if v_trip is null then raise exception '초대 링크가 만료됐거나 잘못된 링크예요'; end if;
  insert into trip_members (trip_id, user_id) values (v_trip, auth.uid()) on conflict do nothing;
  get diagnostics v_n = row_count;
  return query select v_trip, v_title, v_n = 0;
end $$;

drop function if exists public.add_member_by_username(bigint, text, text);
create or replace function public.add_member_by_username(p_trip_id bigint, p_username text)
returns table (id uuid, name text, username text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_id uuid; v_name text; v_username text;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  if not public.is_trip_member(p_trip_id) then raise exception '여행을 찾을 수 없어요'; end if;
  select p.id, p.name, p.username into v_id, v_name, v_username
    from profiles p where lower(p.username) = lower(trim(p_username));
  if v_id is null then raise exception '그런 아이디를 가진 사람이 없어요'; end if;
  insert into trip_members (trip_id, user_id) values (p_trip_id, v_id) on conflict do nothing;
  return query select v_id, v_name, v_username;
end $$;

revoke execute on function public.create_invite(bigint, boolean), public.accept_invite(text), public.add_member_by_username(bigint, text) from public, anon;
grant execute on function public.create_invite(bigint, boolean), public.accept_invite(text), public.add_member_by_username(bigint, text) to authenticated;
grant execute on function public.invite_info(text) to anon, authenticated;

drop function if exists public.can_edit_trip(bigint);
alter table public.trip_invites drop column if exists role;
alter table public.trip_members drop column if exists role;

select '✔ 010 되돌리기 완료' as result;
