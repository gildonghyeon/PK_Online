// 로그인 (구글·카카오) + 닉네임: Supabase 인증과 profiles 표를 씀
//  Claude 아티팩트 안에서는 외부 로그인이 막혀 있어 아예 켜지 않음 (GitHub Pages 등에서만)
//  개발용: 주소에 ?fakeauth=1 을 붙이면 서버 없이 가짜 로그인으로 화면을 시험할 수 있음
window.PK = window.PK || {};

PK.Auth = (function () {
  const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  const NICK_RE = /^[0-9A-Za-z가-힣_]{2,12}$/;
  const $ = (id) => document.getElementById(id);
  let sb = null, user = null, nick = null, enabled = false, busy = false;
  const subs = [];

  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = LIB; s.async = true;
      s.onload = () => (window.supabase ? res(window.supabase) : rej(new Error('lib')));
      s.onerror = () => rej(new Error('lib'));
      document.head.appendChild(s);
    });
  }

  // 개발용 가짜 서버 (이 브라우저 저장소에만)
  function fakeClient() {
    const KEY = 'pk_fakeauth';
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
    const save = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* 무시 */ } };
    let cb = null;
    return {
      auth: {
        async getSession() { const d = load(); return { data: { session: d.user ? { user: d.user } : null } }; },
        onAuthStateChange(f) { cb = f; return { data: { subscription: { unsubscribe() {} } } }; },
        async signInWithOAuth({ provider }) { const d = load(); d.user = { id: 'fake-' + provider, app_metadata: { provider }, user_metadata: { name: provider === 'kakao' ? '카카오친구' : 'Google User' } }; save(d); cb && cb('SIGNED_IN', { user: d.user }); return { error: null }; },
        async signOut() { const d = load(); delete d.user; save(d); cb && cb('SIGNED_OUT', null); return { error: null }; },
      },
      from() {
        const d = load(); d.profiles = d.profiles || {};
        const q = {
          _id: null,
          select() { return q; },
          eq(_, v) { q._id = v; return q; },
          async maybeSingle() { const p = d.profiles[q._id]; return { data: p || null, error: null }; },
          async upsert(row) {
            const taken = Object.entries(d.profiles).some(([k, p]) => k !== row.id && p.nickname.toLowerCase() === row.nickname.toLowerCase());
            if (taken) return { error: { code: '23505' } };
            d.profiles[row.id] = { nickname: row.nickname }; save(d); return { error: null };
          },
        };
        return q;
      },
    };
  }

  async function init() {
    const cfg = PK.Config || {};
    const fake = /[?&]fakeauth=1/.test(location.search);
    if (window.claude && !fake) return render();           // Claude 안: 로그인 없음
    if (!fake && !(cfg.supabaseUrl && cfg.supabaseAnonKey)) return render(); // 아직 설정 전
    try {
      if (fake) sb = fakeClient();
      else { const lib = await loadLib(); sb = lib.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }); }
    } catch (e) { console.warn('로그인 도구를 불러오지 못함', e); return render(); }
    enabled = true;
    const { data } = await sb.auth.getSession();
    await setUser(data && data.session ? data.session.user : null);
    sb.auth.onAuthStateChange((_e, session) => { setUser(session ? session.user : null); });
    // 로그인하고 돌아온 주소에 남은 인증 조각(#access_token 등) 지우기
    if (/access_token=|code=/.test(location.hash + location.search) && history.replaceState) history.replaceState(null, '', location.pathname);
  }

  async function setUser(u) {
    if ((u && u.id) === (user && user.id) && (u ? nick !== null : true)) { render(); return; }
    user = u || null; nick = null;
    if (user) {
      try { const { data } = await sb.from('profiles').select('nickname').eq('id', user.id).maybeSingle(); nick = data ? data.nickname : null; } catch (e) { nick = null; }
      if (!nick) openNick(true); // 처음 로그인: 닉네임 정하기
    }
    render(); subs.forEach((f) => f());
  }

  function login(provider) {
    if (!sb || busy) return;
    busy = true; status('로그인 화면으로 이동하는 중...');
    const opts = { redirectTo: location.origin + location.pathname };
    if (provider === 'kakao') opts.scopes = 'profile_nickname'; // 이메일 동의 없이 (비즈 앱이 아니어도 되게)
    sb.auth.signInWithOAuth({ provider, options: opts }).then(({ error }) => {
      busy = false;
      if (error) status('로그인을 시작하지 못했어요: ' + (error.message || error), true); // 성공하면 구글·카카오 화면으로 넘어갔다가 돌아옴
    });
  }
  async function logout() { if (sb) await sb.auth.signOut(); }

  async function saveNick(v) {
    v = String(v || '').trim();
    if (!NICK_RE.test(v)) { status('닉네임은 2~12자, 한글·영문·숫자·_ 만 쓸 수 있어요.', true); return; }
    if (!sb || !user) return;
    status('저장하는 중...');
    const { error } = await sb.from('profiles').upsert({ id: user.id, nickname: v, updated_at: new Date().toISOString() });
    if (error) { status(error.code === '23505' ? '이미 다른 사람이 쓰는 닉네임이에요.' : '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.', true); return; }
    nick = v; closeModal(); render(); subs.forEach((f) => f());
  }

  // ---------- 화면 ----------
  function status(msg, err) { const el = $('acc-status'); if (el) { el.textContent = msg || ''; el.classList.toggle('err', !!err); } }
  function render() {
    const box = $('account'); if (!box) return;
    box.hidden = !enabled;
    $('acc-login').hidden = !!user;
    $('acc-user').hidden = !user;
    $('acc-nick').textContent = nick || '닉네임 없음';
    const pv = user && user.app_metadata && user.app_metadata.provider;
    $('acc-prov').textContent = pv === 'kakao' ? '카카오' : pv === 'google' ? '구글' : '';
  }
  function openLogin() { const m = $('acc-modal'); m.hidden = false; $('acc-login-pane').hidden = false; $('acc-nick-pane').hidden = true; status(''); }
  function openNick(first) {
    const m = $('acc-modal'); m.hidden = false; $('acc-login-pane').hidden = true; $('acc-nick-pane').hidden = false;
    $('acc-nick-title').textContent = first ? '닉네임을 정해 주세요' : '닉네임 변경';
    const meta = (user && user.user_metadata) || {};
    const guess = String(meta.nickname || meta.name || meta.full_name || '').replace(/[^0-9A-Za-z가-힣_]/g, '').slice(0, 12);
    $('acc-nick-input').value = nick || guess;
    $('acc-nick-cancel').hidden = !!first && !nick;
    status('');
    setTimeout(() => $('acc-nick-input').focus(), 0);
  }
  function closeModal() { const m = $('acc-modal'); if (m) m.hidden = true; }

  function bind() {
    if (!$('account')) return;
    $('acc-login').addEventListener('click', openLogin);
    $('acc-edit').addEventListener('click', () => openNick(false));
    $('acc-logout').addEventListener('click', logout);
    document.querySelectorAll('[data-provider]').forEach((b) => b.addEventListener('click', () => login(b.dataset.provider)));
    $('acc-close').addEventListener('click', closeModal);
    $('acc-nick-cancel').addEventListener('click', closeModal);
    $('acc-nick-pane').addEventListener('submit', (e) => { e.preventDefault(); saveNick($('acc-nick-input').value); });
    $('acc-nick-input').addEventListener('keydown', (e) => e.stopPropagation()); // 입력 중 꾸미기 단축키(방향키) 막기
  }

  document.addEventListener('DOMContentLoaded', () => { bind(); init(); });

  return {
    nickname: () => nick,
    signedIn: () => !!user,
    enabled: () => enabled,
    onChange(f) { subs.push(f); },
    validNick: (v) => NICK_RE.test(String(v || '')),
  };
})();
