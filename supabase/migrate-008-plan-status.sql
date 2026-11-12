-- =====================================================================
-- 여행 기록 앱 — 일정 상태 · 동행자 (008)
--   일정마다 상태: 예정(PLANNED) / 방문 완료(DONE) / 취소(CANCELLED)
--   일정마다 함께 가는 멤버(동행자) — 그 여행 멤버만
-- Supabase 대시보드 > SQL Editor > New query 에 붙여넣고 [Run]. 여러 번 실행해도 안전해요.
-- 기존 일정은 모두 '예정'으로 시작해요. 되돌리기: supabase/rollback-008-plan-status.sql
-- =====================================================================

alter table public.itinerary_items add column if not exists status text not null default 'PLANNED';
do $$ begin
  alter table public.itinerary_items add constraint itinerary_status_check check (status in ('PLANNED', 'DONE', 'CANCELLED'));
exception when duplicate_object then null; end $$;
alter table public.itinerary_items add column if not exists assignees uuid[];
do $$ begin
  alter table public.itinerary_items add constraint itinerary_assignees_len check (assignees is null or cardinality(assignees) <= 30);
exception when duplicate_object then null; end $$;

-- 이미 기록이 연결된 일정은 '방문 완료'로
update public.itinerary_items i set status = 'DONE'
where status = 'PLANNED' and exists (select 1 from public.places p where p.plan_item_id = i.id);

-- 동행자는 그 여행 멤버만
create or replace function public.check_itinerary_assignees() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assignees is not null and exists (
    select 1 from unnest(new.assignees) u
    where not exists (select 1 from trip_members m where m.trip_id = new.trip_id and m.user_id = u)
  ) then
    raise exception using errcode = 'PT400', message = '여행 멤버만 동행자로 고를 수 있어요';
  end if;
  return new;
end $$;
drop trigger if exists itinerary_assignees_check on public.itinerary_items;
create trigger itinerary_assignees_check before insert or update of assignees, trip_id on public.itinerary_items
  for each row execute function public.check_itinerary_assignees();
revoke execute on function public.check_itinerary_assignees() from public, anon;

-- 새 칸도 멤버가 수정할 수 있게 (기존 규칙: 일정은 멤버가 함께 고침)
grant update (day_date, sort_order, item_type, title, start_time, end_time, place_id, place_name, address, lat, lng,
  verification_status, cost_estimate, currency, notes, user_edited, status, assignees) on public.itinerary_items to authenticated;

select '✔ 일정 상태·동행자 설정 완료' as result;
