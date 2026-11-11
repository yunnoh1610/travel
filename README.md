# ✈️ 여행 기록

여러 명이 함께 쓰는 여행 기록 웹앱이에요. 폰 브라우저에 맞춰 만들었어요.

👉 **https://yunnoh1610.github.io/travel/**

## 지금 운영 방식: GitHub Pages + Supabase (무료, PC 꺼도 접속됨)

| 폴더/파일 | 내용 |
| --- | --- |
| `docs/` | 웹사이트 (GitHub Pages가 이 폴더를 그대로 보여줘요) |
| `docs/config.js` | Supabase 주소와 공개(publishable) 키 |
| `supabase/schema.sql` | DB 테이블·권한·사진 저장소 설정 (Supabase SQL Editor에서 실행) |
| `.github/workflows/keepalive.yml` | 3일마다 Supabase를 깨워서 1주일 미사용 일시정지를 막음 |
| [SUPABASE_SETUP.md](SUPABASE_SETUP.md) | 처음 설정하는 순서 |

- 로그인은 이메일 + 비밀번호. 비밀번호를 잊으면 로그인 화면의 "비밀번호를 잊었어요"로 재설정 메일을 받아요
- 데이터는 Supabase의 권한 규칙(RLS)으로 보호돼요: 같은 여행 멤버만 보고, 쓴 사람·여행 만든 사람만 고치거나 지워요
- 무료 한도: 사진 저장 1GB(줄인 사진 기준 약 3,000장), DB 500MB, 한 달 전송량 5GB

> 아래부터는 예전 방식(PC에서 Node 서버 + Cloudflare 터널)의 설명이에요. `server.js`, `public/`, `deploy/`가 그 코드예요.

## 기능

- 여행을 만들고 **초대 링크**(7일 유효)를 카톡 등으로 보내면, 친구가 누르고 가입하는 즉시 같은 여행에 들어와요
- 여행을 만든 사람은 초대 링크를 새로 만들어 예전 링크를 못 쓰게 할 수 있어요
- 내 정보(오른쪽 위 동그라미)에서 비밀번호를 바꿀 수 있어요. 바꾸면 다른 기기에서는 로그아웃돼요
- 장소마다 지도 핀, 한줄 코멘트(80자), 사진, 날짜, 종류(관광/맛집/카페/숙소/자연/기타)를 남겨요
- 사진은 **폰에서 줄인 뒤** 올라가요 (긴 변 1600px JPEG + 480px 썸네일. 보통 3~5MB가 300KB 안팎으로 줄어요)
- 사진에 위치·날짜(EXIF)가 있으면 지도 위치, 장소 이름, 날짜를 자동으로 채워요. 올라가는 파일에서는 위치 정보가 빠져요
- 장소 이름 검색은 OpenStreetMap을 써요
- 지도 / 타임라인 / 여행 탭. 여행 하나를 고르면 방문 순서대로 번호와 경로 선이 보여요
- 사진은 같은 여행 멤버만 볼 수 있어요

## 실행

Node.js 22.13 이상이 필요해요 (내장 SQLite 사용).

```bash
npm install
npm start
```

http://localhost:3000 에서 열려요. 데이터는 `data/` 폴더(`travel.db`, `uploads/`)에 저장돼요.

## 폰에서 쓰려면

- **같은 와이파이에서 테스트**: PC의 IP로 접속하면 돼요 (예: `http://192.168.0.10:3000`). 다만 http에서는 "지금 있는 위치 사용"이 동작하지 않아요.
- **초대 링크는 지금 접속한 주소로 만들어져요.** `localhost`로 열어서 만든 링크는 친구 폰에서 안 열려요. PC의 IP 주소나 배포한 주소로 접속한 뒤 만드세요.
- **실제로 친구들과 쓰기**: https가 되는 서버에 올려야 해요. Render, Railway, Fly.io처럼 **디스크가 유지되는** 곳을 고르고, `DATA_DIR`를 그 디스크 경로로 지정하세요. 배포할 때는 `NODE_ENV=production`을 설정하세요 (로그인 쿠키를 https 전용으로 바꿔요).
- 폰 브라우저 메뉴에서 "홈 화면에 추가"를 하면 앱처럼 쓸 수 있어요.

## 내 PC에서 인터넷에 공개하기 (무료, Cloudflare 임시 터널)

```powershell
powershell -ExecutionPolicy Bypass -File deploy\start-tunnel.ps1
```

- 화면에 나오는 `https://....trycloudflare.com` 주소로 누구나 접속할 수 있어요. https라서 "지금 있는 위치 사용"도 돼요.
- 이 창이 켜져 있고 PC가 깨어 있는 동안만 접속돼요. 실행 중에는 PC가 절전모드로 가지 않게 막아요. 끄려면 그 창에서 Ctrl+C.
- **켤 때마다 주소가 바뀌어요.** 다시 켜면 새 주소로 초대 링크를 다시 만들어 보내 주세요. 지금 주소는 `data\public-url.txt`에도 적혀 있어요.
- **앱을 고친 뒤 반영할 때는 주소를 유지한 채** 앱 서버만 다시 켤 수 있어요:
  ```powershell
  powershell -ExecutionPolicy Bypass -File deploy\restart-app.ps1
  ```
  앱 서버가 오류로 꺼져도 start-tunnel 창이 자동으로 다시 켜요.
- 서버 로그는 `data\server.log`, `data\server-error.log`, 터널 로그는 `data\tunnel.log`에 남아요.
- 계정과 사진은 PC의 `data` 폴더에 있어요. 나중에 서버로 옮길 때 이 폴더만 옮기면 돼요.

## 운영 배포 (오라클 무료 서버)

[DEPLOY.md](DEPLOY.md)를 보세요. 서버를 만든 뒤에는 명령 한 번으로 설치와 업데이트가 돼요.

```powershell
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -ServerIp <서버 IP>
```

## 환경 변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | 3000 | 서버 포트 |
| `DATA_DIR` | `./data` | DB와 사진 저장 위치 |
| `NODE_ENV` | | `production`이면 쿠키에 Secure 적용, 프록시 뒤 실제 IP 사용 |
| `HOST` | (모든 주소) | `127.0.0.1`이면 서버 안에서만 접속 가능 |
| `TRUST_PROXY` | 운영 1 / 개발 0 | 앞단 프록시 개수 |
