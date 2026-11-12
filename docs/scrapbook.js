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
    POLAROID: ['🖼️', '폴라로이드', '그날 사진을 폴라로이드로'],
    GRID: ['🔲', '사진 4칸', '사진 4장을 바둑판으로'],
  };
  const BGS = { paper: '종이', grid: '모눈', kraft: '크라프트', mint: '민트', lilac: '라일락' };
  const STICKERS = ['✈️', '🚆', '🚌', '🗺️', '📍', '🧳', '🏯', '⛩️', '🌸', '🍁', '🌿', '🌊', '☀️', '🌙', '⭐', '💜',
    '💛', '📷', '🎫', '🍜', '☕', '🍰', '🍺', '🎉', '😆', '🥰', '👍', '✉️', '🎈', '❤️'];
  const TAPES = ['#f7c8d0', '#c9e4f6', '#fff1a1', '#cdeccf', '#e2cbff'];
  const COLORS = ['#2d2a26', '#6E5FAE', '#c2410c', '#1f5378', '#0f766e', '#ffffff'];
  const MAX_HISTORY = 40;

  const S = { tripId: null, loadedFor: null, loading: false, error: null, pages: [], els: new Map() };
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
      const [pages, els] = await Promise.all([
        pq(sb.from('scrapbook_pages').select('*').eq('trip_id', id).order('page_order').order('id')),
        pq(sb.from('scrapbook_elements').select('*').eq('trip_id', id)),
      ]);
      if (S.tripId !== id) return;
      await signPaths(els.map((e) => e.asset_path));
      S.pages = pages;
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

  // ---------- 요소 그리기 (목록 미리보기·편집기 공통) ----------
  function elInner(e, photos, small) {
    const c = e.content || {};
    if (e.type === 'IMAGE') {
      const src = srcOf(e, photos, small);
      const alt = c.alt || photos.get(e.photoId)?.placeName || '여행 사진';
      return `<div class="sb-photo frame-${esc(c.frame || 'none')}">
        ${src ? `<img src="${esc(src)}" alt="${esc(alt)}" draggable="false" loading="lazy">` : '<div class="sb-missing">사진이 지워졌어요</div>'}
        ${c.frame === 'polaroid' && c.caption ? `<div class="sb-caption">${esc(c.caption)}</div>` : ''}</div>`;
    }
    if (e.type === 'TEXT') {
      return `<div class="sb-text font-${esc(c.font || 'hand')}" style="font-size:${Number(c.size) || 56}px;color:${esc(c.color || '#2d2a26')};text-align:${esc(c.align || 'left')}">${esc(c.text || '')}</div>`;
    }
    if (c.shape === 'tape') return `<div class="sb-tape" style="background:${esc(c.color || TAPES[0])}"></div>`;
    return `<div class="sb-sticker" style="font-size:${Math.round(Math.min(e.width, e.height) * 0.86)}px" role="img" aria-label="스티커">${esc(c.sticker || '⭐')}</div>`;
  }
  const elStyle = (e) => `left:${e.x}px;top:${e.y}px;width:${e.width}px;height:${e.height}px;transform:rotate(${e.rotation}deg);z-index:${e.zIndex}`;
  function canvasHtml(page, els, photos, small) {
    return `<div class="sb-canvas bg-${esc(page.background || 'paper')}">${[...els].sort((a, b) => a.zIndex - b.zIndex)
      .map((e) => `<div class="sb-el type-${e.type.toLowerCase()}" style="${elStyle(e)}">${elInner(e, photos, small)}</div>`).join('')}</div>`;
  }

  // ---------- 페이지 목록 ----------
  function render() {
    const r = root();
    if (!r || state.view !== 'scrap') return;
    if (!S.tripId) { r.innerHTML = shared().pickTripHtml('스크랩북을'); return; }
    const t = trip();
    if (!t) { r.innerHTML = '<div class="empty">기록장을 찾을 수 없어요</div>'; return; }
    const head = `<div class="section-head"><h2>📔 ${esc(t.title)}</h2>
      <div class="sb-head-btns">${S.pages.length ? '<button class="chip-btn" data-act="story" aria-label="스토리로 보기">▶ 스토리</button>' : ''}<button class="chip-btn" data-act="new-page">＋ 새 페이지</button></div></div>`;
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
        <button class="sb-thumb" data-open aria-label="${esc(p.title || `${i + 1}쪽`)} 편집하기">${canvasHtml(p, S.els.get(p.id) || [], photos, true)}</button>
        <div class="sb-page-meta"><b>${esc(p.title || `${i + 1}쪽`)}</b><small class="muted">${p.page_date ? shared().short(p.page_date) : ''} · ${(S.els.get(p.id) || []).length}개 요소</small></div>
        <div class="sb-page-tools">
          <button class="icon-btn" data-pmove="-1" ${i === 0 ? 'disabled' : ''} aria-label="앞으로">◀</button>
          <button class="icon-btn" data-pmove="1" ${i === S.pages.length - 1 ? 'disabled' : ''} aria-label="뒤로">▶</button>
          <button class="icon-btn" data-pexp aria-label="이미지로 저장·공유">📤</button>
          <button class="icon-btn" data-pdel aria-label="페이지 삭제">🗑</button>
        </div>
      </div>`).join('')}</div>`
      : `<div class="empty"><div class="big">📔</div>아직 스크랩북 페이지가 없어요<br><small>여행 사진으로 하루 한 장씩 꾸며 보세요</small></div>`);
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
      if (act === 'story') return openStory(0);
      if (act === 'reload') return load(true);
      if (act === 'new-trip') return openTripForm();
      const card = e.target.closest('[data-page]');
      if (!card) return;
      const page = S.pages.find((p) => p.id === Number(card.dataset.page));
      if (e.target.closest('[data-open]')) return openEditor(page);
      if (e.target.closest('[data-pdel]')) return deletePage(page);
      if (e.target.closest('[data-pexp]')) return exportPage(page, S.els.get(page.id) || [], page.background);
      const mv = e.target.closest('[data-pmove]');
      if (mv) return movePage(page, Number(mv.dataset.pmove));
    });
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
    const body = openSheet(`<h2>새 스크랩북 페이지</h2>
      <form id="npForm">
        <div class="choice-list sb-tpls">${Object.entries(TEMPLATES).map(([k, [ic2, name, desc]], i) => `<label class="choice">
          <input type="radio" name="template" value="${k}" ${i === 1 ? 'checked' : ''}><span class="ic">${ic2}</span><span><b>${name}</b><small>${desc}</small></span></label>`).join('')}</div>
        <div class="grid2" style="margin-top:12px">
          <label class="field"><span>날짜</span><select name="date"><option value="">없음</option>${days.map((d, i) => `<option value="${d}" ${i === 0 ? 'selected' : ''}>${i + 1}일차 ${shared().short(d)}</option>`).join('')}</select></label>
          <label class="field"><span>배경</span><select name="bg">${Object.entries(BGS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>제목 (선택)</span><input name="title" maxlength="40" placeholder="비우면 날짜로 정해요"></label>
        <button class="primary" type="submit">만들기</button>
      </form>`);
    const f = $('#npForm', body);
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
          trip_id: S.tripId, title, page_date: date, template: tpl, background: f.bg.value, page_order: order,
        }).select());
        const els = await templateElements(tpl, date, title);
        if (els.length) {
          const [r] = await pq(sb.rpc('save_scrapbook_page', { p_page_id: page.id, p_expected_revision: page.revision, p_elements: els.map(toRow) }));
          page.revision = r.revision;
        }
        closeSheet();
        await load(true);
        openEditor(S.pages.find((p) => p.id === page.id) || page);
      } catch (err) { toast(err.message); btn.disabled = false; }
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

  function drawBackground(ctx, bg, W = CW, H = CH) {
    const fill = { paper: '#f6efe1', grid: '#fbfaf4', kraft: '#d7b98e', mint: '#e3f5ef', lilac: '#efe6fb' }[bg] || '#f6efe1';
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, W, H);
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
      if (img) drawCover(ctx, img, x + pad, y + pad, iw, Math.max(1, ih)); else drawMissing(ctx, x + pad, y + pad, iw, Math.max(1, ih));
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
    if (img) drawCover(ctx, img, x, y, w, h); else drawMissing(ctx, x, y, w, h);
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
    applyFont(ctx, hand ? FONTS.hand : FONTS.basic, size, hand ? HAND_FONT : BASIC_FONT);
    ctx.fillStyle = c.color || '#2d2a26';
    ctx.textBaseline = 'middle';
    const align = c.align || 'left';
    ctx.textAlign = align;
    const ax = align === 'center' ? 0 : align === 'right' ? w / 2 : -w / 2;
    const lh = size * 1.3;
    wrapText(ctx, c.text, w).forEach((ln, i) => ctx.fillText(ln, ax, -h / 2 + lh * i + lh / 2));
  }

  function drawStickerEl(ctx, e, w, h) {
    const c = e.content || {};
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
  /** 배경 무늬 위에 페이지를 카드처럼 올리고, 위에 기록장 제목·날짜를 넣음 */
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
    ctx.fillText('📒 여행 기록', STORY_W / 2, y + ph + (STORY_H - y - ph) / 2);
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
    ED = { page, els, sel: null, hist: [], dirty: false, saving: false, scale: 1, uploaded: new Set(), title: page.title, bg: page.background };
    // 저장 못 한 편집이 이 기기에 남아 있으면 복구 제안
    try {
      const local = JSON.parse(localStorage.getItem(`sbDraft:${page.id}`) || 'null');
      if (local && local.rev === page.revision && JSON.stringify(local.els) !== JSON.stringify(els.map(toRow))
        && confirm('이 페이지에 저장하지 못한 편집이 있어요. 이어서 고칠까요?\n(취소하면 저장된 상태로 열어요)')) {
        ED.els = local.els;
        ED.title = local.title ?? ED.title;
        ED.bg = local.bg ?? ED.bg;
        ED.dirty = true;
      } else if (local) localStorage.removeItem(`sbDraft:${page.id}`);
    } catch { /* 무시 */ }
    const box = $('#sbEditor');
    box.innerHTML = `
      <div class="sb-top">
        <button class="icon-btn" data-ed="close" aria-label="닫기">←</button>
        <input class="sb-title" maxlength="40" value="${esc(ED.title)}" aria-label="페이지 제목">
        <span class="sb-status" aria-live="polite"></span>
        <button class="icon-btn" data-ed="export" aria-label="이미지로 저장·공유">📤</button>
        <button class="icon-btn" data-ed="undo" aria-label="되돌리기">↶</button>
        <button class="sb-save" data-ed="save">저장</button>
      </div>
      <div class="sb-stage"><div class="sb-wrap"></div></div>
      <div class="sb-tools"></div>`;
    box.classList.remove('hidden');
    document.body.classList.add('sb-open');
    layout();
    drawCanvas();
    drawTools();
    status();
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
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', `${{ IMAGE: '사진', TEXT: '글자', STICKER: '스티커' }[e.type]}${e.type === 'TEXT' ? `: ${e.content.text || ''}` : ''}`);
      if (e.id === ED.sel) node.classList.add('sel');
    });
    // 선택 상자·손잡이는 다른 요소에 가려지지 않게 맨 위 층에 따로 그림
    const e = selEl();
    if (e) {
      canvas.insertAdjacentHTML('beforeend', `<div class="sb-selbox" style="${selStyle(e)}">
        <span class="h h-rot" data-h="rot" aria-hidden="true"></span><span class="h h-size" data-h="size" aria-hidden="true"></span></div>`);
    }
  }
  const selStyle = (e) => `${elStyle(e)};z-index:100000`;

  function status() {
    const s = $('#sbEditor .sb-status');
    if (!s) return;
    s.textContent = ED.saving ? '저장 중…' : ED.dirty ? '저장 안 됨' : '저장됨 ✓';
    s.className = `sb-status ${ED.dirty ? 'dirty' : ''}`;
    $('#sbEditor [data-ed=undo]').disabled = !ED.hist.length;
  }

  const selEl = () => ED.els.find((e) => e.id === ED.sel);

  function drawTools() {
    const t = $('#sbEditor .sb-tools');
    const e = selEl();
    if (!e) {
      t.innerHTML = `<div class="sb-add">
        <button data-add="photo"><span>📷</span>사진</button>
        <button data-add="text"><span>🔤</span>글자</button>
        <button data-add="sticker"><span>🌟</span>스티커</button>
        <button data-add="bg"><span>🎨</span>배경</button></div>`;
      return;
    }
    t.innerHTML = `<div class="sb-ctx">
      ${e.type === 'TEXT' ? '<button data-tool="edit">✏️ 글 수정</button>' : ''}
      ${e.type === 'IMAGE' ? '<button data-tool="frame">🖼️ 액자</button>' : ''}
      <button data-tool="rotL" aria-label="왼쪽으로 돌리기">⟲ 15°</button>
      <button data-tool="rotR" aria-label="오른쪽으로 돌리기">⟳ 15°</button>
      <button data-tool="up">⬆ 앞으로</button>
      <button data-tool="down">⬇ 뒤로</button>
      <button data-tool="dup">⧉ 복제</button>
      <button data-tool="del" class="danger">🗑 삭제</button>
      <button data-tool="done">✓ 선택 해제</button></div>`;
  }

  // 바꾸기 전에 기록 (되돌리기용) / 바꾼 뒤 표시
  function snapshot() {
    ED.hist.push(JSON.stringify({ els: ED.els, bg: ED.bg }));
    if (ED.hist.length > MAX_HISTORY) ED.hist.shift();
  }
  function changedNow(redraw = true) {
    ED.dirty = true;
    try {
      localStorage.setItem(`sbDraft:${ED.page.id}`, JSON.stringify({ rev: ED.page.revision, els: ED.els.map(toRow), title: ED.title, bg: ED.bg, at: Date.now() }));
    } catch { /* 저장 공간 부족 등 */ }
    if (redraw) { drawCanvas(); drawTools(); }
    status();
  }
  function undo() {
    const last = ED.hist.pop();
    if (!last) return;
    const s = JSON.parse(last);
    ED.els = s.els;
    ED.bg = s.bg;
    if (!selEl()) ED.sel = null;
    changedNow();
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
  function onDown(ev) {
    const handle = ev.target.closest('[data-h]');
    const node = handle ? $(`#sbEditor .sb-el[data-id="${ED.sel}"]`) : ev.target.closest('.sb-el');
    if (!node) { if (ED.sel && ev.target.closest('.sb-canvas')) select(null); return; }
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
    drag.node.style.cssText = elStyle(e);
    const box = $('#sbEditor .sb-selbox');
    if (box) box.style.cssText = selStyle(e);
    if (e.type === 'STICKER' && !e.content.shape) {
      const st = $('.sb-sticker', drag.node);
      if (st) st.style.fontSize = `${Math.round(Math.min(e.width, e.height) * 0.86)}px`;
    }
  }
  function onUp(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    const was = drag;
    drag = null;
    if (was.moved) changedNow();
  }

  function onKey(ev) {
    if (!ED || $('#sheet').classList.contains('open')) return;
    if (ev.target.matches('input, textarea')) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); return; }
    if (ev.key === 'Escape') { if (ED.sel) select(null); else closeEditor(); return; }
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
    if (name === 'frame') return pickFrame(e);
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
        <div class="field"><span>색</span><div class="swatches">${COLORS.map((col) => `<label><input type="radio" name="color" value="${col}" ${(c.color || COLORS[0]) === col ? 'checked' : ''}><span style="background:${col}" aria-label="${col}"></span></label>`).join('')}</div></div>
        <button class="primary" type="submit">적용</button>
      </form>`);
    const f = $('#txForm', body);
    f.size.oninput = () => { $('#szv', body).textContent = f.size.value; };
    f.onsubmit = (ev) => {
      ev.preventDefault();
      snapshot();
      e.content = { ...c, text: f.text.value.slice(0, 300), size: Number(f.size.value), font: f.font.value, align: f.align.value, color: f.color.value };
      // 글이 길어지면 상자 높이를 늘려 줌
      const lines = Math.max(1, Math.ceil((e.content.text.length * e.content.size * 0.9) / e.width)) + (e.content.text.match(/\n/g) || []).length;
      e.height = Math.max(e.height, Math.min(1200, lines * e.content.size * 1.35));
      closeSheet();
      changedNow();
    };
    setTimeout(() => f.text.focus(), 250);
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
    const body = openSheet(`<h2>스티커</h2>
      <div class="sticker-grid">${STICKERS.map((s) => `<button type="button" data-st="${s}" aria-label="스티커 ${s}">${s}</button>`).join('')}</div>
      <h3 style="margin:16px 0 8px">마스킹테이프</h3>
      <div class="sticker-grid">${TAPES.map((c) => `<button type="button" data-tape="${c}" aria-label="테이프"><i class="tape-chip" style="background:${c}"></i></button>`).join('')}</div>`);
    body.onclick = (ev) => {
      const s = ev.target.closest('[data-st]');
      const t = ev.target.closest('[data-tape]');
      if (s) { closeSheet(); addEl({ type: 'STICKER', ...centerSpot(140, 140), width: 140, height: 140, content: { sticker: s.dataset.st } }); }
      if (t) { closeSheet(); addEl({ type: 'STICKER', ...centerSpot(260, 60), width: 260, height: 60, rotation: -8, content: { shape: 'tape', color: t.dataset.tape } }); }
    };
  }

  function pickBg() {
    const body = openSheet(`<h2>배경</h2><div class="bg-grid">${Object.entries(BGS).map(([k, l]) => `<button type="button" data-bg="${k}" class="${ED.bg === k ? 'on' : ''}"><i class="sb-canvas bg-${k}"></i>${l}</button>`).join('')}</div>`);
    body.onclick = (ev) => {
      const b = ev.target.closest('[data-bg]');
      if (!b) return;
      snapshot();
      ED.bg = b.dataset.bg;
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
        : '<div class="empty small">이 기록장에 올린 사진이 아직 없어요</div>'}
      <div class="sticky-actions"><button class="primary" id="phAdd" disabled>사진 넣기</button></div>`);
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
        closeSheet();
        snapshot();
        for (const p of list) {
          const a = await aspectOf(p.thumb);
          const w = 420;
          ED.els.push({ id: uuid(), type: 'IMAGE', ...centerSpot(w, w * a), width: w, height: Math.round(w * a), rotation: 0, zIndex: topZ(), photoId: p.id, content: { frame: 'tape', alt: p.placeName } });
        }
        ED.sel = ED.els.at(-1)?.id || null;
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
          toast('사진을 올렸어요. 저장을 눌러야 페이지에 남아요');
        }
      } catch (err) { toast(err.message); } finally { ED.saving = false; status(); }
    };
  }

  // ---------- 저장 ----------
  async function save() {
    if (!ED || ED.saving) return;
    if (!navigator.onLine) return toast('오프라인이에요. 편집 내용은 이 기기에 임시로 남아 있어요');
    ED.saving = true;
    status();
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
      ED.page.revision = r.revision;
      S.els.set(ED.page.id, ED.els.map((e) => structuredClone(e)));
      if (r.orphan_paths?.length) removeFiles(r.orphan_paths).catch(() => {}); // 남이 올린 사진은 권한상 못 지울 수 있음
      ED.uploaded.clear();
      ED.dirty = false;
      localStorage.removeItem(`sbDraft:${ED.page.id}`);
      toast('저장했어요');
    } catch (err) {
      if (err.code === 'PT409') conflict(err.message);
      else toast(`${err.message} · 편집 내용은 이 기기에 임시로 남아 있어요`);
    } finally {
      if (ED) { ED.saving = false; status(); }
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

  function closeEditor(force = false) {
    if (!ED) return;
    if (!force && ED.dirty && !confirm('저장하지 않은 편집이 있어요. 닫을까요?\n(이 기기에는 임시로 남아서 다음에 이어서 고칠 수 있어요)')) return;
    // 올리고 저장하지 않은 사진: 임시 편집(이 기기)에서 아직 쓰므로 남겨 둠. 편집을 버리면(다시 불러오기) 지움
    if (force && ED.uploaded.size) removeFiles([...ED.uploaded]).catch(() => {});
    $('#sbEditor').classList.add('hidden');
    $('#sbEditor').innerHTML = '';
    document.body.classList.remove('sb-open');
    ED = null;
    drag = null;
    render();
  }

  function bindEditor() {
    const box = $('#sbEditor');
    box.addEventListener('pointerdown', (ev) => { if (ED && ev.target.closest('.sb-wrap')) onDown(ev); });
    box.addEventListener('pointermove', (ev) => { if (ED) onMove(ev); });
    box.addEventListener('pointerup', (ev) => { if (ED) onUp(ev); });
    box.addEventListener('pointercancel', (ev) => { if (ED && drag) { onUp(ev); } });
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
      if (ed === 'close') return closeEditor();
      if (ed === 'undo') return undo();
      if (ed === 'export') { // 화면에 보이는 그대로 (저장 전 편집도 포함)
        ED.title = $('#sbEditor .sb-title').value.trim() || ED.page.title;
        return exportPage({ ...ED.page, title: ED.title }, ED.els, ED.bg);
      }
      if (ed === 'save') return save();
      const add = ev.target.closest('[data-add]')?.dataset.add;
      if (add === 'photo') return pickPhotos();
      if (add === 'text') return addText();
      if (add === 'sticker') return pickSticker();
      if (add === 'bg') return pickBg();
      const tl = ev.target.closest('[data-tool]')?.dataset.tool;
      if (tl) tool(tl);
    });
    box.addEventListener('input', (ev) => {
      if (ED && ev.target.matches('.sb-title')) { ED.title = ev.target.value; ED.dirty = true; status(); }
    });
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', () => { if (ED) { layout(); drawCanvas(); } });
    window.addEventListener('beforeunload', (ev) => { if (ED?.dirty) { ev.preventDefault(); ev.returnValue = ''; } });
  }

  // ---------- 연결 ----------
  bind();
  bindEditor();
  bindStory();
  window.addEventListener('travel:view', (e) => { if (e.detail === 'scrap') load(); });
  window.addEventListener('travel:refresh', () => { if (state.view === 'scrap' && !ED) load(true); else if (state.view !== 'scrap') S.loadedFor = null; });
})();
