// 로비: 모드 선택 + 선수 커스터마이즈 + 3D 미리보기
window.PK = window.PK || {};

// 내 기록: 사람이 한쪽인 경기(싱글·토너먼트·온라인)의 결과를 이 브라우저에 저장 (로비 오른쪽 '내 기록'·'최근 경기')
PK.Stats = (function () {
  const KEY = 'pk_stats';
  const blank = () => ({ v: 1, played: 0, wins: 0, losses: 0, streak: 0, best: 0, kicks: 0, goals: 0, faced: 0, saves: 0,
    modes: { single: [0, 0], tournament: [0, 0], online: [0, 0] }, last: null });
  let data = null;
  function get() {
    if (data) return data;
    try { data = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { data = null; }
    if (!data || data.v !== 1) data = blank();
    return data;
  }
  function record(m) {
    const d = get();
    d.played++;
    if (m.win) { d.wins++; d.streak++; d.best = Math.max(d.best, d.streak); } else { d.losses++; d.streak = 0; }
    const md = d.modes[m.mode] || (d.modes[m.mode] = [0, 0]);
    md[m.win ? 0 : 1]++;
    (m.log || []).forEach((k) => {
      if (k.team === 0) { d.kicks++; if (k.cls === 'goal') d.goals++; } // 내 킥
      else { d.faced++; if (k.cls === 'save') d.saves++; }           // 내가 키퍼로 받은 킥
    });
    d.last = Object.assign({ at: Date.now() }, m);
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* 저장 못 해도 이번 화면에는 보임 */ }
  }
  return { get, record };
})();

