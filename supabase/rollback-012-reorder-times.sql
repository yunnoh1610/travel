-- 012 되돌리기: 순서·시간 한 번에 저장 함수 삭제 (일정은 그대로)
drop function if exists public.reorder_itinerary_times(bigint, date, bigint[], text[], text[]);
select '✔ 012 되돌리기 완료' as result;
