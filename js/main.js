// 진입점: 렌더러/씬 생성, 로비 ↔ 게임 전환, 메인 루프
window.PK = window.PK || {};

// 경기장 환경 설정 (시간·날씨). 이 브라우저에 기억
PK.Env = (function () {
  const KEY = 'pk_env';
  let env = { time: 'night', weather: 'clear' };
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) env = Object.assign(env, s); } catch (e) { /* 저장소 없음 */ }
  return {
    get: () => Object.assign({}, env),
    set(k, v) { env[k] = v; try { localStorage.setItem(KEY, JSON.stringify(env)); } catch (e) { /* 무시 */ } },
  };
})();

PK.Main = (function () {
  let renderer, scene, camera, stadium, last = performance.now();

  function boot() {
    const ld = document.getElementById('loading');
    if (window.THREE && PK.PlayerModel) {
      if (ld) ld.textContent = '선수 불러오는 중...';
      const timeout = new Promise((res) => setTimeout(res, 15000));
      Promise.race([PK.PlayerModel.load().catch((e) => console.warn('선수 모델을 불러오지 못해 기본 모델로 진행', e)), timeout]).then(start);
    } else start();
  }
  function start() {
    if (!window.THREE) {
      document.getElementById('loading').textContent = '3D 엔진(three.js)을 불러오지 못했습니다. 인터넷 연결을 확인하세요.';
      return;
    }
    const canvas = document.getElementById('game-canvas');
    // 휴대폰(터치 화면 + 작은 화면): 해상도 배율·그림자·관중을 가볍게 해서 끊기지 않게
    PK.lowPower = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 900);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(PK.lowPower ? 1.5 : 2, window.devicePixelRatio));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PK.lowPower ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(32, 1, 0.1, 300);
    camera.position.set(0, 1.75, 15.6);
    camera.lookAt(0, 1, 0);
    stadium = PK.Stadium.build(scene);
    PK.Game.init(renderer, scene, camera, stadium);
    PK.Lobby.init();
    PK.Tour.init();

    document.querySelectorAll('.menu-btn').forEach((b) => b.addEventListener('click', () => {
      PK.Audio.init(); PK.Audio.click();
      if (b.dataset.mode === 'online') { PK.Online.togglePanel(); return; }
      if (b.dataset.mode === 'practice') { const pp = document.getElementById('practice-panel'); pp.hidden = !pp.hidden; return; }
      if (b.dataset.mode === 'tournament') { PK.Tour.open(); return; }
      PK.Lobby.hide();
      PK.Game.start(b.dataset.mode);
    }));
    // 연습 모드: 키커 연습 / 키퍼 연습
    document.querySelectorAll('#practice-panel button').forEach((b) => b.addEventListener('click', () => {
      PK.Audio.init(); PK.Audio.click();
      PK.Lobby.hide();
      PK.Game.start('practice', { practice: b.dataset.practice });
    }));
    // 경기장 환경: 시간 · 날씨
    const ENV_NOTE = { rain: '비: 젖은 잔디라 공이 낮게 미끄러지고, 키퍼가 공을 놓치기 쉬워요', snow: '눈: 공이 덜 튀고 빨리 멈춰요', clear: '' };
    const paintEnv = () => {
      const e = PK.Env.get();
      document.querySelectorAll('#env-time button').forEach((x) => x.classList.toggle('on', x.dataset.v === e.time));
      document.querySelectorAll('#env-weather button').forEach((x) => x.classList.toggle('on', x.dataset.v === e.weather));
      const note = document.getElementById('env-note'); if (note) { note.textContent = ENV_NOTE[e.weather] || ''; note.hidden = !note.textContent; }
      if (stadium.setEnv) stadium.setEnv(e);
    };
    [['env-time', 'time'], ['env-weather', 'weather']].forEach(([id, key]) => document.querySelectorAll('#' + id + ' button').forEach((b) => b.addEventListener('click', () => {
      PK.Audio.init(); PK.Audio.click();
      PK.Env.set(key, b.dataset.v); paintEnv();
    })));
    paintEnv();
    // 온라인: 상대와 연결되면 바로 경기 시작
    PK.Online.init();
    PK.Online.onMatched(() => {
      PK.Audio.init();
      PK.Lobby.hide();
      PK.Game.start('online');
    });
    PK.Online.onLeft(() => PK.Game.opponentLeft());
    document.querySelectorAll('#difficulty button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#difficulty button').forEach((x) => x.classList.toggle('on', x === b));
      PK.AI.setLevel(b.dataset.diff);
      PK.Audio.init(); PK.Audio.click();
    }));

    window.addEventListener('resize', resize);
    resize();
    PK.Lobby.show();
    document.getElementById('loading').classList.add('hide');
    requestAnimationFrame(loop);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 세로 화면에서는 골대가 다 보이도록 시야각을 넓힘
    camera.fov = w / h < 1.2 ? 32 * Math.min(1.9, 1.2 / (w / h)) : 32;
    camera.updateProjectionMatrix();
  }

  function loop(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    if (PK.Game.active) {
      PK.Game.update(dt);
      renderer.render(scene, camera);
    } else {
      PK.Lobby.update();
    }
    requestAnimationFrame(loop);
  }

  // 길게 누르기 → 글자 선택/우클릭 메뉴가 뜨지 않게
  document.addEventListener('selectstart', (e) => { if (!(e.target.closest && e.target.closest('input'))) e.preventDefault(); });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  // 아이폰 사파리: 두 번 탭·두 손가락으로 화면이 확대되면 조작 버튼과 점수판이 화면 밖으로 밀려남 → 확대 제스처 막기
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

  window.addEventListener('load', boot);

  return {
    toLobby() { PK.Lobby.show(); PK.Tour.updateMenu(); },
  };
})();
