-- 005 되돌리기 (기록 시각·일정 연결·사진 촬영 일시 칸 삭제). 장소·사진 기록 자체는 그대로예요.
drop trigger if exists places_plan_item_check on public.places;
drop function if exists public.check_place_plan_item();
drop index if exists public.places_plan_item_idx;
alter table public.places drop column if exists plan_item_id;
alter table public.places drop column if exists visited_time;
alter table public.photos drop column if exists taken_at;
grant update (name, lat, lng, visited_at, comment, category, memo) on public.places to authenticated;
select '✔ 005 되돌리기 완료' as result;
