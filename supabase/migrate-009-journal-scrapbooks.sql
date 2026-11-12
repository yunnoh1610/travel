-- =====================================================================
-- 여행 기록 앱 — 기록장·스크랩북 고도화 (009)
--   기록: 제목 · 감정 · 태그 · 즐겨찾기(사람마다) · 위치 없이 기록하기
--   스크랩북: 여행마다 여러 권 (기존 페이지는 '기본 스크랩북'으로 옮겨요)
--   새 템플릿: 필름(FILM) · 여행 티켓(TICKET) · 미니멀 앨범(MINIMAL)
-- Supabase 대시보드 > SQL Editor > New query 에 붙여넣고 [Run]. 여러 번 실행해도 안전해요.
-- 기존 기록·사진·페이지는 지우거나 바꾸지 않아요. 되돌리기: supabase/rollback-009-journal-scrapbooks.sql
-- =====================================================================

-- ---------- 기록: 제목 · 감정 · 태그 ----------
alter table public.places add column if not exists title text;
alter table public.places add column if not exists mood text;
alter table public.places add column if not exists tags text[];
do $$ begin
  alter table public.places add constraint places_title_len check (title is null or char_length(title) between 1 and 40);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.places add constraint places_mood_check
    check (mood is null or mood in ('HAPPY', 'EXCITED', 'CALM', 'YUMMY', 'MOVED', 'TIRED', 'SAD'));
exception when duplicate_object then null; end $$;

-- 태그: 10개까지, 하나에 1~20자 (check 안에서는 하위 질의를 못 써서 함수로)
create or replace function public.valid_tags(t text[]) returns boolean
language sql immutable as $$
  select t is null or (cardinality(t) <= 10
    and not exists (select 1 from unnest(t) x where x is null or char_length(x) not between 1 and 20))
$$;
do $$ begin
  alter table public.places add constraint places_tags_check check (public.valid_tags(tags));
exception when duplicate_object then null; end $$;

-- ---------- 위치 없이 기록 (지도에는 위치 있는 기록만 보여요) ----------
alter table public.places alter column lat drop not null;
alter table public.places alter column lng drop not null;
do $$ begin
  alter table public.places add constraint places_latlng_pair check ((lat is null) = (lng is null));
exception when duplicate_object then null; end $$;

grant update (name, lat, lng, visited_at, comment, category, memo, visited_time, plan_item_id, title, mood, tags)
  on public.places to authenticated;

-- ---------- 즐겨찾기 (사람마다 따로) ----------
create table if not exists public.place_favorites (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  place_id bigint not null references public.places(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
create index if not exists place_favorites_place_idx on public.place_favorites (place_id);
alter table public.place_favorites enable row level security;
drop policy if exists "즐겨찾기: 내 것만 보기" on public.place_favorites;
create policy "즐겨찾기: 내 것만 보기" on public.place_favorites for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "즐겨찾기: 멤버인 여행의 기록만" on public.place_favorites;
create policy "즐겨찾기: 멤버인 여행의 기록만" on public.place_favorites for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from places p where p.id = place_id and public.is_trip_member(p.trip_id)));
drop policy if exists "즐겨찾기: 내 것만 지우기" on public.place_favorites;
create policy "즐겨찾기: 내 것만 지우기" on public.place_favorites for delete to authenticated
  using (user_id = auth.uid());
revoke all on public.place_favorites from anon;
revoke update on public.place_favorites from authenticated;
grant select, insert, delete on public.place_favorites to authenticated;

-- ---------- 여러 스크랩북 ----------
create table if not exists public.scrapbooks (
  id bigint generated always as identity primary key,
  trip_id bigint not null references public.trips(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 40),
  sort_order integer not null default 0,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists scrapbooks_trip_idx on public.scrapbooks (trip_id, sort_order);
alter table public.scrapbooks enable row level security;
drop policy if exists "스크랩북: 멤버만 보기" on public.scrapbooks;
create policy "스크랩북: 멤버만 보기" on public.scrapbooks for select to authenticated
  using (public.is_trip_member(trip_id));
drop policy if exists "스크랩북: 멤버가 만들기" on public.scrapbooks;
create policy "스크랩북: 멤버가 만들기" on public.scrapbooks for insert to authenticated
  with check (public.is_trip_member(trip_id) and created_by = auth.uid());
drop policy if exists "스크랩북: 멤버가 수정" on public.scrapbooks;
create policy "스크랩북: 멤버가 수정" on public.scrapbooks for update to authenticated
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
drop policy if exists "스크랩북: 멤버가 삭제" on public.scrapbooks;
create policy "스크랩북: 멤버가 삭제" on public.scrapbooks for delete to authenticated
  using (public.is_trip_member(trip_id));
revoke all on public.scrapbooks from anon;
revoke update on public.scrapbooks from authenticated;
grant select, insert, delete on public.scrapbooks to authenticated;
grant update (title, sort_order) on public.scrapbooks to authenticated;

alter table public.scrapbook_pages add column if not exists scrapbook_id bigint references public.scrapbooks(id) on delete cascade;
create index if not exists scrapbook_pages_book_idx on public.scrapbook_pages (scrapbook_id, page_order);

-- 기존 페이지 → 여행마다 '기본 스크랩북' 하나로 (이미 옮긴 여행은 건너뜀)
insert into public.scrapbooks (trip_id, title, sort_order, created_by)
select t.trip_id, '기본 스크랩북', 0, t.owner_id
from (select distinct p.trip_id, tr.owner_id from public.scrapbook_pages p join public.trips tr on tr.id = p.trip_id
      where p.scrapbook_id is null) t
where not exists (select 1 from public.scrapbooks b where b.trip_id = t.trip_id);
update public.scrapbook_pages p set scrapbook_id = (
  select b.id from public.scrapbooks b where b.trip_id = p.trip_id order by b.sort_order, b.id limit 1)
where p.scrapbook_id is null;

-- 새 페이지: 스크랩북을 안 정하면 그 여행의 첫 스크랩북(없으면 만들기). 다른 여행의 스크랩북은 거부
create or replace function public.scrapbook_page_book() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_trip bigint;
begin
  if new.scrapbook_id is null then
    select id into new.scrapbook_id from scrapbooks where trip_id = new.trip_id order by sort_order, id limit 1;
    if new.scrapbook_id is null then
      insert into scrapbooks (trip_id, title, sort_order, created_by) values (new.trip_id, '기본 스크랩북', 0, auth.uid())
      returning id into new.scrapbook_id;
    end if;
  else
    select trip_id into v_trip from scrapbooks where id = new.scrapbook_id;
    if v_trip is distinct from new.trip_id then
      raise exception using errcode = 'PT400', message = '같은 여행의 스크랩북에만 페이지를 넣을 수 있어요';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists scrapbook_page_book on public.scrapbook_pages;
create trigger scrapbook_page_book before insert or update of scrapbook_id, trip_id on public.scrapbook_pages
  for each row execute function public.scrapbook_page_book();
revoke execute on function public.scrapbook_page_book() from public, anon;

grant update (page_date, title, template, background, page_order, scrapbook_id) on public.scrapbook_pages to authenticated;

-- ---------- 새 템플릿 ----------
alter table public.scrapbook_pages drop constraint if exists scrapbook_pages_template_check;
alter table public.scrapbook_pages add constraint scrapbook_pages_template_check
  check (template in ('BLANK', 'POLAROID', 'DAY', 'GRID', 'DIARY', 'COLLAGE', 'FILM', 'TICKET', 'MINIMAL'));

select '✔ 기록장·스크랩북 고도화 설정 완료' as result;
