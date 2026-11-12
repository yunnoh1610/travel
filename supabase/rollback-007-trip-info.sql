-- 007 되돌리기: 여행 국가·도시·유형·대표 사진 칸 삭제 (여행·기록·사진은 그대로)
drop view if exists public.trip_list;
drop trigger if exists trips_cover_check on public.trips;
drop function if exists public.check_trip_cover();
alter table public.trips drop column if exists cover_photo_id;
alter table public.trips drop column if exists party_type;
alter table public.trips drop column if exists cities;
alter table public.trips drop column if exists country;
grant update (title, start_date, end_date, kind) on public.trips to authenticated;

-- 목록용 뷰를 003 의 내용으로
create view public.trip_list with (security_invoker = true) as
select t.*,
  (select count(*) from places p where p.trip_id = t.id) as place_count,
  (select ph.thumb_path from photos ph join places p on p.id = ph.place_id
     where p.trip_id = t.id order by ph.id limit 1) as cover_path
from trips t;
revoke all on public.trip_list from anon;
grant select on public.trip_list to authenticated;

select '✔ 007 되돌리기 완료' as result;
