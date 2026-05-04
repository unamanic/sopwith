const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

// ── Constants ─────────────────────────────────────────────────────────────────
const GRAVITY        = 0.12 * 0.8;
const THROTTLE_RATE  = 0.025 * 0.8;
const ROTATE_SPEED   = 1.8 * 0.8 * 0.65;
const MAX_SPEED      = 7 * 0.8;
const CRUISE_SPEED   = 2.0 * 0.8;
const CEILING_Y      = 55;   // hard ceiling — no lift above this
const CEILING_ZONE   = 180;  // lift degrades across this band below ceiling
const GROUND_LEVEL   = H - 60;
const TERRAIN_COLOR  = '#2d5a1b';

// ── Terrain ───────────────────────────────────────────────────────────────────
const TERRAIN_SEGMENT = 40;
const WORLD_WIDTH     = 16000;
const NUM_SEGMENTS    = Math.ceil(WORLD_WIDTH / TERRAIN_SEGMENT) + 2;

function generateTerrain() {
  const pts   = new Array(NUM_SEGMENTS).fill(GROUND_LEVEL);
  const YMIN  = H * 0.67; // keep terrain in lower third (above 2/3 of screen)
  const YMAX  = H - 14;

  // Build control points: [segIndex, y]
  const ctrl  = [];
  const PLATEAU_HEIGHT = GROUND_LEVEL - 200; // raised start plateau for easier takeoff
  ctrl.push([0,  PLATEAU_HEIGHT]);
  ctrl.push([14, PLATEAU_HEIGHT]); // guaranteed flat start plateau

  let pos  = 16;
  let curY = PLATEAU_HEIGHT;

  while (pos < NUM_SEGMENTS - 25) {
    const roll = Math.random();
    let nextY  = curY;
    let span;

    if (roll < 0.22) {
      // Tall hill — rises sharply, flat top, drops back
      span  = 18 + Math.floor(Math.random() * 22);
      const peak = Math.max(YMIN, curY - 110 - Math.random() * 100);
      ctrl.push([pos + Math.floor(span * 0.35), peak]);
      ctrl.push([pos + Math.floor(span * 0.65), peak]);
      nextY = curY + (Math.random() - 0.5) * 30;
    } else if (roll < 0.40) {
      // Valley — dips down, flat bottom
      span  = 10 + Math.floor(Math.random() * 14);
      const pit = Math.min(YMAX, curY + 35 + Math.random() * 45);
      ctrl.push([pos + Math.floor(span * 0.4), pit]);
      ctrl.push([pos + Math.floor(span * 0.6), pit]);
      nextY = curY;
    } else if (roll < 0.55) {
      // Cliff up — abrupt rise over 4-6 segs, then plateau
      span  = 4 + Math.floor(Math.random() * 4);
      nextY = Math.max(YMIN, curY - 70 - Math.random() * 90);
      const plateauSpan = 6 + Math.floor(Math.random() * 12);
      ctrl.push([pos + span + plateauSpan, nextY]);
      span += plateauSpan;
    } else if (roll < 0.68) {
      // Cliff down — abrupt drop, then plateau
      span  = 4 + Math.floor(Math.random() * 4);
      nextY = Math.min(YMAX, curY + 55 + Math.random() * 70);
      const plateauSpan = 5 + Math.floor(Math.random() * 10);
      ctrl.push([pos + span + plateauSpan, nextY]);
      span += plateauSpan;
    } else if (roll < 0.82) {
      // Rolling bumps — several smaller hills in a row
      span  = 20 + Math.floor(Math.random() * 15);
      const mid = pos + Math.floor(span / 2);
      ctrl.push([mid, Math.max(YMIN, curY - 40 - Math.random() * 50)]);
      nextY = curY + (Math.random() - 0.5) * 40;
      nextY = Math.max(YMIN + 60, Math.min(YMAX - 30, nextY));
    } else {
      // Short flat section
      span  = 6 + Math.floor(Math.random() * 10);
      nextY = curY + (Math.random() - 0.5) * 15;
    }

    nextY = Math.max(YMIN, Math.min(YMAX, nextY));
    ctrl.push([pos + span, nextY]);
    curY  = nextY;
    pos  += span + 1;
  }

  ctrl.push([NUM_SEGMENTS - 1, GROUND_LEVEL]);

  // Sort ctrl by index (just in case) and smooth-interpolate (cubic S-curve)
  ctrl.sort((a, b) => a[0] - b[0]);
  for (let c = 0; c < ctrl.length - 1; c++) {
    const [i0, y0] = ctrl[c];
    const [i1, y1] = ctrl[c + 1];
    for (let i = i0; i <= i1 && i < NUM_SEGMENTS; i++) {
      const t = (i - i0) / Math.max(1, i1 - i0);
      const s = t * t * (3 - 2 * t); // smoothstep
      pts[i] = y0 + (y1 - y0) * s;
    }
  }

  return pts;
}

let terrain = generateTerrain();

function terrainYAt(worldX) {
  const seg = worldX / TERRAIN_SEGMENT;
  const i   = Math.floor(seg);
  const t   = seg - i;
  const a   = terrain[Math.max(0, Math.min(i,     terrain.length - 1))];
  const b   = terrain[Math.max(0, Math.min(i + 1, terrain.length - 1))];
  return a + (b - a) * t;
}

// ── Ground targets ────────────────────────────────────────────────────────────
const TARGET_TYPES = {
  building: { w: 24, h: 40, color: '#8b7355', score: 100 },
  fuel:     { w: 20, h: 20, color: '#cc4400', score: 150 },
  hangar:   { w: 50, h: 30, color: '#6b6b6b', score: 200 },
};

function spawnTargets(lv = 1) {
  const result  = [];
  const types   = Object.keys(TARGET_TYPES);
  const spacing = Math.max(120, 280 - lv * 20);
  for (let x = 600; x < WORLD_WIDTH - 400; x += spacing + Math.random() * 200) {
    const type = types[Math.floor(Math.random() * types.length)];
    const def  = TARGET_TYPES[type];
    const gy   = terrainYAt(x);
    result.push({ x, y: gy - def.h, w: def.w, h: def.h, color: def.color, score: def.score * lv, type, alive: true });
  }
  return result;
}

// ── Enemy planes ──────────────────────────────────────────────────────────────
function spawnEnemyPlanes(lv = 1) {
  const result = [];
  const count  = Math.min(1 + Math.floor(lv * 0.8), 7);
  for (let i = 0; i < count; i++) {
    const x  = 800 + Math.random() * (WORLD_WIDTH - 1600);
    const gy = terrainYAt(x);
    result.push({
      x,
      y:           gy - 160 - Math.random() * 130,
      vx:          (Math.random() < 0.5 ? 1 : -1) * (2 + lv * 0.25),
      vy:          0,
      angle:       0,
      facingRight: Math.random() < 0.5,
      fireCooldown: 60 + Math.floor(Math.random() * 120),
      alive:       true,
      score:       300 * lv,
    });
  }
  return result;
}

// ── AA guns ───────────────────────────────────────────────────────────────────
function spawnAAGuns(lv, groundTargets) {
  const result = [];
  const prob   = Math.min(0.25 + lv * 0.08, 0.65);
  for (const t of groundTargets) {
    if (Math.random() < prob) {
      const gy = terrainYAt(t.x + t.w / 2);
      result.push({
        x:        t.x + t.w / 2,
        y:        gy,
        cooldown: 80 + Math.floor(Math.random() * 120),
        alive:    true,
        score:    150,
      });
    }
  }
  return result;
}

// ── Balloons ──────────────────────────────────────────────────────────────────
function spawnBalloons(lv = 1) {
  const result = [];
  const count  = 2 + Math.floor(lv / 2);
  for (let i = 0; i < count; i++) {
    const x  = 700 + Math.random() * (WORLD_WIDTH - 1400);
    const gy = terrainYAt(x);
    const balloonY = Math.max(50, gy - 220 - Math.random() * 100); // clamp to stay on screen
    result.push({
      x,
      y:       balloonY,
      driftVx: (Math.random() - 0.5) * 0.2,
      wobble:  Math.random() * Math.PI * 2,
      alive:   true,
      score:   250 * lv,
    });
  }
  return result;
}

// ── State ─────────────────────────────────────────────────────────────────────
let targets     = spawnTargets(1);
let enemyPlanes = spawnEnemyPlanes(1);
let aaGuns      = spawnAAGuns(1, targets);
let balloons    = spawnBalloons(1);

// ── Ammo pickups ──────────────────────────────────────────────────────────────
function spawnAmmoPickups() {
  const result = [];
  // bullet ammo: ~every 1800-2500px
  for (let x = 1200; x < WORLD_WIDTH - 600; x += 1800 + Math.random() * 700) {
    const gy = terrainYAt(x);
    result.push({ type: 'bullet', x, baseY: gy - 90 - Math.random() * 50, collected: false, respawnTimer: 0 });
  }
  // bomb ammo: ~every 4000-6000px
  for (let x = 3000 + Math.random() * 1000; x < WORLD_WIDTH - 600; x += 4000 + Math.random() * 2000) {
    const gy = terrainYAt(x);
    result.push({ type: 'bomb', x, baseY: gy - 90 - Math.random() * 50, collected: false, respawnTimer: 0 });
  }
  return result;
}

let ammoPickups = spawnAmmoPickups();

function updateAmmoPickups() {
  for (const p of ammoPickups) {
    if (p.collected) {
      p.respawnTimer--;
      if (p.respawnTimer <= 0) {
        p.collected = false;
        p.baseY     = terrainYAt(p.x) - 90 - Math.random() * 50;
      }
      continue;
    }
    if (!plane.dead &&
        Math.abs(plane.x - p.x) < 28 &&
        Math.abs(plane.y - p.baseY) < 28) {
      p.collected    = true;
      p.respawnTimer = 1800;
      if (p.type === 'bomb') {
        plane.bombs = Math.min(plane.bombs + 3, 12);
      } else {
        plane.ammo  = Math.min(plane.ammo + 20, 60);
      }
    }
  }
}

const plane = {
  x:           300,
  y:           GROUND_LEVEL - 235,
  vx:          0,
  vy:          0,
  angle:       0,
  throttle:    0,
  facingRight:  true,
  onGround:     true,
  hasTakenOff:  false,
  ammo:         40,
  bombs:        6,
  dead:         false,
};

