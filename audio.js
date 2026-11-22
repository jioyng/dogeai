// Web Audio API로 효과음과 스테이지별 배경음악을 직접 합성합니다 (외부 음원 파일 없음).
const Sound = (() => {
  'use strict';

  const MUTE_KEY = 'dodge-muted';
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* 무시 */ }

  let ctx = null, master, musicGain, sfxGain, noiseBuf;
  let musicOn = false, timer = null, nextTime = 0, step = 0;
  let theme = null, bossMode = false, melody = [];

  const midi = n => 440 * Math.pow(2, (n - 69) / 12);

  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    harmonic: [0, 2, 3, 5, 7, 8, 11],
  };

  // 16스텝 아르페지오 패턴 (숫자 = 코드 구성음 인덱스, null = 쉼)
  const ARPS = {
    up:     [0, null, 1, null, 2, null, 3, null, 0, null, 1, null, 2, null, 3, null],
    broken: [0, null, 2, null, 1, null, 3, null, 2, null, 0, null, 3, null, 1, null],
    pulse:  [0, 0, null, 0, 0, null, 0, null, 0, 0, null, 0, 0, null, 0, null],
    fast:   [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3],
  };

  const DRUMS = {
    four:  { k: [0, 4, 8, 12], s: [4, 12], h: [2, 6, 10, 14] },
    half:  { k: [0, 10], s: [8], h: [0, 2, 4, 6, 8, 10, 12, 14] },
    break: { k: [0, 6, 10], s: [4, 12], h: [0, 2, 3, 6, 8, 10, 11, 14] },
    trap:  { k: [0, 7, 10], s: [8], h: [0, 1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15] },
  };

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.2;
    musicGain.connect(master);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.55;
    sfxGain.connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  function tone({ freq, type = 'square', start, dur, vol = 0.3, dest, slideTo, attack = 0.005 }) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  function noise({ start, dur, vol = 0.3, dest, filter = 'highpass', freq = 7000 }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  // ---- 음악 ----
  function degToMidi(th, d) {
    const sc = SCALES[th.mode] || SCALES.minor;
    const o = Math.floor(d / 7);
    const i = ((d % 7) + 7) % 7;
    return th.root + 12 * o + sc[i];
  }

  // 스테이지마다 고정된 멜로디를 시드 기반으로 생성
  function makeMelody(th, seed) {
    let s = (seed * 7919 + 104729) % 233280;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const rhythms = [[0, 3, 6, 8, 12], [0, 2, 4, 6, 8, 10, 12, 14], [0, 4, 6, 10, 12], [0, 3, 6, 10, 14], [0, 6, 8, 11]];
    const steps = [0, 2, 4, 7, 1, 3, 4, 2];
    const out = new Array(64).fill(null);
    for (let b = 0; b < 4; b++) {
      const rh = rhythms[Math.floor(rnd() * rhythms.length)];
      for (const p of rh) out[b * 16 + p] = th.prog[b] + steps[Math.floor(rnd() * steps.length)];
    }
    return out;
  }

  function scheduleStep(s, t) {
    const th = theme;
    const i = s % 16;
    const bar = Math.floor(s / 16) % th.prog.length;
    const deg = th.prog[bar];
    const chord = [deg, deg + 2, deg + 4, deg + 7];
    const drums = DRUMS[th.drums] || DRUMS.four;
    const dur16 = 60 / tempo() / 4;

    // 드럼
    if (drums.k.includes(i) || (bossMode && i === 14)) {
      tone({ freq: 150, slideTo: 40, type: 'sine', start: t, dur: 0.16, vol: 0.9, dest: musicGain });
    }
    if (drums.s.includes(i)) {
      noise({ start: t, dur: 0.13, vol: 0.4, dest: musicGain, filter: 'bandpass', freq: 1800 });
      tone({ freq: 190, type: 'triangle', start: t, dur: 0.07, vol: 0.25, dest: musicGain });
    }
    if (drums.h.includes(i)) noise({ start: t, dur: 0.03, vol: bossMode ? 0.2 : 0.14, dest: musicGain });
    if (bossMode && i === 0 && bar === 0) noise({ start: t, dur: 0.6, vol: 0.25, dest: musicGain, freq: 4000 });

    // 베이스
    if (i % 2 === 0) {
      const up = bossMode && i % 4 === 2 ? 12 : 0;
      tone({ freq: midi(degToMidi(th, deg) - 12 + up), type: th.bass, start: t, dur: dur16 * 1.8, vol: 0.45, dest: musicGain });
    }

    // 아르페지오
    const a = (ARPS[th.arp] || ARPS.up)[i];
    if (a !== null) {
      tone({ freq: midi(degToMidi(th, chord[a]) + 12), type: 'square', start: t, dur: dur16 * 1.4, vol: 0.07, dest: musicGain });
    }

    // 멜로디 (보스전에서는 옥타브 더블링)
    const m = melody[s % 64];
    if (m !== null) {
      tone({ freq: midi(degToMidi(th, m) + 12), type: th.lead, start: t, dur: dur16 * 3, vol: bossMode ? 0.13 : 0.09, dest: musicGain, attack: 0.01 });
      if (bossMode) tone({ freq: midi(degToMidi(th, m) + 24), type: 'square', start: t, dur: dur16 * 2, vol: 0.04, dest: musicGain });
    }
  }

  function tempo() { return theme ? theme.bpm * (bossMode ? 1.12 : 1) : 120; }

  function scheduler() {
    if (!ctx || !theme) return;
    while (nextTime < ctx.currentTime + 0.12) {
      scheduleStep(step, nextTime);
      nextTime += 60 / tempo() / 4;
      step++;
    }
  }

  function playTheme(th, isBoss, seed) {
    init();
    theme = th;
    bossMode = !!isBoss;
    melody = makeMelody(th, seed + (isBoss ? 100 : 0));
    stopMusic();
    startMusic();
  }

  function startMusic() {
    init();
    if (!ctx || !theme || musicOn) return;
    musicOn = true;
    step = 0;
    nextTime = ctx.currentTime + 0.06;
    timer = setInterval(scheduler, 25);
  }

  function stopMusic() {
    musicOn = false;
    clearInterval(timer);
    timer = null;
  }

  // ---- 효과음 ----
  function sfx(name) {
    init();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const notes = (list, type, gap, dur, vol) =>
      list.forEach((n, k) => tone({ freq: midi(n), type, start: t + k * gap, dur, vol, dest: sfxGain }));
    switch (name) {
      case 'start': notes([72, 76, 79, 84], 'square', 0.06, 0.12, 0.25); break;
      case 'die':
        noise({ start: t, dur: 0.7, vol: 0.7, dest: sfxGain, filter: 'lowpass', freq: 1200 });
        tone({ freq: 440, slideTo: 50, type: 'sawtooth', start: t, dur: 0.8, vol: 0.4, dest: sfxGain });
        break;
      case 'hit':
        noise({ start: t, dur: 0.3, vol: 0.6, dest: sfxGain, filter: 'lowpass', freq: 2000 });
        tone({ freq: 300, slideTo: 80, type: 'square', start: t, dur: 0.3, vol: 0.3, dest: sfxGain });
        break;
      case 'orb': notes([84, 91], 'sine', 0.05, 0.15, 0.3); break;
      case 'triple': notes([79, 86, 91], 'square', 0.15, 0.1, 0.2); break;
      case 'bomb':
        noise({ start: t, dur: 0.8, vol: 0.8, dest: sfxGain, filter: 'lowpass', freq: 700 });
        tone({ freq: 120, slideTo: 30, type: 'sine', start: t, dur: 0.7, vol: 0.8, dest: sfxGain });
        break;
      case 'shield': notes([67, 74, 79], 'triangle', 0.05, 0.25, 0.3); break;
      case 'slow':
        tone({ freq: 880, slideTo: 220, type: 'sine', start: t, dur: 0.6, vol: 0.3, dest: sfxGain });
        break;
      case 'bossHit':
        tone({ freq: 220, slideTo: 110, type: 'square', start: t, dur: 0.12, vol: 0.35, dest: sfxGain });
        noise({ start: t, dur: 0.1, vol: 0.3, dest: sfxGain, filter: 'bandpass', freq: 3000 });
        break;
      case 'bossDie':
        for (let k = 0; k < 5; k++) noise({ start: t + k * 0.15, dur: 0.5, vol: 0.6, dest: sfxGain, filter: 'lowpass', freq: 900 - k * 120 });
        tone({ freq: 300, slideTo: 30, type: 'sawtooth', start: t, dur: 1.4, vol: 0.4, dest: sfxGain });
        break;
      case 'stageClear': notes([72, 76, 79, 84, 79, 84, 88], 'triangle', 0.1, 0.3, 0.35); break;
      case 'allClear': notes([72, 76, 79, 84, 88, 91, 96, 91, 96, 100], 'triangle', 0.12, 0.4, 0.35); break;
      case 'warning':
        for (let k = 0; k < 4; k++) {
          tone({ freq: 440, type: 'sawtooth', start: t + k * 0.5, dur: 0.24, vol: 0.22, dest: sfxGain });
          tone({ freq: 330, type: 'sawtooth', start: t + k * 0.5 + 0.25, dur: 0.24, vol: 0.22, dest: sfxGain });
        }
        break;
      case 'extraLife': notes([79, 84, 88], 'sine', 0.07, 0.2, 0.3); break;
      case 'pause':
        tone({ freq: midi(67), slideTo: midi(55), type: 'triangle', start: t, dur: 0.15, vol: 0.3, dest: sfxGain });
        break;
      case 'resume':
        tone({ freq: midi(55), slideTo: midi(67), type: 'triangle', start: t, dur: 0.15, vol: 0.3, dest: sfxGain });
        break;
    }
  }

  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* 무시 */ }
    if (ctx) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02);
    return muted;
  }

  return { init, playTheme, startMusic, stopMusic, sfx, toggleMute, isMuted: () => muted };
})();
