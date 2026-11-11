// 공 물리: 중력 + 공기저항(이차) + 마그누스 효과(커브) + 골대/그물/잔디/골키퍼 충돌
window.PK = window.PK || {};

PK.Physics = (function () {
  const BALL_R = 0.11;
  const GRAV = 9.81;
  const K_DRAG = 0.0133;     // 0.5*rho*Cd*A/m
  const K_MAGNUS = 0.32;     // 사이드스핀 1.0 일 때 v=25m/s 에서 약 8m/s² 횡가속
  const SPIN_DECAY = 0.25;
  const V3 = THREE.Vector3;

  const tmp = new V3(), tmp2 = new V3(), tmp3 = new V3();

  function accel(v, spin, out) {
    const sp = v.length();
    out.set(0, -GRAV, 0);
    out.addScaledVector(v, -K_DRAG * sp);
    tmp.crossVectors(spin, v).multiplyScalar(K_MAGNUS);
    out.add(tmp);
    return out;
  }

  // 공기 중 적분 (반암시적 오일러)
  const acc = new V3();
  function integrate(s, dt) {
    accel(s.v, s.spin, acc);
    s.v.addScaledVector(acc, dt);
    s.p.addScaledVector(s.v, dt);
    s.spin.multiplyScalar(Math.exp(-SPIN_DECAY * dt));
  }

  // 커브값(-1..1, +는 키커 기준 오른쪽으로 휨) → 스핀 벡터
  function spinFromCurve(curve, lift) {
    return new V3(0, -curve, 0).add(new V3(lift || 0, 0, 0));
  }

  // 골라인(z=0)까지 궤적 계산 (잔디 무시)
  function flyToLine(p0, v0, spin, collect) {
    const s = { p: p0.clone(), v: v0.clone(), spin: spin.clone() };
    const dt = 1 / 240;
    let prev = s.p.clone();
    for (let t = 0; t < 3; t += dt) {
      prev.copy(s.p);
      integrate(s, dt);
      if (collect && Math.round(t / dt) % 3 === 0) collect.push(s.p.clone());
      if (s.p.z <= 0) {
        const f = prev.z / (prev.z - s.p.z);
        const hit = prev.clone().lerp(s.p, f);
        if (collect) collect.push(hit.clone());
        return { point: hit, time: t };
      }
      if (s.v.z > -0.5) break;
    }
    return null;
  }

  // 목표점(골라인 위의 x,y)에 도달하는 초기 속도 방향을 반복 계산
  function solveLaunch(p0, target, speed, curve) {
    const spin = spinFromCurve(curve);
    const aimPt = target.clone();
    let v0 = new V3();
    for (let i = 0; i < 16; i++) {
      v0.subVectors(aimPt, p0).normalize().multiplyScalar(speed);
      const r = flyToLine(p0, v0, spin);
      if (!r) { aimPt.y += 0.5; continue; }
      const ex = target.x - r.point.x, ey = target.y - r.point.y;
      aimPt.x += ex; aimPt.y += ey;
      if (Math.abs(ex) + Math.abs(ey) < 0.004) break;
    }
    return { v0, spin };
  }

  // 선분-점 최근접점
  function closestOnSeg(a, b, p, out) {
    tmp2.subVectors(b, a);
    const l2 = tmp2.lengthSq();
    let t = l2 > 0 ? tmp3.subVectors(p, a).dot(tmp2) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return out.copy(a).addScaledVector(tmp2, t);
  }

  function makeFrame() {
    const G = PK.GOAL;
    const px = G.halfW + G.postR, top = G.h + G.postR;
    return [
      { a: new V3(-px, 0, 0), b: new V3(-px, top, 0) },
      { a: new V3(px, 0, 0), b: new V3(px, top, 0) },
      { a: new V3(-px, top, 0), b: new V3(px, top, 0) },
    ];
  }
  const FRAME = [];

  // 한 서브스텝 진행. env: {keeper: [{a,b,r,part,vel}], caught}
  const cp = new V3(), nrm = new V3(), rel = new V3(), bestCp = new V3(), ZERO = new V3();
  function step(s, dt, env, events) {
    const G = PK.GOAL;
    if (!FRAME.length) FRAME.push(...makeFrame());

    if (s.held) return; // 키퍼가 잡은 상태
    s.t = (s.t || 0) + dt;
    integrate(s, dt);

    // 잔디
    if (s.p.y < BALL_R) {
      s.p.y = BALL_R;
      if (s.v.y < 0) {
        const vy = -s.v.y;
        if (vy > 1.0) events.push({ type: 'bounce', speed: vy });
        s.v.y = vy > 0.6 ? vy * 0.52 : 0;
        s.v.x *= 0.86; s.v.z *= 0.86;
      }
      // 구름 마찰
      const k = Math.exp(-0.9 * dt);
      s.v.x *= k; s.v.z *= k;
      s.spin.multiplyScalar(Math.exp(-3 * dt));
    }

    // 골대 프레임
    for (const seg of FRAME) {
      closestOnSeg(seg.a, seg.b, s.p, cp);
      nrm.subVectors(s.p, cp);
      const d = nrm.length();
      const minD = BALL_R + G.postR;
      if (d < minD && d > 1e-6) {
        nrm.multiplyScalar(1 / d);
        s.p.copy(cp).addScaledVector(nrm, minD);
        const vn = s.v.dot(nrm);
        if (vn < 0) {
          s.v.addScaledVector(nrm, -vn * 1.62); // 반발계수 0.62
          s.v.multiplyScalar(0.92);
          s.spin.multiplyScalar(0.4);
          events.push({ type: 'post', speed: -vn });
        }
      }
    }

    // 골키퍼: 가장 깊게 겹친 부위 하나만 처리 (여러 캡슐 동시 반사로 공이 뚫리는 현상 방지)
    if (env.keeper && !(env.ignoreUntil && s.t < env.ignoreUntil)) {
      let best = null, bestPen = 0;
      for (const c of env.keeper) {
        closestOnSeg(c.a, c.b, s.p, cp);
        const d = cp.distanceTo(s.p);
        const pen = BALL_R + c.r - d;
        if (pen > bestPen && d > 1e-6) { bestPen = pen; best = c; bestCp.copy(cp); }
      }
      if (best) {
        const c = best;
        nrm.subVectors(s.p, bestCp).normalize();
        s.p.copy(bestCp).addScaledVector(nrm, BALL_R + c.r);
        const kv = c.vel || ZERO;
        rel.subVectors(s.v, kv);
        const vn = rel.dot(nrm);
        if (vn < 0) {
          const speed = rel.length();
          // 잡기 판정: 손/글러브로, 충분히 느리고, 정면에 가까울 때
          const frontal = -vn / speed;
          const catchChance = c.part === 'hand' ? Math.max(0, Math.min(0.92, (24 - speed) / 9)) * (0.4 + 0.6 * frontal) * (env.catchSkill || 1) : 0;
          if (!env.touched && Math.random() < catchChance) {
            s.held = true; s.v.set(0, 0, 0);
            events.push({ type: 'catch', part: c.part, speed });
            return;
          }
          // 손/팔은 아주 강한 슛에만 밀림 (반발계수가 음수가 되면 공이 그대로 밀고 들어감)
          //  예전엔 23m/s 부터 크게 약해져 보통 페널티(25~30m/s)도 손에 맞고 들어가는 일이 잦았음
          const e = c.part === 'body' || c.part === 'leg' ? 0.32
            : (c.part === 'hand' ? 0.55 : 0.38) - Math.max(0, speed - 28) * 0.06;
          const vN = nrm.clone().multiplyScalar(vn);       // 법선 성분
          const vT = rel.clone().sub(vN).multiplyScalar(e < 0 ? 0.85 : 0.5); // 접선 성분 (마찰)
          rel.copy(vT).addScaledVector(nrm, -vn * e);
          if (e < 0) env.ignoreUntil = s.t + 0.06; // 손을 밀어내고 통과
          else if (c.part === 'hand' || c.part === 'arm') {
            // 손·팔로 쳐낸 공은 골문 바깥쪽(가까운 골대 쪽)으로: 골문 안으로 계속 가던 속도를 줄이고 옆으로 밀어냄
            const out = Math.sign(s.p.x) || 1;
            if (rel.z < 0) rel.z *= 0.45;
            rel.x += out * Math.min(6, speed * 0.22);
          }
          s.v.copy(rel).add(kv);
          s.spin.multiplyScalar(0.3);
          env.touched = true;
          events.push({ type: 'keeper', part: c.part, speed });
        }
      }
    }

    // 그물 (골 안에 들어온 공)
    if (s.inGoal) {
      const fz = s.p.z + G.depth * (1 - s.p.y / G.h); // 뒷그물 평면까지 (>0 이면 앞쪽)
      const nl = Math.hypot(G.depth / G.h, 1);
      const dist = fz / nl;
      if (dist < BALL_R) {
        nrm.set(0, -(G.depth / G.h) / nl, 1 / nl);
        s.p.addScaledVector(nrm, BALL_R - dist);
        const vn = s.v.dot(nrm);
        if (vn < 0) {
          if (!s.netHit) { events.push({ type: 'net', speed: -vn, point: s.p.clone() }); s.netHit = true; }
          s.v.addScaledVector(nrm, -vn * 1.08);
          s.v.multiplyScalar(0.35);
        }
      }
      const lim = G.halfW - BALL_R;
      if (Math.abs(s.p.x) > lim) { s.p.x = Math.sign(s.p.x) * lim; s.v.x *= -0.15; s.v.multiplyScalar(0.6); }
      if (s.p.y > G.h - BALL_R) { s.p.y = G.h - BALL_R; s.v.y *= -0.1; s.v.multiplyScalar(0.6); }
      if (s.p.z > -BALL_R && s.v.z > 0) { s.v.z *= -0.2; }
      // 그물 안에서는 빠르게 감속
      s.v.multiplyScalar(Math.exp(-1.2 * dt));
    }
  }

  return { BALL_R, solveLaunch, flyToLine, spinFromCurve, step, closestOnSeg };
})();
