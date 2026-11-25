// 로그인(Supabase) 설정. Supabase 대시보드 → Project Settings → API 에서 복사해 넣으세요.
//  anon(공개) 키는 웹페이지에 넣어도 되는 키입니다 (데이터는 데이터베이스의 행 수준 보안 규칙으로 지킴).
//  두 값이 비어 있으면 로그인 버튼이 보이지 않고, 게임은 예전처럼 로그인 없이 동작합니다.
window.PK = window.PK || {};
PK.Config = {
  supabaseUrl: '',      // 예: 'https://abcdefghijklmnop.supabase.co'
  supabaseAnonKey: '',  // 예: 'eyJhbGciOi...' (anon public 키)
};
