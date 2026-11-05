// 선수 아바타: 기본 도형으로 만든 관절형 캐릭터 + 커스터마이즈 옵션
window.PK = window.PK || {};

// 캔버스 텍스처를 sRGB 로 (색이 바래 보이지 않게)
PK.canvasTex = function (canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.encoding = THREE.sRGBEncoding;
  return t;
};

PK.Options = {
  hair: ['숏컷', '스파이크', '모히칸', '장발', '아프로', '묶음머리', '삭발'],
  hairColor: [
    { name: '흑발', c: '#1b1512' }, { name: '갈색', c: '#5a3620' }, { name: '금발', c: '#e3c06a' },
    { name: '적발', c: '#b0401f' }, { name: '백발', c: '#e4e4e8' }, { name: '파랑', c: '#2f6fe0' },
    { name: '분홍', c: '#ff6fae' }, { name: '초록', c: '#3fbf5a' },
  ],
  skin: [
    { name: '밝은 톤', c: '#ffe0c4' }, { name: '연한 톤', c: '#f2c49b' }, { name: '보통 톤', c: '#d9a074' },
    { name: '구릿빛', c: '#b97c4f' }, { name: '갈색', c: '#8a5536' }, { name: '진한 톤', c: '#5a3623' },
  ],
  face: ['미소', '진지', '자신감', '화남', '놀람', '윙크'],
  uniform: [
    { name: '레드 솔리드', p: 'solid', c1: '#d42a2a', c2: '#ffffff', shorts: '#ffffff', socks: '#d42a2a', gk: '#18c472' },
    { name: '블루 스트라이프', p: 'stripes', c1: '#1b54d1', c2: '#0b1c47', shorts: '#0b1c47', socks: '#1b54d1', gk: '#ff9f1a' },
    { name: '화이트 클래식', p: 'solid', c1: '#f3f3f3', c2: '#151515', shorts: '#151515', socks: '#f3f3f3', gk: '#8a3cff' },
    { name: '옐로 후프', p: 'hoops', c1: '#ffd21f', c2: '#14632b', shorts: '#14632b', socks: '#ffd21f', gk: '#e8336b' },
    { name: '블랙 골드', p: 'sash', c1: '#151515', c2: '#d9aa2b', shorts: '#151515', socks: '#d9aa2b', gk: '#2ed3ff' },
    { name: '스카이 하프', p: 'halves', c1: '#7cc8ff', c2: '#ffffff', shorts: '#ffffff', socks: '#7cc8ff', gk: '#ffe51f' },
    { name: '오렌지 블레이즈', p: 'chevron', c1: '#ff7a1a', c2: '#1d1d1d', shorts: '#1d1d1d', socks: '#ff7a1a', gk: '#4a6bff' },
    { name: '퍼플 스트라이프', p: 'stripes', c1: '#6c2bd9', c2: '#f0f0f0', shorts: '#f0f0f0', socks: '#6c2bd9', gk: '#c6ff3d' },
  ],
  boots: [
    { name: '블랙', c: '#161616', s: '#f0f0f0' }, { name: '화이트', c: '#f2f2f2', s: '#d42a2a' },
    { name: '네온 옐로', c: '#d8ff2a', s: '#151515' }, { name: '핫핑크', c: '#ff3d8b', s: '#ffffff' },
    { name: '일렉트릭 블루', c: '#1f7bff', s: '#ffffff' }, { name: '골드', c: '#e8b923', s: '#151515' },
    { name: '레드', c: '#e2231a', s: '#ffffff' },
  ],
};