let score         = 0;
let lives         = 3;
let gameOver      = false;
let titleScreen   = true;
let level         = 1;
let levelComplete = false;
let levelTimer    = 0;
let cameraX       = 0;
let looping       = false;
let loopAngle     = 0;
let loopDir       = 0;  // tracks which way the loop goes
let frame         = 0;

// ── Audio ─────────────────────────────────────────────────────────────────────
let audioCtx     = null;
let engineOsc    = null;
let engineSubOsc = null;
let engineGain   = null;
let masterGain   = null;
let soundEnabled = true;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain       = audioCtx.createGain();
  masterGain.gain.value = 1;
  masterGain.connect(audioCtx.destination);

  engineOsc    = audioCtx.createOscillator();
  engineSubOsc = audioCtx.createOscillator();
  engineGain   = audioCtx.createGain();

  engineOsc.type    = 'sawtooth';
  engineSubOsc.type = 'square';
  engineOsc.frequency.value    = 80;
  engineSubOsc.frequency.value = 40;
  engineGain.gain.value = 0;

  engineOsc.connect(engineGain);
  engineSubOsc.connect(engineGain);
  engineGain.connect(masterGain);
  engineOsc.start();
  engineSubOsc.start();
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  if (masterGain) masterGain.gain.value = soundEnabled ? 1 : 0;
  const btn = document.getElementById('btn-sound');
  btn.textContent = soundEnabled ? '🔊 SFX' : '🔇 SFX';
  btn.classList.toggle('muted', !soundEnabled);
}

document.getElementById('btn-sound').addEventListener('click', () => {
  if (!audioCtx) initAudio();
  toggleSound();
});

function updateEngineSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  if (plane.dead || titleScreen || gameOver) {
    engineGain.gain.setTargetAtTime(0, now, 0.4);
    return;
  }
  const spd  = Math.hypot(plane.vx, plane.vy);
  const freq = 55 + plane.throttle * 140 + spd * 5;
  const vol  = plane.throttle < 0.02 ? 0.01 : 0.03 + plane.throttle * 0.09;
  engineOsc.frequency.setTargetAtTime(freq,       now, 0.12);
  engineSubOsc.frequency.setTargetAtTime(freq * 0.5, now, 0.12);
  engineGain.gain.setTargetAtTime(vol, now, 0.06);
}

function playGunshot(isEnemy) {
  if (!audioCtx) return;
  const dur  = 0.07;
  const buf  = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);

  const src    = audioCtx.createBufferSource();
  src.buffer   = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type  = 'bandpass';
  filter.frequency.value = isEnemy ? 500 : 1100;
  filter.Q.value         = 0.8;
  const gain       = audioCtx.createGain();
  gain.gain.value  = isEnemy ? 0.18 : 0.28;

  src.connect(filter); filter.connect(gain); gain.connect(masterGain || audioCtx.destination);
  src.start();
}

function playBombDrop() {
  if (!audioCtx) return;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type   = 'sine';
  osc.frequency.setValueAtTime(700, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(120, audioCtx.currentTime + 1.3);
  gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.3);
  osc.connect(gain); gain.connect(masterGain || audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + 1.3);
}

