-- =====================================================================
-- 여행 기록 앱 — 스크랩북 디자인 확장 (006)
--   새 템플릿: 여행 일기(DIARY), 사진 콜라주(COLLAGE)
--   새 배경: 단색(white, cream, sky, peach, night) · 패턴(lined, dots, stripe, check) · 질감(linen)
-- Supabase 대시보드 > SQL Editor > New query 에 붙여넣고 [Run]. 여러 번 실행해도 안전해요.
-- 004 다음에 실행해요. 기존 페이지·요소는 그대로이고, 허용하는 값만 늘어나요.
-- 되돌리기: supabase/rollback-006-scrapbook-design.sql
-- =====================================================================

alter table public.scrapbook_pages drop constraint if exists scrapbook_pages_template_check;
alter table public.scrapbook_pages add constraint scrapbook_pages_template_check
  check (template in ('BLANK', 'POLAROID', 'DAY', 'GRID', 'DIARY', 'COLLAGE'));

alter table public.scrapbook_pages drop constraint if exists scrapbook_pages_background_check;
alter table public.scrapbook_pages add constraint scrapbook_pages_background_check
  check (background in ('paper', 'grid', 'kraft', 'mint', 'lilac',
    'white', 'cream', 'sky', 'peach', 'night', 'lined', 'dots', 'stripe', 'check', 'linen'));

select '✔ 스크랩북 디자인 확장 설정 완료' as result;
