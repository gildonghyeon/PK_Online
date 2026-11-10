// 사실적인 선수 모델 (Sketchfab "Football player" by tomleeosborn, Sketchfab Standard 라이선스)
//  - 게임의 움직임·키퍼 판정은 기존 관절(리그)이 담당하고, 이 모델은 매 프레임 그 자세를 그대로 따라함 (리타깃)
//  - 실제 동작(대기·달리기·킥·다이빙)은 이 모델 뼈대에 맞춰 옮겨 둔 애니메이션 클립을 재생
//  - 유니폼·축구화·피부·머리 색은 원래 텍스처의 색(흰 천 / 빨간 장식 / 피부 / 검은 머리)을 읽어 부위별로 다시 칠함
window.PK = window.PK || {};

PK.PlayerModel = (function () {
  const V3 = () => new THREE.Vector3();
  const api = { ready: false };
  const MS = 1.05;      // 모델 크기 배율 (비율 다듬은 뒤 키 약 1.90m)
  const MS_BAKE = 1.03; // anims.json 의 ball(공 닿는 발 위치) 값을 잴 때의 배율
  let base = null;      // 불러온 몸 glTF
  let skinAvg = null;   // 피부 텍스처 평균색 (피부색 맞추기용)
  let hairLum = 0.02;   // 머리카락 텍스처 평균 밝기 (선형)
  const kitGeos = {}, meshInvW = {};   // 메시 이름 → 부위 정보가 들어간 지오메트리 (모든 선수가 공유)
  let faceInfo = null;  // 입·눈 위치 (기본 자세 기준, 모델 좌표)
  // 원본 기본 자세 기준 높이 (m)
  const HEM = 0.89, HEM_LOW = 0.80, SHOULDER = 1.40, SLEEVE_R = 0.085;

  // ---------- 불러오기 ----------
  function load() {
    if (!THREE.GLTFLoader || !THREE.SkeletonUtils) return Promise.reject(new Error('loader missing'));
    const loader = new THREE.GLTFLoader();
    // Claude 아티팩트는 .glb를 제공하지 않아 같은 파일을 .glb.wasm 이름으로도 올려 둠 → 실패하면 그쪽으로
    const get1 = (u) => new Promise((res, rej) => loader.load(u, res, undefined, rej));
    const get = (u) => get1(u).catch(() => get1(u + '.wasm'));
    // 실제 애니메이션: 없어도 게임은 기존 동작으로 진행
    const anims = fetch('models/anims.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return Promise.all([get('models/player.glb'), anims]).then(([b, a]) => {
      base = b;
      prepare();
      if (a) buildClips(a);
      api.ready = true;
    });
  }

  // ---------- 실제 애니메이션 클립 (이 모델 뼈대에 맞춰 옮겨 둔 것: 일정 간격 fps·frames, 골반 위치 포함) ----------
  let clips = {};
  const clipMeta = {};
  function buildClips(data) {
    data.clips.forEach((c) => {
      const even = Array.from({ length: c.frames }, (_, i) => Math.min(c.duration, i / c.fps));
      const tracks = c.tracks.map((t) => {
        const times = t.v.length === (t.n.endsWith('.quaternion') ? 4 : 3) ? [0] : even;
        if (t.n.endsWith('.quaternion')) return new THREE.QuaternionKeyframeTrack(t.n, times, t.v);
        // 골반 위치: 다리가 길어진 만큼 높이·보폭도 늘림
        return new THREE.VectorKeyframeTrack(t.n, times, t.n === 'pelvis.position' ? t.v.map((x) => x * legScale) : t.v);
      });
      clips[c.name] = new THREE.AnimationClip(c.name, c.duration, tracks);
      // 몸 전체 이동 경로(모델 좌표 x,z — 모델 크기만큼 늘림), 공을 차는 순간 등: 게임이 선수 위치를 옮기는 데 씀
      clipMeta[c.name] = { duration: c.duration, fps: c.fps, path: c.path ? c.path.map((v) => v * MS * legScale) : null, contact: c.contact, ball: c.ball ? c.ball.map((v) => v * MS / MS_BAKE * legScale) : c.ball };
    });
  }
  // 경로 보간: 시간 t 에서 몸 이동량 [x, z]
  function pathAt(name, t) {
    const m = clipMeta[name]; if (!m || !m.path) return [0, 0];
    const n = m.path.length / 2, f = Math.max(0, Math.min(n - 1, t * m.fps)), i = Math.min(n - 2, Math.floor(f)), a = f - i;
    return [m.path[i * 2] * (1 - a) + m.path[i * 2 + 2] * a, m.path[i * 2 + 1] * (1 - a) + m.path[i * 2 + 3] * a];
  }

  // ---------- 뼈 이름 → 게임이 쓰는 이름 ----------
  const SF_NAMES = {
    _rootJoint: 'root', Hips_00: 'pelvis', Spine02_09: 'spine_01', Spine01_010: 'spine_02', Spine_011: 'spine_03',
    neck_020: 'neck_01', Head_021: 'Head', head_end_022: 'head_end', headfront_023: 'head_front',
    LeftShoulder_012: 'clavicle_l', LeftArm_013: 'upperarm_l', LeftForeArm_014: 'lowerarm_l', LeftHand_015: 'hand_l',
    RightShoulder_016: 'clavicle_r', RightArm_017: 'upperarm_r', RightForeArm_018: 'lowerarm_r', RightHand_019: 'hand_r',
    LeftUpLeg_01: 'thigh_l', LeftLeg_02: 'calf_l', LeftFoot_03: 'foot_l', LeftToeBase_04: 'ball_l',
    RightUpLeg_05: 'thigh_r', RightLeg_06: 'calf_r', RightFoot_07: 'foot_r', RightToeBase_08: 'ball_r',
  };
  // Mixamo 캐릭터 뼈 이름 (mixamorig5Hips 처럼 앞에 접두어가 붙음)
  const MX_NAMES = {
    Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'Head', HeadTop_End: 'head_end',
    LeftShoulder: 'clavicle_l', LeftArm: 'upperarm_l', LeftForeArm: 'lowerarm_l', LeftHand: 'hand_l', LeftHandMiddle1: 'middle_01_l',
    RightShoulder: 'clavicle_r', RightArm: 'upperarm_r', RightForeArm: 'lowerarm_r', RightHand: 'hand_r', RightHandMiddle1: 'middle_01_r',
    LeftUpLeg: 'thigh_l', LeftLeg: 'calf_l', LeftFoot: 'foot_l', LeftToeBase: 'ball_l',
    RightUpLeg: 'thigh_r', RightLeg: 'calf_r', RightFoot: 'foot_r', RightToeBase: 'ball_r',
  };
  // 이름을 바꾸고, 손끝 쪽을 나타내는 빈 뼈를 손에 붙임 (손 중심 = 손목과 이 점의 가운데, 판정용)
  function rigify(scene) {
    const B = {};
    scene.traverse((o) => {
      if (o.isBone) {
        if (SF_NAMES[o.name]) o.name = SF_NAMES[o.name];
        else { const m = o.name.match(/^mixamorig\d*:?(.+)$/); if (m && MX_NAMES[m[1]]) o.name = MX_NAMES[m[1]]; }
      }
      if (o.isBone) B[o.name] = o;
      if (o.isMesh) o.frustumCulled = false; // 원본 경계 상자가 cm 단위라 잘못 잘림
    });
    // 원본이 cm 단위면(키가 10 넘음) 맨 위 노드를 0.01 배 → 이후 모든 계산은 m
    scene.updateMatrixWorld(true);
    if (B.Head && B.Head.getWorldPosition(V3()).y > 10 && scene.children[0]) { scene.children[0].scale.multiplyScalar(0.01); scene.updateMatrixWorld(true); }
    ['l', 'r'].forEach((s) => {
      const h = B['hand_' + s], la = B['lowerarm_' + s];
      if (!h || B['middle_01_' + s]) return;
      const hp = h.getWorldPosition(V3()), dir = hp.clone().sub(la.getWorldPosition(V3())).normalize();
      const tip = new THREE.Bone(); tip.name = 'middle_01_' + s;
      h.add(tip); tip.position.copy(h.worldToLocal(hp.clone().addScaledVector(dir, 0.12)));
      B[tip.name] = tip;
    });
    scene.updateMatrixWorld(true);
    return B;
  }

  // ---------- 부위 정보 ----------
  // 정점마다 가장 많이 따르는 뼈로 부위를 정함: 0 머리·목, 1 몸통, 2 위팔, 3 아래팔, 4 엉덩이·허벅지, 5 손, 6 종아리, 7 발
  const PART_OF = (n) => {
    if (/^(Head|neck|head)/.test(n)) return 0;
    if (/^(spine|clavicle)/.test(n)) return 1;
    if (/^upperarm/.test(n)) return 2;
    if (/^lowerarm/.test(n)) return 3;
    if (/^(pelvis|thigh)/.test(n)) return 4;
    if (/^hand/.test(n)) return 5;
    if (/^calf/.test(n)) return 6;
    if (/^(foot|ball)/.test(n)) return 7;
    return 1;
  };
  // 옷·몸 종류 (Mixamo 캐릭터는 셔츠·반바지·양말·축구화·몸·머리카락이 각각 따로 된 메시)
  const KIND = { shirt: 1, shorts: 2, socks: 3, shoes: 4, body: 5, hair: 6, lashes: 7 };
  const kindOf = (name) => {
    const n = name.toLowerCase();
    if (n.includes('shirt')) return KIND.shirt;
    if (n.includes('short')) return KIND.shorts;
    if (n.includes('sock')) return KIND.socks;
    if (n.includes('shoe') || n.includes('boot')) return KIND.shoes;
    if (n.includes('lash')) return KIND.lashes;
    if (n.includes('hair')) return KIND.hair;
    return KIND.body;
  };
  const meshKind = {};   // 메시 이름 → 종류
  const kitDims = { hem: 0.9, shoulder: 1.45, sockTop: 0.45, neck: 1.5, neckF: [1.565, 0.06], neckB: [1.595, -0.057], shortsHem: 0.6, armY: 1.42, armZ: 0, armX: 0.18, hipZ: 0 }; // 셔츠 밑단·어깨·목둘레 높이, 반바지 밑단, 양말 윗단, 팔 중심선 (기본 자세, m)
  // ---------- 몸 비율 다듬기 (프로 축구선수 체형: 긴 다리, 작은 머리, 가는 허리 → 넓은 어깨) ----------
  //  뼈마다 (가로 x, 세로 y, 앞뒤 z) 배율. 기본 자세(T자)에서 그 뼈를 따르는 살을 뼈 위치를 중심으로 늘이고 줄인 뒤,
  //  자식 관절도 그만큼 옮기고, 그 모양을 새 기본 자세로 다시 묶음 (동작은 관절 회전이라 그대로 맞음)
  const BODY_SCALE = {
    pelvis: [0.98, 1, 1], spine_01: [0.91, 1, 0.94], spine_02: [0.96, 1, 0.97], spine_03: [1.03, 1, 1],
    Head: [0.92, 0.92, 0.92],
    thigh_l: [1.14, 1.1, 1.12], thigh_r: [1.14, 1.1, 1.12], calf_l: [1.1, 1.07, 1.1], calf_r: [1.1, 1.07, 1.1],
  };
  let legScale = 1; // 골반 높이 변화 (동작의 골반 위치·이동 경로·공 닿는 위치에 곱함)
  function reproportion(scene, B) {
    scene.updateMatrixWorld(true);
    const bones = []; scene.traverse((o) => { if (o.isBone) bones.push(o); }); // 부모 → 자식 순서
    const oldP = new Map(), newP = new Map(), S = (b) => BODY_SCALE[b.name] || [1, 1, 1];
    bones.forEach((b) => oldP.set(b, b.getWorldPosition(V3())));
    bones.forEach((b) => {
      const p = b.parent;
      if (!p || !p.isBone) { newP.set(b, oldP.get(b).clone()); return; }
      const s = S(p), d = oldP.get(b).clone().sub(oldP.get(p));
      newP.set(b, newP.get(p).clone().add(d.set(d.x * s[0], d.y * s[1], d.z * s[2])));
    });
    // 발끝이 원래 높이(땅)에 오도록 전체를 올림
    const dy = B.ball_l ? oldP.get(B.ball_l).y - newP.get(B.ball_l).y : 0;
    newP.forEach((p) => { p.y += dy; });
    if (B.pelvis) legScale = newP.get(B.pelvis).y / oldP.get(B.pelvis).y;

    // 살(정점) 옮기기: 정점 = Σ 가중치 × (새 관절 위치 + 배율 × (원래 정점 − 원래 관절 위치))
    const meshes = []; scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    const v = V3(), acc = V3(), nn = V3(), nacc = V3(), t = V3();
    const newPos = meshes.map((o) => {
      const g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      const out = new Float32Array(pos.count * 3), nout = nor ? new Float32Array(pos.count * 3) : null;
      const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld), nmInv = nm.clone().invert();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i); o.boneTransform(i, v); v.applyMatrix4(o.matrixWorld);
        if (nor) nn.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        acc.set(0, 0, 0); nacc.set(0, 0, 0);
        for (let k = 0; k < 4; k++) {
          const w = k === 0 ? sw.getX(i) : k === 1 ? sw.getY(i) : k === 2 ? sw.getZ(i) : sw.getW(i); if (w <= 0) continue;
          const b = o.skeleton.bones[k === 0 ? si.getX(i) : k === 1 ? si.getY(i) : k === 2 ? si.getZ(i) : si.getW(i)], s = S(b), op = oldP.get(b);
          t.copy(v).sub(op); t.set(t.x * s[0], t.y * s[1], t.z * s[2]).add(newP.get(b));
          acc.addScaledVector(t, w);
          if (nor) nacc.x += w * nn.x / s[0], nacc.y += w * nn.y / s[1], nacc.z += w * nn.z / s[2];
        }
        out[i * 3] = acc.x; out[i * 3 + 1] = acc.y; out[i * 3 + 2] = acc.z;
        if (nor) { nacc.normalize(); nout[i * 3] = nacc.x; nout[i * 3 + 1] = nacc.y; nout[i * 3 + 2] = nacc.z; }
      }
      return [out, nout, nmInv];
    });
    // 뼈를 새 위치로 (부모부터)
    bones.forEach((b) => {
      if (!b.parent) return;
      b.parent.updateMatrixWorld(true);
      b.position.copy(b.parent.worldToLocal(newP.get(b).clone()));
      b.updateMatrixWorld(true);
    });
    scene.updateMatrixWorld(true);
    // 새 모양을 메시 좌표로 써 넣고, 지금 뼈 위치를 새 기본 자세로 다시 묶음
    meshes.forEach((o, mi) => {
      const [out, nout, nmInv] = newPos[mi], g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal;
      const inv = o.matrixWorld.clone().invert();
      for (let i = 0; i < pos.count; i++) {
        v.set(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]).applyMatrix4(inv); pos.setXYZ(i, v.x, v.y, v.z);
        if (nor) { nn.set(nout[i * 3], nout[i * 3 + 1], nout[i * 3 + 2]).applyMatrix3(nmInv).normalize(); nor.setXYZ(i, nn.x, nn.y, nn.z); }
      }
      pos.needsUpdate = true; if (nor) nor.needsUpdate = true;
      g.computeBoundingSphere();
      o.bind(o.skeleton);
    });
  }

  function prepare() {
    reproportion(base.scene, rigify(base.scene));
    base.scene.updateMatrixWorld(true);
    const v = V3();
    let shirtMinY = 9, sockTop = 0, neckY = 0, shortsMinY = 9;
    const neckF = [0, 0], neckB = [0, 0];
    base.scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const kind = kindOf(o.name); meshKind[o.name] = kind;
      const g = o.geometry.clone();
      const pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = pos.count;
      const bind = new Float32Array(n * 3), part = new Float32Array(n);
      const W = (i, k) => (k === 0 ? sw.getX(i) : k === 1 ? sw.getY(i) : k === 2 ? sw.getZ(i) : sw.getW(i));
      const I = (i, k) => (k === 0 ? si.getX(i) : k === 1 ? si.getY(i) : k === 2 ? si.getZ(i) : si.getW(i));
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, i); o.boneTransform(i, v); v.applyMatrix4(o.matrixWorld); // 기본 자세의 실제 위치 (m)
        bind[i * 3] = v.x; bind[i * 3 + 1] = v.y; bind[i * 3 + 2] = v.z;
        let bk = 0; for (let k = 1; k < 4; k++) if (W(i, k) > W(i, bk)) bk = k;
        part[i] = PART_OF(o.skeleton.bones[I(i, bk)].name);
        if (kind === KIND.shirt && part[i] !== 2 && part[i] !== 3) shirtMinY = Math.min(shirtMinY, v.y);
        if (kind === KIND.socks) sockTop = Math.max(sockTop, v.y);
        if (kind === KIND.shirt && part[i] !== 2 && part[i] !== 3 && Math.abs(v.x) < 0.09) neckY = Math.max(neckY, v.y);
        if (kind === KIND.shirt && part[i] !== 2 && part[i] !== 3 && Math.abs(v.x) < 0.012) { // 목둘레 앞·뒤 가장 높은 점
          if (v.z > 0 && v.y > neckF[0]) { neckF[0] = v.y; neckF[1] = v.z; }
          if (v.z < 0 && v.y > neckB[0]) { neckB[0] = v.y; neckB[1] = v.z; }
        }
        if (kind === KIND.shorts) shortsMinY = Math.min(shortsMinY, v.y);
      }
      g.setAttribute('aBind', new THREE.BufferAttribute(bind, 3));
      g.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
      g.computeBoundingSphere();
      kitGeos[o.name] = g;
      meshInvW[o.name] = o.matrixWorld.clone().invert(); // 모델 좌표(m) → 메시 좌표(원본 단위): 뼈 기준 좌표는 메시 좌표 기준
    });
    const B = {}; base.scene.traverse((o) => { if (o.isBone) B[o.name] = o; });
    if (shirtMinY < 9) kitDims.hem = shirtMinY;
    if (sockTop > 0) kitDims.sockTop = sockTop;
    if (B.upperarm_l) { const ua = B.upperarm_l.getWorldPosition(V3()); kitDims.shoulder = ua.y + 0.03; kitDims.armY = ua.y; kitDims.armZ = ua.z; kitDims.armX = Math.abs(ua.x); }
    if (B.pelvis) kitDims.hipZ = B.pelvis.getWorldPosition(V3()).z;
    if (neckY > 0) kitDims.neck = neckY;
    if (neckF[0] > 0 && neckB[0] > 0) { kitDims.neckF = neckF; kitDims.neckB = neckB; }
    if (shortsMinY < 9) kitDims.shortsHem = shortsMinY;

    // 피부 텍스처 평균 (피부색 맞추기용) · 머리카락 평균 밝기
    const avgOf = (img, pick) => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 128;
        const cg = c.getContext('2d'); cg.drawImage(img, 0, 0, 128, 128);
        const d = cg.getImageData(0, 0, 128, 128).data; return pick(d);
      } catch (e) { return null; }
    };
    let bodyImg = null, hairImg = null;
    base.scene.traverse((o) => { if (!o.isSkinnedMesh || !o.material.map) return; const k = meshKind[o.name]; if (k === KIND.body && !bodyImg) bodyImg = o.material.map.image; if (k === KIND.hair && !hairImg) hairImg = o.material.map.image; });
    skinAvg = new THREE.Color('#e0b49a');
    const sa = bodyImg && avgOf(bodyImg, (d) => { let rr = 0, gg = 0, bb = 0, k = 0; for (let i = 0; i < d.length; i += 4) { const r = d[i] / 255, g2 = d[i + 1] / 255, b = d[i + 2] / 255, l = 0.299 * r + 0.587 * g2 + 0.114 * b; if (r - b > 0.12 && r - g2 > 0.05 && r - g2 < 0.28 && l > 0.35) { rr += r; gg += g2; bb += b; k++; } } return k ? new THREE.Color(rr / k, gg / k, bb / k) : null; });
    if (sa) skinAvg = sa;
    const hl = hairImg && avgOf(hairImg, (d) => { let s = 0, k = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255; s += Math.pow(l, 2.2); k++; } return k ? s / k : null; });
    if (hl) hairLum = Math.max(0.004, hl);

    // 얼굴: 머리 앞쪽에서 가장 튀어나온 곳(코끝) 기준으로 입 위치를 정함
    let nose = null;
    const bodyName = Object.keys(meshKind).find((k) => meshKind[k] === KIND.body);
    if (bodyName && B.Head) {
      const hy = B.Head.getWorldPosition(V3()).y, bd = kitGeos[bodyName].attributes.aBind;
      for (let i = 0; i < bd.count; i++) { const y = bd.getY(i); if (y < hy + 0.0 || y > hy + 0.12 || Math.abs(bd.getX(i)) > 0.03) continue; if (!nose || bd.getZ(i) > nose.z) nose = new THREE.Vector3(bd.getX(i), y, bd.getZ(i)); }
    }
    // 입술이 맞닿는 선: 코끝 아래 2~4.5cm, 얼굴 가운데에서 같은 자리에 정점이 두 개 겹친 곳(윗입술·아랫입술 텍스처 이음매) 중 가장 앞
    let seam = null;
    if (nose) {
      const bd = kitGeos[bodyName].attributes.aBind, seen = new Map();
      for (let i = 0; i < bd.count; i++) {
        const x = bd.getX(i), y = bd.getY(i), z = bd.getZ(i);
        if (Math.abs(x) > 0.004 || y < nose.y - 0.045 || y > nose.y - 0.02 || z < nose.z - 0.025) continue;
        const k = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
        if (seen.has(k)) { if (!seam || z > seam.z) seam = new THREE.Vector3(0, y, z); } else seen.set(k, i);
      }
    }
    faceInfo = nose ? { eyeY: nose.y + 0.04, nose: nose.clone(), mouth: seam ? new THREE.Vector3(0, seam.y - 0.0003, nose.z - 0.014) : new THREE.Vector3(0, nose.y - 0.03, nose.z - 0.014) }
      : { eyeY: 1.6, nose: new THREE.Vector3(0, 1.57, 0.12), mouth: new THREE.Vector3(0, 1.54, 0.09) };
    // 눈: 속눈썹 메시의 한쪽 평균 위치 (없으면 코끝 기준으로 어림)
    faceInfo.eye = new THREE.Vector3(0.031, faceInfo.nose.y + 0.035, faceInfo.nose.z - 0.03);
    const lashName = Object.keys(meshKind).find((k) => meshKind[k] === KIND.lashes);
    if (lashName) {
      const lb = kitGeos[lashName].attributes.aBind; let sx = 0, sy = 0, sz = 0, n = 0;
      for (let i = 0; i < lb.count; i++) { if (lb.getX(i) <= 0) continue; sx += lb.getX(i); sy += lb.getY(i); sz += lb.getZ(i); n++; }
      if (n) faceInfo.eye.set(sx / n, sy / n, sz / n);
    }
  }

  // ---------- 유니폼·피부·머리를 칠하는 재질 (옷 종류별) ----------
  //  원래 텍스처의 밝기(주름·음영)는 살리고 색만 새로: 셔츠는 무늬 그림(몸통 둘레 좌표), 소매·반바지·양말·축구화는 각 색
  function kitMaterial(srcMat, k, kind) {
    const m = srcMat.clone();
    m.roughness = kind === KIND.shoes ? 0.45 : kind === KIND.body ? 0.62 : 0.8; m.metalness = 0;
    if (m.emissive) { m.emissive.set(0x000000); m.emissiveMap = null; }
    const hairLike = kind === KIND.hair || kind === KIND.lashes;
    if (hairLike) { m.transparent = false; m.alphaTest = 0.45; m.side = THREE.DoubleSide; m.depthWrite = true; }
    else { m.transparent = false; m.opacity = 1; m.alphaTest = 0; m.side = THREE.FrontSide; }
    const U = {
      uKind: { value: kind },
      uSkinTint: { value: k.skinTint }, uHair: { value: k.hair }, uHairLum: { value: hairLum },
      uShirt: { value: k.shirtMap }, uSleeve: { value: k.sleeve }, uTrim: { value: k.trim },
      uShorts: { value: k.shorts }, uStripe: { value: k.stripe }, uSocks: { value: k.socks }, uSockBand: { value: k.sockBand },
      uBoot: { value: k.boot }, uSole: { value: k.sole }, uGlove: { value: k.glove }, uKeeper: { value: k.longSleeve ? 1 : 0 },
      uHem: { value: kitDims.hem }, uShoulder: { value: kitDims.shoulder }, uSockTop: { value: kitDims.sockTop },
      uNeck: { value: kitDims.neck }, uNeckFB: { value: new THREE.Vector4(kitDims.neckF[0], kitDims.neckF[1], kitDims.neckB[0], kitDims.neckB[1]) }, uShortsHem: { value: kitDims.shortsHem }, uHipZ: { value: kitDims.hipZ }, uArm: { value: new THREE.Vector3(kitDims.armY, kitDims.armZ, kitDims.armX) },
      uSleevePat: { value: k.sleevePat || 0 }, uSleeve2: { value: k.sleeve2 || k.sleeve }, uArmLine: { value: k.armLine || 0 },
      uMouth: { value: faceInfo ? faceInfo.mouth : new THREE.Vector3(0, -9, 0) }, uModelScale: { value: MS },
      uNearFar: { value: new THREE.Vector2(0.1, 300) }, // 지금 카메라의 near·far (입속 깊이 밀기용, 그릴 때마다 갱신)
      uShout: { value: 0 }, uMouthView: { value: new THREE.Vector3() }, // 함성 정도 · 입속 가운데(카메라 좌표, 그릴 때마다 갱신)
      uMouthInv: { value: new THREE.Matrix4() }, // 월드 → 입속 가운데 기준 좌표(m, 머리와 함께 움직임)
      uNose: { value: faceInfo ? faceInfo.nose : new THREE.Vector3(0, -9, 0) }, uEye: { value: faceInfo ? faceInfo.eye : new THREE.Vector3(0, -9, 0) },
    };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aBind; attribute float aPart; attribute float aWall;\nvarying vec3 vBind; varying float vPart; varying float vWall;\nuniform mat4 uMouthInv; varying vec3 vMouthL;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = aBind; vPart = aPart; vWall = aWall;')
        .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvMouthL = (uMouthInv * modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vBind; varying float vPart; varying float vWall;
uniform float uKind; uniform vec3 uSkinTint; uniform vec3 uHair; uniform float uHairLum;
uniform sampler2D uShirt; uniform vec3 uSleeve; uniform vec3 uTrim; uniform vec3 uShorts; uniform vec3 uStripe;
uniform vec3 uSocks; uniform vec3 uSockBand; uniform vec3 uBoot; uniform vec3 uSole; uniform vec3 uGlove; uniform float uKeeper;
uniform float uHem; uniform float uShoulder; uniform float uSockTop; uniform float uNeck; uniform vec4 uNeckFB; uniform float uShortsHem; uniform float uHipZ; uniform vec3 uArm; uniform float uSleevePat; uniform vec3 uSleeve2; uniform float uArmLine; uniform vec3 uMouth; uniform float uModelScale; uniform vec2 uNearFar; uniform float uShout; uniform vec3 uMouthView; uniform vec3 uNose; uniform vec3 uEye; varying vec3 vMouthL;
float segDist(vec2 p, vec2 a, vec2 b) { vec2 ab = b - a; float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0); return length(p - a - ab * t); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
gl_FragDepthEXT = gl_FragCoord.z;
float pkMatte = 0.0; // 입속: 광택 없앰 (아래 거칠기에서 씀)
vec3 tex = diffuseColor.rgb;
vec3 s = pow(max(tex, vec3(0.0)), vec3(1.0 / 2.2));
float lum = dot(s, vec3(0.299, 0.587, 0.114));
vec3 b = vBind;
float shade = pow(clamp(lum / 0.82, 0.72, 1.06), 2.2);   // 천의 주름·음영 (원래 인쇄는 거의 안 보이게 범위를 좁힘)
#ifdef USE_MAP
if (uKind < 1.5) { // 셔츠: 원래 텍스처의 인쇄 그림이 비치지 않게 흐리게 읽어 큰 주름만 남김
  vec3 tb = pow(max(mapTexelToLinear(texture2D(map, vUv, 3.5)).rgb, vec3(0.0)), vec3(1.0 / 2.2));
  shade = pow(clamp(dot(tb, vec3(0.299, 0.587, 0.114)) / 0.82, 0.78, 1.05), 2.2);
}
#endif
vec3 col = tex;
if (uKind < 1.5) {                       // 셔츠: 몸통은 무늬 그림, 팔은 소매 색, 손목 끝동·목 칼라는 테두리 색
  // 소매·몸통 경계: 정점별 부위로 나누면 삼각형을 따라 지그재그가 생겨, 어깨 관절 위치의 곧은 선으로 나눔 (T자 기본 자세)
  bool arm = abs(b.x) > uArm.z + 0.004 && b.y > uHem + 0.25;
  vec2 kitUv = vec2(fract(atan(b.x, b.z + 0.01) / 6.2831853 + 1.0), clamp((b.y - uHem) / (uShoulder - uHem), 0.0, 1.0));
  vec3 c = arm ? uSleeve : sRGBToLinear(texture2D(uShirt, kitUv)).rgb;
  if (arm) {
    float ax = abs(b.x);
    // 소매도 몸통 무늬를 따름: 가로 띠(후프)는 팔을 두르는 띠, 하프는 오른쪽 소매가 다른 색
    if (uSleevePat > 0.5 && uSleevePat < 1.5 && fract((ax - 0.2) / 0.11) < 0.5) c = uSleeve2;
    if (uSleevePat > 1.5 && uSleevePat < 2.5 && b.x < 0.0) c = uSleeve2;
    // 어깨선 띠: 목에서 손목까지 소매 윗면을 따라 가는 줄 (팔 중심선 기준 각도로 윗면만)
    float ang = atan(b.y - uArm.x, b.z - uArm.y);
    if (uArmLine > 0.5 && abs(ang - 1.5708) < 0.2 && ax < 0.6) c = uTrim;
    if (ax > 0.62) c = uTrim;                                    // 손목 끝동 (T자 기본 자세에서 팔 끝 쪽)
  }
  // 목 칼라: 목둘레는 앞이 낮고 뒤가 높게 기울어 있음 → 앞뒤 높이를 이은 선에서 1.6cm 아래까지 테두리 색
  float neckEdge = mix(uNeckFB.z, uNeckFB.x, clamp((b.z - uNeckFB.w) / (uNeckFB.y - uNeckFB.w), 0.0, 1.0));
  if (!arm && abs(b.x) < 0.13 && b.y > neckEdge - 0.016) c = uTrim;
  col = c * shade;
} else if (uKind < 2.5) {                // 반바지: 바깥 옆선 줄무늬
  // 옆선: 골반 중심에서 본 방향이 옆쪽인 곳 (중심이 앞뒤로 어긋나면 뒤쪽이 넓게 칠해짐)
  vec2 hq = vec2(b.x, b.z - uHipZ);
  float side = smoothstep(0.9, 0.96, abs(hq.x) / max(0.001, length(hq)));
  vec3 sc = mix(uShorts, uStripe, side * step(0.0, b.y));
  if (b.y < uShortsHem + 0.016) sc = uStripe;                   // 밑단 마감 띠
  col = sc * shade;
} else if (uKind < 3.5) {                // 양말: 윗단 띠
  // 양말 윗단: 굵은 띠 + 아래 가는 띠
  float sy = uSockTop - b.y;
  bool band = sy < 0.022 || (sy > 0.03 && sy < 0.038);
  col = (band ? uSockBand : uSocks) * shade;
} else if (uKind < 4.5) {                // 축구화: 밑창은 밑창 색
  col = (b.y < 0.022 ? uSole : uBoot) * pow(clamp(lum / 0.7, 0.45, 1.2), 1.6);
} else if (uKind < 5.5) {                // 몸(피부·얼굴·눈): 피부만 원하는 색으로, 키퍼는 손에 장갑
  float sk = smoothstep(0.05, 0.12, s.r - s.b) * smoothstep(0.18, 0.3, lum);
  col = mix(tex, tex * uSkinTint, sk);
  if (uKeeper > 0.5 && vPart > 4.5 && vPart < 5.5) col = uGlove * pow(clamp(lum / 0.7, 0.6, 1.1), 2.2);
  // 입속: 입술 안쪽으로 들어갈수록 어둡게 (원래 텍스처는 입속도 입술처럼 분홍이라 입을 벌리면 혀를 내민 것처럼 보임)
  vec3 mq = b - uMouth;
  float lipZ = -mq.x * mq.x / 0.05;                       // 입술 앞면이 양옆으로 갈수록 뒤로 휘는 정도
  float depth = lipZ - mq.z;                               // 입술 앞면보다 얼마나 안쪽인지 (m)
  float inMouth = (1.0 - smoothstep(0.026, 0.034, abs(mq.x))) * smoothstep(-0.045, -0.035, mq.y) * (1.0 - smoothstep(0.008, 0.016, mq.y));
  // 입을 벌리면 입술 사이 면이 원래보다 몇 배로 늘어남 → 늘어난 정도로 입속을 찾음 (화면 미분: 지금 크기 ÷ 기본 자세 크기)
  float stretch = length(fwidth(vViewPosition)) / max(length(fwidth(vBind)) * uModelScale, 1e-7);
  float gap = (1.0 - smoothstep(0.022, 0.027, abs(mq.x))) * smoothstep(-0.009, -0.006, mq.y) * (1.0 - smoothstep(0.004, 0.008, mq.y)); // 입술 사이 (기본 자세 기준)
  // 입술 사이에서 늘어난 면·입 안쪽 원래 면 = 입속 뒷벽: 아주 어둡게 칠하고, 깊이만 4cm 뒤로 밀어
  //  입술 뒤에 넣은 입체 이·혀가 그 앞에 그려지게 함 (면을 지우지 않아 구멍·각진 테두리가 생기지 않음)
  // 입술 사이: 조금이라도 늘어났거나 입술 앞면보다 안쪽이면 모두 입속 (반쯤만 칠하면 면마다 밝기가 달라 줄무늬·갈라짐이 보임)
  float wall = step(0.01, uShout) * step(0.5, vWall); // 입을 벌릴 때 미리 고른 입속 면
  // 입속: 입을 벌릴 때 고른 면(wall)에만 칠함 (입술 앞면·아랫입술은 그대로)
  //  검은 부분의 모양은 삼각형과 상관없이 머리 기준 매끄러운 타원 → 깔끔한 둥근 입속, 타원 밖은 입술 안쪽 점막색
  vec3 skinC = col;
  if (wall > 0.0) {
    vec2 e = vMouthL.xy / vec2(0.021, 0.0118);
    float er = length(e);
    vec3 throat = mix(vec3(0.008, 0.0015, 0.0015), vec3(0.06, 0.011, 0.011), smoothstep(0.35, 1.0, er)); // 가운데 어둡고 가장자리 검붉게
    vec3 lipIn = skinC * vec3(0.4, 0.22, 0.22) * (1.0 - 0.35 * (1.0 - smoothstep(1.0, 1.5, er)));                                                          // 입술 안쪽 점막
    vec3 mc = mix(throat, lipIn, smoothstep(0.9, 1.06, er));
    mc = mix(mc, skinC * 0.85, smoothstep(1.12, 1.4, er)); // 타원에서 멀어지면 피부색으로 (면 경계가 안 보이게)
    col = mix(col, mc, wall);
  }
  pkMatte = wall;
  // 함성 주름: 볼이 올라가며 생기는 팔자 주름, 미간 세로 주름, 눈가 잔주름 (기본 자세 좌표로 선을 그어 살짝 어둡게)
  if (uShout > 0.0 && mq.z > -0.06) {
    vec2 q = vec2(abs(b.x), b.y);
    float ny = uNose.y, ey = uEye.y, ex = uEye.x;
    float fold = 1.0 - smoothstep(0.0015, 0.006, segDist(q, vec2(0.02, ny + 0.001), vec2(0.04, uMouth.y - 0.014))); // 콧방울 → 입꼬리 바깥 아래
    float glab = (1.0 - smoothstep(0.0006, 0.0018, abs(q.x - 0.0055))) * smoothstep(ey + 0.004, ey + 0.009, q.y) * (1.0 - smoothstep(ey + 0.02, ey + 0.028, q.y));
    float crow = 0.0;
    for (int k = 0; k < 3; k++) { float a = -0.35 + float(k) * 0.35; vec2 o = vec2(ex + 0.024, ey); crow = max(crow, 1.0 - smoothstep(0.0005, 0.0016, segDist(q, o, o + vec2(cos(a), sin(a)) * 0.011))); }
    col *= 1.0 - uShout * (0.2 * fold + 0.22 * glab + 0.15 * crow);
    // 주름 위쪽(볼 쪽)은 살짝 밝게: 부푼 볼에 빛이 닿음
    float cheek = 1.0 - smoothstep(0.0, 0.012, segDist(q, vec2(0.03, ny - 0.002), vec2(0.046, ny + 0.008)));
    col *= 1.0 + 0.07 * uShout * cheek;
  }
  if (wall > 0.5 && uNearFar.x < 0.0) { // (이가 없어져 깊이 밀기는 쓰지 않음)
    float D = vViewPosition.z + 0.04, n = uNearFar.x, f = uNearFar.y;
    gl_FragDepthEXT = 0.5 + 0.5 * ((f + n) / (f - n) - 2.0 * f * n / ((f - n) * D));
  }
} else {                                 // 머리카락·속눈썹
  col = uHair * clamp(dot(tex, vec3(0.299, 0.587, 0.114)) / uHairLum, 0.45, 2.2);
}
diffuseColor.rgb = col;`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, pkMatte);');
    };
    m.extensions = Object.assign({}, m.extensions, { derivatives: true, fragDepth: true }); // 입속 찾기에 화면 미분, 입속 뒷벽 깊이 밀기 (WebGL1용)
    m.userData.nearFar = U.uNearFar; m.userData.U = U;
    m.customProgramCacheKey = () => 'pk-kit-mx';
    return m;
  }

  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

  // ---------- 유니폼 상의 텍스처 (이 모델의 몸통 둘레 좌표에 맞춘 그림) ----------
  //  가로(u): 0 = 가슴 가운데 → 0.25 = 선수 왼쪽 옆구리 → 0.5 = 등 가운데 → 0.75 = 오른쪽 옆구리
  //  세로: 위 = 어깨선(1.40m), 아래 = 밑단(0.89m, 그 아래로 늘어진 단은 맨 아랫줄 색)  → 1px ≈ 1mm
  //  가슴: 왼쪽 엠블럼 · 오른쪽 제조사 마크 → 가운데 스폰서 글자 → 작은 번호 / 등: 큰 번호 / 밑단: 테두리 색 띠
  function kitShirtTexture(uni, number, keeper) {
    const W = 1024, H = 512;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const shadeHex = PK.Avatar.shade;
    const c1 = keeper ? uni.gk : uni.c1;
    const c2 = keeper ? shadeHex(uni.gk, -0.38) : uni.c2;
    const lum = (hex) => { const c = new THREE.Color(hex); return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; };
    const U = (u) => u * W, V = (v) => (1 - v) * H; // v: 0 밑단 → 1 어깨
    // 앞면 그림은 가운데(u=0)가 캔버스 양 끝에 걸쳐 있으므로 두 번 그림
    const front = (fn) => { [0, W].forEach((ox) => { g.save(); g.translate(ox, 0); fn(); g.restore(); }); };
    g.fillStyle = c1; g.fillRect(0, 0, W, H);
    const p = keeper ? 'keeper' : uni.p;
    g.fillStyle = c2;
    if (p === 'stripes') { // 세로 줄무늬: 가슴 가운데에 줄 하나, 둘레에 10줄
      for (let i = 0; i < 10; i++) { const cx = U(i / 10); front(() => g.fillRect(cx - 22, 0, 44, H)); }
    } else if (p === 'hoops') { // 가로 띠 4줄 (어깨 위는 바탕색)
      for (let i = 0; i < 4; i++) g.fillRect(0, V(0.12 + i * 0.22) - 52, W, 58);
    } else if (p === 'sash') { // 왼쪽 어깨 → 오른쪽 허리로 내려오는 띠 (앞면)
      front(() => { g.beginPath(); g.moveTo(U(0.16), V(1.02)); g.lineTo(U(0.26), V(1.02)); g.lineTo(U(-0.12), V(-0.02)); g.lineTo(U(-0.22), V(-0.02)); g.closePath(); g.fill(); });
    } else if (p === 'halves') { // 몸의 오른쪽 절반이 다른 색 (앞뒤 모두)
      g.fillRect(U(0.5), 0, U(0.5), H);
    } else if (p === 'chevron') { // 가슴의 V 모양
      front(() => {
        g.beginPath(); g.moveTo(U(-0.25), V(0.98)); g.lineTo(U(0), V(0.8)); g.lineTo(U(0.25), V(0.98));
        g.lineTo(U(0.25), V(0.86)); g.lineTo(U(0), V(0.68)); g.lineTo(U(-0.25), V(0.86)); g.closePath(); g.fill();
      });
    } else if (p === 'keeper') { // 골키퍼: 은은한 사선 무늬 + 어깨 패널
      g.globalAlpha = 0.22;
      for (let x = -H; x < W + H; x += 46) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H * 0.6, 0); g.lineTo(x + H * 0.6 + 18, 0); g.lineTo(x + 18, H); g.fill(); }
      g.globalAlpha = 1;
    }
    // 옆구리 패널 (겨드랑이 아래, 살짝 어두운 바탕색) — 실제 유니폼의 통기 패널
    g.fillStyle = shadeHex(c1 === uni.c1 ? c1 : c1, -0.22);
    [0.25, 0.75].forEach((u) => { g.globalAlpha = p === 'stripes' || p === 'halves' ? 0.35 : 0.8; g.fillRect(U(u) - 34, V(0.78), 68, H); });
    g.globalAlpha = 1;
    // (어깨선은 모델 원래 디자인의 어깨 줄무늬를 테두리 색으로 칠해 씀)
    // 밑단 띠: 셔츠 아래 끝 테두리 색 (밑단 아래로 늘어진 부분까지 이어짐)
    g.fillStyle = c2; g.fillRect(0, H - 14, W, 14);
    // 원단 결 (아주 은은한 세로 니트 결)
    g.globalAlpha = 0.045; g.fillStyle = '#000';
    for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
    g.globalAlpha = 1;

    // 글자 색: 무늬가 있으면 두 색 위 어디서나 읽히게 굵은 테두리를 둠 (밝은 바탕엔 진한 글자, 어두우면 흰 글자)
    const busy = p === 'stripes' || p === 'hoops' || p === 'sash' || p === 'halves';
    const avgL = busy ? (lum(c1) + lum(c2)) / 2 : lum(c1);
    const darkInk = avgL > 0.55, darker = lum(c1) < lum(c2) ? c1 : c2;
    const numFill = darkInk ? '#141414' : '#ffffff';
    const numEdge = busy ? (darkInk ? '#ffffff' : shadeHex(darker, -0.45)) : (darkInk ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.35)');
    const edgeW = busy ? 2.2 : 1;
    // 엠블럼 (선수 왼쪽 가슴): 방패 + 별
    const crest = (cx, cy, s) => {
      g.save(); g.translate(cx, cy); g.scale(s, s);
      g.beginPath(); g.moveTo(-20, -24); g.lineTo(20, -24); g.lineTo(20, 4); g.quadraticCurveTo(20, 20, 0, 28); g.quadraticCurveTo(-20, 20, -20, 4); g.closePath();
      g.fillStyle = c2; g.fill(); g.lineWidth = 3; g.strokeStyle = numFill; g.stroke();
      g.fillStyle = numFill; g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 4.5 : 10; g.lineTo(Math.cos(a) * r, Math.sin(a) * r - 2); }
      g.closePath(); g.fill();
      g.restore();
    };
    crest(U(0.09), V(0.74), 1.15);
    // 오른쪽 가슴: 단순한 제조사 마크 (사선 두 줄)
    g.fillStyle = numFill;
    front(() => { g.save(); g.translate(U(-0.09), V(0.75)); g.rotate(-0.5); g.fillRect(-13, -8, 26, 5); g.fillRect(-13, 3, 26, 5); g.restore(); });
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 5 * edgeW; g.lineJoin = 'round'; g.strokeStyle = numEdge; g.fillStyle = numFill;
    // 가슴 가운데 스폰서 글자 (가상의 대회 이름)
    g.font = 'italic 900 40px "Arial Black", "Noto Sans KR", Arial, sans-serif';
    front(() => { g.save(); g.translate(0, V(0.55)); g.scale(1, 1.15); g.strokeText('PK ONLINE', 0, 0); g.fillText('PK ONLINE', 0, 0); g.restore(); });
    // 앞 번호 (스폰서 아래, 작게)
    g.font = '900 46px "Arial Black", "Noto Sans KR", Arial, sans-serif';
    front(() => { g.strokeText(String(number), 0, V(0.4)); g.fillText(String(number), 0, V(0.4)); });
    // 등번호 (등 위쪽, 크게) + 위에 작은 대회 글자
    g.font = '900 200px "Arial Black", "Noto Sans KR", Arial, sans-serif';
    g.lineWidth = 10 * edgeW;
    g.strokeText(String(number), U(0.5), V(0.5)); g.fillText(String(number), U(0.5), V(0.5));
    g.font = '900 30px "Arial Black", "Noto Sans KR", Arial, sans-serif'; g.lineWidth = 4 * edgeW;
    g.strokeText('PK ONLINE', U(0.5), V(0.86)); g.fillText('PK ONLINE', U(0.5), V(0.86));
    const tex = PK.canvasTex(cv);
    tex.anisotropy = 8;
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  // 벌린 입 안쪽 (입술 사이 틈에 그림): 어두운 입속 + 윗니 + 혀, 가장자리는 부드럽게
  let insideTex = null;
  function mouthInsideTexture() {
    if (insideTex) return insideTex;
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.save(); g.beginPath(); g.ellipse(64, 32, 60, 30, 0, 0, Math.PI * 2); g.clip();
    const bg = g.createRadialGradient(64, 36, 4, 64, 34, 64); bg.addColorStop(0, '#1c0607'); bg.addColorStop(1, '#4a1a1a');
    g.fillStyle = bg; g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#efe8dc'; g.beginPath(); g.ellipse(64, 4, 44, 12, 0, 0, Math.PI * 2); g.fill();   // 윗니
    g.fillStyle = '#a8484a'; g.beginPath(); g.ellipse(64, 60, 34, 14, 0, 0, Math.PI * 2); g.fill();  // 혀
    g.restore();
    insideTex = PK.canvasTex(c);
    return insideTex;
  }

  // ---------- 아바타 만들기 ----------
  // rig: 기존 관절 그룹(P)을 가진 root. 이 함수는 모델을 붙이고 매 프레임 자세를 옮기는 sync 를 만들어 줌
  function attach(root, cfg, opts) {
    const O = PK.Options;
    const keeper = !!opts.keeper;
    const uni = O.uniform[cfg.uniform];
    const skinC = new THREE.Color(O.skin[cfg.skin].c);
    const hairHex = O.hairColor[cfg.hairColor].c;
    const boot = O.boots[cfg.boots];
    const same = (a, b) => a.toLowerCase() === b.toLowerCase();
    const shade = PK.Avatar.shade;

    const model = THREE.SkeletonUtils.clone(base.scene);
    model.name = 'pk-model';
    model.scale.setScalar(MS);
    root.add(model);
    const bones = {};
    const meshes = [];
    model.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
      if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; o.userData.sharedGeo = true; }
      if (o.isSkinnedMesh) meshes.push(o);
    });

    // 피부·유니폼 재질 (두 메시가 같은 재질을 씀)
    const tint = new THREE.Color(skinC.r / skinAvg.r, skinC.g / skinAvg.g, skinC.b / skinAvg.b).convertSRGBToLinear();
    const shirtTex = kitShirtTexture(uni, opts.number || (keeper ? 1 : 10), keeper);
    shirtTex.generateMipmaps = false; shirtTex.minFilter = THREE.LinearFilter; // 가슴 가운데 이음매에 선이 생기지 않게
    const kit = {
      skinBase: lin(O.skin[cfg.skin].c),
      skinTint: new THREE.Vector3(Math.min(1.8, tint.r), Math.min(1.8, tint.g), Math.min(1.8, tint.b)),
      hair: lin(hairHex),
      shirtMap: shirtTex,
      sleeve: lin(keeper ? uni.gk : uni.c1),
      trim: lin(keeper ? shade(uni.gk, -0.35) : uni.c2),
      shorts: lin(keeper ? shade(uni.gk, -0.45) : uni.shorts),
      stripe: lin(keeper ? uni.gk : (same(uni.shorts, uni.c1) ? uni.c2 : uni.c1)),
      socks: lin(keeper ? shade(uni.gk, -0.2) : uni.socks),
      sockBand: lin(keeper ? '#ffffff' : (same(uni.socks, uni.c1) ? uni.c2 : uni.c1)),
      boot: lin(boot.c), sole: lin(boot.s), glove: lin('#f2f2f2'),
      longSleeve: keeper,
      // 소매 무늬: 1 후프(띠) · 2 하프(오른쪽 소매 다른 색) / 어깨선 띠: 무늬가 단순한 유니폼과 키퍼
      sleevePat: keeper ? 0 : uni.p === 'hoops' ? 1 : uni.p === 'halves' ? 2 : 0,
      sleeve2: lin(keeper ? uni.gk : uni.c2),
      armLine: keeper || uni.p === 'solid' || uni.p === 'chevron' || uni.p === 'sash' ? 1 : 0,
    };
    // 옷 종류마다 재질 하나씩 (셔츠·반바지·양말·축구화·몸·머리카락)
    const mats = {};
    meshes.forEach((o) => {
      const kd = meshKind[o.name] || KIND.body;
      if (!mats[kd]) mats[kd] = kitMaterial(o.material, kit, kd);
      o.geometry = kitGeos[o.name]; o.material = mats[kd];
      if (kd === KIND.hair || kd === KIND.lashes) o.castShadow = false;
      // 입속 뒷벽 깊이를 계산하려면 지금 카메라의 near·far 가 필요
      if (kd === KIND.body) o.onBeforeRender = (r, sc, cam) => {
        const Um = o.material.userData.U; if (!Um || !cam.isPerspectiveCamera) return;
        Um.uNearFar.value.set(cam.near, cam.far);
        if (Um.uShout.value > 0 && mouth && mouth.userData.center) {
          const c = mouth.userData.center; c.updateWorldMatrix(true, false);
          Um.uMouthView.value.setFromMatrixPosition(c.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
          Um.uMouthInv.value.copy(c.matrixWorld).invert();
        }
      };
    });

    // 함성 표정: 얼굴 전체를 환호하는 모양으로 바꾸고(턱·입꼬리·윗입술·볼·코·눈·눈썹), 입속에 입체 이·혀를 넣음
    const mouth = buildMouthInside();
    model.add(mouth);
    const setMouthOpen = (amt) => {
      meshes.forEach((o) => { o.geometry = amt > 0 ? shoutGeometry(o.name, amt) : kitGeos[o.name]; });
      mouth.visible = amt > 0;
      mouth.userData.jaw.rotation.x = SHOUT.jaw / JAW_R * amt; // 아랫니·혀는 아래턱과 같이 돌아감
      if (mats[KIND.body] && mats[KIND.body].userData.U) mats[KIND.body].userData.U.uShout.value = amt;
    };
    setMouthOpen(0);

    setupRetarget(root, model, bones, { decal: mouth });
    mouth.scale.setScalar(mouth.userData.unit || 1); // 입속 모델은 m 단위로 만들었으니 머리 뼈 좌표 단위로
    root.userData.bones = bones; // 보이는 몸의 뼈 (실제 다이빙 동작 중에는 이 뼈로 막기 판정)
    // 함성 표정 켜기/끄기 (승리 세리머니 클로즈업용)
    root.userData.setShout = (on) => { setMouthOpen(on ? 1 : 0); };
  }

  // 입속 입체 모델 (기본 자세 모델 좌표, m): 혀만 (아래턱과 함께 턱관절 축으로 돌아감). 이는 넣지 않음
  const SHOUT = { jaw: 0.022 }; // 턱 끝이 내려가는 거리 (m)
  const JAW_R = 0.105;          // 턱관절 → 입술 앞 거리 (m)
  let mouthMats = null;
  function buildMouthInside() {
    const fm = faceInfo.mouth, g = new THREE.Group();
    g.userData.faceDecal = { at: new THREE.Vector3(0, 0, 0) }; // 그룹 원점 = 모델 원점 → 자식은 모델 좌표 그대로
    if (!mouthMats) mouthMats = { tongue: new THREE.MeshStandardMaterial({ color: 0x7a2a2e, roughness: 0.85, envMapIntensity: 0.1 }) };
    const hy = fm.y + 0.03, hz = fm.z - JAW_R;
    // 아래턱: 턱관절을 축으로 회전하는 그룹
    const jaw = new THREE.Group(); jaw.position.set(0, hy, hz); g.add(jaw);
    // 혀: 입속 바닥에 낮게 깔림 (윗면만 보임)
    const tongue = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), mouthMats.tongue);
    tongue.scale.set(0.017, 0.0065, 0.024); tongue.position.set(fm.x, fm.y - 0.0175, fm.z - 0.03).sub(jaw.position); jaw.add(tongue);
    // 입속 가운데 표시 (셰이더가 입속 색을 가운데 어둡게·가장자리 붉게 칠하는 기준)
    const center = new THREE.Object3D(); center.position.set(fm.x, fm.y - 0.0085, fm.z - 0.004); g.add(center); g.userData.center = center;
    g.userData.jaw = jaw;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    return g;
  }

  // 턱 내리기: 실제 턱처럼 귀 앞(턱관절)을 축으로 아래턱을 돌려 입을 벌림 (메시·벌린 정도별로 한 번만 만들어 공유)
  //  아랫입술 가운데에서 이어진 정점을 따라가며(입술이 맞닿는 선 위로는 넘어가지 않게) 아래턱에 붙은 정점만 골라 돌림
  //  입술 사이 면은 끊지 않고 늘어나게 둠 → 셰이더가 '원래보다 크게 늘어난 면'을 입속처럼 어둡게 칠함 (구멍이 생기지 않음)
  const jawCache = {}, jawSets = {};
  const smf = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function lowerJawSet(name) {
    if (jawSets[name]) return jawSets[name];
    const g = kitGeos[name], bd = g.attributes.aBind, idx = g.index, N = bd.count, fm = faceInfo.mouth;
    const L = new Uint8Array(N);
    if (!idx) return (jawSets[name] = L);
    const adj = Array.from({ length: N }, () => []);
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      adj[a].push(b, c); adj[b].push(a, c); adj[c].push(a, b);
    }
    const seam = (i) => fm.y + 0.0011 - 2.5 * Math.pow(bd.getX(i) - fm.x, 2); // 입술이 맞닿는 선 바로 위까지만
    const ok = (i) => Math.abs(bd.getX(i) - fm.x) < 0.07 && bd.getY(i) > fm.y - 0.12 && bd.getY(i) < seam(i) && bd.getZ(i) > fm.z - 0.12;
    let seed = -1, best = 0.01; // 아랫입술 가운데 (입술선 1cm 아래, 입술 앞면)
    for (let i = 0; i < N; i++) {
      const d = Math.hypot(bd.getX(i) - fm.x, bd.getY(i) - (fm.y - 0.0095), bd.getZ(i) - (fm.z + 0.002));
      if (d < best) { best = d; seed = i; }
    }
    if (seed < 0) return (jawSets[name] = L);
    const st = [seed]; L[seed] = 1;
    while (st.length) { const i = st.pop(); for (const j of adj[i]) if (!L[j] && ok(j)) { L[j] = 1; st.push(j); } }
    return (jawSets[name] = L);
  }
  // 환호하는 얼굴: 정점마다 (기본 자세 위치 기준) 옮길 양을 더함 — 몸(얼굴)·속눈썹 메시
  //  ① 아래턱: 턱관절 축으로 회전 (아랫입술에서 이어진 정점만)  ② 입꼬리: 옆·뒤로 당겨 입이 네모나게 크게 벌어짐
  //  ③ 윗입술: 들려 윗니가 보임  ④ 볼: 위로 부풀어 오름(팔자 주름 쪽)  ⑤ 콧방울: 벌어짐
  //  ⑥ 눈: 아래 눈꺼풀이 올라가고 윗눈꺼풀이 조금 내려와 찡그림  ⑦ 눈썹: 내려오며 가운데로 모임(미간에 힘)
  const gauss = (dx, dy, dz, sx, sy, sz) => Math.exp(-((dx / sx) ** 2 + (dy / sy) ** 2 + (dz / sz) ** 2));
  function shoutOffset(x, y, z, inJaw, amt, out) {
    const fm = faceInfo.mouth, N = faceInfo.nose, E = faceInfo.eye, mY = fm.y, mZ = fm.z;
    out.set(0, 0, 0);
    const ax = Math.abs(x - fm.x), sg = x >= fm.x ? 1 : -1;
    if (z < N.z - 0.09) return out; // 얼굴 앞쪽만
    // ① 아래턱
    if (inJaw) {
      const lip = smf(mY - 0.02, mY - 0.004, y);
      // 입술 근처는 가운데가 가장 많이 내려가고 입꼬리로 갈수록 서서히 덜 (아랫입술이 둥근 곡선 → 입이 타원으로 벌어짐)
      const xa = 0.03 + (0.011 - 0.03) * lip, xb = 0.07 + (0.032 - 0.07) * lip;
      const w = (1 - smf(xa, xb, ax)) * smf(mY - 0.11, mY - 0.06, y) * smf(mZ - 0.11, mZ - 0.06, z);
      if (w > 0) {
        const t = SHOUT.jaw / JAW_R * amt * w, ry = y - (mY + 0.03), rz = z - (mZ - JAW_R), c = Math.cos(t), sn = Math.sin(t);
        out.y += ry * c - rz * sn - ry; out.z += ry * sn + rz * c - rz;
      }
    }
    // ② 입꼬리
    const cw = gauss(ax - 0.024, y - (mY - 0.004), z - (mZ - 0.012), 0.013, 0.014, 0.02);
    out.x += sg * 0.002 * cw * amt; out.y -= 0.001 * cw * amt; out.z -= 0.0015 * cw * amt;
    // ③ 윗입술
    if (!inJaw) {
      const uw = (1 - smf(0.016, 0.03, ax)) * smf(mY - 0.0005, mY + 0.003, y) * (1 - smf(mY + 0.01, N.y - 0.008, y)) * smf(mZ - 0.025, mZ - 0.01, z);
      out.y += 0.0035 * uw * amt; out.z += 0.0012 * uw * amt;
    }
    // ④ 볼
    const kw = gauss(ax - 0.037, y - (N.y - 0.01), z - (N.z - 0.035), 0.016, 0.016, 0.03);
    out.y += 0.0055 * kw * amt; out.z += 0.002 * kw * amt; out.x += sg * 0.001 * kw * amt;
    // ⑤ 콧방울
    const nw = gauss(ax - 0.014, y - (N.y - 0.003), z - (N.z - 0.013), 0.006, 0.006, 0.01);
    out.x += sg * 0.0018 * nw * amt; out.y += 0.0012 * nw * amt;
    // ⑥ 눈 (아래 눈꺼풀 ↑, 윗눈꺼풀 ↓)
    const ex = ax - E.x, ez = z - E.z;
    const lw = gauss(ex, y - (E.y - 0.01), ez, 0.016, 0.006, 0.02);
    const tw = gauss(ex, y - (E.y + 0.008), ez, 0.016, 0.005, 0.02);
    out.y += (0.003 * lw - 0.0016 * tw) * amt;
    // ⑦ 눈썹 (전체 ↓, 안쪽 끝은 더 내려오며 가운데로)
    const bw = gauss(ex, y - (E.y + 0.022), ez, 0.026, 0.011, 0.025);
    const iw = gauss(ax - 0.011, y - (E.y + 0.018), z - (E.z + 0.008), 0.01, 0.011, 0.02);
    out.y -= (0.005 * bw + 0.003 * iw) * amt; out.x -= sg * 0.003 * iw * amt;
    return out;
  }
  function shoutGeometry(name, amt) {
    const kind = meshKind[name];
    if (kind !== KIND.body && kind !== KIND.lashes) return kitGeos[name];
    const key = name + amt.toFixed(3);
    if (jawCache[key]) return jawCache[key];
    const g = kitGeos[name].clone();
    const pos = g.attributes.position, bind = g.attributes.aBind;
    const L = kind === KIND.body ? lowerJawSet(name) : null;
    // 지오메트리 좌표는 원본 단위(cm, 회전 포함)라 이동량을 그 좌표로 바꿔서 더함
    const inv = meshInvW[name];
    const d0 = V3().applyMatrix4(inv), d = V3(), off = V3();
    const moveY = new Float32Array(pos.count); // 정점마다 아래로 움직인 양 (m) → 입속 면 고르기에 씀
    for (let i = 0; i < pos.count; i++) {
      shoutOffset(bind.getX(i), bind.getY(i), bind.getZ(i), L ? L[i] === 1 : false, amt, d);
      if (L && L[i] === 1) { moveY[i] = -d.y; shoutOffset(bind.getX(i), bind.getY(i), bind.getZ(i), false, amt, off); moveY[i] += off.y; } // 아래턱 회전으로만 내려간 양
      shoutOffset(bind.getX(i), bind.getY(i), bind.getZ(i), L ? L[i] === 1 : false, amt, d);
      if (d.lengthSq() < 1e-12) continue;
      off.copy(d).applyMatrix4(inv).sub(d0);
      pos.setXYZ(i, pos.getX(i) + off.x, pos.getY(i) + off.y, pos.getZ(i) + off.z);
    }
    pos.needsUpdate = true;
    const out = kind === KIND.body ? markMouthWall(g, moveY) : g;
    out.computeBoundingSphere();
    jawCache[key] = out;
    return out;
  }
  // 입속 면 표시: 입술 사이에서 위(안 움직임)·아래(아래턱과 내려감) 정점에 걸쳐 크게 벌어진 삼각형, 입술 앞면보다 안쪽의 삼각형
  //  → 이 삼각형들만 정점을 따로 복사해 aWall=1 을 붙임 (셰이더가 이것만 보고 입속으로 칠하고 깊이를 뒤로 밈)
  //  화면에서 늘어난 정도를 재는 방식은 가는 삼각형에서 값이 흔들려 줄무늬(갈라짐)가 생겨서, 면 단위로 미리 정함
  function markMouthWall(g, moveY) {
    const idx = g.index, bd = g.attributes.aBind, N = bd.count, fm = faceInfo.mouth;
    if (!idx) return g;
    const T = idx.count / 3, wallT = [];
    for (let t = 0; t < T; t++) {
      const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
      const cx = (bd.getX(a) + bd.getX(b) + bd.getX(c)) / 3 - fm.x, cy = (bd.getY(a) + bd.getY(b) + bd.getY(c)) / 3 - fm.y;
      const cz = (bd.getZ(a) + bd.getZ(b) + bd.getZ(c)) / 3 - fm.z;
      if (Math.abs(cx) > 0.03 || cy < -0.012 || cy > 0.009 || cz < -0.06) continue;
      const mn = Math.min(moveY[a], moveY[b], moveY[c]), mx = Math.max(moveY[a], moveY[b], moveY[c]);
      const lipZ = -(cx * cx) / 0.05, depth = lipZ - cz; // 입술 앞면보다 얼마나 안쪽인지
      const inner = depth > 0.0006 && Math.abs(cx) < 0.024 && cy > -0.008 && cy < 0.008; // 입술 안쪽(윗입술 안쪽 포함)
      if ((mx - mn > 0.002 && Math.abs(cx) < 0.024) || inner) wallT.push(t);
    }
    const M = N + wallT.length * 3, ng = new THREE.BufferGeometry();
    for (const key in g.attributes) {
      const a = g.attributes[key], n = a.itemSize, arr = new Float32Array(M * n);
      const get = (i, k) => (k === 0 ? a.getX(i) : k === 1 ? a.getY(i) : k === 2 ? a.getZ(i) : a.getW(i));
      for (let i = 0; i < N; i++) for (let k = 0; k < n; k++) arr[i * n + k] = get(i, k);
      wallT.forEach((t, w) => { for (let v = 0; v < 3; v++) { const i = idx.getX(t * 3 + v), j = N + w * 3 + v; for (let k = 0; k < n; k++) arr[j * n + k] = get(i, k); } });
      ng.setAttribute(key, new THREE.BufferAttribute(key === 'skinIndex' ? new Uint16Array(arr) : arr, n, a.normalized));
    }
    const wallA = new Float32Array(M); for (let j = N; j < M; j++) wallA[j] = 1;
    ng.setAttribute('aWall', new THREE.BufferAttribute(wallA, 1));
    const ni = new Uint32Array(idx.count);
    for (let i = 0; i < idx.count; i++) ni[i] = idx.getX(i);
    wallT.forEach((t, w) => { for (let v = 0; v < 3; v++) ni[t * 3 + v] = N + w * 3 + v; });
    ng.setIndex(new THREE.BufferAttribute(ni, 1));
    ng.groups = g.groups.slice();
    return ng;
  }

  // ---------- 리타깃: 기존 관절의 자세를 모델 뼈에 옮김 ----------
  function setupRetarget(root, model, B, face) {
    const P = root.userData.parts;
    // 1) 기존 리그를 '모든 회전 0' 기본 자세로 두고 기준을 잡음
    const saved = [];
    root.traverse((o) => { if (o !== root && !o.isBone && o.userData.rigPart) { saved.push([o, o.quaternion.clone(), o.position.clone()]); o.quaternion.identity(); } });
    P.hips.position.set(0, 0.97, 0);
    const rootQ = root.quaternion.clone(), rootP = root.position.clone();
    root.quaternion.identity(); root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);

    // 모델의 팔·다리를 곧게 아래로 내린 자세(기존 관절의 기본 자세)로 맞춤
    const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
    const wp = (o) => o.getWorldPosition(new THREE.Vector3());
    const aim = (bone, child, dir) => {
      const cur = wp(child).sub(wp(bone)).normalize();
      const dq = new THREE.Quaternion().setFromUnitVectors(cur, dir);
      const nw = dq.multiply(wq(bone));
      const pq = wq(bone.parent);
      bone.quaternion.copy(pq.invert().multiply(nw));
      bone.updateMatrixWorld(true);
    };
    const down = new THREE.Vector3(0, -1, 0);
    // 발바닥을 땅에 댄 원래 각도 (뒤꿈치→발가락 관절이 아래로 숙인 각도): 다리를 곧게 편 뒤 발을 다시 이 각도로
    const footPitch = {};
    const footRestW = {};
    ['l', 'r'].forEach((s) => { const d = wp(B['ball_' + s]).sub(wp(B['foot_' + s])); footPitch[s] = Math.atan2(d.y, Math.hypot(d.x, d.z)); footRestW[s] = wq(B['foot_' + s]); footRestW[s].yaw = Math.atan2(d.x, d.z); });
    ['l', 'r'].forEach((s) => {
      aim(B['upperarm_' + s], B['lowerarm_' + s], down); aim(B['lowerarm_' + s], B['hand_' + s], down);
      aim(B['thigh_' + s], B['calf_' + s], down); aim(B['calf_' + s], B['foot_' + s], down);
      { const f = B['foot_' + s], yaw = footRestW[s].yaw; // 발바닥은 원래처럼 평평하게, 발끝 방향만 정면으로
        const nw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw).multiply(footRestW[s]);
        f.quaternion.copy(wq(f.parent).invert().multiply(nw)); f.updateMatrixWorld(true); }
    });
    model.updateMatrixWorld(true);

    // 매핑: 모델 뼈 ← 기존 관절 (보간이 필요한 등뼈·목은 두 관절 사이를 섞음)
    const MAP = [
      ['pelvis', 'hips'], ['spine_01', 'hips', 'spine', 0.4], ['spine_02', 'hips', 'spine', 0.75], ['spine_03', 'spine'],
      ['neck_01', 'spine', 'head', 0.5], ['Head', 'head'],
      ['upperarm_l', 'armL'], ['lowerarm_l', 'elbowL'], ['hand_l', 'handL'],
      ['upperarm_r', 'armR'], ['lowerarm_r', 'elbowR'], ['hand_r', 'handR'],
      ['thigh_l', 'legL'], ['calf_l', 'kneeL'], ['foot_l', 'footL'],
      ['thigh_r', 'legR'], ['calf_r', 'kneeR'], ['foot_r', 'footR'],
    ].filter((m) => B[m[0]] && P[m[1]] && (!m[2] || P[m[2]]));
    const rigQ = (m) => { const a = wq(P[m[1]]); if (!m[2]) return a; return a.slerp(wq(P[m[2]]), m[3]); };
    const entries = MAP.map((m) => ({ bone: B[m[0]], m, offset: rigQ(m).invert().multiply(wq(B[m[0]])) }));
    // 골반 위치 기준 차이 (모델이 더 크면 골반이 조금 높음 → 발이 땅에 닿게 그대로 둠)
    const pelvis = B.pelvis;
    const pelvisDelta = wp(pelvis).sub(wp(P.hips));
    const pelvisParent = pelvis.parent;
    // 쇄골은 기존 관절에 대응하는 게 없어 매 프레임 다시 쓰이지 않음 → 기본 자세를 기억해 두고 매 프레임 되돌림
    //  (안 그러면 어깨 들기가 프레임마다 쌓여 어깨가 날개처럼 계속 솟고, 팔을 내려도 그대로 남음)
    const clRest = ['l', 'r'].map((s) => B['clavicle_' + s] && [B['clavicle_' + s], B['clavicle_' + s].quaternion.clone()]).filter(Boolean);

    // 얼굴 장식(입속)은 머리 뼈에 붙임: 기본 자세(바인드)에서 머리 뼈 기준 위치로 바꿔 붙임
    const head = B.Head;
    let headInv = null;
    model.traverse((o) => { if (!headInv && o.isSkinnedMesh && o.skeleton) { const k = o.skeleton.bones.indexOf(head); if (k >= 0) headInv = o.skeleton.boneInverses[k]; } });
    const hiPos = new THREE.Vector3(), hiQ = new THREE.Quaternion(), hiS = new THREE.Vector3();
    let headRest = null; base.scene.traverse((o) => { if (o.isBone && o.name === 'Head') headRest = o; });
    const toHead = headRest.matrixWorld.clone().invert(); // 기본 자세에서 모델 좌표(m) → 머리 뼈 좌표
    toHead.decompose(hiPos, hiQ, hiS);
    [face.decal].forEach((d) => {
      if (!d) return;
      const at = d.userData.faceDecal.at; // 기본 자세 기준 위치 (모델 좌표, m)
      head.add(d); d.position.copy(at).applyMatrix4(toHead); d.quaternion.copy(hiQ);
      d.userData.restQ = d.quaternion.clone();
      d.userData.unit = hiS.x; // 머리 뼈 좌표의 단위 (원본은 cm) → 입 크기·위치를 맞출 때 씀
    });
    // 기존 리그 자세 복원
    saved.forEach(([o, q, p]) => { o.quaternion.copy(q); o.position.copy(p); });
    root.quaternion.copy(rootQ); root.position.copy(rootP);

    const tq = new THREE.Quaternion(), pq = new THREE.Quaternion(), tmp = new THREE.Vector3(), rootInv = new THREE.Quaternion();

    // 실제 애니메이션 재생: 게임이 매 프레임 anim(이름 | null, {fade, phase}) 로 원하는 동작을 알려줌
    //  w = 실제 애니메이션 비중 (0 = 기존 관절 자세만, 1 = 애니메이션만) → 사이를 부드럽게 섞음
    const bones = [];
    model.traverse((o) => { if (o.isBone && o.name !== 'root') bones.push(o); });
    const q0 = bones.map(() => new THREE.Quaternion()), qc = new THREE.Quaternion(), p0 = new THREE.Vector3();
    const mixer = Object.keys(clips).length ? new THREE.AnimationMixer(model) : null;
    const actions = {};
    const A = { want: null, fade: 0.25, phase: null, cur: null, w: 0, last: 0 };
    root.userData._anim = A; // 점검용
    root.userData.anim = function (name, opt) {
      if (!mixer) return;
      opt = opt || {};
      if (name && !clips[name]) name = null;
      A.fade = opt.fade !== undefined ? opt.fade : 0.25;
      A.phase = opt.phase !== undefined ? opt.phase : null;
      A.speed = opt.speed || 1;
      A.maxW = opt.weight !== undefined ? opt.weight : 1; // 1 보다 작으면 기본(선) 자세와 섞여 동작이 작아짐 (예: 짧은 보폭)
      if (name === A.want) return;
      A.want = name;
      if (!name) return; // 지금 동작을 유지한 채 비중만 줄여 기존 자세로
      let act = actions[name];
      if (!act) { act = actions[name] = mixer.clipAction(clips[name]); }
      const prev = A.cur;
      act.reset(); act.enabled = true; act.setEffectiveTimeScale(1); act.setEffectiveWeight(1); act.play();
      if (prev && prev !== act && A.w > 0.01 && A.fade > 0) act.crossFadeFrom(prev, A.fade, false);
      else if (prev && prev !== act) prev.stop();
      A.cur = act;
    };
    const applyAnim = () => {
      if (!mixer) return;
      const now = api.clock ? api.clock() : performance.now() / 1000; // clock: 시험용으로 게임 시간을 쓸 때
      const dt = A.last ? Math.min(0.1, Math.max(0, now - A.last)) : 0;
      A.last = now;
      const target = A.want ? (A.maxW !== undefined ? A.maxW : 1) : 0;
      A.w = A.fade > 0 ? A.w + Math.max(-dt / A.fade, Math.min(dt / A.fade, target - A.w)) : target;
      if (A.w <= 0 || !A.cur) {
        if (A.cur && !A.want) {
          // 멈추면 three.js 가 처음 연결할 때의 자세로 뼈를 되돌려 한 프레임 이상한 자세가 보임 → 지금 자세를 지켜 둠
          bones.forEach((b, i) => q0[i].copy(b.quaternion)); p0.copy(pelvis.position);
          mixer.stopAllAction(); A.cur = null;
          bones.forEach((b, i) => b.quaternion.copy(q0[i])); pelvis.position.copy(p0);
        }
        return;
      }
      // 기존 관절 자세를 기억해 두고, 애니메이션 자세와 비중만큼 섞음
      bones.forEach((b, i) => q0[i].copy(b.quaternion)); p0.copy(pelvis.position);
      if (A.phase !== null && A.want) { A.cur.timeScale = 0; A.cur.time = A.phase * A.cur.getClip().duration; }
      else A.cur.timeScale = A.speed || 1;
      // three.js 는 값이 지난 프레임과 같으면 뼈에 다시 쓰지 않음 → 위에서 기존 자세를 먼저 써 두었으므로
      // 그 프레임만 기존 자세가 보이며 몸이 떨림. 지난 결과를 지워서 매 프레임 반드시 쓰게 함
      const bs = mixer._bindings;
      for (let i = 0; i < bs.length; i++) { const s = bs[i].valueSize; bs[i].buffer.fill(NaN, s, 3 * s); }
      mixer.update(dt);
      if (A.w < 1) {
        bones.forEach((b, i) => { qc.copy(b.quaternion); b.quaternion.copy(q0[i]).slerp(qc, A.w); });
        pelvis.position.lerpVectors(p0, pelvis.position, A.w);
      }
    };

    // 팔을 어깨 위로 올리면 실제 사람처럼 어깨(쇄골·날개뼈)도 같이 들림
    //  → 쇄골이 그대로면 어깨가 꺼지고 소매가 접혀 보임. 위팔 방향은 그대로 두고 쇄골만 들어 올림
    const chest = B.spine_03, shV = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const shQ = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
    const SH_START = 1.3, SH_MAX = 0.13; // 팔이 아래에서 이만큼(rad) 올라가면 들기 시작, 머리 위로 다 올리면 이만큼 들림
    function liftShoulders() {
      if (!chest || !B.clavicle_l || !B.clavicle_r) return;
      model.updateMatrixWorld(true);
      const [arm, cv, up, axis] = shV, [cq, uq, rq] = shQ;
      chest.getWorldQuaternion(cq);
      up.set(0, 1, 0).applyQuaternion(cq); // 가슴 기준 위쪽
      ['l', 'r'].forEach((s) => {
        const cl = B['clavicle_' + s], ua = B['upperarm_' + s], la = B['lowerarm_' + s];
        arm.copy(wp(la)).sub(wp(ua)).normalize();
        const e = Math.acos(Math.max(-1, Math.min(1, -arm.dot(up)))); // 0 = 아래로 늘어뜨림, π = 머리 위
        const k = Math.max(0, Math.min(1, (e - SH_START) / (Math.PI - SH_START)));
        if (k <= 0) return;
        const ang = SH_MAX * k * k * (3 - 2 * k);
        cv.copy(wp(ua)).sub(wp(cl));
        axis.crossVectors(cv, up); if (axis.lengthSq() < 1e-8) return; axis.normalize();
        ua.getWorldQuaternion(uq);
        rq.setFromAxisAngle(axis, ang).multiply(wq(cl));
        cl.quaternion.copy(wq(cl.parent).invert().multiply(rq)); cl.updateMatrixWorld(true);
        ua.quaternion.copy(wq(cl).invert().multiply(uq)); ua.updateMatrixWorld(true); // 위팔 방향은 그대로
      });
    }

    root.userData.sync = function () {
      // 좌우를 뒤집은 선수(가로 배율 −1, 반대쪽 다이빙)는 월드 회전값이 뒤틀려 계산돼 쇄골·팔이 꼬임
      //  → 뼈 계산은 뒤집지 않은 상태에서 하고(뼈 회전은 부모 기준이라 그대로 맞음), 끝나면 다시 뒤집음
      const mirX = root.scale.x < 0;
      if (mirX) root.scale.x = -root.scale.x;
      try { syncBones(); } finally { if (mirX) { root.scale.x = -root.scale.x; root.updateMatrixWorld(true); } }
    };
    function syncBones() {
      clRest.forEach(([b, q]) => b.quaternion.copy(q));
      root.updateMatrixWorld(true);
      rootInv.copy(root.getWorldQuaternion(new THREE.Quaternion())).invert();
      // 골반 위치
      const hp = P.hips.getWorldPosition(tmp);
      hp.add(pelvisDelta.clone().applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())));
      pelvis.position.copy(pelvisParent.worldToLocal(hp));
      // 회전: 부모부터 차례로 (모델 뼈 = 기존 관절 회전 × 기준 차이)
      for (const e of entries) {
        tq.copy(rigQ(e.m)).multiply(e.offset);
        e.bone.parent.updateMatrixWorld(true);
        e.bone.parent.getWorldQuaternion(pq);
        e.bone.quaternion.copy(pq.invert().multiply(tq));
        e.bone.updateMatrixWorld(true);
      }
      applyAnim();
      liftShoulders();
      // 게임이 동작 위에 덧붙이는 손질 (예: 다이빙 중 두 손을 모음)
      if (root.userData.postAnim) { model.updateMatrixWorld(true); root.userData.postAnim(B); }
    }
    root.userData.sync();
  }

  api.load = load;
  api.attach = attach;
  api.rigify = rigify;
  api.clips = () => clips;
  api.meta = (name) => clipMeta[name] || null;
  api.pathAt = pathAt;
  api.addClips = (data) => buildClips(data);
  api.scale = MS;
  return api;
})();
