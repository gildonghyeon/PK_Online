// 경기장: 잔디, 라인, 골대, 그물, 관중석, 조명
// 좌표계: 골라인 z=0, 골 중앙 x=0, 필드는 +z 방향. 페널티 스팟 z=11
window.PK = window.PK || {};

PK.GOAL = { halfW: 3.66, h: 2.44, postR: 0.06, depth: 2.0, spotZ: 11 };

PK.Stadium = (function () {
  function build(scene) {
    const G = PK.GOAL;
    const out = {};

    scene.background = new THREE.Color('#0b1626');
    scene.fog = new THREE.Fog('#0b1626', 60, 140);

    // ---------- 조명 ----------
    const hemi = new THREE.HemisphereLight('#cfe6ff', '#28401f', 0.55);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff6e6', 1.0);
    sun.position.set(-12, 26, 18);
    sun.target.position.set(0, 0, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -14; sc.right = 14; sc.top = 18; sc.bottom = -10; sc.near = 1; sc.far = 70;
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#9fc4ff', 0.35);
    fill.position.set(15, 12, -10);
    scene.add(fill);

    // ---------- 잔디 ----------
    const W = 64, D = 56, z0 = -12; // 필드 텍스처가 덮는 영역 x[-32,32], z[-12,44]
    const ppm = 24;
    const cv = document.createElement('canvas');
    cv.width = W * ppm; cv.height = D * ppm;
    const g = cv.getContext('2d');
    for (let i = 0; i < D; i += 1) {
      const band = Math.floor((i + 12) / 5.5) % 2;
      g.fillStyle = band ? '#3f8a3a' : '#357b32';
      g.fillRect(0, i * ppm, W * ppm, ppm + 1);
    }
    // 잔디 노이즈
    const img = g.getImageData(0, 0, cv.width, cv.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 16;
      img.data[i] += n; img.data[i + 1] += n * 1.3; img.data[i + 2] += n * 0.6;
    }
    g.putImageData(img, 0, 0);
    // 라인
    const X = (x) => (x + W / 2) * ppm, Z = (z) => (z - z0) * ppm;
    g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 0.12 * ppm;
    const rect = (x1, z1, x2, z2) => g.strokeRect(X(x1), Z(z1), X(x2) - X(x1), Z(z2) - Z(z1));
    g.beginPath(); g.moveTo(X(-32), Z(0)); g.lineTo(X(32), Z(0)); g.stroke(); // 골라인
    rect(-9.16, 0, 9.16, 5.5);        // 골 에어리어
    rect(-20.16, 0, 20.16, 16.5);     // 페널티 에어리어
    g.beginPath(); g.arc(X(0), Z(11), 9.15 * ppm, Math.asin(5.5 / 9.15), Math.PI - Math.asin(5.5 / 9.15)); g.stroke(); // 페널티 아크
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(X(0), Z(11), 0.13 * ppm, 0, Math.PI * 2); g.fill(); // 페널티 스팟
    // 골 앞 잔디 마모
    const wear = (x, z, r, a) => {
      const gr = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), r * ppm);
      gr.addColorStop(0, `rgba(120,95,55,${a})`); gr.addColorStop(1, 'rgba(120,95,55,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(X(x), Z(z), r * ppm, 0, Math.PI * 2); g.fill();
    };
    wear(0, 0.6, 2.2, 0.35); wear(0, 11, 1.2, 0.3);

    const tex = PK.canvasTex(cv);
    tex.anisotropy = 8;
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.set(0, 0, z0 + D / 2);
    pitch.receiveShadow = true;
    scene.add(pitch);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ color: '#2b6129', roughness: 1 }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.01; outer.receiveShadow = true;
    scene.add(outer);

    // ---------- 골대 ----------
    const postM = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3, metalness: 0.2 });
    const r = G.postR;
    const px = G.halfW + r;
    const postGeo = new THREE.CylinderGeometry(r, r, G.h + r, 16);
    [-px, px].forEach((x) => {
      const p = new THREE.Mesh(postGeo, postM);
      p.position.set(x, (G.h + r) / 2, 0); p.castShadow = true; scene.add(p);
    });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, px * 2 + r * 2, 16), postM);
    bar.rotation.z = Math.PI / 2; bar.position.set(0, G.h + r, 0); bar.castShadow = true;
    scene.add(bar);
    // 그물 지지대
    const supM = new THREE.MeshStandardMaterial({ color: '#d0d0d0', roughness: 0.5 });
    [-px, px].forEach((x) => {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, Math.hypot(G.depth, G.h), 8), supM);
      s.position.set(x, G.h / 2, -G.depth / 2);
      s.rotation.x = Math.atan2(G.depth, G.h);
      scene.add(s);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, G.depth, 8), supM);
      b.rotation.x = Math.PI / 2; b.position.set(x, 0.025, -G.depth / 2); scene.add(b);
    });

    // ---------- 그물 (뒤쪽은 변형 가능) ----------
    const netM = new THREE.MeshBasicMaterial({ color: '#f4f4f4', wireframe: true, transparent: true, opacity: 0.55 });
    // 뒷그물: 위쪽 가장자리는 크로스바(z=0) → 아래쪽은 z=-depth 로 기울어진 면
    const backGeo = new THREE.PlaneGeometry(px * 2, Math.hypot(G.depth, G.h), 48, 18);
    const back = new THREE.Mesh(backGeo, netM);
    back.position.set(0, G.h / 2, -G.depth / 2);
    back.rotation.x = Math.atan2(G.depth, G.h);
    scene.add(back);
    const basePos = backGeo.attributes.position.array.slice();
    const sideShape = new THREE.Shape();
    sideShape.moveTo(0, 0); sideShape.lineTo(G.depth, 0); sideShape.lineTo(0, G.h); sideShape.lineTo(0, 0);
    const sideGeo = new THREE.ShapeGeometry(sideShape, 1);
    [-px, px].forEach((x) => {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(G.depth, G.h, 8, 10), netM);
      // 삼각형 모양을 흉내내기 위해 정점을 깎아줌
      const pa = side.geometry.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const u = (pa.getX(i) + G.depth / 2) / G.depth; // 0 = 골라인, 1 = 뒤
        const v = (pa.getY(i) + G.h / 2) / G.h;
        pa.setY(i, v * G.h * (1 - u) - G.h / 2 + 0.0001);
      }
      side.rotation.y = Math.PI / 2;
      side.position.set(x, G.h / 2, -G.depth / 2);
      side.geometry.attributes.position.needsUpdate = true;
      scene.add(side);
    });
    sideGeo.dispose();

    out.net = {
      mesh: back, base: basePos, disp: new Float32Array(backGeo.attributes.position.count), vel: new Float32Array(backGeo.attributes.position.count),
      hit(worldPoint, strength) {
        const local = back.worldToLocal(worldPoint.clone());
        const pa = backGeo.attributes.position;
        for (let i = 0; i < pa.count; i++) {
          const dx = basePos[i * 3] - local.x, dy = basePos[i * 3 + 1] - local.y;
          const f = Math.exp(-(dx * dx + dy * dy) / 0.35);
          this.vel[i] -= f * strength;
        }
      },
      update(dt) {
        const pa = backGeo.attributes.position;
        let active = false;
        for (let i = 0; i < pa.count; i++) {
          this.vel[i] += (-60 * this.disp[i] - 6 * this.vel[i]) * dt;
          this.disp[i] += this.vel[i] * dt;
          if (Math.abs(this.disp[i]) > 1e-4) active = true;
          pa.setZ(i, basePos[i * 3 + 2] + this.disp[i]);
        }
        if (active) pa.needsUpdate = true;
      },
    };

    // ---------- 광고판 ----------
    const adCv = document.createElement('canvas'); adCv.width = 1024; adCv.height = 64;
    const ag = adCv.getContext('2d');
    const ads = ['PK ONLINE', 'GOAL!', '11M CLUB', 'SUDDEN DEATH', 'KEEPER CUP'];
    for (let i = 0; i < 5; i++) {
      ag.fillStyle = ['#0d3b8c', '#c6ff3d', '#d42a2a', '#111', '#ff7a1a'][i];
      ag.fillRect(i * 205, 0, 205, 64);
      ag.fillStyle = i === 1 ? '#111' : '#fff';
      ag.font = '900 30px Arial'; ag.textAlign = 'center'; ag.textBaseline = 'middle';
      ag.fillText(ads[i], i * 205 + 102, 33);
    }
    const adTex = PK.canvasTex(adCv);
    adTex.wrapS = THREE.RepeatWrapping; adTex.repeat.x = 3;
    const adM = new THREE.MeshBasicMaterial({ map: adTex });
    const boardBack = new THREE.Mesh(new THREE.BoxGeometry(48, 0.9, 0.2), [adM, adM, adM, adM, adM, adM]);
    boardBack.position.set(0, 0.45, -4.5); scene.add(boardBack);
    out.adTex = adTex;

    // ---------- 관중석 ----------
    const standM = new THREE.MeshStandardMaterial({ color: '#2a2f3a', roughness: 0.9 });
    const crowdGeo = new THREE.BoxGeometry(0.42, 0.62, 0.32);
    const crowdM = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const seats = [];
    const addStand = (cx, cz, w, rotY, rows) => {
      const grp = new THREE.Group();
      grp.position.set(cx, 0, cz); grp.rotation.y = rotY;
      for (let rI = 0; rI < rows; rI++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, 1.1), standM);
        step.position.set(0, 1.2 + rI * 0.7 - 0.35, -rI * 1.1);
        step.receiveShadow = true;
        grp.add(step);
        for (let x = -w / 2 + 0.4; x < w / 2 - 0.3; x += 0.55) {
          if (Math.random() < 0.1) continue;
          seats.push({ grp, x: x + (Math.random() - 0.5) * 0.12, y: 1.2 + rI * 0.7 + 0.31, z: -rI * 1.1 + (Math.random() - 0.5) * 0.15 });
        }
      }
      // 뒤 벽
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, rows * 0.7 + 4, 0.5), standM);
      wall.position.set(0, (rows * 0.7 + 4) / 2, -rows * 1.1);
      grp.add(wall);
      scene.add(grp);
      return grp;
    };
    addStand(0, -7, 60, 0, 14);
    addStand(-27, 16, 44, Math.PI / 2, 12);
    addStand(27, 16, 44, -Math.PI / 2, 12);

    const crowd = new THREE.InstancedMesh(crowdGeo, crowdM, seats.length);
    const palette = ['#d42a2a', '#ffffff', '#1b54d1', '#ffd21f', '#222', '#e0e0e0', '#ff7a1a', '#3fbf5a'];
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    seats.forEach((s, i) => {
      s.grp.updateMatrixWorld();
      const p = new THREE.Vector3(s.x, s.y, s.z).applyMatrix4(s.grp.matrixWorld);
      dummy.position.copy(p);
      dummy.rotation.set(0, s.grp.rotation.y, 0);
      dummy.updateMatrix();
      crowd.setMatrixAt(i, dummy.matrix);
      color.set(palette[Math.floor(Math.random() * palette.length)]).multiplyScalar(0.3 + Math.random() * 0.35);
      crowd.setColorAt(i, color);
      s.base = p.y; s.phase = Math.random() * 10;
      s.world = p; s.rot = s.grp.rotation.y;
    });
    scene.add(crowd);
    out.crowd = {
      mesh: crowd, seats, excite: 0,
      update(t) {
        if (this.excite < 0.02 && this._still) return;
        this._still = this.excite < 0.02;
        seats.forEach((s, i) => {
          const j = Math.max(0, Math.sin(t * 11 + s.phase)) * 0.35 * this.excite;
          dummy.position.set(s.world.x, s.base + j, s.world.z);
          dummy.rotation.set(0, s.rot, 0);
          dummy.updateMatrix();
          crowd.setMatrixAt(i, dummy.matrix);
        });
        crowd.instanceMatrix.needsUpdate = true;
      },
    };

    // ---------- 조명탑 ----------
    const towerM = new THREE.MeshStandardMaterial({ color: '#555b66' });
    const lampM = new THREE.MeshBasicMaterial({ color: '#fffbe0' });
    [[-30, -10], [30, -10], [-30, 40], [30, 40]].forEach(([x, z]) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 30, 8), towerM);
      t.position.set(x, 15, z); scene.add(t);
      const l = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 0.4), lampM);
      l.position.set(x, 30, z); l.lookAt(0, 0, 10); scene.add(l);
    });

    // ---------- 공 ----------
    const bcv = document.createElement('canvas'); bcv.width = 512; bcv.height = 256;
    const bg = bcv.getContext('2d');
    bg.fillStyle = '#fafafa'; bg.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 14; i++) {
      const x = (i % 7) * 75 + (Math.floor(i / 7) % 2) * 37, y = 64 + Math.floor(i / 7) * 128;
      bg.fillStyle = i % 3 === 0 ? '#1b1b1b' : '#2a6cf0';
      bg.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
        bg.lineTo(x + Math.cos(a) * 26, y + Math.sin(a) * 22);
      }
      bg.fill();
    }
    const ballTex = PK.canvasTex(bcv);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 28, 20), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.45 }));
    ball.castShadow = true;
    scene.add(ball);
    out.ball = ball;

    // 조준용 마커
    const ringM = new THREE.MeshBasicMaterial({ color: '#c6ff3d', transparent: true, opacity: 0.9, depthTest: false });
    const aim = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.22, 32), ringM);
    const dotM = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), ringM);
    aim.add(ring, dotM);
    aim.renderOrder = 10; ring.renderOrder = 10; dotM.renderOrder = 10;
    scene.add(aim);
    out.aim = aim; out.aimMat = ringM;

    // 예상 궤적 선
    const trajGeo = new THREE.BufferGeometry();
    trajGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(80 * 3), 3));
    const traj = new THREE.Line(trajGeo, new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.6, depthTest: false }));
    traj.renderOrder = 9;
    traj.frustumCulled = false;
    scene.add(traj);
    out.traj = traj;

    return out;
  }

  return { build };
})();
