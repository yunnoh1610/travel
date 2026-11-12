-- 011 되돌리기: 일정 사이 이동 방법 칸 삭제 (일정은 그대로)
-- AI 초안 적용 함수를 010 내용으로 (이동 칸을 쓰지 않게) 먼저 되돌려요
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

alter table public.itinerary_items drop column if exists transit;
drop function if exists public.transit_of(jsonb);
grant update (day_date, sort_order, item_type, title, start_time, end_time, place_id, place_name, address, lat, lng,
  verification_status, cost_estimate, currency, notes, user_edited, status, assignees) on public.itinerary_items to authenticated;
select '✔ 011 되돌리기 완료' as result;
