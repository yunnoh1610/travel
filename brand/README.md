# 브랜드 에셋 (1차 시안)

`guide.html` 을 브라우저로 열면 이름 후보 비교, 심볼, 작은 크기 확인, 색·글꼴 가이드를 한눈에 볼 수 있어요.

| 폴더 | 내용 |
| --- | --- |
| `symbol/` | 앱 아이콘(밝은·어두운·maskable), 심볼만, 한 색 버전, 파비콘 — SVG 원본 |
| `wordmark/` | 이름 후보별 한글·영문 워드마크 (밝은·어두운) |
| `lockup/` | 심볼 + 워드마크 조합형 (가로·세로, 밝은·어두운) |
| `png/` | PWA 아이콘 192·512·maskable, iOS `apple-touch-icon`, `favicon.ico`·PNG |
| `tools/make_brand.py` | 위 파일을 다시 만드는 스크립트 (색·모양을 바꿔 다시 실행) |

- 이름: `yeohaengnote` = 여행노트 · `moalog` = 모아로그 · `momentrip` = 모먼트립
- 워드마크 글꼴: 고운돋움 (SIL Open Font License 1.1) — 글자를 윤곽선으로 바꿔 넣어서 글꼴이 없어도 똑같이 보여요
- 상표·도메인·앱스토어 이름 중복은 최종 확정 전에 따로 확인해 주세요
