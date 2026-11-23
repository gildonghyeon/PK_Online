// 싱글 토너먼트: 8팀 녹아웃 (8강 → 4강 → 결승). 상대 AI 팀마다 킥·키핑 성향이 다름
window.PK = window.PK || {};

PK.Tour = (function () {
  const KEY = 'pk_tour_v1';
  const ROUND_NAME = ['8강', '4강', '결승'];
  // strength 1~5 (별 개수). profile 은 PK.AI.setProfile 로 들어가 실제 킥/다이빙 결정을 바꿈
  const TEAMS = {
    sky:    { name: '스카이 유나이티드', strength: 1, style: '무난한 신생팀 · 슛도 다이빙도 정직한 편',
              cfg: { hair: 0, hairColor: 1, skin: 0, face: 0, uniform: 5, boots: 1 },
              profile: { level: 'easy', kick: { corner: 0.3, stutter: 0.04, panenka: 0.02, fav: { side: 1, rate: 0.2, clutch: 0.15 } }, keep: { early: 0.35, late: 0.1 } } },
    yellow: { name: '옐로 허리케인', strength: 2, style: '인스텝 강슛파 · 키퍼는 일찍 몸을 날림',
              cfg: { hair: 1, hairColor: 2, skin: 2, face: 3, uniform: 3, boots: 2 },
              profile: { level: 'easy', kick: { curl: 0.15, power: [0.8, 0.98], corner: 0.5, stutter: 0.03, lowRate: 0.35, fav: { side: -1, rate: 0.35, clutch: 0.2 } }, keep: { early: 0.6, late: 0.06 } } },
    white:  { name: '화이트 엘리트', strength: 2, style: '가운데 강슛을 즐기는 강심장 · 키퍼는 끝까지 버팀',
              cfg: { hair: 6, hairColor: 0, skin: 4, face: 1, uniform: 2, boots: 0 },
              profile: { level: 'normal', kick: { center: 0.3, power: [0.75, 0.95], curl: 0.3, fav: { side: 1, rate: 0.2, clutch: 0 } }, keep: { early: 0.15, late: 0.4, stay: 0.3 } } },
    orange: { name: '오렌지 블레이즈', strength: 3, style: '멈칫 마스터 · 키퍼는 반대쪽으로 페이크 스텝',
              cfg: { hair: 2, hairColor: 3, skin: 1, face: 2, uniform: 6, boots: 3 },
              profile: { level: 'normal', kick: { stutter: 0.45, curl: 0.5, fav: { side: 1, rate: 0.3, clutch: 0.25 } }, keep: { early: 0.3, late: 0.2, fake: 0.4 } } },
    red:    { name: '레드 드래곤즈', strength: 3, style: '구석 감아차기 장인 · 키퍼는 공을 보고 늦게 뜀',
              cfg: { hair: 3, hairColor: 0, skin: 3, face: 1, uniform: 0, boots: 6 },
              profile: { level: 'normal', kick: { curl: 0.85, corner: 0.85, lowRate: 0.6, stubborn: true, fav: { side: -1, rate: 0.45, clutch: 0.3 } }, keep: { early: 0.12, late: 0.45 } } },
    purple: { name: '퍼플 매지션', strength: 4, style: '파넨카를 즐기는 괴짜 · 키퍼는 몸동작을 잘 읽음',
              cfg: { hair: 4, hairColor: 6, skin: 5, face: 5, uniform: 7, boots: 4 },
              profile: { level: 'hard', kick: { panenka: 0.22, stutter: 0.25, curl: 0.5, fav: { side: 1, rate: 0.25, clutch: 0.1 } }, keep: { read: 0.12, early: 0.25, late: 0.3 } } },
    black:  { name: '블랙 골드 FC', strength: 5, style: '우승 후보 · 빈틈없는 구석 슛과 날카로운 읽기',
              cfg: { hair: 5, hairColor: 2, skin: 2, face: 2, uniform: 4, boots: 5 },
              profile: { level: 'hard', kick: { corner: 0.92, curl: 0.6, stutter: 0.15, adapt: 0.85, sigma: 0.08, fav: { side: -1, rate: 0.12, clutch: 0.4 } }, keep: { read: 0.1, early: 0.3, late: 0.25, catch: 0.05 } } },
  };
  // 대진: 내 팀은 1번 자리. 8강 약팀 → 4강 중간 → 결승에서 강팀을 만나도록 배치
  const SEED = ['me', 'sky', 'yellow', 'orange', 'white', 'red', 'purple', 'black'];

  let T = null; // { slots, res: { 'r-m': {a, b, w, sa, sb, sd} }, round, alive, champ }
  const $ = (id) => document.getElementById(id);

  function load() { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.slots) return s; } catch (e) { /* 저장소 없음 */ } return null; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(T)); } catch (e) { /* 저장 못 해도 진행은 됨 */ } }
  function fresh() { T = { slots: SEED.slice(), res: {}, round: 0, alive: true, champ: null }; save(); }

  const teamName = (id) => (id === 'me' ? '나 (1P)' : TEAMS[id].name);
  const teamColor = (id) => {
    const u = id === 'me' ? PK.Lobby.profile(0).uniform : TEAMS[id].cfg.uniform;
    return PK.Options.uniform[u].c1;
  };
  // 라운드 r 의 m 번째 경기 두 팀 (이전 라운드 승자들)
  function pair(r, m) {
    if (r === 0) return [T.slots[m * 2], T.slots[m * 2 + 1]];
    const a = T.res[(r - 1) + '-' + (m * 2)], b = T.res[(r - 1) + '-' + (m * 2 + 1)];
    return [a ? a.w : null, b ? b.w : null];
  }
  const matchesIn = (r) => 4 >> r;
  function myMatch(r) { for (let m = 0; m < matchesIn(r); m++) { const p = pair(r, m); if (p[0] === 'me' || p[1] === 'me') return m; } return -1; }

  // AI 끼리 경기: 힘 차이로 골 확률을 정해 실제로 5번씩 차고, 같으면 서든데스
  function simulate(a, b) {
    const sa0 = TEAMS[a].strength, sb0 = TEAMS[b].strength;
    const pGoal = (kick, keep) => Math.min(0.9, Math.max(0.5, 0.74 + (kick - keep) * 0.035));
    let ga = 0, gb = 0;
    for (let i = 0; i < 5; i++) {
      if (Math.random() < pGoal(sa0, sb0)) ga++;
      // 남은 킥을 다 넣어도 따라잡을 수 없으면 끝 (a 남은 킥 4-i, b 남은 킥 5-i)
      if (ga > gb + (5 - i) || gb > ga + (4 - i)) break;
      if (Math.random() < pGoal(sb0, sa0)) gb++;
      if (ga > gb + (4 - i) || gb > ga + (4 - i)) break;
    }
    let sd = false;
    while (ga === gb) { sd = true; const x = Math.random() < pGoal(sa0, sb0), y = Math.random() < pGoal(sb0, sa0); ga += x; gb += y; }
    return { w: ga > gb ? a : b, sa: ga, sb: gb, sd };
  }
  // 이번 라운드에서 내 경기를 뺀 나머지 경기 결과 정하기
  function simulateRound(r) {
    for (let m = 0; m < matchesIn(r); m++) {
      const k = r + '-' + m;
      if (T.res[k]) continue;
      const [a, b] = pair(r, m);
      if (!a || !b || a === 'me' || b === 'me') continue;
      const s = simulate(a, b);
      T.res[k] = { a, b, w: s.w, sa: s.sa, sb: s.sb, sd: s.sd };
    }
  }

  // ---------- 화면 ----------
  // ---------- 상대 분석 ----------
  //  이 팀 성향으로 실제 킥 결정을 뽑아 본 결과 (평소 60킥 + 서든데스 30킥). 같은 팀은 늘 같은 결과
  const SIDE = ['왼쪽', '가운데', '오른쪽'];
  const pctOf = (a, n) => Math.round((a / Math.max(1, n)) * 100);
  function analyze(id, prof) {
    const p = prof || TEAMS[id].profile;
    let seed = 7; for (const c of id) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
    const col = (k) => (k.aim.x < -0.9 ? 0 : k.aim.x > 0.9 ? 2 : 1);
    const norm = PK.AI.scout(p, 60, seed), press = PK.AI.scout(p, 30, seed + 1, true);
    const grid = [[0, 0, 0], [0, 0, 0]]; // [높게, 낮게][왼·가운데·오른]
    norm.forEach((k) => { grid[k.aim.y < 0.9 ? 1 : 0][col(k)]++; });
    const sides = [0, 1, 2].map((c) => grid[0][c] + grid[1][c]);
    const low = grid[1][0] + grid[1][1] + grid[1][2];
    let best = [0, 0];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) if (grid[r][c] > grid[best[0]][best[1]]) best = [r, c];
    const ps = [0, 1, 2].map((c) => press.filter((k) => col(k) === c).length);
    const pBest = ps.indexOf(Math.max(...ps));
    const kp = p.keep || {};
    const early = kp.early !== undefined ? kp.early : 0.3, late = kp.late !== undefined ? kp.late : 0.18;
    return {
      n: norm.length, grid, sides, low: pctOf(low, norm.length),
      fav: { side: SIDE[best[1]], high: best[0] === 0, pct: pctOf(grid[best[0]][best[1]], norm.length) },
      press: { side: SIDE[pBest], pct: pctOf(ps[pBest], press.length) },
      panenka: pctOf(norm.filter((k) => k.type === 'panenka').length, norm.length),
      stutter: pctOf(norm.filter((k) => k.stutter).length, norm.length),
      curl: pctOf(norm.filter((k) => k.type === 'curl').length, norm.length),
      keep: { early: Math.round(early * 100), late: Math.round(late * 100), stay: Math.round((kp.stay !== undefined ? kp.stay : 0.14) * 100), fake: Math.round((kp.fake !== undefined ? kp.fake : 0.15) * 100) },
    };
  }
  // 경기 중 짧은 분석 두 줄 [이름, 값] (내가 키퍼일 때 / 키커일 때)
  function tips(a) {
    const at = (s, high) => (s === '가운데' ? '가운데' : s + (high ? ' 위' : ' 아래'));
    return {
      keeper: [['자주 차는 곳', `${at(a.fav.side, a.fav.high)} ${a.fav.pct}%`], ['서든데스', `${a.press.side} ${a.press.pct}%`]],
      kicker: [['키퍼 일찍 뜀', a.keep.early + '%'], ['끝까지 버팀', a.keep.late + '%']],
    };
  }
  function scoutCard(id, prof, title) {
    const a = analyze(id, prof);
    const box = document.createElement('div'); box.className = 'tn-scout';
    const h = document.createElement('div'); h.className = 'sc-head';
    h.innerHTML = `<b></b><span>키커 ${a.n}킥 표본 · 화면 기준</span>`;
    h.firstChild.textContent = title || '상대 분석';
    box.appendChild(h);
    const body = document.createElement('div'); body.className = 'sc-body';
    // 골대 6칸 (위·아래 × 왼·가운데·오른): 많이 차는 칸일수록 진하게
    const goal = document.createElement('div'); goal.className = 'sc-goal'; goal.setAttribute('role', 'img');
    goal.setAttribute('aria-label', `킥 방향 분포: 왼쪽 ${pctOf(a.sides[0], a.n)}%, 가운데 ${pctOf(a.sides[1], a.n)}%, 오른쪽 ${pctOf(a.sides[2], a.n)}%`);
    const max = Math.max(...a.grid[0], ...a.grid[1]);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const v = a.grid[r][c], cell = document.createElement('i');
      cell.style.setProperty('--heat', (v / Math.max(1, max)).toFixed(2));
      cell.textContent = pctOf(v, a.n) + '%';
      if (r === (a.fav.high ? 0 : 1) && SIDE[c] === a.fav.side) cell.className = 'top';
      goal.appendChild(cell);
    }
    const facts = document.createElement('ul'); facts.className = 'sc-facts';
    const li = (label, val, strong) => `<li><span>${label}</span><b${strong ? ' class="hi"' : ''}>${val}</b></li>`;
    facts.innerHTML =
      li('가장 자주', (a.fav.side === '가운데' ? '가운데' : a.fav.side + (a.fav.high ? ' 위' : ' 아래')) + ' ' + a.fav.pct + '%', true) +
      li('서든데스', a.press.side + ' ' + a.press.pct + '%', a.press.pct >= 50) +
      li('낮게 차기', a.low + '%') +
      li('감아차기 · 멈칫 · 파넨카', `${a.curl}% · ${a.stutter}% · ${a.panenka}%`) +
      li('키퍼 일찍 뜀 · 끝까지 버팀', `${a.keep.early}% · ${a.keep.late}%`) +
      li('키퍼 반대쪽 페이크', a.keep.fake + '%');
    body.append(goal, facts);
    box.appendChild(body);
    return box;
  }

  // 싱글 플레이 AI: 경기마다 토너먼트 팀 하나의 차는 방식·막는 방식을 빌려 옴 (난이도는 로비에서 고른 그대로)
  function persona() {
    const ids = Object.keys(TEAMS), id = ids[Math.floor(Math.random() * ids.length)], t = TEAMS[id];
    const profile = { kick: t.profile.kick, keep: t.profile.keep };
    const label = t.style.split(' · ')[0];
    return { id, label, profile, tips: tips(analyze(id, profile)), card: () => scoutCard(id, profile, 'AI 성향 · ' + label) };
  }

  function stars(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }
  function renderBracket() {
    const box = $('tour-bracket'); box.textContent = '';
    for (let r = 0; r < 3; r++) {
      const col = document.createElement('div'); col.className = 'tb-col';
      const h = document.createElement('h3'); h.textContent = ROUND_NAME[r]; col.appendChild(h);
      const list = document.createElement('div'); list.className = 'tb-list'; col.appendChild(list);
      for (let m = 0; m < matchesIn(r); m++) {
        const [a, b] = pair(r, m);
        const res = T.res[r + '-' + m];
        const card = document.createElement('div'); card.className = 'tb-match';
        if (a === 'me' || b === 'me') card.classList.add('mine');
        [[a, res && res.sa], [b, res && res.sb]].forEach(([id, sc]) => {
          const row = document.createElement('div'); row.className = 'tb-team';
          if (!id) { row.classList.add('tbd'); row.innerHTML = '<i class="chip"></i><span class="nm">미정</span>'; card.appendChild(row); return; }
          if (id === 'me') row.classList.add('me');
          if (res) row.classList.add(res.w === id ? 'win' : 'lose');
          const chip = document.createElement('i'); chip.className = 'chip'; chip.style.background = teamColor(id);
          const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = teamName(id);
          const s = document.createElement('b'); s.className = 'sc'; s.textContent = res ? sc : '';
          row.append(chip, nm, s); card.appendChild(row);
        });
        if (res && res.sd) { const t = document.createElement('div'); t.className = 'tb-note'; t.textContent = '서든데스'; card.appendChild(t); }
        list.appendChild(card);
      }
      box.appendChild(col);
    }
    // 우승 칸
    const col = document.createElement('div'); col.className = 'tb-col champ';
    const h = document.createElement('h3'); h.textContent = '우승'; col.appendChild(h);
    const list = document.createElement('div'); list.className = 'tb-list'; col.appendChild(list);
    const card = document.createElement('div'); card.className = 'tb-match trophy' + (T.champ === 'me' ? ' mine' : '');
    card.innerHTML = '<div class="tb-cup" aria-hidden="true">🏆</div>';
    const nm = document.createElement('div'); nm.className = 'tb-champ'; nm.textContent = T.champ ? teamName(T.champ) : '?';
    card.appendChild(nm); list.appendChild(card); box.appendChild(col);
  }
  function render() {
    renderBracket();
    const next = $('tour-next'), sub = $('tour-sub');
    const play = $('tour-play');
    next.textContent = '';
    $('tour-confetti').hidden = true;
    if (T.champ === 'me') {
      sub.textContent = '우승을 축하해요! 모든 상대를 꺾었어요.';
      next.innerHTML = '<div class="tn-win"><div class="tn-cup" aria-hidden="true">🏆</div><b>PK 토너먼트 챔피언!</b></div>';
      play.hidden = true; startConfetti();
      return;
    }
    if (!T.alive) {
      sub.textContent = T.champ ? `탈락했어요. 우승은 ${teamName(T.champ)}` : '탈락했어요.';
      next.innerHTML = '<div class="tn-out">다시 도전해서 우승컵을 가져오세요!</div>';
      play.hidden = true;
      return;
    }
    const m = myMatch(T.round);
    const [a, b] = pair(T.round, m);
    const opp = a === 'me' ? b : a, def = TEAMS[opp];
    sub.textContent = `${ROUND_NAME[T.round]} 경기 · 이기면 ${T.round < 2 ? ROUND_NAME[T.round + 1] + ' 진출' : '우승!'}`;
    const card = document.createElement('div'); card.className = 'tn-card';
    const chip = document.createElement('i'); chip.className = 'chip big'; chip.style.background = teamColor(opp);
    const info = document.createElement('div'); info.className = 'tn-info';
    const t1 = document.createElement('div'); t1.className = 'tn-label'; t1.textContent = `다음 상대 · ${ROUND_NAME[T.round]}`;
    const t2 = document.createElement('div'); t2.className = 'tn-name'; t2.textContent = def.name;
    const t3 = document.createElement('div'); t3.className = 'tn-stars'; t3.textContent = stars(def.strength); t3.setAttribute('aria-label', `전력 ${def.strength} / 5`);
    const t4 = document.createElement('div'); t4.className = 'tn-style'; t4.textContent = def.style;
    info.append(t1, t2, t3, t4); card.append(chip, info); next.appendChild(card);
    next.appendChild(scoutCard(opp));
    play.hidden = false;
    play.textContent = `${ROUND_NAME[T.round]} 시작`;
  }

  // 우승 축하 꽃가루 (움직임 줄이기 설정이면 생략)
  let confettiRaf = 0;
  function startConfetti() {
    const cv = $('tour-confetti');
    if (!cv || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    cv.hidden = false;
    const g = cv.getContext('2d');
    const W = cv.width = cv.clientWidth || 600, H = cv.height = cv.clientHeight || 400;
    const cols = ['#c6ff3d', '#ffd34d', '#2fd0ff', '#ff4d5e', '#ffffff'];
    const ps = Array.from({ length: 120 }, () => ({ x: Math.random() * W, y: -Math.random() * H, v: 1 + Math.random() * 2.5, w: 4 + Math.random() * 5, a: Math.random() * 6, c: cols[Math.floor(Math.random() * cols.length)] }));
    cancelAnimationFrame(confettiRaf);
    const t0 = performance.now();
    const step = (now) => {
      g.clearRect(0, 0, W, H);
      ps.forEach((p) => { p.y += p.v; p.x += Math.sin(p.a += 0.05) * 0.8; if (p.y > H) { p.y = -10; p.x = Math.random() * W; } g.fillStyle = p.c; g.fillRect(p.x, p.y, p.w, p.w * 0.5); });
      if (now - t0 < 9000 && !$('tour').hidden && $('tour').classList.contains('active')) confettiRaf = requestAnimationFrame(step);
      else g.clearRect(0, 0, W, H);
    };
    confettiRaf = requestAnimationFrame(step);
  }

  function show(on) { $('tour').classList.toggle('active', !!on); }

  // ---------- 공개 함수 ----------
  function open() {
    T = load();
    if (!T) fresh();
    PK.Lobby.hide();
    render();
    show(true);
    if (T.champ === 'me') PK.Audio.cheer();
  }
  function close() { show(false); cancelAnimationFrame(confettiRaf); PK.Lobby.show(); updateMenu(); }
  function play() {
    if (!T || !T.alive || T.champ) return;
    const m = myMatch(T.round);
    const [a, b] = pair(T.round, m);
    const opp = a === 'me' ? b : a;
    show(false);
    PK.Game.start('single', { tour: { round: T.round, roundName: ROUND_NAME[T.round], oppId: opp, opp: TEAMS[opp], tips: tips(analyze(opp)) } });
  }
  // 내 경기 결과 기록 (경기 종료 화면이 뜨는 순간 호출)
  function report(win, myGoals, oppGoals, sd) {
    if (!T || !T.alive || T.champ) return;
    const r = T.round, m = myMatch(r);
    const [a, b] = pair(r, m);
    const opp = a === 'me' ? b : a;
    T.res[r + '-' + m] = { a, b, w: win ? 'me' : opp, sa: a === 'me' ? myGoals : oppGoals, sb: a === 'me' ? oppGoals : myGoals, sd };
    simulateRound(r);
    if (!win) {
      T.alive = false;
      // 탈락해도 나머지 대회는 끝까지 진행해서 우승팀을 보여줌
      for (let rr = r + 1; rr < 3; rr++) simulateRound(rr);
      const f = T.res['2-0']; T.champ = f ? f.w : null;
    } else if (r === 2) {
      T.champ = 'me';
    } else {
      T.round = r + 1;
    }
    save();
  }
  // 경기 끝나고 대진표로 돌아오기
  function back() { T = load() || T; render(); show(true); if (T.champ === 'me') PK.Audio.cheer(); }
  function updateMenu() {
    const s = load(), el = $('tour-menu-sub');
    if (!el) return;
    if (s && s.alive && !s.champ && (s.round > 0 || Object.keys(s.res).length)) el.textContent = `이어하기 · ${ROUND_NAME[s.round]} 진행 중`;
    else el.textContent = '8팀 녹아웃 · 8강부터 우승까지';
  }
  function init() {
    $('tour-play').addEventListener('click', () => { PK.Audio.init(); PK.Audio.click(); play(); });
    $('tour-lobby').addEventListener('click', () => { PK.Audio.click(); close(); });
    const reset = $('tour-reset');
    reset.addEventListener('click', () => {
      PK.Audio.click();
      // 진행 중이면 한 번 더 눌러야 초기화 (실수 방지)
      if (T && T.alive && !T.champ && (T.round > 0 || Object.keys(T.res).length) && reset.dataset.confirm !== '1') {
        reset.dataset.confirm = '1'; reset.textContent = '한 번 더 누르면 처음부터'; setTimeout(() => { reset.dataset.confirm = ''; reset.textContent = '새 토너먼트'; }, 2500); return;
      }
      reset.dataset.confirm = ''; reset.textContent = '새 토너먼트';
      fresh(); render();
    });
    updateMenu();
  }

  return { init, open, close, play, report, back, updateMenu, ROUND_NAME, analyze, persona, _state: () => T, _teams: TEAMS };
})();
