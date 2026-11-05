// 온라인 대전: Claude 아티팩트의 두 가지 통신 경로를 함께 씁니다.
//  1) 실시간 방(room) presence — 빠름. 같은 조직 멤버끼리 확실히 연결됨
//  2) 공유 저장소(db) 문서 — 조직 밖에서 이메일로 초대한 편집자도 연결됨 (공개 링크 공유가 꺼져 있어야 함)
// 방을 만들거나 참가하면 두 경로 모두로 알리고, 먼저 연결되는 경로로 경기를 진행합니다.
// 주고받는 값(필드): cfg 선수 꾸미기, gid 경기 번호, coin 동전, shot 슛, stut 멈칫, live 키퍼 상태, launch 실제 킥, res 결과
window.PK = window.PK || {};

PK.Online = (function () {
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const $ = (id) => document.getElementById(id);
  const nonce = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  let room = null, db = null, ready = false;
  let code = null, role = null, gid = 0;
  let matched = false, via = null;     // 연결된 경로: 'room' | 'db'
  let oppPeer = null, oppNonce = null; // 상대 (room: peer 라벨 / db: nonce)
  let joinTimer = null;
  const cbs = { matched: null, left: null };
  let conn = false, roomErr = null, dbErr = null, dbWritable = null;
  const mine = {}; // 내가 올린 값 사본

  // ---------- 개발용: 같은 PC 의 두 화면끼리 연결 (?fakeroom=1 / ?fakedb=1) ----------
  function fakeRoom() {
    const bc = new BroadcastChannel('pk-fake-room');
    const id = Math.random().toString(36).slice(2, 10);
    let my = {}; const others = new Map(); let handlers = []; let snap = [];
    const peer = (p, pres, me) => ({ peer: p, by: null, isMe: me, sameTab: me, kind: 'viewer', guest: false, presence: pres, updatedAt: Date.now() });
    const build = () => { snap = Object.freeze([peer(id, Object.freeze(Object.assign({}, my)), true), ...[...others].map(([p, pr]) => peer(p, pr, false))]); };
    const fire = () => { build(); handlers.forEach((h) => h({ peers: snap, joined: [], left: [], updated: [] })); };
    bc.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'p') { const isNew = !others.has(m.id); others.set(m.id, Object.freeze(m.p)); if (isNew) bc.postMessage({ t: 'p', id, p: my }); fire(); }
      else if (m.t === 'bye') { others.delete(m.id); fire(); }
      else if (m.t === 'hello') bc.postMessage({ t: 'p', id, p: my });
    };
    addEventListener('pagehide', () => bc.postMessage({ t: 'bye', id }));
    bc.postMessage({ t: 'hello', id });
    build();
    return {
      presence(patch) { for (const k in patch) { if (patch[k] === null) delete my[k]; else my[k] = JSON.parse(JSON.stringify(patch[k])); } bc.postMessage({ t: 'p', id, p: my }); build(); return Promise.resolve(); },
      peers() { return snap; },
      onPeers(h) { handlers.push(h); setTimeout(fire, 0); return () => { handlers = handlers.filter((x) => x !== h); }; },
      connected() { return true; },
      onConnection(h) { setTimeout(() => h(true), 0); return () => {}; },
    };
  }
  function fakeDb() {
    const bc = new BroadcastChannel('pk-fake-db');
    const KEY = 'pkfakedb:';
    const read = (p) => { try { const v = localStorage.getItem(KEY + p); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
    const docSubs = new Map(), colSubs = new Map();
    const snapDoc = (p) => { const d = read(p); return { id: p.split('/').pop(), exists: !!d, data: () => d || undefined, metadata: { fromCache: false, hasPendingWrites: false } }; };
    const snapCol = (c) => {
      const docs = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i), pre = KEY + c + '/';
        if (k && k.startsWith(pre) && k.slice(pre.length).indexOf('/') < 0) docs.push(snapDoc(k.slice(KEY.length)));
      }
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
    };
    const notify = (p) => {
      (docSubs.get(p) || []).forEach((cb) => cb(snapDoc(p)));
      const c = p.split('/').slice(0, -1).join('/');
      (colSubs.get(c) || []).forEach((cb) => cb(snapCol(c)));
    };
    bc.onmessage = (e) => setTimeout(() => notify(e.data.p), 40); // 저장소 지연 흉내
    const write = (p, d) => { if (d) localStorage.setItem(KEY + p, JSON.stringify(d)); else localStorage.removeItem(KEY + p); notify(p); bc.postMessage({ p }); return new Promise((r) => setTimeout(r, 25)); };
    const sub = (map, key, cb, snapFn) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(cb); setTimeout(() => cb(snapFn(key)), 0); return () => map.get(key).delete(cb); };
    return {
      doc(p) { return { path: p, set: (d) => write(p, JSON.parse(JSON.stringify(d))), delete: () => write(p, null), get: async () => snapDoc(p), onSnapshot: (cb) => sub(docSubs, p, cb, snapDoc) }; },
      collection(c) { const q = { orderBy: () => q, limit: () => q, where: () => q, onSnapshot: (cb) => sub(colSubs, c, cb, snapCol) }; return q; },
    };
  }

  // ---------- 시작 ----------
  async function init() {
    const use = (n) => { try { return window.claude && typeof window.claude.use === 'function' ? window.claude.use(n).catch(() => null) : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } };
    const [r, d] = await Promise.all([use('room'), use('db')]);
    room = r; db = d;
    if (!room && /[?&]fakeroom=1/.test(location.search) && 'BroadcastChannel' in window) room = fakeRoom();
    if (!db && /[?&]fakedb=1/.test(location.search) && 'BroadcastChannel' in window) db = fakeDb();
    ready = true;
    if (room) {
      const onErr = (e) => { roomErr = (e && e.code) || 'error'; render(); };
      room.onPeers(onPeers, onErr);
      if (typeof room.onConnection === 'function') room.onConnection((c) => { conn = !!c; if (c && code && via !== 'db') resend(); render(); }, onErr);
    }
    if (db) {
      try {
        db.collection('rooms').orderBy('t', 'desc').limit(12).onSnapshot((qs) => {
          dbRooms = qs.docs.filter((s) => s.exists).map((s) => s.data()).filter((x) => x && typeof x === 'object');
          renderDiag();
        }, (e) => { dbErr = (e && e.code) || 'error'; render(); });
      } catch (e) { dbErr = 'error'; }
    }
    addEventListener('pagehide', () => { if (myRef) myRef.delete().catch(() => {}); });
    // 기다리는 동안 3초마다 방 정보를 다시 올리고 상태 갱신
    setInterval(() => { if (code && !matched && room && via !== 'db') resend(); if (!$('online-panel').hidden) render(); }, 3000);
    // 새로고침 전에 방을 만들었거나 참가 중이었다면 자동으로 이어가기
    const saved = recall();
    if ((room || db) && saved && /^[A-Z0-9]{4}$/.test(saved.code || '')) {
      $('online-panel').hidden = false;
      if (saved.role === 'host') create(saved.code); else if (saved.role === 'guest') join(saved.code);
      status('페이지가 새로고침되어 방에 다시 들어왔어요.');
    }
    render();
  }

  // ---------- 보내기 ----------
  function set(patch) {
    for (const k in patch) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; }
    if (room && via !== 'db') room.presence(patch).catch((e) => { roomErr = (e && e.code) || 'error'; render(); });
    if (db && myRef && via !== 'room') dbWrite();
  }
  function resend() { if (room) room.presence(Object.assign({}, mine)).catch(() => {}); }

  // 저장소 쓰기: 한 번에 하나씩, 바뀐 내용만, 몰아서
  let myRef = null, oppRef = null, oppData = null, unsubOpp = null, dbRooms = [];
  let writing = false, dirty = false, lastJson = '';
  function dbWrite() {
    if (!myRef) return;
    if (writing) { dirty = true; return; }
    const body = Object.assign({}, mine, { nonce });
    const json = JSON.stringify(body);
    if (json === lastJson) return;
    writing = true;
    myRef.set(body).then(() => { lastJson = json; dbWritable = true; })
      .catch((e) => { dbErr = (e && e.code) || 'error'; if (dbErr === 'invalid_argument') dbWritable = false; render(); })
      .finally(() => { writing = false; if (dirty) { dirty = false; setTimeout(dbWrite, 120); } });
  }
  function dbOpen(myPath, oppPath) {
    if (!db) return;
    dbClose(false);
    try {
      myRef = db.doc(myPath); oppRef = db.doc(oppPath); lastJson = '';
      unsubOpp = oppRef.onSnapshot((s) => { oppData = s.exists ? s.data() : null; onDbOpp(); }, (e) => { dbErr = (e && e.code) || 'error'; render(); });
      dbWrite();
    } catch (e) { dbErr = 'error'; myRef = oppRef = null; }
  }
  function dbClose(removeMine) {
    if (unsubOpp) { unsubOpp(); unsubOpp = null; }
    if (removeMine && myRef) myRef.delete().catch(() => {});
    myRef = oppRef = null; oppData = null; lastJson = '';
  }

  // ---------- 받기 ----------
  function peersList() { return room ? room.peers() : []; }
  function myPeerId() { const me = peersList().find((p) => p.sameTab); return me ? me.peer : null; }
  function oppPeerObj() { return oppPeer ? peersList().find((p) => p.peer === oppPeer) || null : null; }
  function remote() {
    if (via === 'db') return oppData;
    if (via === 'room') { const p = oppPeerObj(); return p ? p.presence || {} : null; }
    return null;
  }

  // 상대가 보낸 선수 꾸미기 값은 믿지 않고 범위를 검사
  function sanitizeCfg(c) {
    const O = PK.Options;
    const pick = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : 0);
    c = c && typeof c === 'object' ? c : {};
    return { hair: pick(c.hair, O.hair.length), hairColor: pick(c.hairColor, O.hairColor.length), skin: pick(c.skin, O.skin.length),
      face: pick(c.face, O.face.length), uniform: pick(c.uniform, O.uniform.length), boots: pick(c.boots, O.boots.length) };
  }

  function becomeMatched(how) {
    if (matched) return;
    matched = true; via = how; clearTimeout(joinTimer);
    if (how === 'room') dbClose(true); // 안 쓰는 경로는 정리
    status('');
    render();
    cbs.matched && cbs.matched();
  }

  // 실시간 방 경로: 방장이 opp 로 참가자를 지목, 참가자가 ack 로 응답하면 연결
  function onPeers(change) {
    renderDiag();
    if (!code || via === 'db') return;
    const me = myPeerId();
    const peers = change.peers;
    if (role === 'host') {
      if (!oppPeer) {
        const g = peers.find((p) => !p.sameTab && p.presence && p.presence.code === code && p.presence.role === 'guest');
        if (g) { oppPeer = g.peer; set({ opp: g.peer }); render(); }
      }
      const g = oppPeerObj();
      if (oppPeer && (!g || !g.presence || g.presence.code !== code)) {
        if (matched) { lost(); return; }
        oppPeer = null; set({ opp: null }); return;
      }
      if (!matched && g && g.presence.ack === me) becomeMatched('room');
    } else if (role === 'guest') {
      const h = peers.find((p) => !p.sameTab && p.presence && p.presence.code === code && p.presence.role === 'host');
      if (!h) { if (matched) lost(); return; }
      if (h.presence.opp && h.presence.opp !== me) { if (!matched && !oppNonce) { status('이미 다른 사람이 들어간 방이에요.', true); } return; }
      if (h.presence.opp === me) { oppPeer = h.peer; if (!matched) { set({ ack: h.peer }); becomeMatched('room'); } }
    }
  }

  // 공유 저장소 경로: rooms/<코드> (방장), joins/<코드> (참가자) 문서로 같은 절차
  function onDbOpp() {
    renderDiag();
    if (!code || via === 'room') return;
    const d = oppData;
    if (role === 'host') {
      if (!oppNonce && d && d.role === 'guest' && d.code === code && typeof d.nonce === 'string') { oppNonce = d.nonce; set({ dopp: d.nonce }); render(); }
      if (oppNonce && (!d || d.nonce !== oppNonce || d.code !== code)) {
        if (matched) { lost(); return; }
        oppNonce = null; set({ dopp: null }); return;
      }
      if (!matched && d && d.dack === nonce) becomeMatched('db');
    } else if (role === 'guest') {
      if (!d || d.role !== 'host' || d.code !== code) { if (matched) lost(); return; }
      if (d.dopp && d.dopp !== nonce) { if (!matched && !oppPeer) status('이미 다른 사람이 들어간 방이에요.', true); else if (matched) lost(); return; }
      if (d.dopp === nonce) { oppNonce = d.nonce; if (!matched) { set({ dack: d.nonce }); becomeMatched('db'); } }
    }
  }

  function lost() {
    const was = matched;
    matched = false; via = null; oppPeer = null; oppNonce = null;
    if (role === 'host') {
      set({ opp: null, dopp: null });
      if (db && code && !myRef) dbOpen('rooms/' + code, 'joins/' + code); // 다음 상대를 다시 기다림
    }
    if (was && cbs.left) cbs.left();
    render();
  }

  function myCfg() { return PK.Lobby.profile(0); }

  // 새로고침(게임 업데이트 포함)돼도 방을 이어가도록 이 탭에만 기억
  function remember(v) { try { if (v) sessionStorage.setItem('pk_online', JSON.stringify(v)); else sessionStorage.removeItem('pk_online'); } catch (e) { /* 무시 */ } }
  function recall() { try { return JSON.parse(sessionStorage.getItem('pk_online')) || null; } catch (e) { return null; } }

  const CLEAR = { opp: null, ack: null, dopp: null, dack: null, coin: null, shot: null, stut: null, live: null, launch: null, res: null };
  function create(fixed) {
    if (!room && !db) return;
    code = typeof fixed === 'string' && /^[A-Z0-9]{4}$/.test(fixed) ? fixed : Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    role = 'host'; gid = 1; oppPeer = null; oppNonce = null; matched = false; via = null;
    set(Object.assign({ code, role, cfg: myCfg(), gid, t: Date.now() }, CLEAR));
    if (db) dbOpen('rooms/' + code, 'joins/' + code);
    remember({ role: 'host', code });
    render();
  }

  function join(c) {
    if (!room && !db) return;
    c = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (c.length !== 4) { status('4자리 코드를 입력하세요.', true); return; }
    code = c; role = 'guest'; oppPeer = null; oppNonce = null; matched = false; via = null;
    set(Object.assign({ code, role, cfg: myCfg(), gid: 0, t: Date.now() }, CLEAR));
    if (db) dbOpen('joins/' + code, 'rooms/' + code);
    remember({ role: 'guest', code });
    clearTimeout(joinTimer);
    // 바로 포기하지 않고 계속 기다림. 오래 걸리면 안내만 표시
    joinTimer = setTimeout(() => { if (!matched && role === 'guest') status('아직 방장을 찾지 못했어요. 아래 연결 상태를 확인해 주세요.', true); }, 12000);
    render();
  }

  function stop() {
    clearTimeout(joinTimer);
    dbClose(true);
    code = null; role = null; oppPeer = null; oppNonce = null; matched = false; via = null;
    remember(null);
    set(Object.assign({ code: null, role: null, t: null }, CLEAR));
    render();
  }

  // 방장: 같은 상대와 다시 하기 (경기 번호를 올려서 지난 경기의 신호와 구분)
  function rematch() {
    if (role !== 'host') return;
    gid += 1;
    set({ gid, coin: null, shot: null, stut: null, live: null, launch: null, res: null });
  }
  function currentGid() { if (role === 'host') return gid; const r = remote(); return r && Number.isInteger(r.gid) ? r.gid : 0; }

  // ---------- 로비 패널 ----------
  let statusMsg = '', statusErr = false;
  function status(msg, err) { statusMsg = msg; statusErr = !!err; const el = $('op-status'); if (el) { el.textContent = msg; el.classList.toggle('err', !!err); } }
  function render() {
    const panel = $('online-panel'); if (!panel) return;
    const avail = !!(room || db);
    $('op-unavailable').hidden = !ready || avail;
    $('op-loading').hidden = ready;
    $('op-start').hidden = !avail || !!code;
    $('op-wait').hidden = !avail || !code || matched;
    $('op-code-big').textContent = role === 'host' ? code : '';
    $('op-code-big').hidden = role !== 'host';
    $('op-wait-msg').textContent = role === 'host'
      ? (oppPeer || oppNonce ? '상대가 들어왔어요. 연결하는 중...' : '이 코드를 상대에게 알려 주세요. 상대를 기다리는 중...')
      : '방에 들어가는 중...';
    status(statusMsg, statusErr);
    renderDiag();
  }

  const ERR_TEXT = {
    not_granted: '연결이 허용되지 않은 계정이에요 (게임 링크를 공유받은 Claude 계정으로 열어야 해요)',
    revoked: '접근 권한이 바뀌어 연결이 끊겼어요. 페이지를 새로고침해 주세요',
    capability_disabled: '이 기능이 꺼져 있어요',
    resource_exhausted: '신호가 너무 잦아요. 잠시 뒤 다시 시도해 주세요',
    invalid_argument: '이 계정은 보기 권한이라 방을 만들거나 참가할 수 없어요. 방장이 공유 메뉴에서 이 계정을 "편집자"로 바꾸고, "링크가 있는 모든 사용자" 공유는 꺼야 해요. 바꾼 뒤 새로고침해 주세요',
  };
  const validCode = (c) => typeof c === 'string' && /^[A-Z0-9]{4}$/.test(c);
  // 열려 있는 방: 실시간 방에서 보이는 방장 + 저장소에 30분 안에 만들어진 방 (이미 상대가 들어간 방은 제외)
  function openRooms() {
    const set1 = new Set();
    peersList().forEach((p) => { const pr = p.presence; if (!p.sameTab && pr && pr.role === 'host' && !pr.opp && validCode(pr.code)) set1.add(pr.code); });
    const now = Date.now();
    dbRooms.forEach((d) => { if (d.role === 'host' && !d.dopp && validCode(d.code) && d.nonce !== nonce && typeof d.t === 'number' && now - d.t < 30 * 60 * 1000) set1.add(d.code); });
    if (role === 'host') set1.delete(code);
    return [...set1];
  }
  function renderDiag() {
    const el = $('op-diag'); if (!el) return;
    const lines = [];
    if (room) {
      const others = peersList().filter((p) => !p.sameTab);
      lines.push(`실시간 방: ${conn || (room.connected && room.connected()) ? '연결됨' : '연결 중…'} · 이 게임을 열어 둔 다른 사람 ${others.length}명`);
    }
    if (db) {
      lines.push(`공유 저장소: ${dbWritable === false ? '쓰기 권한 없음 (게임 편집자로 초대받아야 해요)' : dbWritable ? '사용 중' : '사용 가능'}`);
    }
    if (role === 'guest' || !code) { const o = openRooms(); lines.push(`지금 열려 있는 방: ${o.length ? o.join(', ') : '없음'}`); }
    if (matched) lines.push(`연결 경로: ${via === 'db' ? '공유 저장소' : '실시간 방'}`);
    if (roomErr) lines.push(`실시간 방 오류: ${ERR_TEXT[roomErr] || roomErr}`);
    if (dbErr) lines.push(`저장소 오류: ${ERR_TEXT[dbErr] || dbErr}`);
    el.textContent = lines.join('\n');
    // 참가 전/참가 대기 중: 열려 있는 방을 눌러서 바로 참가
    const box = $('op-rooms');
    if (box) {
      const open = (role === 'guest' && !matched) || !code ? openRooms() : [];
      const key = open.join(',');
      if (box.dataset.key !== key) {
        box.dataset.key = key;
        box.innerHTML = '';
        open.forEach((c) => {
          const b = document.createElement('button');
          b.type = 'button'; b.textContent = c + ' 방 참가';
          b.addEventListener('click', () => { status(''); if (role === 'guest') stop(); join(c); });
          box.appendChild(b);
        });
      }
      box.hidden = !open.length;
    }
  }

  function bindUI() {
    $('op-create').addEventListener('click', () => { status(''); create(); });
    $('op-join').addEventListener('click', () => { status(''); join($('op-code').value); });
    $('op-code').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { status(''); join($('op-code').value); } });
    $('op-cancel').addEventListener('click', () => { status(''); stop(); });
  }

  return {
    init() { bindUI(); render(); init(); },
    togglePanel() { const p = $('online-panel'); p.hidden = !p.hidden; render(); },
    onMatched(fn) { cbs.matched = fn; },
    onLeft(fn) { cbs.left = fn; },
    set, remote, rematch, sanitizeCfg,
    leave() { stop(); },
    get isHost() { return role === 'host'; },
    get matched() { return matched; },
    get via() { return via; },
    get gid() { return currentGid(); },
    opponentCfg() { const r = remote(); return r ? sanitizeCfg(r.cfg) : null; },
  };
})();
