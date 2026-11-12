-- 006 되돌리기: 새 배경·템플릿을 쓴 페이지를 예전 값으로 바꾼 뒤 허용 목록을 원래대로
-- (페이지와 요소는 지워지지 않아요. 새 배경은 종이, 새 템플릿은 빈 페이지 표시로 바뀌어요)
update public.scrapbook_pages set background = 'paper'
  where background not in ('paper', 'grid', 'kraft', 'mint', 'lilac');
update public.scrapbook_pages set template = 'BLANK'
  where template not in ('BLANK', 'POLAROID', 'DAY', 'GRID');

alter table public.scrapbook_pages drop constraint if exists scrapbook_pages_template_check;
alter table public.scrapbook_pages add constraint scrapbook_pages_template_check
  check (template in ('BLANK', 'POLAROID', 'DAY', 'GRID'));
alter table public.scrapbook_pages drop constraint if exists scrapbook_pages_background_check;
alter table public.scrapbook_pages add constraint scrapbook_pages_background_check
  check (background in ('paper', 'grid', 'kraft', 'mint', 'lilac'));

select '✔ 006 되돌리기 완료' as result;
