// AI 키커/골키퍼. 상대(사람)의 성향을 기억해서 점점 읽어냅니다.
// 토너먼트에서는 팀마다 성향(profile)이 달라 차는 방식과 막는 방식이 다름
window.PK = window.PK || {};

PK.AI = (function () {
  const LEVEL = {
    easy:   { kickSigma: 0.32, overChance: 0.14, readChance: 0.05, catchSkill: 0.8, cornerBias: 0.35 },
    normal: { kickSigma: 0.18, overChance: 0.07, readChance: 0.15, catchSkill: 1.0, cornerBias: 0.6 },
    hard:   { kickSigma: 0.1,  overChance: 0.03, readChance: 0.28, catchSkill: 1.15, cornerBias: 0.85 },
  };
  let level = 'normal';
  let profile = null, savedLevel = null; // 토너먼트 팀 성향 { level, kick:{...}, keep:{...} }
  const memory = { kickX: [], diveX: [], timing: [], style: [] }; // 사람의 킥 방향, 다이빙 방향, 다이빙 타이밍, 킥 스타일 기록

  function rand(a, b) { return a + Math.random() * (b - a); }
  function sideOf(x) { return x < -0.9 ? -1 : x > 0.9 ? 1 : 0; }
  // 성향 값이 있으면 그것을, 없으면 기본값
  const KP = (key, def) => (profile && profile.kick && profile.kick[key] !== undefined ? profile.kick[key] : def);
  const GP = (key, def) => (profile && profile.keep && profile.keep[key] !== undefined ? profile.keep[key] : def);

  // 키커 결정: {aim:{x,y}, power, curve}
  function decideKick() {
    const L = LEVEL[level];
    const G = PK.GOAL;
    // 사람 키퍼가 자주 가는 쪽 반대로
    let side;
    const dives = memory.diveX.slice(-5);
    const r = Math.random();
    if (r < KP('center', 0.1)) side = 0;
    else if (dives.length >= 2 && Math.random() < KP('adapt', 0.6)) {
      const avg = dives.reduce((a, b) => a + sideOf(b), 0) / dives.length;
      side = avg > 0.2 ? -1 : avg < -0.2 ? 1 : (Math.random() < 0.5 ? -1 : 1);
    } else side = Math.random() < 0.5 ? -1 : 1;

    let x, y;
    if (side === 0) { x = rand(-0.6, 0.6); y = rand(0.8, 2.0); }
    else {
      const corner = Math.random() < KP('corner', L.cornerBias);
      x = side * (corner ? rand(2.6, 3.25) : rand(1.6, 2.6));
      y = Math.random() < KP('lowRate', 0.55) ? rand(0.2, 0.7) : rand(1.2, corner ? 2.1 : 1.9);
    }
    const pw = KP('power', [0.62, 0.86]);
    let power = rand(pw[0], pw[1]);
    if (Math.random() < L.overChance) power = rand(1.02, 1.15);
    // 바깥쪽에서 안으로 휘어 들어오는 커브(감아차기)
    const curlRate = KP('curl', 0.45);
    let curve = 0;
    if (side !== 0 && Math.random() < curlRate) { curve = -side * rand(0.2, 0.6); x += side * 0.15; }
    x = Math.max(-G.halfW + 0.25, Math.min(G.halfW - 0.25, x));
    // 킥 종류 / 멈칫: 사람 키퍼가 일찍 뛰는 버릇이 있으면 멈칫·파넨카를 더 자주 씀
    const recent = memory.timing.slice(-5);
    const earlyRate = recent.length ? recent.filter((t) => t !== 'late').length / recent.length : 0.5;
    const lateRate = recent.length ? recent.filter((t) => t === 'late').length / recent.length : 0.2;
    let type = Math.random() < curlRate ? 'curl' : 'instep';
    if (type === 'curl') power = Math.min(power + 0.08, 0.95);
    let stutter = Math.random() < KP('stutter', 0.08) + earlyRate * 0.2;
    if (Math.random() < KP('panenka', 0.03) + earlyRate * 0.07 - lateRate * 0.05) {
      type = 'panenka'; stutter = false; curve = 0;
      x = rand(-0.4, 0.4); y = rand(1.3, 1.9); power = rand(0.4, 0.8);
    }
    if (lateRate > 0.5 && type !== 'panenka' && !KP('stubborn', false)) { type = 'instep'; stutter = false; } // 늦게 뛰는 키퍼에겐 강하게
    return { aim: { x, y }, power, curve, sigma: KP('sigma', L.kickSigma), type, stutter };
  }

  // 골키퍼 결정: 다이빙 목표점 {x,y}. shot 은 실제 킥 정보(가끔 몸동작을 '읽음')
  function decideDive(shot, plan) {
    const L = LEVEL[level];
    if (shot && Math.random() < L.readChance + GP('read', 0)) {
      return { x: shot.x * rand(0.8, 1.05), y: Math.max(0.3, shot.y * rand(0.8, 1.1)) };
    }
    if (plan) return plan; // 킥 전에 세워 둔 계획대로
    const kicks = memory.kickX.slice(-6);
    let pLeft = 0.44, pRight = 0.44;
    if (kicks.length >= 2) {
      const l = kicks.filter((x) => sideOf(x) < 0).length / kicks.length;
      const rr = kicks.filter((x) => sideOf(x) > 0).length / kicks.length;
      pLeft = 0.25 + l * 0.55; pRight = 0.25 + rr * 0.55;
    }
    const stay = GP('stay', 0.14); // 가운데에 버티는 비율
    const t = Math.random() * (pLeft + pRight + stay);
    if (t < pLeft) return { x: -rand(1.8, 3.0), y: rand(0.3, 1.8) };
    if (t < pLeft + pRight) return { x: rand(1.8, 3.0), y: rand(0.3, 1.8) };
    return { x: rand(-0.3, 0.3), y: rand(0.6, 1.6) };
  }

  // 킥 전에 다이빙할 쪽으로 살짝 치우쳐 서기 (너무 티 나지 않게, 가끔은 반대로 속이기)
  function decideShift(diveX) {
    const r = Math.random();
    const fake = GP('fake', 0.15);
    if (Math.abs(diveX) < 0.75 || r < 0.35) return rand(-0.12, 0.12);
    if (r < 1 - fake) return Math.sign(diveX) * rand(0.2, 0.55);
    return -Math.sign(diveX) * rand(0.15, 0.35); // 페이크
  }

  // 다이빙 타이밍: 사람 키커가 멈칫/파넨카를 자주 쓰면 늦게 뜀
  function decideTiming() {
    const recent = memory.style.slice(-5);
    const tricky = recent.length ? recent.filter((k) => k.stutter || k.type === 'panenka').length / recent.length : 0;
    const pLate = GP('late', 0.18) + tricky * 0.5, pEarly = GP('early', 0.3) * (1 - tricky);
    const r = Math.random();
    return r < pLate ? 'late' : r < pLate + pEarly ? 'early' : 'normal';
  }

  return {
    decideShift, decideTiming,
    rememberTiming(t) { memory.timing.push(t); },
    rememberKickStyle(type, stutter) { memory.style.push({ type, stutter }); },
    setLevel(l) { level = l; if (!profile) savedLevel = null; },
    getLevel() { return level; },
    catchSkill() { return LEVEL[level].catchSkill + GP('catch', 0); },
    // 토너먼트 팀 성향 적용 / 해제 (해제하면 로비에서 고른 난이도로 돌아감)
    setProfile(p) { if (!profile) savedLevel = level; profile = p || null; if (p && p.level) level = p.level; },
    clearProfile() { if (profile && savedLevel) level = savedLevel; profile = null; savedLevel = null; },
    decideKick, decideDive,
    rememberKick(x) { memory.kickX.push(x); },
    rememberDive(x) { memory.diveX.push(x); },
    reset() { memory.kickX.length = 0; memory.diveX.length = 0; memory.timing.length = 0; memory.style.length = 0; },
  };
})();
