-- =====================================================================
-- 여행 기록 앱 — 아이디 가입으로 바꾸기 (002)
-- Supabase 대시보드 > SQL Editor > New query 에 붙여넣고 [Run].
-- 여러 번 실행해도 안전해요.
--
-- 방식: 아이디 "minji" 로 가입하면 Supabase 안에서는
--       "minji@travel-diary.example.com" 이라는 가짜 이메일로 저장돼요.
--       (example.com 은 실제로 메일이 가지 않는 예약 주소예요. 화면에는 아이디만 보여요.)
-- =====================================================================

alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_key on public.profiles (lower(username));

-- 이미 아이디 방식으로 가입한 계정이 있으면 아이디 채우기
update public.profiles p
set username = split_part(u.email, '@', 1)
from auth.users u
where u.id = p.id and p.username is null and u.email like '%@travel-diary.example.com';

-- 가입할 때 이름 + 아이디를 프로필에 저장
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, username)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)), 20),
    case when new.email like '%@travel-diary.example.com' then split_part(new.email, '@', 1) end
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- 이미 가입한 친구를 아이디로 여행에 초대
create or replace function public.add_member_by_username(p_trip_id bigint, p_username text)
returns table (id uuid, name text, username text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_id uuid; v_name text; v_username text;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  if not public.is_trip_member(p_trip_id) then raise exception '여행을 찾을 수 없어요'; end if;
  select p.id, p.name, p.username into v_id, v_name, v_username
    from profiles p where lower(p.username) = lower(trim(p_username));
  if v_id is null then raise exception '그런 아이디를 가진 사람이 없어요'; end if;
  insert into trip_members (trip_id, user_id) values (p_trip_id, v_id) on conflict do nothing;
  return query select v_id, v_name, v_username;
end $$;

revoke execute on function public.add_member_by_username(bigint, text) from public, anon;
grant execute on function public.add_member_by_username(bigint, text) to authenticated;

select '✔ 아이디 가입 설정 완료' as result;
