'use strict';
// =====================================================================
// 스크랩북 탭: 페이지 목록 · 템플릿 · 자유 배치 편집기 (사진/글자/스티커)
// - 페이지는 이미지 한 장이 아니라 "요소 목록"(위치·크기·회전·레이어)으로 저장해서 다시 고칠 수 있어요
// - 논리 캔버스 1000×1400 을 화면 폭에 맞춰 줄여 보여 주므로 어느 기기에서도 배치가 같아요
// - 사진은 기존 사진(photos)을 참조하고, 새로 올린 사진만 저장소에 따로 올려요
// =====================================================================
(() => {
  const CW = 1000;
  const CH = 1400;
  const TEMPLATES = {
    BLANK: ['📄', '빈 페이지', '자유롭게 꾸며요'],
    DAY: ['📅', '하루 기록', '날짜 제목 + 그날 사진 3장'],
    DIARY: ['📔', '여행 일기', '날짜 도장 + 사진 2장 + 줄노트에 일기'],
    POLAROID: ['🖼️', '폴라로이드', '그날 사진을 폴라로이드로'],
    COLLAGE: ['🧩', '사진 콜라주', '사진 5장을 꽉 차게'],
    GRID: ['🔲', '사진 4칸', '사진 4장을 바둑판으로'],
    FILM: ['🎞️', '필름 카메라', '필름 띠 안에 사진 3장'],
    TICKET: ['🎫', '여행 티켓', '여행 티켓 + 큰 사진 + 그날 한마디'],
    MINIMAL: ['⬜', '미니멀 앨범', '사진 한 장과 제목만 깔끔하게'],
  };
  const NEW_TEMPLATES = ['FILM', 'TICKET', 'MINIMAL']; // DB 설정 009 이 있어야 저장돼요
  const TEMPLATE_BG = { DIARY: 'lined', COLLAGE: 'white', FILM: 'night', TICKET: 'kraft', MINIMAL: 'white' }; // 템플릿에 어울리는 기본 배경
  // 배경: 질감 · 패턴 · 단색 (DB 설정 006 이 있어야 새 배경·템플릿을 저장할 수 있어요)
  const BG_GROUPS = [
    ['질감', { paper: '종이', kraft: '크라프트', linen: '린넨' }],
    ['패턴', { grid: '모눈', lined: '줄노트', dots: '도트', stripe: '줄무늬', check: '체크' }],
    ['단색', { white: '흰색', cream: '크림', mint: '민트', lilac: '라일락', sky: '하늘', peach: '복숭아', night: '밤' }],
  ];
  const BGS = Object.assign({}, ...BG_GROUPS.map(([, g]) => g));
  const STICKER_SETS = [
    ['여행', ['✈️', '🧳', '🗺️', '🧭', '📍', '🎫', '🚆', '🚌', '🚗', '⛴️', '🏨', '📷', '🏖️', '⛰️', '🏯', '⛩️', '🗼', '🎡']],
    ['음식', ['🍜', '🍣', '🍙', '🍔', '🍕', '🥟', '🍤', '🍰', '🍦', '🍩', '☕', '🧋', '🍺', '🍷']],
    ['날씨·자연', ['☀️', '⛅', '🌧️', '❄️', '🌈', '🌙', '⭐', '🌸', '🌷', '🍁', '🌿', '🌊', '🌻', '🍀']],
    ['기분', ['😆', '🥰', '😋', '😴', '🥳', '😎', '🤩', '😭', '👍', '✌️', '❤️', '💜', '💛', '✨', '🎉', '🎈']],
  ];
  // 글자 배경색
  const TEXT_BGS = { none: ['없음', ''], white: ['흰색', '#ffffff'], cream: ['크림', '#fbf6ea'], lilac: ['라벤더', '#e6e0f5'],
    mint: ['민트', '#d9f0e6'], pink: ['분홍', '#fbe0e6'], yellow: ['노랑', '#fff3b0'], dark: ['검정', '#2d2a26'] };
  const textPad = (size) => ({ x: size * 0.3, y: size * 0.15, r: size * 0.3 });
  const DECO_SHAPES = ['stamp', 'ticket', 'label', 'memo', 'film'];
  const TAPES = ['#f7c8d0', '#c9e4f6', '#fff1a1', '#cdeccf', '#e2cbff'];
  const COLORS = ['#2d2a26', '#6E5FAE', '#c2410c', '#1f5378', '#0f766e', '#ffffff'];
  const MAX_HISTORY = 40;

  const S = { tripId: null, loadedFor: null, loading: false, error: null, pages: [], allPages: [], books: [], bookId: null, els: new Map() };
  const shared = () => window.PlannerShared;
  const root = () => $('#scrapbook');
  const trip = () => state.trips.find((t) => t.id === S.tripId);
  const uuid = () => crypto.randomUUID();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const round = (v) => Math.round(v * 10) / 10;

  // ---------- 사진 주소 ----------
  function photoIndex() {
    const m = new Map();
    for (const p of state.places) {
      if (p.trip_id !== S.tripId) continue;
      for (const ph of p.photos) m.set(ph.id, { ...ph, placeName: p.name, date: visitKey(p) });
    }
    return m;
  }
  function srcOf(e, photos, small = false) {
    if (e.photoId) { const ph = photos.get(e.photoId); return ph ? (small ? ph.thumb : ph.url) : ''; }
    if (e.assetPath) return urlOf(e.assetPath);
    return '';
  }
  const toEl = (r) => ({
    id: r.id, type: r.type, x: r.x, y: r.y, width: r.width, height: r.height, rotation: r.rotation, zIndex: r.z_index,
    photoId: r.photo_id, assetPath: r.asset_path, content: r.content || {},
  });

  // ---------- 불러오기 ----------
  async function load(force = false) {
    const id = state.filter === 'all' ? null : state.filter;
    S.tripId = id;
    if (!id) { render(); return; }
    if (!force && S.loadedFor === id) { render(); return; }
    S.loading = true;
    S.error = null;
    render();
    try {
      const { pq } = shared();
      const [pages, els, books] = await Promise.all([
        pq(sb.from('scrapbook_pages').select('*').eq('trip_id', id).order('page_order').order('id')),
        pq(sb.from('scrapbook_elements').select('*').eq('trip_id', id)),
        state.v009 ? pq(sb.from('scrapbooks').select('*').eq('trip_id', id).order('sort_order').order('id')) : [],
      ]);
      if (S.tripId !== id) return;
      await signPaths(els.map((e) => e.asset_path));
      S.allPages = pages;
      S.books = books;
      pickBook();
      S.els = new Map(pages.map((p) => [p.id, []]));
      for (const e of els) S.els.get(e.page_id)?.push(toEl(e));
      S.loadedFor = id;
    } catch (err) {
      S.error = err;
      S.loadedFor = null;
    } finally {
      S.loading = false;
    }
    render();
  }

  // ---------- 여러 스크랩북 (DB 설정 009) ----------
  const bookKey = () => `sbBook:${S.tripId}`;
  /** 고른 스크랩북의 페이지만 S.pages 로 (009 전이면 전부) */
  function pickBook(id) {
    if (!S.books.length) { S.bookId = null; S.pages = S.allPages; return; }
    let want = id ?? Number(localStorage.getItem(bookKey()));
    if (!S.books.some((b) => b.id === want)) want = S.books[0].id;
    S.bookId = want;
    try { localStorage.setItem(bookKey(), String(want)); } catch { /* 저장 불가 */ }
    S.pages = S.allPages.filter((p) => p.scrapbook_id === want);
  }
  const book = () => S.books.find((b) => b.id === S.bookId);
  const bookField = () => (S.bookId ? { scrapbook_id: S.bookId } : {});
  function booksHtml() {
    if (!state.v009) return '';
    return `<div class="sb-books" role="tablist" aria-label="스크랩북">
      ${S.books.map((b) => `<button type="button" role="tab" class="sb-book ${b.id === S.bookId ? 'on' : ''}" aria-selected="${b.id === S.bookId}" data-book="${b.id}">📔 ${esc(b.title)}
        <small>${S.allPages.filter((p) => p.scrapbook_id === b.id).length}</small></button>`).join('')}
      <button type="button" class="sb-book add" data-act="new-book" aria-label="새 스크랩북">＋ 새 스크랩북</button>
      ${book() ? '<button type="button" class="icon-btn ghost" data-act="book-menu" aria-label="스크랩북 이름 바꾸기·삭제">⋯</button>' : ''}
    </div>`;
  }
  function openBookForm(b) {
    const body = openSheet(`<h2>${b ? '스크랩북 이름 바꾸기' : '새 스크랩북'}</h2>
      <form id="bkForm" autocomplete="off">
        <label class="field"><span>이름 <small>40자</small></span><input name="title" maxlength="40" required value="${esc(b?.title || '')}" placeholder="예: 맛집 앨범, 둘째 날, 가족 사진"></label>
        <button class="primary" type="submit">${b ? '저장' : '만들기'}</button>
      </form>`);
    const f = $('#bkForm', body);
    f.title.focus();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const title = f.title.value.trim();
      if (!title) return;
      const btn = $('button[type=submit]', f);
      btn.disabled = true;
      const { pq } = shared();
      try {
        if (b) {
          const rows = await pq(sb.from('scrapbooks').update({ title }).eq('id', b.id).select('id'));
          if (!rows.length) throw new Error('권한이 없거나 이미 지워진 스크랩북이에요');
        } else {
          const order = S.books.reduce((m, x) => Math.max(m, x.sort_order), 0) + 1;
          const [nb] = await pq(sb.from('scrapbooks').insert({ trip_id: S.tripId, title, sort_order: order }).select());
          try { localStorage.setItem(bookKey(), String(nb.id)); } catch { /* 저장 불가 */ }
        }
        closeSheet();
        await load(true);
        toast(b ? '이름을 바꿨어요' : `'${title}' 스크랩북을 만들었어요`);
      } catch (err) { toast(err.message === 'NEEDS_MIGRATION' ? 'DB 설정(migrate-009)이 먼저 필요해요' : err.message); btn.disabled = false; }
    };
  }
  function bookMenu() {
    const b = book();
    if (!b) return;
    const body = openSheet(`<h2>📔 ${esc(b.title)}</h2>
      <div class="choice-list">
        <button class="choice" data-bm="rename"><span class="ic">✏️</span><span><b>이름 바꾸기</b></span></button>
        <button class="choice" data-bm="del"><span class="ic">🗑</span><span><b style="color:var(--danger)">스크랩북 삭제</b><small>안의 페이지 ${S.pages.length}장도 함께 지워져요. 원래 사진 기록은 그대로예요</small></span></button>
      </div>`);
    body.onclick = async (ev) => {
      const a = ev.target.closest('[data-bm]')?.dataset.bm;
      if (a === 'rename') openBookForm(b);
      if (a !== 'del') return;
      if (!confirm(`'${b.title}' 스크랩북과 페이지 ${S.pages.length}장을 삭제할까요? 되돌릴 수 없어요.`)) return;
      const ids = new Set(S.pages.map((p) => p.id));
      const assets = S.pages.flatMap((p) => (S.els.get(p.id) || []).map((e) => e.assetPath)).filter(Boolean);
      try {
        const rows = await shared().pq(sb.from('scrapbooks').delete().eq('id', b.id).select('id'));
        if (!rows.length) throw new Error('권한이 없거나 이미 지워진 스크랩북이에요');
        const used = new Set([...S.els].filter(([id]) => !ids.has(id)).flatMap(([, els]) => els.map((e) => e.assetPath)));
        await removeFiles(assets.filter((a2) => !used.has(a2))).catch(() => {});
        ids.forEach((id) => localStorage.removeItem(`sbDraft:${id}`));
        localStorage.removeItem(bookKey());
        closeSheet();
        await load(true);
        toast('스크랩북을 삭제했어요');
      } catch (err) { toast(err.message); }
    };
  }

  // ---------- 요소 그리기 (목록 미리보기·편집기 공통) ----------
  function elInner(e, photos, small) {
    const c = e.content || {};
    if (e.type === 'IMAGE') {
      const src = srcOf(e, photos, small);
      const alt = c.alt || photos.get(e.photoId)?.placeName || '여행 사진';
      const cr = validCrop(c.crop);
      const imgStyle = cr ? ` style="position:absolute;max-width:none;object-fit:fill;width:${100 / cr.w}%;height:${100 / cr.h}%;left:${(-cr.x / cr.w) * 100}%;top:${(-cr.y / cr.h) * 100}%"` : '';
      return `<div class="sb-photo frame-${esc(c.frame || 'none')}"><div class="sb-crop">
        ${src ? `<img src="${esc(src)}" alt="${esc(alt)}" draggable="false" loading="lazy"${imgStyle}>` : '<div class="sb-missing">사진이 지워졌어요</div>'}</div>
        ${c.frame === 'polaroid' && c.caption ? `<div class="sb-caption">${esc(c.caption)}</div>` : ''}</div>`;
    }
    if (e.type === 'TEXT') {
      const size = Number(c.size) || 56;
      const bg = TEXT_BGS[c.bg]?.[1];
      const pad = textPad(size);
      const bgStyle = bg ? `background:${bg};padding:${pad.y}px ${pad.x}px;border-radius:${pad.r}px;` : '';
      return `<div class="sb-text font-${esc(c.font || 'hand')}" style="${bgStyle}font-size:${size}px;color:${esc(c.color || '#2d2a26')};text-align:${esc(c.align || 'left')}">${esc(c.text || '')}</div>`;
    }
    if (c.shape === 'tape') return `<div class="sb-tape" style="background:${esc(c.color || TAPES[0])}"></div>`;
    // 날짜 도장·티켓·장소 라벨은 이미지 내보내기와 같은 그림 함수로 그려요 (hydrate)
    if (DECO_SHAPES.includes(c.shape)) return `<canvas class="sb-deco" data-el="${esc(e.id)}" role="img" aria-label="${esc(c.text || '장식')}"></canvas>`;
    return `<div class="sb-sticker" style="font-size:${Math.round(Math.min(e.width, e.height) * 0.86)}px" role="img" aria-label="스티커">${esc(c.sticker || '⭐')}</div>`;
  }
  // 자르기 영역 (0~1 비율). 이상한 값이면 자르지 않은 것으로
  function validCrop(cr) {
    if (!cr || typeof cr !== 'object') return null;
    const v = [cr.x, cr.y, cr.w, cr.h].map(Number);
    if (v.some((x) => !Number.isFinite(x)) || v[2] <= 0.01 || v[3] <= 0.01 || v[0] < 0 || v[1] < 0 || v[0] + v[2] > 1.0001 || v[1] + v[3] > 1.0001) return null;
    return { x: v[0], y: v[1], w: v[2], h: v[3] };
  }
  const elStyle = (e) => `left:${e.x}px;top:${e.y}px;width:${e.width}px;height:${e.height}px;transform:rotate(${e.rotation}deg);z-index:${e.zIndex}`;
  function canvasHtml(page, els, photos, small) {
    return `<div class="sb-canvas bg-${esc(page.background || 'paper')}">${[...els].sort((a, b) => a.zIndex - b.zIndex)
      .map((e) => `<div class="sb-el type-${e.type.toLowerCase()}${e.content?.locked ? ' locked' : ''}" style="${elStyle(e)}">${elInner(e, photos, small)}</div>`).join('')}</div>`;
  }
  /** 화면에 넣은 뒤: 못 불러온 사진은 안내로 바꾸고, 장식(도장·티켓·라벨)을 그림 */
  function hydrate(container, els) {
    if (!container) return;
    const byId = new Map(els.map((e) => [e.id, e]));
    container.querySelectorAll('.sb-photo img').forEach((img) => {
      const fail = () => {
        const d = document.createElement('div');
        d.className = 'sb-missing';
        d.textContent = '사진을 불러오지 못했어요';
        img.replaceWith(d);
      };
      if (img.complete && img.src && img.naturalWidth === 0) fail(); else img.addEventListener('error', fail, { once: true });
    });
    container.querySelectorAll('canvas.sb-deco').forEach((cv) => { const e = byId.get(cv.dataset.el); if (e) paintDeco(cv, e); });
  }
  function paintDeco(cv, e) {
    ensureFonts();
    const k = 2;
    cv.width = Math.max(1, Math.round(e.width * k));
    cv.height = Math.max(1, Math.round(e.height * k));
    const ctx = cv.getContext('2d');
    ctx.scale(k, k);
    ctx.translate(e.width / 2, e.height / 2);
    drawStickerEl(ctx, e, e.width, e.height);
  }

  // ---------- 페이지 목록 ----------
  function render() {
    const r = root();
    if (!r || state.view !== 'scrap') return;
    if (!S.tripId) { r.innerHTML = shared().pickTripHtml('스크랩북을'); return; }
    const t = trip();
    if (!t) { r.innerHTML = '<div class="empty">여행을 찾을 수 없어요</div>'; return; }
    const head = `<div class="section-head"><h2>📔 ${esc(t.title)}</h2>
      <div class="sb-head-btns">${S.pages.length ? '<button class="chip-btn" data-act="story" aria-label="스토리로 보기">▶ 스토리</button>' : ''}<button class="chip-btn" data-act="new-page">＋ 새 페이지</button></div></div>
      ${typeof roBanner === 'function' ? roBanner(t) : ''}
      ${S.loading || S.error ? '' : booksHtml()}`;
    if (S.loading) { r.innerHTML = `${head}<div class="empty"><div class="spinner"></div>불러오는 중…</div>`; return; }
    if (S.error) {
      r.innerHTML = head + (S.error.code === 'NEEDS_MIGRATION'
        ? '<div class="notice warn"><b>스크랩북을 쓰려면 DB 설정이 하나 더 필요해요.</b><br>Supabase SQL Editor에서 <code>supabase/migrate-004-planner-scrapbook.sql</code>을 실행해 주세요.</div>'
        : `<div class="notice error">${esc(S.error.message)}<br><button class="btn" data-act="reload" style="margin-top:8px">다시 불러오기</button></div>`);
      return;
    }
    const photos = photoIndex();
    r.innerHTML = head + (S.pages.length ? `<div class="sb-pages">${S.pages.map((p, i) => `
      <div class="sb-page-card" data-page="${p.id}">
        <button class="sb-thumb" data-view aria-label="${esc(p.title || `${i + 1}쪽`)} 보기">${canvasHtml(p, S.els.get(p.id) || [], photos, true)}</button>
        <div class="sb-page-meta"><b>${esc(p.title || `${i + 1}쪽`)}</b><small class="muted">${p.page_date ? shared().short(p.page_date) : ''} · ${(S.els.get(p.id) || []).length}개 요소</small></div>
        <div class="sb-page-tools">
          <button class="btn-sub sb-edit-btn" data-open>✏️ 편집</button>
          <button class="icon-btn" data-pmenu aria-label="페이지 메뉴" aria-haspopup="dialog">⋯</button>
        </div>
      </div>`).join('')}</div>`
      : `<div class="empty"><div class="big">📔</div>${book() ? `'${esc(book().title)}'에 아직 페이지가 없어요` : '아직 스크랩북 페이지가 없어요'}<br><small>여행 사진으로 하루 한 장씩 꾸며 보세요</small></div>`);
    hydrate(r, [...S.els.values()].flat());
    fitThumbs();
  }
  // 미리보기 크기에 맞춰 1000×1400 캔버스를 줄임
  function fitThumbs() {
    const grid = $('.sb-pages', root());
    const t = grid && $('.sb-thumb', grid);
    if (t?.clientWidth) grid.style.setProperty('--s', String(t.clientWidth / CW));
  }
  window.addEventListener('resize', () => { if (state.view === 'scrap') fitThumbs(); });

  function bind() {
    root().addEventListener('click', async (e) => {
      const pick = e.target.closest('[data-pick-trip]');
      if (pick) { state.filter = Number(pick.dataset.pickTrip); refresh(true); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'new-page') return openNewPage();
      if (act === 'new-book') return openBookForm(null);
      if (act === 'book-menu') return bookMenu();
      const bk = e.target.closest('[data-book]');
      if (bk) { pickBook(Number(bk.dataset.book)); render(); return; }
      if (act === 'story') return openStory(0);
      if (act === 'reload') return load(true);
      if (act === 'new-trip') return openTripForm();
      const card = e.target.closest('[data-page]');
      if (!card) return;
      const page = S.pages.find((p) => p.id === Number(card.dataset.page));
      if (e.target.closest('[data-open]')) return openEditor(page); // 편집 모드
      if (e.target.closest('[data-view]')) return openStory(S.pages.indexOf(page)); // 감상 모드
      if (e.target.closest('[data-pmenu]')) return pageMenu(page);
    });
  }

  // 페이지 ⋯ 메뉴: 복제 · 이미지 · 순서 · 삭제
  function pageMenu(page) {
    const i = S.pages.indexOf(page);
    const body = openSheet(`<h2>${esc(page.title || `${i + 1}쪽`)}</h2>
      <div class="choice-list">
        <button class="choice" data-pm="dup"><span class="ic">⧉</span><span><b>페이지 복제</b><small>바로 뒤에 똑같은 페이지를 만들어요</small></span></button>
        <button class="choice" data-pm="exp"><span class="ic">📤</span><span><b>이미지로 저장·공유</b><small>페이지(5:7) 또는 인스타 스토리(9:16)</small></span></button>
        <div class="btn-row" style="margin:0">
          <button class="btn" data-pm="up" ${i === 0 ? 'disabled' : ''} style="flex:1">◀ 앞으로</button>
          <button class="btn" data-pm="down" ${i === S.pages.length - 1 ? 'disabled' : ''} style="flex:1">뒤로 ▶</button>
        </div>
        <button class="choice" data-pm="del"><span class="ic">🗑</span><span><b style="color:var(--danger)">페이지 삭제</b><small>원래 사진 기록은 그대로예요</small></span></button>
      </div>`);
    body.onclick = (ev) => {
      const a = ev.target.closest('[data-pm]:not([disabled])')?.dataset.pm;
      if (!a) return;
      if (a !== 'exp') closeSheet();
      if (a === 'dup') duplicatePage(page);
      else if (a === 'exp') exportPage(page, S.els.get(page.id) || [], page.background);
      else if (a === 'up') movePage(page, -1);
      else if (a === 'down') movePage(page, 1);
      else if (a === 'del') deletePage(page);
    };
  }

  async function duplicatePage(page) {
    const { pq } = shared();
    try {
      const order = S.pages.reduce((m, p) => Math.max(m, p.page_order), 0) + 1;
      const [np] = await pq(sb.from('scrapbook_pages').insert({
        trip_id: S.tripId, title: `${page.title || ''} 복사`.trim().slice(0, 40), page_date: page.page_date,
        template: page.template, background: page.background, page_order: order, ...(page.scrapbook_id ? { scrapbook_id: page.scrapbook_id } : {}),
      }).select());
      const els = (S.els.get(page.id) || []).map((e) => ({ ...toRow(e), id: uuid() }));
      if (els.length) await pq(sb.rpc('save_scrapbook_page', { p_page_id: np.id, p_expected_revision: np.revision, p_elements: els }));
      const ids = S.pages.map((x) => x.id);
      ids.splice(ids.indexOf(page.id) + 1, 0, np.id);
      await pq(sb.rpc('reorder_scrapbook_pages', { p_trip_id: S.tripId, p_ids: ids }));
      await load(true);
      toast('페이지를 복제했어요');
    } catch (err) { toast(err.message === 'NEEDS_MIGRATION' ? 'DB 설정이 먼저 필요해요' : err.message); }
  }

  async function movePage(page, dir) {
    const i = S.pages.indexOf(page);
    const j = i + dir;
    if (j < 0 || j >= S.pages.length) return;
    const list = [...S.pages];
    [list[i], list[j]] = [list[j], list[i]];
    try {
      await shared().pq(sb.rpc('reorder_scrapbook_pages', { p_trip_id: S.tripId, p_ids: list.map((p) => p.id) }));
      await load(true);
    } catch (err) { toast(err.message); }
  }

  async function deletePage(page) {
    if (!confirm(`'${page.title || '이 페이지'}'를 삭제할까요? 되돌릴 수 없어요. (원래 사진 기록은 그대로예요)`)) return;
    const assets = (S.els.get(page.id) || []).map((e) => e.assetPath).filter(Boolean);
    try {
      const rows = await shared().pq(sb.from('scrapbook_pages').delete().eq('id', page.id).select('id'));
      if (!rows.length) throw new Error('권한이 없거나 이미 지워진 페이지예요');
      // 다른 페이지가 같은 사진을 쓰지 않으면 저장소에서도 지움 (남이 올린 사진은 권한상 실패할 수 있음)
      const used = new Set([...S.els].filter(([id]) => id !== page.id).flatMap(([, els]) => els.map((e) => e.assetPath)));
      await removeFiles(assets.filter((a) => !used.has(a))).catch(() => {});
      localStorage.removeItem(`sbDraft:${page.id}`);
      await load(true);
      toast('페이지를 삭제했어요');
    } catch (err) { toast(err.message); }
  }

  // ---------- 새 페이지 (템플릿) ----------
  function openNewPage() {
    const days = shared().tripDays(trip());
    const body = openSheet(`<h2>새 스크랩북 페이지</h2>${book() ? `<p class="muted" style="margin-top:-6px">📔 ${esc(book().title)}에 넣어요</p>` : ''}
      <form id="npForm">
        <div class="choice-list sb-tpls">${Object.entries(TEMPLATES).filter(([k]) => state.v009 || !NEW_TEMPLATES.includes(k)).map(([k, [ic2, name, desc]], i) => `<label class="choice">
          <input type="radio" name="template" value="${k}" ${i === 1 ? 'checked' : ''}><span class="ic">${ic2}</span><span><b>${name}</b><small>${desc}</small></span></label>`).join('')}</div>
        <div class="grid2" style="margin-top:12px">
          <label class="field"><span>날짜</span><select name="date"><option value="">없음</option>${days.map((d, i) => `<option value="${d}" ${i === 0 ? 'selected' : ''}>${i + 1}일차 ${shared().short(d)}</option>`).join('')}</select></label>
          <label class="field"><span>배경</span><select name="bg">${BG_GROUPS.map(([g, list]) => `<optgroup label="${g}">${Object.entries(list).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</optgroup>`).join('')}</select></label>
        </div>
        <label class="field"><span>제목 (선택)</span><input name="title" maxlength="40" placeholder="비우면 날짜로 정해요"></label>
        <button class="primary" type="submit">만들기</button>
      </form>`);
    const f = $('#npForm', body);
    let bgTouched = false;
    f.bg.addEventListener('change', () => { bgTouched = true; });
    f.addEventListener('change', (e) => { // 템플릿에 어울리는 배경으로 (직접 고른 배경은 그대로)
      if (e.target.name === 'template' && !bgTouched) f.bg.value = TEMPLATE_BG[e.target.value] || 'paper';
    });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', f);
      btn.disabled = true;
      const date = f.date.value || null;
      const tpl = f.template.value;
      const dayNo = date ? days.indexOf(date) + 1 : 0;
      const title = f.title.value.trim() || (date ? `${dayNo}일차 · ${shared().short(date)}` : `${S.pages.length + 1}쪽`);
      try {
        const { pq } = shared();
        const order = S.pages.reduce((m, p) => Math.max(m, p.page_order), 0) + 1;
        const [page] = await pq(sb.from('scrapbook_pages').insert({
          trip_id: S.tripId, title, page_date: date, template: tpl, background: f.bg.value, page_order: order, ...bookField(),
        }).select());
        const els = await templateElements(tpl, date, title);
        if (els.length) {
          const [r] = await pq(sb.rpc('save_scrapbook_page', { p_page_id: page.id, p_expected_revision: page.revision, p_elements: els.map(toRow) }));
          page.revision = r.revision;
        }
        closeSheet();
        await load(true);
        openEditor(S.pages.find((p) => p.id === page.id) || page);
      } catch (err) {
        toast(/check constraint|입력한 내용/.test(err.message) ? `새 배경·템플릿을 쓰려면 DB 설정(${NEW_TEMPLATES.includes(tpl) ? 'migrate-009' : 'migrate-006'})이 먼저 필요해요` : err.message);
        btn.disabled = false;
      }
    };
  }

  async function aspectOf(src) {
    if (!src) return 0.75;
    try {
      const img = new Image();
      img.src = src;
      // 화면이 백그라운드이면 decode 가 늦어질 수 있어서 3초 넘으면 기본 비율로
      await Promise.race([img.decode(), sleep(3000).then(() => { throw new Error('timeout'); })]);
      return img.naturalHeight / img.naturalWidth || 0.75;
    } catch { return 0.75; }
  }

  // ---------- 날짜·장소 스티커 (기록의 날짜·장소 이름을 글자로 복사해 두므로, 나중에 기록을 고쳐도 그대로예요) ----------
  function dateStamp(date, x, y, d = 200) {
    const [yy, mm, dd] = date.split('-');
    return { type: 'STICKER', x, y, width: d, height: d, content: { shape: 'stamp', text: `${mm}.${dd}`, sub: yy, color: '#c2410c' } };
  }
  function placeLabel(name, x, y, h = 70) {
    const text = `📍 ${String(name || '').slice(0, 20)}`;
    const w = Math.round(Math.min(700, Math.max(160, h * 0.62 * [...text].length + h)));
    return { type: 'STICKER', x: clamp(x, 0, CW - w), y, width: w, height: h, content: { shape: 'label', text, color: '#6E5FAE' } };
  }
  function tripTicket(t, x, y) {
    return { type: 'STICKER', x, y, width: 440, height: 170, content: { shape: 'ticket', text: t?.title || '여행', sub: fmtRange(t?.start_date, t?.end_date), color: '#fde2c8' } };
  }
  // 손글씨 메모지 (글은 사본)
  function memoNote(text, x, y, w = 420, h = 320) {
    return { type: 'STICKER', x, y, width: w, height: h, content: { shape: 'memo', text: String(text || '').slice(0, 160), color: '#fff3b0' } };
  }
  // 이 여행의 기록 (날짜가 있으면 그날 먼저)
  function dayRecords(date) {
    const list = state.places.filter((x) => x.trip_id === S.tripId);
    return date ? [...list.filter((x) => visitKey(x) === date), ...list.filter((x) => visitKey(x) !== date)] : list;
  }
  /** 기록 글을 스크랩북에 넣을 글로 (사본 — 기록을 고쳐도 스크랩북 글은 그대로) */
  function recordText(p, max = 300) {
    const head = p.title || p.name;
    const body = [p.comment, p.memo].filter(Boolean).join('\n');
    return (body ? `${head}\n${body}` : head).slice(0, max);
  }

  async function templateElements(tpl, date, title) {
    const photos = photoIndex();
    const list = [...photos.values()].filter((p) => !date || p.date === date);
    const pick = list.length ? list : [...photos.values()];
    const out = [];
    let z = 1;
    const text = (t, x, y, w, h, size, extra = {}) => out.push({ id: uuid(), type: 'TEXT', x, y, width: w, height: h, rotation: 0, zIndex: z++, content: { text: t, size, font: 'hand', color: '#2d2a26', ...extra } });
    const image = async (ph, x, y, w, rot, frame, maxH) => {
      const a = await aspectOf(ph.thumb);
      let h = w * a;
      if (maxH && h > maxH) h = maxH; // 너무 긴 사진은 잘라 보이게
      out.push({ id: uuid(), type: 'IMAGE', x, y, width: w, height: Math.round(h), rotation: rot, zIndex: z++, photoId: ph.id, content: { frame, alt: ph.placeName, caption: frame === 'polaroid' ? ph.placeName : '' } });
    };
    if (tpl === 'BLANK') return out;
    if (tpl === 'DAY') {
      text(title, 60, 50, 880, 110, 84);
      const ps = pick.slice(0, 3);
      const slots = [[60, 210, 520, -3], [540, 470, 400, 4], [80, 820, 460, 2]];
      for (let i = 0; i < ps.length; i++) await image(ps[i], ...slots[i], 'tape', 420);
      const names = [...new Set(ps.map((p) => p.placeName))].join(' → ');
      if (names) text(names, 560, 1080, 380, 200, 40);
      out.push({ id: uuid(), type: 'STICKER', x: 820, y: 60, width: 120, height: 120, rotation: 10, zIndex: z++, content: { sticker: '✈️' } });
    } else if (tpl === 'POLAROID') {
      const ps = pick.slice(0, 3);
      const slots = [[70, 120, 460, -6], [470, 420, 460, 5], [120, 820, 440, -2]];
      for (let i = 0; i < ps.length; i++) await image(ps[i], ...slots[i], 'polaroid', 520);
      text(title, 560, 140, 380, 120, 64);
      out.push({ id: uuid(), type: 'STICKER', x: 760, y: 1180, width: 140, height: 140, rotation: -8, zIndex: z++, content: { sticker: '📷' } });
    } else if (tpl === 'DIARY') {
      text(title, 100, 40, 620, 100, 72);
      if (date) out.push({ id: uuid(), type: 'STICKER', ...dateStamp(date, 770, 30), rotation: -12, zIndex: z++ });
      const ps = pick.slice(0, 2);
      const slots = [[100, 190, 470, -3], [560, 330, 360, 4]];
      for (let i = 0; i < ps.length; i++) await image(ps[i], ...slots[i], 'tape', 380);
      [...new Set(ps.map((x) => x.placeName))].slice(0, 2).forEach((nm, i) => {
        out.push({ id: uuid(), type: 'STICKER', ...placeLabel(nm, 100 + i * 330, 620), rotation: i ? 3 : -2, zIndex: z++ });
      });
      text('오늘의 이야기를 적어 보세요 ✏️', 100, 724, 820, 600, 43, { color: '#3a352f' });
    } else if (tpl === 'COLLAGE') {
      const ps = pick.slice(0, 5);
      const cells = [[30, 30, 940, 560], [30, 610, 460, 400], [510, 610, 460, 400], [30, 1030, 460, 340], [510, 1030, 460, 340]];
      ps.forEach((ph, i) => out.push({ id: uuid(), type: 'IMAGE', x: cells[i][0], y: cells[i][1], width: cells[i][2], height: cells[i][3], rotation: 0, zIndex: z++, photoId: ph.id, content: { frame: 'none', alt: ph.placeName } }));
      out.push({ id: uuid(), type: 'STICKER', ...placeLabel(title, 50, 500), rotation: -2, zIndex: z++ });
      if (date) out.push({ id: uuid(), type: 'STICKER', ...dateStamp(date, 780, 420, 170), rotation: 10, zIndex: z++ });
    } else if (tpl === 'FILM') {
      text(title, 60, 40, 880, 90, 60, { color: '#ffffff', align: 'center' });
      out.push({ id: uuid(), type: 'STICKER', x: 190, y: 150, width: 620, height: 1200, rotation: 0, zIndex: z++, content: { shape: 'film' } });
      pick.slice(0, 3).forEach((ph, i) => out.push({ id: uuid(), type: 'IMAGE', x: 255, y: 205 + i * 380, width: 490, height: 330, rotation: 0, zIndex: z++, photoId: ph.id, content: { frame: 'none', alt: ph.placeName } }));
    } else if (tpl === 'TICKET') {
      out.push({ id: uuid(), type: 'STICKER', ...tripTicket(trip(), 80, 60), width: 840, height: 300, rotation: -2, zIndex: z++ });
      if (pick[0]) await image(pick[0], 110, 420, 780, 2, 'tape', 560);
      if (date) out.push({ id: uuid(), type: 'STICKER', ...dateStamp(date, 740, 900, 190), rotation: -12, zIndex: z++ });
      const rec = dayRecords(date)[0];
      if (rec) out.push({ id: uuid(), type: 'STICKER', ...memoNote(recordText(rec, 120), 110, 1030), rotation: -3, zIndex: z++ });
      else if (pick[0]) out.push({ id: uuid(), type: 'STICKER', ...placeLabel(pick[0].placeName, 110, 1060), rotation: -2, zIndex: z++ });
    } else if (tpl === 'MINIMAL') {
      if (pick[0]) await image(pick[0], 120, 140, 760, 0, 'none', 860);
      text(title, 120, 1080, 760, 90, 56, { font: 'basic', align: 'center' });
      text([date ? fmtDate(date) : '', pick[0]?.placeName].filter(Boolean).join(' · ') || ' ', 120, 1180, 760, 60, 32, { font: 'basic', align: 'center', color: '#8a8597' });
    } else if (tpl === 'GRID') {
      text(title, 60, 40, 880, 100, 72);
      const ps = pick.slice(0, 4);
      const cells = [[60, 170], [520, 170], [60, 720], [520, 720]];
      ps.forEach((ph, i) => out.push({ id: uuid(), type: 'IMAGE', x: cells[i][0], y: cells[i][1], width: 420, height: 500, rotation: 0, zIndex: z++, photoId: ph.id, content: { frame: 'none', alt: ph.placeName } }));
    }
    if (!pick.length && tpl !== 'BLANK') text('사진 탭에서 사진을 넣어 보세요 📷', 120, 600, 760, 120, 48, { align: 'center', color: '#9586A8' });
    return out;
  }

  const toRow = (e) => ({
    id: e.id, type: e.type, x: round(e.x), y: round(e.y), width: round(e.width), height: round(e.height),
    rotation: round(clamp(((e.rotation + 540) % 360) - 180, -180, 180)), zIndex: e.zIndex,
    photoId: e.photoId || null, assetPath: e.assetPath || null, content: e.content || {},
  });

  // =====================================================================
  // 이미지로 저장·공유
  // 저장된 요소 목록을 화면과 같은 모양으로 고화질 캔버스(2000×2800)에 그려요. (planner.css 의 스크랩북 모양과 같은 값)
  // =====================================================================
  const EXPORT_SCALE = 2;
  let FONTS = {};
  function ensureFonts() {
    if (!FONTS.basic) FONTS = { hand: cssText('sb-text font-hand'), basic: cssText('sb-text font-basic'), caption: cssText('sb-caption') };
  }
  const HAND_FONT = '"Gaegu", "Gowun Dodum", cursive';
  const BASIC_FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
  // 편집 화면과 같은 글꼴·자간을 쓰려고 실제 CSS 값을 읽어 옴 (테마마다 다를 수 있음)
  function cssText(className) {
    const el = document.createElement('div');
    el.className = className;
    el.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0';
    el.textContent = '가';
    $('#sbEditor')?.appendChild(el) || document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const out = { family: cs.fontFamily, weight: cs.fontWeight, spacing: cs.letterSpacing };
    el.remove();
    return out;
  }
  function applyFont(ctx, st, size, fallback) {
    ctx.font = `${st?.weight || 400} ${size}px ${st?.family || fallback}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = st?.spacing && st.spacing !== 'normal' ? st.spacing : '0px';
  }
  const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

  async function loadBitmap(url) {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error('사진을 불러오지 못했어요');
    const blob = await r.blob();
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { return createImageBitmap(blob); }
  }

  const BG_FILL = {
    paper: '#f6efe1', grid: '#fbfaf4', kraft: '#d7b98e', mint: '#e3f5ef', lilac: '#efe6fb', linen: '#f3eee4',
    white: '#ffffff', cream: '#fbf6ea', sky: '#e4f1fb', peach: '#fde8de', night: '#2b2840',
    lined: '#fffdf6', dots: '#fff7f2', stripe: '#ffffff', check: '#ffffff',
  };
  function drawBackground(ctx, bg, W = CW, H = CH) {
    ctx.fillStyle = BG_FILL[bg] || BG_FILL.paper;
    ctx.fillRect(0, 0, W, H);
    // planner.css 의 .sb-canvas.bg-○○ 와 같은 무늬
    if (bg === 'lined') {
      ctx.fillStyle = '#dbe6f0';
      for (let y = 54; y < H; y += 56) ctx.fillRect(0, y, W, 2);
      ctx.fillStyle = 'rgba(220, 80, 80, .35)';
      ctx.fillRect(89, 0, 2, H);
    } else if (bg === 'dots') {
      ctx.fillStyle = 'rgba(110, 95, 174, .18)';
      for (let y = 20; y < H; y += 40) for (let x = 20; x < W; x += 40) { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); }
    } else if (bg === 'stripe') {
      ctx.fillStyle = '#f3f0fb';
      for (let x = 0; x < W; x += 80) ctx.fillRect(x, 0, 40, H);
    } else if (bg === 'check') {
      ctx.fillStyle = 'rgba(240, 170, 180, .28)';
      for (let x = 0; x < W; x += 60) ctx.fillRect(x, 0, 30, H);
      for (let y = 0; y < H; y += 60) ctx.fillRect(0, y, W, 30);
    } else if (bg === 'linen') {
      ctx.fillStyle = 'rgba(120, 100, 70, .06)';
      for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
      for (let x = 0; x < W; x += 4) ctx.fillRect(x, 0, 1, H);
    }
    if (bg === 'paper' || bg === 'kraft') {
      const [step, r, color] = bg === 'paper' ? [22, 1.3, 'rgba(120, 90, 40, .07)'] : [18, 1.75, 'rgba(90, 60, 20, .12)'];
      ctx.fillStyle = color;
      for (let y = step / 2; y < H; y += step) {
        for (let x = step / 2; x < W; x += step) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
      }
    } else if (bg === 'grid') {
      ctx.fillStyle = '#d9e8f2';
      for (let y = 0; y < H; y += 50) ctx.fillRect(0, y, W, 1.5);
      for (let x = 0; x < W; x += 50) ctx.fillRect(x, 0, 1.5, H);
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else {
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
  }

  // object-fit: cover 처럼 잘라서 채우기
  function drawCover(ctx, img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const sw = w / s;
    const sh = h / s;
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  }

  // 자른 영역이 있으면 그 부분만, 없으면 cover 처럼
  function drawPhoto(ctx, img, x, y, w, h, crop) {
    const cr = validCrop(crop);
    if (!cr) { drawCover(ctx, img, x, y, w, h); return; }
    ctx.drawImage(img, cr.x * img.width, cr.y * img.height, cr.w * img.width, cr.h * img.height, x, y, w, h);
  }

  function drawMissing(ctx, x, y, w, h) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = '#f7f7f7'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#eeeeee'; ctx.lineWidth = 12;
    for (let k = -h; k < w; k += 34) { ctx.beginPath(); ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + h, y); ctx.stroke(); }
    ctx.fillStyle = '#888'; ctx.font = `32px ${BASIC_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('사진이 지워졌어요', x + w / 2, y + h / 2);
    ctx.restore();
  }

  function shadowed(ctx, blur, offY, alpha, fn) {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${alpha})`;
    ctx.shadowBlur = blur * EXPORT_SCALE; // 그림자 번짐은 확대 비율을 따르지 않아서 직접 곱함
    ctx.shadowOffsetY = offY * EXPORT_SCALE;
    fn();
    ctx.restore();
  }

  function drawImageEl(ctx, e, img, w, h) {
    const c = e.content || {};
    const x = -w / 2;
    const y = -h / 2;
    const frame = c.frame || 'none';
    if (frame === 'polaroid') {
      shadowed(ctx, 18, 6, 0.18, () => { ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h); });
      const pad = w * 0.04; // CSS padding 의 % 는 모두 너비 기준
      const iw = w - pad * 2;
      const ih = h - pad - w * 0.16;
      if (img) drawPhoto(ctx, img, x + pad, y + pad, iw, Math.max(1, ih), c.crop); else drawMissing(ctx, x + pad, y + pad, iw, Math.max(1, ih));
      if (c.caption) {
        ctx.save();
        ctx.beginPath(); ctx.rect(x + w * 0.04, y + h * 0.86, w * 0.92, h * 0.12); ctx.clip();
        ctx.fillStyle = '#3a352f'; applyFont(ctx, FONTS.caption, 40, HAND_FONT); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(c.caption, 0, y + h * 0.92);
        ctx.restore();
      }
      return;
    }
    if (frame === 'tape') {
      shadowed(ctx, 12, 4, 0.15, () => { ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h); });
    }
    ctx.save();
    if (frame === 'round') { roundRect(ctx, x, y, w, h, 40); ctx.clip(); }
    if (img) drawPhoto(ctx, img, x, y, w, h, c.crop); else drawMissing(ctx, x, y, w, h);
    ctx.restore();
    if (frame === 'tape') {
      const tw = w * 0.3;
      const th = Math.max(h * 0.11, 26);
      const strip = (cx, cy, color) => {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate((-28 * Math.PI) / 180);
        ctx.fillStyle = color; ctx.fillRect(-tw / 2, -th / 2, tw, th); ctx.restore();
      };
      strip(x - w * 0.06 + tw / 2, y - h * 0.05 + th / 2, 'rgba(247, 200, 208, .8)');
      strip(x + w + w * 0.06 - tw / 2, y + h + h * 0.05 - th / 2, 'rgba(201, 228, 246, .85)');
    }
  }

  // 글자를 상자 너비에 맞춰 줄바꿈 (단어 단위, 너무 길면 글자 단위)
  function wrapText(ctx, text, maxW) {
    const lines = [];
    for (const para of String(text || '').split('\n')) {
      let line = '';
      for (const tok of para.match(/\S+\s*|\s+/g) || ['']) {
        if (ctx.measureText(line + tok).width <= maxW) { line += tok; continue; }
        if (line) { lines.push(line.trimEnd()); line = ''; }
        const t = tok.trimStart();
        if (ctx.measureText(t).width <= maxW) { line = t; continue; }
        for (const ch of t) { // 한 단어가 상자보다 길면 글자 단위로
          if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ''; }
          line += ch;
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }

  function drawTextEl(ctx, e, w, h) {
    const c = e.content || {};
    const size = Number(c.size) || 56;
    const hand = (c.font || 'hand') !== 'basic';
    const bg = TEXT_BGS[c.bg]?.[1];
    const pad = bg ? textPad(size) : { x: 0, y: 0, r: 0 };
    if (bg) { ctx.fillStyle = bg; roundRect(ctx, -w / 2, -h / 2, w, h, pad.r); ctx.fill(); }
    applyFont(ctx, hand ? FONTS.hand : FONTS.basic, size, hand ? HAND_FONT : BASIC_FONT);
    ctx.fillStyle = c.color || '#2d2a26';
    ctx.textBaseline = 'middle';
    const align = c.align || 'left';
    ctx.textAlign = align;
    const ax = align === 'center' ? 0 : align === 'right' ? w / 2 - pad.x : -w / 2 + pad.x;
    const lh = size * 1.3;
    wrapText(ctx, c.text, w - pad.x * 2).forEach((ln, i) => ctx.fillText(ln, ax, -h / 2 + pad.y + lh * i + lh / 2));
  }

  // 장식 글자 (굵은 고딕, 칸에 맞게 줄임)
  function decoText(ctx, text, x, y, size, maxW, weight = 800) {
    let s = size;
    const fam = FONTS.basic?.family || BASIC_FONT;
    ctx.font = `${weight} ${s}px ${fam}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    while (s > 8 && ctx.measureText(text).width > maxW) { s -= 1; ctx.font = `${weight} ${s}px ${fam}`; }
    ctx.fillText(text, x, y);
  }
  function drawDeco(ctx, c, w, h) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (c.shape === 'stamp') { // 날짜 도장
      const d = Math.min(w, h);
      const col = c.color || '#c2410c';
      ctx.save();
      ctx.globalAlpha = 0.88;
      ctx.strokeStyle = col;
      ctx.lineWidth = d * 0.02;
      ctx.beginPath(); ctx.arc(0, 0, d / 2 - d * 0.02, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = d * 0.01;
      ctx.setLineDash([d * 0.03, d * 0.02]);
      ctx.beginPath(); ctx.arc(0, 0, d / 2 - d * 0.08, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      if (c.sub) decoText(ctx, c.sub, 0, -d * 0.17, d * 0.11, d * 0.6, 700);
      decoText(ctx, c.text || '', 0, d * 0.03, d * 0.2, d * 0.72);
      decoText(ctx, '★  ★  ★', 0, d * 0.22, d * 0.07, d * 0.5, 700);
      ctx.restore();
    } else if (c.shape === 'ticket') { // 여행 티켓
      const r = h * 0.16;
      const x0 = -w / 2;
      const y0 = -h / 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x0 + w, y0); ctx.lineTo(x0 + w, -r);
      ctx.arc(x0 + w, 0, r, -Math.PI / 2, Math.PI / 2, true);
      ctx.lineTo(x0 + w, y0 + h); ctx.lineTo(x0, y0 + h); ctx.lineTo(x0, r);
      ctx.arc(x0, 0, r, Math.PI / 2, -Math.PI / 2, true);
      ctx.closePath();
      ctx.fillStyle = c.color || '#fde2c8';
      ctx.fill();
      ctx.strokeStyle = 'rgba(45, 42, 38, .12)'; ctx.lineWidth = 2; ctx.stroke();
      const sx = x0 + w * 0.74;
      ctx.save(); ctx.strokeStyle = 'rgba(45, 42, 38, .35)'; ctx.lineWidth = 2; ctx.setLineDash([8, 7]);
      ctx.beginPath(); ctx.moveTo(sx, y0 + h * 0.14); ctx.lineTo(sx, y0 + h * 0.86); ctx.stroke(); ctx.restore();
      ctx.fillStyle = '#2d2a26';
      decoText(ctx, c.text || '', x0 + w * 0.37, -h * 0.1, h * 0.26, w * 0.62);
      ctx.globalAlpha = 0.7;
      if (c.sub) decoText(ctx, c.sub, x0 + w * 0.37, h * 0.22, h * 0.14, w * 0.62, 600);
      ctx.globalAlpha = 1;
      ctx.font = `${Math.round(h * 0.34)}px ${EMOJI_FONT}`;
      ctx.fillStyle = '#000';
      ctx.fillText('✈️', x0 + w * 0.87, h * 0.02);
    } else if (c.shape === 'memo') { // 손글씨 메모지 (테이프로 붙인 노란 종이)
      const x0 = -w / 2;
      const y0 = -h / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
      ctx.fillStyle = c.color || '#fff3b0';
      ctx.fillRect(x0 + 4, y0 + h * 0.06, w - 8, h * 0.94 - 4);
      ctx.restore();
      ctx.save(); ctx.globalAlpha = 0.75; ctx.fillStyle = '#e2cbff';
      ctx.translate(0, y0 + h * 0.06); ctx.rotate(-0.05); ctx.fillRect(-w * 0.18, -h * 0.05, w * 0.36, h * 0.1); ctx.restore();
      ctx.fillStyle = '#3a352f';
      const size = Math.max(14, Math.min(h * 0.13, w * 0.09));
      ctx.font = `${size}px ${FONTS.hand?.family || HAND_FONT}`;
      ctx.textAlign = 'left';
      const lines = wrapText(ctx, c.text || '', w - w * 0.16);
      const lh = size * 1.3;
      const maxLines = Math.max(1, Math.floor((h * 0.8) / lh));
      lines.slice(0, maxLines).forEach((ln, i) => ctx.fillText(i === maxLines - 1 && lines.length > maxLines ? `${ln.slice(0, -1)}…` : ln, x0 + w * 0.08, y0 + h * 0.2 + lh * i + lh / 2));
      ctx.textAlign = 'center';
    } else if (c.shape === 'film') { // 필름 띠 (구멍 뚫린 검은 띠)
      const x0 = -w / 2;
      const y0 = -h / 2;
      ctx.fillStyle = '#1d1b20';
      roundRect(ctx, x0, y0, w, h, Math.min(w, h) * 0.02); ctx.fill();
      const side = Math.min(w * 0.1, 60);
      const hole = side * 0.45;
      ctx.fillStyle = '#f4efe6';
      for (let y = y0 + hole; y < y0 + h - hole * 1.5; y += hole * 2) {
        roundRect(ctx, x0 + (side - hole) / 2, y, hole, hole * 1.2, hole * 0.2); ctx.fill();
        roundRect(ctx, x0 + w - side + (side - hole) / 2, y, hole, hole * 1.2, hole * 0.2); ctx.fill();
      }
      ctx.fillStyle = '#2b2830';
      ctx.fillRect(x0 + side, y0 + side * 0.4, w - side * 2, h - side * 0.8);
    } else if (c.shape === 'label') { // 장소 라벨
      const col = c.color || '#6E5FAE';
      roundRect(ctx, -w / 2 + h * 0.04, -h / 2 + h * 0.04, w - h * 0.08, h - h * 0.08, h / 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = h * 0.06; ctx.stroke();
      ctx.fillStyle = col;
      decoText(ctx, c.text || '', 0, h * 0.02, h * 0.42, w - h * 0.7);
    }
  }

  function drawStickerEl(ctx, e, w, h) {
    const c = e.content || {};
    if (DECO_SHAPES.includes(c.shape)) { drawDeco(ctx, c, w, h); return; }
    if (c.shape === 'tape') {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = c.color || TAPES[0];
      ctx.beginPath();
      ctx.moveTo(-w / 2 + w * 0.02, -h / 2); ctx.lineTo(-w / 2 + w * 0.98, -h / 2 + h * 0.04);
      ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, -h / 2 + h * 0.96); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    const fs = Math.round(Math.min(w, h) * 0.86);
    ctx.font = `${fs}px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000'; // 앞 요소의 글자색(예: 흰색)이 이모지 색에 섞이지 않게
    ctx.globalAlpha = 1;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.sticker || '⭐', 0, fs * 0.04);
  }

  /** 페이지 → 캔버스 (2000×2800). 불러오지 못한 사진 수도 돌려줌 */
  async function renderPageCanvas(bg, els) {
    try { await Promise.all([document.fonts.load(`700 56px ${HAND_FONT}`), document.fonts.load(`40px ${HAND_FONT}`)]); } catch { /* 기본 글꼴로 */ }
    FONTS = { hand: cssText('sb-text font-hand'), basic: cssText('sb-text font-basic'), caption: cssText('sb-caption') };
    const photos = photoIndex();
    const list = [...els].sort((a, b) => a.zIndex - b.zIndex);
    await signPaths(list.map((e) => e.assetPath).filter(Boolean));
    let failed = 0;
    const bitmaps = await Promise.all(list.map(async (e) => {
      if (e.type !== 'IMAGE') return null;
      const src = srcOf(e, photos, false);
      if (!src) return null;
      try { return await loadBitmap(src); } catch { failed++; return null; }
    }));
    const canvas = document.createElement('canvas');
    canvas.width = CW * EXPORT_SCALE;
    canvas.height = CH * EXPORT_SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
    drawBackground(ctx, bg);
    list.forEach((e, i) => {
      ctx.save();
      ctx.translate(e.x + e.width / 2, e.y + e.height / 2);
      ctx.rotate(((e.rotation || 0) * Math.PI) / 180);
      if (e.type === 'IMAGE') drawImageEl(ctx, e, bitmaps[i], e.width, e.height);
      else if (e.type === 'TEXT') drawTextEl(ctx, e, e.width, e.height);
      else drawStickerEl(ctx, e, e.width, e.height);
      ctx.restore();
    });
    bitmaps.forEach((b) => b?.close?.());
    return { canvas, failed };
  }
  const toJpeg = (canvas) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('이미지를 만들지 못했어요'))), 'image/jpeg', 0.92));

  // ---------- 인스타그램 스토리 크기 (1080×1920, 9:16) ----------
  const STORY_W = 1080;
  const STORY_H = 1920;
  const pageSubtitle = (page) => `${page.title || ''}${page.page_date ? ` · ${fmtDate(page.page_date)}` : ''}`;
  function fitFillText(ctx, text, x, y, maxW, size, st, fallback) {
    let s = size;
    applyFont(ctx, st, s, fallback);
    while (s > 20 && ctx.measureText(text).width > maxW) { s -= 2; applyFont(ctx, st, s, fallback); }
    ctx.fillText(text, x, y);
  }
  /** 배경 무늬 위에 페이지를 카드처럼 올리고, 위에 여행 제목·날짜를 넣음 */
  function composeStory(pageCanvas, bg, page) {
    const c = document.createElement('canvas');
    c.width = STORY_W;
    c.height = STORY_H;
    const ctx = c.getContext('2d');
    const k = STORY_W / CW;
    ctx.save();
    ctx.scale(k, k);
    drawBackground(ctx, bg, CW, STORY_H / k);
    ctx.restore();
    ctx.fillStyle = 'rgba(47, 42, 74, .07)';
    ctx.fillRect(0, 0, STORY_W, STORY_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2d2a26';
    fitFillText(ctx, trip()?.title || '여행 스크랩북', STORY_W / 2, 150, 960, 72, FONTS.hand, HAND_FONT);
    ctx.fillStyle = 'rgba(45, 42, 38, .62)';
    fitFillText(ctx, pageSubtitle(page), STORY_W / 2, 222, 960, 34, FONTS.basic, BASIC_FONT);
    const pw = 940;
    const ph = Math.round((pw * CH) / CW);
    const x = (STORY_W - pw) / 2;
    const y = 290;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, .22)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = '#fff';
    roundRect(ctx, x, y, pw, ph, 28);
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, x, y, pw, ph, 28);
    ctx.clip();
    ctx.drawImage(pageCanvas, x, y, pw, ph);
    ctx.restore();
    ctx.fillStyle = 'rgba(45, 42, 38, .45)';
    applyFont(ctx, FONTS.basic, 30, BASIC_FONT);
    ctx.fillText('모아로그', STORY_W / 2, y + ph + (STORY_H - y - ph) / 2);
    return c;
  }

  const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 40) || '스크랩북';

  /**
   * 이미지를 만든 뒤 미리보기 창에서 공유/저장 (휴대폰은 버튼을 눌러야 공유 창이 열려요)
   * mode: 'page' = 페이지 그대로(5:7, 2000×2800) / 'story' = 인스타그램 스토리(9:16, 1080×1920)
   */
  async function exportPage(page, els, bg, mode = 'page', onClose) {
    toast('이미지 만드는 중…');
    let base;
    try { base = await renderPageCanvas(bg, els); } catch (err) { toast(err.message || '이미지를 만들지 못했어요'); onClose?.(); return; }
    $('#toast').classList.remove('show');
    const made = {};
    async function make(m) {
      if (made[m]) return made[m];
      const cv = m === 'story' ? composeStory(base.canvas, bg, page) : base.canvas;
      const blob = await toJpeg(cv);
      const name = `${safeName(trip()?.title)}_${safeName(page.title)}${m === 'story' ? '_스토리' : ''}.jpg`;
      made[m] = { blob, name, url: URL.createObjectURL(blob), size: `${cv.width}×${cv.height}`, file: new File([blob], name, { type: 'image/jpeg' }) };
      if (cv !== base.canvas) cv.width = cv.height = 0;
      return made[m];
    }
    let cur;
    try { cur = await make(mode); } catch (err) { toast(err.message); onClose?.(); return; }
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [cur.file] }));
    const body = openSheet(`<h2>이미지로 저장·공유</h2>
      <div class="seg mini-seg exp-mode" role="radiogroup" aria-label="이미지 크기">
        <button type="button" data-mode="page" role="radio">페이지 (5:7)</button>
        <button type="button" data-mode="story" role="radio">인스타 스토리 (9:16)</button>
      </div>
      ${base.failed ? `<div class="notice warn">사진 ${base.failed}장을 불러오지 못해 빈 칸으로 그렸어요. 인터넷 연결을 확인하고 다시 해 보세요.</div>` : ''}
      <img class="exp-preview" alt="${esc(page.title || '스크랩북 페이지')} 이미지 미리보기">
      <small class="hint" id="expInfo"></small>
      <div class="exp-actions">
        ${canShare ? '<button type="button" class="btn-main" data-x="share">📤 공유하기</button>' : ''}
        <button type="button" class="${canShare ? 'btn-sub' : 'btn-main'}" data-x="save">⬇️ 이미지 저장</button>
      </div>
      <small class="hint" id="expTip"></small>`, () => {
      base.canvas.width = base.canvas.height = 0; // 폰 메모리 바로 반환
      setTimeout(() => Object.values(made).forEach((m) => URL.revokeObjectURL(m.url)), 60e3);
      onClose?.();
    });
    function show() {
      body.querySelectorAll('[data-mode]').forEach((b) => {
        const on = b.dataset.mode === mode;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      });
      const img = $('.exp-preview', body);
      img.src = cur.url;
      img.classList.toggle('story', mode === 'story');
      $('#expInfo', body).textContent = `${cur.size} 고화질 JPG · ${fmtSize(cur.blob.size)}`;
      $('#expTip', body).textContent = mode === 'story'
        ? '인스타그램 앱 → 스토리 → 사진에서 이 이미지를 고르면 화면에 꽉 차게 올라가요.'
        : (canShare ? '아이폰은 공유 창에서 ‘이미지 저장’을 누르면 사진 앱에 들어가요.' : '');
    }
    show();
    body.onclick = async (ev) => {
      const m = ev.target.closest('[data-mode]')?.dataset.mode;
      if (m && m !== mode) {
        mode = m;
        try { cur = await make(m); } catch (err) { toast(err.message); return; }
        if (body.isConnected) show();
        return;
      }
      const x = ev.target.closest('[data-x]')?.dataset.x;
      if (x === 'share') {
        try { await navigator.share({ files: [cur.file], title: page.title || '여행 스크랩북' }); } catch (err) {
          if (err?.name !== 'AbortError') toast('공유하지 못했어요. ‘이미지 저장’을 눌러 주세요');
        }
      } else if (x === 'save') {
        const a = document.createElement('a');
        a.href = cur.url;
        a.download = cur.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast('이미지를 저장했어요');
      }
    };
  }

  // =====================================================================
  // 스토리 보기 (인스타그램 스토리처럼 한 장씩)
  // - 위쪽 진행 막대, 오른쪽 탭 = 다음 / 왼쪽 탭 = 이전, 5초마다 자동으로 넘김
  // - 꾹 누르고 있으면 멈춤, 아래로 쓸어내리면 닫기, 📤 로 지금 페이지를 스토리 크기로 공유
  // - 키보드: ← → 넘기기, 스페이스 멈춤, Esc 닫기
  // =====================================================================
  const STORY_MS = 5000;
  let ST = null;

  function openStory(start = 0) {
    if (!S.pages.length) return;
    const box = $('#sbStory');
    ST = { i: start, elapsed: 0, last: performance.now(), paused: false, raf: 0, down: null, holdTimer: 0, held: false, sheet: false };
    box.innerHTML = `
      <div class="st-bars" aria-hidden="true">${S.pages.map(() => '<i><b></b></i>').join('')}</div>
      <div class="st-head">
        <div class="st-title"><b></b><small aria-live="polite"></small></div>
        <button type="button" class="st-btn" data-st="edit" aria-label="이 페이지 편집">✏️</button>
        <button type="button" class="st-btn" data-st="pause" aria-label="멈춤">❚❚</button>
        <button type="button" class="st-btn" data-st="share" aria-label="이 페이지를 스토리 이미지로 공유">📤</button>
        <button type="button" class="st-btn" data-st="close" aria-label="닫기">✕</button>
      </div>
      <div class="st-stage">
        <div class="st-wrap"></div>
        <button type="button" class="st-zone prev" data-st="prev" aria-label="이전 페이지"></button>
        <button type="button" class="st-zone next" data-st="next" aria-label="다음 페이지"></button>
        <div class="st-paused" aria-hidden="true">❚❚ 멈춤</div>
      </div>`;
    box.classList.remove('hidden');
    document.body.classList.add('sb-open');
    showStory(start);
    ST.raf = requestAnimationFrame(storyTick);
    box.focus({ preventScroll: true });
  }

  function showStory(i) {
    ST.i = i;
    ST.elapsed = 0;
    const box = $('#sbStory');
    const p = S.pages[i];
    const els = S.els.get(p.id) || [];
    $('.st-title b', box).textContent = trip()?.title || '';
    $('.st-title small', box).textContent = `${pageSubtitle(p) || `${i + 1}쪽`} · ${i + 1}/${S.pages.length}`;
    $('.st-wrap', box).innerHTML = canvasHtml(p, els, photoIndex(), false).replace(/ loading="lazy"/g, '');
    hydrate($('.st-wrap', box), els);
    fitStory();
    box.querySelectorAll('.st-bars b').forEach((b, k) => { b.style.width = k < i ? '100%' : '0%'; });
    // 다음 페이지 사진을 미리 받아 두기
    const nx = S.pages[i + 1];
    if (nx) {
      const ph = photoIndex();
      (S.els.get(nx.id) || []).forEach((e) => { const src = srcOf(e, ph, false); if (src) { const im = new Image(); im.src = src; } });
    }
  }

  function fitStory() {
    const box = $('#sbStory');
    const stage = $('.st-stage', box);
    const wrap = $('.st-wrap', box);
    if (!stage || !wrap) return;
    const s = Math.min((stage.clientWidth - 16) / CW, (stage.clientHeight - 16) / CH);
    wrap.style.width = `${CW * s}px`;
    wrap.style.height = `${CH * s}px`;
    const cv = $('.sb-canvas', wrap);
    if (cv) cv.style.transform = `scale(${s})`;
  }

  function setPaused(v) {
    ST.paused = v;
    const box = $('#sbStory');
    box.classList.toggle('paused', v);
    const b = $('[data-st=pause]', box);
    if (b) { b.textContent = v ? '▶' : '❚❚'; b.setAttribute('aria-label', v ? '이어서 보기' : '멈춤'); }
  }

  function storyTick(now) {
    if (!ST) return;
    const dt = now - ST.last;
    ST.last = now;
    if (!ST.paused && !ST.held && !ST.sheet && !document.hidden) {
      ST.elapsed += dt;
      if (ST.elapsed >= STORY_MS) { storyNext(); if (!ST) return; }
    }
    const bar = $(`#sbStory .st-bars i:nth-child(${ST.i + 1}) b`);
    if (bar) bar.style.width = `${Math.min(100, (ST.elapsed / STORY_MS) * 100)}%`;
    ST.raf = requestAnimationFrame(storyTick);
  }
  function storyNext() { if (ST.i < S.pages.length - 1) showStory(ST.i + 1); else closeStory(); }
  function storyPrev() { if (ST.i > 0) showStory(ST.i - 1); else ST.elapsed = 0; }

  function closeStory() {
    if (!ST) return;
    cancelAnimationFrame(ST.raf);
    clearTimeout(ST.holdTimer);
    ST = null;
    const box = $('#sbStory');
    box.classList.add('hidden');
    box.classList.remove('paused');
    box.innerHTML = '';
    if (!ED) document.body.classList.remove('sb-open');
  }

  function storyShare() {
    const p = S.pages[ST.i];
    ST.sheet = true;
    exportPage(p, S.els.get(p.id) || [], p.background, 'story', () => { if (ST) { ST.sheet = false; ST.last = performance.now(); } });
  }

  function bindStory() {
    const box = $('#sbStory');
    // 탭으로 넘기기 · 꾹 눌러 멈춤 · 아래로 쓸어 닫기 (마우스·터치 공통)
    box.addEventListener('pointerdown', (ev) => {
      if (!ST || !ev.target.closest('.st-stage')) return;
      ST.down = { x: ev.clientX, y: ev.clientY };
      ST.held = false;
      clearTimeout(ST.holdTimer);
      ST.holdTimer = setTimeout(() => { if (ST?.down) { ST.held = true; box.classList.add('paused'); } }, 220);
    });
    box.addEventListener('pointerup', (ev) => {
      if (!ST || !ST.down) return;
      clearTimeout(ST.holdTimer);
      const dx = ev.clientX - ST.down.x;
      const dy = ev.clientY - ST.down.y;
      const wasHeld = ST.held;
      ST.down = null;
      ST.held = false;
      if (!ST.paused) box.classList.remove('paused');
      if (dy > 100 && Math.abs(dy) > Math.abs(dx)) { closeStory(); return; } // 아래로 쓸어내림
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) storyNext(); else storyPrev(); return; } // 옆으로 밀기
      if (wasHeld) return; // 꾹 눌렀다 떼면 이어서 보기만
      const r = $('.st-stage', box).getBoundingClientRect();
      if (ev.clientX - r.left < r.width / 3) storyPrev(); else storyNext();
    });
    box.addEventListener('pointercancel', () => { if (ST) { clearTimeout(ST.holdTimer); ST.down = null; ST.held = false; if (!ST.paused) box.classList.remove('paused'); } });
    box.addEventListener('click', (ev) => {
      if (!ST) return;
      const a = ev.target.closest('[data-st]')?.dataset.st;
      if (a === 'close') closeStory();
      else if (a === 'edit') { const p = S.pages[ST.i]; closeStory(); openEditor(p); } // 감상 → 편집
      else if (a === 'share') storyShare();
      else if (a === 'pause') setPaused(!ST.paused);
      // 넘기기 영역은 키보드(Enter)로 누를 때만 (손가락·마우스 탭은 위 pointerup 에서 처리)
      else if (a === 'next' && ev.detail === 0) storyNext();
      else if (a === 'prev' && ev.detail === 0) storyPrev();
    });
    box.addEventListener('keydown', (ev) => {
      if (!ST || ST.sheet) return;
      if (ev.key === 'ArrowRight') { ev.preventDefault(); storyNext(); } else if (ev.key === 'ArrowLeft') { ev.preventDefault(); storyPrev(); } else if (ev.key === 'Escape') closeStory();
      else if (ev.key === ' ' && !ev.target.closest('button')) { ev.preventDefault(); setPaused(!ST.paused); }
    });
    window.addEventListener('resize', () => { if (ST) fitStory(); });
  }

  // =====================================================================
  // 편집기
  // =====================================================================
  let ED = null; // { page, els, sel, hist, dirty, saving, scale, uploaded:Set, title, bg }

  function openEditor(page) {
    const els = (S.els.get(page.id) || []).map((e) => structuredClone(e));
    ED = {
      page, els, sel: null, hist: [], future: [], dirty: false, saving: false, scale: 1, uploaded: new Set(), title: page.title, bg: page.background,
      ver: 0, saveTimer: 0, lastSaved: null, saveError: false, offline: false, conflict: false, conflictMsg: '',
    };
    // 저장 못 한 편집이 이 기기에 남아 있으면 복구 제안
    try {
      const local = JSON.parse(localStorage.getItem(`sbDraft:${page.id}`) || 'null');
      if (local && local.rev === page.revision && JSON.stringify(local.els) !== JSON.stringify(els.map(toRow))
        && confirm('이 페이지에 저장하지 못한 편집이 있어요. 이어서 고칠까요?\n(취소하면 저장된 상태로 열어요)')) {
        ED.els = local.els;
        ED.title = local.title ?? ED.title;
        ED.bg = local.bg ?? ED.bg;
        ED.dirty = true;
        ED.ver = 1;
      } else if (local) localStorage.removeItem(`sbDraft:${page.id}`);
    } catch { /* 무시 */ }
    const box = $('#sbEditor');
    box.innerHTML = `
      <div class="sb-top">
        <button class="icon-btn" data-ed="close" aria-label="목록으로">←</button>
        <div class="sb-titlebox">
          <input class="sb-title" maxlength="40" value="${esc(ED.title)}" aria-label="페이지 제목">
          <button type="button" class="sb-status" data-ed="retry" aria-live="polite"></button>
        </div>
        <button class="icon-btn" data-ed="undo" aria-label="되돌리기">↶</button>
        <button class="icon-btn" data-ed="redo" aria-label="다시 실행">↷</button>
        <button class="icon-btn" data-ed="export" aria-label="이미지로 저장·공유">📤</button>
        <button class="sb-save" data-ed="done">완료</button>
      </div>
      <div class="sb-stage"><div class="sb-wrap"></div></div>
      <div class="sb-tools"></div>`;
    box.classList.remove('hidden');
    document.body.classList.add('sb-open');
    layout();
    drawCanvas();
    drawTools();
    status();
    if (ED.dirty) scheduleSave(600); // 이어서 고친 편집은 바로 저장
  }

  function layout() {
    const stage = $('#sbEditor .sb-stage');
    const w = Math.min(stage.clientWidth - 24, 720);
    ED.scale = w / CW;
    const wrap = $('#sbEditor .sb-wrap');
    wrap.style.width = `${CW * ED.scale}px`;
    wrap.style.height = `${CH * ED.scale}px`;
    $('#sbEditor').style.setProperty('--inv', String(1 / ED.scale));
  }

  function drawCanvas() {
    const wrap = $('#sbEditor .sb-wrap');
    wrap.innerHTML = canvasHtml({ background: ED.bg }, ED.els, photoIndex(), false);
    const canvas = $('.sb-canvas', wrap);
    canvas.style.transform = `scale(${ED.scale})`;
    canvas.querySelectorAll('.sb-el').forEach((node, i) => {
      const e = [...ED.els].sort((a, b) => a.zIndex - b.zIndex)[i];
      node.dataset.id = e.id;
      if (e.content?.locked) return; // 배경 사진: 배경 창에서 바꾸거나 빼요
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', `${{ IMAGE: '사진', TEXT: '글자', STICKER: '스티커' }[e.type]}${e.type === 'TEXT' ? `: ${e.content.text || ''}` : ''}`);
      if (e.id === ED.sel) node.classList.add('sel');
    });
    hydrate(canvas, ED.els);
    // 선택 상자·손잡이는 다른 요소에 가려지지 않게 맨 위 층에 따로 그림
    const e = selEl();
    if (e) {
      canvas.insertAdjacentHTML('beforeend', `<div class="sb-selbox" style="${selStyle(e)}">
        <span class="h h-rot" data-h="rot" aria-hidden="true"></span><span class="h h-size" data-h="size" aria-hidden="true"></span></div>`);
    }
  }
  const selStyle = (e) => `${elStyle(e)};z-index:100000`;

  // 자동 저장 상태: 편집 중… → 저장 중… → 저장됨 ✓ (실패하면 눌러서 다시 시도)
  function status() {
    const s = $('#sbEditor .sb-status');
    if (!s) return;
    const t = ED.lastSaved ? ` ${pad2(ED.lastSaved.getHours())}:${pad2(ED.lastSaved.getMinutes())}` : '';
    s.textContent = ED.conflict ? '⚠ 충돌 · 눌러서 확인'
      : ED.saving ? '저장 중…'
        : ED.saveError ? '⚠ 저장 실패 · 다시 시도'
          : ED.offline ? '오프라인 · 이 기기에 임시 보관'
            : ED.dirty ? '편집 중…' : `저장됨 ✓${t}`;
    s.className = `sb-status ${ED.saveError || ED.conflict ? 'error' : ED.dirty || ED.offline ? 'dirty' : ''}`;
    s.disabled = !(ED.saveError || ED.conflict);
    $('#sbEditor [data-ed=undo]').disabled = !ED.hist.length;
    $('#sbEditor [data-ed=redo]').disabled = !ED.future.length;
  }
  function scheduleSave(ms = 1200) {
    if (!ED || ED.conflict) return;
    clearTimeout(ED.saveTimer);
    ED.saveTimer = setTimeout(() => save({ auto: true }), ms);
  }

  const selEl = () => ED.els.find((e) => e.id === ED.sel);

  function drawTools() {
    const t = $('#sbEditor .sb-tools');
    const e = selEl();
    // 넣기 막대(사진·글자·스티커·배경)는 언제나 보이고, 요소를 고르면 그 위에 세부 도구가 나와요
    const addBar = `<div class="sb-add">
        <button data-add="photo"><span>📷</span>사진</button>
        <button data-add="text"><span>🔤</span>글자</button>
        <button data-add="sticker"><span>🌟</span>스티커</button>
        <button data-add="bg"><span>🎨</span>배경</button></div>`;
    if (!e) { t.innerHTML = addBar; return; }
    t.innerHTML = `<div class="sb-ctx">
      ${e.type === 'IMAGE' ? '<button data-tool="crop">✂️ 자르기</button>' : ''}
      ${e.type === 'TEXT' ? '<button data-tool="edit">✏️ 글·글꼴·배경</button>' : ''}
      ${e.type === 'STICKER' && DECO_SHAPES.includes(e.content.shape) && e.content.shape !== 'film' ? '<button data-tool="deco">✏️ 글 수정</button>' : ''}
      ${e.type === 'IMAGE' ? '<button data-tool="frame">🖼️ 액자</button>' : ''}
      <button data-tool="rotL" aria-label="왼쪽으로 돌리기">⟲ 15°</button>
      <button data-tool="rotR" aria-label="오른쪽으로 돌리기">⟳ 15°</button>
      <button data-tool="up">⬆ 앞으로</button>
      <button data-tool="down">⬇ 뒤로</button>
      <button data-tool="dup">⧉ 복제</button>
      <button data-tool="del" class="danger">🗑 삭제</button>
      <button data-tool="done">✓ 선택 해제</button></div>${addBar}`;
  }

  // 바꾸기 전에 기록 (되돌리기용) / 바꾼 뒤 표시
  function snapshot() {
    ED.hist.push(JSON.stringify({ els: ED.els, bg: ED.bg }));
    if (ED.hist.length > MAX_HISTORY) ED.hist.shift();
    ED.future = []; // 새로 바꾸면 '다시 실행'할 것은 사라짐
  }
  function changedNow(redraw = true) {
    ED.dirty = true;
    ED.ver++;
    ED.saveError = false;
    scheduleSave();
    try {
      localStorage.setItem(`sbDraft:${ED.page.id}`, JSON.stringify({ rev: ED.page.revision, els: ED.els.map(toRow), title: ED.title, bg: ED.bg, at: Date.now() }));
    } catch { /* 저장 공간 부족 등 */ }
    if (redraw) { drawCanvas(); drawTools(); }
    status();
  }
  function restore(json) {
    const st = JSON.parse(json);
    ED.els = st.els;
    ED.bg = st.bg;
    if (!selEl()) ED.sel = null;
    changedNow();
  }
  function undo() {
    const last = ED.hist.pop();
    if (!last) return;
    ED.future.push(JSON.stringify({ els: ED.els, bg: ED.bg }));
    restore(last);
  }
  function redo() {
    const next = ED.future.pop();
    if (!next) return;
    ED.hist.push(JSON.stringify({ els: ED.els, bg: ED.bg }));
    restore(next);
  }
  function select(id) {
    ED.sel = id;
    drawCanvas();
    drawTools();
    if (id) $(`#sbEditor .sb-el[data-id="${id}"]`)?.focus({ preventScroll: true });
  }
  const topZ = () => ED.els.reduce((m, e) => Math.max(m, e.zIndex), 0) + 1;
  // 화면 가운데(보이는 영역)에 새 요소 놓기
  function centerSpot(w, h) {
    const stage = $('#sbEditor .sb-stage');
    const wrap = $('#sbEditor .sb-wrap');
    const visibleMid = (stage.scrollTop + stage.clientHeight / 2 - wrap.offsetTop) / ED.scale;
    const n = ED.els.length % 5;
    return { x: clamp(CW / 2 - w / 2 + n * 20, 0, CW - w), y: clamp(visibleMid - h / 2 + n * 20, 0, CH - h) };
  }
  function addEl(el) {
    snapshot();
    ED.els.push({ zIndex: topZ(), rotation: 0, content: {}, ...el, id: uuid() });
    ED.sel = ED.els.at(-1).id;
    changedNow();
  }

  // ---------- 끌기·크기·회전 (마우스·터치 공통 Pointer Events) ----------
  let drag = null;
  let pinch = null;
  const pts = new Map(); // 화면에 닿아 있는 손가락(포인터)
  const wrapEl = () => $('#sbEditor .sb-wrap');

  // 크기·회전을 바꾼 요소를 화면에 바로 반영 (손을 뗄 때 전체를 다시 그림)
  function refreshNode(e) {
    const node = $(`#sbEditor .sb-el[data-id="${e.id}"]`);
    if (!node) return;
    node.style.cssText = elStyle(e);
    const box = $('#sbEditor .sb-selbox');
    if (box) box.style.cssText = selStyle(e);
    if (e.type === 'TEXT' || (e.type === 'STICKER' && !e.content.shape)) {
      node.innerHTML = elInner(e, photoIndex(), false);
    }
  }
  // 가운데를 기준으로 k배 (사진·스티커는 비율 유지, 글자는 글자 크기도 함께)
  function scaleFrom(e, st, k) {
    const w = clamp(st.width * k, 40, 2000);
    const h = e.type === 'TEXT' ? clamp(st.height * k, 30, 2400) : clamp(w * (st.height / st.width), 30, 2400);
    e.x = st.x + st.width / 2 - w / 2;
    e.y = st.y + st.height / 2 - h / 2;
    e.width = w;
    e.height = h;
    if (e.type === 'TEXT') e.content = { ...e.content, size: clamp(Math.round((st.content?.size || 56) * k), 16, 240) };
  }
  const normDeg = (d) => ((d + 540) % 360) - 180;
  function startPinch() {
    const e = selEl();
    if (!e) return;
    const [a, b] = [...pts.values()];
    drag = null;
    snapshot();
    pinch = { e, d0: Math.hypot(b.x - a.x, b.y - a.y) || 1, a0: Math.atan2(b.y - a.y, b.x - a.x), start: structuredClone(e) };
  }

  function onDown(ev) {
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pts.size === 2 && ED.sel) { ev.preventDefault(); startPinch(); return; } // 두 손가락 = 확대·축소·회전
    if (pts.size > 1) return;
    const handle = ev.target.closest('[data-h]');
    const node = handle ? $(`#sbEditor .sb-el[data-id="${ED.sel}"]`) : ev.target.closest('.sb-el');
    if (!node) { if (ED.sel && ev.target.closest('.sb-canvas')) select(null); return; }
    wrapEl().style.touchAction = 'none'; // 두 번째 손가락이 화면 스크롤이 되지 않게
    const e = ED.els.find((x) => x.id === node.dataset.id);
    if (!e) return;
    ev.preventDefault();
    if (ED.sel !== e.id) { select(e.id); }
    const target = $(`#sbEditor .sb-el[data-id="${e.id}"]`);
    const h = ev.target.closest('[data-h]')?.dataset.h || 'move';
    const r = target.getBoundingClientRect();
    drag = { e, node: target, mode: h, sx: ev.clientX, sy: ev.clientY, start: { ...e }, cx: r.left + r.width / 2, cy: r.top + r.height / 2, moved: false, id: ev.pointerId };
    try { (ev.target.closest('[data-h]') || target).setPointerCapture(ev.pointerId); } catch { /* 이미 손을 뗀 포인터 */ }
  }
  function onMove(ev) {
    if (pts.has(ev.pointerId)) pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch) {
      if (pts.size < 2) return;
      const [a, b] = [...pts.values()];
      const k = Math.hypot(b.x - a.x, b.y - a.y) / pinch.d0;
      scaleFrom(pinch.e, pinch.start, k);
      let deg = normDeg(pinch.start.rotation + ((Math.atan2(b.y - a.y, b.x - a.x) - pinch.a0) * 180) / Math.PI);
      for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(deg - snap) < 3) deg = snap;
      pinch.e.rotation = deg;
      refreshNode(pinch.e);
      return;
    }
    if (!drag || ev.pointerId !== drag.id) return;
    const dx = (ev.clientX - drag.sx) / ED.scale;
    const dy = (ev.clientY - drag.sy) / ED.scale;
    if (!drag.moved && Math.hypot(dx, dy) * ED.scale < 3) return;
    if (!drag.moved) { snapshot(); drag.moved = true; }
    const { e, start } = drag;
    if (drag.mode === 'move') {
      e.x = clamp(start.x + dx, -start.width / 2, CW - start.width / 2);
      e.y = clamp(start.y + dy, -start.height / 2, CH - start.height / 2);
    } else if (drag.mode === 'size') {
      const rad = (start.rotation * Math.PI) / 180;
      const lx = dx * Math.cos(rad) + dy * Math.sin(rad); // 요소 기준 축으로 바꿔서
      const ly = -dx * Math.sin(rad) + dy * Math.cos(rad);
      let w = clamp(start.width + lx, 40, 2000);
      let h = clamp(start.height + ly, 30, 2400);
      if (e.type !== 'TEXT') h = clamp(w * (start.height / start.width), 30, 2400); // 사진·스티커는 비율 유지
      if (e.type !== 'TEXT' && h === 2400) w = h * (start.width / start.height);
      e.width = w;
      e.height = h;
    } else if (drag.mode === 'rot') {
      let deg = (Math.atan2(ev.clientY - drag.cy, ev.clientX - drag.cx) * 180) / Math.PI + 90;
      deg = ((deg + 540) % 360) - 180;
      for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(deg - snap) < 4) deg = snap;
      e.rotation = deg;
    }
    if (drag.mode === 'move') {
      drag.node.style.cssText = elStyle(e);
      const box = $('#sbEditor .sb-selbox');
      if (box) box.style.cssText = selStyle(e);
    } else refreshNode(e);
  }
  function onUp(ev) {
    pts.delete(ev.pointerId);
    if (!pts.size && wrapEl()) wrapEl().style.touchAction = '';
    if (pinch) {
      if (pts.size < 2) { pinch = null; changedNow(); }
      return;
    }
    if (!drag || ev.pointerId !== drag.id) return;
    const was = drag;
    drag = null;
    if (was.moved) changedNow();
  }

  // 마우스: Ctrl(⌘)+휠 = 확대·축소 (노트북 터치패드 두 손가락 벌리기도 같음), Alt+휠 = 회전
  function onWheel(ev) {
    const e = ED && selEl();
    if (!e || !(ev.ctrlKey || ev.metaKey || ev.altKey) || !ev.target.closest('.sb-wrap')) return;
    ev.preventDefault();
    if (!ED.wheel) { snapshot(); ED.wheel = { start: structuredClone(e), k: 1 }; }
    if (ev.altKey) e.rotation = normDeg(e.rotation + (ev.deltaY > 0 ? 3 : -3));
    else {
      ED.wheel.k = clamp(ED.wheel.k * Math.exp(-ev.deltaY * 0.002), 0.1, 10);
      scaleFrom(e, ED.wheel.start, ED.wheel.k);
    }
    refreshNode(e);
    clearTimeout(ED.wheelTimer);
    ED.wheelTimer = setTimeout(() => { if (ED) { ED.wheel = null; changedNow(); } }, 350);
  }

  function onKey(ev) {
    if (!ED || $('#sheet').classList.contains('open')) return;
    if (ev.target.matches('input, textarea')) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && (ev.key.toLowerCase() === 'y' || (ev.shiftKey && ev.key.toLowerCase() === 'z'))) { ev.preventDefault(); redo(); return; }
    if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); return; }
    if (ev.key === 'Escape') { if (ED.sel) select(null); else finishEditor(false); return; }
    const e = selEl();
    if (!e) return;
    const step = ev.shiftKey ? 20 : 5;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[ev.key]) {
      ev.preventDefault();
      snapshot();
      e.x = clamp(e.x + moves[ev.key][0], -e.width / 2, CW - e.width / 2);
      e.y = clamp(e.y + moves[ev.key][1], -e.height / 2, CH - e.height / 2);
      changedNow();
      select(e.id);
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      tool('del');
    }
  }

  // ---------- 도구 ----------
  function tool(name) {
    const e = selEl();
    if (!e) return;
    if (name === 'done') return select(null);
    if (name === 'edit') return editText(e);
    if (name === 'deco') return editDeco(e);
    if (name === 'frame') return pickFrame(e);
    if (name === 'crop') return cropPhoto(e);
    snapshot();
    if (name === 'rotL' || name === 'rotR') e.rotation = ((e.rotation + (name === 'rotL' ? -15 : 15) + 540) % 360) - 180;
    else if (name === 'up') {
      const above = ED.els.filter((x) => x.zIndex > e.zIndex).sort((a, b) => a.zIndex - b.zIndex)[0];
      if (above) [e.zIndex, above.zIndex] = [above.zIndex, e.zIndex];
    } else if (name === 'down') {
      const below = ED.els.filter((x) => x.zIndex < e.zIndex).sort((a, b) => b.zIndex - a.zIndex)[0];
      if (below) [e.zIndex, below.zIndex] = [below.zIndex, e.zIndex];
    } else if (name === 'dup') {
      const c = { ...structuredClone(e), id: uuid(), x: clamp(e.x + 30, 0, CW - 40), y: clamp(e.y + 30, 0, CH - 40), zIndex: topZ() };
      ED.els.push(c);
      ED.sel = c.id;
    } else if (name === 'del') {
      ED.els = ED.els.filter((x) => x.id !== e.id);
      ED.sel = null;
    }
    changedNow();
  }

  function editText(e) {
    const c = e.content;
    const body = openSheet(`<h2>글자</h2>
      <form id="txForm">
        <label class="field"><span>내용 <small>300자</small></span><textarea name="text" maxlength="300" rows="3">${esc(c.text || '')}</textarea></label>
        <label class="field"><span>크기 <small id="szv">${c.size || 56}</small></span><input type="range" name="size" min="24" max="160" value="${c.size || 56}"></label>
        <div class="field"><span>글꼴</span><div class="cats">
          <label><input type="radio" name="font" value="hand" ${c.font !== 'basic' ? 'checked' : ''}><span style="font-family:Gaegu,cursive">손글씨</span></label>
          <label><input type="radio" name="font" value="basic" ${c.font === 'basic' ? 'checked' : ''}><span>고딕</span></label></div></div>
        <div class="field"><span>정렬</span><div class="cats">${[['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']].map(([k, l]) => `<label><input type="radio" name="align" value="${k}" ${(c.align || 'left') === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
        <div class="field"><span>글자 색</span><div class="swatches">${COLORS.map((col) => `<label><input type="radio" name="color" value="${col}" ${(c.color || COLORS[0]) === col ? 'checked' : ''}><span style="background:${col}" aria-label="${col}"></span></label>`).join('')}</div></div>
        <div class="field"><span>글자 배경</span><div class="swatches">${Object.entries(TEXT_BGS).map(([k, [l, col]]) => `<label title="${l}"><input type="radio" name="bg" value="${k}" ${(c.bg || 'none') === k ? 'checked' : ''}><span class="${col ? '' : 'sw-none'}" style="${col ? `background:${col}` : ''}" aria-label="${l}"></span></label>`).join('')}</div></div>
        <button class="primary" type="submit">적용</button>
      </form>`);
    const f = $('#txForm', body);
    f.size.oninput = () => { $('#szv', body).textContent = f.size.value; };
    f.onsubmit = (ev) => {
      ev.preventDefault();
      snapshot();
      e.content = { ...c, text: f.text.value.slice(0, 300), size: Number(f.size.value), font: f.font.value, align: f.align.value, color: f.color.value, bg: f.bg.value };
      // 글이 길어지면 상자 높이를 늘려 줌 (배경이 있으면 안쪽 여백만큼 더)
      const padY = e.content.bg !== 'none' ? textPad(e.content.size).y * 2 : 0;
      const lines = Math.max(1, Math.ceil((e.content.text.length * e.content.size * 0.9) / e.width)) + (e.content.text.match(/\n/g) || []).length;
      e.height = Math.max(e.height, Math.min(1200, lines * e.content.size * 1.35 + padY));
      closeSheet();
      changedNow();
    };
    setTimeout(() => f.text.focus(), 250);
  }

  function editDeco(e) {
    const c = e.content;
    const label = { stamp: '날짜 도장', ticket: '티켓', label: '장소 라벨', memo: '메모지' }[c.shape];
    const body = openSheet(`<h2>${label}</h2>
      <form id="dcForm">
        ${c.shape === 'memo' ? `<label class="field"><span>글 <small>160자</small></span><textarea name="text" maxlength="160" rows="4">${esc(c.text || '')}</textarea></label>`
          : `<label class="field"><span>${c.shape === 'stamp' ? '가운데 글' : '글'}</span><input name="text" maxlength="24" value="${esc(c.text || '')}"></label>`}
        ${c.shape === 'label' || c.shape === 'memo' ? '' : `<label class="field"><span>${c.shape === 'stamp' ? '위 작은 글' : '아래 작은 글'}</span><input name="sub" maxlength="30" value="${esc(c.sub || '')}"></label>`}
        <button class="primary" type="submit">적용</button>
      </form>`);
    $('#dcForm', body).onsubmit = (ev) => {
      ev.preventDefault();
      const f = ev.target;
      snapshot();
      e.content = { ...c, text: f.text.value.trim(), ...(f.sub ? { sub: f.sub.value.trim() } : {}) };
      closeSheet();
      changedNow();
    };
  }

  // 사진에서 실제로 보이는 칸 (폴라로이드는 테두리 안쪽)
  const innerBox = (e) => (e.content?.frame === 'polaroid'
    ? { w: e.width * 0.92, h: Math.max(1, e.height - e.width * 0.2) } : { w: e.width, h: e.height });
  const CROP_RATIOS = [['free', '자유'], ['1', '1:1'], ['1.3333', '4:3'], ['0.75', '3:4'], ['1.7778', '16:9'], ['0.5625', '9:16']];

  function cropPhoto(e) {
    const src = srcOf(e, photoIndex(), false);
    if (!src) { toast('사진을 불러오지 못해 자를 수 없어요'); return; }
    const body = openSheet(`<h2>✂️ 사진 자르기</h2>
      <div class="cats crop-ratios" role="radiogroup" aria-label="비율">${CROP_RATIOS.map(([k, l], i) => `<label><input type="radio" name="ratio" value="${k}" ${i ? '' : 'checked'}><span>${l}</span></label>`).join('')}</div>
      <div class="crop-stage"><div class="crop-wrap">
        <img class="crop-img" src="${esc(src)}" alt="자를 사진" draggable="false">
        <div class="crop-box" data-c="move" aria-label="자를 영역">
          <i data-c="nw"></i><i data-c="ne"></i><i data-c="sw"></i><i data-c="se"></i>
        </div>
      </div></div>
      <small class="hint">상자를 끌어 옮기고, 모서리를 끌어 크기를 바꿔요. 원본 사진은 그대로예요.</small>
      <div class="exp-actions">
        <button type="button" class="btn-sub" data-cr="reset">원래 사진대로</button>
        <button type="button" class="btn-main" data-cr="apply">자르기</button>
      </div>`);
    const img = $('.crop-img', body);
    const wrap = $('.crop-wrap', body);
    const box = $('.crop-box', body);
    let nat = null;
    let rect = null;
    let ratio = null; // 너비/높이 (원본 픽셀 기준), null = 자유
    const MIN = 0.06;
    const draw = () => {
      box.style.left = `${rect.x * 100}%`;
      box.style.top = `${rect.y * 100}%`;
      box.style.width = `${rect.w * 100}%`;
      box.style.height = `${rect.h * 100}%`;
    };
    // 비율에 맞게 높이 다시 (원본 픽셀 비율 기준), 사진 밖으로 나가지 않게
    const fitRatio = (r, keepCenter = true) => {
      if (!ratio) return r;
      let w = r.w;
      let h = (w * nat.w) / (nat.h * ratio);
      if (h > 1) { h = 1; w = (h * nat.h * ratio) / nat.w; }
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      return keepCenter
        ? { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h }
        : { ...r, w, h };
    };
    const init = () => {
      if (nat) return;
      nat = { w: img.naturalWidth, h: img.naturalHeight };
      const cur = validCrop(e.content.crop);
      if (cur) rect = cur;
      else { // 지금 화면에 보이는 부분(가운데 맞춤)에서 시작
        const ib = innerBox(e);
        const A = ib.w / ib.h;
        const I = nat.w / nat.h;
        rect = I > A ? { x: (1 - A / I) / 2, y: 0, w: A / I, h: 1 } : { x: 0, y: (1 - I / A) / 2, w: 1, h: I / A };
      }
      draw();
    };
    // 이미 받아 둔 사진이면 load 가 먼저 끝났을 수 있어서 바로 시작
    if (img.complete && img.naturalWidth) init(); else img.addEventListener('load', init, { once: true });
    img.addEventListener('error', () => { toast('사진을 불러오지 못했어요'); closeSheet(); }, { once: true });

    // 아래 창은 여러 창이 같은 칸을 같이 써서, 예전 창의 처리기가 남지 않게 onchange/onclick 으로
    body.onchange = (ev) => {
      if (ev.target.name !== 'ratio' || !rect) return;
      ratio = ev.target.value === 'free' ? null : Number(ev.target.value);
      rect = fitRatio(rect);
      draw();
    };
    let dragC = null;
    box.addEventListener('pointerdown', (ev) => {
      if (!rect) return;
      ev.preventDefault();
      const r = wrap.getBoundingClientRect();
      dragC = { c: ev.target.closest('[data-c]')?.dataset.c || 'move', sx: ev.clientX, sy: ev.clientY, W: r.width, H: r.height, start: { ...rect }, id: ev.pointerId };
      try { box.setPointerCapture(ev.pointerId); } catch { /* 무시 */ }
    });
    box.addEventListener('pointermove', (ev) => {
      if (!dragC || ev.pointerId !== dragC.id) return;
      const dx = (ev.clientX - dragC.sx) / dragC.W;
      const dy = (ev.clientY - dragC.sy) / dragC.H;
      const st = dragC.start;
      if (dragC.c === 'move') {
        rect = { ...st, x: clamp(st.x + dx, 0, 1 - st.w), y: clamp(st.y + dy, 0, 1 - st.h) };
      } else {
        const west = dragC.c.includes('w');
        const north = dragC.c.includes('n');
        let x = west ? clamp(st.x + dx, 0, st.x + st.w - MIN) : st.x;
        let w = west ? st.x + st.w - x : clamp(st.w + dx, MIN, 1 - st.x);
        let y = north ? clamp(st.y + dy, 0, st.y + st.h - MIN) : st.y;
        let h = north ? st.y + st.h - y : clamp(st.h + dy, MIN, 1 - st.y);
        if (ratio) { // 비율 고정: 너비를 기준으로 높이, 넘치면 높이 기준으로 너비
          h = (w * nat.w) / (nat.h * ratio);
          const maxH = north ? st.y + st.h : 1 - st.y;
          if (h > maxH) { h = maxH; w = (h * nat.h * ratio) / nat.w; }
          if (west) x = st.x + st.w - w;
          if (north) y = st.y + st.h - h;
        }
        rect = { x, y, w, h };
      }
      draw();
    });
    const end = (ev) => { if (dragC && ev.pointerId === dragC.id) dragC = null; };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);

    body.onclick = (ev) => {
      const a = ev.target.closest('[data-cr]')?.dataset.cr;
      if (!a || !nat) return;
      const full = a === 'reset' || (rect.w > 0.995 && rect.h > 0.995);
      const crop = full ? null : { x: +rect.x.toFixed(4), y: +rect.y.toFixed(4), w: +rect.w.toFixed(4), h: +rect.h.toFixed(4) };
      const r = full ? nat.w / nat.h : (rect.w * nat.w) / (rect.h * nat.h); // 보이는 부분의 너비/높이
      snapshot();
      // 보이는 부분 비율에 맞게 요소 높이를 다시 (가운데 유지, 사진이 늘어나 보이지 않게)
      const pol = e.content.frame === 'polaroid';
      const iw = pol ? e.width * 0.92 : e.width;
      const newH = clamp(iw / r + (pol ? e.width * 0.2 : 0), 30, 2400);
      e.y += (e.height - newH) / 2;
      e.height = newH;
      const { crop: _old, ...rest } = e.content; // eslint-disable-line no-unused-vars
      e.content = crop ? { ...rest, crop } : rest;
      closeSheet();
      changedNow();
      toast(full ? '원래 사진으로 되돌렸어요' : '사진을 잘랐어요');
    };
  }

  function pickFrame(e) {
    const c = e.content;
    const body = openSheet(`<h2>사진 액자</h2>
      <form id="frForm">
        <div class="cats">${[['none', '없음'], ['polaroid', '폴라로이드'], ['tape', '마스킹테이프'], ['round', '둥근 모서리']].map(([k, l]) => `<label><input type="radio" name="frame" value="${k}" ${(c.frame || 'none') === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
        <label class="field" style="margin-top:12px"><span>사진 아래 글 (폴라로이드)</span><input name="caption" maxlength="40" value="${esc(c.caption || '')}"></label>
        <label class="field"><span>사진 설명 (화면 읽기용)</span><input name="alt" maxlength="80" value="${esc(c.alt || '')}"></label>
        <button class="primary" type="submit">적용</button>
      </form>`);
    $('#frForm', body).onsubmit = (ev) => {
      ev.preventDefault();
      const f = ev.target;
      snapshot();
      e.content = { ...c, frame: f.frame.value, caption: f.caption.value.trim(), alt: f.alt.value.trim() };
      closeSheet();
      changedNow();
    };
  }

  // ---------- 추가 ----------
  function addText() {
    const w = 600;
    const h = 90;
    addEl({ type: 'TEXT', ...centerSpot(w, h), width: w, height: h, content: { text: '여기에 글을 써요', size: 56, font: 'hand', color: COLORS[0] } });
    editText(selEl());
  }

  function pickSticker() {
    // 이 여행의 날짜·장소 (페이지 날짜가 있으면 그날 장소 먼저)
    const t = trip();
    const date = ED.page.page_date;
    const days = shared().tripDays(t);
    const places = state.places.filter((x) => x.trip_id === S.tripId);
    const names = [...new Set((date ? places.filter((x) => visitKey(x) === date) : places).concat(places).map((x) => x.name))].slice(0, 10);
    const stampDays = date ? [date] : days.slice(0, 6);
    const recs = dayRecords(date).filter((p) => p.comment || p.memo || p.title).slice(0, 12);
    const deco = [
      ...stampDays.map((d) => ({ label: `🔖 ${shared().short(d)} 날짜 도장`, make: () => dateStamp(d, 0, 0) })),
      ...names.map((nm) => ({ label: `📍 ${nm}`, make: () => placeLabel(nm, 0, 0) })),
      { label: `🎫 ${t?.title || '여행'} 티켓`, make: () => tripTicket(t, 0, 0) },
    ];
    const body = openSheet(`<h2>스티커</h2>
      <h3 class="st-sec">📅 이 여행의 날짜·장소</h3>
      <div class="deco-list">${deco.map((d, i) => `<button type="button" class="cand" data-deco="${i}">${esc(d.label)}</button>`).join('')}</div>
      <small class="hint">기록의 날짜·장소 이름을 글자로 넣어요. 나중에 기록을 고쳐도 붙인 스티커는 그대로예요 (눌러서 글을 고칠 수 있어요).</small>
      <h3 class="st-sec">🎀 장식</h3>
      <div class="sticker-grid">${TAPES.map((c) => `<button type="button" data-tape="${c}" aria-label="마스킹테이프"><i class="tape-chip" style="background:${c}"></i></button>`).join('')}
        <button type="button" data-preset="good" aria-label="GOOD DAY 도장">🔖</button>
        <button type="button" data-preset="ticket" aria-label="빈 티켓">🎫</button>
        <button type="button" data-preset="label" aria-label="빈 라벨">🏷️</button>
        <button type="button" data-preset="memo" aria-label="손글씨 메모지">🗒️</button>
        <button type="button" data-preset="film" aria-label="필름 프레임">🎞️</button></div>
      ${recs.length ? `<h3 class="st-sec">📝 기록 글 넣기</h3>
        <div class="rec-list">${recs.map((p, i) => `<button type="button" class="rec-pick" data-rec="${i}"><b>${esc(p.title || p.name)}</b><small>${esc(recordText(p, 70).split('\n').slice(1).join(' ') || '글 없음 · 장소 이름만')}</small></button>`).join('')}</div>
        <small class="hint">기록의 제목·한마디·이야기를 글자로 복사해 넣어요 (기록을 고쳐도 스크랩북 글은 그대로예요).</small>` : ''}
      ${STICKER_SETS.map(([g, list]) => `<h3 class="st-sec">${g}</h3>
        <div class="sticker-grid">${list.map((x) => `<button type="button" data-st="${x}" aria-label="스티커 ${x}">${x}</button>`).join('')}</div>`).join('')}`);
    const put = (el) => {
      closeSheet();
      addEl({ ...el, ...centerSpot(el.width, el.height), rotation: el.content.shape === 'stamp' ? -10 : el.content.shape === 'tape' ? -8 : el.content.shape === 'memo' ? -3 : 0 });
    };
    body.onclick = (ev) => {
      const s = ev.target.closest('[data-st]');
      const tp = ev.target.closest('[data-tape]');
      const dc = ev.target.closest('[data-deco]');
      const pr = ev.target.closest('[data-preset]')?.dataset.preset;
      if (s) put({ type: 'STICKER', width: 140, height: 140, content: { sticker: s.dataset.st } });
      else if (tp) put({ type: 'STICKER', width: 260, height: 60, content: { shape: 'tape', color: tp.dataset.tape } });
      else if (dc) put(deco[Number(dc.dataset.deco)].make());
      else if (pr === 'good') put({ type: 'STICKER', width: 200, height: 200, content: { shape: 'stamp', text: 'GOOD', sub: 'DAY', color: '#6E5FAE' } });
      else if (pr === 'ticket') put({ type: 'STICKER', width: 440, height: 170, content: { shape: 'ticket', text: '어디로?', sub: '', color: '#d9f0e6' } });
      else if (pr === 'label') put({ ...placeLabel('장소', 0, 0) });
      else if (pr === 'memo') put(memoNote('메모를 적어 보세요', 0, 0));
      else if (pr === 'film') put({ type: 'STICKER', width: 620, height: 1000, content: { shape: 'film' } });
      const rc = ev.target.closest('[data-rec]');
      if (rc) {
        const txt = recordText(recs[Number(rc.dataset.rec)]);
        const size = 40;
        const w = 760;
        const lines = txt.split('\n').reduce((n, ln) => n + Math.max(1, Math.ceil((ln.length * size * 0.95) / (w - 40))), 0);
        const h = Math.min(1200, Math.round(lines * size * 1.3 + size * 0.6));
        put({ type: 'TEXT', width: w, height: h, content: { text: txt, size, font: 'hand', color: '#2d2a26', bg: 'cream' } });
      }
    };
  }

  function pickBg() {
    const photos = [...photoIndex().values()];
    const bgPhoto = ED.els.find((x) => x.content?.locked);
    const body = openSheet(`<h2>배경</h2>${BG_GROUPS.map(([g, list]) => `<h3 class="st-sec">${g}</h3>
      <div class="bg-grid">${Object.entries(list).map(([k, l]) => `<button type="button" data-bg="${k}" class="${ED.bg === k && !bgPhoto ? 'on' : ''}" aria-pressed="${ED.bg === k}"><i class="sb-canvas bg-${k}"></i>${l}</button>`).join('')}</div>`).join('')}
      <h3 class="st-sec">📷 여행 사진을 배경으로</h3>
      ${bgPhoto ? '<button type="button" class="btn" data-bgph="remove" style="width:100%;margin-bottom:8px">배경 사진 빼기</button>' : ''}
      ${photos.length ? `<div class="sb-photo-grid">${photos.map((ph) => `<button type="button" data-bgph="${ph.id}" class="${bgPhoto?.photoId === ph.id ? 'on' : ''}" aria-label="${esc(ph.placeName)} 사진을 배경으로"><img src="${esc(ph.thumb)}" alt="" loading="lazy"></button>`).join('')}</div>
        <small class="hint">사진이 페이지 전체에 고정돼서 깔려요. 위에 올린 사진·글자·스티커는 그대로예요.</small>`
        : '<div class="hint">이 여행에 올린 사진이 아직 없어요</div>'}`);
    body.onclick = (ev) => {
      const b = ev.target.closest('[data-bg]');
      const ph = ev.target.closest('[data-bgph]')?.dataset.bgph;
      if (!b && !ph) return;
      snapshot();
      if (b) ED.bg = b.dataset.bg;
      else {
        ED.els = ED.els.filter((x) => !x.content?.locked); // 배경 사진은 하나만
        if (ph !== 'remove') {
          const minZ = ED.els.reduce((m, x) => Math.min(m, x.zIndex), 1);
          ED.els.push({ id: uuid(), type: 'IMAGE', x: 0, y: 0, width: CW, height: CH, rotation: 0, zIndex: minZ - 1, photoId: Number(ph), content: { frame: 'none', locked: true, alt: '배경 사진' } });
        }
        if (ED.sel && !selEl()) ED.sel = null;
      }
      closeSheet();
      changedNow();
    };
  }

  function pickPhotos() {
    const photos = [...photoIndex().values()];
    const date = ED.page.page_date;
    photos.sort((a, b) => (a.date === date ? -1 : 0) - (b.date === date ? -1 : 0) || String(a.date).localeCompare(String(b.date)) || a.id - b.id);
    const groups = new Map();
    for (const p of photos) { if (!groups.has(p.date)) groups.set(p.date, []); groups.get(p.date).push(p); }
    const chosen = new Set();
    const body = openSheet(`<h2>사진 넣기</h2>
      <label class="primary pick-btn">📤 새 사진 올리기<input type="file" accept="image/*" multiple hidden id="sbUpload"></label>
      <small class="hint">이 여행에 기록한 사진은 다시 올리지 않고 그대로 가져와요.</small>
      ${photos.length ? [...groups].map(([d, list]) => `<h3 class="tl-date">${d ? fmtDate(d) : '날짜 없음'}${d === date ? ' · 이 페이지 날짜' : ''}</h3>
        <div class="sb-photo-grid">${list.map((p) => `<button type="button" data-ph="${p.id}" aria-pressed="false"><img src="${esc(p.thumb)}" alt="${esc(p.placeName)}" loading="lazy"></button>`).join('')}</div>`).join('')
        : '<div class="empty small">이 여행에 올린 사진이 아직 없어요</div>'}
      <div class="sticky-actions">
        <label class="sb-auto"><input type="checkbox" id="phAuto" checked> 📍 날짜·장소 스티커도 함께 넣기</label>
        <button class="primary" id="phAdd" disabled>사진 넣기</button></div>`);
    body.onclick = async (ev) => {
      const b = ev.target.closest('[data-ph]');
      if (b) {
        const id = Number(b.dataset.ph);
        if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
        b.setAttribute('aria-pressed', String(chosen.has(id)));
        b.classList.toggle('on', chosen.has(id));
        const add = $('#phAdd', body);
        add.disabled = !chosen.size;
        add.textContent = chosen.size ? `사진 ${chosen.size}장 넣기` : '사진 넣기';
        return;
      }
      if (ev.target.id === 'phAdd') {
        const idx = photoIndex();
        const list = [...chosen].map((id) => idx.get(id)).filter(Boolean);
        const auto = $('#phAuto', body).checked;
        closeSheet();
        snapshot();
        const labeled = new Set();
        for (const p of list) {
          const a = await aspectOf(p.thumb);
          const w = 420;
          const img = { id: uuid(), type: 'IMAGE', ...centerSpot(w, w * a), width: w, height: Math.round(w * a), rotation: 0, zIndex: topZ(), photoId: p.id, content: { frame: 'tape', alt: p.placeName } };
          ED.els.push(img);
          // 사진 아래 장소 라벨 (같은 장소는 한 번), 페이지에 날짜 도장이 없으면 하나
          if (auto && p.placeName && !labeled.has(p.placeName)) {
            labeled.add(p.placeName);
            const lb = placeLabel(p.placeName, img.x, Math.min(CH - 80, img.y + img.height + 14));
            ED.els.push({ ...lb, id: uuid(), rotation: -2, zIndex: topZ() });
          }
          if (auto && p.date && !ED.els.some((x) => x.content?.shape === 'stamp')) {
            ED.els.push({ ...dateStamp(p.date, CW - 240, 30), id: uuid(), rotation: -12, zIndex: topZ() });
          }
        }
        ED.sel = list.length ? ED.els.find((x) => x.photoId === list.at(-1).id && x.type === 'IMAGE')?.id || null : null;
        changedNow();
      }
    };
    $('#sbUpload', body).onchange = async (ev) => {
      const files = [...ev.target.files].slice(0, 10);
      ev.target.value = '';
      if (!files.length) return;
      closeSheet();
      ED.saving = true;
      $('#sbEditor .sb-status').textContent = '사진 줄이는 중…';
      try {
        const items = await processPhotos(files, (n, total) => { $('#sbEditor .sb-status').textContent = `사진 줄이는 중… ${n}/${total}`; });
        const added = [];
        for (let i = 0; i < items.length; i++) {
          $('#sbEditor .sb-status').textContent = `사진 올리는 중… ${i + 1}/${items.length}`;
          const path = `${S.tripId}/sb_${uuid()}.jpg`;
          await q(sb.storage.from(BUCKET).upload(path, items[i].photo, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false }));
          ED.uploaded.add(path);
          added.push({ path, aspect: await aspectOf(items[i].preview) });
          URL.revokeObjectURL(items[i].preview);
        }
        await signPaths(added.map((a) => a.path));
        if (added.length) {
          snapshot();
          for (const a of added) {
            const w = 420;
            ED.els.push({ id: uuid(), type: 'IMAGE', ...centerSpot(w, w * a.aspect), width: w, height: Math.round(w * a.aspect), rotation: 0, zIndex: topZ(), assetPath: a.path, content: { frame: 'polaroid', alt: '여행 사진' } });
          }
          ED.sel = ED.els.at(-1).id;
          ED.saving = false;
          changedNow();
          toast('사진을 올렸어요');
        }
      } catch (err) { toast(err.message); } finally { ED.saving = false; status(); }
    };
  }

  // ---------- 저장 ----------
  async function save({ auto = false } = {}) {
    if (!ED || ED.saving || ED.conflict) return false;
    clearTimeout(ED.saveTimer);
    if (!navigator.onLine) {
      ED.offline = true;
      status();
      if (!auto) toast('오프라인이에요. 편집 내용은 이 기기에 임시로 남아 있어요');
      return false;
    }
    ED.saving = true;
    ED.offline = false;
    ED.saveError = false;
    status();
    const ver = ED.ver;
    const page = ED.page;
    const { pq } = shared();
    try {
      const title = $('#sbEditor .sb-title').value.trim();
      if (title !== ED.page.title || ED.bg !== ED.page.background) {
        const rows = await pq(sb.from('scrapbook_pages').update({ title, background: ED.bg }).eq('id', ED.page.id).select('id'));
        if (!rows.length) throw new Error('권한이 없거나 지워진 페이지예요');
        Object.assign(ED.page, { title, background: ED.bg });
      }
      const [r] = await pq(sb.rpc('save_scrapbook_page', { p_page_id: ED.page.id, p_expected_revision: ED.page.revision, p_elements: ED.els.map(toRow) }));
      if (!r) throw new Error('저장 결과를 확인하지 못했어요');
      page.revision = r.revision;
      if (r.orphan_paths?.length) removeFiles(r.orphan_paths).catch(() => {}); // 남이 올린 사진은 권한상 못 지울 수 있음
      if (!ED || ED.page !== page) return true;
      S.els.set(page.id, ED.els.map((e) => structuredClone(e)));
      ED.uploaded.clear();
      ED.lastSaved = new Date();
      if (ED.ver === ver) { // 저장하는 동안 더 고치지 않았으면
        ED.dirty = false;
        localStorage.removeItem(`sbDraft:${page.id}`);
      }
      if (!auto) toast('저장했어요');
      return true;
    } catch (err) {
      if (!ED) return false;
      if (err.code === 'PT409') { ED.conflict = true; ED.conflictMsg = err.message; conflict(err.message); }
      else {
        ED.saveError = true;
        if (/check constraint|입력한 내용/.test(err.message) && !['paper', 'grid', 'kraft', 'mint', 'lilac'].includes(ED.bg)) {
          toast('새 배경을 쓰려면 DB 설정(migrate-006)이 먼저 필요해요. 편집은 이 기기에 임시로 남아 있어요');
        } else if (!auto) toast(`${err.message} · 편집 내용은 이 기기에 임시로 남아 있어요`);
      }
      return false;
    } finally {
      if (ED) {
        ED.saving = false;
        status();
        if (ED.dirty && !ED.saveError && !ED.conflict && !ED.offline) scheduleSave(); // 저장하는 동안 고친 것
      }
    }
  }

  function conflict(msg) {
    const body = openSheet(`<h2>다른 사람이 먼저 고쳤어요</h2>
      <p class="muted">${esc(msg)}</p>
      <div class="choice-list">
        <button class="choice" data-c="copy"><span class="ic">📄</span><span><b>내 편집을 새 페이지로 저장</b><small>다른 사람이 고친 페이지는 그대로 두고, 내가 꾸민 것은 새 페이지로 남겨요</small></span></button>
        <button class="choice" data-c="reload"><span class="ic">🔄</span><span><b>다시 불러오기</b><small>내 편집은 버리고 최신 페이지를 열어요</small></span></button>
      </div>`);
    body.onclick = async (ev) => {
      const c = ev.target.closest('[data-c]')?.dataset.c;
      if (!c) return;
      const { pq } = shared();
      try {
        if (c === 'copy') {
          const order = S.pages.reduce((m, p) => Math.max(m, p.page_order), 0) + 1;
          const [page] = await pq(sb.from('scrapbook_pages').insert({
            trip_id: S.tripId, title: `${$('#sbEditor .sb-title').value.trim() || ED.page.title} (내 편집)`.slice(0, 40),
            page_date: ED.page.page_date, template: ED.page.template, background: ED.bg, page_order: order,
            ...(ED.page.scrapbook_id ? { scrapbook_id: ED.page.scrapbook_id } : {}),
          }).select());
          await pq(sb.rpc('save_scrapbook_page', { p_page_id: page.id, p_expected_revision: page.revision, p_elements: ED.els.map((e) => ({ ...toRow(e), id: uuid() })) }));
          localStorage.removeItem(`sbDraft:${ED.page.id}`);
          ED.dirty = false;
          ED.uploaded.clear(); // 새 페이지가 쓰는 사진이라 지우면 안 됨
          toast('내 편집을 새 페이지로 저장했어요');
        } else {
          localStorage.removeItem(`sbDraft:${ED.page.id}`);
          ED.dirty = false;
        }
        closeSheet();
        const id = ED.page.id;
        closeEditor(true);
        await load(true);
        if (c === 'reload') { const p = S.pages.find((x) => x.id === id); if (p) openEditor(p); }
      } catch (err) { toast(err.message); }
    };
  }

  function closeEditor(force = false, skipConfirm = false) {
    if (!ED) return;
    if (!force && !skipConfirm && ED.dirty && !confirm('저장하지 않은 편집이 있어요. 닫을까요?\n(이 기기에는 임시로 남아서 다음에 이어서 고칠 수 있어요)')) return;
    // 올리고 저장하지 않은 사진: 임시 편집(이 기기)에서 아직 쓰므로 남겨 둠. 편집을 버리면(다시 불러오기) 지움
    if (force && ED.uploaded.size) removeFiles([...ED.uploaded]).catch(() => {});
    clearTimeout(ED.saveTimer);
    clearTimeout(ED.wheelTimer);
    $('#sbEditor').classList.add('hidden');
    $('#sbEditor').innerHTML = '';
    document.body.classList.remove('sb-open');
    ED = null;
    drag = null;
    pinch = null;
    pts.clear();
    render();
  }
  /** ← / 완료: 남은 편집을 저장한 뒤 닫기. view 면 이 페이지를 감상 모드로 */
  async function finishEditor(view) {
    if (!ED) return;
    const page = ED.page;
    if (ED.dirty && !ED.conflict) await save({ auto: true });
    if (!ED) return;
    if (ED.dirty && !confirm('아직 저장하지 못한 편집이 있어요 (이 기기에는 임시로 남아 있어요). 닫을까요?')) return;
    closeEditor(false, true); // 이미 물어봤음. 올린 사진은 임시 편집이 쓰므로 남겨 둠
    if (view) { const i = S.pages.findIndex((x) => x.id === page.id); if (i >= 0) openStory(i); }
  }

  function bindEditor() {
    const box = $('#sbEditor');
    box.addEventListener('pointerdown', (ev) => { if (ED && ev.target.closest('.sb-wrap')) onDown(ev); });
    // 손가락을 떼는 순간 그 자리 요소가 다시 그려져도 놓치지 않게 창 전체에서 받음
    window.addEventListener('pointermove', (ev) => { if (ED) onMove(ev); });
    window.addEventListener('pointerup', (ev) => { if (ED) onUp(ev); });
    window.addEventListener('pointercancel', (ev) => { if (ED) onUp(ev); });
    box.addEventListener('wheel', onWheel, { passive: false });
    box.addEventListener('dblclick', (ev) => {
      const node = ev.target.closest('.sb-el');
      const e = node && ED?.els.find((x) => x.id === node.dataset.id);
      if (e?.type === 'TEXT') editText(e);
    });
    box.addEventListener('focusin', (ev) => {
      const node = ev.target.closest('.sb-el');
      if (node && ED && ED.sel !== node.dataset.id && !drag) select(node.dataset.id);
    });
    box.addEventListener('click', (ev) => {
      if (!ED) return;
      const ed = ev.target.closest('[data-ed]')?.dataset.ed;
      if (ed === 'close') return finishEditor(false);
      if (ed === 'done') return finishEditor(true);
      if (ed === 'undo') return undo();
      if (ed === 'redo') return redo();
      if (ed === 'retry') { if (ED.conflict) return conflict(ED.conflictMsg); ED.saveError = false; return save(); }
      if (ed === 'export') { // 화면에 보이는 그대로 (저장 전 편집도 포함)
        ED.title = $('#sbEditor .sb-title').value.trim() || ED.page.title;
        return exportPage({ ...ED.page, title: ED.title }, ED.els, ED.bg);
      }
      const add = ev.target.closest('[data-add]')?.dataset.add;
      if (add === 'photo') return pickPhotos();
      if (add === 'text') return addText();
      if (add === 'sticker') return pickSticker();
      if (add === 'bg') return pickBg();
      const tl = ev.target.closest('[data-tool]')?.dataset.tool;
      if (tl) tool(tl);
    });
    box.addEventListener('input', (ev) => {
      if (ED && ev.target.matches('.sb-title')) { ED.title = ev.target.value; ED.dirty = true; ED.ver++; status(); scheduleSave(1500); }
    });
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', () => { if (ED) { layout(); drawCanvas(); } });
    window.addEventListener('beforeunload', (ev) => { if (ED?.dirty) { ev.preventDefault(); ev.returnValue = ''; } });
    window.addEventListener('online', () => { if (ED?.dirty) { ED.offline = false; scheduleSave(300); } });
  }

  // ---------- 연결 ----------
  bind();
  bindEditor();
  bindStory();
  window.addEventListener('travel:view', (e) => { if (e.detail === 'scrap') load(); });
  window.addEventListener('travel:refresh', () => { if (state.view === 'scrap' && !ED) load(true); else if (state.view !== 'scrap') S.loadedFor = null; });
})();
