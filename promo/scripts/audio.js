// Synthesises the reel's music + sound design, locked to the same 100 BPM grid
// the animation uses (BEAT = 0.6s), then loudness-normalises to Instagram's
// -14 LUFS / -1 dBTP with ffmpeg.
//
//   node scripts/audio.js   -> out/voniweb-reel-audio.wav
//
// Everything is generated from code (no samples), so it is royalty-free.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SR = 48000;
const DUR = 15;
const N = SR * DUR;
const BEAT = 0.6;
const B = (n) => n * BEAT;
const OUT = path.join(__dirname, "..", "out");

/* ---------- utilities ---------- */
let seed = 0x9e3779b9;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const noise = () => rand() * 2 - 1;
const TAU = Math.PI * 2;
const note = (n) => 440 * Math.pow(2, (n - 69) / 12); // midi -> Hz

const bus = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
const drums = bus(), bass = bus(), pad = bus(), sfx = bus(), send = bus();

function put(b, i, v, pan = 0) {
  if (i < 0 || i >= N) return;
  const a = (pan + 1) * Math.PI / 4;
  b.L[i] += v * Math.cos(a); b.R[i] += v * Math.sin(a);
}
// write to a bus and (optionally) the reverb send
function out(b, i, v, pan, wet = 0) { put(b, i, v, pan); if (wet) put(send, i, v * wet, pan); }

