(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const TAU = Math.PI * 2;

  const overlay = document.getElementById('overlay');
  const panel = document.getElementById('panel');
  const soundBtn = document.getElementById('sound-btn');

  // ---- 저장소 ----
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* 무시 */ } },
  };
  let bestScore = Number(store.get('dodge-best-score', 0)) || 0;
  let maxStage = Math.min(STAGES.length, Math.max(1, Number(store.get('dodge-max-stage', 1)) || 1));

  // ---- 유틸 ----
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function weighted(obj) {
    const entries = Object.entries(obj);
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = Math.random() * total;
    for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
    return entries[0][0];
  }
  function angleDiff(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  }

  // ---- 게임 상태 ----
  let state = 'title'; // title | playing | paused | over | ending
  let phase = 'intro'; // intro | wave | warning | boss | clear
  let phaseT = 0, animT = 0;
  let stageIdx = 0, stage = STAGES[0];
  let lives = 3, score = 0;
  let player, bullets, particles, hazards, orbs, shots, boss;
  let spawnTimer = 0, eventTimer = 0, orbTimer = 0, shake = 0, flash = 0;
  let bossHintT = 0;
  let stageTime = 0, stageHits = 0, stageScore0 = 0;
  let slowT = 0, floaters = [];
  const keys = new Set();
  const pointer = { active: false, x: 0, y: 0 };

  function resetField() {
    player = { x: W / 2, y: H * 0.72, r: 8, speed: 270, inv: 0, shield: false };
    slowT = 0;
    floaters = [];
    bullets = [];
    particles = [];
    hazards = [];
    orbs = [];
    shots = [];
    boss = null;
  }
  resetField();

  // ==================================================================
  // 탄
  // ==================================================================
  function addBullet(x, y, angle, speed, opt = {}) {
    if (bullets.length > 700) return;
    const b = {
      x, y, bx: x, by: y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      r: 5, kind: 'straight', t: 0,
      color: pick(stage.bullet),
      ...opt,
    };
    if (b.kind === 'zigzag') b.nextZig = b.zigT;
    bullets.push(b);
  }

  // 탄 종류별 기본 파라미터
  function kindOptions(kind, base) {
    switch (kind) {
      case 'curve': { const w = rand(0.6, 1.1) * (Math.random() < 0.5 ? -1 : 1); return { kind, w, aimShift: -w * 0.55 }; }
      case 'wave': return { kind, amp: rand(22, 45), freq: rand(4, 7) };
      case 'accel': return { kind, speedMul: 0.4, acc: 170, max: base * 2.2, color: '#fb7185' };
      case 'homing': return { kind, homeT: 1.7, turn: 1.9, speedMul: 0.8, color: '#c084fc', r: 6 };
      case 'bounce': return { kind, bounces: 1, jitter: 0.9, color: '#4ade80' };
      case 'split': return { kind, fuse: rand(1.1, 1.9), parts: 8, speedMul: 0.7, r: 9, color: '#f8fafc' };
      case 'zigzag': return { kind, zigT: 0.32, zigA: 0.75, zigDir: 1, aimShift: -0.37, color: '#fde047' };
      default: return { kind: 'straight' };
    }
  }

  function edgePoint() {
    const side = Math.floor(Math.random() * 4);
    if (side === 0) return { x: rand(0, W), y: -14 };
    if (side === 1) return { x: W + 14, y: rand(0, H) };
    if (side === 2) return { x: rand(0, W), y: H + 14 };
    return { x: -14, y: rand(0, H) };
  }

  function spawnEdgeBullet() {
    const kind = weighted(stage.kinds);
    const p = edgePoint();
    const base = stage.speed * rand(0.85, 1.2);
    const o = kindOptions(kind, base);
    const jitter = o.jitter ?? 0.45;
    const a = Math.atan2(player.y - p.y, player.x - p.x) + rand(-jitter, jitter) + (o.aimShift || 0);
    const sp = base * (o.speedMul || 1);
    delete o.speedMul; delete o.aimShift; delete o.jitter;
    addBullet(p.x, p.y, a, sp, o);
  }

  function updateBullet(b, dt) {
    b.t += dt;
    switch (b.kind) {
      case 'curve': {
        const c = Math.cos(b.w * dt), s = Math.sin(b.w * dt);
        const vx = b.vx * c - b.vy * s;
        b.vy = b.vx * s + b.vy * c;
        b.vx = vx;
        break;
      }
      case 'accel': {
        const sp = Math.hypot(b.vx, b.vy);
        const ns = Math.min(b.max, sp + b.acc * dt);
        b.vx *= ns / sp; b.vy *= ns / sp;
        break;
      }
      case 'homing': {
        if (b.t < b.homeT) {
          const sp = Math.hypot(b.vx, b.vy);
          const cur = Math.atan2(b.vy, b.vx);
          const want = Math.atan2(player.y - b.y, player.x - b.x);
          const na = cur + clamp(angleDiff(cur, want), -b.turn * dt, b.turn * dt);
          b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
        }
        break;
      }
      case 'zigzag': {
        if (b.t >= b.nextZig) {
          b.nextZig += b.zigT;
          const a = b.zigA * b.zigDir;
          b.zigDir = -b.zigDir;
          const c = Math.cos(a), s = Math.sin(a);
          const vx = b.vx * c - b.vy * s;
          b.vy = b.vx * s + b.vy * c;
          b.vx = vx;
        }
        break;
      }
    }

    if (b.kind === 'wave') {
      b.bx += b.vx * dt; b.by += b.vy * dt;
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const off = Math.sin(b.t * b.freq) * b.amp;
      b.x = b.bx + (-b.vy / sp) * off;
      b.y = b.by + (b.vx / sp) * off;
    } else {
      b.x += b.vx * dt; b.y += b.vy * dt;
    }

    if (b.kind === 'bounce' && b.bounces > 0) {
      if ((b.x < b.r && b.vx < 0) || (b.x > W - b.r && b.vx > 0)) { b.vx = -b.vx; b.bounces--; }
      if ((b.y < b.r && b.vy < 0) || (b.y > H - b.r && b.vy > 0)) { b.vy = -b.vy; b.bounces--; }
    }

    if (b.kind === 'split' && b.t >= b.fuse) {
      b.dead = true;
      const off = rand(0, TAU);
      for (let k = 0; k < b.parts; k++) {
        addBullet(b.x, b.y, off + (k / b.parts) * TAU, 150, { r: 4, color: '#fca5a5' });
      }
      burst(b.x, b.y, '#f8fafc', 8, 120);
    }
  }

  // ==================================================================
  // 웨이브 이벤트 (경고 후 발동하는 포탑 등)
  // ==================================================================
  function safePoint(minFromPlayer) {
    for (let k = 0; k < 20; k++) {
      const p = { x: rand(60, W - 60), y: rand(60, H - 60) };
      if (dist(p, player) >= minFromPlayer) return p;
    }
    return { x: player.x < W / 2 ? W - 80 : 80, y: player.y < H / 2 ? H - 80 : 80 };
  }

  function triggerEvent(type) {
    const sp = stage.speed;
    if (type === 'fan') {
      const p = edgePoint();
      const a0 = Math.atan2(player.y - p.y, player.x - p.x);
      const n = 5 + Math.floor(stageIdx / 3);
      for (let k = 0; k < n; k++) addBullet(p.x, p.y, a0 + (k - (n - 1) / 2) * 0.13, sp * 1.1);
    } else if (type === 'wall') {
      const fromTop = Math.random() < 0.5;
      const horizontal = Math.random() < 0.5;
      const len = horizontal ? H : W;
      const gap = rand(80, len - 160);
      const gapW = 120 - stageIdx * 3;
      for (let v = 10; v < len; v += 26) {
        if (v > gap && v < gap + gapW) continue;
        if (horizontal) addBullet(fromTop ? -12 : W + 12, v, fromTop ? 0 : Math.PI, sp * 0.75, { r: 5 });
        else addBullet(v, fromTop ? -12 : H + 12, fromTop ? Math.PI / 2 : -Math.PI / 2, sp * 0.75, { r: 5 });
      }
    } else if (type === 'turretRing' || type === 'turretSpiral') {
      const p = safePoint(230);
      hazards.push({ x: p.x, y: p.y, type, t: 0, delay: 1.1, dur: type === 'turretSpiral' ? 2.2 : 0, cd: 0, ang: rand(0, TAU) });
    }
  }

  function updateHazards(dt) {
    for (const h of hazards) {
      h.t += dt;
      if (h.t < h.delay) continue;
      if (h.type === 'turretRing') {
        const n = 14 + stageIdx * 2;
        for (let k = 0; k < n; k++) addBullet(h.x, h.y, h.ang + (k / n) * TAU, stage.speed * 0.9);
        burst(h.x, h.y, stage.colors.accent, 12, 150);
        h.dead = true;
      } else if (h.type === 'turretSpiral') {
        h.cd -= dt;
        while (h.cd <= 0) {
          h.cd += 0.07;
          for (let k = 0; k < 2; k++) addBullet(h.x, h.y, h.ang + k * Math.PI, stage.speed * 0.8, { r: 4 });
          h.ang += 0.32;
        }
        if (h.t > h.delay + h.dur) h.dead = true;
      }
    }
    hazards = hazards.filter(h => !h.dead);
  }

  // ==================================================================
  // 보스
  // ==================================================================
  function makeBoss(def) {
    const hp = def.hp;
    return {
      def, x: W / 2, y: -80, r: def.r, hp, maxHp: hp, dispHp: hp, dying: 0,
      t: 0, entering: true, patIdx: 0, patT: 0, cd: 0.5, rest: 1.0, ang: 0,
      flash: 0, alpha: 1, tx: W / 2, ty: 130, moveT: 0, tpState: 0,
      pattern: def.patterns[0],
    };
  }

  function moveBoss(b, dt) {
    const m = b.def.move;
    const t = b.t;
    if (b.entering) {
      b.y += (130 - b.y) * Math.min(1, dt * 2.2);
      if (Math.abs(b.y - 130) < 2) { b.entering = false; b.t = 0; }
      return;
    }
    if (m === 'sway') { b.x = W / 2 + Math.sin(t * 0.8) * 260; b.y = 130 + Math.sin(t * 1.6) * 20; }
    else if (m === 'float') { b.x = W / 2 + Math.sin(t * 0.5) * 220; b.y = 150 + Math.sin(t * 1.1) * 60; }
    else if (m === 'center') { b.x = W / 2 + Math.sin(t * 1.3) * 40; b.y = 170 + Math.sin(t * 0.9) * 30; }
    else if (m === 'orbit') { b.x = W / 2 + Math.cos(t * 0.7) * 230; b.y = 220 + Math.sin(t * 0.7) * 120; }
    else if (m === 'figure8') { b.x = W / 2 + Math.sin(t * 0.6) * 280; b.y = 200 + Math.sin(t * 1.2) * 110; }
    else if (m === 'dash') {
      b.moveT -= dt;
      if (b.moveT <= 0) { b.moveT = 2.6; b.tx = rand(90, W - 90); b.ty = rand(80, H * 0.45); }
      b.x += (b.tx - b.x) * Math.min(1, dt * 3);
      b.y += (b.ty - b.y) * Math.min(1, dt * 3);
    } else if (m === 'teleport') {
      b.moveT -= dt;
      if (b.tpState === 0 && b.moveT <= 0) { b.tpState = 1; }
      if (b.tpState === 1) {
        b.alpha -= dt * 3;
        if (b.alpha <= 0) {
          b.alpha = 0;
          const p = safePoint(260);
          b.x = p.x; b.y = Math.min(p.y, H * 0.6);
          b.tpState = 2;
        }
      } else if (b.tpState === 2) {
        b.alpha += dt * 3;
        if (b.alpha >= 1) { b.alpha = 1; b.tpState = 0; b.moveT = 3.2; }
      }
    }
  }

  function firePattern(b, name) {
    // 보스 강도: 1단계 0.45(매우 쉬움) → 10단계 1.12
    const i = stageIdx;
    const power = 0.45 + i * 0.075;
    const sp = 105 + i * 14;
    const enraged = i >= 2 && b.hp <= b.maxHp / 2;
    const rate = (enraged ? 0.75 : 1) / power;
    const N = n => Math.max(2, Math.round(n * (0.5 + i * 0.06)));
    const toP = Math.atan2(player.y - b.y, player.x - b.x);
    let cd = 1;

    switch (name) {
      case 'aimed': {
        const n = N(3 + Math.floor(i / 3)) + (enraged ? 2 : 0);
        for (let k = 0; k < n; k++) addBullet(b.x, b.y, toP + (k - (n - 1) / 2) * 0.2, sp * 1.15);
        cd = 0.7; break;
      }
      case 'ring': {
        const n = N(12 + i * 2);
        b.ang += 0.3;
        for (let k = 0; k < n; k++) addBullet(b.x, b.y, b.ang + (k / n) * TAU, sp);
        cd = 1.1; break;
      }
      case 'spiral': {
        const arms = i >= 7 ? 3 : 2;
        for (let k = 0; k < arms; k++) addBullet(b.x, b.y, b.ang + (k / arms) * TAU, sp * 0.9, { r: 4 });
        b.ang += 0.22;
        cd = 0.075; break;
      }
      case 'curveRing': {
        const n = N(10 + i);
        b.ang += 0.25;
        for (let k = 0; k < n; k++) {
          addBullet(b.x, b.y, b.ang + (k / n) * TAU, sp * 0.85, { kind: 'curve', w: k % 2 ? 0.8 : -0.8 });
        }
        cd = 1.3; break;
      }
      case 'waveFan': {
        for (let k = 0; k < 5; k++) addBullet(b.x, b.y, toP + (k - 2) * 0.32, sp * 0.9, { kind: 'wave', amp: 32, freq: 5, color: '#a5f3fc' });
        cd = 0.8; break;
      }
      case 'rain': {
        const kind = i >= 6 ? 'accel' : 'straight';
        addBullet(rand(10, W - 10), -12, Math.PI / 2 + rand(-0.12, 0.12), sp * rand(0.7, 1.2),
          kind === 'accel' ? { kind, acc: 160, max: sp * 2, color: '#fb923c' } : {});
        cd = 0.09; break;
      }
      case 'rainUp': {
        addBullet(rand(10, W - 10), H + 12, -Math.PI / 2 + rand(-0.1, 0.1), sp * rand(0.6, 1),
          { kind: 'wave', amp: rand(10, 25), freq: rand(3, 5), r: rand(4, 8), color: '#a5f3fc' });
        cd = 0.12; break;
      }
      case 'accelBurst': {
        const n = N(16 + i);
        b.ang += 0.2;
        for (let k = 0; k < n; k++) addBullet(b.x, b.y, b.ang + (k / n) * TAU, 40, { kind: 'accel', acc: 230, max: sp * 2, color: '#fb7185' });
        cd = 1.2; break;
      }
      case 'homingVolley': {
        for (let k = 0; k < 4; k++) addBullet(b.x, b.y, rand(0, TAU), sp * 0.8, { kind: 'homing', homeT: 2, turn: 2, color: '#c084fc', r: 6 });
        cd = 1.6; break;
      }
      case 'bounceSpray': {
        addBullet(b.x, b.y, rand(0, TAU), sp * 1.05, { kind: 'bounce', bounces: 2, color: '#4ade80' });
        cd = 0.16; break;
      }
      case 'cross': {
        const arms = i >= 9 ? 6 : 4;
        for (let k = 0; k < arms; k++) addBullet(b.x, b.y, b.ang + (k / arms) * TAU, sp, { r: 4 });
        b.ang += 0.065;
        cd = 0.09; break;
      }
      case 'splitBomb': {
        addBullet(b.x, b.y, toP + rand(-0.2, 0.2), sp * 0.9, { kind: 'split', fuse: 1.0, parts: N(10 + i), r: 10, color: '#f8fafc' });
        cd = 1.0; break;
      }
      case 'zigzagFan': {
        for (let k = 0; k < 4; k++) addBullet(b.x, b.y, toP + (k - 1.5) * 0.4 - 0.37, sp, { kind: 'zigzag', zigT: 0.3, zigA: 0.75, zigDir: 1, color: '#fde047' });
        cd = 0.9; break;
      }
    }
    b.cd = cd * rate;
  }

  function updateBoss(dt) {
    const b = boss;
    b.t += dt;
    b.flash = Math.max(0, b.flash - dt);
    b.dispHp += (b.hp - b.dispHp) * Math.min(1, dt * 8);

    // 체력이 0이 된 뒤의 폭발 연출 (이 동안 보스는 공격하지 않음)
    if (b.dying > 0) {
      b.dying -= dt;
      shake = Math.max(shake, 0.25);
      if (Math.random() < dt * 14) burst(b.x + rand(-b.r, b.r), b.y + rand(-b.r, b.r), pick([b.def.color, '#ffffff', '#fde047']), 10, 200);
      if (b.dying <= 0) bossDefeated();
      return;
    }

    moveBoss(b, dt);
    if (b.entering || b.alpha < 0.6) return;

    if (b.rest > 0) { b.rest -= dt; return; }
    b.patT += dt;
    b.cd -= dt;
    if (b.cd <= 0) firePattern(b, b.pattern);
    if (b.patT > 4.5) {
      b.patT = 0;
      b.rest = 0.5 + 0.9 * (1 - stageIdx / 9);
      b.cd = 0.2;
      const list = b.def.patterns;
      b.pattern = b.def.random ? pick(list) : list[++b.patIdx % list.length];
    }

    // 보스 공격 아이템 생성 (초반 스테이지일수록 자주)
    orbTimer -= dt;
    if (orbTimer <= 0 && orbs.length < 2) {
      orbTimer = 1.4 + stageIdx * 0.12;
      for (let k = 0; k < 20; k++) {
        const p = { x: rand(50, W - 50), y: rand(80, H - 50) };
        if (dist(p, b) > 170 && dist(p, player) > 110) { orbs.push({ x: p.x, y: p.y, t: 0, life: 9, type: pickItem() }); break; }
      }
    }

    if (dist(b, player) < b.r + player.r - 2 && b.alpha > 0.8 && b.dying <= 0) hurt();
  }

  // ==================================================================
  // 보스 공격 아이템
  // ==================================================================
  const ITEMS = {
    orb:    { icon: '★', color: '#fde047', w: 40, label: '공격 +1' },
    triple: { icon: '⚡', color: '#38bdf8', w: 16, label: '트리플 샷! (3연타)' },
    bomb:   { icon: '💣', color: '#f43f5e', w: 10, label: '폭탄! 탄막 제거 + 2연타' },
    shield: { icon: '🛡', color: '#4ade80', w: 12, label: '방패 장착! (1회 방어)' },
    slow:   { icon: '⏳', color: '#c084fc', w: 13, label: '시간 감속! (5초)' },
    heart:  { icon: '❤', color: '#fb7185', w: 9, label: '생명 +1' },
  };

  function pickItem() {
    const w = {};
    for (const [k, v] of Object.entries(ITEMS)) {
      if (k === 'heart' && lives >= 5) continue;
      if (k === 'shield' && player.shield) continue;
      w[k] = v.w;
    }
    return weighted(w);
  }

  function fireShot(x, y, delay, dmg, color, size) {
    shots.push({ x, y, t: -delay, dmg, color, size });
  }

  function collectItem(o) {
    const it = ITEMS[o.type];
    score += 50;
    burst(o.x, o.y, it.color, 14, 170);
    floaters.push({ x: o.x, y: o.y - 18, text: it.label, color: it.color, t: 0 });
    switch (o.type) {
      case 'orb':
        Sound.sfx('orb');
        fireShot(o.x, o.y, 0, 1, it.color, 6);
        break;
      case 'triple':
        Sound.sfx('triple');
        for (let k = 0; k < 3; k++) fireShot(o.x, o.y, k * 0.15, 1, it.color, 5);
        break;
      case 'bomb':
        Sound.sfx('bomb');
        for (const b of bullets) burst(b.x, b.y, b.color, 2, 80);
        bullets = []; hazards = [];
        flash = 0.4; shake = 0.35;
        fireShot(o.x, o.y, 0, 1, it.color, 9);
        fireShot(o.x, o.y, 0.2, 1, it.color, 9);
        break;
      case 'shield':
        Sound.sfx('shield');
        player.shield = true;
        fireShot(o.x, o.y, 0, 1, it.color, 6);
        break;
      case 'slow':
        Sound.sfx('slow');
        slowT = 5;
        fireShot(o.x, o.y, 0, 1, it.color, 6);
        break;
      case 'heart':
        Sound.sfx('extraLife');
        lives = Math.min(5, lives + 1);
        fireShot(o.x, o.y, 0, 1, it.color, 6);
        break;
    }
  }

  // 아이템 1개 = 보스 체력 1칸 이상. 체력이 정확히 0이 되어야만 쓰러집니다.
  function damageBoss(dmg = 1) {
    if (!boss || boss.dying > 0 || boss.hp <= 0) return;
    boss.hp = Math.max(0, boss.hp - dmg);
    boss.flash = 0.15;
    score += 100;
    shake = Math.max(shake, 0.15);
    burst(boss.x, boss.y, '#ffffff', 14, 220);
    Sound.sfx('bossHit');
    if (boss.hp === 0) {
      boss.dying = 1.8;
      for (const bl of bullets) burst(bl.x, bl.y, bl.color, 2, 60);
      bullets = []; hazards = []; orbs = []; shots = [];
      Sound.stopMusic();
      Sound.sfx('bossDie');
    }
  }

  function bossDefeated() {
    const b = boss;
    for (let k = 0; k < 6; k++) burst(b.x + rand(-40, 40), b.y + rand(-40, 40), pick([b.def.color, '#ffffff', stage.colors.accent]), 30, 360);
    bullets = []; hazards = []; orbs = []; shots = [];
    boss = null;
    flash = 0.6;
    shake = 0.6;
    score += 1000 * (stageIdx + 1);
    const gainedLife = lives < 5;
    lives = Math.min(5, lives + 1);
    Sound.sfx(stageIdx === STAGES.length - 1 ? 'allClear' : 'stageClear');
    if (gainedLife) setTimeout(() => Sound.sfx('extraLife'), 1300);
    if (stageIdx + 2 > maxStage) {
      maxStage = Math.min(STAGES.length, stageIdx + 2);
      store.set('dodge-max-stage', maxStage);
    }
    setPhase('clear');
  }

  // ==================================================================
  // 파티클
  // ==================================================================
  function burst(x, y, color, n, power) {
    if (particles.length > 900) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = power * (0.3 + Math.random());
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.7, color });
    }
  }

  // ==================================================================
  // 진행
  // ==================================================================
  function setPhase(p) {
    phase = p;
    phaseT = 0;
  }

  function startGame(stageNum) {
    score = 0;
    lives = 3;
    startStage(stageNum - 1);
    state = 'playing';
    hidePanel();
    Sound.sfx('start');
  }

  function startStage(i) {
    stageIdx = i;
    stage = STAGES[i];
    resetField();
    spawnTimer = 0.4;
    eventTimer = stage.eventEvery;
    orbTimer = 1.5;
    stageTime = 0;
    stageHits = 0;
    stageScore0 = score;
    setPhase('intro');
    Sound.playTheme(stage.music, false, i + 1);
  }

  function hurt() {
    if (player.inv > 0 || state !== 'playing' || (window.DodgeDebug && window.DodgeDebug.god)) return;
    if (player.shield) {
      player.shield = false;
      player.inv = 1.0;
      burst(player.x, player.y, '#4ade80', 20, 200);
      floaters.push({ x: player.x, y: player.y - 20, text: '방어!', color: '#4ade80', t: 0 });
      Sound.sfx('shield');
      bullets = bullets.filter(b => Math.hypot(b.x - player.x, b.y - player.y) > 110);
      return;
    }
    lives--;
    stageHits++;
    shake = 0.4;
    flash = 0.25;
    burst(player.x, player.y, '#5eead4', 24, 220);
    if (lives <= 0) { gameOver(); return; }
    Sound.sfx('hit');
    player.inv = 2.0;
    bullets = bullets.filter(b => Math.hypot(b.x - player.x, b.y - player.y) > 150);
  }

  function saveBest() {
    if (score > bestScore) {
      bestScore = Math.floor(score);
      store.set('dodge-best-score', bestScore);
      return true;
    }
    return false;
  }

  function gameOver() {
    state = 'over';
    burst(player.x, player.y, '#5eead4', 40, 260);
    Sound.stopMusic();
    Sound.sfx('die');
    const isNew = saveBest();
    setTimeout(() => {
      showPanel(`
        <h1>GAME OVER</h1>
        <p>STAGE ${stageIdx + 1} · ${stage.name}에서 쓰러졌습니다.</p>
        <p class="score-line">점수 ${Math.floor(score).toLocaleString()}${isNew ? ' · 신기록!' : ''}</p>
        <div class="btn-row">
          <button class="primary" data-action="start" data-stage="${stageIdx + 1}">이 스테이지부터 다시</button>
          <button data-action="start" data-stage="1">처음부터</button>
          <button data-action="title">타이틀</button>
        </div>`);
    }, 900);
  }

  function ending() {
    state = 'ending';
    const isNew = saveBest();
    Sound.playTheme(STAGES[1].music, false, 77);
    showPanel(`
      <h1>ALL CLEAR!</h1>
      <p>10개 스테이지와 모든 보스를 물리쳤습니다. 축하합니다!</p>
      <p class="score-line">최종 점수 ${Math.floor(score).toLocaleString()}${isNew ? ' · 신기록!' : ''}</p>
      <div class="btn-row">
        <button class="primary" data-action="start" data-stage="1">다시 도전</button>
        <button data-action="title">타이틀</button>
      </div>`);
  }

  function update(dt) {
    animT += dt;
    shake = Math.max(0, shake - dt);
    flash = Math.max(0, flash - dt);

    if (state === 'playing') {
      phaseT += dt;
      if (phase !== 'clear') stageTime += dt;
      bossHintT = Math.max(0, bossHintT - dt);
      player.inv = Math.max(0, player.inv - dt);
      movePlayer(dt);

      if (phase === 'intro' && phaseT > 3) setPhase('wave');

      if (phase === 'wave') {
        score += dt * 10 * (stageIdx + 1);
        spawnTimer -= dt;
        const interval = stage.spawn * Math.max(0.6, 1 - phaseT / stage.waveTime * 0.35);
        while (spawnTimer <= 0) { spawnEdgeBullet(); spawnTimer += interval; }
        if (stage.events.length) {
          eventTimer -= dt;
          if (eventTimer <= 0) { eventTimer = stage.eventEvery * rand(0.8, 1.2); triggerEvent(pick(stage.events)); }
        }
        if (phaseT >= stage.waveTime) {
          setPhase('warning');
          Sound.stopMusic();
          Sound.sfx('warning');
        }
      }

      if (phase === 'warning' && phaseT > 2.4) {
        boss = makeBoss(stage.boss);
        setPhase('boss');
        bossHintT = stageIdx === 0 ? 6 : 3.5;
        Sound.playTheme(stage.music, true, stageIdx + 1);
      }

      if (phase === 'boss' && boss) {
        score += dt * 10 * (stageIdx + 1);
        updateBoss(dt);
      }

      // 클리어 연출 후 자동으로 다음 스테이지
      if (phase === 'clear' && phaseT > 3.8) {
        if (stageIdx >= STAGES.length - 1) ending();
        else { startStage(stageIdx + 1); Sound.sfx('start'); }
      }

      updateHazards(dt);
      slowT = Math.max(0, slowT - dt);
      const bdt = slowT > 0 ? dt * 0.45 : dt;
      for (const b of bullets) updateBullet(b, bdt);
      bullets = bullets.filter(b => !b.dead && b.x > -60 && b.x < W + 60 && b.y > -60 && b.y < H + 60);

      // 충돌
      if (phase !== 'clear' && player.inv <= 0) {
        for (const b of bullets) {
          const dx = b.x - player.x, dy = b.y - player.y, rr = b.r + player.r - 2;
          if (dx * dx + dy * dy < rr * rr) { hurt(); break; }
        }
      }

      // 아이템 수집 → 보스 공격
      for (const o of orbs) {
        o.t += dt;
        if (dist(o, player) < player.r + 15) { o.dead = true; collectItem(o); }
        else if (o.t > o.life) o.dead = true;
      }
      orbs = orbs.filter(o => !o.dead);

      for (const s of shots) {
        s.t += dt;
        if (!boss || boss.dying > 0) { s.dead = true; continue; }
        if (s.t < 0) continue;
        const a = Math.atan2(boss.y - s.y, boss.x - s.x);
        const sp = 500 + s.t * 600;
        s.x += Math.cos(a) * sp * dt;
        s.y += Math.sin(a) * sp * dt;
        if (particles.length < 900) particles.push({ x: s.x, y: s.y, vx: 0, vy: 0, life: 0.25, color: s.color });
        if (dist(s, boss) < boss.r) { s.dead = true; damageBoss(s.dmg); if (!boss) break; }
      }
      shots = shots.filter(s => !s.dead);

      for (const f of floaters) f.t += dt;
      floaters = floaters.filter(f => f.t < 1.4);
    }

    if (state !== 'paused') {
      for (const p of particles) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.95; p.vy *= 0.95;
        p.life -= dt;
      }
      particles = particles.filter(p => p.life > 0);
    }
  }

  function movePlayer(dt) {
    let dx = 0, dy = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) dx -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) dx += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) dy -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) dy += 1;
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      player.x += (dx / len) * player.speed * dt;
      player.y += (dy / len) * player.speed * dt;
    } else if (pointer.active) {
      const px = pointer.x - player.x, py = pointer.y - player.y;
      const d = Math.hypot(px, py);
      if (d > 1) {
        const m = Math.min(player.speed * dt, d);
        player.x += (px / d) * m;
        player.y += (py / d) * m;
      }
    }
    player.x = clamp(player.x, player.r, W - player.r);
    player.y = clamp(player.y, player.r, H - player.r);
  }

  // ==================================================================
  // 배경
  // ==================================================================
  const STARS = Array.from({ length: 140 }, () => ({ x: Math.random() * W, y: Math.random() * H, z: Math.random() }));
  const EMBERS = Array.from({ length: 90 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: rand(20, 70), p: rand(0, TAU) }));
  const DROPS = Array.from({ length: 110 }, () => ({ x: Math.random() * (W + 200), y: Math.random() * H, s: rand(500, 800) }));
  let lightning = 0;

  function gradientBg(c1, c2, vertical = true) {
    const g = vertical ? ctx.createLinearGradient(0, 0, 0, H) : ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawBackground(st, t, dt) {
    const c = st.colors;
    ctx.save();
    switch (st.bg) {
      case 'grid': {
        gradientBg(c.bg, c.bg2);
        ctx.strokeStyle = c.line;
        ctx.lineWidth = 1;
        const off = (t * 18) % 40;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
        for (let y = -40 + off; y <= H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
        ctx.stroke();
        break;
      }
      case 'stars': {
        gradientBg(c.bg, c.bg2);
        for (const s of STARS) {
          s.y += (20 + s.z * 70) * dt;
          if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
          const tw = 0.5 + 0.5 * Math.sin(t * 3 + s.x);
          ctx.globalAlpha = 0.25 + s.z * 0.6 * tw;
          ctx.fillStyle = s.z > 0.85 ? c.accent : '#ffffff';
          const sz = 1 + s.z * 2;
          ctx.fillRect(s.x, s.y, sz, sz);
        }
        break;
      }
      case 'waves': {
        gradientBg(c.bg2, c.bg);
        ctx.lineWidth = 2;
        for (let k = 0; k < 7; k++) {
          ctx.strokeStyle = c.line;
          ctx.globalAlpha = 0.4 + k * 0.08;
          ctx.beginPath();
          const base = 70 + k * 80;
          for (let x = 0; x <= W; x += 16) {
            const y = base + Math.sin(x * 0.012 + t * (0.6 + k * 0.15) + k) * (14 + k * 3);
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        break;
      }
      case 'rain': {
        gradientBg(c.bg, c.bg2);
        ctx.strokeStyle = c.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const d of DROPS) {
          d.y += d.s * dt; d.x -= d.s * 0.25 * dt;
          if (d.y > H) { d.y = -20; d.x = Math.random() * (W + 200); }
          ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + 5, d.y - 20);
        }
        ctx.stroke();
        if (Math.random() < 0.004) lightning = 0.18;
        if (lightning > 0) {
          lightning -= dt;
          ctx.globalAlpha = Math.max(0, lightning) * 1.5;
          ctx.fillStyle = '#e0e7ff';
          ctx.fillRect(0, 0, W, H);
        }
        break;
      }
      case 'rings': {
        gradientBg(c.bg2, c.bg, false);
        ctx.strokeStyle = c.line;
        ctx.lineWidth = 3;
        for (let k = 0; k < 8; k++) {
          const r = (t * 70 + k * 80) % 640;
          ctx.globalAlpha = Math.max(0, 1 - r / 640);
          ctx.beginPath();
          ctx.arc(W / 2, H / 2, r, 0, TAU);
          ctx.stroke();
        }
        break;
      }
      case 'circuit': {
        gradientBg(c.bg, c.bg2);
        ctx.strokeStyle = c.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let y = 30; y < H; y += 60) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
        for (let x = 40; x < W; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
        ctx.stroke();
        ctx.fillStyle = c.accent;
        for (let r = 0; r < 10; r++) {
          const y = 30 + r * 60;
          const x = (t * (120 + r * 23) + r * 137) % (W + 60) - 30;
          ctx.globalAlpha = 0.55;
          ctx.fillRect(x, y - 1.5, 24, 3);
        }
        for (let q = 0; q < 10; q++) {
          const x = 40 + q * 80;
          const y = (t * (90 + q * 17) + q * 211) % (H + 60) - 30;
          ctx.globalAlpha = 0.35;
          ctx.fillRect(x - 1.5, y, 3, 20);
        }
        break;
      }
      case 'embers': {
        gradientBg(c.bg, c.bg2);
        ctx.fillStyle = c.line;
        for (const e of EMBERS) {
          e.y -= e.s * dt;
          if (e.y < -10) { e.y = H + 10; e.x = Math.random() * W; }
          const x = e.x + Math.sin(t * 2 + e.p) * 10;
          ctx.globalAlpha = 0.3 + 0.7 * (e.y / H);
          ctx.fillRect(x, e.y, 3, 3);
        }
        break;
      }
      case 'hex': {
        gradientBg(c.bg, c.bg2);
        const s = 34;
        const hw = Math.sqrt(3) * s;
        ctx.strokeStyle = c.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let row = -1; row * s * 1.5 < H + s; row++) {
          for (let col = -1; col * hw < W + hw; col++) {
            const cx = col * hw + (row % 2 ? hw / 2 : 0);
            const cy = row * s * 1.5;
            for (let k = 0; k < 6; k++) {
              const a = Math.PI / 6 + k * Math.PI / 3;
              const px = cx + Math.cos(a) * s, py = cy + Math.sin(a) * s;
              if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
          }
        }
        ctx.stroke();
        const sx = ((t * 120) % (W + 400)) - 200;
        const g = ctx.createLinearGradient(sx - 120, 0, sx + 120, H);
        g.addColorStop(0, 'rgba(165,243,252,0)');
        g.addColorStop(0.5, 'rgba(165,243,252,0.08)');
        g.addColorStop(1, 'rgba(165,243,252,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        break;
      }
      case 'aurora': {
        gradientBg(c.bg, c.bg2);
        const cols = ['rgba(134,239,172,', 'rgba(103,232,249,', 'rgba(192,132,252,'];
        for (let k = 0; k < 3; k++) {
          const base = 120 + k * 90;
          ctx.beginPath();
          for (let x = 0; x <= W; x += 20) {
            const y = base + Math.sin(x * 0.006 + t * (0.4 + k * 0.1) + k * 2) * 45;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          for (let x = W; x >= 0; x -= 20) {
            const y = base + 110 + Math.sin(x * 0.005 + t * 0.3 + k) * 30;
            ctx.lineTo(x, y);
          }
          ctx.closePath();
          const g = ctx.createLinearGradient(0, base - 40, 0, base + 150);
          g.addColorStop(0, cols[k] + '0)');
          g.addColorStop(0.4, cols[k] + '0.22)');
          g.addColorStop(1, cols[k] + '0)');
          ctx.fillStyle = g;
          ctx.fill();
        }
        for (const s of STARS) {
          if (s.z < 0.6) continue;
          ctx.globalAlpha = 0.4 * s.z;
          ctx.fillStyle = '#fff';
          ctx.fillRect(s.x, s.y, 1.5, 1.5);
        }
        break;
      }
      case 'void': {
        gradientBg(c.bg2, c.bg, false);
        ctx.fillStyle = c.line;
        for (let arm = 0; arm < 6; arm++) {
          for (let r = 10; r < 520; r += 9) {
            const a = arm * (TAU / 6) + r * 0.012 + t * 0.35;
            ctx.globalAlpha = 0.85 * (1 - r / 520);
            ctx.fillRect(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r, 3, 3);
          }
        }
        if (Math.random() < 0.03) {
          ctx.globalAlpha = 0.15;
          ctx.fillStyle = c.accent;
          ctx.fillRect(0, rand(0, H), W, rand(2, 10));
        }
        break;
      }
    }
    ctx.restore();
  }

  // ==================================================================
  // 그리기
  // ==================================================================
  function drawPolygon(x, y, r, sides, rot) {
    ctx.beginPath();
    if (sides === 0) { ctx.arc(x, y, r, 0, TAU); return; }
    if (sides >= 10) {
      // 가시 별 모양
      for (let k = 0; k < sides * 2; k++) {
        const rr = k % 2 ? r * 0.62 : r;
        const a = rot + (k / (sides * 2)) * TAU;
        if (k === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
    } else {
      for (let k = 0; k < sides; k++) {
        const a = rot + (k / sides) * TAU;
        if (k === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
    }
    ctx.closePath();
  }

  function drawBoss(b) {
    const d = b.def;
    ctx.save();
    ctx.globalAlpha = b.alpha;
    const enraged = b.hp <= b.maxHp / 2;
    const pulse = 1 + Math.sin(b.t * (enraged ? 10 : 4)) * 0.05;
    // 오라
    ctx.fillStyle = d.color;
    ctx.globalAlpha = b.alpha * 0.18;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.7 * pulse, 0, TAU); ctx.fill();
    ctx.globalAlpha = b.alpha;
    // 본체
    drawPolygon(b.x, b.y, b.r * pulse, d.sides, b.t * 0.8);
    ctx.fillStyle = b.flash > 0 ? '#ffffff' : d.color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = enraged ? '#fef2f2' : 'rgba(255,255,255,0.7)';
    ctx.stroke();
    // 해파리 촉수
    if (d.name === '심연의 해파리') {
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 3;
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        const sx = b.x + (k - 2) * 14;
        ctx.moveTo(sx, b.y + b.r * 0.6);
        for (let s = 1; s <= 6; s++) ctx.lineTo(sx + Math.sin(b.t * 4 + k + s) * 6, b.y + b.r * 0.6 + s * 9);
        ctx.stroke();
      }
    }
    // 핵
    drawPolygon(b.x, b.y, b.r * 0.38, d.sides === 0 ? 0 : d.sides, -b.t * 1.6);
    ctx.fillStyle = enraged ? '#fecaca' : '#0b0f1a';
    ctx.fill();
    // 눈
    const toP = Math.atan2(player.y - b.y, player.x - b.x);
    ctx.fillStyle = enraged ? '#e11d48' : '#ffffff';
    ctx.beginPath();
    ctx.arc(b.x + Math.cos(toP) * b.r * 0.15, b.y + Math.sin(toP) * b.r * 0.15, b.r * 0.14, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawHeart(x, y, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y, x - s / 2, y, x - s / 2, y + s * 0.3);
    ctx.bezierCurveTo(x - s / 2, y + s * 0.6, x, y + s * 0.8, x, y + s);
    ctx.bezierCurveTo(x, y + s * 0.8, x + s / 2, y + s * 0.6, x + s / 2, y + s * 0.3);
    ctx.bezierCurveTo(x + s / 2, y, x, y, x, y + s * 0.3);
    ctx.fill();
  }

  function drawBanner(text, sub, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, H / 2 - 60, W, 120);
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.font = 'bold 46px "Segoe UI", "Malgun Gothic", sans-serif';
    ctx.fillText(text, W / 2, H / 2 + 4);
    if (sub) {
      ctx.font = '20px "Segoe UI", "Malgun Gothic", sans-serif';
      ctx.fillStyle = '#e8ecf5';
      ctx.fillText(sub, W / 2, H / 2 + 38);
    }
    ctx.restore();
  }

  function drawHUD() {
    const c = stage.colors;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = c.accent;
    ctx.font = 'bold 16px "Segoe UI", "Malgun Gothic", sans-serif';
    ctx.fillText(`STAGE ${stageIdx + 1} · ${stage.name}`, 16, 28);
    ctx.fillStyle = '#e8ecf5';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.fillText(Math.floor(score).toLocaleString(), 16, 54);

    for (let k = 0; k < 5; k++) {
      drawHeart(W - 24 - k * 26, 16, 18, k < lives ? '#f43f5e' : 'rgba(148,163,184,0.25)');
    }

    // 진행 바 / 보스 체력
    const bw = 300, bx = W / 2 - bw / 2, by = 18;
    if (phase === 'wave' || phase === 'intro') {
      const p = phase === 'intro' ? 0 : clamp(phaseT / stage.waveTime, 0, 1);
      ctx.fillStyle = 'rgba(148,163,184,0.2)';
      ctx.fillRect(bx, by, bw, 8);
      ctx.fillStyle = c.accent;
      ctx.fillRect(bx, by, bw * p, 8);
      ctx.textAlign = 'center';
      ctx.font = '12px "Segoe UI", "Malgun Gothic", sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('보스 출현까지', W / 2, by + 24);
    } else if (phase === 'boss' && boss) {
      ctx.fillStyle = 'rgba(148,163,184,0.2)';
      ctx.fillRect(bx, by, bw, 10);
      ctx.fillStyle = boss.hp <= boss.maxHp / 2 ? '#f43f5e' : boss.def.color;
      ctx.fillRect(bx, by, bw * clamp(boss.dispHp / boss.maxHp, 0, 1), 10);
      // 체력 칸 구분선
      ctx.fillStyle = 'rgba(11,15,26,0.7)';
      for (let k = 1; k < boss.maxHp; k++) ctx.fillRect(bx + (bw * k) / boss.maxHp - 1, by, 2, 10);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.strokeRect(bx, by, bw, 10);
      ctx.textAlign = 'center';
      ctx.font = 'bold 13px "Segoe UI", "Malgun Gothic", sans-serif';
      ctx.fillStyle = '#e8ecf5';
      ctx.fillText(`BOSS · ${boss.def.name}  ${boss.hp} / ${boss.maxHp}`, W / 2, by + 27);
    }
    ctx.restore();
  }

  function draw(dt) {
    ctx.save();
    if (shake > 0) ctx.translate(rand(-1, 1) * shake * 14, rand(-1, 1) * shake * 14);

    drawBackground(stage, animT, state === 'paused' ? 0 : dt);

    // 경고 포탑
    for (const h of hazards) {
      const p = Math.min(1, h.t / h.delay);
      ctx.save();
      ctx.strokeStyle = stage.colors.accent;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.4 + 0.5 * Math.abs(Math.sin(h.t * 12));
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(h.x, h.y, 34 - p * 18, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = stage.colors.accent;
      ctx.beginPath(); ctx.arc(h.x, h.y, 5, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // 보스 공격 아이템
    for (const o of orbs) {
      const it = ITEMS[o.type];
      const fade = o.life - o.t < 2 ? (Math.floor(o.t * 8) % 2 ? 0.35 : 1) : 1;
      const pr = 13 + Math.sin(o.t * 6) * 2;
      ctx.save();
      ctx.globalAlpha = 0.25 * fade;
      ctx.fillStyle = it.color;
      ctx.beginPath(); ctx.arc(o.x, o.y, pr * 1.9, 0, TAU); ctx.fill();
      ctx.globalAlpha = fade;
      if (o.type === 'orb') {
        drawPolygon(o.x, o.y, pr, 10, o.t * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(11,15,26,0.85)';
        ctx.beginPath(); ctx.arc(o.x, o.y, pr, 0, TAU); ctx.fill();
        ctx.strokeStyle = it.color;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.fillStyle = it.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '15px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
        ctx.fillText(it.icon, o.x, o.y + 1);
      }
      ctx.restore();
    }

    if (boss) drawBoss(boss);

    // 탄
    for (const b of bullets) {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.9, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      if (b.kind === 'split') {
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (1 - b.t / b.fuse) + 2, 0, TAU); ctx.stroke();
      }
    }

    // 공격 탄
    for (const s of shots) {
      if (s.t < 0) continue;
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, TAU); ctx.fill();
    }

    // 플레이어
    if (state !== 'title' && state !== 'over' && !(player.inv > 0 && Math.floor(player.inv * 12) % 2)) {
      ctx.save();
      ctx.fillStyle = '#5eead4';
      ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(player.x, player.y, player.r * 2.2, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(player.x, player.y, 3, 0, TAU); ctx.fill();
      if (player.shield) {
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2.5;
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(animT * 8);
        ctx.beginPath(); ctx.arc(player.x, player.y, player.r + 9, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }

    // 시간 감속 효과
    if (slowT > 0) {
      ctx.fillStyle = `rgba(192,132,252,${Math.min(0.12, slowT * 0.05)})`;
      ctx.fillRect(0, 0, W, H);
    }

    // 아이템 획득 문구
    for (const f of floaters) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - f.t / 1.4);
      ctx.fillStyle = f.color;
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px "Segoe UI", "Malgun Gothic", sans-serif';
      ctx.fillText(f.text, clamp(f.x, 90, W - 90), f.y - f.t * 30);
      ctx.restore();
    }

    // 파티클
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (state === 'playing' || state === 'paused') {
      drawHUD();
      if (phase === 'intro') {
        const a = phaseT < 0.3 ? phaseT / 0.3 : phaseT > 2.6 ? Math.max(0, (3 - phaseT) / 0.4) : 1;
        drawBanner(`STAGE ${stageIdx + 1}`, stage.name, stage.colors.accent, a);
      } else if (phase === 'warning') {
        drawBanner('⚠ WARNING ⚠', `보스 「${stage.boss.name}」 접근 중`, '#f43f5e', Math.floor(phaseT * 4) % 2 ? 0.55 : 1);
      } else if (phase === 'clear') {
        const secs = Math.round(stageTime);
        const nextTxt = stageIdx < STAGES.length - 1 ? ` · 곧 STAGE ${stageIdx + 2}` : '';
        drawBanner('STAGE CLEAR!', `${secs}초 · 피격 ${stageHits}회 · +${Math.floor(score - stageScore0).toLocaleString()}점${nextTxt}`, '#fde047', Math.min(1, phaseT * 3));
      } else if (phase === 'boss' && bossHintT > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, bossHintT);
        ctx.textAlign = 'center';
        ctx.font = 'bold 16px "Segoe UI", "Malgun Gothic", sans-serif';
        ctx.fillStyle = '#fde047';
        ctx.fillText('★ 아이템을 먹으면 보스를 공격합니다! (⚡3연타 · 💣폭탄 · 🛡방패 · ⏳감속 · ❤생명)', W / 2, H - 24);
        ctx.restore();
      }
    }
  }

  // ---- 루프 ----
  let lastTime = null;
  function frame(t) {
    const dt = Math.min(0.05, (t - (lastTime ?? t)) / 1000);
    lastTime = t;
    update(state === 'paused' ? 0 : dt);
    draw(dt);
    requestAnimationFrame(frame);
  }

  // ==================================================================
  // UI
  // ==================================================================
  function showPanel(html) {
    panel.innerHTML = html;
    overlay.classList.remove('hidden');
  }
  function hidePanel() { overlay.classList.add('hidden'); }

  function showTitle() {
    state = 'title';
    stageIdx = 0;
    stage = STAGES[0];
    resetField();
    Sound.stopMusic();
    let btns = '';
    STAGES.forEach((s, i) => {
      const locked = i + 1 > maxStage;
      btns += `<button class="stage-btn" data-action="start" data-stage="${i + 1}" ${locked ? 'disabled' : ''} title="${s.name}">${locked ? '🔒' : i + 1}</button>`;
    });
    showPanel(`
      <h1>DODGE</h1>
      <p>10개의 스테이지를 돌파하고 보스를 물리치세요!</p>
      <p class="score-line">${bestScore ? `최고 점수 ${bestScore.toLocaleString()}` : ''}</p>
      <button class="primary" data-action="start" data-stage="1">게임 시작</button>
      <div class="stage-select">
        <span>스테이지 선택</span>
        <div class="stage-grid">${btns}</div>
      </div>
      <p class="help">이동: 방향키 / WASD / 드래그 · 일시정지: P · 소리: M<br>보스전에서는 아이템(★⚡💣🛡⏳❤)을 먹어 보스를 공격하세요.</p>`);
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    Sound.stopMusic();
    Sound.sfx('pause');
    showPanel(`
      <h1>PAUSED</h1>
      <p>STAGE ${stageIdx + 1} · ${stage.name}</p>
      <div class="btn-row">
        <button class="primary" data-action="resume">계속하기</button>
        <button data-action="title">타이틀</button>
      </div>`);
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'playing';
    hidePanel();
    Sound.sfx('resume');
    if (phase !== 'warning' && phase !== 'clear') Sound.startMusic();
  }

  panel.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || btn.disabled) return;
    btn.blur();
    const a = btn.dataset.action;
    if (a === 'start') startGame(Number(btn.dataset.stage) || 1);
    else if (a === 'resume') resume();
    else if (a === 'title') showTitle();
  });

  function updateSoundBtn() { soundBtn.textContent = Sound.isMuted() ? '🔇 소리 꺼짐' : '🔊 소리 켜짐'; }
  function toggleSound() { Sound.toggleMute(); updateSoundBtn(); soundBtn.blur(); }
  soundBtn.addEventListener('click', toggleSound);
  updateSoundBtn();

  window.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === 'KeyP' || e.code === 'Escape') { if (state === 'playing') pause(); else if (state === 'paused') resume(); }
    if (e.code === 'KeyM') toggleSound();
    if ((e.code === 'Enter' || e.code === 'Space') && !overlay.classList.contains('hidden')) {
      const primary = panel.querySelector('button.primary');
      if (primary) primary.click();
    }
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); pointer.active = false; pause(); });

  function toCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = (e.clientX - rect.left) * (W / rect.width);
    pointer.y = (e.clientY - rect.top) * (H / rect.height);
  }
  canvas.addEventListener('pointerdown', e => { pointer.active = true; toCanvas(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (pointer.active) toCanvas(e); });
  canvas.addEventListener('pointerup', () => { pointer.active = false; });
  canvas.addEventListener('pointercancel', () => { pointer.active = false; });

  // 테스트/디버그용: 주소 뒤에 ?debug 를 붙였을 때만 켜짐 (예: http://localhost:8765/?debug)
  if (new URLSearchParams(location.search).has('debug')) window.DodgeDebug = {
    god: false,
    stage(n) { startGame(n); },
    skipIntro() { if (phase === 'intro') phaseT = 99; },
    hitBoss(n = 1) { for (let k = 0; k < n && boss; k++) damageBoss(); },
    item(type) { orbs.push({ x: player.x, y: player.y, t: 0, life: 9, type }); },
    boss() { if (state === 'playing') phaseT = stage.waveTime; },
    info() { return { state, phase, stage: stageIdx + 1, lives, score: Math.floor(score), bullets: bullets.length, bossHp: boss && boss.hp }; },
  };

  showTitle();
  requestAnimationFrame(frame);
})();
