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


  // ---------- 불러오기 ----------
  function load() {
    if (!THREE.GLTFLoader || !THREE.SkeletonUtils) return Promise.reject(new Error('loader missing'));
    const loader = new THREE.GLTFLoader();
    // Claude 아티팩트는 .glb를 제공하지 않아 같은 파일을 .glb.wasm 이름으로도 올려 둠 → 실패하면 그쪽으로
    const get1 = (u) => new Promise((res, rej) => loader.load(u, res, undefined, rej));
    const get = (u) => get1(u).catch(() => get1(u + '.wasm'));
    // 실제 애니메이션(대기·달리기·세리머니): 없어도 게임은 기존 동작으로 진행
    const anims = fetch('models/anims.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return Promise.all([get('models/player.glb'), get('models/hair.glb'), anims]).then(([b, h, a]) => {
      base = b; hairs = h;
      prepare();
      if (a) buildClips(a);
      api.ready = true;
    });
  }

  // ---------- 실제 애니메이션 클립 (Quaternius Universal Animation Library, CC0 · 같은 뼈대) ----------
  let clips = {};
  const clipMeta = {};
  function buildClips(data) {
    let restPelvis = null;
    base.scene.traverse((o) => { if (o.isBone && o.name === 'pelvis' && !restPelvis) restPelvis = o.position.clone(); });
    const tp = data.tposePelvis || [0, 0, 0];
    data.clips.forEach((c) => {
      // 두 가지 형식: 트랙마다 시간(t)이 있는 것(UAL) / 일정 간격(fps·frames)으로 값만 있는 것(Mixamo에서 옮긴 것, 골반 위치는 이미 이 모델 기준)
      const even = c.fps ? Array.from({ length: c.frames }, (_, i) => Math.min(c.duration, i / c.fps)) : null;
      const tracks = c.tracks.map((t) => {
        const st = t.n.endsWith('.quaternion') ? 4 : 3;
        const times = t.t || (t.v.length === st ? [0] : even);
        if (st === 4) return new THREE.QuaternionKeyframeTrack(t.n, times, t.v);
        const v = t.v.slice();
        if (!c.fps) { // 골반 위치: 원본 기본 자세와의 차이만 이 모델 골반에 더함
          for (let i = 0; i < v.length; i += 3) { v[i] += restPelvis.x - tp[0]; v[i + 1] += restPelvis.y - tp[1]; v[i + 2] += restPelvis.z - tp[2]; }
        }
        return new THREE.VectorKeyframeTrack(t.n, times, v);
      });
      clips[c.name] = new THREE.AnimationClip(c.name, c.duration, tracks);
      // 몸 전체 이동 경로(모델 좌표 x,z), 공을 차는 순간 등: 게임이 선수 위치를 옮기는 데 씀
      clipMeta[c.name] = { duration: c.duration, fps: c.fps, path: c.path || null, contact: c.contact, ball: c.ball };
    });
  }
  // 경로 보간: 시간 t 에서 몸 이동량 [x, z]
  function pathAt(name, t) {
    const m = clipMeta[name]; if (!m || !m.path) return [0, 0];
    const n = m.path.length / 2, f = Math.max(0, Math.min(n - 1, t * m.fps)), i = Math.min(n - 2, Math.floor(f)), a = f - i;
    return [m.path[i * 2] * (1 - a) + m.path[i * 2 + 2] * a, m.path[i * 2 + 1] * (1 - a) + m.path[i * 2 + 3] * a];
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
    if (y >= 0.69) return y < 0.71 ? 7 : (Math.sign(nx) === Math.sign(x) && Math.abs(nx) > 0.965 && y < 0.95 ? 10 : 3); // 반바지 (옆선은 가늘게)
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
  if (b.y >= 0.69) { if (b.y < 0.71) return 7.0; return (sign(nx) == sign(b.x) && abs(nx) > 0.965 && b.y < 0.95) ? 10.0 : 3.0; }
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

  // ---------- 헤어: 이 모델의 두피 모양을 그대로 따서 만든 머리 ----------
  //  두피(머리카락 나는 부분)의 삼각형을 몸 메시에서 골라 바깥으로 띄워 만들고, 몸과 같은 뼈 가중치를 써서 머리를 따라 움직임
  const hairGeoCache = {};
  let scalp = null, strandTex = null;
  function getScalp() {
    if (scalp) return scalp;
    const pos = kitGeo.attributes.position, nor = kitGeo.attributes.normal, n = pos.count, eyeY = faceInfo.eyeY;
    const C = new THREE.Vector3(); let k = 0;
    for (let i = 0; i < n; i++) { const y = pos.getY(i), x = pos.getX(i); if (y > eyeY - 0.1 && Math.abs(x) < 0.12) { C.x += x; C.y += y; C.z += pos.getZ(i); k++; } }
    C.multiplyScalar(1 / k);
    // 머리선 높이: 앞이마는 눈썹 위, 옆은 귀 위, 뒤는 목덜미까지
    const HL = [[0, 0.052], [0.22, 0.05], [0.4, 0.03], [0.5, 0.018], [0.62, 0.0], [0.78, -0.05], [1, -0.085]];
    const hairline = (x, z) => {
      const a = Math.abs(Math.atan2(x - C.x, z - C.z)) / Math.PI;
      for (let i = 1; i < HL.length; i++) if (a <= HL[i][0]) { const [a0, h0] = HL[i - 1], [a1, h1] = HL[i]; return eyeY + h0 + (h1 - h0) * (a - a0) / (a1 - a0); }
      return eyeY - 0.085;
    };
    const inHair = new Uint8Array(n);
    for (let i = 0; i < n; i++) inHair[i] = pos.getY(i) > hairline(pos.getX(i), pos.getZ(i)) && pos.getY(i) > eyeY - 0.13 && Math.abs(pos.getX(i)) < 0.13 ? 1 : 0;
    const idx = kitGeo.index.array, tris = [];
    for (let t = 0; t < idx.length; t += 3) if (inHair[idx[t]] && inHair[idx[t + 1]] && inHair[idx[t + 2]]) tris.push(idx[t], idx[t + 1], idx[t + 2]);
    // 머리 둘레 각도 phi(0 = 앞, + = 선수 왼쪽)에서 머리선보다 dy 위에 있는 머리 표면 점 (정점 번호·위치·법선)
    const headIdx = [];
    for (let i = 0; i < n; i++) { const y = pos.getY(i); if (y > eyeY - 0.16 && Math.hypot(pos.getX(i) - C.x, pos.getZ(i) - C.z) < 0.14) headIdx.push(i); }
    const hairOnRing = (phi, dy) => {
      const ph = Math.atan2(Math.sin(phi), Math.cos(phi));
      const yT = hairline(C.x + Math.sin(ph), C.z + Math.cos(ph)) + dy; // hairline 은 머리 중심 기준 방향만 봄
      let best = -1, bd = 1e9;
      for (const i of headIdx) {
        const x = pos.getX(i) - C.x, z = pos.getZ(i) - C.z;
        let da = Math.atan2(x, z) - ph; da = Math.atan2(Math.sin(da), Math.cos(da));
        const d = (da * 0.12) * (da * 0.12) + (pos.getY(i) - yT) * (pos.getY(i) - yT);
        if (d < bd) { bd = d; best = i; }
      }
      return { i: best, p: new THREE.Vector3(pos.getX(best), pos.getY(best), pos.getZ(best)), n: new THREE.Vector3(nor.getX(best), nor.getY(best), nor.getZ(best)).normalize() };
    };
    scalp = { C, eyeY, tris, pos, nor, hairline, hairOnRing };
    return scalp;
  }
  // 머리카락 결 텍스처 (흰색 바탕에 가는 결 → 재질 색과 곱해짐)
  function getStrandTex() {
    if (strandTex) return strandTex;
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * 256, l = 0.55 + Math.random() * 0.6;
      g.strokeStyle = `rgba(${l > 1 ? 255 : 0},${l > 1 ? 255 : 0},${l > 1 ? 255 : 0},${Math.abs(l - 1) * 0.55})`;
      g.lineWidth = 0.6 + Math.random() * 1.2;
      g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + (Math.random() - 0.5) * 18, 90, x + (Math.random() - 0.5) * 18, 170, x + (Math.random() - 0.5) * 10, 256); g.stroke();
    }
    strandTex = PK.canvasTex(c); strandTex.wrapS = strandTex.wrapT = THREE.RepeatWrapping;
    return strandTex;
  }
  // 곱슬 텍스처 (아프로): 작은 고리 무늬
  let curlTex = null;
  function getCurlTex() {
    if (curlTex) return curlTex;
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#c4c4c4'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) {
      const x = Math.random() * 256, y = Math.random() * 256, r = 2 + Math.random() * 4, l = Math.random();
      g.strokeStyle = l > 0.5 ? `rgba(255,255,255,${(l - 0.5) * 0.7})` : `rgba(0,0,0,${(0.5 - l) * 0.8})`;
      g.lineWidth = 1 + Math.random(); g.beginPath(); g.arc(x, y, r, Math.random() * 6, Math.random() * 6 + 3.5); g.stroke();
    }
    curlTex = PK.canvasTex(c); curlTex.wrapS = curlTex.wrapT = THREE.RepeatWrapping;
    return curlTex;
  }
  // 정점·뼈 가중치를 모아 스킨 메시용 지오메트리를 만드는 도우미
  function HairBuilder() {
    const S = getScalp(), sk = kitGeo.attributes.skinIndex, sw = kitGeo.attributes.skinWeight;
    const P = [], UV = [], SI = [], SW = [], I = [];
    const uvOf = (p) => [Math.atan2(p.x - S.C.x, p.z - S.C.z) / (2 * Math.PI) * 6, (p.y - S.eyeY) * 6];
    // 뼈 번호·가중치는 섞여 저장(interleaved)될 수 있으므로 getX~getW 로 읽음 (getX 등은 정수 압축도 0~1 로 풀어 줌)
    const add = (p, src) => {
      P.push(p.x, p.y, p.z); const u = uvOf(p); UV.push(u[0], u[1]);
      SI.push(sk.getX(src), sk.getY(src), sk.getZ(src), sk.getW(src));
      SW.push(sw.getX(src), sw.getY(src), sw.getZ(src), sw.getW(src));
      return P.length / 3 - 1;
    };
    const vp = (i) => new THREE.Vector3(S.pos.getX(i), S.pos.getY(i), S.pos.getZ(i));
    const vn = (i) => new THREE.Vector3(S.nor.getX(i), S.nor.getY(i), S.nor.getZ(i)).normalize();
    return {
      S, add, vp, vn, tri: (a, b, c) => I.push(a, b, c),
      // 두피를 offset(점, 법선, 정점번호) 만큼 띄운 껍데기. keep(정점)으로 일부만, rim=true 면 가장자리를 두피까지 막음
      //  subdiv: 삼각형을 잘게 나눔(두꺼운 머리가 각져 보이지 않게), smooth: 바깥 면을 부드럽게 다듬는 횟수
      shell(offset, keep, rim, subdiv, smooth) {
        // 1) 두피 정점·삼각형 고르기
        // 같은 자리에 겹쳐 있는 정점(몸 메시 가운데 이음매 등)은 하나로 합침 → 다듬을 때 틈이 벌어지지 않게
        const V = [], local = new Map(), byPos = new Map();
        const vid = (i) => {
          if (local.has(i)) return local.get(i);
          const p = vp(i), key = Math.round(p.x * 2000) + ',' + Math.round(p.y * 2000) + ',' + Math.round(p.z * 2000);
          let id = byPos.get(key);
          if (id === undefined) { id = V.length; byPos.set(key, id); V.push({ p, n: vn(i), src: i }); }
          else V[id].n.add(vn(i)).normalize();
          local.set(i, id); return id;
        };
        let T = [];
        for (let t = 0; t < S.tris.length; t += 3) {
          const a = S.tris[t], b = S.tris[t + 1], c = S.tris[t + 2];
          if (keep && !(keep(a) && keep(b) && keep(c))) continue;
          T.push(vid(a), vid(b), vid(c));
        }
        // 2) 잘게 나누기 (각 변의 가운데에 점)
        for (let s = 0; s < (subdiv || 0); s++) {
          const mid = new Map(), NT = [];
          const m = (u, v) => { const key = u < v ? u + '_' + v : v + '_' + u; if (!mid.has(key)) { mid.set(key, V.length); V.push({ p: V[u].p.clone().add(V[v].p).multiplyScalar(0.5), n: V[u].n.clone().add(V[v].n).normalize(), src: V[u].src }); } return mid.get(key); };
          for (let t = 0; t < T.length; t += 3) { const a = T[t], b = T[t + 1], c = T[t + 2], ab = m(a, b), bc = m(b, c), ca = m(c, a); NT.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca); }
          T = NT;
        }
        // 3) 바깥으로 띄우기 + 다듬기
        const out = V.map((v) => v.p.clone().addScaledVector(v.n, offset(v.p, v.n, v.src)));
        const edges = new Map(), nb = V.map(() => new Set());
        for (let t = 0; t < T.length; t += 3) {
          [[T[t], T[t + 1]], [T[t + 1], T[t + 2]], [T[t + 2], T[t]]].forEach(([u, v]) => { const key = u < v ? u + '_' + v : v + '_' + u; edges.set(key, (edges.get(key) || 0) + 1); nb[u].add(v); nb[v].add(u); });
        }
        for (let it = 0; it < (smooth || 0); it++) {
          const nxt = out.map((p, i) => { if (!nb[i].size) return p; const avg = new THREE.Vector3(); nb[i].forEach((j) => avg.add(out[j])); avg.multiplyScalar(1 / nb[i].size); return p.clone().lerp(avg, 0.5); });
          nxt.forEach((p, i) => out[i].copy(p));
        }
        const oi = out.map((p, i) => add(p, V[i].src));
        for (let t = 0; t < T.length; t += 3) I.push(oi[T[t]], oi[T[t + 1]], oi[T[t + 2]]);
        if (rim) {
          const ii = new Map();
          const getIn = (i) => { if (!ii.has(i)) ii.set(i, add(V[i].p.clone().addScaledVector(V[i].n, 0.002), V[i].src)); return ii.get(i); };
          for (let t = 0; t < T.length; t += 3) {
            for (let e = 0; e < 3; e++) {
              const u = T[t + e], v = T[t + (e + 1) % 3], key = u < v ? u + '_' + v : v + '_' + u;
              if (edges.get(key) === 1) { I.push(oi[v], oi[u], getIn(u), oi[v], getIn(u), getIn(v)); }
            }
          }
        }
        return [...local.keys()];
      },
      // 뾰족한 머리카락 다발 (밑동 p, 방향 d, 길이 len, 굵기 r, 납작함 flat)
      spike(i, p, d, len, r, flat) {
        d = d.clone().normalize();
        const t1 = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
        const t2 = new THREE.Vector3().crossVectors(d, t1).normalize();
        const seg = 6, ring = [];
        for (let s = 0; s < seg; s++) { const a = (s / seg) * Math.PI * 2; ring.push(add(p.clone().addScaledVector(t1, Math.cos(a) * r * (flat || 1)).addScaledVector(t2, Math.sin(a) * r).addScaledVector(d, -0.004), i)); }
        const mid = add(p.clone().addScaledVector(d, len * 0.45).addScaledVector(t2, r * 0.15), i);
        const tip = add(p.clone().addScaledVector(d, len), i);
        for (let s = 0; s < seg; s++) { const a = ring[s], b = ring[(s + 1) % seg]; I.push(a, b, mid, mid, b, tip); }
      },
      build() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
        g.setIndex(I); g.computeVertexNormals(); g.computeBoundingSphere();
        return g;
      },
    };
  }
  // 간단한 결정적 난수 (선수마다 같은 모양)
  const rnd = (s) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  function hairGeometry(style) {
    if (hairGeoCache[style]) return hairGeoCache[style];
    const H = HairBuilder(), S = H.S, up = new THREE.Vector3(0, 1, 0);
    if (style === 'spikes') {
      const ids = H.shell(() => 0.011);
      ids.forEach((i, k) => {
        const p = H.vp(i); if (p.y < S.eyeY + 0.035 || rnd(i) > 0.42) return;
        const n = H.vn(i), front = Math.max(0, (p.z - S.C.z) / 0.1);
        const d = n.clone().addScaledVector(up, 0.55).add(new THREE.Vector3(0, 0, 0.25 * front - 0.15)).add(new THREE.Vector3((rnd(i + 3) - 0.5) * 0.4, 0, (rnd(i + 7) - 0.5) * 0.3));
        H.spike(i, p.clone().addScaledVector(n, 0.008), d, 0.04 + rnd(i + 1) * 0.035 + front * 0.015, 0.013 + rnd(i + 2) * 0.005, 1.25);
      });
    } else if (style === 'mohawk') {
      H.shell(() => 0.01, (i) => Math.abs(S.pos.getX(i) - S.C.x) < 0.03);
      const pts = [];
      for (let t = 0; t < S.tris.length; t++) { const i = S.tris[t]; if (Math.abs(S.pos.getX(i) - S.C.x) < 0.016 && !pts.includes(i)) pts.push(i); }
      pts.forEach((i) => {
        const p = H.vp(i), n = H.vn(i), back = Math.max(0, (S.C.z - p.z) / 0.1);
        const d = n.clone().addScaledVector(up, 0.4).add(new THREE.Vector3(0, 0, -0.35 - back * 0.2));
        H.spike(i, p.clone().addScaledVector(n, 0.006), d, 0.06 + rnd(i) * 0.03 - back * 0.015, 0.02, 0.45);
      });
    } else if (style === 'long') {
      // 깔끔한 머리선의 덮개 + 귀를 덮고 어깨 바로 위까지 내려오는 머리 (얼굴 앞은 비움)
      const capT = (p) => 0.012 + 0.01 * THREE.MathUtils.clamp((p.y - S.eyeY) / 0.1, 0, 1);
      H.shell(capT, null, false, 1, 1);
      const R = 9, COLS = 40;
      const grid = [];
      for (let c = 0; c <= COLS; c++) {
        const phi = Math.PI * (0.3 + 1.4 * (c / COLS)); // 0 = 앞 → 뒤로 돌아 반대쪽 옆까지
        const a = Math.abs(((phi + Math.PI) % (2 * Math.PI)) - Math.PI) / Math.PI; // 0 앞 ~ 1 뒤
        const top = S.hairOnRing(phi, 0.025);
        const len = 0.11 + 0.12 * THREE.MathUtils.smoothstep(a, 0.3, 0.85) + (rnd(c) - 0.5) * 0.025;
        const radial = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi));
        const col = [];
        for (let r = 0; r <= R; r++) {
          const f = r / R;
          // 덮개 바로 바깥에서 시작해 귀를 덮으며 살짝 부풀었다가 끝으로 갈수록 몸 쪽으로 떨어짐
          const p = top.p.clone().addScaledVector(top.n, capT(top.p) - 0.002).add(new THREE.Vector3(0, -len * f, 0)).addScaledVector(radial, 0.03 * Math.sin(f * Math.PI * 0.7) + 0.012 * f);
          col.push(H.add(p, top.i));
        }
        grid.push(col);
      }
      for (let c = 0; c < COLS; c++) for (let r = 0; r < R; r++) { const a = grid[c][r], b = grid[c + 1][r], d = grid[c][r + 1], e = grid[c + 1][r + 1]; H.tri(a, d, b); H.tri(b, d, e); }
    } else if (style === 'bun') {
      // 뒤로 넘겨 묶은 머리 + 정수리 뒤쪽의 똥머리 하나
      H.shell((p) => 0.011 + 0.005 * THREE.MathUtils.clamp((p.y - S.eyeY) / 0.1, 0, 1), null, false, 1, 1);
      const ring = S.hairOnRing(Math.PI, 0.13); // 뒤통수 위쪽
      const anchor = ring.p.clone().addScaledVector(ring.n, 0.045).add(new THREE.Vector3(0, 0.012, 0));
      const ico = new THREE.IcosahedronGeometry(0.042, 2), ip = ico.attributes.position, map = new Map(), vtx = [];
      for (let i = 0; i < ip.count; i++) {
        const v = new THREE.Vector3(ip.getX(i), ip.getY(i), ip.getZ(i));
        const key = v.toArray().map((x) => x.toFixed(4)).join(',');
        if (!map.has(key)) { const d = v.clone().normalize(); const bump = 1 + 0.08 * Math.sin(d.x * 9 + d.y * 7) * Math.sin(d.z * 8); map.set(key, H.add(anchor.clone().add(new THREE.Vector3(v.x * bump, v.y * 0.82 * bump, v.z * bump)), ring.i)); }
        vtx.push(map.get(key));
      }
      for (let t = 0; t < vtx.length; t += 3) H.tri(vtx[t], vtx[t + 1], vtx[t + 2]);
    } else if (style === 'afro') {
      const noise = (n) => 0.006 * (Math.sin(n.x * 23 + n.y * 7) + Math.sin(n.y * 19 - n.z * 13) + Math.sin(n.z * 17 + n.x * 11));
      // 둥글고 풍성하게: 정수리·옆·뒤로 크게 부풀리고, 이마 쪽은 덜
      H.shell((p, n) => {
        const top = THREE.MathUtils.clamp((p.y - S.eyeY + 0.02) / 0.1, 0, 1), front = THREE.MathUtils.clamp((p.z - S.C.z) / 0.1, 0, 1);
        // 머리선 가까이는 두피에 붙도록 얇게 → 앞이마 쪽 가장자리가 벽처럼 보이지 않고 둥글게 말려 들어감
        const e = THREE.MathUtils.smoothstep(p.y - S.hairline(p.x, p.z), 0, 0.045 + 0.03 * front);
        return 0.004 + e * (0.045 + 0.06 * top * (1 - front * 0.4) + 0.012 * (1 - front) + noise(n) * 1.4);
      }, null, true, 2, 3);
    }
    hairGeoCache[style] = H.build();
    return hairGeoCache[style];
  }
  // 팩 머리(장발·묶음머리)에서 얼굴 앞으로 내려오는 앞머리를 지운 사본 + 결 텍스처용 좌표
  function packHairGeometry(idx, hm) {
    const key = 'pack' + idx;
    if (hairGeoCache[key]) return hairGeoCache[key];
    const S = getScalp(), g = hm.geometry.clone(), pos = g.attributes.position;
    const bm = hm.bindMatrix, v = new THREE.Vector3();
    const bad = new Uint8Array(pos.count), uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(bm);
      bad[i] = v.z > S.C.z + 0.035 && v.y < S.eyeY + 0.04 ? 1 : 0; // 이마 아래·얼굴 앞
      uv[i * 2] = Math.atan2(v.x - S.C.x, v.z - S.C.z) / (2 * Math.PI) * 6; uv[i * 2 + 1] = (v.y - S.eyeY) * 6;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (g.index) { const a = g.index.array, keep = []; for (let t = 0; t < a.length; t += 3) if (!bad[a[t]] && !bad[a[t + 1]] && !bad[a[t + 2]]) keep.push(a[t], a[t + 1], a[t + 2]); g.setIndex(keep); }
    hairGeoCache[key] = g;
    return g;
  }

  // ---------- 유니폼 상의 텍스처 (이 모델의 몸통 둘레 좌표에 맞춘 그림) ----------
  //  가로(u): 0 = 가슴 가운데 → 0.25 = 선수 왼쪽 옆구리 → 0.5 = 등 가운데 → 0.75 = 오른쪽 옆구리
  //  세로: 위 = 어깨선(높이 1.5m), 아래 = 밑단(0.985m)  → 1px ≈ 1mm
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
        g.beginPath(); g.moveTo(U(-0.24), V(0.86)); g.lineTo(U(0), V(0.6)); g.lineTo(U(0.24), V(0.86));
        g.lineTo(U(0.24), V(0.74)); g.lineTo(U(0), V(0.48)); g.lineTo(U(-0.24), V(0.74)); g.closePath(); g.fill();
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
    // 어깨 파이핑 (목에서 어깨 끝으로 가는 가는 선)
    g.fillStyle = c2; g.globalAlpha = 0.9;
    [0.25, 0.75].forEach((u) => g.fillRect(U(u) - 5, 0, 10, V(0.86)));
    g.globalAlpha = 1;
    // 원단 결 (아주 은은한 세로 니트 결)
    g.globalAlpha = 0.045; g.fillStyle = '#000';
    for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
    g.globalAlpha = 1;

    const numFill = lum(c1) > 0.55 ? '#141414' : '#ffffff';
    const numEdge = lum(c1) > 0.55 ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.35)';
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
    crest(U(0.085), V(0.7), 1.25);
    // 오른쪽 가슴: 단순한 제조사 마크 (사선 두 줄)
    g.fillStyle = numFill;
    front(() => { g.save(); g.translate(U(-0.085), V(0.7)); g.rotate(-0.5); g.fillRect(-14, -9, 28, 6); g.fillRect(-14, 3, 28, 6); g.restore(); });
    // 앞 번호 (가슴 가운데 아래, 작게)
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 64px "Arial Black", "Noto Sans KR", Arial, sans-serif';
    g.lineWidth = 6; g.strokeStyle = numEdge; g.fillStyle = numFill;
    front(() => { g.strokeText(String(number), 0, V(0.5)); g.fillText(String(number), 0, V(0.5)); });
    // 등번호 (등 위쪽, 크게)
    g.font = '900 210px "Arial Black", "Noto Sans KR", Arial, sans-serif';
    g.lineWidth = 10;
    g.strokeText(String(number), U(0.5), V(0.55)); g.fillText(String(number), U(0.5), V(0.55));
    const tex = PK.canvasTex(cv);
    tex.anisotropy = 8;
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
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
    const shirtTex = kitShirtTexture(uni, opts.number || (keeper ? 1 : 10), keeper);
    shirtTex.generateMipmaps = false; shirtTex.minFilter = THREE.LinearFilter; // 가슴 가운데 이음매에 선이 생기지 않게
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
    // 헤어: 숏컷·장발·묶음머리·삭발은 팩 머리(앞머리 정리), 스파이크·모히칸·아프로는 이 머리 모양에 맞춰 만든 머리
    const hairMat = (darken, rough, curly) => {
      const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(shade(hairHex, darken || 0)).convertSRGBToLinear(), map: curly ? getCurlTex() : getStrandTex(), roughness: rough || 0.62, metalness: 0 });
      m.skinning = true; return m;
    };
    const addPackHair = (idx, darken) => {
      let hm = null;
      hairs.scenes[idx].traverse((o) => { if (o.isSkinnedMesh && !hm) hm = o; });
      if (!hm) return;
      const mesh = new THREE.SkinnedMesh(packHairGeometry(idx, hm), hairMat(darken));
      mesh.userData.sharedGeo = true; mesh.castShadow = true; mesh.frustumCulled = false;
      model.add(mesh);
      mesh.bind(skeleton, hm.bindMatrix);
    };
    const bodyMesh = (() => { let b = null; model.traverse((o) => { if (o.isSkinnedMesh && o.name === 'SuperHero_Male') b = o; }); return b; })();
    const addMadeHair = (style, darken, rough) => {
      const m = hairMat(darken, rough, style === 'afro');
      if (style === 'long') m.side = THREE.DoubleSide; // 늘어진 머리는 한 겹이라 안쪽도 보이게
      const mesh = new THREE.SkinnedMesh(hairGeometry(style), m);
      mesh.userData.sharedGeo = true; mesh.castShadow = true; mesh.frustumCulled = false;
      model.add(mesh);
      mesh.bind(skeleton, bodyMesh.bindMatrix);
    };
    const STYLE = ['short', 'spikes', 'mohawk', 'long', 'afro', 'bun', 'buzz'][cfg.hair] || 'short';
    if (STYLE === 'short') addPackHair(1);
    else if (STYLE === 'buzz') addPackHair(0);
    else if (STYLE === 'long') addMadeHair('long');
    else if (STYLE === 'bun') addMadeHair('bun');
    else if (STYLE === 'spikes') { addPackHair(0, -0.15); addMadeHair('spikes'); }
    else if (STYLE === 'mohawk') { addPackHair(0, -0.35); addMadeHair('mohawk'); } // 옆은 짧게 민 듯 어둡게
    else if (STYLE === 'afro') addMadeHair('afro', 0, 0.85);

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
    root.userData.bones = bones; // 보이는 몸의 뼈 (실제 다이빙 동작 중에는 이 뼈로 막기 판정)
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
      const target = A.want ? 1 : 0;
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
      applyAnim();
      // 게임이 동작 위에 덧붙이는 손질 (예: 다이빙 중 두 손을 모음)
      if (root.userData.postAnim) { model.updateMatrixWorld(true); root.userData.postAnim(B); }
    };
    root.userData.sync();
  }

  api.load = load;
  api.attach = attach;
  api.clips = () => clips;
  api.meta = (name) => clipMeta[name] || null;
  api.pathAt = pathAt;
  api.addClips = (data) => buildClips(data);
  return api;
})();
