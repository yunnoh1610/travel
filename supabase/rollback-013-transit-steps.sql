-- 013 되돌리기: 이동 정보의 단계(steps)를 빼고 011 모양으로 (일정은 그대로)
update public.itinerary_items set transit = transit - 'steps' where transit ? 'steps';
create or replace function public.transit_of(it jsonb) returns jsonb
language sql immutable as $$
  select case when jsonb_typeof(it -> 'transit') = 'object'
      and upper(it -> 'transit' ->> 'mode') in ('WALK', 'BUS', 'SUBWAY', 'TRAIN', 'TAXI', 'CAR', 'BIKE', 'FERRY', 'FLIGHT')
    then jsonb_build_object(
      'mode', upper(it -> 'transit' ->> 'mode'),
      'minutes', case when (it -> 'transit' ->> 'minutes') ~ '^[0-9]{1,4}$'
        and (it -> 'transit' ->> 'minutes')::int between 1 and 1440 then (it -> 'transit' ->> 'minutes')::int end,
      'detail', nullif(left(coalesce(it -> 'transit' ->> 'detail', ''), 80), ''))
  end
$$;

alter table public.itinerary_items drop constraint if exists itinerary_transit_check;
do $$ begin
  alter table public.itinerary_items add constraint itinerary_transit_check check (
    transit is null or (jsonb_typeof(transit) = 'object'
      and transit ->> 'mode' in ('WALK', 'BUS', 'SUBWAY', 'TRAIN', 'TAXI', 'CAR', 'BIKE', 'FERRY', 'FLIGHT')
      and pg_column_size(transit) <= 600));
exception when duplicate_object then null; end $$;

select '✔ 013 되돌리기 완료' as result;