PK.Lobby = (function () {
  const O = PK.Options;
  const ROWS = [
    // 헤어스타일·표정은 사실적인 선수 모델에서는 바꿀 수 없어 목록에서 뺌 (저장 값은 그대로 둠)
    { key: 'hairColor', label: '머리 색', name: (i) => O.hairColor[i].name, sw: (i) => O.hairColor[i].c, count: () => O.hairColor.length },
    { key: 'skin', label: '피부색', name: (i) => O.skin[i].name, sw: (i) => O.skin[i].c, count: () => O.skin.length },
    { key: 'uniform', label: '유니폼', name: (i) => O.uniform[i].name, sw: (i) => O.uniform[i].c1, count: () => O.uniform.length },
    { key: 'boots', label: '축구화', name: (i) => O.boots[i].name, sw: (i) => O.boots[i].c, count: () => O.boots.length },
  ];

  const defaults = [
    { hair: 0, hairColor: 0, skin: 1, face: 2, uniform: 0, boots: 2 },
    { hair: 1, hairColor: 2, skin: 3, face: 0, uniform: 1, boots: 3 },
  ];
  let profiles;
  try { profiles = JSON.parse(localStorage.getItem('pk_profiles')) || null; } catch (e) { profiles = null; }
  if (!profiles || profiles.length !== 2) profiles = JSON.parse(JSON.stringify(defaults));
  ROWS.forEach((r) => profiles.forEach((p, i) => { if (!(p[r.key] >= 0 && p[r.key] < r.count())) p[r.key] = defaults[i][r.key]; }));

  let cur = 0, selRow = 0, active = false;
  let renderer, scene, camera, avatar, pedestal, rotY = -0.4, dragging = false, rotLocked = false, lastX = 0, t0 = performance.now();
  const listEl = document.getElementById('custom-list');

  function save() { try { localStorage.setItem('pk_profiles', JSON.stringify(profiles)); } catch (e) { /* 무시 */ } }

  function renderList() {
    listEl.innerHTML = '';
    ROWS.forEach((r, i) => {
      const v = profiles[cur][r.key];
      const row = document.createElement('div');
      row.className = 'custom-row' + (i === selRow ? ' sel' : '');
      row.innerHTML = `<span class="label">${r.label}</span><button data-d="-1">◀</button>
        <span class="value">${r.sw ? `<i class="swatch" style="background:${r.sw(v)}"></i>` : ''}${r.name(v)}</span>
        <button data-d="1">▶</button>`;
      row.addEventListener('click', (e) => {
        selRow = i;
        const d = e.target.dataset && e.target.dataset.d;
        if (d) change(i, +d); else renderList();
      });
      listEl.appendChild(row);
    });
  }

  function change(rowIdx, d) {
    const r = ROWS[rowIdx];
    const n = r.count();
    profiles[cur][r.key] = (profiles[cur][r.key] + d + n) % n;
    PK.Audio.init(); PK.Audio.click();
    save();
    renderList();
    rebuildAvatar();
  }

  function rebuildAvatar() {
    if (!scene) return;
    if (avatar) { scene.remove(avatar); PK.Avatar.dispose(avatar); }
    avatar = PK.Avatar.create(profiles[cur], { number: cur === 0 ? 10 : 7 });
    scene.add(avatar);
  }

  function initPreview() {
    const el = document.getElementById('preview');
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    camera.position.set(0, 1.1, 4.3);
    camera.lookAt(0, 0.95, 0);
    scene.add(new THREE.HemisphereLight('#ffffff', '#3a5a40', 0.75));
    const key = new THREE.DirectionalLight('#ffffff', 0.9);
    key.position.set(2, 4, 3); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#2fd0ff', 0.6);
    rim.position.set(-3, 2, -3);
    scene.add(rim);
    pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.82, 0.08, 40), new THREE.MeshStandardMaterial({ color: '#1d3a28', roughness: 0.6 }));
    pedestal.position.y = -0.04; pedestal.receiveShadow = true;
    scene.add(pedestal);
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.79, 0.012, 8, 60), new THREE.MeshBasicMaterial({ color: '#c6ff3d' }));
    ringM.rotation.x = Math.PI / 2; ringM.position.y = 0.002;
    scene.add(ringM);
    const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 48, 32), new THREE.MeshStandardMaterial({ map: PK.ballTexture(), roughness: 0.38 }));
    ballMesh.position.set(0.42, 0.11, 0.25); ballMesh.castShadow = true;
    scene.add(ballMesh);

    // 자동 회전 고정 버튼 (선택은 이 브라우저에 기억)
    const lockBtn = document.getElementById('rot-lock');
    try { rotLocked = localStorage.getItem('pk_rotlock') === '1'; } catch (e) { /* 무시 */ }
    const paintLock = () => {
      lockBtn.classList.toggle('on', rotLocked);
      lockBtn.textContent = rotLocked ? '🔒 회전 고정' : '⟳ 자동 회전';
      lockBtn.title = rotLocked ? '자동 회전 다시 켜기' : '자동 회전 멈추기';
    };
    paintLock();
    lockBtn.addEventListener('click', () => {
      rotLocked = !rotLocked; paintLock();
      PK.Audio.init(); PK.Audio.click();
      try { localStorage.setItem('pk_rotlock', rotLocked ? '1' : '0'); } catch (e) { /* 무시 */ }
    });
    el.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => { if (dragging) { rotY += (e.clientX - lastX) * 0.012; lastX = e.clientX; } });
    el.addEventListener('pointerup', () => { dragging = false; });
    rebuildAvatar();
    resize();
  }

  function resize() {
    if (!renderer) return;
    const el = document.getElementById('preview');
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px';
    renderer.domElement.style.height = h + 'px';
    camera.aspect = w / h;
    // 세로가 좁으면 멀리서 보기
    camera.position.z = 4.3 * Math.max(1.35, 0.75 / camera.aspect); // 미리보기 칸이 넓어져도 전신(발·공까지)이 보이게 최소 거리 확보
    camera.updateProjectionMatrix();
  }

  function update() {
    if (!active || !renderer) return;
    const t = (performance.now() - t0) / 1000;
    if (!dragging && !rotLocked) rotY += 0.004;
    if (avatar) {
      avatar.rotation.y = rotY;
      PK.relaxedStand(avatar.userData.parts, t); // 편하게 선 자세 (킥 전 대기와 같음)
    }
    // 대기 애니메이션은 골반을 앞으로 내민 자세라, 로비에서는 곧게 선 기본 자세 + 숨쉬기만 씀
    if (avatar && avatar.userData.anim) avatar.userData.anim(null, { fade: 0 });
    if (avatar && avatar.userData.sync) avatar.userData.sync();
    renderer.render(scene, camera);
  }

  function onKey(e) {
    if (!active) return;
    if (e.target && e.target.tagName === 'INPUT') return; // 코드 입력 중엔 꾸미기 단축키 무시
    if (e.key === 'ArrowUp') { selRow = (selRow + ROWS.length - 1) % ROWS.length; renderList(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { selRow = (selRow + 1) % ROWS.length; renderList(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { change(selRow, -1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { change(selRow, 1); e.preventDefault(); }
  }

  function setPlayer(p) {
    cur = p;
    document.querySelectorAll('#player-tabs button').forEach((b) => b.classList.toggle('on', +b.dataset.p === p));
    renderList(); rebuildAvatar();
  }

  // ---------- 오른쪽 정보 패널 (넓은 화면): 내 기록 · 최근 경기 · 조작법 ----------
  const MODE_NAME = { single: '싱글', tournament: '토너먼트', online: '온라인' };
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function whenText(ms) {
    const d = new Date(ms), now = new Date();
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return '오늘 ' + hm;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return '어제 ' + hm;
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + hm;
  }
  function renderInfo() {
    const sb = document.getElementById('stats-body'), lb = document.getElementById('last-body');
    if (!sb || !lb || !PK.Stats) return;
    const d = PK.Stats.get();
    if (!d.played) {
      sb.innerHTML = '<p class="info-empty">아직 경기 기록이 없어요.<br>싱글 플레이로 첫 경기를 해 보세요.</p>';
      lb.innerHTML = '<p class="info-empty">경기를 마치면 내가 찬 위치가 여기 표시돼요.</p>';
      return;
    }
    const bar = (label, a, b, cls) => `<div class="stat-row"><span>${label}</span><b>${a} / ${b}</b><i class="stat-bar ${cls}"><em style="width:${pct(a, b)}%"></em></i><span class="stat-pct">${pct(a, b)}%</span></div>`;
    const modes = Object.keys(MODE_NAME).filter((k) => d.modes[k] && (d.modes[k][0] + d.modes[k][1]))
      .map((k) => `<span>${MODE_NAME[k]} <b>${d.modes[k][0]}</b>승 <b>${d.modes[k][1]}</b>패</span>`).join('');
    sb.innerHTML =
      `<div class="stat-grid"><div class="stat"><b>${d.played}</b><span>경기</span></div><div class="stat"><b>${d.wins}</b><span>승</span></div><div class="stat"><b>${pct(d.wins, d.played)}<small>%</small></b><span>승률</span></div></div>` +
      bar('킥 성공', d.goals, d.kicks, 'kick') + bar('선방', d.saves, d.faced, 'save') +
      `<div class="stat-streak">연승 <b>${d.streak}</b> · 최고 <b>${d.best}</b></div>` +
      (modes ? `<div class="stat-modes">${modes}</div>` : '');
    const L = d.last;
    lb.textContent = '';
    if (!L) return;
    const head = document.createElement('div');
    head.className = 'last-head';
    head.innerHTML = `<span class="last-badge ${L.win ? 'win' : 'lose'}">${L.win ? '승' : '패'}</span><b class="last-score">${L.my} : ${L.opp}</b>` +
      `<span class="last-meta">vs ${esc(L.oppName)}<br>${MODE_NAME[L.mode] || ''}${L.stage ? ' ' + esc(L.stage) : ''}${L.sudden ? ' · 서든데스' : ''} · ${whenText(L.at)}</span>`;
    lb.appendChild(head);
    const log = L.log || [];
    if (PK.Game && PK.Game.shotCard && log.some((k) => k.team === 0)) {
      const card = PK.Game.shotCard(0, false, log, [{ name: '내 킥' }, { name: L.oppName }]);
      lb.appendChild(card);
    }
    const opp = log.filter((k) => k.team === 1);
    if (opp.length) {
      const sv = opp.filter((k) => k.cls === 'save').length, ms = opp.filter((k) => k.cls === 'miss').length;
      const p2 = document.createElement('p');
      p2.className = 'last-keeper';
      p2.innerHTML = `키퍼로 받은 킥 ${opp.length}개 · 선방 <b>${sv}</b> · 빗나감 ${ms} · 실점 ${opp.length - sv - ms}`;
      lb.appendChild(p2);
    }
  }
  // 넓은 화면에선 조작법을 오른쪽 패널로 옮겨 왼쪽 메뉴를 짧게
  function placeHelp() {
    const help = document.querySelector('.controls-help'), slot = document.getElementById('help-slot'), left = document.querySelector('.lobby-left');
    if (!help || !slot || !left) return;
    const wide = window.matchMedia('(min-width: 1280px) and (min-height: 600px)').matches;
    if (wide && help.parentNode !== slot) slot.appendChild(help);
    else if (!wide && help.parentNode !== left) left.appendChild(help);
  }

  function init() {
    initPreview();
    renderList();
    renderInfo(); placeHelp();
    window.addEventListener('resize', placeHelp);
    document.querySelectorAll('#player-tabs button').forEach((b) => b.addEventListener('click', () => setPlayer(+b.dataset.p)));
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', resize);
  }

  return {
    init, update, resize,
    show() { active = true; document.getElementById('lobby').classList.add('active'); renderInfo(); placeHelp(); setTimeout(resize, 0); },
    hide() { active = false; document.getElementById('lobby').classList.remove('active'); },
    profile(i) { return profiles[i]; },
    _cam: () => camera, // 점검용
    _avatar: () => avatar,
    _rot: (v) => { if (v !== undefined) { rotY = v; rotLocked = true; } return rotY; },
  };
})();
