-- 008 되돌리기: 일정 상태·동행자 칸 삭제 (일정 자체는 그대로)
drop trigger if exists itinerary_assignees_check on public.itinerary_items;
drop function if exists public.check_itinerary_assignees();
alter table public.itinerary_items drop column if exists assignees;
alter table public.itinerary_items drop column if exists status;
grant update (day_date, sort_order, item_type, title, start_time, end_time, place_id, place_name, address, lat, lng,
  verification_status, cost_estimate, currency, notes, user_edited) on public.itinerary_items to authenticated;
select '✔ 008 되돌리기 완료' as result;
