-- =====================================================================
-- 여행 기록 앱 — 기록 시간·일정 연결 (005)
--   1) 장소 기록에 "찍은/방문한 시각" (사진 촬영 시간에서 자동, 직접 고칠 수 있음)
--   2) 장소 기록을 여행 계획의 일정에 연결 (계획 시간은 바꾸지 않음)
--   3) 사진마다 촬영 일시 (EXIF)
-- Supabase 대시보드 > SQL Editor > New query 에 붙여넣고 [Run]. 여러 번 실행해도 안전해요.
-- 004(migrate-004-planner-scrapbook.sql) 다음에 실행해요. 기존 데이터는 그대로이고 새 칸은 비어 있어요.
-- 되돌리기: supabase/rollback-005-record-time-plan-link.sql
-- =====================================================================

alter table public.places add column if not exists visited_time time;
alter table public.places add column if not exists plan_item_id bigint
  references public.itinerary_items(id) on delete set null;
alter table public.photos add column if not exists taken_at timestamptz;
create index if not exists places_plan_item_idx on public.places(plan_item_id);

-- 연결하는 일정은 같은 기록장의 일정만
create or replace function public.check_place_plan_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.plan_item_id is not null and not exists (
    select 1 from itinerary_items i where i.id = new.plan_item_id and i.trip_id = new.trip_id
  ) then
    raise exception using errcode = 'PT400', message = '다른 기록장의 일정에는 연결할 수 없어요';
  end if;
  return new;
end $$;
drop trigger if exists places_plan_item_check on public.places;
create trigger places_plan_item_check before insert or update of plan_item_id, trip_id on public.places
  for each row execute function public.check_place_plan_item();
revoke execute on function public.check_place_plan_item() from public, anon;

-- 새 칸도 수정할 수 있게 (기존 권한 규칙: 쓴 사람/기록장 주인만 수정)
grant update (name, lat, lng, visited_at, comment, category, memo, visited_time, plan_item_id) on public.places to authenticated;

select '✔ 기록 시간·일정 연결 설정 완료' as result;
