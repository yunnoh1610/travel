-- =====================================================================
-- 여행 기록 앱 — 대중교통 단계별 안내 (013)
--   일정 사이 이동 정보(transit, 011)에 "타는 방법" 단계(steps: 최대 4줄)를 함께 저장
--   예: ["터미널 앞 정류장에서 탑승", "공산성 방면 시내버스", "공산성 정류장 하차", "매표소까지 걸어서 3분"]
-- 011 다음에 실행해요. Supabase 대시보드 > SQL Editor > New query 에 붙여넣고 [Run]. 여러 번 실행해도 안전해요.
-- 기존 일정·이동 정보는 그대로예요. 되돌리기: supabase/rollback-013-transit-steps.sql
-- =====================================================================

-- AI 초안의 이동 정보를 허용한 모양으로만 꺼냄 (단계는 대중교통일 때만, 4줄·한 줄 60자까지)
create or replace function public.transit_of(it jsonb) returns jsonb
language sql immutable as $$
  select case when jsonb_typeof(it -> 'transit') = 'object'
      and upper(it -> 'transit' ->> 'mode') in ('WALK', 'BUS', 'SUBWAY', 'TRAIN', 'TAXI', 'CAR', 'BIKE', 'FERRY', 'FLIGHT')
    then jsonb_build_object(
      'mode', upper(it -> 'transit' ->> 'mode'),
      'minutes', case when (it -> 'transit' ->> 'minutes') ~ '^[0-9]{1,4}$'
        and (it -> 'transit' ->> 'minutes')::int between 1 and 1440 then (it -> 'transit' ->> 'minutes')::int end,
      'detail', nullif(left(coalesce(it -> 'transit' ->> 'detail', ''), 80), ''),
      'steps', case when upper(it -> 'transit' ->> 'mode') in ('BUS', 'SUBWAY', 'TRAIN', 'FERRY')
          and jsonb_typeof(it -> 'transit' -> 'steps') = 'array'
        then coalesce((select jsonb_agg(left(btrim(x), 60)) from (
            select x from jsonb_array_elements_text(it -> 'transit' -> 'steps') with ordinality e(x, n)
            where btrim(x) <> '' order by n limit 4) s), '[]'::jsonb)
        else '[]'::jsonb end)
  end
$$;

-- 단계가 들어가도록 크기 제한을 넓힘 (모양 규칙은 그대로)
alter table public.itinerary_items drop constraint if exists itinerary_transit_check;
alter table public.itinerary_items add constraint itinerary_transit_check check (
  transit is null or (jsonb_typeof(transit) = 'object'
    and transit ->> 'mode' in ('WALK', 'BUS', 'SUBWAY', 'TRAIN', 'TAXI', 'CAR', 'BIKE', 'FERRY', 'FLIGHT')
    and (transit -> 'steps' is null or (jsonb_typeof(transit -> 'steps') = 'array' and jsonb_array_length(transit -> 'steps') <= 4))
    and pg_column_size(transit) <= 1500));

select '✔ 대중교통 단계별 안내 설정 완료' as result;
