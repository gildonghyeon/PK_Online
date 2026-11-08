// 로비: 모드 선택 + 선수 커스터마이즈 + 3D 미리보기
window.PK = window.PK || {};

PK.Lobby = (function () {
  const O = PK.Options;
  const ROWS = [
    { key: 'hair', label: '헤어스타일', name: (i) => O.hair[i], count: () => O.hair.length },
    { key: 'hairColor', label: '머리 색', name: (i) => O.hairColor[i].name, sw: (i) => O.hairColor[i].c, count: () => O.hairColor.length },
    { key: 'skin', label: '피부색', name: (i) => O.skin[i].name, sw: (i) => O.skin[i].c, count: () => O.skin.length },
    { key: 'face', label: '표정', name: (i) => O.face[i], count: () => O.face.length },
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
  let renderer, scene, camera, avatar, pedestal, rotY = -0.4, dragging = false, lastX = 0, t0 = performance.now();
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
    const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.5 }));
    ballMesh.position.set(0.42, 0.11, 0.25); ballMesh.castShadow = true;
    scene.add(ballMesh);

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
    camera.position.z = 4.3 * Math.max(1, 0.75 / camera.aspect);
    camera.updateProjectionMatrix();
  }

  function update() {
    if (!active || !renderer) return;
    const t = (performance.now() - t0) / 1000;
    if (!dragging) rotY += 0.004;
    if (avatar) {
      avatar.rotation.y = rotY;
      const P = avatar.userData.parts;
      // 대기 모션: 숨쉬기, 가벼운 발 구르기
      P.hips.position.y = 0.97 + Math.sin(t * 2.2) * 0.008;
      P.spine.rotation.x = Math.sin(t * 2.2) * 0.02;
      P.armL.rotation.z = 0.14 + Math.sin(t * 2.2) * 0.03;
      P.armR.rotation.z = -0.14 - Math.sin(t * 2.2) * 0.03;
      P.head.rotation.y = Math.sin(t * 0.7) * 0.15;
    }
    if (avatar && avatar.userData.anim) avatar.userData.anim('Idle_Loop', { fade: 0 }); // 실제 대기 애니메이션
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

  function init() {
    initPreview();
    renderList();
    document.querySelectorAll('#player-tabs button').forEach((b) => b.addEventListener('click', () => setPlayer(+b.dataset.p)));
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', resize);
  }

  return {
    init, update, resize,
    show() { active = true; document.getElementById('lobby').classList.add('active'); setTimeout(resize, 0); },
    hide() { active = false; document.getElementById('lobby').classList.remove('active'); },
    profile(i) { return profiles[i]; },
  };
})();
