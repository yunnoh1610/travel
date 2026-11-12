-- =====================================================================
-- 004 되돌리기 (AI 여행 계획·예산·체크리스트·스크랩북 기능 제거)
-- ⚠️ 일정·지출·준비물·스크랩북·AI 초안 데이터가 모두 지워져요. 기존 기록(장소·사진·한마디)은 그대로예요.
-- 실행 전에 앱에서 스크랩북 전용 사진을 지우려면 먼저 아래 경로를 확인해 저장소에서 지워 주세요:
--   select asset_path from public.scrapbook_elements where asset_path is not null;
-- =====================================================================

drop function if exists public.apply_ai_draft(uuid, text[], integer);
drop function if exists public.discard_ai_draft(uuid);
drop function if exists public.save_plan_prefs(bigint, jsonb);
drop function if exists public.reorder_itinerary(bigint, date, bigint[]);
drop function if exists public.renumber_day(bigint, date);
drop function if exists public.save_scrapbook_page(bigint, integer, jsonb);
drop function if exists public.reorder_scrapbook_pages(bigint, bigint[]);

drop table if exists public.scrapbook_elements;
drop table if exists public.scrapbook_pages;
drop table if exists public.checklist_items;
drop table if exists public.trip_expenses;
drop table if exists public.ai_request_log;
drop table if exists public.ai_drafts;
drop table if exists public.itinerary_items;
drop table if exists public.trip_plans;

drop function if exists public.bump_plan_revision();
drop function if exists public.check_itinerary_item();
drop function if exists public.touch_updated_at();
drop function if exists public.trip_date_ok(bigint, date);

-- 회원 탈퇴용 함수를 schema.sql 의 원래 내용으로
create or replace function public.my_storage_paths() returns setof text
language sql stable security definer set search_path = public as $$
  select x from (
    select unnest(array[ph.path, ph.thumb_path]) as x
    from photos ph join places p on p.id = ph.place_id join trips t on t.id = p.trip_id
    where ph.user_id = auth.uid() or p.user_id = auth.uid() or t.owner_id = auth.uid()
  ) s;
$$;

select '✔ 004 되돌리기 완료' as result;
