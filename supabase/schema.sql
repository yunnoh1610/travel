-- =====================================================================
-- 여행 기록 앱 — Supabase 설정
-- Supabase 대시보드 > SQL Editor > New query 에 이 파일 전체를 붙여넣고 [Run].
-- 여러 번 실행해도 안전해요(이미 있는 건 건너뛰거나 새로 덮어써요).
-- =====================================================================

-- ---------- 테이블 ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 20),
  created_at timestamptz not null default now()
);

create table if not exists public.trips (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 40),
  start_date date,
  end_date date,
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.trip_members (
  trip_id bigint not null references public.trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table if not exists public.places (
  id bigint generated always as identity primary key,
  trip_id bigint not null references public.trips(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  visited_at date,
  comment text check (comment is null or char_length(comment) <= 80),
  category text not null default 'etc' check (category in ('sight', 'food', 'cafe', 'stay', 'nature', 'etc')),
  created_at timestamptz not null default now()
);

create table if not exists public.photos (
  id bigint generated always as identity primary key,
  place_id bigint not null references public.places(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  path text not null,
  thumb_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.trip_invites (
  token text primary key,
  trip_id bigint not null references public.trips(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null
);

create index if not exists trip_members_user_idx on public.trip_members(user_id);
create index if not exists places_trip_idx on public.places(trip_id);
create index if not exists photos_place_idx on public.photos(place_id);
create index if not exists trip_invites_trip_idx on public.trip_invites(trip_id);

-- ---------- 권한 확인용 함수 (RLS 안에서 서로 부르며 무한반복하지 않도록 security definer) ----------
create or replace function public.is_trip_member(tid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from trip_members where trip_id = tid and user_id = auth.uid());
$$;

create or replace function public.is_trip_owner(tid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from trips where id = tid and owner_id = auth.uid());
$$;

create or replace function public.shares_trip_with(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from trip_members a join trip_members b on a.trip_id = b.trip_id
    where a.user_id = auth.uid() and b.user_id = uid
  );
$$;

-- 사진 파일 경로 "여행번호/파일이름.jpg" 에서 여행번호를 꺼냄 (형식이 다르면 null)
create or replace function public.trip_id_from_path(p text) returns bigint
language sql immutable as $$
  select case when split_part(p, '/', 1) ~ '^[0-9]+$' then split_part(p, '/', 1)::bigint end;
$$;

-- ---------- 자동 처리 ----------
-- 가입하면 프로필(이름) 자동 생성
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)), 20))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 여행을 만들면 만든 사람을 멤버로 자동 추가
create or replace function public.add_owner_as_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into trip_members (trip_id, user_id) values (new.id, new.owner_id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists trips_add_owner on public.trips;
create trigger trips_add_owner after insert on public.trips
  for each row execute function public.add_owner_as_member();

-- ---------- 목록용 뷰 (보는 사람의 권한 그대로 적용) ----------
create or replace view public.trip_list with (security_invoker = true) as
select t.*,
  (select count(*) from places p where p.trip_id = t.id) as place_count,
  (select ph.thumb_path from photos ph join places p on p.id = ph.place_id
     where p.trip_id = t.id order by ph.id limit 1) as cover_path
from trips t;

-- ---------- 행 단위 보안(RLS): 같은 여행 멤버만 보고, 쓴 사람/여행 만든 사람만 고치기 ----------
alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.places enable row level security;
alter table public.photos enable row level security;
alter table public.trip_invites enable row level security;  -- 정책 없음: 아래 함수로만 접근

drop policy if exists "profiles: 나와 같은 여행 멤버" on public.profiles;
create policy "profiles: 나와 같은 여행 멤버" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_trip_with(id));
drop policy if exists "profiles: 내 이름 수정" on public.profiles;
create policy "profiles: 내 이름 수정" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "trips: 멤버만 보기" on public.trips;
create policy "trips: 멤버만 보기" on public.trips for select to authenticated
  using (owner_id = auth.uid() or public.is_trip_member(id));
drop policy if exists "trips: 내 여행 만들기" on public.trips;
create policy "trips: 내 여행 만들기" on public.trips for insert to authenticated
  with check (owner_id = auth.uid());
drop policy if exists "trips: 멤버가 수정" on public.trips;
create policy "trips: 멤버가 수정" on public.trips for update to authenticated
  using (public.is_trip_member(id)) with check (public.is_trip_member(id));
drop policy if exists "trips: 만든 사람만 삭제" on public.trips;
create policy "trips: 만든 사람만 삭제" on public.trips for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists "members: 멤버만 보기" on public.trip_members;
create policy "members: 멤버만 보기" on public.trip_members for select to authenticated
  using (public.is_trip_member(trip_id));
drop policy if exists "members: 나가기/내보내기" on public.trip_members;
create policy "members: 나가기/내보내기" on public.trip_members for delete to authenticated
  using (
    (user_id = auth.uid() and not public.is_trip_owner(trip_id))
    or (public.is_trip_owner(trip_id) and user_id <> auth.uid())
  );

drop policy if exists "places: 멤버만 보기" on public.places;
create policy "places: 멤버만 보기" on public.places for select to authenticated
  using (public.is_trip_member(trip_id));
drop policy if exists "places: 멤버가 기록" on public.places;
create policy "places: 멤버가 기록" on public.places for insert to authenticated
  with check (user_id = auth.uid() and public.is_trip_member(trip_id));
drop policy if exists "places: 쓴 사람/여행 주인이 수정" on public.places;
create policy "places: 쓴 사람/여행 주인이 수정" on public.places for update to authenticated
  using (user_id = auth.uid() or public.is_trip_owner(trip_id))
  with check (public.is_trip_member(trip_id));
drop policy if exists "places: 쓴 사람/여행 주인이 삭제" on public.places;
create policy "places: 쓴 사람/여행 주인이 삭제" on public.places for delete to authenticated
  using (user_id = auth.uid() or public.is_trip_owner(trip_id));

drop policy if exists "photos: 멤버만 보기" on public.photos;
create policy "photos: 멤버만 보기" on public.photos for select to authenticated
  using (exists (select 1 from places p where p.id = place_id and public.is_trip_member(p.trip_id)));
drop policy if exists "photos: 멤버가 올리기" on public.photos;
create policy "photos: 멤버가 올리기" on public.photos for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from places p where p.id = place_id and public.is_trip_member(p.trip_id)
        and public.trip_id_from_path(path) = p.trip_id and public.trip_id_from_path(thumb_path) = p.trip_id
    )
  );
