# 📱 스토어 앱 만들기 (Capacitor) — 안드로이드 · 아이폰

모아로그 웹 화면(`docs/`)을 그대로 앱 안에 넣어서 Google Play · App Store 에 올리는 방식이에요.
웹사이트(GitHub Pages)는 그대로 계속 쓰고, 앱은 `docs/` 를 고친 뒤 **`npm run app:sync`** 로 앱에 다시 복사해요.

| 항목 | 값 |
|---|---|
| 앱 ID (번들 ID · 패키지 이름) | `com.moalog.app` — **스토어에 처음 올리기 전까지만 바꿀 수 있어요** (`capacitor.config.json` 의 `appId` + 안드로이드 `android/app/build.gradle` 의 `applicationId`·`namespace`, iOS 는 Xcode 의 Bundle Identifier) |
| 앱 이름 | 모아로그 |
| 화면 파일 | `docs/` (앱을 만들 때 복사돼요. 서버는 지금과 같은 Supabase) |
| 아이콘·시작 화면 원본 | `assets/` (만들기: `npm run app:icons`) |

## 폴더

- `capacitor.config.json` — 앱 ID·이름·화면 폴더
- `android/` — 안드로이드 스튜디오 프로젝트 (권한: 인터넷 · 위치 · 카메라 · 사진 촬영 위치 읽기)
- `ios/` — Xcode 프로젝트 (권한 안내 문구: 카메라 · 사진 보관함 · 위치, `ios/App/App/Info.plist`)
- `assets/` — 1024·2732 원본 그림 → `brand/tools/make_app_assets.mjs` 가 브랜드 SVG 로 만들어요

## 명령

```bash
npm run app:sync      # docs/ 를 고친 뒤 앱 두 개에 복사
npm run app:android   # 복사 + 안드로이드 스튜디오 열기
npm run app:ios       # 복사 + Xcode 열기 (Mac 에서)
npm run app:icons     # 아이콘·시작 화면 다시 만들기
```

## 안드로이드 (Windows 에서 가능)

