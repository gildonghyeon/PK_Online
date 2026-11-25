# 로그인(구글·카카오) 설정 안내

게임 코드는 준비돼 있습니다. 아래 계정 작업을 마치고 **`js/config.js`에 주소와 키 두 개만 넣으면** GitHub Pages 주소에서 로그인 버튼이 나타납니다.

- 게임 주소: `https://gildonghyeon.github.io/PK_Online/`
- 아래에서 `<프로젝트주소>`는 Supabase 프로젝트 주소입니다 (예: `https://abcdefghijklmnop.supabase.co`).

---

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 에 가입하고 **New project**를 만듭니다. (무료 플랜, 지역은 Northeast Asia (Seoul) 추천)
2. **Project Settings → API**에서 두 값을 복사합니다.
   - **Project URL** → `config.js`의 `supabaseUrl`
   - **anon public** 키 → `config.js`의 `supabaseAnonKey`
   - `service_role` 키는 절대 넣지 마세요.
3. **SQL Editor → New query**에 `supabase/schema.sql` 내용을 통째로 붙여 넣고 **Run**.
4. **Authentication → URL Configuration**
   - **Site URL**: `https://gildonghyeon.github.io/PK_Online/`
   - **Redirect URLs**에 추가: `https://gildonghyeon.github.io/PK_Online/` (내 PC에서 시험하려면 `http://localhost:5173/`도)

## 2. 구글 로그인

1. https://console.cloud.google.com 에서 프로젝트를 하나 만듭니다.
2. **API 및 서비스 → OAuth 동의 화면**: 외부(External), 앱 이름 `PK Online`, 이메일 입력 후 저장. (게시 상태를 "프로덕션"으로 바꿔야 누구나 로그인 가능)
3. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
   - 애플리케이션 유형: **웹 애플리케이션**
   - 승인된 리디렉션 URI: `<프로젝트주소>/auth/v1/callback`
4. 나온 **클라이언트 ID**와 **클라이언트 보안 비밀번호**를 Supabase **Authentication → Providers → Google**에 넣고 켭니다.

## 3. 카카오 로그인

1. https://developers.kakao.com 에서 **내 애플리케이션 → 애플리케이션 추가하기** (앱 이름 `PK Online`).
2. **앱 설정 → 플랫폼 → Web 플랫폼 등록**: `https://gildonghyeon.github.io`
3. **제품 설정 → 카카오 로그인**
   - 활성화 설정 **ON**
   - Redirect URI: `<프로젝트주소>/auth/v1/callback`
   - **동의항목**: 닉네임(profile_nickname)을 "필수 동의"로. (이메일은 비즈 앱이 아니면 받을 수 없어 쓰지 않습니다)
4. **제품 설정 → 카카오 로그인 → 보안**에서 **Client Secret 코드 생성** 후 활성화.
5. Supabase **Authentication → Providers → Kakao**에
   - Client ID = **앱 키 → REST API 키**
   - Client Secret = 4번에서 만든 코드
   - **Allow users without an email**(이메일 없는 사용자 허용)을 켜고 저장.

## 4. 게임에 연결

`js/config.js`의 두 값을 채우고 GitHub에 올리면 끝입니다. (Claude에게 두 값을 알려 주면 대신 넣어 드립니다. anon 키는 공개해도 되는 키입니다)

## 참고

- Claude 아티팩트 링크 안에서는 외부 로그인이 막혀 있어 로그인 버튼이 보이지 않습니다. GitHub Pages 주소에서 쓰세요.
- 닉네임은 2~12자, 한글·영문·숫자·`_`만, 다른 사람과 겹칠 수 없습니다.
