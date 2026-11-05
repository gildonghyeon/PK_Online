// 사실적인 선수 모델 (Quaternius "Universal Base Characters", CC0)
//  - 게임의 움직임·키퍼 판정은 기존 관절(리그)이 담당하고, 이 모델은 매 프레임 그 자세를 그대로 따라함 (리타깃)
//  - 유니폼(셔츠·반바지·스타킹·축구화·장갑)은 몸 위에 부위별로 칠하고 살짝 부풀려 옷처럼 보이게 함
//  - 피부색·머리 색은 색을 곱해서, 헤어스타일은 팩의 머리 + 기존 머리 모양, 표정은 눈썹 자세와 입 그림으로
window.PK = window.PK || {};

PK.PlayerModel = (function () {
  const V3 = () => new THREE.Vector3();
  const api = { ready: false };
  let base = null;      // 불러온 몸 glTF
  let hairs = null;     // 머리 glTF (장면 5개: Buzzed, SimpleParted, Long, Buns, Beard)
  let skinAvg = null;   // 피부 텍스처 평균색 (피부색 맞추기용)
  let kitGeo = null;    // 유니폼 부위 정보가 들어간 몸 지오메트리 (모든 선수가 공유)
  let faceInfo = null;  // 입·눈 위치 (기본 자세 기준)

  // 우리 선수 꾸미기 7가지 → 이 모델의 머리 (null = 기존 방식 머리 모양을 머리에 붙임)
  const HAIR_MAP = [1, null, null, 2, null, 3, 0]; // 숏컷, 스파이크, 모히칸, 장발, 아프로, 묶음머리, 삭발

  // ---------- 불러오기 ----------
  function load() {
    if (!THREE.GLTFLoader || !THREE.SkeletonUtils) return Promise.reject(new Error('loader missing'));
    const loader = new THREE.GLTFLoader();
    // Claude 아티팩트는 .glb를 제공하지 않아 같은 파일을 .glb.wasm 이름으로도 올려 둠 → 실패하면 그쪽으로
    const get1 = (u) => new Promise((res, rej) => loader.load(u, res, undefined, rej));
    const get = (u) => get1(u).catch(() => get1(u + '.wasm'));
    return Promise.all([get('models/player.glb'), get('models/hair.glb')]).then(([b, h]) => {
      base = b; hairs = h;
      prepare();
      api.ready = true;
    });
  }

  // 기본 자세(T자)에서 각 정점이 어느 옷 부위인지 정하고, 옷 부위는 표면을 살짝 부풀림
  // 부위: 0 피부, 1 셔츠(무늬·번호), 2 소매, 3 반바지, 4 스타킹, 5 축구화, 6 밑창, 7 테두리(칼라·소매끝·밑단), 8 스타킹 밴드, 9 장갑(키퍼) / 10 반바지 옆선
  // 키퍼는 소매가 손목까지 → 같은 지오메트리에 "소매 길이" 정보만 따로 둠
  function prepare() {
    let body = null;
    base.scene.traverse((o) => { if (o.isSkinnedMesh && o.name === 'SuperHero_Male') body = o; });
    const src = body.geometry;
    const g = src.clone();
    const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count;
    const bindPos = new Float32Array(n * 3), bindNx = new Float32Array(n);
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    // 지오메트리 좌표 → 기본 자세의 실제 위치 (스키닝 바인드 기준)
    const bindM = body.bindMatrix, toBind = (i, out) => out.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(bindM);
    // 부위별 부풀림 (옷 두께): 셔츠 7mm, 소매 8mm, 반바지 16mm, 스타킹 4mm, 축구화 7mm
    const INFLATE = { 1: 0.011, 2: 0.012, 3: 0.016, 4: 0.004, 5: 0.007, 6: 0.007, 7: 0.01, 8: 0.006, 10: 0.016 };
    for (let i = 0; i < n; i++) {
      toBind(i, p);
      bindPos[i * 3] = p.x; bindPos[i * 3 + 1] = p.y; bindPos[i * 3 + 2] = p.z;
      bindNx[i] = nor.getX(i);
    }
    slimBody(pos, bindPos); // 슈퍼히어로 체형 → 축구 선수 체형 (부위 판정은 원래 위치 기준 그대로)
    for (let i = 0; i < n; i++) {
      p.set(bindPos[i * 3], bindPos[i * 3 + 1], bindPos[i * 3 + 2]);
      const inflate = INFLATE[regionOf(p.x, p.y, p.z, nor.getX(i), false)] || 0;
      if (inflate) {
        q.set(nor.getX(i), nor.getY(i), nor.getZ(i)).normalize().multiplyScalar(inflate);
        pos.setXYZ(i, pos.getX(i) + q.x, pos.getY(i) + q.y, pos.getZ(i) + q.z);
      }
    }
    g.setAttribute('aBind', new THREE.BufferAttribute(bindPos, 3));
    g.setAttribute('aBindNx', new THREE.BufferAttribute(bindNx, 1));
    g.computeBoundingSphere();
    kitGeo = g;

    // 피부 텍스처 평균색
    const img = body.material.map && body.material.map.image;
    skinAvg = new THREE.Color('#c89070');
    try {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const cg = c.getContext('2d'); cg.drawImage(img, 0, 0, 32, 32);
      const d = cg.getImageData(0, 0, 32, 32).data; let rr = 0, gg = 0, bb = 0, k = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i] > 60 && d[i] > d[i + 2]) { rr += d[i]; gg += d[i + 1]; bb += d[i + 2]; k++; } }
      if (k) skinAvg = new THREE.Color(rr / k / 255, gg / k / 255, bb / k / 255);
    } catch (e) { /* 그대로 */ }

    // 입·눈 위치: 얼굴 앞쪽 정점들에서 추정
    let mouth = null, eyeY = 1.69;
    base.scene.traverse((o) => {
      if (o.isSkinnedMesh && o.name === 'Eyes') {
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox.clone().applyMatrix4(o.bindMatrix);
        eyeY = (bb.min.y + bb.max.y) / 2; faceInfo = { eyeY, eyeZ: bb.max.z, eyeX: (bb.max.x - bb.min.x) / 4 };
      }
    });
    let best = -1;
    for (let i = 0; i < n; i++) {
      toBind(i, p);
      if (Math.abs(p.x) < 0.01 && p.y > eyeY - 0.09 && p.y < eyeY - 0.055 && p.z > best) { best = p.z; mouth = p.clone(); }
    }
    faceInfo = Object.assign(faceInfo || {}, { mouth: mouth || new THREE.Vector3(0, eyeY - 0.07, 0.1) });
  }

  // ---------- 체형 다듬기 ----------
  // 원본은 근육이 과장된 슈퍼히어로 체형이라, 팔·다리는 뼈 중심선 쪽으로, 몸통은 옆구리·가슴 두께를 줄임
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const curve = (pts, x) => { // 구간별 선형 보간
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
    return pts[pts.length - 1][1];
  };
  // 팔(T자, x 방향) 굵기 배율: 어깨 이음부는 1에서 시작
  const ARM_K = [[0.17, 1], [0.23, 0.86], [0.28, 0.8], [0.36, 0.8], [0.45, 0.88], [0.5, 0.9], [0.6, 0.86], [0.68, 0.94], [0.72, 1]];
  // 다리(y) 굵기 배율
  const LEG_K = [[0.12, 1], [0.2, 0.95], [0.33, 0.88], [0.45, 0.94], [0.55, 0.95], [0.7, 0.9], [0.82, 0.9], [0.92, 1]];
  function slimBody(pos, bindPos) {
    const n = pos.count;
    // 중심선: 팔은 x 구간별 (y,z) 평균, 다리는 y 구간별 (x,z) 평균, 몸통은 y 구간별 z 평균
    const bins = (key) => ({ key, s: new Map() });
    const add = (B, k, a, b) => { let e = B.s.get(k); if (!e) B.s.set(k, e = [0, 0, 0]); e[0] += a; e[1] += b; e[2]++; };
    const get = (B, k, lo, hi) => { k = Math.max(lo, Math.min(hi, k)); for (let d = 0; d < 6; d++) for (const kk of [k - d, k + d]) { const e = B.s.get(kk); if (e) return [e[0] / e[2], e[1] / e[2]]; } return null; };
    const armB = [bins(), bins()], legB = [bins(), bins()], torsoB = bins();
    for (let i = 0; i < n; i++) {
      const x = bindPos[i * 3], y = bindPos[i * 3 + 1], z = bindPos[i * 3 + 2], ax = Math.abs(x), sd = x > 0 ? 0 : 1;
      if (ax > 0.27 && ax < 0.72 && y > 1.2) add(armB[sd], Math.round(ax * 100), y, z);
      if (y < 0.85 && y > 0.1 && ax > 0.02) add(legB[sd], Math.round(y * 50), x, z);
      if (ax < 0.16 && y > 0.95 && y < 1.58) add(torsoB, Math.round(y * 50), z, 0);
    }
    for (let i = 0; i < n; i++) {
      let x = bindPos[i * 3], y = bindPos[i * 3 + 1], z = bindPos[i * 3 + 2];
      const ax = Math.abs(x), sd = x > 0 ? 0 : 1, sg = x > 0 ? 1 : -1;
      let dx = 0, dy = 0, dz = 0;
      // 어깨 끝(삼각근)을 좁고 낮게: 각진 어깨 → 둥근 어깨
      if (y > 1.28 && ax > 0.14 && ax < 0.4) {
        const w = sstep(0.14, 0.23, ax) * (1 - sstep(0.29, 0.4, ax)) * sstep(1.28, 1.36, y);
        dx += -sg * 0.024 * w;
        if (y > 1.44) dy += -(y - 1.44) * 0.4 * sstep(0.13, 0.2, ax) * (1 - sstep(0.3, 0.38, ax));
      }
      if (ax > 0.17 && y > 1.2 && ax < 0.8) {
        // 팔: 팔 중심선 쪽으로 (y,z) 축소. 어깨 쪽은 서서히
        const c = get(armB[sd], Math.round(ax * 100), 28, 72);
        if (c) { const k = curve(ARM_K, ax); dy += (c[0] - y) * (1 - k); dz += (c[1] - z) * (1 - k); }
      } else if (y < 0.95) {
        // 다리: 가랑이 위쪽은 서서히 (엉덩이가 갈라지지 않게)
        const c = get(legB[sd], Math.round(y * 50), 6, 42);
        if (c) { const k = 1 - (1 - curve(LEG_K, y)) * sstep(0.95, 0.84, y); dx += (c[0] - x) * (1 - k); dz += (c[1] - z) * (1 - k); }
      }
      if (ax < 0.26 && y > 0.98 && y < 1.6) {
        const c = get(torsoB, Math.round(y * 50), 49, 79);
        const cz = c ? c[0] : 0;
        const armW = 1 - sstep(0.17, 0.25, ax); // 겨드랑이 바깥(팔 이음부)은 덜
        // 옆구리(광배근) 폭: 가슴 아래에서 가장 많이 줄임
        const lat = 0.1 * sstep(1.02, 1.2, y) * (1 - sstep(1.36, 1.46, y));
        dx += -x * lat * armW;
        // 가슴·배 앞쪽 두께, 등 두께
        const front = z > cz ? 0.2 *sstep(1.05, 1.25, y) * (1 - sstep(1.45, 1.53, y)) + 0.05 * (1 - sstep(1.05, 1.2, y)) : 0.07 * sstep(1.1, 1.3, y) * (1 - sstep(1.48, 1.56, y));
        dz += (cz - z) * front * (0.4 + 0.6 * armW);
        // 승모근: 목 옆 어깨 윗부분을 낮춤
        const trap = sstep(0.1, 0.14, ax) * (1 - sstep(0.19, 0.25, ax)) * sstep(1.44, 1.5, y); // 머리·목(|x|<0.1)은 건드리지 않음
        dy += -(y - 1.44) * 0.3 * trap;
      }
      if (dx || dy || dz) pos.setXYZ(i, pos.getX(i) + dx, pos.getY(i) + dy, pos.getZ(i) + dz);
    }
  }

  // 기본 자세(T자) 위치로 옷 부위 판정
  // 0 피부, 1 셔츠(무늬·번호), 2 소매, 3 반바지, 4 스타킹, 5 축구화, 6 밑창, 7 테두리(칼라·소매끝·밑단), 8 스타킹 밴드, 9 장갑, 10 반바지 옆선
  function regionOf(x, y, z, nx, longSleeve) {
    const ax = Math.abs(x);
    if (ax > 0.25 && y > 1.2) { // 팔: 어깨 0.21 → 팔꿈치 0.46 → 손목 0.70
      if (longSleeve) return ax < 0.69 ? 2 : ax < 0.705 ? 7 : 9;
      return ax < 0.355 ? 2 : ax < 0.372 ? 7 : 0;
    }
    if (y >= 1.56) return 0;                                       // 머리
    const rad = Math.hypot(x, (z + 0.03) * 1.25);                  // 목 둘레 (타원)
    if (y >= 1.43 && rad < 0.072) return 0;                        // 목
    if (y >= 1.43 && rad < 0.088) return 7;                        // 둥근 칼라
    if (y >= 0.985) return y < 1.0 ? 7 : 1;                        // 셔츠 (+밑단)
    if (y >= 0.69) return y < 0.71 ? 7 : (Math.sign(nx) === Math.sign(x) && Math.abs(nx) > 0.82 && y < 0.95 ? 10 : 3); // 반바지
    if (y >= 0.5) return 0;                                        // 무릎 주변 맨살
    if (y >= 0.47) return 8;                                       // 스타킹 윗단
    if (y >= 0.115) return 4;                                      // 스타킹
    return y < 0.022 ? 6 : 5;                                      // 밑창 / 축구화
  }
  const REGION_GLSL = `
float regionOf(vec3 b, float nx, float longSleeve) {
  float ax = abs(b.x);
  if (ax > 0.25 && b.y > 1.2) {
    if (longSleeve > 0.5) return ax < 0.69 ? 2.0 : (ax < 0.705 ? 7.0 : 9.0);
    return ax < 0.355 ? 2.0 : (ax < 0.372 ? 7.0 : 0.0);
  }
  if (b.y >= 1.56) return 0.0;
  float rad = length(vec2(b.x, (b.z + 0.03) * 1.25));
  if (b.y >= 1.43 && rad < 0.072) return 0.0;
  if (b.y >= 1.43 && rad < 0.088) return 7.0;
  if (b.y >= 0.985) return b.y < 1.0 ? 7.0 : 1.0;
  if (b.y >= 0.69) { if (b.y < 0.71) return 7.0; return (sign(nx) == sign(b.x) && abs(nx) > 0.82 && b.y < 0.95) ? 10.0 : 3.0; }
  if (b.y >= 0.5) return 0.0;
  if (b.y >= 0.47) return 8.0;
  if (b.y >= 0.115) return 4.0;
  return b.y < 0.022 ? 6.0 : 5.0;
}`;

  // ---------- 유니폼·피부를 칠하는 재질 ----------
  function kitMaterial(srcMat, k) {
    const m = srcMat.clone();
    m.roughness = 1;
    const U = {
      uSkinTint: { value: k.skinTint }, uShirt: { value: k.shirtMap }, uSleeve: { value: k.sleeve },
      uShorts: { value: k.shorts }, uStripe: { value: k.stripe }, uSocks: { value: k.socks }, uSockBand: { value: k.sockBand },
      uBoot: { value: k.boot }, uSole: { value: k.sole }, uTrim: { value: k.trim }, uGlove: { value: k.glove },
      uLongSleeve: { value: k.longSleeve ? 1 : 0 },
    };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aBind; attribute float aBindNx;\nvarying vec3 vBind; varying float vBindNx;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = aBind; vBindNx = aBindNx;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vBind; varying float vBindNx;
uniform vec3 uSkinTint; uniform sampler2D uShirt; uniform vec3 uSleeve; uniform vec3 uShorts; uniform vec3 uStripe;
uniform vec3 uSocks; uniform vec3 uSockBand; uniform vec3 uBoot; uniform vec3 uSole; uniform vec3 uTrim; uniform vec3 uGlove; uniform float uLongSleeve;
` + REGION_GLSL)
        .replace('#include <map_fragment>', `#include <map_fragment>
float rg = regionOf(vBind, vBindNx, uLongSleeve);
float cloth = 0.0;
vec2 kitUv = vec2(fract(atan(vBind.x, vBind.z) / 6.2831853 + 1.0), clamp((vBind.y - 0.985) / (1.5 - 0.985), 0.0, 1.0)); // 앞 = 0, 등 = 0.5
if (rg < 0.5) { diffuseColor.rgb *= uSkinTint; }
else {
  cloth = 1.0;
  vec3 c = uSleeve;
  if (rg < 1.5) c = sRGBToLinear(texture2D(uShirt, kitUv)).rgb;
  else if (rg < 2.5) c = uSleeve;
  else if (rg < 3.5) c = uShorts;
  else if (rg < 4.5) c = uSocks;
  else if (rg < 5.5) c = uBoot;
  else if (rg < 6.5) c = uSole;
  else if (rg < 7.5) c = uTrim;
  else if (rg < 8.5) c = uSockBand;
  else if (rg < 9.5) c = uGlove;
  else c = uStripe;
  // 원래 몸 텍스처의 명암(근육 음영)은 아주 약하게만 (옷 위로 복근이 비치지 않게)
  float shade = clamp(dot(texelColor.rgb, vec3(0.299, 0.587, 0.114)) * 1.6, 0.75, 1.05);
  diffuseColor.rgb = c * mix(1.0, shade, 0.12);
}`)
        // 옷 부분은 근육 노멀맵을 쓰지 않음 (매끈한 천)
        .replace('#include <normal_fragment_maps>', 'if (cloth < 0.5) {\n#include <normal_fragment_maps>\n}')
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if (cloth > 0.5) roughnessFactor = (rg > 4.5 && rg < 5.5) ? 0.35 : 0.82;`);
    };
    m.customProgramCacheKey = () => 'pk-kit';
    return m;
  }

  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

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
    root.add(model);
    const bones = {};
    let skeleton = null;
    model.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
      if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; o.userData.sharedGeo = true; }
      if (o.isSkinnedMesh) skeleton = o.skeleton;
    });

    // 피부·유니폼 재질
    const tint = new THREE.Color(skinC.r / skinAvg.r, skinC.g / skinAvg.g, skinC.b / skinAvg.b);
    const shirtTex = PK.Avatar.shirtTexture(uni, opts.number || (keeper ? 1 : 10), keeper);
    shirtTex.generateMipmaps = false; shirtTex.minFilter = THREE.LinearFilter;
    const kit = {
      skinTint: new THREE.Vector3(Math.min(1.6, tint.r), Math.min(1.6, tint.g), Math.min(1.6, tint.b)),
      shirtMap: shirtTex,
      sleeve: lin(keeper ? uni.gk : uni.c1),
      trim: lin(keeper ? shade(uni.gk, -0.35) : uni.c2),
      shorts: lin(keeper ? shade(uni.gk, -0.45) : uni.shorts),
      stripe: lin(keeper ? uni.gk : (same(uni.shorts, uni.c1) ? uni.c2 : uni.c1)),
      socks: lin(keeper ? shade(uni.gk, -0.2) : uni.socks),
      sockBand: lin(keeper ? '#ffffff' : (same(uni.socks, uni.c1) ? uni.c2 : uni.c1)),
      boot: lin(boot.c), sole: lin(boot.s), glove: lin('#f2f2f2'),
      longSleeve: keeper,
    };
    model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      if (o.name === 'SuperHero_Male') {
        o.geometry = kitGeo; // 같은 정점 순서 + 옷 부위 정보
        o.material = kitMaterial(o.material, kit);
      } else if (o.name === 'Eyebrows') {
        o.material = o.material.clone(); o.material.map = null;
        o.material.color = new THREE.Color(shade(hairHex, -0.15)).convertSRGBToLinear();
      } else {
        o.material = o.material.clone();
      }
    });

    // 헤어: 팩의 머리는 이 몸의 뼈대에 다시 묶음, 없는 모양은 기존 머리 모양을 머리 뼈에 붙임
    const hi = HAIR_MAP[cfg.hair];
    const addPackHair = (idx, darken) => {
      let hm = null;
      hairs.scenes[idx].traverse((o) => { if (o.isSkinnedMesh && !hm) hm = o; });
      if (!hm) return;
      const mat = hm.material.clone(); mat.map = null; mat.color = new THREE.Color(shade(hairHex, darken || 0)).convertSRGBToLinear(); mat.roughness = 0.75;
      const mesh = new THREE.SkinnedMesh(hm.geometry, mat);
      mesh.userData.sharedGeo = true; mesh.castShadow = true; mesh.frustumCulled = false;
      model.add(mesh);
      mesh.bind(skeleton, hm.bindMatrix);
    };
    // 장발·묶음머리·스파이크·모히칸은 정수리가 비어 보이지 않게 짧은 바탕 머리(삭발형)를 아래에 깖
    if (hi !== 0 && hi !== 1) addPackHair(0, -0.1);
    if (hi !== null && hi !== undefined) addPackHair(hi);
    else {
      const holder = new THREE.Group();
      holder.userData.hairHolder = true;
      model.add(holder);
      root.userData.hairHolder = holder;
      PK.Avatar.buildHair(holder, cfg.hair, hairHex, O.skin[cfg.skin].c);
      // 이 모델은 선형 색공간으로 칠하므로 기존 머리 색도 맞춰 변환
      holder.traverse((o) => { if (o.material && o.material.color) { o.material = o.material.clone(); o.material.color.convertSRGBToLinear(); } });
    }

    // 표정: 입 그림 + 눈썹 자세 (+ 윙크 눈꺼풀)
    const face = cfg.face;
    const fm = faceInfo.mouth;
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.03), new THREE.MeshStandardMaterial({ map: mouthTexture(face), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    decal.userData.faceDecal = { at: fm.clone().add(new THREE.Vector3(0, 0.002, 0.004)) };
    model.add(decal);
    let lid = null;
    if (face === 5) { // 윙크: 오른쪽 눈 감기
      lid = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.016), new THREE.MeshStandardMaterial({ map: lidTexture(O.skin[cfg.skin].c), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      lid.userData.faceDecal = { at: new THREE.Vector3(-0.033, faceInfo.eyeY + 0.001, faceInfo.eyeZ + 0.004) };
      model.add(lid);
    }
    // 눈썹 표정: 이 선수 눈썹 모양만 복사해서 휘거나 올림 (뼈에 묶인 메시는 위치를 옮겨도 안 움직이므로 정점을 직접 바꿈)
    const brow = { dy: 0, tilt: 0, oneUp: 0 };
    if (face === 1) brow.tilt = 0.12;                       // 진지: 안쪽을 살짝 내림
    if (face === 2) brow.oneUp = 0.004;                     // 자신감: 한쪽만 올림
    if (face === 3) { brow.tilt = 0.32; brow.dy = -0.002; } // 화남: 안쪽을 크게 내림
    if (face === 4) brow.dy = 0.006;                        // 놀람: 둘 다 올림
    if (brow.dy || brow.tilt || brow.oneUp) {
      model.traverse((o) => {
        if (o.name !== 'Eyebrows' || !o.isSkinnedMesh) return;
        const g = o.geometry.clone(), pa = g.attributes.position;
        const bm = o.bindMatrix, bmi = o.bindMatrixInverse, v = new THREE.Vector3();
        for (let i = 0; i < pa.count; i++) {
          v.set(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(bm);
          const side = Math.sign(v.x) || 1, ax = Math.abs(v.x);
          const inner = Math.max(0, 1 - ax / 0.055);                // 1 = 미간 쪽
          v.y += brow.dy - brow.tilt * 0.02 * inner + (side < 0 ? brow.oneUp : 0);
          v.applyMatrix4(bmi); pa.setXYZ(i, v.x, v.y, v.z);
        }
        o.geometry = g; o.userData.sharedGeo = false;
      });
    }

    setupRetarget(root, model, bones, { decal, lid });
  }

  // 입 모양 그림 (표정 6가지)
  function mouthTexture(face) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.lineCap = 'round'; g.strokeStyle = 'rgba(90,30,28,.85)'; g.fillStyle = 'rgba(70,20,20,.85)'; g.lineWidth = 5;
    g.beginPath();
    if (face === 0 || face === 5) { g.moveTo(34, 26); g.quadraticCurveTo(64, 50, 94, 26); g.stroke(); }       // 미소
    else if (face === 1) { g.moveTo(40, 34); g.lineTo(88, 34); g.stroke(); }                                // 진지
    else if (face === 2) { g.moveTo(38, 36); g.quadraticCurveTo(70, 40, 92, 24); g.stroke(); }               // 자신감
    else if (face === 3) { g.moveTo(38, 42); g.quadraticCurveTo(64, 22, 90, 42); g.stroke(); }               // 화남
    else if (face === 4) { g.ellipse(64, 34, 11, 15, 0, 0, Math.PI * 2); g.fill(); }                         // 놀람
    const t = PK.canvasTex(c); return t;
  }
  function lidTexture(skinHex) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = skinHex; g.beginPath(); g.ellipse(32, 16, 27, 12, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2a1a12'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(8, 17); g.quadraticCurveTo(32, 27, 56, 17); g.stroke();
    return PK.canvasTex(c);
  }

  // ---------- 리타깃: 기존 관절의 자세를 모델 뼈에 옮김 ----------
  function setupRetarget(root, model, B, face) {
    const P = root.userData.parts;
    // 1) 팔다리 길이를 기존 관절에 맞춤 (판정 범위와 보이는 몸이 일치하도록)
    const scalePos = (name, k) => { if (B[name]) B[name].position.multiplyScalar(k); };
    ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r'].forEach((n) => scalePos(n, 1.1));
    ['lowerarm_l', 'lowerarm_r'].forEach((n) => scalePos(n, 1.2));
    ['hand_l', 'hand_r'].forEach((n) => scalePos(n, 1.23));

    // 2) 기존 리그를 '모든 회전 0' 기본 자세로 두고 기준을 잡음
    const saved = [];
    root.traverse((o) => { if (o !== root && !o.isBone && o.userData.rigPart) { saved.push([o, o.quaternion.clone(), o.position.clone()]); o.quaternion.identity(); } });
    P.hips.position.set(0, 0.97, 0);
    const rootQ = root.quaternion.clone(), rootP = root.position.clone();
    root.quaternion.identity(); root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);

    // 모델 팔을 아래로 내린 자세(우리 기본 자세)로 맞춤
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
    ['l', 'r'].forEach((s) => { aim(B['upperarm_' + s], B['lowerarm_' + s], down); aim(B['lowerarm_' + s], B['hand_' + s], down); });
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
    // 골반 위치 기준 차이
    const pelvis = B.pelvis;
    const pelvisDelta = wp(pelvis).sub(wp(P.hips)); pelvisDelta.y = -0.02;
    const pelvisParent = pelvis.parent;

    // 얼굴 장식(입·윙크)은 머리 뼈에 붙임
    const head = B.Head;
    [face.decal, face.lid].forEach((d) => {
      if (!d) return;
      const at = d.userData.faceDecal.at; // 기본 자세 기준 위치 (모델 좌표)
      const atWorld = model.localToWorld(at.clone());
      head.attach(d); d.position.copy(head.worldToLocal(atWorld)); d.quaternion.copy(wq(head).invert());
      d.userData.restQ = d.quaternion.clone();
    });
    // 기존 방식 머리 모양: 머리 중심에 맞춰 머리 뼈에 붙임
    if (root.userData.hairHolder) {
      const h = root.userData.hairHolder;
      const center = model.localToWorld(new THREE.Vector3(0, (faceInfo.eyeY || 1.69) + 0.035, -0.012));
      head.attach(h); h.position.copy(head.worldToLocal(center)); h.quaternion.copy(wq(head).invert());
      h.scale.setScalar(0.9);
    }
    // 기존 리그 자세 복원
    saved.forEach(([o, q, p]) => { o.quaternion.copy(q); o.position.copy(p); });
    root.quaternion.copy(rootQ); root.position.copy(rootP);

    const tq = new THREE.Quaternion(), pq = new THREE.Quaternion(), tmp = new THREE.Vector3(), rootInv = new THREE.Quaternion();
    root.userData.sync = function () {
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
    };
    root.userData.sync();
  }

  api.load = load;
  api.attach = attach;
  return api;
})();