class Biquad {
  constructor(type, f, q = 0.707) { this.type = type; this.q = q; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(f); }
  set(f) {
    const w = TAU * Math.min(Math.max(f, 10), SR * 0.45) / SR, cs = Math.cos(w), sn = Math.sin(w), a = sn / (2 * this.q);
    let b0, b1, b2; const a0 = 1 + a, a1 = -2 * cs, a2 = 1 - a;
    if (this.type === "lp") { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
    else if (this.type === "hp") { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
    else { b0 = a; b1 = 0; b2 = -a; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y;
  }
}
const saw = (ph) => 2 * (ph - Math.floor(ph + 0.5));

/* ---------- drums ---------- */
const kickTimes = [];
function kick(t0, g = 1) {
  kickTimes.push(t0);
  let ph = 0; const s = Math.round(t0 * SR);
  for (let i = 0; i < 0.5 * SR; i++) {
    const t = i / SR, f = 46 + 150 * Math.exp(-t * 32);
    ph += f / SR;
    const amp = Math.exp(-t * 6.5) * Math.min(1, t / 0.0015);
    const click = t < 0.004 ? noise() * (1 - t / 0.004) * 0.5 : 0;
    out(drums, s + i, Math.tanh((Math.sin(TAU * ph) * amp + click) * 1.8) * 0.85 * g, 0);
  }
}
function clap(t0, g = 1, pan = 0) {
  const bp = new Biquad("bp", 1400, 1.1), s = Math.round(t0 * SR);
  for (let i = 0; i < 0.3 * SR; i++) {
    const t = i / SR;
    let env = 0;
    for (const o of [0, 0.011, 0.023]) if (t >= o) env = Math.max(env, Math.exp(-(t - o) * 260));
    if (t > 0.03) env = Math.max(env, 0.55 * Math.exp(-(t - 0.03) * 20));
    out(drums, s + i, bp.run(noise()) * env * 2.4 * g, pan, 0.35);
  }
}
function snare(t0, g = 1, body = 190) {
  const hp = new Biquad("hp", 1200), s = Math.round(t0 * SR);
  for (let i = 0; i < 0.18 * SR; i++) {
    const t = i / SR;
    const v = hp.run(noise()) * Math.exp(-t * 28) * 0.9 + Math.sin(TAU * body * t) * Math.exp(-t * 35) * 0.6;
    out(drums, s + i, v * g, 0, 0.2);
  }
}
function hat(t0, open = false, g = 1, pan = 0.25) {
  const hp = new Biquad("hp", 7800, 0.9), s = Math.round(t0 * SR), d = open ? 0.35 : 0.06;
  for (let i = 0; i < d * SR; i++) {
    const t = i / SR;
    out(drums, s + i, hp.run(noise()) * Math.exp(-t * (open ? 10 : 70)) * 0.55 * g, pan, open ? 0.15 : 0);
  }
}

/* ---------- tonal ---------- */
function bassNote(t0, dur, f, g = 1) {
  const lp = new Biquad("lp", 400, 1.4), s = Math.round(t0 * SR);
  let ph = 0, ph2 = 0;
  for (let i = 0; i < (dur + 0.03) * SR; i++) {
    const t = i / SR;
    ph += f / SR; ph2 += f / 2 / SR;
    lp.set(160 + 1100 * Math.exp(-t * 14));
    const env = Math.min(1, t / 0.004) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.03) : 1);
    const v = lp.run(saw(ph)) * 0.75 + Math.sin(TAU * ph2 * 2) * 0.55;
    out(bass, s + i, v * env * g, 0);
  }
}
function padChord(t0, dur, notes, g = 1, cutoff = 1400, attack = 0.25, release = 0.5) {
  const s = Math.round(t0 * SR);
  const voices = [];
  notes.forEach((n) => [-9, 0, 9].forEach((cents, k) => voices.push({ f: note(n) * Math.pow(2, cents / 1200), ph: rand(), pan: (k - 1) * 0.7 })));
  const lpL = new Biquad("lp", cutoff, 0.8), lpR = new Biquad("lp", cutoff, 0.8);
  const norm = 1 / Math.sqrt(voices.length);
  for (let i = 0; i < (dur + release) * SR; i++) {
    const t = i / SR;
    const env = Math.min(1, t / attack) * (t > dur ? Math.exp(-(t - dur) * 6 / release) : 1);
    let l = 0, r = 0;
    for (const v of voices) {
      v.ph += v.f / SR;
      const x = saw(v.ph), a = (v.pan + 1) * Math.PI / 4;
      l += x * Math.cos(a); r += x * Math.sin(a);
    }
    const yl = lpL.run(l * norm) * env * g, yr = lpR.run(r * norm) * env * g;
    if (s + i < N) { pad.L[s + i] += yl; pad.R[s + i] += yr; send.L[s + i] += yl * 0.3; send.R[s + i] += yr * 0.3; }
  }
}
function bell(t0, f, g = 1, pan = 0, decay = 1, wet = 0.45) {
  const s = Math.round(t0 * SR);
  const parts = [[1, 1, 3], [2, 0.35, 6], [3.01, 0.2, 9], [4.2, 0.1, 14]];
  for (let i = 0; i < 1.6 * decay * SR; i++) {
    const t = i / SR;
    let v = 0;
    for (const [m, a, d] of parts) v += Math.sin(TAU * f * m * t) * a * Math.exp(-t * d / decay);
    out(sfx, s + i, v * Math.min(1, t / 0.002) * 0.32 * g, pan, wet);
  }
}
function tick(t0, f = 2400, g = 1, pan = 0) {
  const s = Math.round(t0 * SR);
  for (let i = 0; i < 0.012 * SR; i++) { const t = i / SR; out(sfx, s + i, Math.sin(TAU * f * t) * Math.exp(-t * 500) * 0.35 * g, pan); }
}
function errorBlip(t0, g = 1, pan = 0) {
  // two-tone "denied" buzz
  const lp = new Biquad("lp", 2600, 0.9), s = Math.round(t0 * SR);
  for (let i = 0; i < 0.24 * SR; i++) {
    const t = i / SR, f = t < 0.09 ? 698 : 466;
    const env = (t < 0.085 ? 1 : t > 0.1 ? Math.exp(-(t - 0.1) * 14) : 0) * Math.min(1, t / 0.003);
    const sq = Math.sign(Math.sin(TAU * f * t)) * 0.6 + Math.sin(TAU * f * 0.5 * t) * 0.5;
    out(sfx, s + i, lp.run(sq) * env * 0.32 * g, pan, 0.15);
  }
}

/* ---------- fx ---------- */
function sweepNoise(t0, dur, f0, f1, envFn, g = 1, q = 1.4, pan0 = 0, pan1 = 0, wet = 0.2) {
  const bp = new Biquad("bp", f0, q), s = Math.round(t0 * SR);
  for (let i = 0; i < dur * SR; i++) {
    const p = i / (dur * SR);
    if (i % 32 === 0) bp.set(f0 * Math.pow(f1 / f0, p));
    out(sfx, s + i, bp.run(noise()) * envFn(p) * 1.6 * g, pan0 + (pan1 - pan0) * p, wet);
  }
}
function whoosh(t0, dur, g = 1, peak = 0.7, pan0 = -0.6, pan1 = 0.6) {
  sweepNoise(t0, dur, 300, 4500, (p) => (p < peak ? Math.pow(p / peak, 2) : Math.pow((1 - p) / (1 - peak), 1.6)), g, 1.2, pan0, pan1, 0.25);
}
function riser(t0, dur, g = 1) {
  sweepNoise(t0, dur, 350, 9000, (p) => Math.pow(p, 2.2), g * 0.9, 2.2, 0, 0, 0.3);
  const s = Math.round(t0 * SR); let ph = 0;
  for (let i = 0; i < dur * SR; i++) {
    const p = i / (dur * SR), f = 180 * Math.pow(8, p) * (1 + 0.012 * Math.sin(TAU * 6 * p * dur));
    ph += f / SR;
    out(sfx, s + i, saw(ph) * 0.12 * Math.pow(p, 1.6) * g, 0, 0.2);
  }
}
function impact(t0, g = 1) {
  const s = Math.round(t0 * SR);
  const lp = new Biquad("lp", 900), hp = new Biquad("hp", 5200);
  let ph = 0;
  for (let i = 0; i < 2.2 * SR; i++) {
    const t = i / SR, f = 32 + 34 * Math.exp(-t * 4);
    ph += f / SR;
    const sub = Math.sin(TAU * ph) * Math.exp(-t * 2.6) * Math.min(1, t / 0.003);
    const thump = lp.run(noise()) * Math.exp(-t * 12) * 1.4;
    const crash = hp.run(noise()) * Math.exp(-t * 2.0) * 0.32;
    out(sfx, s + i, (Math.tanh(sub * 1.5) * 0.9 + thump) * g, 0, 0.25);
    out(sfx, s + i, crash * g, (rand() - 0.5) * 0.6, 0.4);
  }
  kick(t0, 0.9 * g);
}
function slam(t0, g = 1) {
  kick(t0, 1.0 * g);
  const s = Math.round(t0 * SR), lp = new Biquad("lp", 600), hp = new Biquad("hp", 3000);
  for (let i = 0; i < 0.6 * SR; i++) {
    const t = i / SR;
    out(sfx, s + i, (lp.run(noise()) * Math.exp(-t * 14) * 1.2 + hp.run(noise()) * Math.exp(-t * 45) * 0.5) * g, 0, 0.3);
  }
}
function glitch(t0, dur, g = 1) {
  const s = Math.round(t0 * SR); let i = 0;
  while (i < dur * SR) {
    const len = Math.floor((0.015 + rand() * 0.025) * SR), type = rand(), f = 180 + rand() * 2600, hold = 2 + Math.floor(rand() * 18), pan = (rand() - 0.5) * 1.4;
    let held = 0;
    for (let k = 0; k < len && i < dur * SR; k++, i++) {
      const t = k / SR;
      let v;
      if (type < 0.5) v = Math.sign(Math.sin(TAU * f * t)) * 0.5;
      else { if (k % hold === 0) held = noise(); v = held * 0.6; }
      out(sfx, s + i, v * (rand() < 0.15 ? 0 : 1) * 0.35 * g, pan);
    }
  }
}
function pop(t0, g = 1) {
  const s = Math.round(t0 * SR); let ph = 0;
  for (let i = 0; i < 0.09 * SR; i++) {
    const t = i / SR, f = 260 + 900 * (t / 0.09); ph += f / SR;
    out(sfx, s + i, Math.sin(TAU * ph) * Math.exp(-t * 40) * 0.6 * g, 0, 0.2);
  }
}

/* =====================================================================
   ARRANGEMENT (seconds; B(n) = beat n)
   ===================================================================== */
const A1 = 33, C2 = 36, F1 = 29, G1 = 31; // midi

// --- HOOK (0 – 2.4): slams on each line, glitch on "losing", falling letters
padChord(0, 2.4, [57, 60, 64], 0.55, 700, 0.05);                 // Am, dark
bassNote(0, 2.3, note(A1), 0.5);
slam(0, 1.1); slam(B(1), 0.9); slam(B(2), 1.1);
glitch(B(1) + 0.05, 0.35, 0.8); glitch(1.3, 0.12, 0.6); glitch(1.75, 0.15, 0.6);
// "customers." letters fall: a fast downward A-minor-pentatonic run
[81, 79, 76, 74, 72, 69, 67, 64, 62, 60].forEach((n, i) => bell(1.62 + i * 0.045, note(n), 0.55, 0.5 - i * 0.1, 0.5, 0.5));
whoosh(1.95, 0.6, 0.9, 0.75, -0.7, 0.4);                          // mock flies in

// --- AUDIT (2.4 – 6.0): beat in, error blip per flaw
for (let b = 4; b < 10; b++) kick(B(b), 0.95);
for (let b = 4; b < 10; b++) hat(B(b) + B(0.5), false, 0.9);
for (let b = 6; b < 10; b++) { hat(B(b) + B(0.25), false, 0.45, -0.3); hat(B(b) + B(0.75), false, 0.45, -0.3); }
for (let k = 0; k < 8; k++) bassNote(B(4) + k * B(0.5), B(0.5) * 0.85, note(A1 + (k % 4 === 3 ? 12 : 0)), 0.75);
for (let k = 0; k < 4; k++) bassNote(B(8) + k * B(0.5), B(0.5) * 0.85, note(F1 + (k % 4 === 3 ? 12 : 0)), 0.75);
padChord(B(4), B(4), [57, 60, 64], 0.5, 1100);
padChord(B(8), B(2), [53, 57, 60], 0.5, 1100);
// scanner
bell(B(4) + 0.1, 1760, 0.35, -0.2, 1.4, 0.7); bell(B(4) + 1.3, 1760, 0.3, 0.2, 1.4, 0.7);
sweepNoise(B(4) + 0.1, 1.1, 500, 2600, (p) => Math.sin(Math.PI * p) * 0.25, 1, 3, -0.5, 0.5);
sweepNoise(B(4) + 1.3, 1.1, 500, 2600, (p) => Math.sin(Math.PI * p) * 0.2, 1, 3, 0.5, -0.5);
[B(5), B(6), B(7), B(8)].forEach((t, i) => errorBlip(t, 1, i % 2 ? 0.35 : -0.35));
// load-time counter 0.0 -> 8.4 (power2.out) and score 0 -> 23 (power3.out)
for (let k = 1; k <= 18; k++) tick(B(6) + 0.75 * (1 - Math.sqrt(1 - k / 18)), 2200 + k * 25, 0.55, 0.35);
for (let k = 1; k <= 12; k++) tick(B(8) + 0.3 + 0.9 * (1 - Math.cbrt(1 - k / 12)), 1500 + k * 30, 0.5);
// "losing leads" verdict: a sad low womp
(function () { const s = Math.round((B(9) + 0.3) * SR); let ph = 0; const lp = new Biquad("lp", 900);
  for (let i = 0; i < 0.45 * SR; i++) { const t = i / SR, f = 196 * Math.pow(0.5, t / 0.45); ph += f / SR;
    out(sfx, s + i, lp.run(saw(ph)) * Math.exp(-t * 4) * 0.3, 0, 0.2); } })();

// --- BREAK (6.0 – 7.2): "Let's fix that." — drums out, build, 0.08s of silence, drop
impact(B(10), 0.65);
padChord(B(10), B(1), [53, 57, 60, 64], 0.45, 1600);
padChord(B(11), B(1) - 0.08, [55, 59, 62, 65], 0.5, 2200, 0.05, 0.05);
riser(B(10), B(2) - 0.08, 1.0);
for (let k = 0; k < 4; k++) snare(B(10) + k * 0.15, 0.25 + k * 0.05, 180);
for (let k = 0; k < 6; k++) snare(B(11) + k * 0.075, 0.4 + k * 0.06, 190 + k * 12);
for (let k = 0; k < 6; k++) snare(B(11) + 0.45 + k * 0.0375, 0.65 + k * 0.05, 260 + k * 15);

// --- DROP / REBUILD (7.2 – 12.0): major lift F – G – C – C
impact(B(12), 1.1);
whoosh(B(12) - 0.05, 0.75, 0.8, 0.45, -0.8, 0.8);                  // the wipe
for (let b = 12; b < 19; b++) kick(B(b), 1);
for (let b = 13; b < 20; b += 2) clap(B(b), 0.9);
for (let b = 12; b < 19; b++) hat(B(b) + B(0.5), true, 0.6);
for (let b = 12; b < 19; b++) { hat(B(b) + B(0.25), false, 0.5, -0.3); hat(B(b) + B(0.75), false, 0.5, -0.3); }
const prog = [[F1, [53, 57, 60, 64]], [G1, [55, 59, 62, 67]], [C2, [52, 55, 60, 64]], [C2, [52, 55, 62, 64]]];
prog.forEach(([root, chord], c) => {
  const t = B(12) + c * B(2), len = c === 3 ? B(1) : B(2);
  for (let k = 0; k < len / B(0.5); k++) bassNote(t + k * B(0.5), B(0.5) * 0.8, note(root + (k % 2 ? 12 : 0)), 0.8);
  padChord(t, len, chord, 0.55, 2600, 0.03);
});
// each flaw flips to fixed: rising C-major bells
[84, 88, 91, 96].forEach((n, i) => bell(B(14) + i * B(0.5), note(n), 0.8, -0.4 + i * 0.27, 1));
// score 23 -> 98 (power2.inOut): accelerating, rising ticks
for (let k = 1; k <= 26; k++) {
  const p = k / 26, x = p < 0.5 ? Math.sqrt(p / 2) : 1 - Math.sqrt((1 - p) / 2);
  tick(B(14) + 1.3 * x, 1400 + k * 45, 0.45);
}
// audit passed: quick major arpeggio
[72, 76, 79, 84].forEach((n, i) => bell(B(16) + i * 0.04, note(n), 0.5, 0, 1.2));
// leads arriving: notification dings
[0, 1, 2].forEach((i) => { const t = B(17) + i * B(0.5); bell(t, note(83), 0.75, 0.3 - i * 0.3, 0.9); bell(t + 0.085, note(88), 0.75, 0.3 - i * 0.3, 1.1); });

// --- TRANSITION (11.3 – 12.0): button press, burst into the logo
tick(B(19) - 0.12, 900, 1.2); pop(B(19), 0.9);
padChord(B(19), B(1) - 0.04, [55, 59, 62, 65], 0.5, 3200, 0.04, 0.05);   // G7 -> resolves to C on the logo
bassNote(B(19), B(1) - 0.05, note(G1), 0.7);
for (let k = 0; k < 8; k++) snare(B(19) + k * 0.075, 0.25 + k * 0.06, 220 + k * 18);
riser(B(19), B(1), 0.7);
whoosh(B(19), B(1) + 0.1, 0.9, 0.85, 0.6, -0.4);

// --- END CARD (12.0 – 15.0): resolve on C(add9), logo sparkle, CTA pop
impact(B(20), 1.25);
padChord(B(20), 2.9, [48, 55, 60, 62, 64, 67], 0.6, 3000, 0.02, 0.6);
bassNote(B(20), B(4), note(C2), 0.7);
[84, 88, 91, 96, 100, 103].forEach((n, i) => bell(B(20) + 0.35 + i * 0.045, note(n), 0.4, -0.5 + i * 0.2, 1.3, 0.7));
sweepNoise(B(20) + 0.45, 0.5, 2500, 9000, (p) => Math.sin(Math.PI * p) * 0.35, 1, 1.5, -0.4, 0.4); // V stroke
pop(B(22), 1); bell(B(22) + 0.02, note(84), 0.6, 0, 1.2);
for (let b = 21; b < 25; b++) { kick(B(b), 0.6); hat(B(b) + B(0.5), false, 0.5); }

/* =====================================================================
   MIX
   ===================================================================== */
// sidechain: bass + pads duck under every kick
const duck = new Float32Array(N).fill(1);
for (const kt of kickTimes) {
  const s = Math.round(kt * SR);
  for (let i = 0; i < 0.3 * SR && s + i < N; i++) duck[s + i] = Math.min(duck[s + i], 1 - 0.65 * Math.exp(-(i / SR) / 0.08));
}

// Freeverb on the send bus
function freeverb(inL, inR, room = 0.82, damp = 0.35) {
  const k = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], aps = [556, 441, 341, 225];
  const mk = (spread) => ({
    c: combs.map((n) => ({ b: new Float32Array(Math.round((n + spread) * k)), i: 0, s: 0 })),
    a: aps.map((n) => ({ b: new Float32Array(Math.round((n + spread) * k)), i: 0 })),
  });
  const run = (st, input, outArr) => {
    for (let n = 0; n < N; n++) {
      const x = input[n] * 0.015; let y = 0;
      for (const c of st.c) { const o = c.b[c.i]; c.s = o * (1 - damp) + c.s * damp; c.b[c.i] = x + c.s * room; c.i = (c.i + 1) % c.b.length; y += o; }
      for (const a of st.a) { const o = a.b[a.i]; a.b[a.i] = y + o * 0.5; a.i = (a.i + 1) % a.b.length; y = o - y; }
      outArr[n] = y;
    }
  };
  const L = new Float32Array(N), R = new Float32Array(N);
  run(mk(0), inL, L); run(mk(23), inR, R);
  return { L, R };
}
const wet = freeverb(send.L, send.R);

