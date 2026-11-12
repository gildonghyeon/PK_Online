// 승부차기 진행: 동전 던지기 → 킥/다이빙 입력 → 물리 시뮬레이션 → 판정 → 다음 킥
window.PK = window.PK || {};

// 골키퍼 다이빙 밸런스: 최대 다이빙 거리(m), 다이빙 시간 계수, 날아가며 더 뻗을 수 있는 거리(m)
PK.Tune = { maxT: 2.05, diveTime: 0.3, stretch: 0.15, maxShift: 0.6, lateDelay: 0.08, lateReach: 1.0, lateTime: 1.0, earlyLead: 0.14, earlyReach: 1.1,
  clipDiveT: 0.85, clipDiveEase: 1.6, clipGloveR: 0.13, // 실제 다이빙 동작: 다 뻗는 시간(계획 시간 대비), 처음 가속 정도, 장갑 판정 반지름
  readX: 1.25, readY: 0.95, readRate: 6.0, // 날아가며 공 쪽으로 손을 맞추는 범위(m)·속도(m/s): 방향을 읽으면 대체로 닿게
  dirWait: 0.15 }; // 사람 키퍼가 방향 없이 스페이스를 먼저 눌렀을 때 방향 입력을 기다리는 시간(초)

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
  // 실제 페널티킥 동작(Mixamo): 몸 이동 경로를 따라 선수를 옮기고, 공을 차는 순간 오른발이 공에 닿도록 출발 위치를 정함
  //  감아차기·파넨카 = 발 안쪽으로 밀어차기(PenaltyKick) / 인스텝 = 조깅 한 걸음 뒤 다리를 크게 휘둘러 차기(InstepKick)
  const clipMeta = (n) => (PK.PlayerModel && PK.PlayerModel.meta ? PK.PlayerModel.meta(n) : null);
  const useKickClip = (av) => !!(clipMeta('PenaltyKick') && av && av.userData.anim);
  const rotXZ = (x, z, y) => [x * Math.cos(y) + z * Math.sin(y), -x * Math.sin(y) + z * Math.cos(y)];
  // 동작 시간 ct 에서 선수 위치(x, z): 공을 차는 순간 발이 공(SPOT)에 닿도록
  function clipRootAt(def, ct) {
    const p = PK.PlayerModel.pathAt(def.clip, ct), r = rotXZ(p[0] - def.m.ball[0], p[1] - def.m.ball[1], def.yaw);
    return [SPOT.x + r[0], SPOT.z + r[1]];
  }
  // 도움닫기: 킥 동작 시작 자리보다 뒤에서 출발해, 처음엔 짧은 보폭으로 천천히 걷듯 나가다가 보폭을 넓히며 확 빨라져 킥 동작으로 이어짐
  const PRE_CLIP = 'Jog_Fwd_Loop', JOG_CYCLE = 3.2; // 조깅 동작 한 주기(두 걸음)에 몸이 나가는 거리 (m, 보폭 100% 기준)
  const PRE_CAD_MIN = 1.1;                           // 최소 걸음 빠르기 (주기/초 ≈ 초당 2.2걸음): 느리게 가도 다리는 제 빠르기로 움직여 슬로모션처럼 보이지 않게
  const PUSH_RUN_D = 1.85;                           // 밀어차기 동작에 들어가는 자리 뒤로 더 물러서는 거리
  const PRE_V0 = 1.5, PRE_W0 = 0.4, PRE_POW = 3;     // 출발 속도(m/s)·보폭 비율, 가속 곡선 (클수록 오래 천천히 가다 끝에서 확 빨라짐)
  const KICK_SPEED = 1.2;                            // 킥 동작 재생 속도 (원래 동작보다 빠르고 힘차게)
  // 멈칫: 동작을 멈추지 않고, 보폭은 그대로 둔 채 달리는 속도만 조금 줄였다가 다시 원래 속도로
  const STUT_RATE = 0.5;                             // 멈칫 중 진행 속도 (평소 대비)
  const STUT_IN = 0.12, STUT_OUT = 0.1;              // 감속·재가속에 걸리는 시간 상수 (초): 놓으면 약 0.3초 만에 원래 속도
  const STUT_MAX = 1.0;                              // 멈칫 전체 시간 (누르기 시작 ~ 원래 속도 회복) 최대값
  const STUT_HOLD_MAX = STUT_MAX - 3 * STUT_OUT;     // 그래서 누르고 있을 수 있는 최대 시간 (0.7초)
  // 킥 동작 경로에서 시간 ct 의 이동 속도 (m/s, 동작 재생 속도 반영)
  const clipSpeed = (def, ct) => { const a = clipRootAt(def, ct), b = clipRootAt(def, ct + 0.1); return Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1 * KICK_SPEED; };
  function setupPreRun(def, D, dir, w1, phEnd) {
    const v0 = PRE_V0, vE = clipSpeed(def, def.ct0), entry = clipRootAt(def, def.ct0);
    const T = D / (v0 + (vE - v0) / (PRE_POW + 1)); // 속도 v(t) = v0 + (vE - v0)(t/T)^p 로 거리 D 를 감
    Object.assign(def, { pre: T, preD: D, v0, vE, entry, dir, w1, preYaw: Math.atan2(dir[0], dir[1]) });
    def.start = [entry[0] - dir[0] * D, entry[1] - dir[1] * D];
    // 보폭 위상: 몸이 나간 거리 / (한 주기 거리 × 보폭 비율) 을 쌓음. 끝 위상이 phEnd 가 되게 맞춤
    const N = 240, tab = new Float32Array(N + 1);
    for (let i = 1; i <= N; i++) {
      const t = ((i - 0.5) / N) * T;
      tab[i] = tab[i - 1] + Math.max(PRE_CAD_MIN, preV(def, t) / (JOG_CYCLE * preW(def, t))) * (T / N);
    }
    const off = phEnd - tab[N];
    for (let i = 0; i <= N; i++) tab[i] += off;
    def.phTab = tab;
  }
  const preV = (d, t) => d.v0 + (d.vE - d.v0) * Math.pow(t / d.pre, PRE_POW);
  const preS = (d, t) => d.v0 * t + ((d.vE - d.v0) * d.pre * Math.pow(t / d.pre, PRE_POW + 1)) / (PRE_POW + 1);
  const preW = (d, t) => PRE_W0 + (d.w1 - PRE_W0) * Math.pow(clamp(t / d.pre, 0, 1), 2);
  let KDEF = null;
  function kickDefs() {
    if (KDEF) return KDEF;
    const pm = clipMeta('PenaltyKick'); if (!pm) return null;
    // 밀어차기: 동작 처음(서 있다 출발하는 부분)은 건너뛰고, 이미 달리고 있는 0.2초 지점부터 이어 붙임
    const push = { clip: 'PenaltyKick', m: pm, yaw: Math.PI + 0.1, ct0: 0.2 };
    const e0 = clipRootAt(push, 0.2), e1 = clipRootAt(push, 0.35);
    let dx = e1[0] - e0[0], dz = e1[1] - e0[1], dl = Math.hypot(dx, dz); dx /= dl; dz /= dl; // 동작의 걸음 방향 그대로 달려 들어감
    setupPreRun(push, PUSH_RUN_D, [dx, dz], 0.85, 0.15);
    const start = push.start;
    KDEF = { push, swing: null, start };
    const im = clipMeta('InstepKick');
    if (im) {
      // 출발 자리를 밀어차기와 같게: 그 자리에서 공 쪽으로 곧게 달려 들어가 차도록 방향과 거리를 정함
      const Vx = SPOT.x - start[0], Vz = SPOT.z - start[1], d = Math.hypot(Vx, Vz);
      const bx = im.ball[0], bz = im.ball[1];
      const L = Math.max(0.3, Math.sqrt(Math.max(0, d * d - bx * bx)) - bz);
      const yaw = Math.atan2(Vx, Vz) - Math.atan2(bx, bz + L);
      const swing = { clip: 'InstepKick', m: im, yaw, ct0: 0 };
      setupPreRun(swing, L, rotXZ(0, 1, yaw), 1, 0.15);
      swing.start = start;
      KDEF.swing = swing;
    }
    return KDEF;
  }
  const kickDefFor = (type) => { const K = kickDefs(); return type === 'instep' && K.swing ? K.swing : K.push; };
  // 공에 발이 닿는 순간 (런업 시작부터 초)
  const kickContactT = (def) => def.pre + (def.m.contact - def.ct0) / KICK_SPEED;
  // 런업 시작 후 시간 tau 에서 선수 위치를 정하고 재생할 동작을 돌려줌
  function kickClipPose(def, tau, pos) {
    if (tau < def.pre) {
      const back = def.preD - preS(def, Math.max(0, tau));
      pos.set(def.entry[0] - def.dir[0] * back, 0, def.entry[1] - def.dir[1] * back);
      const f = clamp(tau / def.pre, 0, 1) * (def.phTab.length - 1), i = Math.min(def.phTab.length - 2, Math.floor(f));
      let ph = def.phTab[i] + (def.phTab[i + 1] - def.phTab[i]) * (f - i);
      ph -= Math.floor(ph);
      return [PRE_CLIP, { fade: 0.3, phase: ph, weight: preW(def, tau) }];
    }
    const ct = Math.min(def.ct0 + (tau - def.pre) * KICK_SPEED, def.m.duration - 0.001), r = clipRootAt(def, ct);
    pos.set(r[0], 0, r[1]);
    return [def.clip, { fade: 0.15, phase: ct / def.m.duration }];
  }
  // 도움닫기 중 몸 방향: 대기 방향 → 달리는 방향 → (킥 동작이 시작되면) 동작의 방향
  function kickYaw(def, tau, yaw0) {
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
    const y1 = yaw0 + wrap(def.preYaw - yaw0) * sm(tau / 0.3);
    return y1 + wrap(def.yaw - y1) * sm((tau - def.pre) / 0.2);
  }

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
    keys: {}, timers: [], touchAxis: { x: 0, y: 0 },
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
    // 조작은 키보드(방향키·스페이스)와 터치 화면 버튼만: 마우스 조준·클릭은 쓰지 않음
    window.addEventListener('keydown', (e) => {
      if (!st.active) return;
      st.keys[e.code] = true;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) {
          const run = st.Kk && st.Kk.run;
          if (st.state === 'handoff') $('handoff-btn').click();
          // 키커가 달려가는 중: 스페이스 = 멈칫. 한 화면 멀티(멈칫 없음)와 내가 키퍼일 때는 스페이스 = 다이빙
          else if (st.state === 'runup' && kickerHumanNow() && st.mode !== 'multi' && run && !run.kicked) startStutter(false, 'space');
          else pressAction();
        }
      }
      if (st.state === 'kickerAim' && !st.charging) {
        const kt = { Digit1: 'curl', Digit2: 'instep', Digit3: 'panenka' }[e.code];
        if (kt) setKickType(kt);
      }
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      st.keys[e.code] = false;
      if (st.active && e.code === 'Space') releaseAction();
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
    st.final = null;
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

    // 관중석을 두 팀 유니폼 색으로 나눔
    if (S.crowd.setTeams) {
      const colsOf = (t) => { const u = PK.Options.uniform[t.cfg.uniform]; return [u.c1, u.c2]; };
      S.crowd.setTeams(colsOf(st.teams[0]), colsOf(st.teams[1]));
    }
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
    st.final = null;
    st.active = false; st.state = 'idle';
    st.tour = null; PK.AI.clearProfile();
    show('hud', false);
    PK.Audio.crowd(0, 0.5);
    PK.Main.toLobby();
  }
  // 토너먼트 경기가 끝나면 대진표 화면으로 (결과는 경기 종료 순간 이미 기록됨)
  function backToTour() {
    cleanup();
    st.final = null;
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
      const txt = back ? '★ PENALTY · 11M ★' : '★ PK ONLINE ★';
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
    if (useKickClip(kicker)) { const k0 = kickDefs().push; kicker.position.set(k0.start[0], 0, k0.start[1]); kicker.rotation.set(0, k0.preYaw, 0); } // 도움닫기 출발 자리 (공을 바라봄)
    keeper.position.set(0, 0, KEEPER_Z);
    keeper.rotation.set(0, 0, 0);
    keeper.scale.set(1, 1, 1); // 반대쪽 다이빙 동작에서 뒤집었던 것 되돌림 (기울인 것도)
    keeper.userData.postAnim = null;
    // 새 라운드는 곧바로 대기 자세로 (지난 라운드의 누운 자세에서 서서히 바뀌며 이상하게 일어나지 않게)
    if (keeper.userData.anim) keeper.userData.anim('GkIdle', { fade: 0 });
    if (kicker.userData.anim) kicker.userData.anim(null, { fade: 0 });
    st.K = { av: keeper, dive: null, diveStart: Infinity, prev: null, celebrate: null };
    st.Kk = { av: kicker, run: null, react: null };

    st.ball = { p: SPOT.clone(), v: new V3(), spin: new V3(), held: false, inGoal: false, netHit: false };
    S.ball.position.copy(SPOT); S.ball.rotation.set(0, 0, 0);
    st.aim.set((Math.random() < 0.5 ? -1 : 1) * 1.6, 1.0, 0);
    st.touchAxis.x = st.touchAxis.y = 0;
    st.power = 0; st.charging = false;
    st.keeperTiming = 'normal';
    syncPanels();

    setCam(new V3(0.5, 2.7, 20.0), new V3(0, -0.2, 0), 2.5); // 도움닫기 출발 자리(공 뒤 4m 남짓)의 키커까지 보이게
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
    setText('instruction', ''); // 조작 설명은 화면에 띄우지 않음 (로비 조작법 안내로 대신)
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
      setText('instruction', '');
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
    // 아직 몸을 날리지 않았으면 킥 뒤에도 언제든 다이빙 가능 (자동 버티기 자세로 굳어 있어도 누르면 몸을 날림)
    //  예전엔 공이 키퍼 가까이 오거나 골라인을 넘으면 입력을 막아, 킥 뒤 조금만 늦게 눌러도 키퍼가 굳은 채 반응이 없었음
    //  (막을 수 있는지는 기존 판정 그대로: 늦게 뛰면 공에 못 닿음)
    const canDive = !K || !K.diveWorld || K.autoStay;
    return !!(K && K.manual && canDive && !K.celebrate && (st.state === 'keeperReady' || st.state === 'runup' || st.state === 'flight' || st.state === 'result'));
  }
  // 매 프레임: 다이빙 전에는 방향키 좌우로 골라인 위를 이동, 조준점에 다이빙 방향 미리보기
  function keeperControl(dt) {
    const on = keeperControlActive();
    const kickerAiming = st.state === 'kickerAim' && kickerHumanNow();
    const run = st.Kk && st.Kk.run;
    const canStutter = kickerHumanNow() && st.mode !== 'multi' && run && !run.kicked && (!run.stutterUsed || run.paused);
    $('touch-ctrl').classList.toggle('show', isTouch && (on || kickerAiming));
    $('btn-action').textContent = kickerAiming ? '슛' : '다이빙';
    $('btn-stutter-touch').classList.toggle('show', !!(isTouch && canStutter && st.state === 'runup'));
    $('btn-stutter-touch').classList.toggle('alt', !!(isTouch && (on || kickerAiming))); // 다이빙 버튼과 겹치면 왼쪽 중간으로
    const KR = st.K;
    if (KR && KR.manual && KR.refineUntil && st.time <= KR.refineUntil && KR.diveWorld && !KR.autoStay) {
      const ay = keeperAxis().y;
      if (Math.abs(ay) >= 0.3) {
        KR.refineUntil = 0;
        KR.diveWorld.y = clamp(1.0 + ay * 0.9, 0.2, 2.3);
        if (KR.dive) { KR.dive = planDive(KR.diveWorld, KR.diveRootX !== undefined ? KR.diveRootX : KR.av.position.x, planOpt(KR.timing)); KR.clipDive = undefined; KR.re = null; }
      }
    }
    if (!on) return;
    const a = keeperAxis();
    const K = st.K;
    // 스페이스를 먼저 누르고 방향을 기다리는 중: 방향이 들어오면 그쪽으로, 시간이 지나면 가운데 버티기
    if (K.diveWait !== undefined) {
      if (Math.abs(a.x) >= 0.3 || st.time - K.diveWait >= PK.Tune.dirWait) { manualDive(true); return; }
    }
    K.shiftTarget = clamp((K.shiftTarget || 0) + a.x * 1.5 * dt, -PK.Tune.maxShift, PK.Tune.maxShift);
    S.aim.visible = false; // 키퍼는 과녁 없이 몸의 움직임만 보고 판단
  }

  // 사람 키퍼: 스페이스를 누른 순간, 현재 방향으로 다이빙
  //  방향 없이 스페이스를 먼저 눌렀으면 잠깐(PK.Tune.dirWait) 방향 입력을 기다림
  //  → '방향키 누른 채 스페이스'와 '스페이스 누르고 바로 방향키'가 같은 다이빙이 됨 (끝내 방향이 없으면 가운데 버티기)
  function manualDive(force) {
    const K = st.K;
    const a = keeperAxis();
    // 좌우가 없으면(방향 없음 또는 위아래만) 좌우 입력을 잠깐 기다림: '아래 → 스페이스 → 오른쪽'도 오른쪽 아래로
    const hasX = Math.abs(a.x) >= 0.3, hasY = Math.abs(a.y) >= 0.3;
    if (!hasX && !force) { if (K.diveWait === undefined) K.diveWait = st.time; return; }
    const pressT = K.diveWait !== undefined ? K.diveWait : st.time; // 일찍/늦게 판정은 스페이스를 누른 순간 기준
    K.diveWait = undefined;
    const contact = st.flight ? st.flight.t0 : K.expectedContact;
    const dt = pressT - contact; // 음수 = 킥 전
    // 킥보다 확실히 먼저 뛰면 체중을 미리 실어 더 멀리, 킥 후 반응이면 보통
    // 킥보다 먼저 = 일찍, 킥 직후 = 보통, 공이 날아가는 걸 보고 = 늦게 (공 쪽으로 정확히 가지만 출발이 늦음)
    K.timing = dt < -0.1 ? 'early' : dt > 0.05 && st.flight ? 'late' : 'normal';
    if (K.autoStay) {
      // 자동 버티기 반응을 취소하고 새로 다이빙 계획 (지금 자세에서 출발)
      K.autoStay = false; K.dive = null; K.clipDive = undefined; K.re = null; K.lastT = undefined;
      K.hipStartX = K.last ? K.last.hx : 0;
    }
    K.diveWorld = keeperDiveTarget(keeperAxis());
    K.diveStart = st.time;
    // 좌우만 누른 채 출발했으면, 잠깐 동안 들어온 위아래 입력으로 높이를 고침 ('오른쪽 → 스페이스 → 아래'도 오른쪽 아래로)
    K.refineUntil = hasX && !hasY ? pressT + PK.Tune.dirWait : 0;
    S.aim.visible = false;
    setText('instruction', '');
    PK.AI.rememberDive(K.diveWorld.x);
  }

  function setKickType(t) { st.kickType = t; PK.Audio.click(); syncPanels(); }
  function syncPanels() {
    document.querySelectorAll('#kick-types button').forEach((b) => b.classList.toggle('on', b.dataset.type === st.kickType));
  }

  // ---------- 멈칫 (달려가다 원하는 순간에, 누르고 있는 동안 감속: 회복까지 포함해 최대 1초) ----------
  function kickerHumanNow() { return isLocal(st.kickerTeam); }
  function startStutter(byAI, src) {
    const run = st.Kk && st.Kk.run;
    if (!run || run.kicked || run.stutterUsed || run.paused || (!byAI && !kickerHumanNow())) return;
    if (!byAI && st.mode === 'multi') return; // 한 화면 멀티: 멈칫 없음 (스페이스는 키퍼 다이빙)
    const tauEff = run.tw;
    if (tauEff < 0.15 || tauEff > run.stutterEnd) return; // 출발 직후·킥 동작에 들어간 뒤엔 불가
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
    else if ((st.state === 'runup' || st.state === 'flight' || st.state === 'result') && keeperControlActive()) {
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
    setText('instruction', '상대가 조준하는 중');
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
          dv: K.diveWorld ? [r3(K.diveWorld.x), r3(K.diveWorld.y)] : null, dt: K.timing || null, as: K.autoStay ? 1 : 0,
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
    // 상대 키퍼가 자동 버티기 반응 중에 직접 다이빙으로 바꾸면 다시 받아서 다이빙으로
    if (Array.isArray(L.dv) && K.diveWorld && K.autoStay && !L.as) { K.diveWorld = null; K.dive = null; K.clipDive = undefined; K.re = null; K.lastT = undefined; }
    if (Array.isArray(L.dv) && !K.diveWorld && typeof L.dts === 'number' && st.Kk.run) {
      K.autoStay = !!L.as;
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
    // 인스텝(발등): 약하게 차도 빠르고 낮게 곧장 날아감. 예전 최저 13m/s 는 높이를 맞추려 공이 1m 넘게 떴다 떨어져
    //  비스듬한 카메라에서 아웃프런트처럼 휘며 떨어지는 궤적으로 보였음
    instep:  { name: '인스텝',   speed: (p) => 21 + 14 * p, sigmaMul: 1.15, color: '#ffffff' },
    panenka: { name: '파넨카',   speed: (p) => 12.4 + 3.4 * p, sigmaMul: 0.35, color: '#ffd34d' },
  };
  // 감아차기 커브: 키커는 오른발잡이 → 발 안쪽으로 감으면 공은 항상 오른쪽에서 왼쪽으로 휨
  //  왼쪽 구석: 가운데로 출발해 먼 포스트 쪽으로 크게 감겨 들어감 (자연스러운 방향이라 더 많이 휨)
  //  오른쪽 구석: 골대 바깥쪽으로 출발했다가 안쪽으로 감겨 들어옴 (덜 휨)
  function autoCurve(type, aimX) {
    if (type !== 'curl') return 0;
    // 11m 에서 눈에 보이게 휘도록 (가운데에서 40~50cm 바깥으로 볼록하게)
    const t = Math.min(1, Math.abs(aimX) / 3);
    return aimX < 0 ? -(1.3 + 0.7 * t) : -(1.0 + 0.35 * t);
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
    let sigma = (baseSigma + 0.55 * Math.pow(pw, 4)) * K.sigmaMul + 0.04 * Math.abs(curve) + over * 1.4; // 커브가 커진 만큼 오차 계수는 낮춤 (정확도는 그대로)
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
    const clipKick = useKickClip(st.Kk.av) ? kickDefFor(st.shot && st.shot.type) : null;
    const T_APPROACH = clipKick ? kickContactT(clipKick) - 0.2 : 1.25; // 실제 킥 동작: 공에 닿는 시점이 동작에 정해져 있음
    st.Kk.run = { t0: st.time, approach: T_APPROACH, contact: T_APPROACH + 0.2, kicked: false, clip: clipKick, yaw0: st.Kk.av.rotation.y,
      paused: false, pausedTotal: 0, stutterUsed: false, stuttered: false,
      tw: 0, rate: 1, lastT: st.time, // 진행 시간(멈칫하면 느려짐) · 진행 속도
      // 멈칫은 디딤발 직전까지 (속도를 절반으로만 줄여 킥 동작에 걸쳐도 슬로모션처럼 보이지 않음)
      //  예전엔 킥 동작 전 구간에서만 돼서, 런업이 짧은 감아차기·파넨카는 마지막 0.6초에 눌러도 반응이 없었음
      stutterEnd: T_APPROACH * 0.93,
      ai: st.aiStutter ? { at: (clipKick ? clipKick.pre : T_APPROACH) * (0.4 + Math.random() * 0.35), dur: 0.35 + Math.random() * 0.4 } : null };
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
      setText('instruction', '');
      S.aimMat.color.set('#2fd0ff');
    } else {
      st.K.timing = timing;
      st.K.diveWorld = st.dive.clone(); // 실제 계획은 다이빙 순간의 키퍼 위치 기준으로
      // 일찍: 키커의 원래 리듬에 맞춰 미리 출발(멈칫에 속음) / 보통: 실제 임팩트 직전 / 늦게: 임팩트 후 (kickerUpdate·launchBall 에서 결정)
      st.K.diveStart = timing === 'early' ? expected - PK.Tune.earlyLead : Infinity;
    }
    if (isLocal(st.kickerTeam)) {
      PK.AI.rememberKick(st.shot.target.x);
      setText('instruction', '');
    }
    setCam(new V3(0.7, 2.4, 18.6), new V3(0, 0.1, 2), 1.2);
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
      // AI 키커만: 키퍼가 먼저 몸을 날린 걸 보고 반대쪽으로 (사람 키커는 조준한 방향 그대로 — 예전엔 사람도 반대쪽으로 바뀌어 엉뚱한 곳으로 갔음)
      if (!kickerHumanNow() && K && K.dive && K.dive.mode === 'dive' && st.time - K.diveStart > 0.15) {
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
    // maxReach: 엉덩이 시작점에서 손끝까지 닿을 수 있는 최대 거리 (실제 다이빙 동작도 같은 한계)
    return { mode: 'dive', H, theta, T, D, side: Math.sign(D.x), slack: MAX_T - travel, maxReach: REACH + MAX_T };
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
    // 버틴 키퍼는 공을 끝까지 지켜봤으므로, 도착 약 0.3초 전부터 공 높이로 손을 올리고(높으면 점프) 막음
    const arriveIn = st.ball && st.ball.v.z < -0.5 ? (st.ball.p.z - KEEPER_Z) / -st.ball.v.z : Infinity;
    // 킥 직후에는 살아 있는 대기 자세 그대로 (언제든 다이빙 가능), 공이 거의 왔을 때(0.25초 전)만 자동으로 손을 뻗음
    if (K.manual && !K.diveWorld && st.flight && (st.flight.decided || arriveIn < 0.25 || (st.ball && st.ball.p.z < KEEPER_Z + 0.8))) {
      K.timing = null;
      K.autoStay = true; // 직접 다이빙을 누르면 이 반응을 취소하고 다이빙
      const ty = st.shot ? clamp(st.shot.target.y, 0.3, 2.3) : 1.0;
      K.diveWorld = new V3(K.av.position.x, ty, 0); // 가운데 버티기 → 공이 오는 높이로
      // 도착 약 0.45초 전부터 손을 올리기 시작 (처음부터 부드럽게, 손이 갈 곳은 아래에서 미리 정해 둠)
      K.diveStart = st.time;
      if (st.shot) K.re = { x: clamp(st.shot.target.x - K.av.position.x, -0.7, 0.7), y: ty, rz: 0 };
      S.aim.visible = false;
      setText('instruction', '');
    }
    if (st.time >= K.diveStart && K.diveWorld && !K.dive) {
      if (K.timing === 'late' && st.shot) {
        // 공을 보고 뛰므로 실제 슛 쪽으로 크게 보정 (완벽하지는 않음)
        // 사람 키퍼는 방향을 골랐고 그 방향이 공과 같은 쪽일 때만 (반대쪽을 골랐으면 고른 대로,
        //  방향 없이 눌렀으면 가운데 버티기 그대로 — 예전엔 가운데도 '같은 쪽'으로 쳐서 공 쪽으로 자동 다이빙했음)
        const tg = st.shot.target, rx = K.av.position.x;
        const chose = Math.abs(K.diveWorld.x - rx) >= 0.3;
        const sameSide = !K.manual || (chose && Math.sign(tg.x - rx) === Math.sign(K.diveWorld.x - rx));
        if (sameSide) K.diveWorld.set(tg.x + gauss() * 0.3, clamp(tg.y + gauss() * 0.25, 0.2, 2.3), 0);
      }
      // 늦게 뛰는 키퍼는 체중을 미리 싣지 못해 조금 느리고 덜 뻗음
      K.diveRootX = K.av.position.x;
      K.dive = planDive(K.diveWorld, K.av.position.x, K.timing === 'late' ? { reach: PK.Tune.lateReach, time: PK.Tune.lateTime }
        : K.timing === 'early' ? { reach: PK.Tune.earlyReach, time: 1 } : null); // 일찍 = 미리 체중을 실어 더 멀리
      if (K.autoStay && K.dive.mode === 'center') K.dive.T *= 0.6; // 자동 반응은 공이 거의 왔을 때라 손을 빠르게      K.stepping = false;
    }
    // 옆으로 날아가는 다이빙은 실제 골키퍼 다이빙 동작으로 (가운데 버티기·점프는 기존 동작)
    if (K.dive && K.clipDive === undefined) K.clipDive = K.dive.mode === 'dive' ? setupClipDive(K) : null;
    keeperPose();
    const ku = K.av.userData;
    if (ku.anim) {
      const cel = K.celebrate && st.time >= K.celebrate.t0 + 0.3;
      const ready = !K.dive || st.time < K.diveStart; // 다이빙 전: 실제 골키퍼 준비 자세 (옆으로 이동 중엔 기존 스텝 동작)
      // 버티기·제자리 점프 후 공 판정이 끝나면 다시 편한 대기 자세로 (손을 뻗은 채 굳어 있지 않게)
      const settled = K.dive && K.dive.mode === 'center' && st.flight && st.flight.resolved && st.time - K.diveStart > K.dive.T + 0.5;
      if (cel) ku.anim('Yes', { fade: 0.7 });
      else if ((ready && !K.stepping) || settled) ku.anim('GkIdle', { fade: settled ? 0.5 : 0.3 });
      else if (K.clipDive && !ready) ku.anim(K.clipDive.name, { fade: 0.12, phase: clipDiveUpdate(K) });
      else ku.anim(null, { fade: ready ? 0.25 : 0.15 });
      if (cel || settled || !K.clipDive || ready) ku.postAnim = null; // 두 손 모으기는 다이빙 중에만
    }
    if (!(K.celebrate && st.time >= K.celebrate.t0)) {
      K.last = { hx: P.hips.position.x, hy: P.hips.position.y, rz: P.hips.rotation.z };
    }
  }

  // ---------- 실제 골키퍼 다이빙 동작 (Mixamo) ----------
  //  side: 동작이 날아가는 쪽(모델 x 부호), t0: 몸을 기울여 박차기 시작 (그 앞은 제자리 준비 동작이라 거기서 시작하면 누른 뒤 0.1~0.2초 몸이 굳어 보임), ts: 가장 길게 뻗은 순간, tl: 땅에 닿음
  //  lead: ts 에서 두 손 가운데 위치(모델 x, y, 동작 첫 프레임 기준 이동 포함)
  //  leadZ: ts 에서 손이 골반보다 앞으로 나온 거리 → 손끝이 골라인 바로 앞(HAND_Z)에 오도록 몸을 뒤로 둠
  //  pel: ts 에서 골반 위치 (몸을 기울이는 중심)
  const DIVE_CLIPS = {
    // 동작에서는 두 손이 30~56cm 벌어져 공이 손 사이로 빠짐 → 오른손을 왼손 옆(17cm)으로 모으고, 모은 두 손 가운데를 공에 맞춤
    GkDiveLow: { side: 1, t0: 0.58, ts: 1.05, tl: 1.4, lead: [2.01, 0.78], pel: [1.43, 0.98], leadZ: 0.62 },
    GkDiveHigh: { side: -1, t0: 0.52, ts: 0.9, tl: 1.3, lead: [-2.24, 1.47], pel: [-1.53, 1.04], leadZ: 0.48 },
  };
  const DIVE_LIFT = [-0.4, 0.12]; // 몸 전체를 올리거나 내리는 양은 조금만 (나머지 높이는 몸을 기울여서)
  const DIVE_FWD = 0.25; // 동작의 앞으로 나가는 움직임은 1/4만 (골라인을 지키도록)
  const HAND_Z = 0.2; // 가장 길게 뻗었을 때 손의 앞뒤 위치 (키퍼 기준선에서)
  function setupClipDive(K) {
    const u = K.av.userData;
    if (!u.anim || !u.bones || !PK.PlayerModel.meta) return null;
    const d = K.dive, name = d.D.y >= 1.15 ? 'GkDiveHigh' : 'GkDiveLow';
    const m = PK.PlayerModel.meta(name); if (!m || !m.path) return null;
    const c = DIVE_CLIPS[name];
    const mir = c.side === d.side ? 1 : -1; // 반대쪽이면 좌우를 뒤집어서
    const p0 = PK.PlayerModel.pathAt(name, c.t0), ps = PK.PlayerModel.pathAt(name, c.ts);
    const zFix = HAND_Z - c.leadZ - DIVE_FWD * (ps[1] - p0[1]); // 뻗은 순간 손이 골라인 앞에 오도록 몸을 뒤로 옮기는 양
    return Object.assign({ name, mir, p0, zFix, dur: m.duration, rootX: K.diveRootX !== undefined ? K.diveRootX : K.av.position.x }, c);
  }
  // 매 프레임: 동작 시간(다이빙 시간 T 에 맞춰 늘이거나 줄임)과 선수 위치(손이 목표 지점에 닿도록 몸을 옮김)를 정하고 재생 위치(0~1)를 돌려줌
  function clipDiveUpdate(K) {
    const cd = K.clipDive, d = K.dive, tau = Math.max(0, st.time - K.diveStart);
    // 실제 동작은 팔이 늦게 뻗어지므로, 계획 시간의 70% 에 다 뻗도록 빠르게 (기존 다이빙은 팔을 처음부터 뻗어 일찍 닿았음)
    const T = d.T * PK.Tune.clipDiveT;
    // 가장 길게 뻗은 뒤 잠깐 공중에 머묾(체공): 처음 0.3초는 동작을 천천히 → 공이 조금 늦게 와도 뻗은 손에 걸림
    const after = tau - T, hang = after < 0.3 ? after * 0.35 : 0.105 + (after - 0.3);
    // 처음에 빠르게 뻗고 끝에서 느려지게
    const u = clamp(tau / T, 0, 1), ue = 1 - Math.pow(1 - u, PK.Tune.clipDiveEase);
    const ct = tau < T ? cd.t0 + (cd.ts - cd.t0) * ue : Math.min(cd.dur - 0.01, cd.ts + hang);
    // 목표: 공을 보고 보정한 점(re) → 기존과 같은 최대 다이빙 거리 안으로
    let tx = K.re ? K.re.x : d.D.x, ty = K.re ? K.re.y : d.D.y;
    const dx = tx, dy = ty - 0.91, dist = Math.hypot(dx, dy) || 1;
    if (dist > d.maxReach) { tx = (dx / dist) * d.maxReach; ty = 0.91 + (dy / dist) * d.maxReach; }
    ty = Math.max(0.2, ty); // 굴러오는 공: 장갑이 공 높이까지 내려가되 땅속으로는 들어가지 않게
    // 1) 몸 전체 높이는 조금만 바꾸고  2) 나머지는 골반을 중심으로 몸을 기울여 손을 목표 높이로  3) 옆으로 모자란 거리는 몸을 옮김
    const offY = clamp(ty - cd.lead[1], DIVE_LIFT[0], DIVE_LIFT[1]);
    const vx = cd.mir * (cd.lead[0] - cd.pel[0]), vy = cd.lead[1] - cd.pel[1]; // 골반 → 손 (좌우 뒤집기 반영)
    const len = Math.hypot(vx, vy), side = Math.sign(vx) || 1;
    const pivotY = cd.pel[1] + offY;
    const ang0 = Math.atan2(vy, Math.abs(vx)), ang1 = Math.asin(clamp((ty - pivotY) / len, -0.9, 0.97));
    const roll = side * clamp(ang1 - ang0, -0.5, 0.7); // 손 쪽이 올라가는 방향으로 회전 (최대 약 40°)
    const rvx = vx * Math.cos(roll) - vy * Math.sin(roll); // 기울인 뒤 골반 → 손 가로 거리
    const pivotX0 = cd.mir * (cd.pel[0] - cd.p0[0]);
    const offX = tx - rvx - pivotX0;
    const sm = (a, b, x) => { const q = clamp((x - a) / (b - a), 0, 1); return q * q * (3 - 2 * q); };
    const s1 = 1 - Math.pow(1 - u, PK.Tune.clipDiveEase + 0.5), s2 = sm(cd.ts, cd.tl, ct); // 목표 쪽으로 옮기는 것도 조금 앞쪽에 몰아서
    const r = roll * s1 * (1 - s2), H = 0.85; // 골반 높이쯤을 중심으로 회전
    const p = PK.PlayerModel.pathAt(cd.name, ct);
    K.av.scale.x = cd.mir;
    K.av.rotation.z = r;
    // 두 손 모으기: 날아가는 동안 오른손을 왼손 옆으로 (착지 후 풀어 줌)
    const gw = s1 * (1 - sm(cd.tl, cd.tl + 0.4, ct));
    K.av.userData.postAnim = gw > 0.01 ? (B) => glovesTogether(B, gw) : null;
    K.av.position.set(cd.rootX + cd.mir * (p[0] - cd.p0[0]) + offX * s1 + H * Math.sin(r),
      offY * s1 * (1 - s2) + H * (1 - Math.cos(r)), KEEPER_Z + DIVE_FWD * (p[1] - cd.p0[1]) + cd.zFix * s1);
    return ct / cd.dur;
  }

  // 오른팔(위팔)을 어깨 기준으로 돌려 오른손을 왼손 옆 17cm 자리로 (비율 w 만큼)
  const _gv = [new V3(), new V3(), new V3(), new V3(), new V3()], _gq = new THREE.Quaternion();
  function glovesTogether(B, w) {
    const lead = B.hand_l.getWorldPosition(_gv[0]), trail = B.hand_r.getWorldPosition(_gv[1]);
    const dir = _gv[2].subVectors(trail, lead); const dl = dir.length(); if (dl < 1e-4) return;
    const tgt = _gv[3].copy(lead).addScaledVector(dir, 0.17 / dl);
    tgt.lerp(trail, 1 - w);
    const up = B.upperarm_r, par = up.parent;
    const a = par.worldToLocal(_gv[4].copy(trail)).sub(up.position).normalize();
    const b = par.worldToLocal(tgt).sub(up.position).normalize();
    _gq.setFromUnitVectors(a, b);
    up.quaternion.premultiply(_gq);
    up.updateMatrixWorld(true);
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
    // 공을 본 지 0.2초가 지나면 손을 보정 (킥 후에 뛴 키퍼는 이미 공을 보고 있으므로 바로)
    const seesBall = st.shot && st.flight && st.time - st.flight.t0 > 0.15 && tau > 0.05;
    if (seesBall) {
      // 실제 다이빙 동작은 선수 위치 자체를 옮기므로, 다이빙을 시작한 자리 기준으로 계산
      //  방향을 맞게 읽었으면 공 쪽으로 손을 충분히 맞출 수 있게 (방향이 틀리면 범위 밖이라 그대로 못 막음)
      const tx = st.shot.target.x - (K.clipDive ? K.clipDive.rootX : K.av.position.x), ty = st.shot.target.y;
      const step = (cur, goal, rate) => cur + clamp(goal - cur, -rate * kdt, rate * kdt);
      K.re.x = step(K.re.x, clamp(tx, d.D.x - PK.Tune.readX, d.D.x + PK.Tune.readX), PK.Tune.readRate);
      K.re.y = step(K.re.y, clamp(ty, d.D.y - PK.Tune.readY, d.D.y + PK.Tune.readY), PK.Tune.readRate);
    }

    if (d.mode === 'center') {
      const shift = clamp(K.re.x - d.D.x, -0.45, 0.45);
      // 점프: 가장 높은 곳에서 0.15초 머문 뒤 0.3초에 걸쳐 내려와 무릎으로 받으며 착지 (공중에 멈춰 있지 않게)
      const land = d.jump ? clamp((tau - d.T - 0.15) / 0.3, 0, 1) : 0;
      const jumpY = lerp(lerp(0.89, d.H.y, e) + Math.sin(f * Math.PI) * 0.1, 0.86, land * land);
      P.hips.position.set(lerp(hx0, d.H.x, e) + shift * 0.6, d.jump ? jumpY : lerp(0.89, d.H.y, e), 0);
      P.hips.rotation.z = d.theta * e - clamp(K.re.x - P.hips.position.x, -0.6, 0.6) * 0.35;
      if (d.jump) {
        // 머리 위로 뻗되 두 손을 공 쪽으로 모음 (손 사이로 공이 빠지지 않게)
        const rx = K.re.x - P.hips.position.x, L = 0.62;
        const aL = Math.PI - Math.asin(clamp((rx + 0.07 - 0.235) / L, -1, 1));
        const aR = Math.PI - Math.asin(clamp((-(rx - 0.07) - 0.235) / L, -1, 1));
        const down = land * 0.35; // 내려오며 팔도 조금 내림
        P.armL.rotation.set(0, 0, lerp(0.55, aL, er) - down); P.armR.rotation.set(0, 0, -lerp(0.55, aR, er) + down);
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
      const absorb = d.jump ? Math.sin(land * Math.PI) * (1 - land * 0.5) : 0; // 착지 순간 무릎을 굽혀 충격 흡수
      const air = d.jump ? (f >= 1 ? 1 - land : spring) : 0; // 공중에 있는 동안 다리를 살짝 접음
      ['L', 'R'].forEach((s, i) => {
        const sg = i === 0 ? 1 : -1;
        P['leg' + s].rotation.set(-0.45 * crouch - air * 0.35 - absorb * 0.3, 0, sg * lerp(0.12, 0.35, e));
        P['knee' + s].rotation.x = 0.8 * crouch + (d.jump ? air * 0.6 + absorb * 0.5 : spring * 0.12);
        P['foot' + s].rotation.x = d.jump ? lerp(-0.3, 0.45, air) : -0.3;
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
    let hips = pt(P.hips, 0, -0.02, 0);
    let neck = pt(P.spine, 0, 0.58, 0);
    let head = pt(P.head, 0, 0.01, 0);
    let shL = pt(P.armL, 0, 0, 0), shR = pt(P.armR, 0, 0, 0);
    let elL = pt(P.elbowL, 0, 0, 0), elR = pt(P.elbowR, 0, 0, 0);
    let hdL = pt(P.handL, 0, -0.03, 0), hdR = pt(P.handR, 0, -0.03, 0);
    let lgL = pt(P.legL, 0, 0, 0), lgR = pt(P.legR, 0, 0, 0);
    let knL = pt(P.kneeL, 0, 0, 0), knR = pt(P.kneeR, 0, 0, 0);
    let ftL = pt(P.footL, 0, -0.02, 0.06), ftR = pt(P.footR, 0, -0.02, 0.06);
    const B = K.av.userData.bones;
    if (K.clipDive && B && st.time >= K.diveStart) {
      // 실제 다이빙 동작 중: 보이는 몸의 뼈 위치로 판정 (보이는 손에 맞으면 막힘)
      const w = (n) => B[n].getWorldPosition(new V3());
      const mid = (a, b) => w(a).add(w(b)).multiplyScalar(0.5);
      hips = w('pelvis'); neck = w('neck_01');
      const hb = w('Head'); head = hb.clone().add(hb.clone().sub(neck).setLength(0.09));
      shL = w('upperarm_l'); shR = w('upperarm_r'); elL = w('lowerarm_l'); elR = w('lowerarm_r');
      hdL = mid('hand_l', 'middle_01_l'); hdR = mid('hand_r', 'middle_01_r');
      lgL = w('thigh_l'); lgR = w('thigh_r'); knL = w('calf_l'); knR = w('calf_r');
      ftL = mid('foot_l', 'ball_l'); ftR = mid('foot_r', 'ball_r');
      // 동작의 팔은 앞(키커 쪽)으로 뻗어 있어 공이 팔을 따라 미끄러져 들어감 → 판정은 손 깊이의 한 평면에 펼쳐 정면으로 맞게
      const zp = (hdL.z + hdR.z) / 2;
      [hips, neck, head, shL, shR, elL, elR, hdL, hdR, lgL, lgR, knL, knR, ftL, ftR].forEach((v) => { v.z = zp; });
    }
    const caps = [
      { a: hips, b: neck, r: 0.155, part: 'body' },
      { a: head, b: head, r: 0.13, part: 'body' },
      { a: shL, b: elL, r: 0.065, part: 'arm' }, { a: elL, b: hdL, r: 0.06, part: 'arm' },
      { a: shR, b: elR, r: 0.065, part: 'arm' }, { a: elR, b: hdR, r: 0.06, part: 'arm' },
      { a: hdL, b: hdL, r: 0.095, part: 'hand' }, { a: hdR, b: hdR, r: 0.095, part: 'hand' },
      { a: lgL, b: knL, r: 0.085, part: 'leg' }, { a: knL, b: ftL, r: 0.07, part: 'leg' },
      { a: lgR, b: knR, r: 0.085, part: 'leg' }, { a: knR, b: ftR, r: 0.07, part: 'leg' },
    ];
    // 실제 다이빙에서 두 장갑을 모았을 때: 두 손 사이도 장갑 면 (나란한 두 손바닥)
    if (K.clipDive && st.time >= K.diveStart) {
      // 실제 다이빙: 장갑을 조금 크게(골키퍼 장갑) + 모은 두 손 사이도 장갑 면 (나란한 두 손바닥)
      caps.forEach((c) => { if (c.part === 'hand') c.r = PK.Tune.clipGloveR; });
      if (hdL.distanceTo(hdR) < 0.35) caps.push({ a: hdL, b: hdR, r: PK.Tune.clipGloveR, part: 'hand' });
    }
    // 속도 추정
    caps.forEach((c, i) => {
      const mid = c.a.clone().add(c.b).multiplyScalar(0.5);
      const prev = K.prev && K.prev[i];
      c.vel = prev && dt > 0 ? mid.clone().sub(prev).multiplyScalar(1 / dt) : new V3();
      if (c.vel.length() > 12) c.vel.setLength(12);
      c.mid = mid;
    });
    K.prev = caps.map((c) => c.mid);
    // 실제 다이빙 동작은 몸이 골대 쪽으로 물러나며 떨어지는데, 그 움직임이 공을 골대 안으로 밀어 넣지 않게
    if (K.clipDive) caps.forEach((c) => { if (c.vel.z < 0) c.vel.z = 0; if (c.vel.y < 0) c.vel.y *= 0.4; });
    K.hands = [hdL, hdR];
    return caps;
  }

  // ---------- 애니메이션: 키커 ----------
  // 키커는 판정에 쓰이지 않으므로 모든 전환을 섞음 (달리기→킥은 동작 안에서 이미 이어짐)
  const KICKER_BLEND = { react: 0.3, idle: 0.3, pause: 0.16, run: 0.2, kick: 0 };
  function kickerUpdate() {
    if (st.Kk) st.Kk.animReq = [null, { fade: 0.2 }];
    const mode = kickerPoseRaw();
    if (mode) poseBlend(st.Kk.av, mode, KICKER_BLEND[mode] || 0);
    // 실제 애니메이션(대기·달리기·세리머니)을 기존 관절 자세 위에 섞음. 공을 차는 동작은 기존 자세(발이 공에 정확히 닿도록)
    const u = st.Kk && st.Kk.av.userData;
    if (u && u.anim) u.anim(st.Kk.animReq[0], st.Kk.animReq[1]);
  }
  // 달리기 애니메이션은 왼발이 가장 앞에 있을 때가 0.85 지점 → 런업 보폭 위상(ph = π/2 에서 왼발이 가장 앞)과 맞춤
  const SPRINT_LEFT_FWD = 0.85;
  const sprintPhase = (ph) => { const x = SPRINT_LEFT_FWD + (ph - Math.PI / 2) / (Math.PI * 2); return x - Math.floor(x); };
  function kickerPoseRaw() {
    const Kk = st.Kk; if (!Kk) return null;
    const av = Kk.av, P = av.userData.parts, t = st.time;
    PK.Avatar.resetPose(av);

    if (Kk.react) {
      Kk.animReq = [Kk.react.good ? 'Yes' : 'Idle_No_Loop', { fade: 0.4 }];
      const rt = t - Kk.react.t0;
      const f = clamp(rt / 0.5, 0, 1);
      const back = (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2); // 살짝 넘쳤다 돌아오는 이징
      if (Kk.react.good) { // 골 세리머니: 양팔 번쩍 + 점프 (무릎으로 받으며 착지)
        const a = back(f);
        const jt = Math.max(0, rt - 0.45), wv = Math.sin(jt * 1.9 * Math.PI * 2); // 한 번 점프 ≈ 0.53초 (끊김 없는 주기)
        const ramp = clamp(jt / 0.2, 0, 1);
        const air = Math.max(0, wv) * ramp; // 공중
        const squash = Math.max(0, -wv) * ramp; // 착지·도약 준비
        P.armL.rotation.set(-0.15 * a, 0, lerp(0.12, 2.65, a) + air * 0.12); P.armR.rotation.set(-0.15 * a, 0, -lerp(0.12, 2.65, a) - air * 0.12);
        P.elbowL.rotation.x = P.elbowR.rotation.x = -0.15 - squash * 0.4;
        P.hips.position.y = 0.97 + air * 0.17 - squash * 0.09 - Math.sin(f * Math.PI) * 0.04;
        P.kneeL.rotation.x = P.kneeR.rotation.x = 0.1 + squash * 0.75 + air * 0.25;
        P.legL.rotation.x = P.legR.rotation.x = -squash * 0.4 - air * 0.15;
        P.footL.rotation.x = P.footR.rotation.x = air * 0.45 - squash * 0.3;
        P.spine.rotation.x = squash * 0.2 - air * 0.12; P.head.rotation.x = -0.3 * f - air * 0.1;
      } else { // 아쉬움: 머리 감싸기 → 고개 숙이고 몸을 살짝 흔듦
        const e = easeInOut(f), sh = rt > 0.5 ? Math.sin((rt - 0.5) * 2.2) : 0;
        P.armL.rotation.set(-2.2 * e, 0, 0.5 * e); P.armR.rotation.set(-2.2 * e, 0, -0.5 * e);
        P.elbowL.rotation.x = P.elbowR.rotation.x = -1.9 * e;
        P.spine.rotation.set(0.35 * e + Math.abs(sh) * 0.05, sh * 0.12, 0); P.head.rotation.set(0.3 * e, -sh * 0.1, 0);
        P.hips.position.y = 0.97 - 0.03 * e;
        P.kneeL.rotation.x = P.kneeR.rotation.x = 0.12 * e; P.legL.rotation.x = P.legR.rotation.x = -0.06 * e;
      }
      return 'react';
    }

    const run = Kk.run;
    if (!run) { // 대기: 로비와 같은 편하게 선 자세 (숨 고르기 + 천천히 체중 옮기기), 고개는 골대·키퍼 쪽을 살핌
      PK.relaxedStand(P, t);
      P.head.rotation.x = 0.06 + Math.sin(t * 0.37) * 0.04;
      return 'idle';
    }
    // 멈칫 처리: AI 는 정해둔 시점/길이, 사람은 누르고 있는 동안 (최소 0.3초, 최대 STUT_HOLD_MAX — 회복까지 1초 안)
    if (run.ai && !run.stutterUsed && run.tw >= run.ai.at) startStutter(true);
    if (run.paused) {
      const held = t - run.pauseStart;
      if (run.ai && held >= run.ai.dur) run.releaseReq = true;
      // 디딤발 직전에 이르면 자동으로 놓음
      if ((run.releaseReq && held >= 0.3) || held >= STUT_HOLD_MAX || run.tw >= run.stutterEnd + 0.08) {
        run.paused = false; run.pausedTotal += held;
        $('btn-stutter-touch').classList.remove('on');
      }
    }
    // 진행 시간: 멈칫하면 진행 속도가 STUT_RATE 까지 빠르게 줄고, 놓으면 다시 원래 속도로 가속 (동작이 멈추지 않음)
    const dtR = Math.max(0, t - run.lastT); run.lastT = t;
    run.rate += ((run.paused ? STUT_RATE : 1) - run.rate) * (1 - Math.exp(-dtR / (run.paused ? STUT_IN : STUT_OUT)));
    if (!run.paused && run.rate > 0.995) run.rate = 1;
    run.tw += dtR * run.rate;
    let tau = run.tw; // 몸이 나가는 거리와 다리 위상이 같이 느려지므로 보폭은 그대로
    // 키퍼 쪽에 남은 시간 알려주기 (사람 키퍼 타이밍 판정, AI '보통' 타이밍)
    const K = st.K;
    if (K && !run.kicked) {
      const remain = run.contact - tau;
      K.expectedContact = t + remain + (run.paused ? 0.3 : 0);
      if (!K.manual && K.timing === 'normal' && K.diveStart === Infinity && !run.paused && remain <= 0.06) K.diveStart = t;
    }
    if (run.clip) {
      // 실제 페널티킥 동작: 런업·킥·팔로우스루 전체. 멈칫하면 보폭은 그대로 속도만 줄였다가 다시 원래 속도로
      const def = run.clip;
      Kk.animReq = kickClipPose(def, tau, av.position);
      av.rotation.y = kickYaw(def, tau, run.yaw0);
      if (!run.kicked && tau >= run.contact) { run.kicked = true; launchBall(); }
      return tau < run.contact ? 'run' : 'kick';
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
      const s = Math.sin(ph), sw = s * 0.7 * amp;
      return {
        legL: -sw, legR: sw,
        kneeL: (Math.max(0, Math.sin(ph - 1.2)) * 1.2 + 0.1) * amp,
        kneeR: (Math.max(0, Math.sin(ph + Math.PI - 1.2)) * 1.2 + 0.1) * amp,
        // 발목: 뒤로 차고 나갈 때 발끝을 펴고, 앞으로 내디딜 때 발끝을 들어 뒤꿈치부터 닿음
        footL: (0.05 - 0.3 * Math.sin(ph - 0.5)) * amp, footR: (0.05 + 0.3 * Math.sin(ph - 0.5)) * amp,
        // 팔: 다리와 반대로 흔들고, 앞으로 올 때 팔꿈치를 더 접음
        armLx: sw * 0.8, armRx: -sw * 0.8, armLz: 0.15 + Math.max(0, -s) * 0.06 * amp, armRz: -0.15 - Math.max(0, s) * 0.06 * amp,
        elbow: -1.2, elbowL: -1.15 + 0.28 * s * amp, elbowR: -1.15 - 0.28 * s * amp,
        // 몸통: 내딛는 다리 쪽 골반이 앞으로 돌고, 어깨는 반대로 돌며, 머리는 정면 유지
        hipsRY: -0.12 * s * amp, spineY: 0.2 * s * amp, headY: -0.08 * s * amp,
        hipsRZ: 0.035 * s * amp,
        // 보폭이 가장 벌어질 때(체공) 가장 높고, 두 다리가 교차할 때(착지 지지) 가장 낮음
        hipsY: 0.945 + (Math.abs(s) - 0.5) * 0.05 * amp,
        spineX: 0.13 + 0.06 * amp + 0.025 * Math.cos(2 * ph) * amp, spineZ: 0,
        headX: -0.08 * amp - 0.02 * Math.cos(2 * ph) * amp, // 몸이 숙여진 만큼 시선은 앞으로
      };
    };
    const phaseAt = (tt) => RUN_W * (tt - run.approach) + RUN_PH_END;
    if (tau < run.approach) {
      const f = tau / run.approach;
      av.position.copy(runPos(f));
      av.rotation.y = runYaw(f);
      // 출발 직후엔 보폭이 작고 점점 커짐
      applyPose(P, runPose(phaseAt(tau), Math.min(1, 0.45 + f * 1.2)));
      // 실제 달리기 애니메이션 (보폭 위상 맞춤). 마지막 0.2초는 킥 동작으로 넘어가도록 기존 자세 쪽으로 섞음
      Kk.animReq = run.approach - tau > 0.2 ? ['Sprint_Loop', { fade: 0.25, phase: sprintPhase(phaseAt(tau)) }] : [null, { fade: 0.2 }];
      return 'run';
    }
    // 킥 동작: 달려온 속도 그대로 몸이 앞으로 흘러가며 차고, 차고 난 뒤 한두 걸음 더 나감
    const k = tau - run.approach; // 0 ~
    const c = carry(k);
    av.position.copy(RUN_END).addScaledVector(RUN_DIR, c);
    av.rotation.y = runYaw(1);
    const kp = { legL: 0, legR: 0, kneeL: 0, kneeR: 0, armLx: -0.3, armRx: 0.4, armLz: 1.0, armRz: -0.6, elbow: -0.4,
      elbowL: -0.35, elbowR: -0.55, footL: -0.1, footR: 0.5, spineY: -0.1, headY: 0.05, hipsRZ: 0.06,
      // 차기 전에는 공을 내려다보고, 차고 나서도 잠깐 공이 있던 자리를 봄
      headX: lerp(0.35, 0.15, clamp((k - 0.2) / 0.3, 0, 1)),
      hipsY: 0.965, spineX: 0.1, spineZ: 0.12, hipsRY: 0 };
    // 디딤발: 앞에 내디딘 뒤 몸이 넘어가는 만큼 뒤로 (발이 땅에서 미끄러지지 않게)
    kp.legL = -0.45 + c / 0.9; kp.kneeL = 0.35;
    if (k < 0.1) { // 백스윙: 달리던 다리가 그대로 뒤로 감김
      const q = k / 0.1, eo = 1 - (1 - q) * (1 - q);
      // 달리기 마지막 순간의 오른 무릎 각도에서 바로 이어서 접힘 (펴졌다 다시 접히지 않게)
      kp.legR = lerp(0.55, 1.05, eo); kp.kneeR = lerp(runPose(RUN_PH_END, 1).kneeR, 1.75, eo);
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
      kp.hipsY = lerp(0.965, 0.93, q * q * (3 - 2 * q)); // 차고 나서 몸이 내려앉는 것도 이어지게
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
      kp.footR = lerp(0.5, 0, easeInOut(q)); kp.footL = lerp(-0.1, 0.25, q2); // 착지하며 발목이 풀리고, 왼발은 차고 나감
      kp.spineY = lerp(-0.1, 0, q); kp.hipsRZ = lerp(0.06, 0, q);
    }
    if (!run.kicked && k >= run.contact - run.approach) { run.kicked = true; launchBall(); }
    // 달리기 자세에서 킥 자세로 자연스럽게 섞기 (처음 0.14초)
    const wgt = clamp(k / 0.14, 0, 1);
    const sm = wgt * wgt * (3 - 2 * wgt);
    const rp = runPose(phaseAt(tau), 1);
    rp.legR = kp.legR; rp.kneeR = kp.kneeR; // 차는 다리는 처음부터 킥 동작을 따름 (시작 값이 달리기 끝과 같음)
    const mix = {};
    for (const key in kp) mix[key] = lerp(rp[key], kp[key], sm);
    applyPose(P, mix);
    return 'kick';
  }
  function applyPose(P, p) {
    P.legL.rotation.x = p.legL; P.legR.rotation.x = p.legR;
    P.kneeL.rotation.x = p.kneeL; P.kneeR.rotation.x = p.kneeR;
    if (p.footL !== undefined) { P.footL.rotation.x = p.footL; P.footR.rotation.x = p.footR; }
    P.armL.rotation.set(p.armLx, 0, p.armLz); P.armR.rotation.set(p.armRx, 0, p.armRz);
    P.elbowL.rotation.x = p.elbowL !== undefined ? p.elbowL : p.elbow;
    P.elbowR.rotation.x = p.elbowR !== undefined ? p.elbowR : p.elbow;
    P.hips.position.y = p.hipsY; P.hips.rotation.y = p.hipsRY; P.hips.rotation.z = p.hipsRZ || 0;
    P.spine.rotation.set(p.spineX, p.spineY || 0, p.spineZ);
    P.head.rotation.set(p.headX || 0, p.headY || 0, 0);
  }

  // ---------- 공 비행 ----------
  function flightUpdate(dt) {
    const F = st.flight; if (!F) return;
    const b = st.ball;
    F.env.keeper = keeperCapsules(dt);
    if (F.outcome === 'goal') F.env.keeper = []; // 이미 골: 늦게 몸을 날린 키퍼가 그물 속 공을 건드리지 않게
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

    // 관중: 골이면 차는 팀 응원석이, 막히거나 빗나가면 키퍼 팀 응원석이 일어나 환호 (반대쪽은 머리를 감쌈)
    S.crowd.cheer = goal ? st.kickerTeam : st.keeperTeam;
    if (goal) { PK.Audio.cheer(); S.crowd.excite = 1; } else { PK.Audio.groan(); S.crowd.excite = cls === 'save' ? 0.85 : 0.6; }
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
  function shotCard(team, mini, log, teams) {
    const SX = (x) => (x + 4.6) * 100, SY = (y) => (3.3 - y) * 100;
    teams = teams || st.teams;
    const shots = (log || st.shotLog || []).filter((k) => k.team === team);
    const card = document.createElement('div');
    card.className = 'sm-card' + (mini ? ' mini' : '');
    const head = document.createElement('div');
    head.className = 'sm-head';
    const name = document.createElement('b');
    const teamName = teams[team] ? teams[team].name : (team + 1) + 'P';
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
    // 내 기록 저장 (사람이 한쪽인 경기만: 싱글·토너먼트·온라인). 로비 오른쪽 '내 기록'·'최근 경기'에 보여 줌
    const mine = [0, 1].filter((t) => (online() ? isLocal(t) : st.teams[t].human));
    if (mine.length === 1 && PK.Stats) {
      const m = mine[0], o = 1 - m;
      PK.Stats.record({
        mode: st.tour ? 'tournament' : online() ? 'online' : 'single',
        stage: st.tour ? st.tour.roundName : '',
        win: w === m, my: goals(m), opp: goals(o), sudden: st.kicks[0].length > 5,
        myName: st.teams[m].name, oppName: st.teams[o].name,
        log: (st.shotLog || []).map((k) => ({ team: k.team === m ? 0 : 1, n: k.n, x: +k.x.toFixed(2), y: +k.y.toFixed(2), cls: k.cls, text: k.text, type: k.type })),
      });
    }
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
    PK.Audio.cheer();
    S.crowd.cheer = w; S.crowd.excite = 1; // 이긴 팀 응원석이 일어나 환호, 진 팀은 아쉬워함
    // 승부를 가른 순간: 이긴 쪽(넣은 키커 또는 막은 키퍼)이 포효하고, 카메라가 그 얼굴을 클로즈업 → 잠시 뒤 결과 화면
    const kickerWon = st.kickerTeam === w;
    const hero = kickerWon ? st.Kk.av : st.K.av, loser = kickerWon ? st.K.av : st.Kk.av;
    [hero, loser].forEach((a) => { a.scale.set(1, 1, 1); a.rotation.z = 0; a.position.y = 0; a.userData.postAnim = null; });
    if (hero.userData.setShout) hero.userData.setShout(true);
    st.final = { t0: st.time, hero, loser, d0: 1.7 };
    st.Kk = null; st.K = null;
    later(3.4, () => { if (st.state === 'end') show('result', true); });
  }

  // 결승 세리머니: 웅크렸다가 일어나며 양팔 알통 자세 (팔꿈치를 어깨 높이로 벌리고 주먹을 머리 옆으로 세워 힘을 줌)
  function roarPose(P, s) {
    const e = easeOut3(clamp((s - 0.25) / 0.35, 0, 1)), crouch = Math.sin(clamp(s / 0.3, 0, 1) * Math.PI) * (1 - e);
    const pulse = s > 0.6 ? 0.5 + 0.5 * Math.sin((s - 0.6) * 7.5) : 0; // 알통에 힘을 줬다 풀었다
    P.hips.position.set(0, 0.97 - crouch * 0.12 - e * 0.04 - pulse * 0.01, 0);
    P.spine.rotation.set(0.3 * crouch - 0.12 * e - 0.03 * pulse, 0, 0); // 웅크렸다가 가슴을 펴고 살짝 뒤로
    P.head.rotation.set(lerp(0.15, -0.04, e) - 0.02 * pulse, Math.sin(s * 1.3) * 0.06 * e, 0);
    // 팔: 위팔은 옆으로 어깨보다 살짝 높게, 아래팔은 위로 세우고(위팔을 길이 방향으로 돌려), 손바닥은 머리 쪽
    const lift = lerp(0.35, 1.6 + pulse * 0.06, e), twist = -1.6 * e - 0.5 * crouch;
    P.armL.rotation.set(twist, -0.1 * e, lift); P.armR.rotation.set(twist, 0.1 * e, -lift);
    P.elbowL.rotation.x = P.elbowR.rotation.x = lerp(-1.7, -2.15 - pulse * 0.2, e); // 주먹을 쥐고 힘을 주며 더 굽힘
    if (P.handL) { P.handL.rotation.set(0, 1.3 * e, 0); P.handR.rotation.set(0, -1.3 * e, 0); }
    ['L', 'R'].forEach((sd, i) => {
      const sg = i === 0 ? 1 : -1;
      P['leg' + sd].rotation.set(-0.35 * crouch - 0.12 * e, 0, sg * 0.24 * e);
      P['knee' + sd].rotation.x = 0.7 * crouch + 0.28 * e;
      P['foot' + sd].rotation.x = -0.2 * crouch - 0.1 * e;
    });
  }
  function finalUpdate() {
    const F = st.final, s = st.time - F.t0, hero = F.hero;
    PK.Avatar.resetPose(hero);
    roarPose(hero.userData.parts, s);
    if (hero.userData.anim) hero.userData.anim(null, { fade: 0.35 });
    if (F.loser.userData.anim) F.loser.userData.anim('Idle_No_Loop', { fade: 0.6 });
    // 카메라: 승자의 얼굴을 비스듬히 앞에서 천천히 다가감 (눈높이보다 조금 위 → 뒤로 경기장과 관중이 보임)
    const B = hero.userData.bones;
    const H = B && B.Head ? B.Head.getWorldPosition(new V3()) : hero.position.clone().add(new V3(0, 1.65, 0));
    const ry = hero.rotation.y, f = new V3(Math.sin(ry), 0, Math.cos(ry)), side = new V3(f.z, 0, -f.x);
    const d = lerp(F.d0, 1.05, easeInOut(clamp(s / 3.2, 0, 1)));
    const camPos = H.clone().addScaledVector(f, d).addScaledVector(side, 0.45).add(new V3(0, 0.16, 0));
    setCam(camPos, H.clone().add(new V3(0, -0.05, 0)), s < 0.4 ? 6 : 3);
  }

  // ---------- 조준점 파워 링 ----------
  // 킥 파워를 조준점 둘레의 링으로 표시: 누르고 있으면 링이 시계 방향으로 차오르고, 바탕 색으로 약함·적절·위험 구간을 보여줌
  const AP_R = 26, AP_C = 2 * Math.PI * AP_R;
  const apV = new V3();
  function updateAimPower(target) {
    const box = $('aim-power');
    if (!S.aim.visible) { if (!box.hidden) box.hidden = true; return; }
    apV.set(target.x, target.y, 0.02).project(camera);
    const el = renderer.domElement, w = el.clientWidth, h = el.clientHeight;
    box.style.transform = `translate(${((apV.x + 1) / 2) * w}px, ${((1 - apV.y) / 2) * h}px)`;
    const f = Math.min(1, st.power / 1.2);
    const fill = $('ap-fill');
    fill.style.strokeDashoffset = String(AP_C * (1 - f));
    // 지금 파워가 있는 구간 색: 약함(~0.45, 느려서 막히기 쉬움) · 적절(~0.85) · 위험(오차가 커지고 1.0 넘으면 공이 뜸)
    fill.style.stroke = st.power > 0.85 ? '#ff4d5e' : st.power >= 0.45 ? '#6ee36e' : '#5aa9ff';
    box.classList.toggle('charging', st.charging);
    if (box.hidden) box.hidden = false;
  }

  // ---------- 매 프레임 ----------
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
    target.x = clamp(target.x, -lim.x, lim.x);
    target.y = clamp(target.y, lim.y0, lim.y1);
    S.aim.position.set(target.x, target.y, 0.02);
    S.aim.lookAt(camera.position);
    S.aim.scale.setScalar(1);

    if (st.state === 'kickerAim') {
      if (st.charging) st.power = Math.min(1.2, st.power + dt * 0.85);
      $('power-fill').style.width = (st.power / 1.2) * 100 + '%';
      updateAimPower(target);
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
    else if (!$('aim-power').hidden) $('aim-power').hidden = true; // 조준이 끝나면 파워 링 숨김
    updateKickTimer();
    keeperControl(dt);
    updateShotMini();

    if (st.Kk) kickerUpdate();
    if (st.K) keeperUpdate();
    if (st.final) finalUpdate();
    // 사실적인 선수 모델: 관절 자세를 모델 뼈에 옮김 (보이는 선수만)
    if (st.avatars) st.avatars.forEach((a) => { [a.kicker, a.keeper].forEach((m) => { if (m.visible && m.userData.sync) m.userData.sync(); }); });
    if (st.state === 'flight' || (st.flight && st.state === 'result')) flightUpdate(dt);

    S.net.update(dt);
    S.crowd._dt = dt; S.crowd.update(st.time);
    S.adTex.offset.x = (st.time * 0.03) % 1;
    if (S.leds) S.leds.forEach((t) => { t.offset.x = (-st.time * 0.05) % 1; }); // 관중석 앞 LED 광고가 흘러감

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

  return { init, start, update, quit, opponentLeft, shotCard, get active() { return st.active; }, _st: st, _shotMap: renderShotMap, _test: { planDive, keeperPose, keeperCapsules, scene: () => scene } };
})();
