// 효과음은 모두 WebAudio로 합성합니다 (외부 파일 없음)
window.PK = window.PK || {};

PK.Audio = (function () {
  let ctx = null, master = null, crowdBus = null, ambGain = null, noiseBuf = null, brownBuf = null, reverb = null;
  let ambTimer = null, ambLevel = 0;

  // 경기장 잔향: 지수적으로 사라지는 잡음으로 만든 임펄스 응답 (스테레오)
  function makeIR(c, sec) {
    const n = Math.floor(c.sampleRate * sec), ir = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    return ir;
  }
  // 브라운 잡음: 고음이 약해서 귀에 거슬리지 않는 '웅성' 바탕
  function makeBrown(c, sec) {
    const n = Math.floor(c.sampleRate * sec), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    return b;
  }

  // 오디오 그래프 구성 (테스트에서는 오프라인 컨텍스트로도 만듦)
  function build(c) {
    ctx = c;
    const comp = c.createDynamicsCompressor(); // 큰 함성이 터질 때 소리가 찢어지지 않게
    comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.25;
    comp.connect(c.destination);
    master = c.createGain(); master.gain.value = 0.6; master.connect(comp);

    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    brownBuf = makeBrown(c, 4);

    // 웅성거림 버스 (함성·박수는 미리 녹음해 둔 버퍼로 재생하므로 실시간 잔향 처리는 두지 않음 → 끊김 방지)
    crowdBus = c.createGain(); crowdBus.gain.value = 1;
    const tame = c.createBiquadFilter(); tame.type = 'lowpass'; tame.frequency.value = 3200; tame.Q.value = 0.5;
    crowdBus.connect(tame); tame.connect(master);

    // 관중 웅성거림 (지속): 브라운 잡음을 사람 목소리 대역 두 군데로 나눠 섞음
    const src = c.createBufferSource(); src.buffer = brownBuf; src.loop = true;
    const b1 = c.createBiquadFilter(); b1.type = 'bandpass'; b1.frequency.value = 380; b1.Q.value = 0.9;
    const b2 = c.createBiquadFilter(); b2.type = 'bandpass'; b2.frequency.value = 950; b2.Q.value = 1.2;
    const g2 = c.createGain(); g2.gain.value = 0.55;
    ambGain = c.createGain(); ambGain.gain.value = 0;
    src.connect(b1); b1.connect(ambGain);
    src.connect(b2); b2.connect(g2); g2.connect(ambGain);
    ambGain.connect(crowdBus);
    src.start();
  }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    let c;
    try { c = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    build(c);
    prerenderAll(); // 함성·탄식을 백그라운드에서 미리 만들어 둠
    // 웅성거림이 일정하지 않고 파도처럼 오르내리게
    ambTimer = setInterval(() => {
      if (!ctx || !ambGain) return;
      const t = ctx.currentTime;
      ambGain.gain.setTargetAtTime(ambLevel * (0.8 + Math.random() * 0.4), t, 0.6);
    }, 700);
  }

  function noise(dur, freq, q, vol, type) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  function tone(freq, dur, vol, type, slideTo) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // 관중 웅성거림 크기 (0 ~ 1)
  function crowd(level, time, at) {
    if (!ctx) return;
    const t = at || ctx.currentTime;
    ambLevel = level * 0.5;
    ambGain.gain.cancelScheduledValues(t);
    ambGain.gain.setTargetAtTime(ambLevel, t, time || 0.4);
  }

  // ---------- 함성·탄식 미리 만들기 ----------
  // 실시간으로 목소리 수십 개를 동시에 만들면 기기에 따라 소리가 끊기며 '지직' 깨짐 → 오프라인으로 한 번 그려 버퍼로 재생
  const CROWD = {
    cheer: { sec: 4.8, voices: { n: 34, f0: [150, 340], glide: 1.3, glideEnd: 1.05, attack: 0.18, hold: 1.1, release: 2.2, vol: 1.6,
      formants: [[750, 5, 1], [1200, 6, 0.55], [2500, 7, 0.18]], vowelTo: 0.82, breath: 0.3 }, clap: [3.2, 0.6, 0.35] },
    groan: { sec: 3.6, voices: { n: 26, f0: [130, 260], glide: 0.78, glideEnd: 0.7, attack: 0.25, hold: 0.55, release: 1.5, vol: 1.15,
      formants: [[500, 5, 1], [880, 6, 0.5], [2300, 7, 0.1]], breath: 0.22, lp: 2000 }, clap: [1.6, 0.18, 0.6] },
  };
  const ready = { cheer: [], groan: [] };

  // 여러 사람이 함께 내는 소리: 목소리 높이가 제각각인 성대 진동(톱니파)을 모음 모양 필터(포먼트)로 다듬음
  //  glide > 1 이면 음이 올라가며 터지는 환호, < 1 이면 내려가는 탄식
  function voicesOn(c, bus, brown, o) {
    const t0 = 0.02;
    const out = c.createGain(); out.gain.value = o.vol;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lp || 2600; lp.Q.value = 0.4;
    lp.connect(out); out.connect(bus);
    const bank = o.formants.map(([f, q, g]) => {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const gg = c.createGain(); gg.gain.value = g;
      bp.connect(gg); gg.connect(lp);
      if (o.vowelTo) bp.frequency.setTargetAtTime(f * o.vowelTo, t0 + o.attack, o.hold * 0.6); // 모음이 바뀜 (아→오 등)
      return bp;
    });
    const end = t0 + o.attack + o.hold + o.release;
    for (let i = 0; i < o.n; i++) {
      const osc = c.createOscillator(); osc.type = 'sawtooth';
      const f0 = o.f0[0] + Math.random() * (o.f0[1] - o.f0[0]);
      const st = t0 + Math.random() * o.attack * 0.8; // 사람마다 조금씩 늦게 시작
      osc.frequency.setValueAtTime(f0, st);
      osc.frequency.exponentialRampToValueAtTime(f0 * o.glide * (0.92 + Math.random() * 0.16), st + o.attack + o.hold * 0.5);
      osc.frequency.exponentialRampToValueAtTime(f0 * (o.glideEnd || o.glide * 0.85), end);
      const vib = c.createOscillator(); vib.frequency.value = 4 + Math.random() * 3; // 떨림
      const vg = c.createGain(); vg.gain.value = f0 * 0.012;
      vib.connect(vg); vg.connect(osc.frequency);
      const g = c.createGain();
      const peak = 1 / o.n * (0.6 + Math.random() * 0.8);
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(peak, st + o.attack * (0.6 + Math.random() * 0.6));
      g.gain.setValueAtTime(peak, st + o.attack + o.hold * (0.6 + Math.random() * 0.5));
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(g); bank.forEach((bp) => g.connect(bp));
      osc.start(st); vib.start(st); osc.stop(end + 0.05); vib.stop(end + 0.05);
    }
    // 숨소리 섞인 목소리 질감 (부드러운 잡음을 같은 모음 필터에)
    const br = c.createBufferSource(); br.buffer = brown;
    const bg = c.createGain();
    bg.gain.setValueAtTime(0.0001, t0);
    bg.gain.exponentialRampToValueAtTime(o.breath || 0.25, t0 + o.attack);
    bg.gain.setValueAtTime(o.breath || 0.25, t0 + o.attack + o.hold);
    bg.gain.exponentialRampToValueAtTime(0.0001, end);
    br.connect(bg); bank.forEach((bp) => bg.connect(bp));
    br.start(t0, Math.random() * 2); br.stop(end + 0.05);
  }

  // 박수: 짧은 손뼉 소리를 무작위 시점에 그린 버퍼
  function applauseOn(c, bus, dur, vol, delay) {
    const sr = c.sampleRate, n = Math.floor(sr * dur), b = c.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      // 손뼉 하나하나가 갑자기 '틱' 하고 시작하면 겹쳤을 때 지직거리는 잡음처럼 들림
      //  → 수를 줄이고, 아주 짧게 페이드 인, 두 번 거른 둥근 소리, 멀리서 들리듯 작게
      const claps = Math.floor(dur * 70);
      const atk = Math.floor(sr * 0.0025);
      for (let k = 0; k < claps; k++) {
        const pos = Math.floor(Math.pow(Math.random(), 1.4) * n); // 처음에 많고 점점 줄어듦
        const len = Math.floor(sr * (0.018 + Math.random() * 0.014));
        const amp = 0.2 + Math.random() * 0.3;
        let l1 = 0, l2 = 0;
        for (let i = 0; i < len && pos + i < n; i++) {
          l1 = l1 * 0.6 + (Math.random() * 2 - 1) * 0.4;
          l2 = l2 * 0.6 + l1 * 0.4;
          const env = Math.min(1, i / atk) * Math.exp(-(i - atk) / (len * 0.3));
          d[pos + i] += l2 * amp * env;
        }
      }
      for (let i = 0; i < n; i++) d[i] *= Math.min(1, (n - i) / (sr * 0.8)); // 끝을 부드럽게
    }
    const src = c.createBufferSource(); src.buffer = b;
    const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1100; hp.Q.value = 0.6;
    const soft = c.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 2300; soft.Q.value = 0.3; // 날카로운 고음 제거
    const g = c.createGain(); g.gain.value = vol;
    src.connect(hp); hp.connect(soft); soft.connect(g); g.connect(bus);
    src.start(delay || 0);
  }

  // 함성/탄식 하나를 오프라인으로 그림: 목소리 + 박수 → 고음 정리 → 경기장 잔향 → 버퍼
  async function renderCrowd(kind) {
    const def = CROWD[kind], sr = 44100;
    const oc = new OfflineAudioContext(2, Math.floor(sr * def.sec), sr);
    const bus = oc.createGain();
    const tame = oc.createBiquadFilter(); tame.type = 'lowpass'; tame.frequency.value = 3200; tame.Q.value = 0.5;
    const rev = oc.createConvolver(); rev.buffer = makeIR(oc, 2.2);
    const wet = oc.createGain(); wet.gain.value = 0.45;
    bus.connect(tame); tame.connect(oc.destination); tame.connect(rev); rev.connect(wet); wet.connect(oc.destination);
    voicesOn(oc, bus, makeBrown(oc, 4), def.voices);
    applauseOn(oc, bus, def.clap[0], def.clap[1], def.clap[2]);
    const buf = await oc.startRendering();
    // 시작·끝을 아주 짧게 페이드 (재생 시작/끝에서 '톡' 소리 방지)
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch), F = Math.floor(sr * 0.01), n = d.length;
      for (let i = 0; i < F; i++) { d[i] *= i / F; d[n - 1 - i] *= i / F; }
    }
    return buf;
  }
  async function prerenderAll() {
    try {
      // 종류마다 2가지씩 (매번 똑같이 들리지 않게 번갈아 재생)
      for (let v = 0; v < 2; v++) for (const kind of ['cheer', 'groan']) ready[kind].push(await renderCrowd(kind));
    } catch (e) { /* 오프라인 렌더를 못 하는 브라우저: 함성 없이 웅성거림만 */ }
  }
  function playCrowd(kind) {
    const list = ready[kind];
    if (!ctx || !list.length) return;
    const src = ctx.createBufferSource(); src.buffer = list[Math.floor(Math.random() * list.length)];
    src.connect(master); // 잔향·필터가 이미 들어 있는 완성된 소리
    src.start(ctx.currentTime + 0.01);
  }

  const api = {
    init,
    kick(power) { tone(120, 0.12, 0.7, 'sine', 45); noise(0.07, 1800, 1, 0.25 + power * 0.3); },
    post() { tone(880, 0.6, 0.25, 'triangle', 860); tone(1320, 0.4, 0.12, 'sine'); noise(0.05, 3000, 2, 0.3); },
    net() { noise(0.45, 900, 0.8, 0.35, 'lowpass'); },
    glove() { noise(0.09, 1200, 1.5, 0.5); tone(200, 0.08, 0.3, 'sine', 90); },
    bounce() { tone(150, 0.08, 0.3, 'sine', 70); },
    whistle() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 2900;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 28;
      const lg = ctx.createGain(); lg.gain.value = 120;
      lfo.connect(lg); lg.connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.02);
      g.gain.setValueAtTime(0.09, t + 0.35); g.gain.linearRampToValueAtTime(0, t + 0.42);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2900; f.Q.value = 3;
      o.connect(f); f.connect(g); g.connect(master);
      o.start(t); lfo.start(t); o.stop(t + 0.5); lfo.stop(t + 0.5);
    },
    // 동전: 튕길 때 맑은 금속음 / 땅에 떨어질 때 둔탁하게 굴러 멈추는 소리
    coin() { tone(2600, 0.5, 0.07, 'sine'); tone(3900, 0.35, 0.04, 'sine'); tone(5200, 0.2, 0.02, 'sine'); },
    coinLand(strength) { const v = strength || 1; tone(1900 + Math.random() * 300, 0.18, 0.05 * v, 'sine'); noise(0.04, 2500, 2, 0.12 * v); },
    click() { tone(660, 0.05, 0.1, 'square'); },
    // 골: "와아아!" — 음이 올라가며 터지는 함성 + 박수, 웅성거림이 잠시 커졌다가 가라앉음
    cheer() {
      if (!ctx) return;
      playCrowd('cheer');
      const t = ctx.currentTime;
      crowd(0.55, 0.15);
      ambGain.gain.setTargetAtTime(0.1, t + 2.6, 1.2);
      setTimeout(() => { ambLevel = 0.1; }, 2600); // 파도처럼 흔들리는 웅성거림도 그때부터 작게
    },
    // 실축·선방: "오오…" — 낮게 내려가는 탄식, 짧은 박수 몇 번
    groan() {
      if (!ctx) return;
      playCrowd('groan');
      const t = ctx.currentTime;
      crowd(0.35, 0.2);
      ambGain.gain.setTargetAtTime(0.08, t + 1.6, 1.0);
      setTimeout(() => { ambLevel = 0.08; }, 1600);
    },
    crowd,
    // 테스트용: 오프라인으로 소리를 그려 주파수 성분을 분석
    async _render(name, sec) {
      if (name === 'cheer' || name === 'groan') return (await renderCrowd(name)).getChannelData(0);
      if (name === 'ready') return { cheer: ready.cheer.length, groan: ready.groan.length };
      const saved = { ctx, master, crowdBus, ambGain, noiseBuf, brownBuf, reverb, ambLevel };
      const oc = new OfflineAudioContext(1, Math.floor(44100 * sec), 44100);
      build(oc);
      crowd(0.3, 0.05);
      const buf = await oc.startRendering();
      ({ ctx, master, crowdBus, ambGain, noiseBuf, brownBuf, reverb, ambLevel } = saved);
      return buf.getChannelData(0);
    },
  };
  return api;
})();
