// 경기장: 잔디, 라인, 골대, 그물, 관중석, 조명
// 좌표계: 골라인 z=0, 골 중앙 x=0, 필드는 +z 방향. 페널티 스팟 z=11
window.PK = window.PK || {};

PK.GOAL = { halfW: 3.66, h: 2.44, postR: 0.06, depth: 2.0, spotZ: 11 };

// 클래식 흑백 축구공: 깎은 정이십면체 (검은 오각형 12 + 흰 육각형 20). 구 UV(정방형)에 그림
PK.ballTexture = (function () {
  let tex = null;
  return function () {
    if (tex) return tex;
    const W = 1024, H = 512;
    const phi = (1 + Math.sqrt(5)) / 2;
    const V = [];
    [[0, 1, phi], [0, 1, -phi], [0, -1, phi], [0, -1, -phi]].forEach(([a, b, c]) => { V.push([a, b, c], [b, c, a], [c, a, b]); });
    const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    const C = []; // 면 중심 [x,y,z, 반지름(rad), 오각형?]
    V.forEach((v) => C.push([...norm(v), 0, 1]));
    for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) {
      if (Math.abs(d2(V[i], V[j]) - 4) < 1e-6 && Math.abs(d2(V[j], V[k]) - 4) < 1e-6 && Math.abs(d2(V[i], V[k]) - 4) < 1e-6) {
        C.push([...norm([V[i][0] + V[j][0] + V[k][0], V[i][1] + V[j][1] + V[k][1], V[i][2] + V[j][2] + V[k][2]]), 0, 0]);
      }
    }
    const rH = Math.acos(Math.sqrt(5) / 3) / 2;                    // 육각형 안쪽 반지름 (이웃 육각형 중심 각의 절반)
    let best = 9; for (let f = 12; f < C.length; f++) best = Math.min(best, Math.acos(Math.min(1, C[0][0] * C[f][0] + C[0][1] * C[f][1] + C[0][2] * C[f][2])));
    C.forEach((c) => { c[3] = c[4] ? best - rH : rH; });

    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const img = g.createImageData(W, H), px = img.data;
    const seam = 0.012; // 이음매 두께 (rad)
    for (let y = 0; y < H; y++) {
      const th = ((y + 0.5) / H) * Math.PI, st = Math.sin(th), ct = Math.cos(th);
      for (let x = 0; x < W; x++) {
        const ph = ((x + 0.5) / W) * Math.PI * 2;
        const dx = -Math.cos(ph) * st, dy = ct, dz = Math.sin(ph) * st; // three.js SphereGeometry 와 같은 방향
        let b1 = 9, b2 = 9, pent = 0;
        for (let f = 0; f < C.length; f++) {
          const c = C[f];
          const s = Math.acos(Math.max(-1, Math.min(1, dx * c[0] + dy * c[1] + dz * c[2]))) - c[3];
          if (s < b1) { b2 = b1; b1 = s; pent = c[4]; } else if (s < b2) b2 = s;
        }
        const e = (b2 - b1) / 2; // 가장 가까운 이음매까지 각
        let v = pent ? 22 : 246;
        if (e < seam) v = pent ? 14 : 150 + 80 * (e / seam);       // 꿰맨 자국: 오목하게 어둡게
        else if (!pent && e < seam * 3) v = 236 + 10 * ((e - seam) / (seam * 2)); // 육각형 가장자리 살짝 그늘
        const i = (y * W + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    tex = PK.canvasTex(cv);
    tex.anisotropy = 4;
    return tex;
  };
})();

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
    const pitchM = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
    // 가까이서 보이는 잔디 결: 아주 잘게 밝기를 흩뿌림 (멀리서는 반짝이지 않게 흐려짐)
    pitchM.extensions = { derivatives: true };
    pitchM.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
vec2 gp = vUv * vec2(${W * 110}.0, ${D * 110}.0);
vec2 gw = fwidth(gp);
float fade = clamp(1.4 - max(gw.x, gw.y) * 0.9, 0.0, 1.0);
float h1 = fract(sin(dot(floor(gp), vec2(12.9898, 78.233))) * 43758.5453);
float h2 = fract(sin(dot(floor(gp * vec2(0.5, 0.18)), vec2(39.346, 11.135))) * 24634.6345);
diffuseColor.rgb *= 1.0 + fade * ((h1 - 0.5) * 0.22 + (h2 - 0.5) * 0.14);`);
    };
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(W, D), pitchM);
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
    // 계단식 좌석(층마다 의자 줄) + 앞쪽 LED 광고 띠 + 지붕. 관중은 사람 모양을 한 번에 그리고(인스턴싱), 움직임은 그래픽 카드에서 계산
    const standM = new THREE.MeshStandardMaterial({ color: '#2b313d', roughness: 0.92 });
    const concreteM = new THREE.MeshStandardMaterial({ color: '#3a414e', roughness: 0.95 });
    const roofM = new THREE.MeshStandardMaterial({ color: '#1c2129', roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
    const steelM = new THREE.MeshStandardMaterial({ color: '#8a919c', roughness: 0.4, metalness: 0.6 });
    // 좌석 텍스처: 팀 색처럼 보이는 줄무늬 의자 (빈자리로 보임)
    const seatCv = document.createElement('canvas'); seatCv.width = 64; seatCv.height = 16;
    const sg = seatCv.getContext('2d'); sg.fillStyle = '#20252e'; sg.fillRect(0, 0, 64, 16);
    for (let i = 0; i < 8; i++) { sg.fillStyle = i % 4 === 0 ? '#0f5ea8' : '#1667b9'; sg.fillRect(i * 8 + 1, 3, 6, 9); }
    const seatTex = PK.canvasTex(seatCv); seatTex.wrapS = THREE.RepeatWrapping;
    // LED 광고 띠 (관중석 맨 앞)
    const ledCv = document.createElement('canvas'); ledCv.width = 1024; ledCv.height = 32;
    const lg = ledCv.getContext('2d');
    ['#0d3b8c', '#111', '#c6ff3d', '#d42a2a', '#111'].forEach((c, i) => { lg.fillStyle = c; lg.fillRect(i * 205, 0, 205, 32); });
    lg.font = '900 20px Arial'; lg.textAlign = 'center'; lg.textBaseline = 'middle';
    ['PK ONLINE', 'PENALTY NIGHT', 'GOAL!', '11M CLUB', 'KEEPER CUP'].forEach((t, i) => { lg.fillStyle = i === 2 ? '#111' : '#fff'; lg.fillText(t, i * 205 + 102, 17); });
    const ledTex = PK.canvasTex(ledCv); ledTex.wrapS = THREE.RepeatWrapping;
    out.ledTex = ledTex;

    const seats = [];
    const ROW_H = 0.55, ROW_D = 0.85, BASE_Y = 1.6;
    const addStand = (cx, cz, w, rotY, rows) => {
      const grp = new THREE.Group();
      grp.position.set(cx, 0, cz); grp.rotation.y = rotY;
      // 앞 벽 + LED 띠
      const front = new THREE.Mesh(new THREE.BoxGeometry(w, BASE_Y, 0.4), concreteM); front.position.set(0, BASE_Y / 2, 0.45); grp.add(front);
      const ledM = new THREE.MeshBasicMaterial({ map: ledTex.clone() }); ledM.map.needsUpdate = true; ledM.map.repeat.x = w / 14;
      const led = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.55), ledM); led.position.set(0, BASE_Y - 0.4, 0.66); grp.add(led);
      out.leds = (out.leds || []).concat(ledM.map);
      for (let rI = 0; rI < rows; rI++) {
        const y = BASE_Y + rI * ROW_H;
        const step = new THREE.Mesh(new THREE.BoxGeometry(w, ROW_H, ROW_D), standM);
        step.position.set(0, y - ROW_H / 2, -rI * ROW_D); step.receiveShadow = true; grp.add(step);
        // 의자 줄 (사람이 없는 자리에서 보임)
        const sm = new THREE.MeshLambertMaterial({ map: seatTex.clone() }); sm.map.needsUpdate = true; sm.map.repeat.x = w / 4;
        const seatRow = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.32), sm);
        seatRow.position.set(0, y + 0.16, -rI * ROW_D - 0.18); grp.add(seatRow);
        for (let x = -w / 2 + 0.3; x < w / 2 - 0.25; x += 0.5) {
          if (Math.random() < 0.07) continue; // 빈자리
          seats.push({ grp, x: x + (Math.random() - 0.5) * 0.08, y, z: -rI * ROW_D + 0.05 + (Math.random() - 0.5) * 0.06, row: rI });
        }
      }
      const depth = rows * ROW_D, topY = BASE_Y + rows * ROW_H;
      // 뒤 벽
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, topY + 3, 0.5), concreteM); wall.position.set(0, (topY + 3) / 2, -depth); grp.add(wall);
      // 지붕: 뒤에서 앞으로 살짝 올라가는 판 + 기둥
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(w + 1, depth + 3), roofM);
      roof.rotation.x = -Math.PI / 2 + 0.12; roof.position.set(0, topY + 3.2, -depth / 2 + 0.3); grp.add(roof);
      for (let x = -w / 2 + 2; x <= w / 2 - 2; x += 12) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, topY + 3, 8), steelM); col.position.set(x, (topY + 3) / 2, -depth + 0.4); grp.add(col);
        const truss = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, depth + 3), steelM); truss.position.set(x, topY + 3.05, -depth / 2 + 0.3); truss.rotation.x = 0.12; grp.add(truss);
      }
      scene.add(grp);
      return grp;
    };
    addStand(0, -7, 62, 0, 16);
    addStand(-27, 16, 46, Math.PI / 2, 14);
    addStand(27, 16, 46, -Math.PI / 2, 14);
    // 모서리 관중석 (뒤 관중석과 옆 관중석 사이 빈 곳)
    addStand(-31.5, -8.5, 11, Math.PI / 4, 14);
    addStand(31.5, -8.5, 11, -Math.PI / 4, 14);

    // 관중 한 명 모양 (앉은 자세 기준, 발밑 = 좌석 높이): 몸통·다리 / 머리 / 왼팔 / 오른팔 을 part 값으로 구분
    const fanGeo = (() => {
      const parts = [];
      const piece = (geo, part, x, y, z) => { geo.translate(x, y, z); const g2 = geo.toNonIndexed(); const n = g2.attributes.position.count; g2.setAttribute('part', new THREE.Float32BufferAttribute(new Array(n).fill(part), 1)); parts.push(g2); };
      // 관중이 수천 명이라 한 명당 삼각형 약 100개로 가볍게 (휴대폰에서도 부드럽게)
      piece(new THREE.CylinderGeometry(0.15, 0.17, 0.48, 6, 1, true), 0, 0, 0.5, 0); // 몸통
      piece(new THREE.BoxGeometry(0.3, 0.14, 0.4), 0, 0, 0.2, 0.12);                  // 허벅지(앉음)
      piece(new THREE.SphereGeometry(0.105, 7, 5), 1, 0, 0.88, 0.01);                 // 머리
      piece(new THREE.CylinderGeometry(0.045, 0.04, 0.42, 5, 1, true), 2, 0.2, 0.52, 0.02);   // 왼팔 (어깨 0.73 에서 아래로)
      piece(new THREE.CylinderGeometry(0.045, 0.04, 0.42, 5, 1, true), 3, -0.2, 0.52, 0.02);  // 오른팔
      piece(new THREE.CircleGeometry(0.15, 6).rotateX(-Math.PI / 2), 0, 0, 0.74, 0);   // 어깨 위 덮개
      const merged = new THREE.BufferGeometry();
      ['position', 'normal', 'part'].forEach((name) => {
        const size = parts[0].attributes[name].itemSize; let total = 0; parts.forEach((p) => (total += p.attributes[name].array.length));
        const arr = new Float32Array(total); let o = 0; parts.forEach((p) => { arr.set(p.attributes[name].array, o); o += p.attributes[name].array.length; });
        merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
      });
      return merged;
    })();
    const N = seats.length;
    const aPhase = new Float32Array(N), aTeam = new Float32Array(N), aSkin = new Float32Array(N);
    fanGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aPhase, 1));
    fanGeo.setAttribute('aTeam', new THREE.InstancedBufferAttribute(aTeam, 1));
    fanGeo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(aSkin, 1));
    const U = { uTime: { value: 0 }, uExcite: { value: 0 }, uCheer: { value: -1 } };
    const crowdM = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    crowdM.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float part; attribute float aPhase; attribute float aTeam; attribute float aSkin;
uniform float uTime; uniform float uExcite; uniform float uCheer;
varying float vPart; varying float vSkin;`)
        .replace('#include <begin_vertex>', `
vec3 transformed = vec3(position);
vPart = part; vSkin = aSkin;
// 기쁨(+1) / 아쉬움(-1) / 중립(0.4): 응원 팀이면 일어나 팔을 들고 뛰고, 상대 팀이면 머리를 감쌈
float mood = uCheer < -0.5 ? 0.0 : (abs(aTeam - uCheer) < 0.5 ? 1.0 : (aTeam > 1.5 ? 0.4 : -1.0));
float ex = uExcite * (0.75 + 0.25 * fract(aPhase * 7.13));
float joy = max(mood, 0.0) * ex, sad = max(-mood, 0.0) * ex;
float hop = max(0.0, sin(uTime * (8.0 + fract(aPhase * 3.7) * 3.0) + aPhase * 6.2831)) * 0.22 * joy;
float stand = 0.32 * clamp(joy * 1.6, 0.0, 1.0) + 0.12 * clamp(sad * 1.6, 0.0, 1.0);
if (part > 1.5) {
  float side = part > 2.5 ? -1.0 : 1.0;
  float wave = 0.25 * sin(uTime * 9.0 + aPhase * 17.0);
  float ang = side * (joy * (2.7 + wave) + sad * 2.3); // 팔을 머리 위로 / 머리 쪽으로
  vec2 pivot = vec2(side * 0.2, 0.73);
  vec2 q = transformed.xy - pivot; float c = cos(ang), s = sin(ang);
  transformed.xy = pivot + vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  transformed.z += sad * 0.12;
}
if (part > 0.5 && part < 1.5) transformed.z += sad * 0.06 - joy * 0.02;
transformed.y += hop + stand;
transformed.x += sin(uTime * 1.3 + aPhase * 20.0) * 0.012; // 가만히 있을 때도 살짝 움직임`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying float vPart; varying float vSkin;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
// 머리(와 절반쯤의 팔)는 피부색
vec3 skin = mix(vec3(0.95, 0.76, 0.6), vec3(0.32, 0.2, 0.13), vSkin);
if (vPart > 0.5 && vPart < 1.5) diffuseColor.rgb = skin * 0.85;
if (vPart > 1.5 && fract(vSkin * 13.0) < 0.5) diffuseColor.rgb = skin * 0.8;`);
    };
    const crowd = new THREE.InstancedMesh(fanGeo, crowdM, N);
    crowd.frustumCulled = false;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    seats.forEach((s, i) => {
      s.grp.updateMatrixWorld();
      const p = new THREE.Vector3(s.x, s.y, s.z).applyMatrix4(s.grp.matrixWorld);
      dummy.position.copy(p); dummy.rotation.set(0, s.grp.rotation.y + (Math.random() - 0.5) * 0.3, 0);
      const sc = 0.92 + Math.random() * 0.16; dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix(); crowd.setMatrixAt(i, dummy.matrix);
      aPhase[i] = Math.random(); aSkin[i] = Math.random() * Math.random();
      crowd.setColorAt(i, color.set('#888'));
    });
    scene.add(crowd);
    const palette = ['#e0e0e0', '#222', '#3a3f4a', '#7a6a55', '#2f4f7a', '#8a2a2a'];
    out.crowd = {
      mesh: crowd, seats, excite: 0, cheer: -1,
      // 경기 시작 때: 두 팀 유니폼 색으로 응원석을 나눔 (뒤 관중석은 섞이고, 양옆은 한 팀씩 많이)
      setTeams(colA, colB) {
        seats.forEach((s, i) => {
          s.grp.updateMatrixWorld();
          const wx = new THREE.Vector3(s.x, 0, 0).applyMatrix4(s.grp.matrixWorld).x;
          const pA = 0.5 + THREE.MathUtils.clamp(-wx / 40, -0.38, 0.38); // 왼쪽(−x)은 A 팀 쪽
          const r = Math.random(); const team = r < 0.1 ? 2 : (Math.random() < pA ? 0 : 1);
          aTeam[i] = team;
          const base = team === 0 ? colA[Math.random() < 0.75 ? 0 : 1] : team === 1 ? colB[Math.random() < 0.75 ? 0 : 1] : palette[(Math.random() * palette.length) | 0];
          // 지붕 그늘 아래라 조금 어둡게 + 사람마다 밝기 차이
          color.set(base).convertSRGBToLinear().multiplyScalar(0.35 + Math.random() * 0.35);
          crowd.setColorAt(i, color);
        });
        crowd.geometry.attributes.aTeam.needsUpdate = true;
        crowd.instanceColor.needsUpdate = true;
      },
      update(t) {
        U.uTime.value = t;
        // 흥분은 천천히 가라앉음
        this._ex = this._ex === undefined ? 0 : this._ex + (this.excite - this._ex) * Math.min(1, (this._dt || 0.016) * 4);
        U.uExcite.value = this._ex; U.uCheer.value = this.cheer;
      },
    };

    // ---------- 조명탑 ----------
    // 기둥 + 램프 격자(빛나는 면) + 은은한 빛 번짐(더하기 합성)
    const towerM = new THREE.MeshStandardMaterial({ color: '#5a616c', roughness: 0.5, metalness: 0.5 });
    const lampCv = document.createElement('canvas'); lampCv.width = 128; lampCv.height = 64;
    const lc = lampCv.getContext('2d'); lc.fillStyle = '#20242c'; lc.fillRect(0, 0, 128, 64);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) { const gr = lc.createRadialGradient(8 + x * 16, 8 + y * 16, 0, 8 + x * 16, 8 + y * 16, 7); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#fff4cf'); gr.addColorStop(1, '#5a5a48'); lc.fillStyle = gr; lc.fillRect(x * 16 + 1, y * 16 + 1, 14, 14); }
    const lampM = new THREE.MeshBasicMaterial({ map: PK.canvasTex(lampCv) });
    const glowCv = document.createElement('canvas'); glowCv.width = glowCv.height = 128;
    const gg = glowCv.getContext('2d'); const ggr = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
    ggr.addColorStop(0, 'rgba(255,250,225,0.9)'); ggr.addColorStop(0.25, 'rgba(255,240,200,0.35)'); ggr.addColorStop(1, 'rgba(255,240,200,0)');
    gg.fillStyle = ggr; gg.fillRect(0, 0, 128, 128);
    const glowM = new THREE.SpriteMaterial({ map: PK.canvasTex(glowCv), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    [[-31, -12], [31, -12], [-31, 42], [31, 42]].forEach(([x, z]) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 32, 10), towerM); t.position.set(x, 16, z); scene.add(t);
      const head = new THREE.Group(); head.position.set(x, 32.5, z); head.lookAt(0, 0, 10); scene.add(head);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.4, 0.3), towerM); frame.position.z = -0.12; head.add(frame);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), lampM); panel.position.z = 0.04; head.add(panel);
      const glow = new THREE.Sprite(glowM); glow.scale.set(16, 16, 1); glow.position.set(x * 0.98, 32.5, z + (z < 0 ? 0.6 : -0.6)); scene.add(glow);
    });

    // ---------- 공 ----------
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 48, 32), new THREE.MeshStandardMaterial({ map: PK.ballTexture(), roughness: 0.38 }));
    ball.castShadow = true;
    scene.add(ball);
    out.ball = ball;

    // 조준용 마커
    const ringM = new THREE.MeshBasicMaterial({ color: '#c6ff3d', transparent: true, opacity: 0.9, depthTest: false });
    const aim = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.125, 0.165, 32), ringM); // 조준 원 (지름 33cm)
    const dotM = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), ringM);
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
