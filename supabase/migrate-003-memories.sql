-- =====================================================================
-- 여행 기록 앱 — 추억 기록용으로 넓히기 (003)
--   1) 기록장 종류: 여행 / 모임·기념일 / 일상   (기존 기록장은 모두 '여행')
--   2) 기록마다 긴 이야기(메모) 칸
--   3) 친구 한마디(댓글)
-- Supabase 대시보드 > SQL Editor > New query 에 붙여넣고 [Run]. 여러 번 실행해도 안전해요.
-- =====================================================================

-- ---------- 1) 기록장 종류 ----------
alter table public.trips add column if not exists kind text not null default 'trip';
do $$ begin
  alter table public.trips add constraint trips_kind_check check (kind in ('trip', 'gathering', 'daily'));
exception when duplicate_object then null; end $$;

-- ---------- 2) 이야기(긴 메모) ----------
alter table public.places add column if not exists memo text;
do $$ begin
  alter table public.places add constraint places_memo_len check (memo is null or char_length(memo) <= 2000);
exception when duplicate_object then null; end $$;

-- 새 칸도 수정할 수 있게
grant update (title, start_date, end_date, kind) on public.trips to authenticated;
grant update (name, lat, lng, visited_at, comment, category, memo) on public.places to authenticated;

-- 목록용 뷰에 새 칸(kind) 반영 (칸 구성이 바뀌어서 지우고 다시 만듦)
drop view if exists public.trip_list;
create view public.trip_list with (security_invoker = true) as
select t.*,
  (select count(*) from places p where p.trip_id = t.id) as place_count,
  (select ph.thumb_path from photos ph join places p on p.id = ph.place_id
     where p.trip_id = t.id order by ph.id limit 1) as cover_path
from trips t;
revoke all on public.trip_list from anon;
grant select on public.trip_list to authenticated;

-- ---------- 3) 친구 한마디 ----------
create table if not exists public.place_comments (
  id bigint generated always as identity primary key,
  place_id bigint not null references public.places(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists place_comments_place_idx on public.place_comments(place_id);
alter table public.place_comments enable row level security;

drop policy if exists "comments: 멤버만 보기" on public.place_comments;
create policy "comments: 멤버만 보기" on public.place_comments for select to authenticated
  using (exists (select 1 from places p where p.id = place_id and public.is_trip_member(p.trip_id)));
drop policy if exists "comments: 멤버가 쓰기" on public.place_comments;
create policy "comments: 멤버가 쓰기" on public.place_comments for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from places p where p.id = place_id and public.is_trip_member(p.trip_id)));
drop policy if exists "comments: 쓴 사람/기록장 주인이 지우기" on public.place_comments;
create policy "comments: 쓴 사람/기록장 주인이 지우기" on public.place_comments for delete to authenticated
  using (user_id = auth.uid()
    or exists (select 1 from places p where p.id = place_id and public.is_trip_owner(p.trip_id)));

revoke all on public.place_comments from anon;
revoke update on public.place_comments from authenticated;
grant select, insert, delete on public.place_comments to authenticated;

select '✔ 추억 기록 기능 설정 완료' as result;
