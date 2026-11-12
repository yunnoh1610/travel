-- =====================================================================
-- 여행 기록 앱 — 타임라인 드래그: 순서와 시간을 한 번에 저장 (012)
--   하루 일정의 새 순서 + 다시 계산한 시작·종료 시간을 하나의 저장 작업으로 (중간에 실패하면 아무것도 안 바뀜)
--   010(역할) 다음에 실행해요. 편집자만 쓸 수 있어요.
-- Supabase 대시보드 > SQL Editor > New query 에 붙여넣고 [Run]. 여러 번 실행해도 안전해요.
-- 테이블은 바꾸지 않고 함수만 더해요. 되돌리기: supabase/rollback-012-reorder-times.sql
-- =====================================================================

-- p_starts / p_ends: p_ids 와 같은 순서의 'HH:MM' (null 이면 순서만 바꾸고 시간은 그대로)
create or replace function public.reorder_itinerary_times(p_trip_id bigint, p_day date, p_ids bigint[], p_starts text[], p_ends text[])
returns integer
language plpgsql security definer set search_path = public as $$
declare v_rev integer; n int := cardinality(p_ids);
begin
  if auth.uid() is null then raise exception using errcode = 'PT401', message = '로그인이 필요해요'; end if;
  if not public.can_edit_trip(p_trip_id) then raise exception using errcode = 'PT403', message = '이 여행을 고칠 권한이 없어요'; end if;
  perform 1 from trip_plans where trip_id = p_trip_id for update;
  -- 그날 일정 전체를 빠짐없이 (그 사이 다른 곳에서 바뀌었으면 거부)
  if (select array_agg(id order by id) from itinerary_items where trip_id = p_trip_id and day_date = p_day)
     is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception using errcode = 'PT409', message = '그 사이 일정이 바뀌었어요. 새로고침 후 다시 해 주세요';
  end if;
  if p_starts is not null and (cardinality(p_starts) <> n or cardinality(p_ends) is distinct from n) then
    raise exception using errcode = 'PT400', message = '시간 목록이 일정 수와 맞지 않아요';
  end if;
  update itinerary_items i set
    sort_order = o.ord,
    start_time = case when p_starts is null then i.start_time else (p_starts[o.ord])::time end,
    end_time = case when p_starts is null then i.end_time else (p_ends[o.ord])::time end,
    -- 시간이 바뀐 일정은 사용자가 고친 것으로 (AI 수정 제안이 덮어쓰지 않게)
    user_edited = i.user_edited or (p_starts is not null and (
      i.start_time is distinct from (p_starts[o.ord])::time or i.end_time is distinct from (p_ends[o.ord])::time))
  from unnest(p_ids) with ordinality as o(id, ord)
  where i.id = o.id;
  select revision into v_rev from trip_plans where trip_id = p_trip_id;
  return coalesce(v_rev, 0);
end $$;
revoke execute on function public.reorder_itinerary_times(bigint, date, bigint[], text[], text[]) from public, anon;
grant execute on function public.reorder_itinerary_times(bigint, date, bigint[], text[], text[]) to authenticated;

select '✔ 타임라인 순서·시간 저장 설정 완료' as result;
