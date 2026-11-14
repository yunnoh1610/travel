// 스토어 앱(Capacitor) 아이콘·시작 화면 원본 만들기 — 실행: node brand/tools/make_app_assets.mjs
// brand/symbol · brand/lockup 의 SVG 로 assets/ 에 1024·2732 PNG 를 만들고,
// 그다음  npx capacitor-assets generate  가 안드로이드·iOS 크기별 아이콘과 시작 화면을 만들어요.
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const brand = (p) => readFileSync(path.join(root, 'brand', p));
const out = (p) => path.join(root, 'assets', p);
mkdirSync(path.join(root, 'assets'), { recursive: true });

const LAVENDER = '#9276CE';
const CREAM = '#FFF8EB';
const NIGHT = '#231D33';

// 1) 아이콘 (iOS·안드로이드 기본): 꽉 찬 사각형(모서리는 OS 가 둥글게) — 그림이 가운데 78%
await sharp(brand('symbol/app-icon-maskable.svg'), { density: 300 }).resize(1024, 1024).flatten({ background: LAVENDER }).png().toFile(out('icon-only.png'));

// 2) 안드로이드 적응형 아이콘: 앞(심볼, 안전 영역 66% 안쪽) + 뒤(라벤더)
const markPng = await sharp(brand('symbol/mark.svg'), { density: 400 }).resize({ height: 600 }).png().toBuffer();
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: markPng, gravity: 'center' }]).png().toFile(out('icon-foreground.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: LAVENDER } }).png().toFile(out('icon-background.png'));

// 3) 시작 화면: 크림 바탕 + 세로형 로고 (어두운 모드는 밤색 바탕 + 어두운 로고)
async function splash(file, svg, bg) {
  const logo = await sharp(brand(svg), { density: 400 }).resize({ width: 900 }).png().toBuffer();
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: bg } })
    .composite([{ input: logo, gravity: 'center' }]).flatten({ background: bg }).png().toFile(out(file));
}
await splash('splash.png', 'lockup/moalog-stacked.svg', CREAM);
await splash('splash-dark.png', 'lockup/moalog-stacked-dark.svg', NIGHT);
console.log('assets/ 에 icon-only · icon-foreground · icon-background · splash · splash-dark 를 만들었어요');
