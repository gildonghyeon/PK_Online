// 승부차기 진행: 동전 던지기 → 킥/다이빙 입력 → 물리 시뮬레이션 → 판정 → 다음 킥
window.PK = window.PK || {};

// 골키퍼 다이빙 밸런스: 최대 다이빙 거리(m), 다이빙 시간 계수, 날아가며 더 뻗을 수 있는 거리(m)
PK.Tune = { maxT: 2.05, diveTime: 0.3, stretch: 0.15, maxShift: 0.6, lateDelay: 0.08, lateReach: 1.0, lateTime: 1.0, earlyLead: 0.14, earlyReach: 1.1 };

PK.Game = (function () {
  const V3 = THREE.Vector3;
  const G = PK.GOAL;
  const BR = PK.Physics.BALL_R;
  const SPOT = new V3(0, BR, G.spotZ);
  const RUN_START = new V3(-1.55, 0, 13.7);
  const PLANT = new V3(-0.08, 0, 11.32); // 임팩트 순간 몸(골반) 위치: 오른발이 공에 닿고 왼발은 공 왼쪽에 디딤
  // 런업 경로: 위치 비율 p(f) = f^RUN_POW (출발은 천천히, 끝에서 가장 빠름 → 차는 순간에도 몸이 앞으로 움직임)
  const RUN_POW = 1.45, RUN_TIME = 1.25, CARRY_T = 0.3, CONTACT_K = 0.2;
  const RUN_DIR = PLANT.clone().sub(RUN_START).normalize();
  // 임팩트 순간에 디딤발이 정확히 PLANT 에 오도록 달리기 끝점을 앞당기고, 그 끝점에서의 속도로 관성을 이어감
  let RUN_V_END = (PLANT.distanceTo(RUN_START) * RUN_POW) / RUN_TIME;
  const carry = (k) => RUN_V_END * CARRY_T * (1 - Math.exp(-Math.max(0, k) / CARRY_T));
  let RUN_END = PLANT.clone();
  for (let i = 0; i < 6; i++) {
    RUN_END = PLANT.clone().addScaledVector(RUN_DIR, -carry(CONTACT_K));
    RUN_V_END = (RUN_END.distanceTo(RUN_START) * RUN_POW) / RUN_TIME;
  }
  const runPos = (f) => RUN_START.clone().lerp(RUN_END, Math.pow(Math.max(0, f), RUN_POW));
  const runYaw = (f) => lerp(Math.atan2(PLANT.x - RUN_START.x, PLANT.z - RUN_START.z), Math.PI + 0.12, Math.max(0, (f - 0.6) / 0.4));
  // 보폭 위상: 런업 끝에서 오른발이 뒤로 감기기 시작하는 순간이 되도록
  const RUN_W = 11, RUN_PH_END = Math.PI / 2 - 0.6;
  const KEEPER_Z = 0.3;

  let renderer, scene, camera, S; // S = 경기장 오브젝트
  let isTouch = false;
  const $ = (id) => document.getElementById(id);
  const ui = {};

  const st = {
    active: false, state: 'idle', time: 0,
    mode: 'single', teams: [], first: 0, kicks: [[], []],
    avatars: null, kickerTeam: 0, keeperTeam: 1,
    aim: new V3(1.5, 1.0, 0), power: 0, charging: false,
    kickType: 'instep', keeperTiming: 'normal',
    shot: null, dive: null,
    ball: null, flight: null,
    cam: { pos: new V3(0, 1.75, 15.5), look: new V3(0, 1.0, 0), tPos: new V3(), tLook: new V3(), speed: 3 },
    keys: {}, mouse: null, timers: [], touchAxis: { x: 0, y: 0 },
  };

  // ---------- 유틸 ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut2 = (t) => 1 - (1 - t) * (1 - t);
  const easeOut3 = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function later(sec, fn) { st.timers.push({ at: st.time + sec, fn }); }
  function setCam(pos, look, speed) { st.cam.tPos.copy(pos); st.cam.tLook.copy(look); st.cam.speed = speed || 3; }

  // 이 기기에서 직접 조작하는 팀인가 (온라인에선 상대 팀은 remote)
  function isLocal(t) { return !!(st.teams[t] && st.teams[t].human && !st.teams[t].remote); }
  function kickN() { return st.kicks[0].length + st.kicks[1].length; }
  const online = () => st.mode === 'online';
  const r3 = (v) => Math.round(v * 1000) / 1000;

  function show(id, on) { $(id).classList.toggle('active', !!on); }
  function setText(id, html) { $(id).innerHTML = html || ''; }

  // ---------- 초기화 ----------
  function init(r, sc, cam, stadium) {
    renderer = r; scene = sc; camera = cam; S = stadium;
    S.aim.visible = false; S.traj.visible = false;
    S.ball.position.copy(SPOT);

    st.coin = buildCoin();
    st.coin.visible = false;
    scene.add(st.coin);

    // 입력
    const canvas = renderer.domElement;
    canvas.addEventListener('pointermove', (e) => { st.mouse = { x: e.clientX, y: e.clientY }; });
    // 마우스 클릭 = 스페이스 (터치는 화면 버튼으로만 조작)
    canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button === 0) pressAction(); });
    window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && e.button === 0) releaseAction(); });
    window.addEventListener('keydown', (e) => {
      if (!st.active) return;
      st.keys[e.code] = true;
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) { if (st.state === 'handoff') $('handoff-btn').click(); else pressAction(); } }
      if (st.state === 'kickerAim' && !st.charging) {
        const kt = { Digit1: 'curl', Digit2: 'instep', Digit3: 'panenka' }[e.code];
        if (kt) setKickType(kt);
      }
      if (e.code === 'KeyR' && !e.repeat) startStutter(false, 'r');
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      st.keys[e.code] = false;
      if (st.active && e.code === 'Space') releaseAction();
      if (st.active && e.code === 'KeyR') endStutter('r');
    });

    document.querySelectorAll('#kick-types button').forEach((b) => b.addEventListener('click', () => { b.blur(); if (st.state === 'kickerAim' && !st.charging) setKickType(b.dataset.type); }));
    // 터치 기기: 조이스틱 = 방향키, 다이빙 버튼 = 스페이스 (?touch=1 로 PC 에서도 표시)
    isTouch = /[?&]touch=1/.test(location.search) || window.matchMedia('(pointer: coarse)').matches;
    document.body.classList.toggle('touch', isTouch);
    const joy = $('joy'), knob = $('joy-knob');
    let joyId = null;
    const joyMove = (e) => {
      const r = joy.getBoundingClientRect();
      const R = r.width / 2;
      let x = (e.clientX - (r.left + R)) / R, y = -(e.clientY - (r.top + R)) / R;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      knob.style.transform = `translate(${x * R * 0.6}px, ${-y * R * 0.6}px)`;
      // 원 → 사각 매핑 (대각선도 끝까지)
      const m = Math.max(Math.abs(x), Math.abs(y));
      const sc = m > 0.01 ? Math.min(1, Math.hypot(x, y)) / m : 0;
      st.touchAxis.x = Math.abs(x * sc) < 0.2 ? 0 : clamp(x * sc, -1, 1);
      st.touchAxis.y = Math.abs(y * sc) < 0.2 ? 0 : clamp(y * sc, -1, 1);
    };
    const joyEnd = () => { joyId = null; st.touchAxis.x = st.touchAxis.y = 0; knob.style.transform = ''; };
    joy.addEventListener('pointerdown', (e) => { joyId = e.pointerId; try { joy.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ } joyMove(e); e.preventDefault(); });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
    joy.addEventListener('pointerup', joyEnd);
    joy.addEventListener('pointercancel', joyEnd);
    // 액션 버튼 = 스페이스 (키커: 누르고 있다가 떼면 슛 / 키퍼: 누르는 순간 다이빙)
    const act = $('btn-action');
    act.addEventListener('pointerdown', (e) => { e.preventDefault(); try { act.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ } pressAction(); });
    act.addEventListener('pointerup', () => releaseAction());
    act.addEventListener('pointercancel', () => releaseAction());
    // 멈칫 버튼 = R (누르고 있는 동안 멈춤)
    const stb = $('btn-stutter-touch');
    stb.addEventListener('pointerdown', (e) => { e.preventDefault(); try { stb.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ } startStutter(false, 'touch'); });
    stb.addEventListener('pointerup', () => endStutter('touch'));
    stb.addEventListener('pointercancel', () => endStutter('touch'));
    document.querySelectorAll('#coin-choices button').forEach((b) => b.addEventListener('click', () => coinCall(+b.dataset.side)));
    $('btn-again').addEventListener('click', () => {
      show('result', false);
      if (st.tour) return backToTour(); // 토너먼트: 대진표로
      if (online()) { if (st.oppGone || !PK.Online.matched) return quit(); PK.Online.rematch(); }
      start(st.mode);
    });
    $('btn-lobby').addEventListener('click', () => quit());
    $('btn-quit').addEventListener('click', () => quit());
  }

  // ---------- 경기 시작 ----------
  // opts.tour: 토너먼트 경기 { round, roundName, oppId, opp: { name, cfg, profile } }
  function start(mode, opts) {
    cleanup();
    st.active = true; st.mode = mode; st.time = 0;
    st.kicks = [[], []];
    st.shotLog = [];
    st.tour = (opts && opts.tour) || null;
    PK.AI.reset();
    if (st.tour) PK.AI.setProfile(st.tour.opp.profile); else PK.AI.clearProfile();
    const p1 = PK.Lobby.profile(0);
    let p2 = mode === 'multi' ? PK.Lobby.profile(1) : PK.Avatar.randomConfig(p1.uniform);
    if (st.tour) {
      // 토너먼트 상대는 팀 고유의 선수 모습. 내 유니폼과 같으면 겹치지 않는 유니폼으로
      p2 = Object.assign({}, st.tour.opp.cfg);
      if (p2.uniform === p1.uniform) p2.uniform = p1.uniform === 1 ? 5 : 1;
    }
    if (mode === 'multi' && p2.uniform === p1.uniform) {
      // 같은 유니폼이면 2P 는 다음 유니폼으로 (구분용)
      p2.uniformShown = (p2.uniform + 1) % PK.Options.uniform.length;
    }
    const cfg2 = Object.assign({}, p2, { uniform: p2.uniformShown !== undefined ? p2.uniformShown : p2.uniform });
    delete cfg2.uniformShown;
    st.teams = [
      { name: '1P', cfg: Object.assign({}, p1), human: true },
      { name: mode === 'multi' ? '2P' : st.tour ? st.tour.opp.name : 'AI', cfg: cfg2, human: mode === 'multi' },
    ];
    if (mode === 'online') {
      // 0번 팀 = 방장(호스트), 1번 팀 = 참가자. 내 선수는 1P 꾸미기, 상대는 상대가 보낸 꾸미기
      const net = PK.Online;
      const mine = Object.assign({}, p1);
      const opp = net.opponentCfg() || PK.Avatar.randomConfig(mine.uniform);
      const hostCfg = net.isHost ? mine : opp;
      let guestCfg = net.isHost ? opp : mine;
      if (guestCfg.uniform === hostCfg.uniform) guestCfg = Object.assign({}, guestCfg, { uniform: (guestCfg.uniform + 1) % PK.Options.uniform.length });
      st.teams = [
        { name: net.isHost ? '나' : '상대', cfg: hostCfg, human: true, remote: !net.isHost },
        { name: net.isHost ? '상대' : '나', cfg: guestCfg, human: true, remote: net.isHost },
      ];
      st.gid = net.gid;
      st.oppGone = false;
    }
    st.avatars = st.teams.map((t, i) => {
      const kicker = PK.Avatar.create(t.cfg, { number: i === 0 ? 10 : (mode === 'single' ? 9 : 7) });
      const keeper = PK.Avatar.create(t.cfg, { keeper: true, number: 1 });
      kicker.visible = keeper.visible = false;
      scene.add(kicker, keeper);
      return { kicker, keeper };
    });

    show('hud', true);
    buildScoreboard();
    hideKickUI();
    S.ball.position.copy(SPOT);
    PK.Audio.init();
    PK.Audio.crowd(0.15, 1);
    startCoin();
  }

  function cleanup() {
    st.timers = [];
    if (st.avatars) st.avatars.forEach((a) => { scene.remove(a.kicker, a.keeper); PK.Avatar.dispose(a.kicker); PK.Avatar.dispose(a.keeper); });
    st.avatars = null;
    st.flight = null;
    st.coin && (st.coin.visible = false);
    ['coin', 'handoff', 'result'].forEach((id) => show(id, false));
    $('result-text').className = 'result-text';
  }

  function quit() {
    if (online()) PK.Online.leave();
    cleanup();
    st.active = false; st.state = 'idle';
    st.tour = null; PK.AI.clearProfile();
    show('hud', false);
    PK.Audio.crowd(0, 0.5);
    PK.Main.toLobby();
  }
  // 토너먼트 경기가 끝나면 대진표 화면으로 (결과는 경기 종료 순간 이미 기록됨)
  function backToTour() {
    cleanup();
    st.active = false; st.state = 'idle';
    st.tour = null; PK.AI.clearProfile();
    show('hud', false);
    PK.Audio.crowd(0, 0.5);
    PK.Tour.back();
  }

  // ---------- 동전 ----------
  // 금속 동전: 반사되는 하늘·경기장(환경 맵), 돌출된 테두리, 톱니 옆면, 양각 무늬 (앞: 공 / 뒤: 골대)
  const COIN_R = 0.16, COIN_T = 0.026, COIN_Y0 = 1.36; // 손에 든 높이 (안내 상자에 가리지 않게)
  function buildCoin() {
    // 금속이 비출 주변 풍경: 위는 밝은 하늘, 옆은 관중석의 어두운 띠, 아래는 잔디
    const envFace = (top, mid, bottom) => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(1, bottom);
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return c;
    };
    const side = () => envFace('#e4eeff', '#a3afc4', '#4f8a4c');
    const solid = (col) => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 64, 64); return c; };
    const env = new THREE.CubeTexture([side(), side(), solid('#eaf2ff'), solid('#2c6a2e'), side(), side()]);
    env.encoding = THREE.sRGBEncoding; env.needsUpdate = true;

    // 앞/뒤 면: 색(map)과 양각(bump)을 같은 그림으로 그림 — 그림 요소는 밝게(=볼록) 그려 bump 로 씀
    const drawFace = (g, S, color, back) => {
      const cx = S / 2, R = S / 2;
      const ink = color ? '#8a5f12' : '#ffffff';
      if (color) {
        const gr = g.createRadialGradient(cx * 0.8, cx * 0.7, S * 0.05, cx, cx, R);
        gr.addColorStop(0, '#ffe9a0'); gr.addColorStop(0.55, '#e3b44a'); gr.addColorStop(1, '#b8862a');
        g.fillStyle = gr;
      } else g.fillStyle = '#7a7a7a';
      g.fillRect(0, 0, S, S);
      g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = S * 0.012;
      g.beginPath(); g.arc(cx, cx, R * 0.93, 0, Math.PI * 2); g.stroke();      // 안쪽 테두리 선
      // 둘레 점 장식
      for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; g.beginPath(); g.arc(cx + Math.cos(a) * R * 0.86, cx + Math.sin(a) * R * 0.86, S * 0.006, 0, Math.PI * 2); g.fill(); }
      // 둘레 글자
      g.font = `900 ${Math.round(S * 0.075)}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const txt = back ? '★ PENALTY · 11M ★' : '★ PK CHAMPIONS ★';
      for (let i = 0; i < txt.length; i++) {
        const a = -Math.PI / 2 + (i - (txt.length - 1) / 2) * 0.13;
        g.save(); g.translate(cx + Math.cos(a) * R * 0.74, cx + Math.sin(a) * R * 0.74); g.rotate(a + Math.PI / 2); g.fillText(txt[i], 0, 0); g.restore();
      }
      if (!back) { // 축구공
        const br = R * 0.27, by = cx - R * 0.06;
        g.lineWidth = S * 0.014; g.beginPath(); g.arc(cx, by, br, 0, Math.PI * 2); g.stroke();
        const pent = (x, y, r, rot) => { g.beginPath(); for (let k = 0; k < 5; k++) { const a = rot + k * Math.PI * 2 / 5; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); g.fill(); };
        pent(cx, by, br * 0.36, -Math.PI / 2);
        for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * Math.PI * 2 / 5; g.beginPath(); g.moveTo(cx + Math.cos(a) * br * 0.36, by + Math.sin(a) * br * 0.36); g.lineTo(cx + Math.cos(a) * br * 0.98, by + Math.sin(a) * br * 0.98); g.stroke(); }
      } else { // 골대와 그물
        const w = R * 0.62, h = R * 0.34, x0 = cx - w / 2, y0 = cx - R * 0.26;
        g.lineWidth = S * 0.016; g.beginPath(); g.moveTo(x0, y0 + h); g.lineTo(x0, y0); g.lineTo(x0 + w, y0); g.lineTo(x0 + w, y0 + h); g.stroke();
        g.lineWidth = S * 0.005;
        for (let k = 1; k < 7; k++) { g.beginPath(); g.moveTo(x0 + w * k / 7, y0); g.lineTo(x0 + w * k / 7, y0 + h); g.stroke(); }
        for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x0, y0 + h * k / 4); g.lineTo(x0 + w, y0 + h * k / 4); g.stroke(); }
      }
      g.font = `900 ${Math.round(S * 0.26)}px "Black Han Sans", "Noto Sans KR", sans-serif`;
      g.fillText(back ? '뒤' : '앞', cx, cx + R * 0.44);
    };
    const faceMat = (back) => {
      const S = 512;
      const cm = document.createElement('canvas'); cm.width = cm.height = S; drawFace(cm.getContext('2d'), S, true, back);
      const cb = document.createElement('canvas'); cb.width = cb.height = S; drawFace(cb.getContext('2d'), S, false, back);
      const map = PK.canvasTex(cm); map.anisotropy = 8;
      const bump = new THREE.CanvasTexture(cb);
      return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 0.012, metalness: 0.6, roughness: 0.34, envMap: env, envMapIntensity: 1.0 });
    };
    // 옆면 톱니 (세로 줄무늬 요철)
    const ec = document.createElement('canvas'); ec.width = 512; ec.height = 8;
    const eg = ec.getContext('2d');
    for (let x = 0; x < 512; x += 4) { eg.fillStyle = (x / 4) % 2 ? '#3a3a3a' : '#d0d0d0'; eg.fillRect(x, 0, 4, 8); }
    const reed = new THREE.CanvasTexture(ec);
    const rimMat = new THREE.MeshStandardMaterial({ color: '#d9a73c', metalness: 0.85, roughness: 0.28, envMap: env, envMapIntensity: 1.2, bumpMap: reed, bumpScale: 0.01 });

    const coin = new THREE.Group();
    const hT = COIN_T / 2, rIn = COIN_R * 0.9;
    // 테두리 + 옆면: 면보다 살짝 높게 돌출 (단면을 한 바퀴 돌려 만듦)
    const prof = [[rIn, -hT + 0.002], [rIn + 0.004, -hT], [COIN_R - 0.003, -hT], [COIN_R, -hT + 0.003], [COIN_R, hT - 0.003], [COIN_R - 0.003, hT], [rIn + 0.004, hT], [rIn, hT - 0.002]]
      .map((p) => new THREE.Vector2(p[0], p[1]));
    const rim = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), rimMat);
    coin.add(rim);
    const faceGeo = new THREE.CircleGeometry(rIn + 0.001, 64);
    const top = new THREE.Mesh(faceGeo, faceMat(false)); top.rotation.x = -Math.PI / 2; top.position.y = hT - 0.002; coin.add(top);
    const bot = new THREE.Mesh(faceGeo, faceMat(true)); bot.rotation.x = Math.PI / 2; bot.position.y = -hT + 0.002; coin.add(bot);
    coin.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material.side = THREE.DoubleSide; } });
    return coin;
  }

  // ---------- 동전 던지기 ----------
  function startCoin() {
    st.state = 'coin';
    st.coin.visible = true;
    st.coin.position.set(0, COIN_Y0, 11.6);
    st.coin.rotation.set(Math.PI / 2, 0, 0);
    st.cam.pos.set(0, 1.5, 13.6); st.cam.look.set(0, 1.25, 11.6);
    setCam(st.cam.pos, st.cam.look, 4);
    setText('role-banner', ''); setText('instruction', ''); setText('round-label', '');
    $('coin-msg').textContent = '1P, 앞면 또는 뒷면을 선택하세요';
    $('coin-choices').style.display = '';
    if (online()) {
      $('coin-msg').textContent = PK.Online.isHost ? '앞면 또는 뒷면을 선택하세요 (맞히면 선공)' : '상대가 동전 면을 고르는 중...';
      $('coin-choices').style.display = PK.Online.isHost ? '' : 'none';
    }
    show('coin', true);
  }

  function coinCall(side) {
    if (st.state !== 'coin') return;
    PK.Audio.init(); PK.Audio.coin();
    st.state = 'coinFlip';
    $('coin-choices').style.display = 'none';
    $('coin-msg').textContent = '...';
    const result = Math.random() < 0.5 ? 0 : 1;
    const spins = 6 + Math.floor(Math.random() * 3);
    if (online()) PK.Online.set({ coin: { gid: st.gid, call: side, result, spins } });
    flipCoin(side, result, spins);
  }
  function flipCoin(call, result, spins) {
    st.state = 'coinFlip';
    $('coin-choices').style.display = 'none';
    $('coin-msg').textContent = '...';
    // 위로 던져 회전하며 날아갔다가 잔디에 떨어져 튕기고 멈춤 (온라인 두 기기 모두 같은 값으로 똑같이 재생)
    const TF = 1.45, rest = COIN_T / 2;
    const v = (rest - COIN_Y0 + 4.9 * TF * TF) / TF;
    st.coin.rotation.set(Math.PI / 2, 0, 0);
    st.coinAnim = { t0: st.time, flight: TF, dur: TF + 0.95, v, rest, from: Math.PI / 2, to: spins * Math.PI * 2 + (result === 1 ? Math.PI : 0), result, call };
  }

  function coinDone() {
    const a = st.coinAnim;
    const p1wins = a.result === a.call;
    st.first = p1wins ? 0 : 1;
    const sideName = a.result === 0 ? '앞면' : '뒷면';
    const who = st.mode === 'online' ? (isLocal(st.first) ? '내가 먼저 찹니다' : '상대가 먼저 찹니다') : `${st.teams[st.first].name} 선공입니다`;
    $('coin-msg').innerHTML = `<b style="color:#ffd34d">${sideName}</b>! ${who}`;
    PK.Audio.coin();
    later(1.8, () => { show('coin', false); st.coin.visible = false; nextKick(); });
  }

  // ---------- 스코어보드 ----------
  function goals(t) { return st.kicks[t].filter(Boolean).length; }
  function buildScoreboard() {
    [0, 1].forEach((t) => {
      const el = $('team' + t);
      const u = PK.Options.uniform[st.teams[t].cfg.uniform];
      el.querySelector('.team-name').innerHTML = t === 0
        ? `<i class="chip" style="background:${u.c1}"></i><span>${st.teams[t].name}</span>`
        : `<span>${st.teams[t].name}</span><i class="chip" style="background:${u.c1}"></i>`;
    });
    updateScoreboard();
  }
  function updateScoreboard() {
    const n = Math.max(5, st.kicks[0].length, st.kicks[1].length + (0));
    const order = nextKickerTeam();
    [0, 1].forEach((t) => {
      const dots = $('team' + t).querySelector('.dots');
      dots.innerHTML = '';
      const count = Math.max(n, st.kicks[t].length + (order === t ? 1 : 0));
      for (let i = 0; i < count; i++) {
        const d = document.createElement('i');
        const k = st.kicks[t][i];
        d.className = 'dot' + (k === true ? ' goal' : k === false ? ' miss' : '') + (k === undefined && order === t && i === st.kicks[t].length ? ' next' : '');
        dots.appendChild(d);
      }
      $('score' + t).textContent = goals(t);
    });
  }

  function nextKickerTeam() {
    const a = st.first, b = 1 - st.first;
    return st.kicks[a].length === st.kicks[b].length ? a : b;
  }

  function checkEnd() {
    const a = goals(0), b = goals(1), ta = st.kicks[0].length, tb = st.kicks[1].length;
    if (ta < 5 || tb < 5) {
      const remA = Math.max(0, 5 - ta), remB = Math.max(0, 5 - tb);
      if (a + remA < b) return 1;
      if (b + remB < a) return 0;
      return -1;
    }
    if (ta === tb && a !== b) return a > b ? 0 : 1;
    return -1;
  }

  // ---------- 킥 준비 ----------
  function nextKick() {
    const winner = checkEnd();
    if (winner >= 0) return endMatch(winner);

    st.kickerTeam = nextKickerTeam();
    st.keeperTeam = 1 - st.kickerTeam;
    st.shot = null; st.dive = null; st.flight = null;
    st.netHits = 0; st.netSeen = 0; st.obsLaunched = false; st.liveFrozen = false;
    updateScoreboard();
    const kn = st.kicks[st.kickerTeam].length + 1;
    setText('round-label', kn <= 5 ? `${kn}번째 키커` : `서든데스 ${kn - 5}라운드`);
    $('result-text').className = 'result-text';

    // 선수 배치
    st.avatars.forEach((a, i) => {
      a.kicker.visible = i === st.kickerTeam;
      a.keeper.visible = i === st.keeperTeam;
    });
    const kicker = st.avatars[st.kickerTeam].kicker, keeper = st.avatars[st.keeperTeam].keeper;
    PK.Avatar.resetPose(kicker); PK.Avatar.resetPose(keeper);
    kicker.position.copy(RUN_START);
    kicker.rotation.set(0, Math.atan2(PLANT.x - RUN_START.x, PLANT.z - RUN_START.z), 0);
    keeper.position.set(0, 0, KEEPER_Z);
    keeper.rotation.set(0, 0, 0);
    st.K = { av: keeper, dive: null, diveStart: Infinity, prev: null, celebrate: null };
    st.Kk = { av: kicker, run: null, react: null };

    st.ball = { p: SPOT.clone(), v: new V3(), spin: new V3(), held: false, inGoal: false, netHit: false };
    S.ball.position.copy(SPOT); S.ball.rotation.set(0, 0, 0);
    st.aim.set((Math.random() < 0.5 ? -1 : 1) * 1.6, 1.0, 0);
    st.touchAxis.x = st.touchAxis.y = 0;
    st.power = 0; st.charging = false;
    st.keeperTiming = 'normal';
    syncPanels();

    setCam(new V3(0.4, 2.5, 18.5), new V3(0, -0.2, 0), 2.5);
    PK.Audio.whistle();
    PK.Audio.crowd(0.12, 0.6);

    const kickerT = st.teams[st.kickerTeam], keeperT = st.teams[st.keeperTeam];
    st.aiStutter = false;
    if (online()) {
      st.K.remote = !isLocal(st.keeperTeam);
      if (isLocal(st.kickerTeam)) beginKickerAim();
      else onlineKeeperWait();
      return;
    }
    if (kickerT.human) {
      if (st.mode === 'multi') handoff(`${kickerT.name} 키커 차례`, `${keeperT.name}는 화면을 보지 마세요!<br/>조준이 끝나면 키퍼에게 넘겨집니다.`, beginKickerAim);
      else beginKickerAim();
    } else {
      // AI 키커
      const d = PK.AI.decideKick();
      st.shot = computeShot(new V3(d.aim.x, d.aim.y, 0), d.power, d.sigma, d.type, false);
      st.aiStutter = d.stutter; // AI 키커가 달려가다 멈칫할지
      beginKeeperAim();
    }
  }

  function handoff(title, msg, cb) {
    st.state = 'handoff';
    hideKickUI();
    setText('handoff-title', title);
    setText('handoff-msg', msg);
    show('handoff', true);
    const btn = $('handoff-btn');
    btn.onclick = () => { show('handoff', false); btn.onclick = null; st.state = 'busy'; later(0.15, cb); };
  }

  function beginKickerAim() {
    st.state = 'kickerAim';
    const t = st.teams[st.kickerTeam];
    // AI 키퍼: 미리 다이빙 계획을 세우고, 조준하는 동안 그쪽으로 살짝 움직임 (가끔은 페이크)
    st.aiPlan = null;
    if (!st.teams[st.keeperTeam].human) {
      st.aiPlan = PK.AI.decideDive(null);
      const shift = PK.AI.decideShift(st.aiPlan.x);
      later(0.6 + Math.random() * 0.8, () => { if (st.K) st.K.shiftTarget = shift; });
    }
    setText('role-banner', `⚽ ${t.name} 키커`);
    setText('instruction', isTouch
      ? '조이스틱: 조준 · 킥 종류 선택 · 슛 버튼을 누르고 있다가 떼면 슛 · 달려가는 중 멈칫 버튼'
      : '조준: 방향키/마우스 · 킥 종류: 1 감아차기 2 인스텝 3 파넨카 · 스페이스(클릭)를 누르고 있다가 떼면 슛 · 달려가는 중 R = 멈칫');
    $('kick-panel').classList.add('show');
    syncPanels();
    S.aim.visible = true; S.traj.visible = true;
    S.aimMat.color.set('#c6ff3d');
    st.kickDeadline = st.time + KICK_TIME_LIMIT;
    st.lastTick = null;
  }

  // ---------- 킥 제한 시간: 10초 안에 안 차면 골대 정중앙으로 ----------
  const KICK_TIME_LIMIT = 10;
  function updateKickTimer() {
    const el = $('kick-timer');
    if (st.state !== 'kickerAim' || !st.kickDeadline) { el.classList.remove('show'); return; }
    const remain = Math.max(0, st.kickDeadline - st.time);
    const sec = Math.ceil(remain);
    el.textContent = sec;
    el.classList.add('show');
    el.classList.toggle('hurry', remain <= 3);
    if (remain <= 3 && sec !== st.lastTick && sec > 0) { st.lastTick = sec; PK.Audio.click(); }
    if (remain <= 0) timeUpKick();
  }
  function timeUpKick() {
    st.charging = false;
    st.kickDeadline = null;
    $('kick-timer').classList.remove('show', 'hurry');
    // 정중앙(가운데, 골대 높이의 절반)으로 평범한 인스텝
    st.shot = computeShot(new V3(0, G.h / 2, 0), 0.6, 0, 'instep', false);
    st.shot.timeout = true;
    hideKickUI();
    setText('instruction', '⏱ 시간 초과! 골대 정중앙으로 찹니다');
    PK.Audio.whistle();
    st.state = 'busy';
    if (online()) { sendShot(); later(0.6, () => setText('instruction', '')); return; }
    later(1.0, () => { setText('instruction', ''); beginKeeperAim(); });
  }

  function beginKeeperAim() {
    const t = st.teams[st.keeperTeam];
    if (!t.human) {
      const d = PK.AI.decideDive(st.shot.target, st.aiPlan);
      st.dive = new V3(d.x, d.y, 0);
      st.keeperTiming = PK.AI.decideTiming();
      if (!st.aiPlan) st.K.shiftTarget = PK.AI.decideShift(d.x);
      return beginRunup();
    }
    const go = () => {
      // 준비 단계: 방향키로 움직일 수 있고, 잠시 후 키커가 자동으로 출발
      st.state = 'keeperReady';
      st.K.manual = true;
      st.K.diveWorld = null;
      st.K.diveStart = Infinity;
      setText('role-banner', `🧤 ${t.name} 골키퍼`);
      setText('instruction', '방향키: 이동 + 다이빙 방향 · 스페이스: 다이빙 · 곧 키커가 달려옵니다');
      $('keeper-panel').classList.add('show');
      S.traj.visible = false;
      S.aimMat.color.set('#2fd0ff');
      later(1.8, () => { $('keeper-panel').classList.remove('show'); beginRunup(); });
    };
    if (st.mode === 'multi') handoff(`${t.name} 골키퍼 차례`, `${st.teams[st.kickerTeam].name}는 화면을 보지 마세요!<br/>원하는 순간에 원하는 방향으로 몸을 날리세요.`, go);
    else go();
  }

  // 키퍼 방향 입력 (키보드 방향키/WASD + 모바일 조이스틱), x: 오른쪽 +, y: 위 +
  function keeperAxis() {
    const k = st.keys;
    let x = (k.ArrowRight || k.KeyD ? 1 : 0) - (k.ArrowLeft || k.KeyA ? 1 : 0);
    let y = (k.ArrowUp || k.KeyW ? 1 : 0) - (k.ArrowDown || k.KeyS ? 1 : 0);
    x = clamp(x + st.touchAxis.x, -1, 1); y = clamp(y + st.touchAxis.y, -1, 1);
    return { x, y };
  }
  // 방향 입력 → 다이빙 목표점 (키퍼가 서 있는 위치 기준)
  //  좌우 없음: ↑ 점프 / ↓ 낮게 / 없음 = 제자리 버티기
  //  좌우: 그쪽으로 다이빙, ↑↓ 로 높이
  function keeperDiveTarget(a) {
    const rootX = st.K.av.position.x;
    if (Math.abs(a.x) < 0.3) return new V3(rootX, a.y > 0.3 ? 2.0 : a.y < -0.3 ? 0.3 : 1.0, 0);
    return new V3(clamp(rootX + a.x * 3.1, -3.4, 3.4), clamp(1.0 + a.y * 0.9, 0.2, 2.3), 0);
  }
  function keeperControlActive() {
    const K = st.K;
    return !!(K && K.manual && !K.diveWorld && (st.state === 'keeperReady' || st.state === 'runup' || st.state === 'flight'));
  }
  // 매 프레임: 다이빙 전에는 방향키 좌우로 골라인 위를 이동, 조준점에 다이빙 방향 미리보기
  function keeperControl(dt) {
    const on = keeperControlActive();
    const kickerAiming = st.state === 'kickerAim' && kickerHumanNow();
    const run = st.Kk && st.Kk.run;
    const canStutter = kickerHumanNow() && run && !run.kicked && (!run.stutterUsed || run.paused);
    $('touch-ctrl').classList.toggle('show', isTouch && (on || kickerAiming));
    $('btn-action').textContent = kickerAiming ? '슛' : '다이빙';
    $('btn-stutter-touch').classList.toggle('show', !!(isTouch && canStutter && st.state === 'runup'));
    $('btn-stutter-touch').classList.toggle('alt', !!(isTouch && (on || kickerAiming))); // 다이빙 버튼과 겹치면 왼쪽 중간으로
    if (!on) return;
    const a = keeperAxis();
    const K = st.K;
    K.shiftTarget = clamp((K.shiftTarget || 0) + a.x * 1.5 * dt, -PK.Tune.maxShift, PK.Tune.maxShift);
    S.aim.visible = false; // 키퍼는 과녁 없이 몸의 움직임만 보고 판단
  }

  // 사람 키퍼: 스페이스를 누른 순간, 현재 방향으로 다이빙
  function manualDive() {
    const K = st.K;
    const contact = st.flight ? st.flight.t0 : K.expectedContact;
    const dt = st.time - contact; // 음수 = 킥 전
    // 킥보다 확실히 먼저 뛰면 체중을 미리 실어 더 멀리, 킥 후 반응이면 보통
    K.timing = dt < -0.1 ? 'early' : 'normal';
    K.diveWorld = keeperDiveTarget(keeperAxis());
    K.diveStart = st.time;
    S.aim.visible = false;
    setText('instruction', '');
    PK.AI.rememberDive(K.diveWorld.x);
  }

  function setKickType(t) { st.kickType = t; PK.Audio.click(); syncPanels(); }
  function syncPanels() {
    document.querySelectorAll('#kick-types button').forEach((b) => b.classList.toggle('on', b.dataset.type === st.kickType));
  }

  // ---------- 멈칫 (달려가다 원하는 순간에, 누르고 있는 동안 멈춤: 최소 0.3초, 최대 1초) ----------
  function kickerHumanNow() { return isLocal(st.kickerTeam); }
  function startStutter(byAI, src) {
    const run = st.Kk && st.Kk.run;
    if (!run || run.kicked || run.stutterUsed || run.paused || (!byAI && !kickerHumanNow())) return;
    const tauEff = st.time - run.t0 - run.pausedTotal;
    if (tauEff < 0.15 || tauEff > run.approach * 0.93) return; // 출발 직후·디딤발 이후엔 불가
    run.paused = true; run.pauseStart = st.time; run.stutterUsed = true; run.stuttered = true; run.releaseReq = false; run.src = src || 'ai';
    $('btn-stutter-touch').classList.add('on');
    if (online() && kickerHumanNow()) PK.Online.set({ stut: { gid: st.gid, n: kickN(), s: 1, r: 0 } });
  }
  function endStutter(src) {
    const run = st.Kk && st.Kk.run;
    if (run && run.paused && run.src === src) {
      run.releaseReq = true; // 멈칫을 시작한 입력만 끝낼 수 있음
      if (online() && kickerHumanNow()) PK.Online.set({ stut: { gid: st.gid, n: kickN(), s: 1, r: 1 } });
    }
  }

  function hideKickUI() {
    $('kick-panel').classList.remove('show');
    $('keeper-panel').classList.remove('show');
    S.aim.visible = false; S.traj.visible = false;
  }

  // ---------- 입력 ----------
  function pressAction() {
    if (!st.active) return;
    PK.Audio.init();
    if (st.state === 'kickerAim' && !st.charging) { st.charging = true; st.power = 0; }
    else if ((st.state === 'runup' || st.state === 'flight') && keeperControlActive()) {
      manualDive();
    } else if (st.state === 'runup' && kickerHumanNow() && !isLocal(st.keeperTeam)) {
      startStutter(false, 'space'); // 싱글(상대 AI 키퍼)에선 스페이스로도 멈칫
    }
  }
  function releaseAction() {
    if (st.state === 'runup') { endStutter('space'); return; }
    if (st.state === 'kickerAim' && st.charging) {
      st.charging = false;
      const p = Math.max(0.15, st.power);
      st.shot = computeShot(st.aim.clone(), p, 0.08, st.kickType, false);
      hideKickUI();
      setText('instruction', '');
      st.state = 'busy';
      if (online()) { sendShot(); return; }
      later(0.25, beginKeeperAim);
    }
  }

  // ---------- 온라인: 슛/멈칫/실시간 상태/결과 주고받기 ----------
  function sendShot() {
    const sh = st.shot;
    PK.Online.set({ stut: null, shot: { gid: st.gid, n: kickN(), type: sh.type, power: r3(sh.power), speed: r3(sh.speed), curve: r3(sh.curve),
      baseSigma: sh.baseSigma, ix: r3(sh.intended.x), iy: r3(sh.intended.y), tx: r3(sh.target.x), ty: r3(sh.target.y),
      v0: sh.launch.v0.toArray().map(r3), spin: sh.launch.spin.toArray().map(r3), timeout: !!sh.timeout } });
    beginRunup(); // 키커 쪽: 내 선수는 바로 달려감 (키퍼·공은 상대 기기에서 받아서 표시)
  }
  function readShot(m) {
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
    const arr = (a) => new V3(num(a && a[0]), num(a && a[1]), num(a && a[2]));
    const type = ['curl', 'instep', 'panenka'].includes(m.type) ? m.type : 'instep';
    return { intended: new V3(num(m.ix), num(m.iy), 0), target: new V3(num(m.tx), num(m.ty), 0), speed: num(m.speed), curve: num(m.curve),
      power: num(m.power), type, stutter: false, baseSigma: num(m.baseSigma), timeout: !!m.timeout, launch: { v0: arr(m.v0), spin: arr(m.spin) } };
  }
  // 키퍼 쪽: 상대가 조준하는 동안 위치를 잡고 기다림 → 슛이 도착하면 런업 시작 (이 기기가 판정)
  function onlineKeeperWait() {
    st.state = 'keeperReady';
    st.K.manual = true; st.K.diveWorld = null; st.K.diveStart = Infinity;
    setText('role-banner', '🧤 골키퍼 (나)');
    setText('instruction', isTouch ? '조이스틱: 이동 + 다이빙 방향 · 다이빙 버튼 = 다이빙 · 상대가 조준하는 중'
      : '방향키: 이동 + 다이빙 방향 · 스페이스 = 다이빙 · 상대가 조준하는 중');
    $('keeper-panel').classList.add('show');
    S.traj.visible = false;
  }
  function planOpt(timing) {
    return timing === 'late' ? { reach: PK.Tune.lateReach, time: PK.Tune.lateTime } : timing === 'early' ? { reach: PK.Tune.earlyReach, time: 1 } : null;
  }
  // 매 프레임 온라인 처리
  function onlineTick() {
    const net = PK.Online;
    const R = net.remote();
    if (!R || st.oppGone) return;
    const n = kickN();
    // 참가자: 방장이 다시 하기를 누르면 새 경기
    if (!net.isHost && Number.isInteger(R.gid) && R.gid > st.gid && (st.state === 'end')) { start('online'); return; }
    // 동전: 참가자는 방장이 고른 결과로 같은 애니메이션
    if (st.state === 'coin' && !net.isHost && R.coin && R.coin.gid === st.gid) {
      const c = R.coin; flipCoin(c.call === 1 ? 1 : 0, c.result === 1 ? 1 : 0, Math.max(4, Math.min(12, c.spins | 0)));
    }
    const K = st.K, run = st.Kk && st.Kk.run;
    // 키퍼(판정 담당): 슛 도착 → 런업, 멈칫 신호 반영, 실시간 상태 보내기
    if (K && K.manual) {
      if (st.state === 'keeperReady' && R.shot && R.shot.gid === st.gid && R.shot.n === n) {
        st.shot = readShot(R.shot);
        $('keeper-panel').classList.remove('show');
        beginRunup();
      }
      if (run && !run.kicked && R.stut && R.stut.gid === st.gid && R.stut.n === n) {
        if (R.stut.s && !run.stutterUsed) startStutter(true, 'remote');
        if (R.stut.r && run.paused && run.src === 'remote') endStutter('remote');
      }
      if (['keeperReady', 'runup', 'flight', 'result'].includes(st.state) && !st.liveFrozen) {
        const q = (v) => Math.round(v * 50) / 50; // 0.02 단위 (바뀔 때만 다시 보내짐)
        const dived = K.diveWorld && isFinite(K.diveStart) && run;
        net.set({ live: { gid: st.gid, n, kx: q(K.av.position.x),
          dv: K.diveWorld ? [r3(K.diveWorld.x), r3(K.diveWorld.y)] : null, dt: K.timing || null,
          dts: dived ? r3(K.diveStart - run.t0) : null, drx: K.diveRootX !== undefined ? r3(K.diveRootX) : null,
          re: K.re && K.dive ? [q(K.re.x), q(K.re.y), q(K.re.rz), q(K.re.hx || 0), q(K.re.hy || 0)] : null } });
      }
    }
    // 키커(보기만): 상대 기기의 키퍼·공 상태를 받아서 표시, 결과 받기
    if (K && K.remote) {
      const L = R.live;
      if (L && L.gid === st.gid && L.n === n) applyLive(L);
      const LA = R.launch;
      if (!st.obsLaunched && run && run.kicked && LA && LA.gid === st.gid && LA.n === n) startObserverFlight(LA);
      if ((st.state === 'runup' || st.state === 'flight') && R.res && R.res.gid === st.gid && R.res.n === n) {
        showResult(!!R.res.goal, String(R.res.text || '').slice(0, 20), ['goal', 'save', 'miss'].includes(R.res.cls) ? R.res.cls : 'miss');
      }
    }
  }
  function applyLive(L) {
    const K = st.K;
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
    if (!K.diveWorld) { K.shiftTarget = clamp(num(L.kx), -1, 1); }
    if (Array.isArray(L.dv) && !K.diveWorld && typeof L.dts === 'number' && st.Kk.run) {
      K.diveWorld = new V3(num(L.dv[0]), num(L.dv[1]), 0);
      K.timing = ['early', 'late'].includes(L.dt) ? L.dt : null;
      // 두 기기의 런업 시계는 거의 같은 시점을 가리킴 (슛이 도착하는 지연만큼 키퍼 쪽이 늦게 시작)
      K.diveStart = st.Kk.run.t0 + num(L.dts);
      K.diveRootX = num(L.drx);
      K.av.position.x = K.diveRootX;
      K.dive = planDive(K.diveWorld, K.diveRootX, planOpt(K.timing));
    }
    if (Array.isArray(L.re) && K.dive) K.re = { x: num(L.re[0]), y: num(L.re[1]), rz: num(L.re[2]), hx: num(L.re[3]), hy: num(L.re[4]) };
  }
  function startObserverFlight(LA) {
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
    const arr = (a) => new V3(num(a && a[0]), num(a && a[1]), num(a && a[2]));
    st.obsLaunched = true;
    st.shot.launch = { v0: arr(LA.v0), spin: arr(LA.spin) };
    st.shot.target = new V3(num(LA.tx), num(LA.ty), 0);
    st.shot.redirected = !!LA.redirected;
    st.ball = { p: SPOT.clone(), v: st.shot.launch.v0.clone(), spin: st.shot.launch.spin.clone(), held: false, inGoal: false, netHit: false };
    st.flight = { t0: st.time, outcome: null, events: { post: false, keeper: false, catch: false }, decided: false, resolved: false, observer: true,
      env: { keeper: [], touched: false, catchSkill: 1 } };
  }

  // 킥 종류별 특성
  //  감아차기: 발 안쪽으로 감아 차기 → 조준한 쪽으로 휘어 들어감. 덜 빠르지만 정확
  //  인스텝: 발등으로 곧게 강하게 → 빠르지만 오차 큼
  //  파넨카: 가운데로 살짝 띄우는 칩슛 → 매우 느림. 키퍼가 먼저 몸을 날리면 거의 골, 버티면 쉽게 잡힘
  const KICK_TYPES = {
    curl:    { name: '감아차기', speed: (p) => 12 + 16 * p, sigmaMul: 0.65, color: '#2fd0ff' },
    instep:  { name: '인스텝',   speed: (p) => 13 + 21 * p, sigmaMul: 1.15, color: '#ffffff' },
    panenka: { name: '파넨카',   speed: (p) => 12.4 + 3.4 * p, sigmaMul: 0.35, color: '#ffd34d' },
  };
  // 감아차기 커브: 키커는 오른발잡이 → 발 안쪽으로 감으면 공은 항상 오른쪽에서 왼쪽으로 휨
  //  왼쪽 구석: 가운데로 출발해 먼 포스트 쪽으로 크게 감겨 들어감 (자연스러운 방향이라 더 많이 휨)
  //  오른쪽 구석: 골대 바깥쪽으로 출발했다가 안쪽으로 감겨 들어옴 (덜 휨)
  function autoCurve(type, aimX) {
    if (type !== 'curl') return 0;
    const t = Math.min(1, Math.abs(aimX) / 3);
    return aimX < 0 ? -(0.5 + 0.3 * t) : -(0.4 + 0.1 * t);
  }
  function shotSpeed(type, pw, stutter) {
    return KICK_TYPES[type].speed(pw) * (stutter && type !== 'panenka' ? 0.87 : 1);
  }

  // 의도(조준/파워/커브/킥 종류)에 실제 오차를 더해 최종 슈팅 계산
  function computeShot(aim, power, baseSigma, type, stutter) {
    type = type || 'instep';
    const K = KICK_TYPES[type];
    const pw = Math.min(power, 1);
    const over = Math.max(0, power - 1);
    const curve = autoCurve(type, aim.x);
    const speed = shotSpeed(type, pw, stutter) + over * 4;
    let sigma = (baseSigma + 0.55 * Math.pow(pw, 4)) * K.sigmaMul + 0.1 * Math.abs(curve) + over * 1.4;
    if (stutter) sigma += 0.1; // 멈칫하면 리듬이 깨져 정확도가 떨어짐
    const lift = type === 'panenka' ? over * 3 : over * 6.5;
    const target = new V3(aim.x + gauss() * sigma, aim.y + gauss() * sigma * 0.8 + lift, 0);
    target.y = Math.max(BR, target.y);
    const launch = PK.Physics.solveLaunch(SPOT, target, speed, curve);
    return { intended: aim.clone(), target, speed, curve, power, launch, type, stutter: !!stutter, baseSigma };
  }

  // ---------- 런업 & 킥 ----------
  function beginRunup() {
    st.state = 'runup';
    setText('role-banner', ''); setText('instruction', '');
    S.aim.visible = false; S.traj.visible = false;
    const T_APPROACH = 1.25;
    st.Kk.run = { t0: st.time, approach: T_APPROACH, contact: T_APPROACH + 0.2, kicked: false,
      paused: false, pausedTotal: 0, stutterUsed: false, stuttered: false,
      ai: st.aiStutter ? { at: T_APPROACH * (0.55 + Math.random() * 0.3), dur: 0.35 + Math.random() * 0.4 } : null };
    const stutter = 0;
    // 키퍼 타이밍
    //  일찍: 키커의 리듬(멈칫 없는 예상 임팩트)에 맞춰 미리 몸을 날림 → 구석까지 닿지만 멈칫에 속음
    //  보통: 실제 임팩트 직전
    //  늦게: 공이 맞는 걸 보고 반응 → 방향은 정확하지만 출발이 늦음
    const expected = st.time + T_APPROACH + 0.2, actual = expected + stutter;
    const timing = st.keeperTiming;
    st.K.expectedContact = actual;
    if (st.K.remote) {
      // 온라인 키커 쪽: 키퍼는 상대 기기에서 움직임을 받아옴
      st.K.diveStart = Infinity;
    } else if (st.teams[st.keeperTeam].human) {
      // 사람 키퍼: 원하는 순간에 직접 다이빙
      st.K.manual = true;
      st.K.timing = null;
      setText('role-banner', `🧤 ${st.teams[st.keeperTeam].name} 골키퍼`);
      setText('instruction', isTouch ? '조이스틱: 이동 + 다이빙 방향 · 다이빙 버튼을 누르는 순간 다이빙'
        : '방향키: 이동 + 다이빙 방향 · 원하는 순간에 스페이스 = 다이빙 · 안 누르면 제자리에서 버팀');
      S.aimMat.color.set('#2fd0ff');
    } else {
      st.K.timing = timing;
      st.K.diveWorld = st.dive.clone(); // 실제 계획은 다이빙 순간의 키퍼 위치 기준으로
      // 일찍: 키커의 원래 리듬에 맞춰 미리 출발(멈칫에 속음) / 보통: 실제 임팩트 직전 / 늦게: 임팩트 후 (kickerUpdate·launchBall 에서 결정)
      st.K.diveStart = timing === 'early' ? expected - PK.Tune.earlyLead : Infinity;
    }
    if (isLocal(st.kickerTeam)) {
      PK.AI.rememberKick(st.shot.target.x);
      if (!isLocal(st.keeperTeam)) setText('instruction', isTouch ? '달려가는 중 멈칫 버튼을 누르고 있으면 멈칫' : '달려가는 중 스페이스나 R을 누르고 있으면 멈칫 (키퍼를 먼저 움직이게!)');
      else setText('instruction', '키커: R을 누르고 있으면 멈칫 · 키퍼: 방향키 + 스페이스');
    }
    setCam(new V3(0.7, 2.3, 17.2), new V3(0, 0.1, 2), 1.2);
    PK.Audio.crowd(0.3, 0.8);
  }

  function launchBall() {
    let shot = st.shot;
    const K = st.K;
    if (K && K.remote) {
      PK.Audio.kick(Math.min(1, shot.power));
      st.state = 'flight';
      $('btn-stutter-touch').classList.remove('on', 'show');
      setCam(new V3(0.8, 2.0, 15.5), new V3(0, 0.6, 0), 1.5);
      return;
    }
    if (K && K.manual) PK.AI.rememberTiming(!K.diveWorld ? 'late' : st.time - K.diveStart > 0.1 ? 'early' : 'normal');
    const run = st.Kk.run;
    if (kickerHumanNow()) PK.AI.rememberKickStyle(shot.type, !!run.stuttered);
    if (run.stuttered) {
      if (K && K.dive && K.dive.mode === 'dive' && st.time - K.diveStart > 0.15) {
        // 키퍼가 먼저 몸을 날린 걸 보고 반대쪽으로
        const tx = -K.dive.side * clamp(Math.abs(shot.intended.x), 1.4, 2.9);
        shot = computeShot(new V3(tx, shot.intended.y, 0), shot.power, shot.baseSigma, shot.type, true);
        shot.redirected = true;
      } else {
        shot = computeShot(shot.intended, shot.power, shot.baseSigma, shot.type, true); // 리듬이 깨져 느리고 부정확
      }
      st.shot = shot;
    }
    // AI 키퍼 '늦게': 공이 맞는 걸 보고 출발
    if (K && !K.manual && K.timing === 'late' && K.diveStart === Infinity) K.diveStart = st.time + PK.Tune.lateDelay;
    $('btn-stutter-touch').classList.remove('on', 'show');
    if (online()) {
      PK.Online.set({ launch: { gid: st.gid, n: kickN(), v0: shot.launch.v0.toArray().map(r3), spin: shot.launch.spin.toArray().map(r3),
        tx: r3(shot.target.x), ty: r3(shot.target.y), redirected: !!shot.redirected } });
    }
    st.ball.v.copy(shot.launch.v0);
    st.ball.spin.copy(shot.launch.spin);
    st.flight = { t0: st.time, outcome: null, events: { post: false, keeper: false, catch: false }, decided: false, resolved: false, env: { keeper: [], touched: false, catchSkill: st.teams[st.keeperTeam].human ? 1 : PK.AI.catchSkill() } };
    PK.Audio.kick(Math.min(1, shot.power));
    st.state = 'flight';
    setCam(new V3(0.8, 2.0, 15.5), new V3(0, 0.6, 0), 1.5);
  }

  // ---------- 골키퍼 다이빙 계획 ----------
  // Dw: 다이빙 목표(월드 좌표), rootX: 키퍼가 실제로 서 있는 x 위치 → 키퍼 기준 로컬 좌표로 계획
  function planDive(Dw, rootX, opt) {
    opt = opt || { reach: 1, time: 1 };
    const D = new V3(Dw.x - rootX, Dw.y, 0);
    const hip0 = new THREE.Vector2(0, 0.91);
    const dx = D.x - hip0.x, dy = D.y - hip0.y;
    const dist = Math.hypot(dx, dy);
    const REACH = 1.18, MAX_T = PK.Tune.maxT * opt.reach; // 최대 다이빙 거리(엉덩이 이동)
    if (Math.abs(D.x) < 0.75) {
      // 가운데: 버티기/점프
      const jump = D.y > 1.7;
      return { mode: 'center', H: new THREE.Vector2(D.x * 0.5, jump ? 0.97 + Math.min(0.45, (D.y - 1.7) * 0.8) : (D.y < 0.6 ? 0.72 : 0.9)), theta: -D.x * 0.25, T: jump ? 0.42 : 0.3, D, jump };
    }
    const travel = clamp(dist - REACH, 0, MAX_T);
    const H = new THREE.Vector2(hip0.x + (dx / dist) * travel, hip0.y + (dy / dist) * travel);
    H.y = clamp(H.y, 0.42, 1.45);
    // 공중으로 뜨는 다이빙
    let theta = Math.atan2(-(D.x - H.x), D.y - H.y);
    theta = clamp(theta, -1.78, 1.78);
    const T = (0.36 + PK.Tune.diveTime * (travel / 1.72)) * opt.time; // 멀리 날수록 시간이 더 걸림
    // slack: 남은 다이빙 여유 거리 → 날아가는 중 공 쪽으로 더 뻗을 수 있는 양 (미리 옆으로 서 있을수록 큼)
    return { mode: 'dive', H, theta, T, D, side: Math.sign(D.x), slack: MAX_T - travel };
  }

  // ---------- 자세 전환 블렌딩 ----------
  // 동작 모드(대기/달리기/멈칫/세리머니 등)가 바뀌는 순간 직전 자세를 기억해 두고 dur 초 동안 섞음 → 뚝 끊기는 전환 제거
  const POSE_J = ['hips', 'spine', 'head', 'armL', 'armR', 'elbowL', 'elbowR', 'legL', 'legR', 'kneeL', 'kneeR', 'footL', 'footR'];
  function snapPose(P) {
    const a = [P.hips.position.x, P.hips.position.y, P.hips.position.z];
    POSE_J.forEach((j) => { const r = P[j].rotation; a.push(r.x, r.y, r.z); });
    return a;
  }
  function writePose(P, a) {
    P.hips.position.set(a[0], a[1], a[2]);
    POSE_J.forEach((j, i) => P[j].rotation.set(a[3 + i * 3], a[4 + i * 3], a[5 + i * 3]));
  }
  function poseBlend(av, mode, dur) {
    const u = av.userData, P = u.parts;
    const fresh = u.pT !== undefined && st.time - u.pT < 0.25; // 오래된 자세에서는 섞지 않음
    if (u.pMode !== undefined && u.pMode !== mode && dur > 0 && fresh && u.pLast) { u.bFrom = u.pLast; u.bT0 = st.time; u.bDur = dur; }
    u.pMode = mode;
    if (u.bFrom) {
      const w = clamp((st.time - u.bT0) / u.bDur, 0, 1);
      if (w >= 1) u.bFrom = null;
      else {
        const sm = w * w * (3 - 2 * w), cur = snapPose(P);
        writePose(P, cur.map((v, i) => lerp(u.bFrom[i], v, sm)));
      }
    }
    u.pLast = snapPose(P); u.pT = st.time;
  }

  // ---------- 애니메이션: 키퍼 ----------
  function keeperUpdate() {
    const K = st.K; if (!K) return;
    const P = K.av.userData.parts;
    // 킥 전 골라인 위에서 좌우로 조금씩 이동 (사이드 스텝)
    const mdt = K.moveT === undefined ? 0 : Math.max(0, st.time - K.moveT);
    K.moveT = st.time;
    if (st.time < K.diveStart) {
      const x = K.av.position.x, goal = K.shiftTarget || 0;
      K.av.position.x = x + clamp(goal - x, -1.6 * mdt, 1.6 * mdt);
      K.stepping = Math.abs(goal - x) > 0.01;
    }
    // 다이빙을 안 누르면 공이 거의 도착했을 때 제자리 버티기로 확정 (느린 파넨카도 끝까지 보고 뛸 수 있게)
    if (K.manual && !K.diveWorld && st.flight && (st.flight.decided || (st.ball && st.ball.p.z < KEEPER_Z + 0.8))) {
      K.timing = null;
      K.diveWorld = new V3(K.av.position.x, 1.0, 0); // 가운데 버티기 → 공을 보고 손만 반응
      K.diveStart = st.flight.t0;
      S.aim.visible = false;
      setText('instruction', '');
    }
    if (st.time >= K.diveStart && K.diveWorld && !K.dive) {
      if (K.timing === 'late' && st.shot) {
        // 공을 보고 뛰므로 실제 슛 쪽으로 크게 보정 (완벽하지는 않음)
        const tg = st.shot.target;
        K.diveWorld.set(tg.x + gauss() * 0.3, clamp(tg.y + gauss() * 0.25, 0.2, 2.3), 0);
      }
      // 늦게 뛰는 키퍼는 체중을 미리 싣지 못해 조금 느리고 덜 뻗음
      K.diveRootX = K.av.position.x;
      K.dive = planDive(K.diveWorld, K.av.position.x, K.timing === 'late' ? { reach: PK.Tune.lateReach, time: PK.Tune.lateTime }
        : K.timing === 'early' ? { reach: PK.Tune.earlyReach, time: 1 } : null); // 일찍 = 미리 체중을 실어 더 멀리
      K.stepping = false;
    }
    keeperPose();
    if (!(K.celebrate && st.time >= K.celebrate.t0)) {
      K.last = { hx: P.hips.position.x, hy: P.hips.position.y, rz: P.hips.rotation.z };
    }
  }

  // 세리머니·대기 자세로 바뀔 때만 섞음 (다이빙·버티기는 판정 범위와 정확히 일치해야 하므로 섞지 않음)
  function keeperPose() {
    const mode = keeperPoseRaw();
    poseBlend(st.K.av, mode, mode === 'celebrate' ? 0.35 : mode === 'ready' ? 0.25 : 0);
  }
  function keeperPoseRaw() {
    const K = st.K;
    const P = K.av.userData.parts;
    const t = st.time;
    PK.Avatar.resetPose(K.av);

    // 준비 자세
    const setPose = () => {
      // 무릎 반동은 부드러운 사인 곡선 (바닥에서 꺾이지 않게), 좌우 체중 이동에 맞춰 상체와 팔이 따라 흔들림
      const bf = K.stepping ? 11 : 5.5;
      const hop = (0.5 - 0.5 * Math.cos(t * bf * 2)) * (K.stepping ? 0.045 : 0.025);
      const sway = K.stepping ? 0 : Math.sin(t * 1.3);
      const lean = K.stepping ? clamp((K.shiftTarget || 0) - K.av.position.x, -0.3, 0.3) : 0;
      P.hips.position.set(sway * 0.12, 0.89 + hop, 0);
      P.hips.rotation.z = -sway * 0.03 - lean * 0.25;
      P.spine.rotation.x = 0.22 + Math.sin(t * bf * 2) * 0.015;
      P.spine.rotation.z = sway * 0.05 + lean * 0.2;
      P.head.rotation.set(-0.2, 0, -sway * 0.04 - lean * 0.1);
      ['L', 'R'].forEach((s, i) => {
        const sg = i === 0 ? 1 : -1;
        const w = 1 + sg * sway * 0.25; // 체중이 실린 쪽 무릎이 조금 더 굽음
        P['leg' + s].rotation.set(-0.35 * w, 0, sg * 0.12 + sway * 0.03);
        P['knee' + s].rotation.x = 0.62 * w;
        P['foot' + s].rotation.x = -0.28 * w;
        P['arm' + s].rotation.set(-0.3 + Math.sin(t * 2.1 + i) * 0.06, 0, sg * (0.55 + Math.sin(t * 1.7 + i * 2) * 0.05));
        P['elbow' + s].rotation.x = -0.6 - Math.sin(t * 2.1 + i) * 0.08;
      });
    };

    if (K.celebrate && t >= K.celebrate.t0) {
      const f = clamp((t - K.celebrate.t0) / 0.9, 0, 1), e = easeInOut(f);
      const c = K.last || { hx: 0, hy: 0.97, rz: 0 };
      P.hips.position.set(lerp(c.hx, c.hx, e), lerp(c.hy, 0.97, e) + (f >= 1 ? Math.abs(Math.sin(t * 7)) * 0.12 : 0), 0);
      P.hips.rotation.z = lerp(c.rz, 0, e);
      P.armL.rotation.z = lerp(2.9, 2.75 + Math.sin(t * 9) * 0.15, e);
      P.armR.rotation.z = -lerp(2.9, 2.75 + Math.sin(t * 9 + 1) * 0.15, e);
      P.elbowL.rotation.x = P.elbowR.rotation.x = -0.3;
      ['L', 'R'].forEach((sd) => { P['knee' + sd].rotation.x = f >= 1 ? 0.2 + Math.abs(Math.sin(t * 7)) * 0.3 : 0.2; }); // 점프할 때 무릎으로 받기
      P.head.rotation.x = -0.25 * e;
      return 'celebrate';
    }

    if (!K.dive || t < K.diveStart) { setPose(); K.hipStartX = P.hips.position.x; return 'ready'; }

    const d = K.dive;
    const tau = t - K.diveStart;
    const f = clamp(tau / d.T, 0, 1);
    const e = easeOut2(f), er = easeOut3(f);
    const hx0 = K.hipStartX || 0;

    // 반응: 킥 후 약 0.2초가 지나면 공을 보고 제한된 속도/범위로 손과 몸을 보정
    const kdt = K.lastT === undefined ? 0 : Math.max(0, t - K.lastT);
    K.lastT = t;
    if (!K.re) K.re = { x: d.D.x, y: d.D.y, rz: 0 };
    const seesBall = st.shot && st.flight && tau > 0.06 + 0.2;
    if (seesBall) {
      const tx = st.shot.target.x - K.av.position.x, ty = st.shot.target.y;
      const step = (cur, goal, rate) => cur + clamp(goal - cur, -rate * kdt, rate * kdt);
      K.re.x = step(K.re.x, clamp(tx, d.D.x - 0.7, d.D.x + 0.7), 3.2);
      K.re.y = step(K.re.y, clamp(ty, d.D.y - 0.6, d.D.y + 0.6), 3.2);
    }

    if (d.mode === 'center') {
      const shift = clamp(K.re.x - d.D.x, -0.45, 0.45);
      P.hips.position.set(lerp(hx0, d.H.x, e) + shift * 0.6, lerp(0.89, d.H.y, e) + (d.jump ? Math.sin(f * Math.PI) * 0.1 : 0), 0);
      P.hips.rotation.z = d.theta * e - clamp(K.re.x - P.hips.position.x, -0.6, 0.6) * 0.35;
      if (d.jump) {
        P.armL.rotation.z = lerp(0.55, Math.PI + 0.1, er); P.armR.rotation.z = -lerp(0.55, Math.PI + 0.1, er);
      } else {
        // 공이 올 높이로 두 손을 몸 앞에 모아 막기
        const shoulderY = P.hips.position.y + 0.5;
        const ang = Math.acos(clamp((shoulderY - K.re.y) / 0.62, -1, 1));
        const side = clamp((K.re.x - P.hips.position.x) * 0.6, -0.5, 0.5);
        P.armL.rotation.set(lerp(-0.3, -ang, er), 0, lerp(0.55, 0.05 + side, er));
        P.armR.rotation.set(lerp(-0.3, -ang, er), 0, lerp(-0.55, -0.05 + side, er));
      }
      P.elbowL.rotation.x = P.elbowR.rotation.x = -0.25;
      const crouch = d.H.y < 0.85 ? 1 : 0.4;
      const spring = Math.sin(f * Math.PI);
      ['L', 'R'].forEach((s, i) => {
        const sg = i === 0 ? 1 : -1;
        P['leg' + s].rotation.set(-0.45 * crouch - (d.jump ? spring * 0.35 : 0), 0, sg * lerp(0.12, 0.35, e));
        P['knee' + s].rotation.x = 0.8 * crouch + (d.jump ? spring * 0.6 : spring * 0.12);
        P['foot' + s].rotation.x = d.jump ? lerp(-0.3, 0.45, spring) : -0.3;
      });
      P.spine.rotation.x = lerp(0.22, 0.15, e);
      P.head.rotation.x = lerp(-0.2, d.jump ? -0.45 : -0.1, e);
      return 'center';
    }

    // 다이빙: 살짝 주저앉았다가(반동) 공 쪽 다리로 밀어 날아오르고, 몸을 활처럼 휘며 손끝까지 뻗은 뒤 착지 충격을 흡수
    const side = d.side;
    let hx = lerp(hx0, d.H.x, e), hy = lerp(0.89, d.H.y, e) + Math.sin(f * Math.PI) * 0.12;
    hy -= Math.sin(clamp(f / 0.16, 0, 1) * Math.PI) * 0.04; // 반동
    let rz = d.theta * er;
    if (K.re.hx === undefined) { K.re.hx = 0; K.re.hy = 0; }
    if (seesBall && tau < d.T) {
      // 날아가는 중에도 손끝 방향을 조금 보정
      const want = clamp(Math.atan2(-(K.re.x - hx), K.re.y - hy) - d.theta, -0.22, 0.22);
      K.re.rz += clamp(want - K.re.rz, -1.6 * kdt, 1.6 * kdt);
      // 남은 여유 거리만큼 몸을 공 쪽으로 더 뻗기 (바깥쪽은 slack 한도, 안쪽은 0.45m)
      const out = Math.min(PK.Tune.stretch, d.slack);
      const lo = d.side > 0 ? -0.45 : -out, hi = d.side > 0 ? out : 0.45;
      const wantX = clamp(K.re.x - d.D.x, lo, hi), wantY = clamp(K.re.y - d.D.y, -0.3, 0.3);
      K.re.hx += clamp(wantX - K.re.hx, -2.2 * kdt, 2.2 * kdt);
      K.re.hy += clamp(wantY - K.re.hy, -1.5 * kdt, 1.5 * kdt);
    }
    hx += K.re.hx; hy += K.re.hy;
    rz += K.re.rz;
    let land = 0;
    if (tau > d.T) {
      // 착지: 중력처럼 떨어지며 옆으로 눕기
      const g = clamp((tau - d.T) / 0.38, 0, 1);
      hy = lerp(d.H.y + K.re.hy, 0.2, g * g);
      rz = lerp(d.theta + K.re.rz, side * -1.5, Math.min(1, g * 1.4));
      land = g;
      if (g >= 1) { const a = tau - d.T - 0.38; hy += Math.abs(Math.sin(a * 13)) * 0.03 * Math.exp(-a * 6); } // 땅에 닿고 작게 튕김
    }
    // 몸통을 활처럼: 기울기를 골반과 상체가 나눠 가짐 (어깨에서 본 방향은 그대로 → 손 위치 유지)
    const arc = d.theta * 0.12 * Math.sin(Math.min(1, f * 1.25) * Math.PI * 0.5) * (1 - land);
    P.hips.position.set(hx, hy, 0);
    P.hips.rotation.z = rz - arc;
    P.spine.rotation.z = arc;
    P.hips.rotation.y = -side * 0.12 * er; // 몸통이 살짝 앞으로 열림
    P.spine.rotation.x = lerp(0.22, 0, e) + land * 0.18; // 준비 자세의 숙임에서 펴졌다가, 착지하며 웅크림
    // 머리: 공을 끝까지 봄
    P.head.rotation.set(lerp(-0.2, -0.05, e), 0, -d.theta * 0.22 * er * (1 - land));
    // 팔: 공 쪽 팔이 먼저 뻗고 반대쪽 팔이 반 박자 늦게 따라옴, 팔꿈치는 출발 때만 살짝 굽었다 펴짐
    const lead = side > 0 ? 'L' : 'R', trail = side > 0 ? 'R' : 'L';
    const reachUp = (q) => lerp(0.55, Math.PI + 0.16, easeOut3(clamp(q, 0, 1)));
    // 팔 뻗는 속도는 판정 범위와 같게 유지 (공 쪽 팔만 아주 살짝 먼저)
    let upLead = reachUp(f), upTrail = reachUp(f);
    const down = clamp((tau - d.T - 0.55) / 0.35, 0, 1) * 0.55; // 완전히 눕고 나서 팔을 내려 땅을 짚음 (튕긴 공 판정에 영향 없게 늦게)
    upLead -= down; upTrail -= down;
    const sg = (sd) => (sd === 'L' ? 1 : -1);
    P['arm' + lead].rotation.set(0, 0, sg(lead) * upLead);
    P['arm' + trail].rotation.set(0, 0, sg(trail) * upTrail);
    const bend = 0.3 * Math.sin(clamp(f / 0.22, 0, 1) * Math.PI); // 출발 순간에만 팔꿈치가 굽었다 펴짐
    P['elbow' + lead].rotation.x = -0.05 - bend * 0.6 - down * 0.5;
    P['elbow' + trail].rotation.x = -0.05 - bend - down * 0.5;
    // 다리: 공 쪽 다리는 굽혔다가 힘차게 펴며 밀고 곧게 따라감, 반대쪽 다리는 무릎을 끌어올렸다 살짝 펴짐
    const near = side > 0 ? 'L' : 'R', far = side > 0 ? 'R' : 'L';
    const push = clamp(f / 0.3, 0, 1);
    P['leg' + near].rotation.set(lerp(-0.35, -0.1, easeOut2(push)), 0, side * lerp(0.12, 0.15, e));
    P['knee' + near].rotation.x = push < 0.35 ? lerp(0.62, 0.8, push / 0.35) : lerp(0.8, 0.15, easeOut2((push - 0.35) / 0.65));
    P['foot' + near].rotation.x = lerp(-0.28, 0.55, push);
    const tuck = Math.sin(clamp(f / 0.75, 0, 1) * Math.PI);
    P['leg' + far].rotation.set(lerp(-0.35, -0.6, e) - tuck * 0.15, 0, -side * lerp(0.12, 0.25, e));
    P['knee' + far].rotation.x = lerp(0.62, 1.1, e) + tuck * 0.25;
    P['foot' + far].rotation.x = lerp(-0.28, 0.35, e);
    if (land > 0) { // 착지: 두 무릎을 굽혀 충격 흡수
      ['L', 'R'].forEach((sd) => { P['knee' + sd].rotation.x = lerp(P['knee' + sd].rotation.x, 0.85, land); });
      P['leg' + near].rotation.x = lerp(P['leg' + near].rotation.x, -0.45, land);
    }
    return 'dive';
  }

  // 키퍼 충돌 캡슐 계산 (렌더된 자세와 정확히 일치)
  function keeperCapsules(dt) {
    const K = st.K; const P = K.av.userData.parts;
    K.av.updateMatrixWorld(true);
    const pt = (obj, x, y, z) => new V3(x, y, z).applyMatrix4(obj.matrixWorld);
    const hips = pt(P.hips, 0, -0.02, 0);
    const neck = pt(P.spine, 0, 0.58, 0);
    const head = pt(P.head, 0, 0.01, 0);
    const shL = pt(P.armL, 0, 0, 0), shR = pt(P.armR, 0, 0, 0);
    const elL = pt(P.elbowL, 0, 0, 0), elR = pt(P.elbowR, 0, 0, 0);
    const hdL = pt(P.handL, 0, -0.03, 0), hdR = pt(P.handR, 0, -0.03, 0);
    const lgL = pt(P.legL, 0, 0, 0), lgR = pt(P.legR, 0, 0, 0);
    const knL = pt(P.kneeL, 0, 0, 0), knR = pt(P.kneeR, 0, 0, 0);
    const ftL = pt(P.footL, 0, -0.02, 0.06), ftR = pt(P.footR, 0, -0.02, 0.06);
    const caps = [
      { a: hips, b: neck, r: 0.155, part: 'body' },
      { a: head, b: head, r: 0.13, part: 'body' },
      { a: shL, b: elL, r: 0.065, part: 'arm' }, { a: elL, b: hdL, r: 0.06, part: 'arm' },
      { a: shR, b: elR, r: 0.065, part: 'arm' }, { a: elR, b: hdR, r: 0.06, part: 'arm' },
      { a: hdL, b: hdL, r: 0.095, part: 'hand' }, { a: hdR, b: hdR, r: 0.095, part: 'hand' },
      { a: lgL, b: knL, r: 0.085, part: 'leg' }, { a: knL, b: ftL, r: 0.07, part: 'leg' },
      { a: lgR, b: knR, r: 0.085, part: 'leg' }, { a: knR, b: ftR, r: 0.07, part: 'leg' },
    ];
    // 속도 추정
    caps.forEach((c, i) => {
      const mid = c.a.clone().add(c.b).multiplyScalar(0.5);
      const prev = K.prev && K.prev[i];
      c.vel = prev && dt > 0 ? mid.clone().sub(prev).multiplyScalar(1 / dt) : new V3();
      if (c.vel.length() > 12) c.vel.setLength(12);
      c.mid = mid;
    });
    K.prev = caps.map((c) => c.mid);
    K.hands = [hdL, hdR];
    return caps;
  }

  // ---------- 애니메이션: 키커 ----------
  // 키커는 판정에 쓰이지 않으므로 모든 전환을 섞음 (달리기→킥은 동작 안에서 이미 이어짐)
  const KICKER_BLEND = { react: 0.3, idle: 0.3, pause: 0.16, run: 0.2, kick: 0 };
  function kickerUpdate() {
    const mode = kickerPoseRaw();
    if (mode) poseBlend(st.Kk.av, mode, KICKER_BLEND[mode] || 0);
  }
  function kickerPoseRaw() {
    const Kk = st.Kk; if (!Kk) return null;
    const av = Kk.av, P = av.userData.parts, t = st.time;
    PK.Avatar.resetPose(av);

    if (Kk.react) {
      const f = clamp((t - Kk.react.t0) / 0.5, 0, 1);
      if (Kk.react.good) { // 골 세리머니: 양팔 번쩍 + 점프
        P.armL.rotation.z = lerp(0.12, 2.7, f); P.armR.rotation.z = -lerp(0.12, 2.7, f);
        P.hips.position.y = 0.97 + (f >= 1 ? (0.5 - 0.5 * Math.cos(t * 12)) * 0.16 : 0);
        P.kneeL.rotation.x = P.kneeR.rotation.x = f >= 1 ? 0.15 + (0.5 + 0.5 * Math.cos(t * 12)) * 0.35 : 0.15 * f;
        P.head.rotation.x = -0.3 * f;
      } else { // 아쉬움: 머리 감싸기
        P.armL.rotation.set(-2.2 * f, 0, 0.5 * f); P.armR.rotation.set(-2.2 * f, 0, -0.5 * f);
        P.elbowL.rotation.x = P.elbowR.rotation.x = -1.9 * f;
        P.spine.rotation.x = 0.35 * f; P.head.rotation.x = 0.3 * f;
      }
      return 'react';
    }

    const run = Kk.run;
    if (!run) { // 대기: 숨 고르기
      P.hips.position.y = 0.97 + Math.sin(t * 2) * 0.008;
      P.spine.rotation.x = 0.06;
      P.head.rotation.x = 0.1;
      return 'idle';
    }
    // 멈칫 처리: AI 는 정해둔 시점/길이, 사람은 누르고 있는 동안 (최소 0.3초, 최대 1초)
    if (run.ai && !run.stutterUsed && t - run.t0 - run.pausedTotal >= run.ai.at) startStutter(true);
    if (run.paused) {
      const held = t - run.pauseStart;
      if (run.ai && held >= run.ai.dur) run.releaseReq = true;
      if ((run.releaseReq && held >= 0.3) || held >= 1.0) {
        run.paused = false; run.pausedTotal += held;
        $('btn-stutter-touch').classList.remove('on');
      }
    }
    let tau = (run.paused ? run.pauseStart : t) - run.t0 - run.pausedTotal;
    // 키퍼 쪽에 남은 시간 알려주기 (사람 키퍼 타이밍 판정, AI '보통' 타이밍)
    const K = st.K;
    if (K && !run.kicked) {
      const remain = run.contact - tau;
      K.expectedContact = t + remain + (run.paused ? 0.3 : 0);
      if (!K.manual && K.timing === 'normal' && K.diveStart === Infinity && !run.paused && remain <= 0.06) K.diveStart = t;
    }
    if (run.paused) {
      // 멈칫: 그 자리에서 멈춰 서서 키퍼를 지켜봄
      const f = clamp(tau / run.approach, 0, 1);
      av.position.copy(runPos(f));
      av.rotation.y = runYaw(f);
      const w = (t - run.pauseStart) * 3;
      P.legL.rotation.x = -0.3 * Math.sin(Math.min(1, w) * Math.PI * 0.5); P.legR.rotation.x = 0.25;
      P.kneeL.rotation.x = 0.3; P.kneeR.rotation.x = 0.4;
      P.armL.rotation.set(-0.2, 0, 0.5); P.armR.rotation.set(0.2, 0, -0.5);
      P.hips.position.y = 0.94; P.spine.rotation.x = 0.2; P.head.rotation.x = -0.15;
      return 'pause';
    }
    // 달리기 자세 (보폭 위상 ph): 마지막 걸음에 왼발(디딤발)이 앞으로 나오고 오른발이 뒤로 가도록 위상을 맞춤
    const runPose = (ph, amp) => {
      const sw = Math.sin(ph) * 0.7 * amp;
      return {
        legL: -sw, legR: sw,
        kneeL: (Math.max(0, Math.sin(ph - 1.2)) * 1.2 + 0.1) * amp,
        kneeR: (Math.max(0, Math.sin(ph + Math.PI - 1.2)) * 1.2 + 0.1) * amp,
        armLx: sw * 0.8, armRx: -sw * 0.8, armLz: 0.12, armRz: -0.12, elbow: -1.2,
        hipsY: 0.95 + Math.abs(Math.cos(ph)) * 0.05 * amp, spineX: 0.15, spineZ: 0, hipsRY: 0,
      };
    };
    const phaseAt = (tt) => RUN_W * (tt - run.approach) + RUN_PH_END;
    if (tau < run.approach) {
      const f = tau / run.approach;
      av.position.copy(runPos(f));
      av.rotation.y = runYaw(f);
      // 출발 직후엔 보폭이 작고 점점 커짐
      applyPose(P, runPose(phaseAt(tau), Math.min(1, 0.45 + f * 1.2)));
      return 'run';
    }
    // 킥 동작: 달려온 속도 그대로 몸이 앞으로 흘러가며 차고, 차고 난 뒤 한두 걸음 더 나감
    const k = tau - run.approach; // 0 ~
    const c = carry(k);
    av.position.copy(RUN_END).addScaledVector(RUN_DIR, c);
    av.rotation.y = runYaw(1);
    const kp = { legL: 0, legR: 0, kneeL: 0, kneeR: 0, armLx: -0.3, armRx: 0.4, armLz: 1.0, armRz: -0.6, elbow: -0.4,
      hipsY: 0.965, spineX: 0.1, spineZ: 0.12, hipsRY: 0 };
    // 디딤발: 앞에 내디딘 뒤 몸이 넘어가는 만큼 뒤로 (발이 땅에서 미끄러지지 않게)
    kp.legL = -0.45 + c / 0.9; kp.kneeL = 0.35;
    if (k < 0.1) { // 백스윙: 달리던 다리가 그대로 뒤로 감김
      const q = k / 0.1, eo = 1 - (1 - q) * (1 - q);
      kp.legR = lerp(0.55, 1.05, eo); kp.kneeR = lerp(0.85, 1.75, eo);
      kp.hipsRY = lerp(0, 0.22, eo); kp.spineX = lerp(0.12, 0.03, q);
    } else if (k < 0.2) { // 앞으로 휘두르며 가속 → 임팩트: 발이 공 높이·위치에 닿음 (다리는 몸보다 살짝 앞)
      const q = (k - 0.1) / 0.1;
      kp.legR = 1.05 - 1.55 * q * q;
      kp.kneeR = lerp(1.75, 0.5, q * q * (3 - 2 * q)); // 무릎이 펴지며 임팩트
      kp.hipsRY = lerp(0.22, -0.05, q);
      kp.spineX = lerp(0.03, -0.05, q);
    } else if (k < 0.265) { // 임팩트 직후: 같은 속도로 이어서 올라가다 감속
      const q = (k - 0.2) / 0.065;
      kp.legR = -0.5 - 1.0 * (1 - (1 - q) * (1 - q));
      kp.kneeR = lerp(0.5, 0.1, q);
      kp.hipsRY = lerp(-0.05, -0.2, q);
      kp.spineX = -0.06;
    } else { // 팔로우스루 → 차는 발을 앞으로 내디디며 착지, 한 걸음 더
      const q = clamp((k - 0.265) / 0.45, 0, 1);
      kp.legR = lerp(-1.5, -0.25, easeInOut(q));
      kp.kneeR = lerp(0.1, 0.35, q);
      kp.hipsRY = lerp(-0.2, 0, q);
      kp.spineX = lerp(-0.06, 0.12, easeInOut(q));
      kp.hipsY = lerp(0.93, 0.96, q);
      // 착지한 오른발 위로 몸이 지나가면 왼발이 따라 나옴
      const q2 = clamp((k - 0.6) / 0.35, 0, 1);
      kp.legL = lerp(kp.legL, -0.35, easeInOut(q2)); kp.kneeL = lerp(0.35, 0.5, Math.sin(q2 * Math.PI));
      kp.armLz = lerp(1.0, 0.3, q); kp.armRz = lerp(-0.6, -0.25, q);
    }
    if (!run.kicked && k >= run.contact - run.approach) { run.kicked = true; launchBall(); }
    // 달리기 자세에서 킥 자세로 자연스럽게 섞기 (처음 0.14초)
    const wgt = clamp(k / 0.14, 0, 1);
    const sm = wgt * wgt * (3 - 2 * wgt);
    const rp = runPose(phaseAt(tau), 1);
    const mix = {};
    for (const key in kp) mix[key] = lerp(rp[key], kp[key], sm);
    applyPose(P, mix);
    P.footR.rotation.x = 0.5 * sm; // 발등으로 차기
    return 'kick';
  }
  function applyPose(P, p) {
    P.legL.rotation.x = p.legL; P.legR.rotation.x = p.legR;
    P.kneeL.rotation.x = p.kneeL; P.kneeR.rotation.x = p.kneeR;
    P.armL.rotation.set(p.armLx, 0, p.armLz); P.armR.rotation.set(p.armRx, 0, p.armRz);
    P.elbowL.rotation.x = P.elbowR.rotation.x = p.elbow;
    P.hips.position.y = p.hipsY; P.hips.rotation.y = p.hipsRY;
    P.spine.rotation.x = p.spineX; P.spine.rotation.z = p.spineZ;
  }

  // ---------- 공 비행 ----------
  function flightUpdate(dt) {
    const F = st.flight; if (!F) return;
    const b = st.ball;
    F.env.keeper = keeperCapsules(dt);
    const sub = Math.ceil(dt / (1 / 600));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      const events = [];
      PK.Physics.step(b, h, F.env, events);
      events.forEach((ev) => handleEvent(ev));
      if (b.held && st.K.hands) { b.p.copy(st.K.hands[0]).add(st.K.hands[1]).multiplyScalar(0.5); b.p.z += 0.08; }
      // 골라인 통과 판정
      if (!F.decided && b.p.z < -BR) {
        F.decided = true;
        if (Math.abs(b.p.x) < G.halfW + G.postR && b.p.y < G.h + G.postR) {
          b.inGoal = true; F.outcome = 'goal';
          later(0.35, () => resolve());
        } else {
          F.outcome = b.p.y >= G.h ? 'over' : 'wide';
        }
      }
      // 빗나간 공은 광고판에서 튕김
      if (!b.inGoal && b.p.z < -4.3 && b.v.z < 0) { b.v.z *= -0.3; b.v.x *= 0.5; }
      if (b.p.z < -4.4) b.p.z = -4.4;
    }
    const T = st.time - F.t0;
    if (!F.resolved && F.outcome !== 'goal') {
      const stopped = b.v.length() < 1.2 && b.p.y < 0.2;
      if (F.events.catch && T > 0.3) resolve();
      else if (F.outcome && T > 1.2) resolve();
      else if (stopped || T > 3.2 || b.p.z > 15) resolve();
    }
    // 공 회전 표시
    const sp = Math.hypot(b.v.x, b.v.z);
    if (!b.held && sp > 0.05) {
      const axis = new V3(b.v.z, 0, -b.v.x).normalize();
      S.ball.rotateOnWorldAxis(axis, (sp / BR) * dt);
      S.ball.rotateOnWorldAxis(new V3(0, 1, 0), b.spin.y * 25 * dt);
    }
    S.ball.position.copy(b.p);

    // 카메라: 공을 따라 살짝
    if (!F.resolved) {
      const look = new V3(b.p.x * 0.5, Math.max(0.9, b.p.y * 0.7), Math.max(0, b.p.z * 0.3));
      setCam(new V3(0.8 + b.p.x * 0.15, 2.0, 15.0), look, 2);
    }
  }

  function handleEvent(ev) {
    const F = st.flight;
    switch (ev.type) {
      case 'post': F.events.post = true; PK.Audio.post(); break;
      case 'keeper': F.events.keeper = true; PK.Audio.glove(); break;
      case 'catch': F.events.catch = true; F.events.keeper = true; PK.Audio.glove(); break;
      case 'net': S.net.hit(ev.point, Math.min(6, ev.speed * 0.35)); PK.Audio.net(); st.netHits = (st.netHits || 0) + 1; break;
      case 'bounce': if (ev.speed > 2) PK.Audio.bounce(); break;
    }
  }

  function resolve() {
    const F = st.flight;
    if (!F || F.resolved || F.observer) return;
    F.resolved = true;
    const goal = F.outcome === 'goal';
    let text, cls;
    if (goal) {
      text = F.events.post ? '골대 맞고 골!' : F.events.keeper ? '손 맞고 골!'
        : st.shot.redirected ? '역모션 골!' : st.shot.type === 'panenka' ? '파넨카!!' : '골!!';
      cls = 'goal';
    } else if (F.events.catch) { text = '캐치!'; cls = 'save'; }
    else if (F.events.keeper) { text = '선방!'; cls = 'save'; }
    else if (F.events.post) { text = '골대!'; cls = 'miss'; }
    else if (F.outcome === 'over') { text = '홈런…'; cls = 'miss'; }
    else { text = '빗나감!'; cls = 'miss'; }

    if (online()) { PK.Online.set({ res: { gid: st.gid, n: kickN(), goal, text, cls } }); st.liveFrozen = true; }
    showResult(goal, text, cls);
  }

  function showResult(goal, text, cls) {
    if (st.flight) st.flight.resolved = true; // 키커 쪽 시뮬레이션도 결과 카메라로 넘김
    const rt = $('result-text');
    rt.textContent = text;
    rt.className = 'result-text show ' + cls;
    st.kicks[st.kickerTeam].push(goal);
    logShot(cls, text);
    updateScoreboard();

    if (goal) { PK.Audio.cheer(); S.crowd.excite = 1; } else { PK.Audio.groan(); S.crowd.excite = 0.4; }
    st.Kk.react = { t0: st.time, good: goal };
    if (cls === 'save') st.K.celebrate = { t0: st.time + 0.6 }; // 잠시 후 일어나서 환호
    // 리플레이 느낌의 카메라
    const b = st.ball.p;
    setCam(new V3(goal ? 4.5 : -4.5, 2.0, 6.5), new V3(b.x * 0.5, 1.0, Math.min(b.z, 2)), 1.2);
    st.state = 'result';
    later(2.8, () => { S.crowd.excite = 0; nextKick(); });
  }

  // ---------- 슛 지도 (경기 후, 키커 시점에서 본 골대 위에 찬 위치와 결과) ----------
  function logShot(cls, text) {
    const t = st.kickerTeam;
    const p = st.shot && st.shot.target;
    if (!st.shotLog) st.shotLog = [];
    st.shotLog.push({ team: t, n: st.kicks[t].length, x: p ? p.x : 0, y: p ? p.y : 1, cls, text, type: st.shot ? st.shot.type : '' });
  }
  const TYPE_NAME = { curl: '감아차기', instep: '인스텝', panenka: '파넨카' };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svgEl = (name, attrs, parent) => { const e = document.createElementNS(SVG_NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; };
  // 한 팀의 슛 지도 카드 (mini = 킥 준비 중 화면 구석에 띄우는 작은 버전)
  function shotCard(team, mini) {
    const SX = (x) => (x + 4.6) * 100, SY = (y) => (3.3 - y) * 100;
    const shots = (st.shotLog || []).filter((k) => k.team === team);
    const card = document.createElement('div');
    card.className = 'sm-card' + (mini ? ' mini' : '');
    const head = document.createElement('div');
    head.className = 'sm-head';
    const name = document.createElement('b');
    const teamName = st.teams[team] ? st.teams[team].name : (team + 1) + 'P';
    name.textContent = mini ? teamName + ' 킥 전적' : teamName;
    const tally = document.createElement('span'); tally.textContent = `${shots.filter((k) => k.cls === 'goal').length} / ${shots.length} 골`;
    head.append(name, tally);
    const svg = svgEl('svg', { viewBox: '0 0 920 360', class: 'sm-svg', role: 'img', 'aria-label': teamName + ' 슛 위치' });
    svgEl('rect', { x: 0, y: SY(0), width: 920, height: 30, class: 'sm-grass' }, svg);
    svgEl('rect', { x: SX(-G.halfW), y: SY(G.h), width: G.halfW * 200, height: G.h * 100, class: 'sm-net' }, svg);
    // 골대를 3x3 구역으로 나누는 보조선
    for (const gx of [-G.halfW / 3, G.halfW / 3]) svgEl('line', { x1: SX(gx), y1: SY(G.h), x2: SX(gx), y2: SY(0), class: 'sm-grid' }, svg);
    for (const gy of [G.h / 3, G.h * 2 / 3]) svgEl('line', { x1: SX(-G.halfW), y1: SY(gy), x2: SX(G.halfW), y2: SY(gy), class: 'sm-grid' }, svg);
    svgEl('path', { d: `M${SX(-G.halfW)} ${SY(0)} V${SY(G.h)} H${SX(G.halfW)} V${SY(0)}`, class: 'sm-post' }, svg);
    shots.forEach((k, i) => {
      const cx = SX(Math.max(-4.4, Math.min(4.4, k.x))), cy = SY(Math.max(0.15, Math.min(3.1, k.y)));
      const g = svgEl('g', { class: 'sm-shot ' + k.cls + (i === shots.length - 1 ? ' last' : '') }, svg);
      svgEl('title', {}, g).textContent = `${k.n}번째 킥 · ${TYPE_NAME[k.type] || ''} · ${k.text}`;
      if (k.cls === 'miss') {
        svgEl('path', { d: `M${cx - 22} ${cy - 22} L${cx + 22} ${cy + 22} M${cx + 22} ${cy - 22} L${cx - 22} ${cy + 22}`, class: 'sm-x' }, g);
        svgEl('text', { x: cx > 800 ? cx - 28 : cx + 28, y: cy < 60 ? cy + 22 : cy - 20, class: 'sm-num out' + (cx > 800 ? ' left' : '') }, g).textContent = k.n;
      } else {
        svgEl('circle', { cx, cy, r: 34, class: 'sm-dot' }, g);
        svgEl('text', { x: cx, y: cy + 1, class: 'sm-num' }, g).textContent = k.n;
      }
    });
    card.append(head, svg);
    return card;
  }
  function renderShotMap() {
    const box = $('shot-map');
    if (!box) return;
    box.textContent = '';
    if (!(st.shotLog || []).length) { box.hidden = true; return; }
    box.hidden = false;
    box.append(shotCard(0, false), shotCard(1, false));
    const legend = document.createElement('div');
    legend.className = 'sm-legend';
    legend.innerHTML = '<span><i class="lg goal"></i>골</span><span><i class="lg save"></i>선방</span><span><i class="lg miss">✕</i>빗나감·골대</span><span class="sm-note">숫자 = 킥 순서 · 키커 쪽에서 본 골대</span>';
    box.appendChild(legend);
  }
  // 킥 준비 중: 지금 차는 팀의 지난 킥 위치를 구석에 (키커는 패턴을 바꾸고, 키퍼는 습관을 읽고)
  function updateShotMini() {
    const box = $('shot-mini');
    if (!box) return;
    const t = st.kickerTeam;
    const show = ['kickerAim', 'keeperReady', 'runup'].includes(st.state) && (st.shotLog || []).some((k) => k.team === t);
    if (!show) { if (!box.hidden) box.hidden = true; return; }
    const key = t + ':' + st.shotLog.length;
    if (box.dataset.key !== key) { box.dataset.key = key; box.textContent = ''; box.appendChild(shotCard(t, true)); }
    box.hidden = false;
  }

  // ---------- 경기 종료 ----------
  function endMatch(w) {
    st.state = 'end';
    hideKickUI();
    setText('role-banner', ''); setText('instruction', '');
    const humanWin = online() ? isLocal(w) : st.teams[w].human;
    let title = st.mode === 'multi' ? `${st.teams[w].name} 승리! 🏆` : (humanWin ? '승리! 🏆' : '패배…');
    $('btn-again').textContent = '다시 하기';
    if (st.tour) {
      // 토너먼트: 결과를 바로 기록 (로비로 나가도 남음), 버튼은 대진표로
      const sd = st.kicks[0].length > 5;
      PK.Tour.report(humanWin, goals(0), goals(1), sd);
      title = humanWin ? (st.tour.round === 2 ? '우승! 🏆' : `${st.tour.roundName} 승리! 🎉`) : (st.tour.round === 2 ? '준우승 🥈' : `${st.tour.roundName} 탈락…`);
      $('btn-again').textContent = '대진표 보기';
    }
    // 온라인: 다시 하기는 방장만 (참가자는 방장을 기다림)
    $('btn-again').hidden = online() && !PK.Online.isHost;
    $('result-wait').hidden = !(online() && !PK.Online.isHost);
    setText('result-title', title);
    setText('result-score', `${goals(0)} : ${goals(1)}`);
    renderShotMap();
    show('result', true);
    if (humanWin) { PK.Audio.cheer(); S.crowd.excite = 1; }
    // 승자 키커 세리머니
    st.avatars.forEach((a, i) => { a.kicker.visible = i === w; a.keeper.visible = false; });
    const av = st.avatars[w].kicker;
    av.position.set(0, 0, 9); av.rotation.set(0, 0, 0);
    st.Kk = { av, run: null, react: { t0: st.time, good: true } };
    st.K = null;
    st.ball.held = false; S.ball.position.set(0.5, BR, 8.5);
    setCam(new V3(1.4, 1.5, 14.8), new V3(0, 1.0, 9), 1.5);
  }

  // ---------- 매 프레임 ----------
  const raycaster = new THREE.Raycaster();
  const goalPlane = new THREE.Plane(new V3(0, 0, 1), 0);
  function updateAim(dt) {
    const target = st.aim;
    const lim = { x: 4.8, y0: BR, y1: 3.4 };
    const k = st.keys;
    const sp = 2.6 * dt;
    let moved = false;
    if (k.ArrowLeft || k.KeyA) { target.x -= sp; moved = true; }
    if (k.ArrowRight || k.KeyD) { target.x += sp; moved = true; }
    if (k.ArrowUp || k.KeyW) { target.y += sp; moved = true; }
    if (k.ArrowDown || k.KeyS) { target.y -= sp; moved = true; }
    if (st.touchAxis.x || st.touchAxis.y) { target.x += st.touchAxis.x * sp; target.y += st.touchAxis.y * sp; moved = true; }
    if (moved) st.mouse = null;
    if (st.mouse) {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((st.mouse.x - rect.left) / rect.width) * 2 - 1, -((st.mouse.y - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = new V3();
      if (raycaster.ray.intersectPlane(goalPlane, hit)) target.set(hit.x, hit.y, 0);
    }
    target.x = clamp(target.x, -lim.x, lim.x);
    target.y = clamp(target.y, lim.y0, lim.y1);
    S.aim.position.set(target.x, target.y, 0.02);
    S.aim.lookAt(camera.position);
    S.aim.scale.setScalar(1);

    if (st.state === 'kickerAim') {
      if (st.charging) st.power = Math.min(1.2, st.power + dt * 0.85);
      $('power-fill').style.width = (st.power / 1.2) * 100 + '%';
      // 예상 궤적 (오차 없는 이상적인 궤적) - 킥 종류별 색
      const pw = st.charging ? Math.min(1, Math.max(0.3, st.power)) : 0.75;
      const L = PK.Physics.solveLaunch(SPOT, target, shotSpeed(st.kickType, pw, false), autoCurve(st.kickType, target.x));
      S.traj.material.color.set(KICK_TYPES[st.kickType].color);
      const pts = [];
      PK.Physics.flyToLine(SPOT, L.v0, L.spin, pts);
      const arr = S.traj.geometry.attributes.position.array;
      const n = Math.min(pts.length, 80);
      for (let i = 0; i < 80; i++) {
        const p = pts[Math.min(i, n - 1)] || SPOT;
        arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
      }
      S.traj.geometry.attributes.position.needsUpdate = true;
      S.traj.geometry.setDrawRange(0, n);
      S.traj.computeLineDistances();
    }
  }

  function update(dt) {
    if (!st.active) return;
    st.time += dt;
    // 타이머
    for (let i = st.timers.length - 1; i >= 0; i--) {
      if (st.time >= st.timers[i].at) { const f = st.timers[i].fn; st.timers.splice(i, 1); f(); }
    }

    if (st.state === 'coin') { // 고르는 동안 손 위에서 천천히 반짝이며 돎
      st.coin.rotation.set(Math.PI / 2, 0, Math.sin(st.time * 1.2) * 0.5); // 세로축으로 좌우로 돌며 빛을 받음 (글자는 똑바로)
      st.coin.position.y = COIN_Y0 + Math.sin(st.time * 2) * 0.015;
    }
    if (st.state === 'coinFlip') {
      const a = st.coinAnim, c = st.coin;
      const t = Math.min(st.time - a.t0, a.dur);
      if (t < a.flight) {
        const q = t / a.flight;
        c.position.set(lerp(0, 0.5, q), COIN_Y0 + a.v * t - 4.9 * t * t, lerp(11.6, 12.0, q)); // 공에서 떨어진 곳에 착지
        c.rotation.x = lerp(a.from, a.to, 1 - Math.pow(1 - q, 1.35)); // 회전이 조금씩 느려지며 떨어짐
        c.rotation.y = 0;
        c.rotation.z = Math.sin(t * 9) * 0.22 * (1 - q);               // 회전축이 흔들리는 워블
        setCam(new V3(0, 1.7, 13.8), new V3(c.position.x, c.position.y * 0.75 + 0.3, c.position.z), 3);
      } else {
        const b = t - a.flight;
        if (!a.landed) { a.landed = true; PK.Audio.coinLand(1); }
        if (b > 0.2 && !a.land2) { a.land2 = true; PK.Audio.coinLand(0.45); }
        // 잔디에 떨어져 두 번 작게 튕기고, 흔들리다 멈춤
        c.position.y = a.rest + Math.abs(Math.sin(b * 15)) * 0.05 * Math.exp(-b * 6);
        c.rotation.x = a.to + Math.sin(b * 22) * 0.14 * Math.exp(-b * 5);
        c.rotation.z = Math.sin(b * 17) * 0.09 * Math.exp(-b * 4);
        setCam(new V3(0.5, 0.95, 12.85), new V3(0.5, 0, 12.0), 3);   // 떨어진 동전을 내려다봄
      }
      if (st.time - a.t0 >= a.dur) { st.state = 'coinDone'; coinDone(); }
    }
    if (online()) onlineTick();
    if (st.state === 'kickerAim') updateAim(dt);
    updateKickTimer();
    keeperControl(dt);
    updateShotMini();

    if (st.Kk) kickerUpdate();
    if (st.K) keeperUpdate();
    if (st.state === 'flight' || (st.flight && st.state === 'result')) flightUpdate(dt);

    S.net.update(dt);
    S.crowd.update(st.time);
    S.adTex.offset.x = (st.time * 0.03) % 1;

    // 카메라 보간
    const c = st.cam;
    const k = 1 - Math.exp(-c.speed * dt);
    c.pos.lerp(c.tPos, k); c.look.lerp(c.tLook, k);
    camera.position.copy(c.pos);
    camera.lookAt(c.look);
  }

  // 온라인 상대가 나갔을 때
  function opponentLeft() {
    if (!st.active || !online()) return;
    st.oppGone = true;
    st.timers = [];
    hideKickUI();
    setText('role-banner', ''); setText('instruction', '');
    setText('result-title', '상대가 나갔어요');
    setText('result-score', `${goals(0)} : ${goals(1)}`);
    $('btn-again').hidden = true; $('result-wait').hidden = true;
    show('result', true);
    st.state = 'end';
  }

  return { init, start, update, quit, opponentLeft, get active() { return st.active; }, _st: st, _shotMap: renderShotMap, _test: { planDive, keeperPose, keeperCapsules } };
})();