PK.Avatar = (function () {
  const R = 0.12; // 머리 반지름

  function mat(color, extra) {
    return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.75, metalness: 0.0 }, extra || {}));
  }

  function mesh(geo, material, parent, x, y, z) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    m.receiveShadow = false;
    if (parent) parent.add(m);
    return m;
  }

  // ---------- 얼굴 텍스처 ----------
  function faceTexture(face, browColor) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const g = cv.getContext('2d');
    g.scale(2, 2);
    g.lineCap = 'round';
    g.lineJoin = 'round';

    const eyeY = 128, lx = 92, rx = 164;
    const eye = (x, open) => {
      if (!open) { // 감은 눈
        g.strokeStyle = '#1a1a1a'; g.lineWidth = 6;
        g.beginPath(); g.moveTo(x - 13, eyeY); g.quadraticCurveTo(x, eyeY + 9, x + 13, eyeY); g.stroke();
        return;
      }
      const h = open === 'wide' ? 14 : 10;
      const inner = x < 128 ? 1 : -1; // 눈 안쪽(코 쪽)
      g.save();
      g.beginPath();
      g.moveTo(x - 16, eyeY + (inner > 0 ? 0 : 2));
      g.bezierCurveTo(x - 9, eyeY - h * 1.25, x + 9, eyeY - h * 1.25, x + 16, eyeY + (inner > 0 ? 2 : 0));
      g.bezierCurveTo(x + 8, eyeY + h * 0.9, x - 8, eyeY + h * 0.9, x - 16, eyeY + (inner > 0 ? 0 : 2));
      g.closePath();
      g.fillStyle = '#f7f5f0'; g.fill();
      g.clip();
      const ir = open === 'wide' ? 7.5 : 8.5;
      const grd = g.createRadialGradient(x, eyeY, 1, x, eyeY, ir);
      grd.addColorStop(0, '#7a5434'); grd.addColorStop(1, '#3b2414');
      g.fillStyle = grd; g.beginPath(); g.arc(x, eyeY, ir, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#120a06'; g.beginPath(); g.arc(x, eyeY, ir * 0.45, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x - 18, eyeY - h * 1.3, 36, 4); // 눈꺼풀 그림자
      g.restore();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 2.5, eyeY - 3, 2.2, 0, Math.PI * 2); g.fill();
      // 윗눈꺼풀 선 (바깥쪽이 살짝 두껍게)
      g.strokeStyle = '#1d130d'; g.lineWidth = 3.4;
      g.beginPath();
      g.moveTo(x - 17, eyeY + (inner > 0 ? 1 : 3));
      g.bezierCurveTo(x - 9, eyeY - h * 1.3, x + 9, eyeY - h * 1.3, x + 17, eyeY + (inner > 0 ? 3 : 1));
      g.stroke();
    };
    const brow = (x, tilt, lift) => {
      const inner = x < 128 ? 1 : -1;
      const xi = x + 16 * inner, xo = x - 17 * inner;
      const yi = eyeY - 26 - lift - tilt * inner, yo = eyeY - 26 - lift + tilt * inner;
      g.fillStyle = browColor;
      g.beginPath();
      g.moveTo(xi, yi - 4.5);
      g.quadraticCurveTo(x, Math.min(yi, yo) - 7, xo, yo - 1);
      g.lineTo(xo, yo + 1.5);
      g.quadraticCurveTo(x, Math.min(yi, yo) + 1, xi, yi + 4);
      g.closePath(); g.fill();
    };
    const dir = (x) => (x < 128 ? 1 : -1); // 안쪽 방향 부호

    g.strokeStyle = '#8a3a33';
    g.fillStyle = '#6e2622';
    switch (face) {
      case 0: // 미소
        eye(lx, true); eye(rx, true); brow(lx, 0, 2); brow(rx, 0, 2);
        g.lineWidth = 7; g.beginPath(); g.arc(128, 172, 30, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
        break;
      case 1: // 진지
        eye(lx, true); eye(rx, true); brow(lx, -2 * dir(lx), 0); brow(rx, -2 * dir(rx), 0);
        g.lineWidth = 7; g.beginPath(); g.moveTo(108, 196); g.lineTo(148, 196); g.stroke();
        break;
      case 2: // 자신감 (한쪽 입꼬리)
        eye(lx, true); eye(rx, true); brow(lx, 0, 0); brow(rx, 4, 6);
        g.lineWidth = 7; g.beginPath(); g.moveTo(106, 196); g.quadraticCurveTo(136, 200, 154, 184); g.stroke();
        break;
      case 3: // 화남
        eye(lx, true); eye(rx, true);
        g.strokeStyle = browColor; g.lineWidth = 9;
        g.beginPath(); g.moveTo(lx - 16, eyeY - 34); g.lineTo(lx + 16, eyeY - 20); g.stroke();
        g.beginPath(); g.moveTo(rx + 16, eyeY - 34); g.lineTo(rx - 16, eyeY - 20); g.stroke();
        g.strokeStyle = '#5a1d1d'; g.lineWidth = 7;
        g.beginPath(); g.arc(128, 214, 24, 1.2 * Math.PI, 1.8 * Math.PI); g.stroke();
        break;
      case 4: // 놀람
        eye(lx, 'wide'); eye(rx, 'wide'); brow(lx, 0, 10); brow(rx, 0, 10);
        g.beginPath(); g.ellipse(128, 194, 11, 15, 0, 0, Math.PI * 2); g.fill();
        break;
      case 5: // 윙크
        eye(lx, true); eye(rx, false); brow(lx, 0, 4); brow(rx, 0, 0);
        g.lineWidth = 7; g.beginPath(); g.arc(128, 168, 32, 0.12 * Math.PI, 0.88 * Math.PI); g.stroke();
        g.fillStyle = '#e86a7a'; g.beginPath(); g.ellipse(140, 200, 9, 6, 0, 0, Math.PI * 2); g.fill();
        break;
    }
    // 코 밑 그림자
    g.fillStyle = 'rgba(110, 50, 30, 0.16)';
    g.beginPath(); g.ellipse(128, 160, 11, 4, 0, 0, Math.PI * 2); g.fill();
    // 볼 터치
    g.fillStyle = 'rgba(200, 90, 80, 0.07)'; // 볼 홍조는 은은하게
    g.beginPath(); g.arc(70, 165, 14, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(186, 165, 14, 0, Math.PI * 2); g.fill();

    const tex = PK.canvasTex(cv);
    tex.anisotropy = 4;
    return tex;
  }

  // ---------- 유니폼 텍스처 ----------
  function shirtTexture(u, number, keeper) {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 256;
    const g = cv.getContext('2d');
    const c1 = keeper ? u.gk : u.c1;
    const c2 = keeper ? shade(u.gk, -0.35) : u.c2;
    g.fillStyle = c1; g.fillRect(0, 0, 512, 256);
    g.fillStyle = c2;
    const p = keeper ? 'keeper' : u.p;
    if (p === 'stripes') {
      for (let x = 0; x < 512; x += 64) g.fillRect(x + 20, 0, 26, 256);
    } else if (p === 'hoops') {
      for (let y = 20; y < 256; y += 56) g.fillRect(0, y, 512, 24);
    } else if (p === 'sash') {
      g.beginPath(); g.moveTo(-40, 0); g.lineTo(30, 0); g.lineTo(130, 256); g.lineTo(60, 256); g.fill();
      g.beginPath(); g.moveTo(472, 0); g.lineTo(552, 0); g.lineTo(552, 70); g.fill();
    } else if (p === 'halves') {
      g.fillRect(0, 0, 128, 256); g.fillRect(384, 0, 128, 256);
    } else if (p === 'chevron') {
      g.beginPath(); g.moveTo(-60, 40); g.lineTo(0, 110); g.lineTo(60, 40); g.lineTo(60, 80); g.lineTo(0, 150); g.lineTo(-60, 80); g.fill();
      g.beginPath(); g.moveTo(452, 40); g.lineTo(512, 110); g.lineTo(572, 40); g.lineTo(572, 80); g.lineTo(512, 150); g.lineTo(452, 80); g.fill();
    } else if (p === 'keeper') {
      g.globalAlpha = 0.25;
      for (let x = -256; x < 512; x += 40) {
        g.beginPath(); g.moveTo(x, 256); g.lineTo(x + 256, 0); g.lineTo(x + 272, 0); g.lineTo(x + 16, 256); g.fill();
      }
      g.globalAlpha = 1;
    }
    // 목 칼라 & 밑단
    g.fillStyle = c2; g.fillRect(0, 0, 512, 10); g.fillRect(0, 248, 512, 8);

    // 등번호 (뒤 = u 0.5)
    const numColor = luminance(c1) > 0.55 ? '#141414' : '#ffffff';
    g.font = '900 120px "Noto Sans KR", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = luminance(c1) > 0.55 ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.35)';
    g.strokeText(String(number), 256, 130);
    g.fillStyle = numColor; g.fillText(String(number), 256, 130);
    // 앞 가슴 작은 번호 + 엠블럼
    g.font = '900 34px Arial, sans-serif';
    g.fillText(String(number), 486, 96);
    g.beginPath(); g.fillStyle = numColor;
    g.moveTo(30, 80); g.lineTo(50, 80); g.lineTo(50, 100); g.lineTo(40, 110); g.lineTo(30, 100); g.closePath(); g.fill();

    const tex = PK.canvasTex(cv);
    tex.anisotropy = 4;
    return tex;
  }

  function shade(hex, amt) {
    const c = new THREE.Color(hex);
    if (amt < 0) c.multiplyScalar(1 + amt); else c.lerp(new THREE.Color('#ffffff'), amt);
    return '#' + c.getHexString();
  }
  function luminance(hex) {
    const c = new THREE.Color(hex);
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  }

  // ---------- 헤어 ----------
  function buildHair(head, style, color, skinColor) {
    const hm = mat(color, { roughness: 0.82 });
    const cap = (radius, theta, tilt, material) => {
      const geo = new THREE.SphereGeometry(radius, 28, 14, 0, Math.PI * 2, 0, theta);
      const m = mesh(geo, material || hm, head);
      m.rotation.x = tilt;
      return m;
    };
    const spikeOnSphere = (dirVec, len, rad, material) => {
      const d = dirVec.clone().normalize();
      const geo = new THREE.ConeGeometry(rad, len, 6);
      const m = mesh(geo, material || hm, head);
      m.position.copy(d.clone().multiplyScalar(R * 1.0 + len * 0.4));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      return m;
    };

    switch (style) {
      case 0: // 숏컷
        cap(R * 1.07, 1.2, -0.42);
        // 앞머리 살짝
        { const f = mesh(new THREE.SphereGeometry(0.06, 16, 10), hm, head, 0.012, 0.088, 0.072); f.scale.set(1.45, 0.42, 0.75); f.rotation.set(-0.45, 0, -0.12); }
        break;
      case 1: // 스파이크
        cap(R * 1.05, 1.15, -0.4);
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const ring = i % 2 === 0 ? 0.55 : 0.95;
          spikeOnSphere(new THREE.Vector3(Math.cos(a) * ring, 1.1, Math.sin(a) * ring - 0.15), 0.1, 0.03);
        }
        spikeOnSphere(new THREE.Vector3(0, 1, -0.1), 0.12, 0.035);
        break;
      case 2: { // 모히칸
        const buzz = mat(new THREE.Color(color).lerp(new THREE.Color(skinColor), 0.55), { roughness: 1 });
        cap(R * 1.015, 1.35, -0.35, buzz);
        for (let i = 0; i < 8; i++) {
          const a = -0.55 + (i / 7) * 2.3; // 앞→뒤
          const d = new THREE.Vector3(0, Math.cos(a), Math.sin(-a) * 1.0 + 0.0);
          const m = mesh(new THREE.ConeGeometry(0.032, 0.12, 6), hm, head);
          m.scale.set(0.55, 1, 1.5);
          m.position.copy(d.clone().multiplyScalar(R + 0.04));
          m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        }
        break;
      }
      case 3: // 장발
        cap(R * 1.08, 1.45, -0.35);
        { const hs = mat(color, { roughness: 0.82, side: THREE.DoubleSide });
          mesh(new THREE.CylinderGeometry(R * 1.08, R * 1.2, 0.24, 28, 1, true, Math.PI * 0.32, Math.PI * 1.36), hs, head, 0, -0.1, -0.006); }
        break;
      case 4: { // 아프로
        const am = mat(color, { roughness: 1 });
        const m = mesh(new THREE.SphereGeometry(R * 1.42, 28, 20), am, head, 0, 0.075, -0.06);
        m.scale.set(1.08, 1, 1);
        for (let i = 0; i < 14; i++) { // 표면의 작은 뭉치
          const a = (i / 14) * Math.PI * 2, el = 0.2 + (i % 3) * 0.35;
          const d = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el) - 0.1);
          mesh(new THREE.SphereGeometry(0.045, 10, 8), am, head, d.x * R * 1.42 * 1.08, 0.075 + d.y * R * 1.42, -0.06 + d.z * R * 1.42);
        }
        break;
      }
      case 5: // 묶음머리
        cap(R * 1.06, 1.3, -0.4);
        mesh(new THREE.SphereGeometry(0.05, 14, 10), hm, head, 0, 0.1, -0.11);
        break;
      case 6: { // 삭발
        const buzz = mat(new THREE.Color(color).lerp(new THREE.Color(skinColor), 0.45), { roughness: 1 });
        cap(R * 1.012, 1.32, -0.38, buzz);
        break;
      }
    }
  }

  // 회전체 (팔다리·몸통 근육 모양): pts = [[반지름, 높이], ...] 높이 오름차순
  function lathe(pts, segs) {
    return new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(Math.max(0.0005, p[0]), p[1])), segs || 16);
  }
  function ring(r, tube, material, parent, y) {
    const m = mesh(new THREE.TorusGeometry(r, tube, 8, 28), material, parent, 0, y, 0);
    m.rotation.x = Math.PI / 2;
    return m;
  }
  const sameColor = (a, b) => a.toLowerCase() === b.toLowerCase();

  // 높이별 값 표 [[높이, 값], ...] (높이 내림차순) 사이를 선형 보간
  function table(rows, y) {
    if (y >= rows[0][0]) return rows[0][1];
    for (let i = 1; i < rows.length; i++) {
      if (y >= rows[i][0]) { const a = rows[i - 1], b = rows[i]; return lerpN(b[1], a[1], (y - b[0]) / (a[0] - b[0])); }
    }
    return rows[rows.length - 1][1];
  }
  const lerpN = (a, b, t) => a + (b - a) * t;

  // 반바지 반쪽 (s = +1 왼쪽, -1 오른쪽). 기본 자세의 몸 기준 좌표로 만듦
  //  허리~엉덩이: 골반 타원의 반쪽(안쪽 면은 몸 중앙 x=0) / 가랑이 아래: 허벅지를 감싸는 원 → 그 사이를 부드럽게 이어 붙임
  function shortsHalf(s) {
    const TOP = 1.07, HEM = 0.69, ROWS = 16;
    const K1 = 24, KW = 8, SEG = K1 + KW; // 바깥 곡면 24칸 + 몸 속 안쪽 벽 8칸
    const pelvisR = [[1.07, 0.165], [1.04, 0.169], [1.0, 0.178], [0.95, 0.184], [0.9, 0.184], [0.84, 0.18], [0.69, 0.18]];
    // 다리 구멍은 허벅지를 따라 조금 가늘게, 중심은 살짝 바깥으로 → 두 다리 사이가 벌어져 보임 (치마처럼 안 보이게)
    const legR = [[1.07, 0.1], [0.92, 0.097], [0.86, 0.09], [0.78, 0.084], [0.69, 0.08]];
    const ZS = 0.72;               // 골반 앞뒤 납작 비율
    const cL = 0.1 * s;            // 다리 구멍 중심
    const PH0 = -0.5;              // 앞 가운데 꼭짓점이 대응하는 허벅지 원의 각도
    const pos = [], nor = [], uv = [], idx = [];
    for (let r = 0; r <= ROWS; r++) {
      const v = r / ROWS, y = HEM + (TOP - HEM) * v;
      const a = table(pelvisR, y), b = a * ZS, rl = table(legR, y);
      for (let k = 0; k <= SEG; k++) {
        // 골반 쪽 점 E 와 면 방향: 앞 가운데(x=0) → 바깥 → 뒤 가운데(x=0) 는 골반 타원, 그다음 몸 속 벽을 따라 다시 앞으로
        // 앞·뒤 가운데 꼭짓점이 정확히 x=0 에 놓여 좌우 반쪽이 틈·골 없이 맞닿음
        let ex, ez, enx, enz, phi;
        if (k <= K1) {
          const th = Math.PI * (k / K1);
          ex = s * a * Math.sin(th); ez = b * Math.cos(th);
          enx = ex / (a * a); enz = ez / (b * b);
          phi = lerpN(PH0, Math.PI - PH0, k / K1);
        } else {
          const t = (k - K1) / KW;
          ex = 0; ez = lerpN(-b, b, t);
          // 다리를 벌리면 보이는 가랑이 천: 앞·뒤를 향하게 해서 어둡게 뜨지 않게
          enz = ez / b; enx = -s * (1 - Math.abs(enz)) * 0.5;
          phi = lerpN(Math.PI - PH0, 2 * Math.PI + PH0, t);
        }
        if (k === SEG) { enx = 0; enz = 1; } // 앞 가운데 꼭짓점(벽 끝)도 앞쪽을 향하게
        const el = Math.hypot(enx, enz) || 1; enx /= el; enz /= el;
        // 허벅지 원 위의 대응 점
        const sx = s * Math.sin(phi), cz = Math.cos(phi);
        const qx = cL + sx * rl, qz = cz * rl;
        // 몸 중앙 쪽(가랑이) 천은 더 아래까지 골반 모양을 유지 → 앞·뒤 가운데가 낮은 곳에서야 갈라짐
        // 안쪽 벽과 앞·뒤 가운데 꼭짓점 근처는 밑단 바로 위까지 닫힌 채로 (앞 가운데에 세로 틈이 안 생기게)
        const inner = k > K1 ? 1 : Math.max(0, 1 - Math.min(phi - PH0, Math.PI - PH0 - phi) / 0.9);
        const y0 = 0.95 - 0.04 * inner, y1 = 0.83 - 0.02 * inner; // 가랑이는 밑단보다 약 18cm 위에서 갈라짐
        const u = 1 - Math.min(1, Math.max(0, (y - y1) / (y0 - y1))); // 0 = 골반 모양, 1 = 다리 원
        const uu = u * u * (3 - 2 * u);
        pos.push(lerpN(ex, qx, uu), y, lerpN(ez, qz, uu));
        const mx = lerpN(enx, sx, uu), mz = lerpN(enz, cz, uu), ml = Math.hypot(mx, mz) || 1;
        nor.push(mx / ml, 0, mz / ml);
        uv.push(phi / (Math.PI * 2), v); // 바깥쪽(phi = π/2)이 u = 0.25 → 옆선
      }
    }
    for (let r = 0; r < ROWS; r++) for (let k = 0; k < SEG; k++) {
      const a0 = r * (SEG + 1) + k, a1 = a0 + 1, b0 = a0 + SEG + 1, b1 = b0 + 1;
      // 왼쪽은 +x, 오른쪽은 -x 방향으로 돌며 점을 만들므로 면 감는 방향을 반대로 → 둘 다 바깥을 향함
      if (s > 0) idx.push(a0, a1, b0, a1, b1, b0); else idx.push(a0, b0, a1, a1, b0, b1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  // 반바지 천: 바탕색 + 바깥쪽 옆선 + 밑단
  function shortsTexture(base, stripe) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, 256, 128);
    g.fillStyle = stripe; g.fillRect(56, 0, 16, 128);          // u ≈ 0.22~0.28 (바깥쪽)
    g.fillStyle = shade(base, -0.18); g.fillRect(0, 122, 256, 6); // 밑단
    const t = PK.canvasTex(cv); t.anisotropy = 4;
    t.wrapS = THREE.RepeatWrapping; // 앞 가운데에서 u 가 0 을 살짝 넘어감
    return t;
  }

  // ---------- 아바타 생성 ----------
  // cfg: {hair, hairColor, skin, face, uniform, boots} (인덱스)
  // 관절(그룹) 위치와 길이는 그대로 유지: 포즈와 키퍼 판정 범위가 이 위치를 씀
  function create(cfg, opts) {
    opts = opts || {};
    const O = PK.Options;
    const keeper = !!opts.keeper;
    const uni = O.uniform[cfg.uniform];
    const skinC = O.skin[cfg.skin].c;
    const hairC = O.hairColor[cfg.hairColor].c;
    const boot = O.boots[cfg.boots];

    const cloth = (color, extra) => mat(color, Object.assign({ roughness: 0.68 }, extra || {}));
    const skin = mat(skinC, { roughness: 0.55 });
    const shirtTex = shirtTexture(uni, opts.number || (keeper ? 1 : 10), keeper);
    const shirtCol = keeper ? uni.gk : uni.c1;
    const trimCol = keeper ? shade(uni.gk, -0.35) : uni.c2;
    const shirt = cloth('#ffffff', { map: shirtTex });
    const sleeve = cloth(shirtCol);
    const trim = cloth(trimCol);
    const shortsCol = keeper ? shade(uni.gk, -0.45) : uni.shorts;
    const shortsM = cloth(shortsCol);
    // 반바지 옆선: 바지와 다른 유니폼 색 → 바지 천에 직접 그려서 다리와 함께 휘어지게
    const stripeCol = keeper ? uni.gk : (sameColor(uni.shorts, uni.c1) ? uni.c2 : uni.c1);
    const shortsPrint = cloth('#ffffff', { map: shortsTexture(shortsCol, stripeCol), side: THREE.DoubleSide });
    const socksM = cloth(keeper ? shade(uni.gk, -0.2) : uni.socks, { roughness: 0.8 });
    const sockBandM = cloth(keeper ? '#ffffff' : (sameColor(uni.socks, uni.c1) ? uni.c2 : uni.c1));
    const bootM = mat(boot.c, { roughness: 0.32, metalness: 0.15 });
    const soleM = mat(boot.s, { roughness: 0.5 });
    const gloveM = mat('#f5f5f5', { roughness: 0.7 });
    const gloveM2 = mat(uni.gk, { roughness: 0.5 });

    // 피부·옷은 뼈대(관절)에 붙어 휘어지는 표면: 무릎·팔꿈치·허리가 굽을 때 이음매 없이 자연스럽게
    // 높이(y)는 기본 자세(팔다리 곧게 내린 상태)에서 몸 기준 절대 높이. 관절 높이: 골반 0.97, 허리 1.04, 머리 1.78,
    // 어깨 1.53, 팔꿈치 1.23, 손목 0.93, 고관절 0.89, 무릎 0.46, 발목 0.05
    const jobs = [];
    const skinTube = (pts, cx, cz, sz, material, wfn, segs) => jobs.push({ pts, cx, cz, sz, material, wfn, segs });
    const sstep = (a, b, y) => { const t = Math.min(1, Math.max(0, (y - a) / (b - a))); return t * t * (3 - 2 * t); };
    const mix2 = (lo, hi, t) => (t <= 0 ? [[lo, 1]] : t >= 1 ? [[hi, 1]] : [[lo, 1 - t], [hi, t]]);

    const root = new THREE.Group();
    const P = {};
    const hips = new THREE.Bone(); hips.position.y = 0.97; root.add(hips); P.hips = hips;

    // 반바지: 좌우 반쪽씩 하나의 휘어지는 천. 허리에서는 골반 반쪽 모양 → 가랑이 아래에서 다리 구멍으로 갈라지며
    // 위쪽은 골반, 아래쪽은 허벅지를 따라감 (다리를 들어도 골반과 이어진 채로 늘어남)
    [-1, 1].forEach((s) => {
      const legOf = () => (s > 0 ? P.legL : P.legR);
      jobs.push({ build: () => shortsHalf(s), material: shortsPrint,
        wfn: (y) => mix2(hips, legOf(), 1 - sstep(0.8, 0.93, y)) });
    });
    ring(0.166, 0.012, shortsM, hips, 0.09).scale.y = 0.72; // 허리 밴드

    // 상체: 허리→가슴→어깨로 이어지는 몸통 (유니폼 무늬/등번호 텍스처)
    const spine = new THREE.Bone(); spine.position.y = 0.07; hips.add(spine); P.spine = spine;
    // 셔츠 몸통: 허리 아래는 골반, 위는 상체를 따라감 (허리를 숙이거나 비틀면 부드럽게 휨)
    skinTube([[0.001, 1.02], [0.163, 1.02], [0.166, 1.1], [0.176, 1.22], [0.196, 1.35], [0.207, 1.45], [0.203, 1.53], [0.176, 1.59], [0.12, 1.635], [0.062, 1.652], [0.001, 1.655]],
      0, 0, 0.64, shirt, (y) => mix2(hips, spine, sstep(0.99, 1.12, y)), 28);
    ring(0.164, 0.009, trim, spine, -0.01).scale.y = 0.64; // 셔츠 밑단
    ring(0.06, 0.013, trim, spine, 0.6).scale.y = 0.82;    // 칼라

    // 머리
    const head = new THREE.Bone(); head.position.y = 0.74; spine.add(head); P.head = head;
    // 목: 아래는 상체, 위쪽은 머리를 따라 돌아감
    skinTube([[0.058, 1.62], [0.055, 1.66], [0.05, 1.72], [0.048, 1.745]], 0, 0, 1, skin, (y) => mix2(spine, head, sstep(1.69, 1.76, y) * 0.6), 16);
    head.scale.set(0.93, 1.06, 0.98);
    mesh(new THREE.SphereGeometry(R, 32, 24), skin, head);
    mesh(new THREE.SphereGeometry(0.09, 24, 16), skin, head, 0, -0.05, -0.004).scale.set(0.95, 0.86, 0.95); // 턱
    const faceGeo = new THREE.SphereGeometry(R * 1.004, 28, 18, Math.PI / 2 - 0.95, 1.9, Math.PI / 2 - 0.85, 1.65);
    const faceM = new THREE.MeshStandardMaterial({ map: faceTexture(cfg.face, shade(hairC, -0.1)), transparent: true, roughness: 0.55, depthWrite: false });
    head.add(new THREE.Mesh(faceGeo, faceM));
    // 코 (콧대 + 코끝), 귀
    mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.038, 8), skin, head, 0, 0.0, R * 0.965).rotation.x = -0.28;
    mesh(new THREE.SphereGeometry(0.016, 10, 8), skin, head, 0, -0.02, R * 0.99).scale.set(1.1, 0.85, 0.9);
    const earGeo = new THREE.SphereGeometry(0.026, 10, 8);
    [-1, 1].forEach((s) => mesh(earGeo, skin, head, s * R * 0.97, -0.008, -0.008).scale.set(0.45, 1.05, 0.8));
    buildHair(head, cfg.hair, hairC, skinC);

    // 팔
    const makeArm = (side) => {
      const s = side === 'L' ? 1 : -1;
      const arm = new THREE.Bone(); arm.position.set(0.235 * s, 0.49, 0); spine.add(arm);
      const elbow = new THREE.Bone(); elbow.position.y = -0.3; arm.add(elbow);
      const cx = 0.235 * s;
      // 팔 한 줄: 손목→아래팔→팔꿈치(굽힘 구간)→이두근→어깨(상체와 살짝 이어짐)
      const armW = (y) => (y < 1.38 ? mix2(elbow, arm, sstep(1.18, 1.28, y)) : mix2(arm, spine, sstep(1.5, 1.57, y) * 0.3));
      skinTube([[0.001, 0.935], [0.033, 0.94], [0.035, 0.98], [0.044, 1.11], [0.049, 1.18], [0.047, 1.23], [0.05, 1.28], [0.056, 1.4], [0.058, 1.48], [0.052, 1.55], [0.001, 1.565]],
        cx, 0, 1, keeper ? sleeve : skin, armW, 16);
      if (!keeper) {
        // 반팔 소매 + 소매 끝단
        skinTube([[0.066, 1.355], [0.067, 1.41], [0.069, 1.48], [0.064, 1.55], [0.045, 1.585], [0.001, 1.595]], cx, 0, 1, sleeve, armW, 18);
        ring(0.066, 0.008, trim, arm, -0.172);
      } else {
        ring(0.036, 0.008, trim, elbow, -0.27); // 긴팔 소매 끝
      }
      // 어깨 (삼각근): 팔과 함께 돌아 어깨 관절을 덮음
      mesh(new THREE.SphereGeometry(0.072, 16, 12), sleeve, arm, -0.035 * s, 0.01, 0).scale.set(1, 0.9, 0.95);
      const hand = new THREE.Bone(); hand.position.y = -0.3; elbow.add(hand);
      if (keeper) {
        // 골키퍼 장갑: 손목 밴드 + 손바닥 + 손가락 4개 + 엄지
        mesh(new THREE.CylinderGeometry(0.045, 0.042, 0.05, 14), gloveM2, hand, 0, 0.012, 0);
        mesh(new THREE.SphereGeometry(0.058, 14, 10), gloveM, hand, 0, -0.035, 0).scale.set(0.95, 1.1, 0.55);
        const fGeo = new THREE.CylinderGeometry(0.0135, 0.012, 0.075, 8);
        for (let i = 0; i < 4; i++) mesh(fGeo, gloveM, hand, -0.036 + i * 0.024, -0.105 + Math.abs(i - 1.5) * 0.006, 0).scale.z = 1.1;
        mesh(new THREE.CylinderGeometry(0.014, 0.013, 0.06, 8), gloveM, hand, 0, -0.04, 0.032).rotation.x = 0.7;
        mesh(new THREE.BoxGeometry(0.1, 0.012, 0.03), gloveM2, hand, 0, -0.005, 0);
      } else {
        // 손바닥 + 손가락 묶음 + 엄지
        mesh(new THREE.SphereGeometry(0.042, 12, 10), skin, hand, 0, -0.03, 0).scale.set(0.82, 1.0, 0.5);
        mesh(new THREE.SphereGeometry(0.036, 12, 10), skin, hand, 0, -0.075, 0.002).scale.set(0.88, 1.15, 0.48);
        mesh(new THREE.CylinderGeometry(0.011, 0.01, 0.045, 8), skin, hand, 0, -0.035, 0.024).rotation.x = 0.6;
      }
      P['arm' + side] = arm; P['elbow' + side] = elbow; P['hand' + side] = hand;
    };
    makeArm('L'); makeArm('R');

    // 다리
    const makeLeg = (side) => {
      const s = side === 'L' ? 1 : -1;
      const leg = new THREE.Bone(); leg.position.set(0.095 * s, -0.08, 0); hips.add(leg);
      const knee = new THREE.Bone(); knee.position.y = -0.43; leg.add(knee);
      const cx = 0.095 * s;
      // 다리 한 줄: 발목→종아리→무릎(굽힘 구간)→허벅지→엉덩이(골반과 살짝 이어짐)
      const legW = (y) => (y < 0.65 ? mix2(knee, leg, sstep(0.42, 0.51, y)) : mix2(leg, hips, sstep(0.84, 0.95, y) * 0.5));
      skinTube([[0.001, 0.06], [0.04, 0.06], [0.042, 0.12], [0.05, 0.2], [0.064, 0.31], [0.066, 0.37], [0.06, 0.42], [0.058, 0.46], [0.062, 0.51], [0.07, 0.62], [0.068, 0.67], [0.066, 0.72], [0.066, 0.82], [0.064, 0.9], [0.06, 0.92], [0.001, 0.93]],
        cx, 0, 1, skin, legW, 16);
      // 종아리 (스타킹) + 윗단 밴드 + 정강이 보호대 볼록
      skinTube([[0.001, 0.045], [0.044, 0.045], [0.046, 0.12], [0.054, 0.2], [0.068, 0.31], [0.07, 0.37], [0.064, 0.415], [0.065, 0.44], [0.001, 0.452]], cx, 0, 1, socksM, legW, 16);
      skinTube([[0.068, 0.405], [0.071, 0.415], [0.071, 0.445], [0.067, 0.455]], cx, 0, 1, sockBandM, legW, 16);
      mesh(new THREE.SphereGeometry(0.05, 12, 10), socksM, knee, 0, -0.17, 0.022).scale.set(0.95, 2.0, 0.75);
      const foot = new THREE.Bone(); foot.position.y = -0.41; knee.add(foot);
      // 축구화: 발목 칼라 + 갑피 + 둥근 앞코 + 뒤꿈치 + 밑창 + 스터드 + 옆 라인 + 끈
      mesh(new THREE.CylinderGeometry(0.043, 0.047, 0.05, 14), bootM, foot, 0, 0.005, -0.005);
      mesh(new THREE.BoxGeometry(0.088, 0.062, 0.15), bootM, foot, 0, -0.02, 0.035);
      mesh(new THREE.SphereGeometry(0.045, 14, 10), bootM, foot, 0, -0.03, 0.11).scale.set(0.98, 0.72, 1.3);
      mesh(new THREE.SphereGeometry(0.046, 14, 10), bootM, foot, 0, -0.022, -0.035).scale.set(0.96, 0.95, 0.85);
      mesh(new THREE.BoxGeometry(0.094, 0.016, 0.25), soleM, foot, 0, -0.058, 0.045);
      const studGeo = new THREE.CylinderGeometry(0.008, 0.009, 0.014, 8);
      [[-0.028, 0.14], [0.028, 0.14], [-0.03, 0.07], [0.03, 0.07], [-0.022, -0.04], [0.022, -0.04]].forEach((p) => mesh(studGeo, soleM, foot, p[0], -0.071, p[1]));
      [-1, 1].forEach((k) => { mesh(new THREE.BoxGeometry(0.003, 0.016, 0.12), soleM, foot, k * 0.0455, -0.025, 0.05).rotation.x = -0.25; });
      mesh(new THREE.BoxGeometry(0.04, 0.006, 0.08), soleM, foot, 0, 0.012, 0.06).rotation.x = 0.18;
      P['leg' + side] = leg; P['knee' + side] = knee; P['foot' + side] = foot;
    };
    makeLeg('L'); makeLeg('R');

    // 뼈대 연결: 기본 자세(모든 관절 회전 0)에서 묶은 뒤, 포즈를 바꾸면 표면이 따라 휨
    root.updateMatrixWorld(true);
    const bones = [hips, spine, head, P.armL, P.elbowL, P.handL, P.armR, P.elbowR, P.handR, P.legL, P.kneeL, P.footL, P.legR, P.kneeR, P.footR];
    const skeleton = new THREE.Skeleton(bones);
    const skinMats = new Map(); // r128: 휘어지는 표면은 skinning 재질이 따로 필요
    jobs.forEach((j) => {
      let geo;
      if (j.build) geo = j.build();
      else {
        geo = lathe(j.pts, j.segs || 18);
        if (j.sz !== 1) geo.scale(1, 1, j.sz);
        geo.translate(j.cx, 0, j.cz);
      }
      const pos = geo.attributes.position, n = pos.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        j.wfn(pos.getY(i)).forEach((e, q) => { si[i * 4 + q] = bones.indexOf(e[0]); sw[i * 4 + q] = e[1]; });
      }
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      let m = skinMats.get(j.material);
      if (!m) { m = j.material.clone(); m.skinning = true; skinMats.set(j.material, m); }
      const sm = new THREE.SkinnedMesh(geo, m);
      sm.castShadow = true; sm.frustumCulled = false;
      root.add(sm);
      sm.bind(skeleton);
    });

    // 작은 부품(스터드·손가락·테두리)은 그림자를 만들지 않음: 모바일 성능
    root.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingSphere(); const sc = Math.max(o.scale.x, o.scale.y, o.scale.z); if (o.geometry.type === 'TorusGeometry' || o.geometry.boundingSphere.radius * sc < 0.05) o.castShadow = false; } });
    root.userData.parts = P;
    root.userData.keeper = keeper;
    resetPose(root);
    return root;
  }

  function resetPose(av) {
    const P = av.userData.parts;
    P.hips.position.set(0, 0.97, 0);
    P.hips.rotation.set(0, 0, 0);
    P.spine.rotation.set(0, 0, 0);
    P.head.rotation.set(0, 0, 0);
    P.armL.rotation.set(0, 0, 0.12);
    P.armR.rotation.set(0, 0, -0.12);
    P.elbowL.rotation.set(-0.15, 0, 0);
    P.elbowR.rotation.set(-0.15, 0, 0);
    ['L', 'R'].forEach((s) => {
      P['leg' + s].rotation.set(0, 0, 0);
      P['knee' + s].rotation.set(0, 0, 0);
      P['foot' + s].rotation.set(0, 0, 0);
    });
  }

  function dispose(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
      }
    });
  }

  function randomConfig(avoidUniform) {
    const O = PK.Options;
    const r = (n) => Math.floor(Math.random() * n);
    let u = r(O.uniform.length);
    if (u === avoidUniform) u = (u + 1 + r(O.uniform.length - 1)) % O.uniform.length;
    return { hair: r(O.hair.length), hairColor: r(5), skin: r(O.skin.length), face: r(O.face.length), uniform: u, boots: r(O.boots.length) };
  }

  return { create, resetPose, dispose, randomConfig, shade };
})();
