// 진입점: 렌더러/씬 생성, 로비 ↔ 게임 전환, 메인 루프
window.PK = window.PK || {};

PK.Main = (function () {
  let renderer, scene, camera, stadium, last = performance.now();

  function boot() {
    if (!window.THREE) {
      document.getElementById('loading').textContent = '3D 엔진(three.js)을 불러오지 못했습니다. 인터넷 연결을 확인하세요.';
      return;
    }
    const canvas = document.getElementById('game-canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
      if (b.dataset.mode === 'tournament') { PK.Tour.open(); return; }
      PK.Lobby.hide();
      PK.Game.start(b.dataset.mode);
    }));
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