function playExplosion(big) {
  if (!audioCtx) return;
  const duration = big ? 1.1 : 0.55;
  const sr       = audioCtx.sampleRate;
  const buf      = audioCtx.createBuffer(1, Math.floor(sr * duration), sr);
  const data     = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const src    = audioCtx.createBufferSource();
  src.buffer   = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type  = 'lowpass';
  filter.frequency.setValueAtTime(big ? 1200 : 1800, audioCtx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(60, audioCtx.currentTime + duration);
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(big ? 0.65 : 0.38, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

  src.connect(filter); filter.connect(gain); gain.connect(masterGain || audioCtx.destination);
  src.start();
}

// ── Music ─────────────────────────────────────────────────────────────────────
const BPM = 150;
const Q   = 60 / BPM;   // quarter note
const E   = Q / 2;      // eighth note
const MH  = Q * 2;      // half note (music)

// Note frequencies (A minor)
const A2=110.00,E3=164.81,A3=220.00,B3=246.94,C4=261.63,D4=293.66;
const E4=329.63,F4=349.23,G4=392.00,A4=440.00,B4=493.88,C5=523.25;
const D5=587.33,E5=659.25,F5=698.46,G5=783.99,A5=880.00,B5=987.77,C6=1046.50;
const R=0;

// 8-bar driving theme in A minor
const MELODY = [
  // Bar 1 — punchy opening motif
  [A4,E],[C5,E],[E5,E],[A5,E], [G5,E],[E5,E],[C5,E],[A4,E],
  // Bar 2 — answer phrase
  [B4,Q],[D5,E],[F5,E],        [E5,Q],[C5,E],[A4,E],
  // Bar 3 — driving sequence
  [G4,E],[A4,E],[B4,E],[C5,E], [D5,E],[E5,E],[F5,E],[G5,E],
  // Bar 4 — peak + breath
  [A5,Q],[G5,E],[E5,E],        [A4,MH],
  // Bar 5 — counter-theme (relative major feel)
  [C5,E],[C5,E],[G4,E],[C5,E], [E5,E],[D5,E],[C5,E],[B4,E],
  // Bar 6 — call
  [A4,Q],[C5,E],[E5,E],        [G5,Q],[F5,Q],
  // Bar 7 — fast descending run
  [E5,E],[D5,E],[C5,E],[B4,E], [A4,E],[B4,E],[C5,E],[D5,E],
  // Bar 8 — resolve to A
  [E5,Q],[C5,E],[A4,E],        [A4,MH],
];

// Driving bass — alternates root/fifth, moves with harmony
const BASS = [
  [A2,Q],[E3,Q],[A2,Q],[E3,Q],   // bar 1 — Am
  [A2,Q],[E3,Q],[A2,Q],[E3,Q],   // bar 2 — Am
  [98.00,Q],[196.00,Q],[98.00,Q],[196.00,Q],   // bar 3 — G2/G3
  [A2,Q],[E3,Q],[A2,Q],[E3,Q],                 // bar 4 — Am
  [130.81,Q],[196.00,Q],[130.81,Q],[196.00,Q], // bar 5 — C3/G3
  [87.31,Q],[130.81,Q],[87.31,Q],[130.81,Q],   // bar 6 — F2/C3
  [E3,Q],[B3,Q],[E3,Q],[B3,Q],   // bar 7 — Em
  [A2,Q],[E3,Q],[A2,Q],[E3,Q],   // bar 8 — Am resolve
];

// Kick+snare pattern (repeats every bar, 4/4)
const PERC = [
  {kick:true, d:Q},{kick:false,d:Q},{kick:true, d:Q},{kick:false,d:Q},
];

let melodyIdx=0, bassIdx=0, percIdx=0;
let nextMelTime=0, nextBassTime=0, nextPercTime=0;
let musicTimer=null, musicPlaying=false;

function scheduleMusNote(freq, dur, time, vol, type) {
  if (!audioCtx || freq === 0) return;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(vol, time + Math.min(0.018, dur * 0.1));
  gain.gain.setValueAtTime(vol * 0.75, time + dur * 0.6);
  gain.gain.linearRampToValueAtTime(0, time + dur * 0.88);
  osc.connect(gain);
  gain.connect(masterGain || audioCtx.destination);
  osc.start(time);
  osc.stop(time + dur);
}

function schedulePerc(isKick, time) {
  if (!audioCtx) return;
  const dur = isKick ? 0.12 : 0.07;
  const sr  = audioCtx.sampleRate;
  const buf = audioCtx.createBuffer(1, Math.floor(sr * dur), sr);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src    = audioCtx.createBufferSource();
  src.buffer   = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type  = 'lowpass';
  filter.frequency.value = isKick ? 180 : 4000;
  const gain   = audioCtx.createGain();
  gain.gain.setValueAtTime(isKick ? 0.55 : 0.22, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  src.connect(filter); filter.connect(gain); gain.connect(masterGain || audioCtx.destination);
  src.start(time);
}

function musicTick() {
  if (!audioCtx || !musicPlaying) return;
  const LOOKAHEAD = 0.2;
  const now = audioCtx.currentTime;

  while (nextMelTime < now + LOOKAHEAD) {
    const [f, d] = MELODY[melodyIdx % MELODY.length];
    scheduleMusNote(f, d, nextMelTime, 0.055);
    nextMelTime += d;
    melodyIdx++;
  }
  while (nextBassTime < now + LOOKAHEAD) {
    const [f, d] = BASS[bassIdx % BASS.length];
    scheduleMusNote(f, d, nextBassTime, 0.06, 'sawtooth');
    nextBassTime += d;
    bassIdx++;
  }
  while (nextPercTime < now + LOOKAHEAD) {
    const p = PERC[percIdx % PERC.length];
    schedulePerc(p.kick, nextPercTime);
    nextPercTime += p.d;
    percIdx++;
  }
  musicTimer = setTimeout(musicTick, 25);
}

function startMusic() {
  if (!audioCtx || musicPlaying) return;
  musicPlaying = true;
  melodyIdx = bassIdx = percIdx = 0;
  nextMelTime = nextBassTime = nextPercTime = audioCtx.currentTime + 0.1;
  musicTick();
}

function stopMusic() {
  musicPlaying = false;
  if (musicTimer) { clearTimeout(musicTimer); musicTimer = null; }
}

// ── Sad game-over march (D minor, funeral march tempo) ────────────────────────
const SAD_BPM = 88;
const SQ  = 60 / SAD_BPM;
const SE  = SQ / 2;
const SH  = SQ * 2;

const D3=146.83,F3=174.61,C3=130.81,Bb2=116.54,G2=98.00,Bb3=233.08,G3=196.00;

// D minor funeral march — dotted quarter feel, heavy downbeats
const SAD_MELODY = [
  [D4,SQ],[R,SE],[D4,SE],[F4,SQ],[A4,SQ],
  [G4,SH],[F4,SE],[E4,SE],
  [D4,SQ],[R,SE],[D4,SE],[C4,SQ],[Bb3,SQ],
  [A3,SH],[R,SQ],
  [F4,SQ],[R,SE],[F4,SE],[E4,SQ],[D4,SQ],
  [C4,SH],[Bb3,SE],[A3,SE],
  [G3,SQ],[A3,SE],[Bb3,SE],[A3,SQ],[G3,SQ],
  [D3,SH],[R,SQ],
];

// March bass — boom-step, doom-step
const SAD_BASS = [
  [D3,SQ],[D3,SE],[R,SE],[F3,SQ],[A3,SQ],
  [G2,SQ],[G2,SE],[R,SE],[Bb2,SQ],[G2,SQ],
  [C3,SQ],[C3,SE],[R,SE],[E3,SQ],[G3,SQ],
  [A2,SH],[R,SQ],
  [D3,SQ],[D3,SE],[R,SE],[F3,SQ],[C3,SQ],
  [Bb2,SH],[G2,SQ],
  [C3,SQ],[C3,SE],[R,SE],[G2,SQ],[C3,SQ],
  [D3,SH],[R,SQ],
];

// Heavy march kick on 1 and 3, snare on 2 and 4
const SAD_PERC = [
  {kick:true,d:SQ},{kick:false,d:SQ},{kick:true,d:SQ},{kick:false,d:SQ},
];

let sadMelIdx=0, sadBassIdx=0, sadPercIdx=0;
let sadNextMel=0, sadNextBass=0, sadNextPerc=0;
let sadTimer=null, sadPlaying=false;

function sadMusicTick() {
  if (!audioCtx || !sadPlaying) return;
  const LOOKAHEAD = 0.25;
  const now = audioCtx.currentTime;

  while (sadNextMel < now + LOOKAHEAD) {
    const [f, d] = SAD_MELODY[sadMelIdx % SAD_MELODY.length];
    if (f !== 0) {
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, sadNextMel);
      gain.gain.linearRampToValueAtTime(0.09, sadNextMel + 0.04);
      gain.gain.setValueAtTime(0.07, sadNextMel + d * 0.65);
      gain.gain.linearRampToValueAtTime(0, sadNextMel + d * 0.9);
      osc.connect(gain); gain.connect(masterGain || audioCtx.destination);
      osc.start(sadNextMel); osc.stop(sadNextMel + d);
    }
    sadNextMel += d;
    sadMelIdx++;
  }

  while (sadNextBass < now + LOOKAHEAD) {
    const [f, d] = SAD_BASS[sadBassIdx % SAD_BASS.length];
    if (f !== 0) {
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, sadNextBass);
      gain.gain.linearRampToValueAtTime(0.055, sadNextBass + 0.03);
      gain.gain.setValueAtTime(0.04, sadNextBass + d * 0.7);
      gain.gain.linearRampToValueAtTime(0, sadNextBass + d * 0.92);
      osc.connect(gain); gain.connect(masterGain || audioCtx.destination);
      osc.start(sadNextBass); osc.stop(sadNextBass + d);
    }
    sadNextBass += d;
    sadBassIdx++;
  }

  while (sadNextPerc < now + LOOKAHEAD) {
    const p = SAD_PERC[sadPercIdx % SAD_PERC.length];
    const dur = p.kick ? 0.18 : 0.09;
    const sr  = audioCtx.sampleRate;
    const buf = audioCtx.createBuffer(1, Math.floor(sr * dur), sr);
    const dat = buf.getChannelData(0);
    for (let i = 0; i < dat.length; i++) dat[i] = Math.random() * 2 - 1;
    const src    = audioCtx.createBufferSource();
    src.buffer   = buf;
    const filter = audioCtx.createBiquadFilter();
    filter.type  = 'lowpass';
    filter.frequency.value = p.kick ? 140 : 3000;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(p.kick ? 0.5 : 0.15, sadNextPerc);
    gain.gain.exponentialRampToValueAtTime(0.001, sadNextPerc + dur);
    src.connect(filter); filter.connect(gain); gain.connect(masterGain || audioCtx.destination);
    src.start(sadNextPerc);
    sadNextPerc += p.d;
    sadPercIdx++;
  }

  sadTimer = setTimeout(sadMusicTick, 30);
}

function startSadMusic() {
  if (!audioCtx || sadPlaying) return;
  sadPlaying = true;
  sadMelIdx = sadBassIdx = sadPercIdx = 0;
  sadNextMel = sadNextBass = sadNextPerc = audioCtx.currentTime + 0.5;
  sadMusicTick();
}

function stopSadMusic() {
  sadPlaying = false;
  if (sadTimer) { clearTimeout(sadTimer); sadTimer = null; }
}

// ── Projectiles ───────────────────────────────────────────────────────────────
const bullets      = [];
const bombs        = [];
const enemyBullets = [];
const explosions   = [];
let fireCooldown   = 0;

function fireBullet() {
  if (plane.ammo <= 0 || fireCooldown > 0) return;
  const rad = plane.angle * Math.PI / 180;
  const dir = plane.facingRight ? 1 : -1;
  bullets.push({
    x:  plane.x + Math.cos(rad) * 22 * dir,
    y:  plane.y - Math.sin(rad) * 22,
    vx: Math.cos(rad) * 8 * dir + plane.vx * 0.4,
    vy: -Math.sin(rad) * 8 + plane.vy * 0.4,
    life: 150,
  });
  plane.ammo--;
  fireCooldown = 6;
  playGunshot(false);
}

function dropBomb() {
  if (plane.bombs <= 0) return;
  bombs.push({
    x: plane.x, y: plane.y,
    vx: plane.vx * 0.8, vy: plane.vy,
    life: 200,
  });
  plane.bombs--;
  playBombDrop();
}

function spawnExplosion(x, y, big) {
  explosions.push({ x, y, r: 0, maxR: big ? 100 : 36, life: 40, maxLife: 40 });
  playExplosion(big);
}

// ── Input ─────────────────────────────────────────────────────────────────────
const keys = {};
window.addEventListener('keydown', e => {
  if (e.code === 'Space') e.preventDefault();
  if (titleScreen) { titleScreen = false; initAudio(); startMusic(); return; }
  keys[e.code] = true;
  if (gameOver) { restartGame(); return; }
  if (e.code === 'Space') fireBullet();
  if (e.code === 'KeyB')  dropBomb();
  if (e.code === 'KeyM')  { if (!audioCtx) initAudio(); toggleSound(); }
  if (e.code === 'KeyL' && !looping && !plane.onGround) { 
    looping = true; loopAngle = 0; 
    loopDir = -1;  // loops always go up
  }
  if (e.code === 'KeyQ')  { if (!gameOver && !titleScreen) quitToTitle(); }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ── Player physics ────────────────────────────────────────────────────────────
function updatePlane() {
  if (plane.dead) return;

  const dir = plane.facingRight ? 1 : -1;

  if (keys['KeyW'] || keys['ArrowUp'])   plane.throttle = Math.min(1, plane.throttle + THROTTLE_RATE);
  if (keys['KeyS'] || keys['ArrowDown']) plane.throttle = Math.max(0, plane.throttle - THROTTLE_RATE);

  if (!looping) {
    if (keys['KeyA'] || keys['ArrowLeft'])  plane.angle += ROTATE_SPEED * dir;
    if (keys['KeyD'] || keys['ArrowRight']) plane.angle -= ROTATE_SPEED * dir;
    plane.angle = Math.max(-75, Math.min(75, plane.angle));
  }

  if (looping) {
    const step = 4.5;
    loopAngle   += step;
    plane.angle = loopAngle * loopDir;  // track angle from loop progress, not cumulative rotation
    if (loopAngle >= 180 && loopAngle - step < 180) plane.facingRight = !plane.facingRight;
    if (loopAngle >= 360) { looping = false; loopAngle = 0; loopDir = 0; plane.angle = 0; }
  }

  const airspeed    = Math.hypot(plane.vx, plane.vy);
  const altFactor   = Math.max(0, Math.min(1, (plane.y - CEILING_Y) / CEILING_ZONE));
  const liftFactor  = Math.min(airspeed / CRUISE_SPEED, 1) * altFactor;
  
  // ground effect: extra lift when near the ground
  const groundY = terrainYAt(plane.x);
  const heightAboveGround = groundY - plane.y;
  const groundEffectZone = 80;  // distance for ground effect
  const groundEffectLift = Math.max(0, 1 - heightAboveGround / groundEffectZone) * 0.3;
  
  const rad         = plane.angle * Math.PI / 180;

  // engine loses power in thin air above ceiling zone
  const thrustPower = plane.throttle * 0.22 * altFactor;
  plane.vx += Math.cos(rad) * thrustPower * dir;
  plane.vy -= Math.sin(rad) * thrustPower;
  plane.vy += GRAVITY * (1 - (liftFactor + groundEffectLift) * 0.92);

  if (airspeed > 0.3) {
    const blend = liftFactor * 0.07;
    plane.vx += (Math.cos(rad) * airspeed * dir - plane.vx) * blend;
    plane.vy += (-Math.sin(rad) * airspeed - plane.vy) * blend;
  }

  const spd = Math.hypot(plane.vx, plane.vy);
  if (spd > MAX_SPEED) { plane.vx = plane.vx / spd * MAX_SPEED; plane.vy = plane.vy / spd * MAX_SPEED; }
  plane.vx *= 0.994;
  plane.vy *= 0.994;
  plane.x  += plane.vx;
  plane.y  += plane.vy;

  if (!looping && !plane.onGround && Math.abs(plane.vx) > 0.5) plane.facingRight = plane.vx > 0;

  if (plane.x < 0)           { plane.x = 0;          plane.vx =  Math.abs(plane.vx) * 0.5; }
  if (plane.x > WORLD_WIDTH) { plane.x = WORLD_WIDTH; plane.vx = -Math.abs(plane.vx) * 0.5; }

  // check platform collision first
  const platformX = 150;
  const platformW = 300;
  const platformTerrainY = terrainYAt(platformX + platformW / 2);
  const platformTopY = platformTerrainY - 25;
  
  let groundY = terrainYAt(plane.x);
  let onPlatform = false;
  if (plane.x >= platformX && plane.x <= platformX + platformW) {
    // plane is over platform, use platform surface
    groundY = platformTopY;
    onPlatform = true;
  }

  if (plane.y >= groundY - 10) {
    if (plane.hasTakenOff) {
      killPlane();
    } else if (Math.abs(plane.vy) > 2.8 || Math.abs(plane.angle) > 35) {
      killPlane();
    } else {
      plane.y = groundY - 10; plane.vy = 0;
      // on platform: no friction, accelerate freely
      if (!onPlatform) {
        plane.vx *= 0.90;
        plane.angle *= 0.85;
      }
      plane.onGround = true;
      if (Math.abs(plane.vx) < 0.05) plane.vx = 0;
    }
  } else {
    plane.onGround = false;
    plane.hasTakenOff = true;
  }

  if (plane.dead) return;

  // collide with ground targets
  for (const t of targets) {
    if (!t.alive) continue;
    if (plane.x + 18 > t.x && plane.x - 18 < t.x + t.w &&
        plane.y + 10 > t.y && plane.y - 10 < t.y + t.h) {
      t.alive = false;
      spawnExplosion(t.x + t.w / 2, t.y + t.h / 2, true);
      killPlane(); return;
    }
  }

  // collide with enemy planes
  for (const e of enemyPlanes) {
    if (!e.alive) continue;
    if (Math.abs(plane.x - e.x) < 25 && Math.abs(plane.y - e.y) < 15) {
      e.alive = false;
      score  += e.score;
      spawnExplosion(e.x, e.y, true);
      killPlane(); return;
    }
  }

  // collide with balloons
  for (const b of balloons) {
    if (!b.alive) continue;
    if (Math.abs(plane.x - b.x) < 26 && Math.abs(plane.y - b.y) < 38) {
      b.alive = false;
      score  += b.score;
      spawnExplosion(b.x, b.y, false);
      killPlane(); return;
    }
  }

  if (fireCooldown > 0) fireCooldown--;
}

function killPlane() {
  if (plane.dead) return;
  plane.dead = true;
  spawnExplosion(plane.x, plane.y, true);
  lives--;
  if (lives <= 0) {
    setTimeout(() => { gameOver = true; stopMusic(); startSadMusic(); }, 1500);
  } else {
    setTimeout(resetPlane, 2500);
  }
}

function resetPlane() {
  const platformX = 150;
  const platformW = 300;
  const platformStartY = terrainYAt(platformX + platformW / 2) - 25; // top of platform
  plane.dead = false; plane.x = platformX; plane.y = platformStartY - 10;
  plane.vx = 0; plane.vy = 0; plane.angle = 0; plane.throttle = 0;
  plane.facingRight = true; plane.onGround = true; plane.hasTakenOff = false;
  plane.ammo = 40; plane.bombs = 6;
  looping = false; loopAngle = 0; loopDir = 0;
}

function restartGame() {
  stopSadMusic();
  terrain = generateTerrain(); // regenerate terrain for new game
  score = 0; lives = 3; level = 1; gameOver = false;
  levelComplete = false; levelTimer = 0; cameraX = 0;
  targets     = spawnTargets(1);
  enemyPlanes = spawnEnemyPlanes(1);
  aaGuns      = spawnAAGuns(1, targets);
  balloons    = spawnBalloons(1);
  ammoPickups = spawnAmmoPickups();
  bullets.length = 0; bombs.length = 0; enemyBullets.length = 0; explosions.length = 0;
  resetPlane();
  startMusic();
}

function quitToTitle() {
  titleScreen = true;
  gameOver = false;
  stopSadMusic();
  score = 0; lives = 3; level = 1;
  levelComplete = false; levelTimer = 0; cameraX = 0;
}

// ── Enemy AI ──────────────────────────────────────────────────────────────────
function updateEnemyPlanes() {
  for (const e of enemyPlanes) {
    if (!e.alive) continue;

    const dx   = plane.x - e.x;
    const dy   = plane.y - e.y;
    const dist = Math.hypot(dx, dy);
    const chasing = dist < 520 && !plane.dead;

    const cruiseY = terrainYAt(e.x) - 170;

    if (chasing) {
      e.facingRight = dx > 0;
      e.angle = Math.max(-40, Math.min(40, -dy * 0.12));
    } else {
      e.angle = 0;
      if (e.x < 500)               e.facingRight = true;
      if (e.x > WORLD_WIDTH - 500) e.facingRight = false;
    }

    const eDir   = e.facingRight ? 1 : -1;
    const erad   = e.angle * Math.PI / 180;
    const espeed = chasing ? 2.4 : 1.76;

    e.vx  = Math.cos(erad) * espeed * eDir;
    e.vy  = -Math.sin(erad) * espeed;
    e.vy += (cruiseY - e.y) * 0.008; // altitude correction
    e.x  += e.vx;
    e.y  += e.vy;
    e.y   = Math.max(40, Math.min(terrainYAt(e.x) - 25, e.y));

    // terrain crash
    if (e.y >= terrainYAt(e.x) - 5) {
      e.alive = false;
      spawnExplosion(e.x, terrainYAt(e.x), true);
      continue;
    }

    // fire at player
    e.fireCooldown--;
    if (e.fireCooldown <= 0 && chasing) {
      const shootAngle = Math.atan2(-(plane.y - e.y), (plane.x - e.x));
      const aimOk = Math.abs(shootAngle) < Math.PI / 5;
      if (aimOk) {
        enemyBullets.push({
          x: e.x + Math.cos(shootAngle) * 24 * eDir,
          y: e.y + Math.sin(shootAngle) * 24,
          vx: Math.cos(shootAngle) * 5.6 * eDir,
          vy: Math.sin(shootAngle) * 5.6,
          life: 70, isFlak: false,
        });
        playGunshot(true);
        e.fireCooldown = 70 + Math.floor(Math.random() * 90);
      } else {
        e.fireCooldown = 15;
      }
    }
  }
}

function updateAAGuns() {
  for (const g of aaGuns) {
    if (!g.alive) continue;
    g.cooldown--;
    if (g.cooldown <= 0 && !plane.dead && plane.y < g.y - 30) {
      const spread = (Math.random() - 0.5) * 80;
      const dx     = plane.x - g.x + spread;
      const dy     = plane.y - g.y;
      const ang    = Math.atan2(dy, dx);
      enemyBullets.push({
        x: g.x, y: g.y - 12,
        vx: Math.cos(ang) * 2.8,
        vy: Math.sin(ang) * 2.8,
        life: 110, isFlak: true,
      });
      playGunshot(true);
      g.cooldown = 100 + Math.floor(Math.random() * 120);
    }
  }
}

function updateBalloons() {
  for (const b of balloons) {
    if (!b.alive) continue;
    b.wobble += 0.016;
    b.x += b.driftVx + Math.sin(b.wobble) * 0.05;
    if (b.x < 200 || b.x > WORLD_WIDTH - 200) b.driftVx *= -1;
  }
}

function updateEnemyBullets() {
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const b = enemyBullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.vy += GRAVITY * (b.isFlak ? 0.15 : 0.25);
    b.life--;
    if (b.life <= 0 || b.y > terrainYAt(b.x)) { enemyBullets.splice(i, 1); continue; }
    // hit player
    if (!plane.dead && Math.abs(b.x - plane.x) < 16 && Math.abs(b.y - plane.y) < 13) {
      enemyBullets.splice(i, 1);
      killPlane();
    }
  }
}

// ── Projectile updates ────────────────────────────────────────────────────────
function updateProjectiles() {
  // player bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx; b.y += b.vy;
    b.vy += GRAVITY * 0.3;
    b.life--;
    if (b.life <= 0 || b.y > terrainYAt(b.x)) { bullets.splice(i, 1); continue; }

    let hit = false;

    // ground targets
    for (const t of targets) {
      if (!t.alive) continue;
      if (b.x > t.x && b.x < t.x + t.w && b.y > t.y && b.y < t.y + t.h) {
        t.alive = false; score += t.score;
        spawnExplosion(t.x + t.w / 2, t.y, false);
        bullets.splice(i, 1); hit = true; break;
      }
    }
    if (hit) continue;

    // enemy planes
    for (const e of enemyPlanes) {
      if (!e.alive) continue;
      if (Math.abs(b.x - e.x) < 20 && Math.abs(b.y - e.y) < 13) {
        e.alive = false; score += e.score;
        spawnExplosion(e.x, e.y, true);
        bullets.splice(i, 1); hit = true; break;
      }
    }
    if (hit) continue;

    // balloons
    for (const bl of balloons) {
      if (!bl.alive) continue;
      if (Math.abs(b.x - bl.x) < 24 && Math.abs(b.y - bl.y) < 32) {
        bl.alive = false; score += bl.score;
        spawnExplosion(bl.x, bl.y, false);
        bullets.splice(i, 1); hit = true; break;
      }
    }
    if (hit) continue;

    // AA guns
    for (const g of aaGuns) {
      if (!g.alive) continue;
      if (Math.abs(b.x - g.x) < 12 && b.y > g.y - 22 && b.y < g.y + 4) {
        g.alive = false; score += g.score;
        spawnExplosion(g.x, g.y - 8, false);
        bullets.splice(i, 1); break;
      }
    }
  }

  // bombs
  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i];
    b.x += b.vx; b.y += b.vy;
    b.vy += GRAVITY * 1.2; b.life--;
    const gy = terrainYAt(b.x);
    if (b.life <= 0 || b.y >= gy) {
      spawnExplosion(b.x, Math.min(b.y, gy), true);
      bombs.splice(i, 1);
      const blastX = b.x;
      for (const t of targets)     { if (t.alive  && Math.abs(t.x - blastX) < 110) { t.alive = false; score += t.score; } }
      for (const e of enemyPlanes) { if (e.alive  && Math.abs(e.x - blastX) < 100) { e.alive = false; score += e.score; spawnExplosion(e.x, e.y, true); } }
      for (const g of aaGuns)      { if (g.alive  && Math.abs(g.x - blastX) < 110) { g.alive = false; score += g.score; spawnExplosion(g.x, g.y, false); } }
      for (const bl of balloons)   { if (bl.alive && Math.abs(bl.x - blastX) < 100) { bl.alive = false; score += bl.score; } }
      continue;
    }
  }

  // explosions
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i];
    e.r    = e.maxR * (1 - e.life / e.maxLife);
    e.life--;
    if (e.life <= 0) explosions.splice(i, 1);
  }
}

