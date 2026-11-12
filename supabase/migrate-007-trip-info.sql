-- =====================================================================
-- 여행 기록 앱 — 여행 정보 확장 (007)
--   여행 국가 · 도시(여러 개) · 여행 유형(혼자/커플/친구/가족/단체) · 대표 사진(직접 고르기)
--   (여행 스타일·교통·예산은 AI 일정 조건과 같은 trip_plans.prefs 에 저장해요 — 테이블 변경 없음)
-- Supabase 대시보드 > SQL Editor > New query 에 붙여넣고 [Run]. 여러 번 실행해도 안전해요.
-- 기존 여행은 그대로이고 새 칸은 비어 있어요. 되돌리기: supabase/rollback-007-trip-info.sql
-- =====================================================================

alter table public.trips add column if not exists country text;
alter table public.trips add column if not exists cities text[];
alter table public.trips add column if not exists party_type text;
alter table public.trips add column if not exists cover_photo_id bigint references public.photos(id) on delete set null;

do $$ begin
  alter table public.trips add constraint trips_country_len check (country is null or char_length(country) between 1 and 40);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.trips add constraint trips_cities_len check (cities is null or cardinality(cities) <= 10);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.trips add constraint trips_party_type_check check (party_type is null or party_type in ('SOLO', 'COUPLE', 'FRIENDS', 'FAMILY', 'GROUP'));
exception when duplicate_object then null; end $$;

-- 대표 사진은 그 여행에 올린 사진만
create or replace function public.check_trip_cover() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cover_photo_id is not null and not exists (
    select 1 from photos ph join places p on p.id = ph.place_id
    where ph.id = new.cover_photo_id and p.trip_id = new.id
  ) then
    raise exception using errcode = 'PT400', message = '이 여행에 올린 사진만 대표 사진으로 고를 수 있어요';
  end if;
  return new;
end $$;
drop trigger if exists trips_cover_check on public.trips;
create trigger trips_cover_check before insert or update of cover_photo_id on public.trips
  for each row execute function public.check_trip_cover();
revoke execute on function public.check_trip_cover() from public, anon;

-- 새 칸도 멤버가 수정할 수 있게 (기존 규칙: 멤버가 수정, 주인·작성자 칸은 고정)
grant update (title, start_date, end_date, kind, country, cities, party_type, cover_photo_id) on public.trips to authenticated;

-- 목록용 뷰: 새 칸 포함 + 대표 사진(고른 사진이 있으면 그것, 없으면 첫 사진)
drop view if exists public.trip_list;
create view public.trip_list with (security_invoker = true) as
select t.*,
  (select count(*) from places p where p.trip_id = t.id) as place_count,
  coalesce(
    (select ph.thumb_path from photos ph where ph.id = t.cover_photo_id),
    (select ph.thumb_path from photos ph join places p on p.id = ph.place_id
       where p.trip_id = t.id order by ph.id limit 1)
  ) as cover_path
from trips t;
revoke all on public.trip_list from anon;
grant select on public.trip_list to authenticated;

select '✔ 여행 정보 확장 설정 완료' as result;