const mixL = new Float32Array(N), mixR = new Float32Array(N);
const fadeStart = DUR - 0.45;
for (let i = 0; i < N; i++) {
  const t = i / SR, d = duck[i];
  let l = drums.L[i] * 0.9 + bass.L[i] * 0.55 * d + pad.L[i] * 0.42 * d + sfx.L[i] * 0.85 + wet.L[i] * 0.9;
  let r = drums.R[i] * 0.9 + bass.R[i] * 0.55 * d + pad.R[i] * 0.42 * d + sfx.R[i] * 0.85 + wet.R[i] * 0.9;
  const fade = t > fadeStart ? Math.max(0, 1 - (t - fadeStart) / 0.45) : 1;
  mixL[i] = Math.tanh(l * 0.9) * fade;   // gentle saturation glues the mix
  mixR[i] = Math.tanh(r * 0.9) * fade;
}

/* ---------- write float WAV ---------- */
function writeWav(file, L, R) {
  const data = Buffer.alloc(N * 8);
  for (let i = 0; i < N; i++) { data.writeFloatLE(L[i], i * 8); data.writeFloatLE(R[i], i * 8 + 4); }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 8, 28); h.writeUInt16LE(8, 32); h.writeUInt16LE(32, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}
fs.mkdirSync(OUT, { recursive: true });
const raw = path.join(OUT, ".audio-raw.wav");
writeWav(raw, mixL, mixR);

/* ---------- two-pass loudness normalisation: -14 LUFS, -1 dBTP ---------- */
const target = "I=-14:TP=-1.0:LRA=9";
const pass1 = spawnSync("ffmpeg", ["-hide_banner", "-i", raw, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
const m = pass1.stderr.match(/\{[\s\S]*?\}/);
if (!m) { console.error(pass1.stderr); process.exit(1); }
const j = JSON.parse(m[0]);
const final = path.join(OUT, "voniweb-reel-audio.wav");
const af = `loudnorm=${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,alimiter=limit=0.89:level=false,aresample=48000`;
const pass2 = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-af", af, "-ar", "48000", "-c:a", "pcm_s16le", "-t", String(DUR), final], { stdio: "inherit" });
if (pass2.status !== 0) process.exit(1);
fs.rmSync(raw);
console.log(`Measured ${j.input_i} LUFS -> normalised to -14 LUFS`);
console.log("->", path.relative(path.join(__dirname, ".."), final));