// ── Level management ──────────────────────────────────────────────────────────
function checkLevelComplete() {
  if (levelComplete || plane.dead) return;
  if (targets.every(t => !t.alive)) {
    levelComplete = true;
    levelTimer    = 180;
  }
}

function updateLevelTimer() {
  if (!levelComplete) return;
  levelTimer--;
  if (levelTimer <= 0) nextLevel();
}

function nextLevel() {
  level++;
  lives++;
  targets     = spawnTargets(level);
  enemyPlanes = spawnEnemyPlanes(level);
  aaGuns      = spawnAAGuns(level, targets);
  balloons    = spawnBalloons(level);
  ammoPickups = spawnAmmoPickups();
  levelComplete = false; levelTimer = 0;
  bullets.length = 0; bombs.length = 0; enemyBullets.length = 0;
  cameraX = 0;
  resetPlane();
}

// ── Camera ────────────────────────────────────────────────────────────────────
function updateCamera() {
  const offset = plane.facingRight ? W * 0.33 : W * 0.67;
  const target = plane.x - offset;
  cameraX += (target - cameraX) * 0.08;
  cameraX  = Math.max(0, Math.min(WORLD_WIDTH - W, cameraX));
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function drawSky() {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,    '#08152b');
  grad.addColorStop(0.55, '#1a3a5c');
  grad.addColorStop(0.85, '#2a5472');
  grad.addColorStop(1,    '#1e3a28');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // distant clouds
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  const cloudSeeds = [120, 310, 530, 720];
  for (const seed of cloudSeeds) {
    const cx = ((seed * 73 - cameraX * 0.2) % (W + 200) + W + 200) % (W + 200) - 100;
    const cy = 60 + (seed % 80);
    ctx.beginPath(); ctx.ellipse(cx,      cy,      55, 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 30, cy - 10, 40, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx - 25, cy - 6,  35, 12, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function drawTerrain() {
  const startSeg = Math.floor(cameraX / TERRAIN_SEGMENT);
  const endSeg   = startSeg + Math.ceil(W / TERRAIN_SEGMENT) + 2;

  // dirt fill
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let i = startSeg; i <= endSeg; i++) {
    const wx = i * TERRAIN_SEGMENT;
    const wy = terrain[Math.max(0, Math.min(i, terrain.length - 1))];
    ctx.lineTo(wx - cameraX, wy);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  const terrGrad = ctx.createLinearGradient(0, H * 0.5, 0, H);
  terrGrad.addColorStop(0, '#2d5a1b');
  terrGrad.addColorStop(0.4, '#3a6e22');
  terrGrad.addColorStop(1, '#1a3a10');
  ctx.fillStyle = terrGrad;
  ctx.fill();

  // grass highlight line
  ctx.beginPath();
  for (let i = startSeg; i <= endSeg; i++) {
    const wx = i * TERRAIN_SEGMENT;
    const wy = terrain[Math.max(0, Math.min(i, terrain.length - 1))];
    i === startSeg ? ctx.moveTo(wx - cameraX, wy) : ctx.lineTo(wx - cameraX, wy);
  }
  ctx.strokeStyle = '#6abf38'; ctx.lineWidth = 2.5; ctx.stroke();

  // sub-surface detail line
  ctx.beginPath();
  for (let i = startSeg; i <= endSeg; i++) {
    const wx = i * TERRAIN_SEGMENT;
    const wy = terrain[Math.max(0, Math.min(i, terrain.length - 1))];
    i === startSeg ? ctx.moveTo(wx - cameraX, wy + 6) : ctx.lineTo(wx - cameraX, wy + 6);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1; ctx.stroke();
}

function drawPlatform() {
  const platformX = 150;  // start position
  const platformW = 300;  // width
  const platformStartX = platformX - cameraX;
  const platformEndX = platformStartX + platformW;

  // skip if off screen
  if (platformEndX < 0 || platformStartX > W) return;

  const terrainAtStart = terrainYAt(platformX);
  const terrainAtEnd = terrainYAt(platformX + platformW);
  const avgTerrainY = (terrainAtStart + terrainAtEnd) / 2;

  // platform boundaries
  const platformTopY = avgTerrainY - 25;
  const platformBottomY = avgTerrainY + 5;

  // trapezoid shape: wider at bottom, narrower at top
  const topInset = 20;  // inset from edges at top
  const slant = platformW * 0.15;  // slant amount

  // paved surface with gradient
  const pavGrad = ctx.createLinearGradient(platformStartX, platformTopY, platformStartX, platformBottomY);
  pavGrad.addColorStop(0, '#505050');
  pavGrad.addColorStop(0.5, '#707070');
  pavGrad.addColorStop(1, '#404040');
  ctx.fillStyle = pavGrad;
  
  // draw trapezoid
  ctx.beginPath();
  ctx.moveTo(platformStartX + topInset, platformTopY);
  ctx.lineTo(platformEndX - topInset, platformTopY);
  ctx.lineTo(platformEndX, platformBottomY);
  ctx.lineTo(platformStartX, platformBottomY);
  ctx.closePath();
  ctx.fill();

  // concrete texture with grid lines (lane markings)
  ctx.strokeStyle = '#ffff99';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.6;
  
  // center line
  ctx.beginPath();
  ctx.moveTo(platformStartX + topInset / 2, (platformTopY + platformBottomY) / 2);
  ctx.lineTo(platformEndX - topInset / 2, (platformTopY + platformBottomY) / 2);
  ctx.stroke();

  // dashed side lines following trapezoid edges
  ctx.lineWidth = 1;
  ctx.setLineDash([10, 8]);
  // left edge
  ctx.beginPath();
  ctx.moveTo(platformStartX + topInset * 0.7, platformTopY + 6);
  ctx.lineTo(platformStartX, platformBottomY - 6);
  ctx.stroke();
  // right edge
  ctx.beginPath();
  ctx.moveTo(platformEndX - topInset * 0.7, platformTopY + 6);
  ctx.lineTo(platformEndX, platformBottomY - 6);
  ctx.stroke();
  ctx.setLineDash([]);

  // concrete seams every 50px
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 6; i++) {
    const x = platformStartX + (platformW * i / 6);
    const topX = platformStartX + topInset + (platformW - topInset * 2) * (i / 6);
    const progress = i / 6;
    const seamTop = platformTopY + (topX - (platformStartX + topInset));
    ctx.beginPath();
    ctx.moveTo(topX, platformTopY);
    ctx.lineTo(x, platformBottomY);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

function drawBuilding(sx, t) {
  const x = sx, y = t.y, w = t.w, h = t.h;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 3, y + h, w, 4);
  // wall
  const wallGrad = ctx.createLinearGradient(x, 0, x + w, 0);
  wallGrad.addColorStop(0, '#9b8060');
  wallGrad.addColorStop(0.5, '#c4a878');
  wallGrad.addColorStop(1, '#7a6248');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(x, y, w, h);
  // roof
  ctx.fillStyle = '#6a4e30';
  ctx.beginPath();
  ctx.moveTo(x - 2, y);
  ctx.lineTo(x + w / 2, y - 8);
  ctx.lineTo(x + w + 2, y);
  ctx.closePath();
  ctx.fill();
  // windows
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const wx = x + 4 + col * 10, wy = y + 6 + row * 11;
      ctx.fillStyle = (row + col + Math.floor(frame / 60)) % 3 === 0 ? '#ffe066' : '#ffcc44';
      ctx.fillRect(wx, wy, 6, 7);
      ctx.strokeStyle = '#8a6a30'; ctx.lineWidth = 0.5;
      ctx.strokeRect(wx, wy, 6, 7);
    }
  }
  // outline
  ctx.strokeStyle = '#5a4020'; ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}

function drawFuelDepot(sx, t) {
  const x = sx + t.w / 2, y = t.y + t.h / 2, r = t.w / 2 + 1;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(x + 2, t.y + t.h + 2, r, 3, 0, 0, Math.PI * 2); ctx.fill();
  // tank body
  const tankGrad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  tankGrad.addColorStop(0, '#ff7733');
  tankGrad.addColorStop(0.6, '#cc4400');
  tankGrad.addColorStop(1, '#882200');
  ctx.fillStyle = tankGrad;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  // hazard stripes
  ctx.save(); ctx.clip();  // clip to circle... actually skip, just draw
  ctx.restore();
  ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  // skull-like X marking
  ctx.strokeStyle = 'rgba(255,255,0,0.6)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke();
  // cap on top
  ctx.fillStyle = '#555';
  ctx.fillRect(x - 3, t.y - 4, 6, 5);
}

function drawHangar(sx, t) {
  const x = sx, y = t.y, w = t.w, h = t.h;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 4, y + h, w, 5);
  // walls
  ctx.fillStyle = '#7a7a7a';
  ctx.fillRect(x, y + h * 0.35, w, h * 0.65);
  // curved roof
  const roofGrad = ctx.createLinearGradient(x, y, x, y + h * 0.4);
  roofGrad.addColorStop(0, '#aaaaaa');
  roofGrad.addColorStop(1, '#666666');
  ctx.fillStyle = roofGrad;
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.35);
  ctx.bezierCurveTo(x, y - h * 0.1, x + w, y - h * 0.1, x + w, y + h * 0.35);
  ctx.closePath();
  ctx.fill();
  // door
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(x + w * 0.2, y + h * 0.4, w * 0.6, h * 0.6);
  // door frame
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5;
  ctx.strokeRect(x + w * 0.2, y + h * 0.4, w * 0.6, h * 0.6);
  // roof ribs
  ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const rx = x + w * i / 5;
    ctx.beginPath();
    ctx.moveTo(rx, y + h * 0.35);
    ctx.bezierCurveTo(rx, y, rx, y, rx, y - 2);
    ctx.stroke();
  }
}

