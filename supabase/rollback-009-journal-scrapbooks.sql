-- 009 되돌리기: 기록 제목·감정·태그·즐겨찾기, 여러 스크랩북, 새 템플릿을 빼요
-- 주의: 위치 없이 남긴 기록이 있으면 위치 칸을 다시 필수로 바꿀 수 없어서 멈춰요 (그 기록에 위치를 넣거나 지운 뒤 다시 실행)
-- 스크랩북 페이지는 그대로 남고, 어느 스크랩북인지만 지워져요. 새 템플릿으로 만든 페이지는 '빈 페이지'로 바뀌어요.
update public.scrapbook_pages set template = 'BLANK' where template in ('FILM', 'TICKET', 'MINIMAL');
alter table public.scrapbook_pages drop constraint if exists scrapbook_pages_template_check;
alter table public.scrapbook_pages add constraint scrapbook_pages_template_check
  check (template in ('BLANK', 'POLAROID', 'DAY', 'GRID', 'DIARY', 'COLLAGE'));

drop trigger if exists scrapbook_page_book on public.scrapbook_pages;
drop function if exists public.scrapbook_page_book();
grant update (page_date, title, template, background, page_order) on public.scrapbook_pages to authenticated;
revoke update (scrapbook_id) on public.scrapbook_pages from authenticated;
alter table public.scrapbook_pages drop column if exists scrapbook_id;
drop table if exists public.scrapbooks;

drop table if exists public.place_favorites;

alter table public.places drop constraint if exists places_latlng_pair;
alter table public.places alter column lat set not null;
alter table public.places alter column lng set not null;
alter table public.places drop constraint if exists places_tags_check;
drop function if exists public.valid_tags(text[]);
revoke update (title, mood, tags) on public.places from authenticated;
alter table public.places drop column if exists tags;
alter table public.places drop column if exists mood;
alter table public.places drop column if exists title;
grant update (name, lat, lng, visited_at, comment, category, memo, visited_time, plan_item_id) on public.places to authenticated;

select '✔ 009 되돌리기 완료' as result;
