# 브랜드 에셋 생성기 — 실행: pip install fonttools pymupdf  →  python brand/tools/make_brand.py
#: 심볼·앱 아이콘·파비콘·워드마크·조합형 로고(SVG) + PNG/ICO
import io, os, struct
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
import pymupdf as fitz

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
# 고운돋움(SIL OFL): https://github.com/google/fonts/raw/main/ofl/gowundodum/GowunDodum-Regular.ttf 를 받아 같은 폴더에 두세요
FONT = os.environ.get('BRAND_FONT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'GowunDodum-Regular.ttf')
for d in ['', 'symbol', 'wordmark', 'lockup', 'png']:
    os.makedirs(os.path.join(OUT, d), exist_ok=True)

C = {
    'lavender': '#9276CE', 'lavender_d': '#7A5FBE', 'lavender_l': '#B9A6E6', 'plum': '#3B2F5C', 'night': '#231D33',
    'cream': '#FFF8EB', 'cream_d': '#F1E3C8', 'coral': '#F4A9A8', 'coral_d': '#E8807E', 'sage': '#A8CBB9', 'sage_d': '#7FAF97',
}

# ---------- 심볼 (512 기준) ----------
def notebook(detail=True):
    """크림색 노트(스프링) + 사진 한 장. detail=False 면 아주 작은 크기용 (사진 대신 굵은 줄)"""
    rings = ''.join(f'<rect x="126" y="{y}" width="40" height="18" rx="9" fill="{C["plum"]}"/>' for y in ([168, 228, 288, 348] if detail else [190, 300]))
    holes = ''.join(f'<circle cx="160" cy="{y + 9}" r="7" fill="{C["cream_d"]}"/>' for y in ([168, 228, 288, 348] if detail else []))
    page = f'''<rect x="146" y="118" width="244" height="290" rx="34" fill="{C["cream_d"]}" transform="translate(10 10)"/>
      <rect x="146" y="118" width="244" height="290" rx="34" fill="{C["cream"]}"/>'''
    if detail:
        photo = f'''<g>
        <clipPath id="ph"><rect x="186" y="156" width="170" height="128" rx="18"/></clipPath>
        <g clip-path="url(#ph)">
          <rect x="186" y="156" width="170" height="128" fill="#DCEFE6"/>
          <circle cx="312" cy="196" r="20" fill="{C["coral"]}"/>
          <path d="M186 284 L240 222 Q250 211 260 222 L292 258 L312 238 Q322 228 332 238 L356 262 V284 Z" fill="{C["sage_d"]}"/>
        </g></g>
        <rect x="186" y="310" width="120" height="14" rx="7" fill="{C["lavender_l"]}"/>
        <rect x="186" y="342" width="84" height="14" rx="7" fill="{C["lavender_l"]}"/>'''
    else:
        photo = f'''<rect x="190" y="170" width="160" height="110" rx="22" fill="{C["sage"]}"/>'''
    return f'<g transform="rotate(-6 268 263)">{page}{photo}{rings}{holes}</g>'

def pin(cx=356, cy=360, s=1.0, ring=True):
    """지도 핀 (끝이 아래). 흰 테두리로 노트 위에서도 또렷하게"""
    d = 'M0 -78 C-43 -78 -72 -47 -72 -8 C-72 38 -12 84 -3 92 Q0 95 3 92 C12 84 72 38 72 -8 C72 -47 43 -78 0 -78 Z'
    return f'''<g transform="translate({cx} {cy}) scale({s})">
      {f'<path d="{d}" fill="#ffffff" stroke="#ffffff" stroke-width="22" stroke-linejoin="round"/>' if ring else ''}
      <path d="{d}" fill="{C["coral_d"]}"/>
      <circle cx="0" cy="-10" r="26" fill="#ffffff"/>
    </g>'''

def bg(dark=False, rx=116):
    # 단색 + 왼쪽 위 은은한 빛 (그라데이션 없이: 어떤 변환기·앱에서도 똑같이 보이게)
    base = '#2C2440' if dark else C['lavender']
    glow = '#ffffff' if not dark else '#9276CE'
    op = '.14' if not dark else '.22'
    return (f'<rect width="512" height="512" rx="{rx}" fill="{base}"/>'
            f'<path d="M0 {rx} Q0 0 {rx} 0 H380 Q230 50 150 150 Q70 250 0 400 Z" fill="{glow}" opacity="{op}"/>' if rx else
            f'<rect width="512" height="512" fill="{base}"/><path d="M0 0 H380 Q230 50 150 150 Q70 250 0 400 Z" fill="{glow}" opacity="{op}"/>')

def svg(w, h, body, title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n'

def app_icon(dark=False, rx=116, scale=1.0):
    inner = f'{notebook(True)}{pin()}'
    if scale != 1.0:
        inner = f'<g transform="translate({256 - 256 * scale} {256 - 256 * scale}) scale({scale})">{inner}</g>'
    return svg(512, 512, bg(dark, rx) + inner, '앱 아이콘')

def favicon():
    # 16~32px 용: 사진 대신 단색 면, 스프링 2개, 핀 크게
    return svg(512, 512, bg(False, 120) + notebook(False) + pin(352, 352, 1.12), '파비콘')

def mark(mono=None):
    """배경 없는 심볼 (조합형 로고·문서용). mono 색을 주면 한 가지 색"""
    body = f'{notebook(True)}{pin()}'
    if mono:
        body = f'''<g transform="rotate(-6 268 263)"><rect x="146" y="118" width="244" height="290" rx="34" fill="none" stroke="{mono}" stroke-width="18"/>
          <rect x="186" y="156" width="170" height="128" rx="18" fill="none" stroke="{mono}" stroke-width="14"/>
          <rect x="186" y="314" width="120" height="14" rx="7" fill="{mono}"/>
          {''.join(f'<rect x="126" y="{y}" width="40" height="18" rx="9" fill="{mono}"/>' for y in [168, 228, 288, 348])}</g>
          <g transform="translate(356 360)"><path d="M0 -78 C-43 -78 -72 -47 -72 -8 C-72 38 -12 84 -3 92 Q0 95 3 92 C12 84 72 38 72 -8 C72 -47 43 -78 0 -78 Z" fill="{mono}"/>
          <circle cx="0" cy="-10" r="26" fill="{'#231D33' if mono != '#231D33' else '#ffffff'}"/></g>'''
    # 그림이 들어가는 범위로 viewBox 를 줄여서 여백 최소화
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 92 350 372" width="350" height="372" role="img" aria-label="심볼"><title>심볼</title>{body}</svg>\n'

# ---------- 글자 → 윤곽선 (폰트 없이도 똑같이 보이게) ----------
font = TTFont(FONT)
gs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font['head'].unitsPerEm

def text_path(text, size, x, y, track=0.0):
    """(path d, 너비) — y 는 글자 기준선"""
    k = size / upm
    ds = []
    cx = 0
    for ch in text:
        g = cmap.get(ord(ch))
        if g is None:
            raise SystemExit(f'글꼴에 없는 글자: {ch}')
        pen = SVGPathPen(gs)
        tp = TransformPen(pen, (k, 0, 0, -k, x + cx, y))
        gs[g].draw(tp)
        ds.append(pen.getCommands())
        cx += gs[g].width * k + track * size
    return ' '.join(ds), cx - track * size

NAMES = {
    'yeohaengnote': ('여행노트', 'TRAVEL NOTE', '함께 계획하고, 기록하고, 꾸미는 우리의 여행 노트'),
    'moalog': ('모아로그', 'MOALOG', '함께 모으는 우리의 기록'),
    'momentrip': ('모먼트립', 'MOMENTRIP', '여행의 순간을 한 장씩'),
}
BOLD = 0.045  # 고운돋움에 같은 색 테두리를 둘러 조금 굵게 (부드러운 라운드 느낌 유지)

def word(text, size, x, y, color, track=0.0, bold=BOLD):
    d, w = text_path(text, size, x, y, track)
    sw = size * bold
    return f'<path d="{d}" fill="{color}" stroke="{color}" stroke-width="{sw:.1f}" stroke-linejoin="round"/>', w

def wordmark_ko(slug, dark=False):
    ko, en, _ = NAMES[slug]
    col = C['cream'] if dark else C['plum']
    p, w = word(ko, 120, 10, 128, col, -0.02)
    # 마지막 글자 아래 코랄 밑줄(스티커 테이프 느낌)
    acc = f'<rect x="{10 + w * 0.52:.0f}" y="146" width="{w * 0.46:.0f}" height="16" rx="8" fill="{C["coral"]}" opacity=".9"/>'
    W = int(w + 24)
    return svg(W, 172, acc + p, f'{ko} 워드마크'), W

def wordmark_en(slug, dark=False):
    ko, en, _ = NAMES[slug]
    col = C['cream'] if dark else C['lavender_d']
    p, w = word(en, 64, 6, 70, col, 0.16, 0.03)
    W = int(w + 16)
    return svg(W, 92, p, f'{en} 워드마크'), W

def lockup(slug, dark=False, stacked=False):
    ko, en, tag = NAMES[slug]
    tcol = C['cream'] if dark else C['plum']
    ecol = C['lavender_l'] if dark else C['lavender_d']
    icon = app_icon(dark=False).split('>', 1)[1].rsplit('</svg>', 1)[0]  # 내용만
    icon = icon.replace('<title>앱 아이콘</title>', '')
    if not stacked:
        kp, kw = word(ko, 132, 0, 0, tcol, -0.02)
        ep, ew = word(en, 46, 0, 0, ecol, 0.2, 0.03)
        x0 = 236
        body = (f'<g transform="scale(0.40625)">{icon}</g>'
                f'<g transform="translate({x0} 132)">{kp}</g>'
                f'<g transform="translate({x0 + 4} 194)">{ep}</g>')
        W = int(x0 + max(kw, ew) + 20)
        return svg(W, 208, body, f'{ko} 로고'), W
    kp, kw = word(ko, 112, 0, 0, tcol, -0.02)
    ep, ew = word(en, 40, 0, 0, ecol, 0.2, 0.03)
    W = int(max(kw, ew, 220) + 40)
    body = (f'<g transform="translate({(W - 220) / 2:.0f} 0) scale(0.4296875)">{icon}</g>'
            f'<g transform="translate({(W - kw) / 2:.0f} 352)">{kp}</g>'
            f'<g transform="translate({(W - ew) / 2:.0f} 412)">{ep}</g>')
    return svg(W, 432, body, f'{ko} 로고 (세로)'), W

def save(path, text):
    io.open(os.path.join(OUT, path), 'w', encoding='utf-8', newline='\n').write(text)

save('symbol/app-icon.svg', app_icon())
save('symbol/app-icon-dark.svg', app_icon(dark=True))
save('symbol/app-icon-maskable.svg', app_icon(rx=0, scale=0.78))
save('symbol/favicon.svg', favicon())
save('symbol/mark.svg', mark())
save('symbol/mark-mono-plum.svg', mark('#3B2F5C'))
save('symbol/mark-mono-white.svg', mark('#ffffff'))
sizes = {}
for slug in NAMES:
    for dark in (False, True):
        sfx = '-dark' if dark else ''
        t, w = wordmark_ko(slug, dark); save(f'wordmark/{slug}-ko{sfx}.svg', t)
        t, w = wordmark_en(slug, dark); save(f'wordmark/{slug}-en{sfx}.svg', t)
        t, w = lockup(slug, dark); save(f'lockup/{slug}-horizontal{sfx}.svg', t); sizes[(slug, dark, 'h')] = w
        t, w = lockup(slug, dark, True); save(f'lockup/{slug}-stacked{sfx}.svg', t)

# ---------- PNG · ICO ----------
def png(svg_path, out, px, alpha=True):
    data = io.open(os.path.join(OUT, svg_path), 'rb').read()
    doc = fitz.open(stream=data, filetype='svg')
    page = doc[0]
    z = px / page.rect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(z, z), alpha=alpha)
    pix.save(os.path.join(OUT, out))
    return os.path.join(OUT, out)

png('symbol/app-icon.svg', 'png/icon-512.png', 512)
png('symbol/app-icon.svg', 'png/icon-192.png', 192)
png('symbol/app-icon-maskable.svg', 'png/icon-maskable-512.png', 512, alpha=False)
png('symbol/app-icon-maskable.svg', 'png/apple-touch-icon.png', 180, alpha=False)
png('symbol/app-icon-dark.svg', 'png/icon-dark-512.png', 512)
for n in (16, 32, 48):
    png('symbol/favicon.svg', f'png/favicon-{n}.png', n)
# favicon.ico (PNG 를 담은 ICO)
imgs = [io.open(os.path.join(OUT, f'png/favicon-{n}.png'), 'rb').read() for n in (16, 32, 48)]
hdr = struct.pack('<HHH', 0, 1, len(imgs))
off = 6 + 16 * len(imgs)
ent = b''
for n, b in zip((16, 32, 48), imgs):
    ent += struct.pack('<BBBBHHII', n, n, 0, 0, 1, 32, len(b), off)
    off += len(b)
io.open(os.path.join(OUT, 'png/favicon.ico'), 'wb').write(hdr + ent + b''.join(imgs))
print('done', sizes)