function drawTargets() {
  for (const t of targets) {
    if (!t.alive) continue;
    const sx = t.x - cameraX;
    if (sx < -80 || sx > W + 80) continue;
    if (t.type === 'building') drawBuilding(sx, t);
    else if (t.type === 'fuel') drawFuelDepot(sx, t);
    else drawHangar(sx, t);
  }
}

function drawAAGuns() {
  for (const g of aaGuns) {
    if (!g.alive) continue;
    const sx = g.x - cameraX;
    if (sx < -50 || sx > W + 50) continue;
    const dx  = plane.x - g.x;
    const dy  = plane.y - g.y;
    const ang = Math.atan2(dy, dx);

    // sandbag mound
    ctx.fillStyle = '#8b7a50';
    ctx.beginPath(); ctx.ellipse(sx, g.y - 2, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7a6a40';
    ctx.beginPath(); ctx.ellipse(sx - 8, g.y - 1, 7, 5, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(sx + 8, g.y - 1, 7, 5, -0.3, 0, Math.PI * 2); ctx.fill();

    // wheeled carriage
    ctx.fillStyle = '#555';
    ctx.fillRect(sx - 10, g.y - 6, 20, 6);
    // wheels
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(sx - 8, g.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + 8, g.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(sx - 8, g.y, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx + 8, g.y, 4, 0, Math.PI * 2); ctx.stroke();

    // pivot
    ctx.fillStyle = '#666';
    ctx.beginPath(); ctx.arc(sx, g.y - 6, 4, 0, Math.PI * 2); ctx.fill();

    // barrel
    ctx.save();
    ctx.translate(sx, g.y - 6);
    ctx.rotate(ang);
    const bGrad = ctx.createLinearGradient(0, -3, 0, 3);
    bGrad.addColorStop(0, '#888'); bGrad.addColorStop(1, '#444');
    ctx.fillStyle = bGrad;
    ctx.fillRect(0, -2.5, 22, 5);
    ctx.fillStyle = '#999';
    ctx.fillRect(18, -3.5, 5, 7); // muzzle brake
    ctx.restore();
  }
}

function drawAmmoPickups() {
  for (const p of ammoPickups) {
    if (p.collected) continue;
    const sx  = p.x - cameraX;
    if (sx < -60 || sx > W + 60) continue;
    const bob = Math.sin(frame * 0.06) * 5;
    const sy  = p.baseY + bob;

    ctx.save();

    if (p.type === 'bomb') {
      // bomb pickup: dark red/grey bomb shape with fuse
      ctx.globalAlpha = 0.6 + Math.sin(frame * 0.1) * 0.25;
      ctx.strokeStyle = '#ff4400'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(sx, sy, 28, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.translate(sx, sy);
      ctx.scale(1.4, 1.4);
      // bomb body
      ctx.fillStyle = '#333';
      ctx.beginPath(); ctx.arc(0, 3, 12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#666'; ctx.lineWidth = 1.5; ctx.stroke();
      // nose cone
      ctx.fillStyle = '#555';
      ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(5, -5); ctx.lineTo(0, -13); ctx.closePath(); ctx.fill();
      // fuse
      ctx.strokeStyle = '#cc8800'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -13); ctx.quadraticCurveTo(8, -20, 4, -26); ctx.stroke();
      // spark
      ctx.fillStyle = '#ffff00';
      ctx.globalAlpha = 0.7 + Math.sin(frame * 0.3) * 0.3;
      ctx.beginPath(); ctx.arc(4, -26, 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // label
      ctx.fillStyle = '#ff8866';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('BOMB', 0, 28);
    } else {
      // bullet ammo: yellow rotating star (original style)
      ctx.globalAlpha = 0.6 + Math.sin(frame * 0.1) * 0.25;
      ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(sx, sy, 28, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.translate(sx, sy);
      ctx.scale(1.4, 1.4);
      ctx.rotate(frame * 0.025);
      ctx.fillStyle = '#ffdd00';
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const outer = (i * 4 * Math.PI / 5) - Math.PI / 2;
        const inner = outer + (2 * Math.PI / 10);
        i === 0
          ? ctx.moveTo(Math.cos(outer) * 14, Math.sin(outer) * 14)
          : ctx.lineTo(Math.cos(outer) * 14, Math.sin(outer) * 14);
        ctx.lineTo(Math.cos(inner) * 6, Math.sin(inner) * 6);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ff8800'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.rotate(-frame * 0.025);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('AMMO', 0, 26);
    }

    ctx.textAlign = 'left';
    ctx.restore();
  }
}

function drawBalloons() {
  for (const b of balloons) {
    if (!b.alive) continue;
    const sx  = b.x - cameraX;
    if (sx < -100 || sx > W + 100) continue;
    const gy  = terrainYAt(b.x);
    const sway = Math.sin(b.wobble * 0.5) * 3;

    // tether ropes (two lines)
    ctx.strokeStyle = '#aa8855'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx - 6, b.y + 32); ctx.lineTo(sx - 4, gy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx + 6, b.y + 32); ctx.lineTo(sx + 4, gy); ctx.stroke();

    // suspension ropes from balloon to basket
    ctx.strokeStyle = '#886644'; ctx.lineWidth = 0.8;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(sx + i * 14, b.y + 28);
      ctx.lineTo(sx + i * 9, b.y + 32);
      ctx.stroke();
    }

    // envelope shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(sx + 4, b.y + 4, 22, 30, 0, 0, Math.PI * 2); ctx.fill();

    // envelope gradient
    const bGrad = ctx.createRadialGradient(sx - 8, b.y - 12, 2, sx, b.y, 30);
    bGrad.addColorStop(0,   '#ff6688');
    bGrad.addColorStop(0.4, '#cc2244');
    bGrad.addColorStop(1,   '#881122');
    ctx.fillStyle = bGrad;
    ctx.beginPath(); ctx.ellipse(sx + sway, b.y, 22, 30, 0, 0, Math.PI * 2); ctx.fill();

    // vertical panels
    ctx.strokeStyle = 'rgba(180,0,30,0.5)'; ctx.lineWidth = 1;
    for (let p = -2; p <= 2; p++) {
      ctx.beginPath();
      ctx.moveTo(sx + sway + p * 7, b.y - 30);
      ctx.quadraticCurveTo(sx + sway + p * 11, b.y, sx + sway + p * 7, b.y + 30);
      ctx.stroke();
    }

    // highlight
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.ellipse(sx + sway - 7, b.y - 10, 8, 12, -0.4, 0, Math.PI * 2); ctx.fill();

    // netting suggestion at top
    ctx.strokeStyle = 'rgba(100,50,0,0.4)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.arc(sx + sway, b.y - 22, 10, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();

    // basket
    const bx = sx + sway * 0.4, by = b.y + 32;
    ctx.fillStyle = '#7a5c2a';
    ctx.fillRect(bx - 10, by, 20, 13);
    // basket weave lines
    ctx.strokeStyle = '#5a4010'; ctx.lineWidth = 0.8;
    for (let bi = 1; bi < 3; bi++) {
      ctx.beginPath(); ctx.moveTo(bx - 10, by + bi * 4); ctx.lineTo(bx + 10, by + bi * 4); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(bx - 3, by); ctx.lineTo(bx - 3, by + 13); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + 3, by); ctx.lineTo(bx + 3, by + 13); ctx.stroke();
    // observer figure
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(bx, by + 3, 3, 0, Math.PI * 2); ctx.fill();
  }
}

function drawPlaneSopwith(sx, sy, angle, dir, isPlayer) {
  const propAngle = frame * 0.6; // spinning prop
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-angle * Math.PI / 180 * dir);
  ctx.scale(dir, 1);

  // ── Tail surfaces ────────────────────────────────
  ctx.fillStyle = isPlayer ? '#a08030' : '#2a5018';
  // horizontal stabiliser
  ctx.beginPath();
  ctx.moveTo(-16, -1); ctx.lineTo(-22, -7); ctx.lineTo(-20, -1); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-16,  1); ctx.lineTo(-22,  7); ctx.lineTo(-20,  1); ctx.closePath(); ctx.fill();
  // vertical fin
  ctx.beginPath();
  ctx.moveTo(-15, -1); ctx.lineTo(-21, -9); ctx.lineTo(-14, -2); ctx.closePath(); ctx.fill();

  // ── Fuselage ──────────────────────────────────────
  const fuseColor = isPlayer ? '#c8a84b' : '#4a7a3a';
  const fuseShade = isPlayer ? '#9a7830' : '#2a5018';
  ctx.fillStyle = fuseShade;
  ctx.beginPath();
  ctx.moveTo(-18,  4); ctx.lineTo( 14,  6); ctx.lineTo(18,  1); ctx.lineTo(-18,  1); ctx.closePath(); ctx.fill();
  ctx.fillStyle = fuseColor;
  ctx.beginPath();
  ctx.moveTo(-18,  1); ctx.lineTo( 18,  1); ctx.lineTo(14, -6); ctx.lineTo(-16, -4); ctx.closePath(); ctx.fill();
  // fuselage outline
  ctx.strokeStyle = isPlayer ? '#7a5510' : '#1a3a08'; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-18, -1.5); ctx.lineTo(18, -1.5); ctx.lineTo(14, -6); ctx.lineTo(-16, -4); ctx.closePath(); ctx.stroke();

  // ── Lower wing ────────────────────────────────────
  const wingColor = isPlayer ? '#d4b050' : '#5a8a45';
  ctx.fillStyle = wingColor;
  ctx.beginPath();
  ctx.moveTo(-6, 3); ctx.lineTo(16, 3); ctx.lineTo(18, 8); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = isPlayer ? '#906820' : '#2a5010'; ctx.lineWidth = 0.5;
  ctx.strokeRect(-6, 3, 22, 5);

  // ── Interplane struts ─────────────────────────────
  ctx.strokeStyle = isPlayer ? '#8a6820' : '#3a5818'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(-2, 3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(10, -14); ctx.lineTo(12, 3); ctx.stroke();

  // ── Upper wing ────────────────────────────────────
  ctx.fillStyle = wingColor;
  ctx.beginPath();
  ctx.moveTo(-10, -14); ctx.lineTo(20, -14); ctx.lineTo(22, -19); ctx.lineTo(-12, -19); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = isPlayer ? '#906820' : '#2a5010'; ctx.lineWidth = 0.5;
  ctx.stroke();

  // wing ribs
  ctx.strokeStyle = isPlayer ? 'rgba(160,100,0,0.4)' : 'rgba(30,70,10,0.4)'; ctx.lineWidth = 0.5;
  for (let r = 0; r <= 3; r++) {
    const rx = -10 + r * 8;
    ctx.beginPath(); ctx.moveTo(rx, -14); ctx.lineTo(rx - 1, -19); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx - 2, 3); ctx.lineTo(rx - 3, 8); ctx.stroke();
  }

  // ── Machine guns (player only, on top wing) ───────
  if (isPlayer) {
    ctx.fillStyle = '#333';
    ctx.fillRect(3, -21, 3, 7);
    ctx.fillRect(8, -21, 3, 7);
    ctx.fillStyle = '#222';
    ctx.fillRect(3, -22, 3, 2);
    ctx.fillRect(8, -22, 3, 2);
  }

  // ── Engine cowling ────────────────────────────────
  const cowlColor = isPlayer ? '#4a3a18' : '#1e3210';
  const cowlGrad  = ctx.createRadialGradient(10, -1, 1, 10, -1, 8);
  cowlGrad.addColorStop(0, isPlayer ? '#6a5a28' : '#3a5a28');
  cowlGrad.addColorStop(1, cowlColor);
  ctx.fillStyle = cowlGrad;
  ctx.beginPath(); ctx.arc(10, -1, 8, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = cowlColor; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(10, -1, 8, 0, Math.PI * 2); ctx.stroke();

  // ── Cockpit ───────────────────────────────────────
  ctx.fillStyle = 'rgba(80,120,180,0.45)';
  ctx.beginPath(); ctx.ellipse(1, -5, 6, 4, -0.3, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = isPlayer ? '#8a7020' : '#2a4810'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.ellipse(1, -5, 6, 4, -0.3, Math.PI, 0); ctx.stroke();
  // pilot silhouette
  ctx.fillStyle = '#1a1008';
  ctx.beginPath(); ctx.arc(0, -6, 3, 0, Math.PI * 2); ctx.fill();

  // ── Roundel / Iron Cross ──────────────────────────
  if (isPlayer) {
    // RAF roundel on fuselage
    ctx.beginPath(); ctx.arc(-7, 0, 5.5, 0, Math.PI * 2); ctx.fillStyle = '#003087'; ctx.fill();
    ctx.beginPath(); ctx.arc(-7, 0, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#fff';    ctx.fill();
    ctx.beginPath(); ctx.arc(-7, 0, 2,   0, Math.PI * 2); ctx.fillStyle = '#cc0000'; ctx.fill();
  } else {
    // Iron Cross on fuselage
    ctx.fillStyle = '#000';
    ctx.fillRect(-10, -2, 7, 4);
    ctx.fillRect(-8, -4, 3, 8);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-9.5, -1.5, 6, 3);
    ctx.fillRect(-7.5, -3.5, 2, 7);
  }

  // ── Propeller (spinning) ──────────────────────────
  ctx.save();
  ctx.translate(18, -1);
  ctx.rotate(propAngle);
  ctx.strokeStyle = isPlayer ? '#5a4010' : '#2a3808'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, 9); ctx.stroke();
  ctx.rotate(Math.PI / 2);
  ctx.strokeStyle = isPlayer ? 'rgba(90,64,16,0.5)' : 'rgba(42,56,8,0.5)';
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(0, 7); ctx.stroke();
  ctx.restore();

  ctx.restore();
}

function drawEnemyPlanes() {
  for (const e of enemyPlanes) {
    if (!e.alive) continue;
    const sx = e.x - cameraX;
    if (sx < -70 || sx > W + 70) continue;

    const dir = e.facingRight ? 1 : -1;
    ctx.save();
    ctx.translate(sx, e.y);
    ctx.rotate(-e.angle * Math.PI / 180 * dir);
    ctx.scale(dir, 1);

    // Fokker Dr.I triplane — three narrow stacked wings
    const fc = '#4a7a3a';

    // tail
    ctx.fillStyle = '#2a5018';
    ctx.beginPath(); ctx.moveTo(-16, -1); ctx.lineTo(-23, -8); ctx.lineTo(-20, -1); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-16,  1); ctx.lineTo(-23,  8); ctx.lineTo(-20,  1); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-15, -1); ctx.lineTo(-22,-10); ctx.lineTo(-14,-2); ctx.closePath(); ctx.fill();

    // fuselage
    ctx.fillStyle = '#2a5018';
    ctx.beginPath(); ctx.moveTo(-18,2); ctx.lineTo(14,5); ctx.lineTo(18,1); ctx.lineTo(-18,1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = fc;
    ctx.beginPath(); ctx.moveTo(-18,1); ctx.lineTo(18,1); ctx.lineTo(14,-5); ctx.lineTo(-16,-3); ctx.closePath(); ctx.fill();

    // three wings (triplane!)
    const wingC = '#5a8a45';
    const wingDark = '#2a5010';
    // bottom wing
    ctx.fillStyle = wingC;
    ctx.beginPath(); ctx.moveTo(-4,4); ctx.lineTo(14,4); ctx.lineTo(16,9); ctx.lineTo(-6,9); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = wingDark; ctx.lineWidth = 0.5; ctx.stroke();
    // mid wing
    ctx.beginPath(); ctx.moveTo(-8,-4); ctx.lineTo(16,-4); ctx.lineTo(18,-9); ctx.lineTo(-10,-9); ctx.closePath(); ctx.fill();
    ctx.stroke();
    // top wing
    ctx.beginPath(); ctx.moveTo(-10,-12); ctx.lineTo(18,-12); ctx.lineTo(20,-17); ctx.lineTo(-12,-17); ctx.closePath(); ctx.fill();
    ctx.stroke();

    // struts
    ctx.strokeStyle = '#3a5818'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-2,-12); ctx.lineTo(-1,-4); ctx.lineTo(0,4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10,-12); ctx.lineTo(11,-4); ctx.lineTo(12,4); ctx.stroke();

    // cowling
    const cg = ctx.createRadialGradient(10,-1,1,10,-1,8);
    cg.addColorStop(0,'#3a5a28'); cg.addColorStop(1,'#1a3010');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(10,-1,8,0,Math.PI*2); ctx.fill();

    // iron cross on mid wing
    ctx.fillStyle = '#000';
    ctx.fillRect(1,-9,6,5); ctx.fillRect(3,-11,2,9);
    ctx.fillStyle = '#fff';
    ctx.fillRect(1.5,-8.5,5,4); ctx.fillRect(3.5,-10.5,1,8);

    // pilot
    ctx.fillStyle = '#1a1008';
    ctx.beginPath(); ctx.arc(0,-4,3,0,Math.PI*2); ctx.fill();

    // prop
    ctx.save();
    ctx.translate(18,-1); ctx.rotate(frame * 0.7);
    ctx.strokeStyle = '#2a3808'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0,-8); ctx.lineTo(0,8); ctx.stroke();
    ctx.restore();

    ctx.restore();
  }
}