1. **Android Studio** 설치 (https://developer.android.com/studio) — 처음 열 때 SDK·JDK 21 을 같이 설치해요
   (지금 PC 에는 Java 11 만 있어서, 안드로이드 스튜디오에 들어 있는 JDK 를 쓰면 돼요)
2. `npm run app:android` → 안드로이드 스튜디오가 열리면 위쪽 ▶ 로 에뮬레이터나 USB 로 연결한 휴대폰에서 실행
3. 확인할 것 (아래 "휴대폰에서 꼭 확인" 참고)
4. 스토어용 파일: **Build → Generate Signed App Bundle → Android App Bundle (.aab)**
   - 이때 만드는 **업로드 키(keystore)와 비밀번호는 꼭 따로 백업**하세요 (Git 에 올리지 마세요)
5. Play Console → 앱 만들기 → **비공개 테스트**(테스터 12명 · 14일) → 프로덕션

## 아이폰 (Mac 필요)

1. Mac 에 Xcode 설치, 이 저장소를 받아서 `npm install` → `npm run app:ios`
2. Xcode → App 타깃 → Signing & Capabilities → 내 Apple Developer 팀 선택 (번들 ID `com.moalog.app`)
3. 아이폰을 연결해서 ▶ 실행 → 확인
4. Product → Archive → App Store Connect 로 업로드 → TestFlight → 심사 제출
   - 심사 메모에 **테스트 계정 아이디·비밀번호**를 꼭 적어 주세요 (로그인해야 쓰는 앱)

## 아이폰 (맥 없이) — Codemagic 클라우드 빌드 → TestFlight

설정 파일: 저장소 맨 위 `codemagic.yaml` (워크플로 이름: **모아로그 iOS → TestFlight**)

1. ✅ Apple Developer Program 가입 (아이폰의 Apple Developer 앱으로 가능)
2. ✅ developer.apple.com → Identifiers 에 App ID `com.moalog.app` 등록 (Capabilities 체크 없음)
3. ✅ App Store Connect → 앱 → ＋ 새로운 앱 (iOS · 모아로그 · 한국어 · `com.moalog.app` · SKU `moalog`)
4. App Store Connect → 사용자 및 액세스 → 통합 → App Store Connect API → **키 생성** (액세스: App Manager)
   - `.p8` 파일은 한 번만 받을 수 있어요 → 안전한 곳에 보관 (Git·채팅에 올리지 않기)
   - **Issuer ID** 와 **키 ID** 도 적어 두기
5. https://codemagic.io → GitHub 로 가입 → **Add application** → `yunnoh1610/travel` → 프로젝트 종류 **Capacitor** (또는 Other) 
6. Codemagic → **Team settings → Integrations → Developer Portal → Connect** → 이름 **`moalog-asc`**, Issuer ID · 키 ID · `.p8` 파일
7. (선택) 앱 → Environment variables → `APP_STORE_APPLE_ID` = App Store Connect → 앱 정보 → **Apple ID**(숫자)
8. 앱 화면에서 **Start new build** → 브랜치 `main`, 워크플로 **모아로그 iOS → TestFlight** → 15~25분
   - 서명 인증서·프로필은 처음 빌드 때 자동으로 만들어져요
9. 빌드가 끝나면 App Store Connect → TestFlight 에서 "처리 중" → 10~30분 뒤 사용 가능
   - TestFlight → **내부 테스팅** 그룹을 만들고 내 Apple ID 를 테스터로 추가
10. 아이폰에 **TestFlight** 앱 설치 → 모아로그 **설치**

새 버전: `docs/` 를 고쳐서 main 에 푸시한 뒤 Codemagic 에서 Start new build (자동으로는 안 돌아요 — 무료 시간 아끼기, 한 달 500분)

## 바깥 서비스 설정 (사용자가 직접)

- **카카오 개발자 콘솔** → 내 애플리케이션 → 플랫폼 → Web 사이트 도메인에 추가:
  `https://localhost` (안드로이드 앱) · `capacitor://localhost` (아이폰 앱)
  — 등록이 안 되거나 막히면 장소 검색이 OpenStreetMap 으로 바뀌어서 동작은 해요 (한국 장소는 덜 정확)
- **Supabase** → Authentication → URL Configuration → Redirect URLs 에 `https://localhost`, `capacitor://localhost` 추가
  (아이디·비밀번호 로그인은 그대로 되지만, 메일 링크로 돌아오는 기능을 쓸 때 필요)

## 휴대폰에서 꼭 확인

- [ ] 로그인 → 껐다 켜도 로그인 유지
- [ ] 위쪽 시계·배터리 줄, 아래 제스처 줄에 화면이 가려지지 않는지
- [ ] 지도(타일·마커), 카카오 장소 검색
- [ ] 📷 사진 고르기·카메라로 찍기, **사진으로 한꺼번에 기록**에서 촬영 위치가 읽히는지
      (안드로이드 사진 선택 창은 위치를 지울 수 있어요 → 안 되면 알려 주세요, 네이티브 사진 플러그인으로 바꿔요)
- [ ] 📍 지금 위치로 기록 (위치 권한 묻는 창)
- [ ] 🗺️ 길찾기 → 카카오맵 앱·브라우저로 열리는지, 뒤로 가기로 앱에 돌아오는지
- [ ] 초대 링크 공유 → 받은 사람에게 웹사이트 주소(https://yunnoh1610.github.io/travel/?invite=…)로 가는지
- [ ] 안드로이드 뒤로 가기 버튼 (열린 창 닫기)
- [ ] AI 일정·일기 (Supabase Edge Function 호출)

## 앱에서만 다른 점 (코드)

- `docs/app.js` — 앱 안에서는 `IS_APP` 이 true, `<html class="native-app">`. 초대 링크 같은 밖으로 보내는 주소는 웹사이트 주소(`CFG.publicUrl` 또는 GitHub Pages 주소)
- `docs/app.css` — 화면 위·아래 안전 영역은 안드로이드 앱이 넣어 주는 `--safe-area-inset-*` 를 먼저 써요

## 스토어에 올리기 전에 남은 일

- 개인정보처리방침 페이지 · 계정 삭제 안내 페이지 (스토어 입력에 주소 필요)
- AI 기능 첫 사용 때 "OpenAI 로 보내져요" 안내·동의 (애플 개인정보 규정)
- 지도 타일: OpenStreetMap 기본 타일은 앱처럼 많이 쓰는 용도를 허용하지 않아요 → 출시 전에 다른 타일 제공자 검토
- 스토어 스크린샷 · 설명 문구
