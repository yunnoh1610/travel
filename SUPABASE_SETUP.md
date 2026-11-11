# Supabase + GitHub Pages 설정 순서

## 1. Supabase 프로젝트 만들기
1. https://supabase.com/dashboard → **New project**
2. 입력
   - Name: `travel-diary`
   - Database Password: **Generate a password**(자동 생성)를 누르고 어딘가 적어두기 (이 앱 설정엔 필요 없어요)
   - Region: **Northeast Asia (Seoul)**
3. **Create new project** → 1~2분 기다리기

## 2. DB 설정 붙여넣기
1. 왼쪽 메뉴 **SQL Editor** → **New query**
2. `supabase\schema.sql` 파일 내용 **전체**를 붙여넣기 (Claude가 클립보드에 복사해 뒀어요 → Ctrl+V)
3. 오른쪽 아래 **Run** (Ctrl+Enter)
   - "destructive operation" 경고가 뜨면 **Run this query** 를 눌러도 괜찮아요 (예전 설정을 덮어쓰는 문구가 들어 있어서 뜨는 경고예요)
4. 아래 결과에 **✔ 여행 기록 앱 설정 완료** 가 나오면 성공

## 3. 가입 확인 메일 끄기
왼쪽 메뉴 **Authentication** → **Sign In / Providers** → **Email** 을 눌러서
- **Confirm email** 을 **끄기(OFF)** → **Save**

(켜두면 가입할 때마다 인증 메일이 가는데, 무료 메일은 1시간에 몇 통밖에 못 보내서 친구들이 가입을 못 할 수 있어요.)

## 4. 연결 정보 복사해서 Claude에게 알려주기
화면 위쪽 **Connect** 버튼(또는 **Project Settings → API Keys**)에서
- **Project URL**: `https://xxxxxxxx.supabase.co`
- **Publishable key**: `sb_publishable_...` 로 시작하는 키 (없으면 **anon public** 키)

> ⚠️ **secret 키(sb_secret_...) / service_role 키는 절대 알려주거나 어디에 붙여넣지 마세요.** 모든 데이터를 마음대로 할 수 있는 키예요.

## 5. GitHub 저장소 만들기
1. https://github.com/new
2. Repository name: `travel-diary`, **Public** 선택, 나머지는 체크하지 않기 (README 추가 X)
3. **Create repository**
4. Claude에게 **GitHub 아이디** 알려주기

## 7. 아이디 가입으로 바꾸기 (2026-11 추가)
SQL Editor에서 `supabase\migrate-002-username.sql` 을 한 번 실행해요. (결과: **✔ 아이디 가입 설정 완료**)

## 8. 추억 기록 기능 (2026-11 추가)
SQL Editor에서 `supabase\migrate-003-memories.sql` 을 한 번 실행해요. (결과: **✔ 추억 기록 기능 설정 완료**)

> 처음부터 새로 설치할 때는 `schema.sql` → `migrate-002-username.sql` → `migrate-003-memories.sql` 순서로 실행하면 돼요.

## 친구가 비밀번호를 잊었을 때 (관리자가 초기화)
아이디 가입은 이메일이 없어서 재설정 메일을 보낼 수 없어요. 대신 SQL Editor에서 아래를 실행하면
그 친구의 비밀번호가 바뀌어요. `친구아이디`, `새비밀번호` 부분만 바꿔서 실행하고, 새 비밀번호를 친구에게 알려주세요.

```sql
update auth.users
set encrypted_password = extensions.crypt('새비밀번호', extensions.gen_salt('bf'))
where email = lower('친구아이디') || '@travel-diary.example.com';
```

결과에 `UPDATE 1` 이 나오면 성공이에요. (`UPDATE 0` 이면 아이디를 다시 확인해 주세요.)

## 6. (Claude가 올린 뒤) 사이트 주소 등록
Supabase **Authentication → URL Configuration** 에서
- **Site URL**: `https://<GitHub아이디>.github.io/travel-diary/`
- **Redirect URLs** 에 같은 주소 추가

(비밀번호 재설정 메일의 링크가 이 주소로 돌아오게 하는 설정이에요.)