function drawPlayerPlane() {
  if (plane.dead) return;
  drawPlaneSopwith(plane.x - cameraX, plane.y, plane.angle, plane.facingRight ? 1 : -1, true);
}

function drawBullets() {
  for (const b of bullets) {
    const sx = b.x - cameraX;
    // tracer streak
    ctx.strokeStyle = 'rgba(255,240,80,0.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx - b.vx * 3, b.y - b.vy * 3); ctx.lineTo(sx, b.y); ctx.stroke();
    ctx.fillStyle = '#fff8aa';
    ctx.beginPath(); ctx.arc(sx, b.y, 1.8, 0, Math.PI * 2); ctx.fill();
  }
}

function drawEnemyBullets() {
  for (const b of enemyBullets) {
    const sx = b.x - cameraX;
    const col = b.isFlak ? 'rgba(255,120,0,0.6)' : 'rgba(255,60,60,0.6)';
    const dot = b.isFlak ? '#ffcc44' : '#ff8888';
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx - b.vx * 3, b.y - b.vy * 3); ctx.lineTo(sx, b.y); ctx.stroke();
    ctx.fillStyle = dot;
    ctx.beginPath(); ctx.arc(sx, b.y, 2, 0, Math.PI * 2); ctx.fill();
  }
}

function drawBombs() {
  for (const b of bombs) {
    const sx  = b.x - cameraX;
    const ang = Math.atan2(b.vy, b.vx) + Math.PI / 2;
    ctx.save();
    ctx.translate(sx, b.y);
    ctx.rotate(ang);
    // body
    ctx.fillStyle = '#555';
    ctx.beginPath(); ctx.ellipse(0, 0, 3, 6, 0, 0, Math.PI * 2); ctx.fill();
    // nose
    ctx.fillStyle = '#777';
    ctx.beginPath(); ctx.moveTo(-3, 5); ctx.lineTo(0, 9); ctx.lineTo(3, 5); ctx.closePath(); ctx.fill();
    // fins
    ctx.fillStyle = '#444';
    ctx.beginPath(); ctx.moveTo(-3,-4); ctx.lineTo(-7,-8); ctx.lineTo(-1,-6); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo( 3,-4); ctx.lineTo( 7,-8); ctx.lineTo( 1,-6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function drawExplosions() {
  for (const e of explosions) {
    const t    = 1 - e.life / e.maxLife;
    const ex   = e.x - cameraX;
    const r    = Math.max(e.r, 1);
    // outer fireball
    const grad = ctx.createRadialGradient(ex, e.y, 0, ex, e.y, r);
    grad.addColorStop(0,   `rgba(255,255,200,${(1-t)*0.95})`);
    grad.addColorStop(0.3, `rgba(255,180,0,${(1-t)*0.9})`);
    grad.addColorStop(0.7, `rgba(200,60,0,${(1-t)*0.7})`);
    grad.addColorStop(1,   'rgba(80,40,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(ex, e.y, r, 0, Math.PI * 2); ctx.fill();
    // smoke ring (later in animation)
    if (t > 0.4) {
      ctx.fillStyle = `rgba(60,60,60,${(t-0.4)*0.5})`;
      ctx.beginPath(); ctx.arc(ex, e.y - r*0.2, r * 1.1, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawHUD() {
  const thr       = Math.round(plane.throttle * 100);
  const spd       = Math.hypot(plane.vx, plane.vy);
  const alt       = Math.max(0, Math.round(terrainYAt(plane.x) - plane.y));
  const nearCeiling = plane.y < CEILING_Y + CEILING_ZONE;
  const atCeiling   = plane.y < CEILING_Y + 30;
  const stallWarn   = spd < 1.0 && !plane.onGround;
  const warn        = atCeiling ? ' !!CEILING' : stallWarn ? ' !!STALL' : nearCeiling ? ' THIN AIR' : '';
  const remaining   = targets.filter(t => t.alive).length;
  document.getElementById('hud-speed').textContent  = `THR: ${thr}%  SPD: ${spd.toFixed(1)}${warn}`;
  document.getElementById('hud-alt').textContent    = `ALT: ${alt}`;
  document.getElementById('hud-ammo').textContent   = `AMMO: ${plane.ammo}`;
  document.getElementById('hud-bombs').textContent  = `BOMBS: ${plane.bombs}`;
  document.getElementById('hud-score').textContent  = `SCORE: ${score}  LVL: ${level}  TARGETS: ${remaining}`;

  // lives as plane icons
  const lifeX = W - 30, lifeY = 18;
  for (let i = 0; i < 3; i++) {
    const lx = lifeX - i * 28;
    ctx.save();
    ctx.translate(lx, lifeY);
    ctx.scale(0.55, 0.55);
    if (i < lives) {
      ctx.fillStyle = '#d4b050';
      ctx.beginPath(); ctx.ellipse(0, 0, 18, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d4b050';
      ctx.fillRect(-8, -14, 30, 5);
      ctx.fillRect(-4, 4, 24, 4);
      ctx.beginPath(); ctx.arc(10, 0, 5, 0, Math.PI * 2); ctx.fillStyle = '#6b5020'; ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(200,80,80,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-12, -12); ctx.lineTo(12, 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(12, -12); ctx.lineTo(-12, 12); ctx.stroke();
    }
    ctx.restore();
  }

  // ammo/bomb sprites in upper left
  let spriteX = 8;
  let spriteY = 6;
  
  // draw ammo bullets as stars in single row
  ctx.fillStyle = '#ffdd00';
  for (let i = 0; i < plane.ammo; i++) {
    ctx.save();
    ctx.translate(spriteX, spriteY);
    ctx.scale(1.0, 1.0);
    ctx.beginPath();
    for (let j = 0; j < 5; j++) {
      const outer = (j * 4 * Math.PI / 5) - Math.PI / 2;
      const inner = outer + (2 * Math.PI / 10);
      j === 0
        ? ctx.moveTo(Math.cos(outer) * 8, Math.sin(outer) * 8)
        : ctx.lineTo(Math.cos(outer) * 8, Math.sin(outer) * 8);
      ctx.lineTo(Math.cos(inner) * 3, Math.sin(inner) * 3);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    spriteX += 18;
  }
  
  // draw bombs in row below
  spriteX = 8;
  spriteY += 28;
  
  ctx.fillStyle = '#333';
  for (let i = 0; i < plane.bombs; i++) {
    ctx.save();
    ctx.translate(spriteX, spriteY);
    ctx.scale(1.5, 1.5);
    // bomb body
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#666'; ctx.lineWidth = 0.8; ctx.stroke();
    // nose cone
    ctx.fillStyle = '#555';
    ctx.beginPath(); ctx.moveTo(-2, -2); ctx.lineTo(2, -2); ctx.lineTo(0, -5); ctx.closePath(); ctx.fill();
    // fuse
    ctx.strokeStyle = '#cc8800'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, -5); ctx.quadraticCurveTo(3, -8, 2, -10); ctx.stroke();
    ctx.restore();
    spriteX += 18;
  }

  if (plane.dead && !gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff4444'; ctx.font = 'bold 36px monospace'; ctx.textAlign = 'center';
    ctx.fillText('SHOT DOWN', W / 2, H / 2 - 30);
    ctx.fillStyle = '#ffaa44'; ctx.font = '20px monospace';
    ctx.fillText(`${lives} ${lives === 1 ? 'life' : 'lives'} remaining`, W / 2, H / 2 + 10);
    ctx.fillStyle = '#888'; ctx.font = '15px monospace';
    ctx.fillText('Respawning...', W / 2, H / 2 + 38);
    ctx.textAlign = 'left';
  }

  if (gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff2222'; ctx.font = 'bold 52px monospace';
    ctx.fillText('GAME OVER', W / 2, H / 2 - 50);
    ctx.fillStyle = '#ffcc44'; ctx.font = 'bold 24px monospace';
    ctx.fillText(`FINAL SCORE: ${score}`, W / 2, H / 2 + 4);
    ctx.fillStyle = '#aaaaaa'; ctx.font = '16px monospace';
    ctx.fillText(`Reached Level ${level}`, W / 2, H / 2 + 36);
    ctx.fillStyle = '#44ff88'; ctx.font = '18px monospace';
    ctx.fillText('Press any key to fly again', W / 2, H / 2 + 78);
    ctx.textAlign = 'left';
  }

  if (levelComplete) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#44ff88'; ctx.font = 'bold 38px monospace';
    ctx.fillText(`LEVEL ${level} CLEAR!`, W / 2, H / 2 - 34);
    ctx.fillStyle = '#ffdd44'; ctx.font = 'bold 22px monospace';
    ctx.fillText('+1 UP', W / 2, H / 2 + 4);
    ctx.fillStyle = '#ccc'; ctx.font = '16px monospace';
    ctx.fillText(`Next level in ${Math.ceil(levelTimer / 60)}...`, W / 2, H / 2 + 34);
    ctx.textAlign = 'left';
  }
}

// ── Title screen ──────────────────────────────────────────────────────────────
function drawTitleScreen() {
  // sky backdrop
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,    '#08152b');
  grad.addColorStop(0.6,  '#1a3a5c');
  grad.addColorStop(1,    '#1e3a28');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // stars
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  const starPos = [
    [80,40],[200,25],[350,60],[500,30],[680,55],[820,20],[950,45],[1100,35],[1150,70],
    [130,90],[400,15],[600,80],[750,40],[900,65],[1050,20],[300,100],[700,10],[1000,85],
  ];
  for (const [sx, sy] of starPos) {
    ctx.beginPath(); ctx.arc(sx, sy, 0.8 + Math.random() * 0.6, 0, Math.PI * 2); ctx.fill();
  }

  // distant terrain silhouette
  ctx.fillStyle = '#1a3a10';
  ctx.beginPath(); ctx.moveTo(0, H);
  const silSteps = 30;
  for (let i = 0; i <= silSteps; i++) {
    const sx = (i / silSteps) * W;
    const sy = H - 80 - Math.sin(i * 0.7) * 35 - Math.sin(i * 1.3) * 20;
    ctx.lineTo(sx, sy);
  }
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

  // title — large stencil style
  ctx.textAlign = 'center';
  // drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.font = 'bold 96px monospace';
  ctx.fillText('SOPWITH', W / 2 + 4, 154);
  // main text with gradient
  const titleGrad = ctx.createLinearGradient(0, 70, 0, 155);
  titleGrad.addColorStop(0, '#ffe066');
  titleGrad.addColorStop(0.5, '#d4a030');
  titleGrad.addColorStop(1, '#a06010');
  ctx.fillStyle = titleGrad;
  ctx.font = 'bold 96px monospace';
  ctx.fillText('SOPWITH', W / 2, 150);
  // outline
  ctx.strokeStyle = '#7a4010'; ctx.lineWidth = 2;
  ctx.strokeText('SOPWITH', W / 2, 150);

  // subtitle
  ctx.fillStyle = '#aaccee';
  ctx.font = '18px monospace';
  ctx.fillText('A WWI AERIAL COMBAT GAME', W / 2, 185);

  // draw a large hero Sopwith Camel centred on screen
  ctx.save();
  ctx.translate(W / 2 - 60, 290);
  ctx.scale(2.2, 2.2);
  drawPlaneSopwith(0, 0, 8, 1, true);
  ctx.restore();

  // controls box
  const boxX = W / 2 - 260, boxY = 370, boxW = 520, boxH = 240;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,160,50,0.4)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(boxX, boxY, boxW, boxH, 8); ctx.stroke();

  ctx.fillStyle = '#d4b050';
  ctx.font = 'bold 14px monospace';
  ctx.fillText('CONTROLS', W / 2, boxY + 22);

  const controls = [
    ['W / S',    'Throttle up / down'],
    ['A / D',    'Pitch nose up / down'],
    ['SPACE',    'Fire machine guns'],
    ['B',        'Drop bomb'],
    ['L',        'Loop  (reverses direction)'],
    ['Q',        'Quit to menu'],
    ['M',        'Mute / unmute sound'],
  ];

  ctx.font = '14px monospace';
  const colL = W / 2 - 200, colR = W / 2 - 60;
  controls.forEach(([key, desc], i) => {
    const y = boxY + 50 + i * 28;
    ctx.fillStyle = '#ffdd88';
    ctx.textAlign = 'right';
    ctx.fillText(key, colR, y);
    ctx.fillStyle = '#ccddee';
    ctx.textAlign = 'left';
    ctx.fillText(desc, colR + 14, y);
  });

  // blinking press key prompt
  ctx.textAlign = 'center';
  if (Math.floor(frame / 35) % 2 === 0) {
    ctx.fillStyle = '#44ff88';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('PRESS ANY KEY TO FLY', W / 2, boxY + boxH + 36);
  }
}

// ── Game loop ─────────────────────────────────────────────────────────────────
function loop() {
  frame++;
  if (!gameOver && !titleScreen) {
    updatePlane();
    updateEnemyPlanes();
    updateAAGuns();
    updateBalloons();
    updateAmmoPickups();
    updateEnemyBullets();
    updateProjectiles();
    checkLevelComplete();
    updateLevelTimer();
    updateCamera();
  }
  updateEngineSound();

  if (titleScreen) {
    drawTitleScreen();
  } else {
    drawSky();
    drawTerrain();
    drawPlatform();
    drawTargets();
    drawAAGuns();
    drawAmmoPickups();
    drawBalloons();
    drawEnemyPlanes();
    drawBullets();
    drawEnemyBullets();
    drawBombs();
    drawExplosions();
    drawPlayerPlane();
    drawHUD();
  }

  requestAnimationFrame(loop);
}

loop();