drop policy if exists "photos: 올린 사람/기록 쓴 사람/여행 주인이 삭제" on public.photos;
create policy "photos: 올린 사람/기록 쓴 사람/여행 주인이 삭제" on public.photos for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from places p where p.id = place_id and (p.user_id = auth.uid() or public.is_trip_owner(p.trip_id)))
  );

-- 바꾸면 안 되는 칸(주인, 작성자 등)은 수정 자체를 막음
revoke update on public.profiles, public.trips, public.places, public.photos, public.trip_members, public.trip_invites from anon, authenticated;
grant update (name) on public.profiles to authenticated;
grant update (title, start_date, end_date) on public.trips to authenticated;
grant update (name, lat, lng, visited_at, comment, category) on public.places to authenticated;
revoke insert, delete on public.trip_invites from anon, authenticated;
revoke insert on public.trip_members, public.profiles from anon, authenticated;

-- ---------- 초대 링크 ----------
create or replace function public.create_invite(p_trip_id bigint, p_reset boolean default false)
returns table (token text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  if not public.is_trip_member(p_trip_id) then raise exception '여행을 찾을 수 없어요'; end if;
  if p_reset then
    if not public.is_trip_owner(p_trip_id) then raise exception '여행을 만든 사람만 링크를 새로 만들 수 있어요'; end if;
    delete from trip_invites i where i.trip_id = p_trip_id;
  end if;
  delete from trip_invites i where i.expires_at <= now();
  -- 하루 이상 남은 링크가 있으면 그대로 다시 씀
  return query select i.token, i.expires_at from trip_invites i
    where i.trip_id = p_trip_id and i.expires_at > now() + interval '1 day'
    order by i.expires_at desc limit 1;
  if found then return; end if;
  return query insert into trip_invites as i (token, trip_id, created_by, expires_at)
    values (replace(gen_random_uuid()::text, '-', ''), p_trip_id, auth.uid(), now() + interval '7 days')
    returning i.token, i.expires_at;
end $$;

create or replace function public.invite_info(p_token text)
returns table (title text, inviter text, member_count bigint)
language sql stable security definer set search_path = public as $$
  select t.title, p.name, (select count(*) from trip_members m where m.trip_id = t.id)
  from trip_invites i join trips t on t.id = i.trip_id join profiles p on p.id = i.created_by
  where i.token = p_token and i.expires_at > now();
$$;

create or replace function public.accept_invite(p_token text)
returns table (trip_id bigint, title text, already boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_trip bigint; v_title text; v_n int;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  select i.trip_id, t.title into v_trip, v_title
    from trip_invites i join trips t on t.id = i.trip_id
    where i.token = p_token and i.expires_at > now();
  if v_trip is null then raise exception '초대 링크가 만료됐거나 잘못된 링크예요'; end if;
  insert into trip_members (trip_id, user_id) values (v_trip, auth.uid()) on conflict do nothing;
  get diagnostics v_n = row_count;
  return query select v_trip, v_title, v_n = 0;
end $$;

-- ---------- 회원 탈퇴 ----------
-- 앱이 먼저 my_storage_paths() 의 사진 파일을 지운 뒤 delete_my_account() 를 불러요.
create or replace function public.my_storage_paths() returns setof text
language sql stable security definer set search_path = public as $$
  select x from (
    select unnest(array[ph.path, ph.thumb_path]) as x
    from photos ph join places p on p.id = ph.place_id join trips t on t.id = p.trip_id
    where ph.user_id = auth.uid() or p.user_id = auth.uid() or t.owner_id = auth.uid()
  ) s;
$$;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- ---------- 잠들기 방지용 (GitHub Actions 가 며칠마다 부름) ----------
create or replace function public.ping() returns text
language sql stable as $$ select 'ok' $$;

-- 함수 실행 권한
revoke execute on function public.create_invite(bigint, boolean), public.accept_invite(text),
  public.my_storage_paths(), public.delete_my_account() from public, anon;
grant execute on function public.create_invite(bigint, boolean), public.accept_invite(text),
  public.my_storage_paths(), public.delete_my_account() to authenticated;
grant execute on function public.invite_info(text), public.ping() to anon, authenticated;

-- ---------- 사진 저장소 ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 4194304, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 4194304, allowed_mime_types = array['image/jpeg'];

drop policy if exists "photos 파일: 멤버만 보기" on storage.objects;
create policy "photos 파일: 멤버만 보기" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_trip_member(public.trip_id_from_path(name)));
drop policy if exists "photos 파일: 멤버가 올리기" on storage.objects;
create policy "photos 파일: 멤버가 올리기" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_trip_member(public.trip_id_from_path(name)));
drop policy if exists "photos 파일: 올린 사람/기록 쓴 사람/여행 주인이 삭제" on storage.objects;
create policy "photos 파일: 올린 사람/기록 쓴 사람/여행 주인이 삭제" on storage.objects for delete to authenticated
  using (
    bucket_id = 'photos' and (
      owner_id = auth.uid()::text
      or public.is_trip_owner(public.trip_id_from_path(name))
      or exists (
        select 1 from public.photos ph join public.places p on p.id = ph.place_id
        where (ph.path = name or ph.thumb_path = name) and p.user_id = auth.uid()
      )
    )
  );

select '✔ 여행 기록 앱 설정 완료' as result;
