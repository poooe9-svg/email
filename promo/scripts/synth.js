// Tiny offline synth + foley kit shared by the reel soundtracks.
// Everything is generated from code, so the audio is royalty-free.
const fs = require("fs");
const { spawnSync } = require("child_process");

const TAU = Math.PI * 2;
const note = (n) => 440 * Math.pow(2, (n - 69) / 12); // midi -> Hz
const saw = (ph) => 2 * (ph - Math.floor(ph + 0.5));

class Biquad {
  constructor(sr, type, f, q = 0.707) { this.sr = sr; this.type = type; this.q = q; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(f); }
  set(f) {
    const w = TAU * Math.min(Math.max(f, 10), this.sr * 0.45) / this.sr, cs = Math.cos(w), sn = Math.sin(w), a = sn / (2 * this.q);
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

function createSynth(SR, DUR, seedInit = 0x9e3779b9) {
  const N = Math.round(SR * DUR);
  let seed = seedInit;
  const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const noise = () => rand() * 2 - 1;
  const bus = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
  const B = { drums: bus(), bass: bus(), keys: bus(), sfx: bus(), foley: bus(), send: bus() };
  const BQ = (type, f, q) => new Biquad(SR, type, f, q);

  function put(b, i, v, pan = 0) {
    if (i < 0 || i >= N) return;
    const a = (pan + 1) * Math.PI / 4;
    b.L[i] += v * Math.cos(a); b.R[i] += v * Math.sin(a);
  }
  const out = (b, i, v, pan, wet = 0) => { put(b, i, v, pan); if (wet) put(B.send, i, v * wet, pan); };
  const S = (t) => Math.round(t * SR);

  /* ---------- drums ---------- */
  const kickTimes = [];
  function kick(t0, g = 1, tone = 46) {
    kickTimes.push(t0);
    let ph = 0; const s = S(t0);
    for (let i = 0; i < 0.45 * SR; i++) {
      const t = i / SR, f = tone + 150 * Math.exp(-t * 34);
      ph += f / SR;
      const amp = Math.exp(-t * 7) * Math.min(1, t / 0.0015);
      const click = t < 0.004 ? noise() * (1 - t / 0.004) * 0.45 : 0;
      out(B.drums, s + i, Math.tanh((Math.sin(TAU * ph) * amp + click) * 1.8) * 0.85 * g, 0);
    }
  }
  function clap(t0, g = 1, pan = 0) {
    const bp = BQ("bp", 1400, 1.1), s = S(t0);
    for (let i = 0; i < 0.3 * SR; i++) {
      const t = i / SR; let env = 0;
      for (const o of [0, 0.011, 0.023]) if (t >= o) env = Math.max(env, Math.exp(-(t - o) * 260));
      if (t > 0.03) env = Math.max(env, 0.55 * Math.exp(-(t - 0.03) * 20));
      out(B.drums, s + i, bp.run(noise()) * env * 2.3 * g, pan, 0.3);
    }
  }
  function snare(t0, g = 1, body = 190, decay = 26) {
    const hp = BQ("hp", 1300), s = S(t0);
    for (let i = 0; i < 0.22 * SR; i++) {
      const t = i / SR;
      out(B.drums, s + i, (hp.run(noise()) * Math.exp(-t * decay) * 0.85 + Math.sin(TAU * body * t) * Math.exp(-t * 32) * 0.55) * g, 0, 0.2);
    }
  }
  function rim(t0, g = 1) { // lo-fi rimshot / snap
    const bp = BQ("bp", 1900, 3), s = S(t0);
    for (let i = 0; i < 0.08 * SR; i++) {
      const t = i / SR;
      out(B.drums, s + i, (bp.run(noise()) * 1.8 + Math.sin(TAU * 820 * t) * 0.5) * Math.exp(-t * 60) * g, -0.1, 0.25);
    }
  }
  function hat(t0, open = false, g = 1, pan = 0.25) {
    const hp = BQ("hp", 7800, 0.9), s = S(t0), d = open ? 0.32 : 0.05;
    for (let i = 0; i < d * SR; i++) {
      const t = i / SR;
      out(B.drums, s + i, hp.run(noise()) * Math.exp(-t * (open ? 11 : 75)) * 0.5 * g, pan, open ? 0.12 : 0);
    }
  }

  /* ---------- tonal ---------- */
  // FM electric piano (Rhodes-ish): warm body + bell-like tine on the attack
  function epiano(t0, dur, midi, vel = 1, pan = 0) {
    const f = note(midi), s = S(t0), rel = 0.35;
    const trem = 4.5 + rand();
    for (let i = 0; i < (dur + rel) * SR; i++) {
      const t = i / SR;
      const I = 1.9 * Math.exp(-t * 5) + 0.35;
      const tine = Math.sin(TAU * f * 14 * t) * 0.18 * Math.exp(-t * 28);
      const v = Math.sin(TAU * f * t + I * Math.sin(TAU * f * t) + tine);
      const env = Math.min(1, t / 0.003) * Math.exp(-t * 1.0) * (t > dur ? Math.exp(-(t - dur) * 10) : 1);
      const tr = 1 + 0.12 * Math.sin(TAU * trem * t);
      out(B.keys, s + i, v * env * 0.16 * vel, pan + 0.25 * Math.sin(TAU * trem * t + 1), 0.25 * tr);
    }
  }
  function chord(t0, dur, notes, vel = 1) {
    notes.forEach((n, k) => epiano(t0 + k * 0.012 * (rand() + 0.3), dur, n, vel * (0.85 + rand() * 0.25), (k / Math.max(1, notes.length - 1) - 0.5) * 0.7));
  }
  function bassNote(t0, dur, midi, g = 1) {
    const f = note(midi), s = S(t0), lp = BQ("lp", 500, 0.9);
    let ph = 0;
    for (let i = 0; i < (dur + 0.04) * SR; i++) {
      const t = i / SR; ph += f / SR;
      const env = Math.min(1, t / 0.006) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.04) : 1) * (0.75 + 0.25 * Math.exp(-t * 6));
      const v = Math.sin(TAU * ph) * 0.85 + lp.run(saw(ph)) * 0.4; // saw harmonics keep it audible on small speakers
      out(B.bass, s + i, Math.tanh(v * 1.3) * env * 0.6 * g, 0);
    }
  }
  function bell(t0, f, g = 1, pan = 0, decay = 1, wet = 0.45, bus = B.sfx) {
    const s = S(t0), parts = [[1, 1, 3], [2, 0.35, 6], [3.01, 0.2, 9], [4.2, 0.1, 14]];
    for (let i = 0; i < 1.6 * decay * SR; i++) {
      const t = i / SR; let v = 0;
      for (const [m, a, d] of parts) v += Math.sin(TAU * f * m * t) * a * Math.exp(-t * d / decay);
      out(bus, s + i, v * Math.min(1, t / 0.002) * 0.3 * g, pan, wet);
    }
  }

  /* ---------- fx ---------- */
  function sweepNoise(t0, dur, f0, f1, envFn, g = 1, q = 1.4, pan0 = 0, pan1 = 0, wet = 0.2, bus = B.sfx) {
    const bp = BQ("bp", f0, q), s = S(t0);
    for (let i = 0; i < dur * SR; i++) {
      const p = i / (dur * SR);
      if (i % 32 === 0) bp.set(f0 * Math.pow(f1 / f0, p));
      out(bus, s + i, bp.run(noise()) * envFn(p) * 1.6 * g, pan0 + (pan1 - pan0) * p, wet);
    }
  }
  const whoosh = (t0, dur, g = 1, peak = 0.7, pan0 = -0.6, pan1 = 0.6, f0 = 300, f1 = 4500) =>
    sweepNoise(t0, dur, f0, f1, (p) => (p < peak ? Math.pow(p / peak, 2) : Math.pow((1 - p) / (1 - peak), 1.6)), g, 1.2, pan0, pan1, 0.25);
  function riser(t0, dur, g = 1) {
    sweepNoise(t0, dur, 350, 9000, (p) => Math.pow(p, 2.2), g * 0.8, 2.2, 0, 0, 0.3);
    const s = S(t0); let ph = 0;
    for (let i = 0; i < dur * SR; i++) {
      const p = i / (dur * SR), f = 180 * Math.pow(8, p); ph += f / SR;
      out(B.sfx, s + i, saw(ph) * 0.09 * Math.pow(p, 1.6) * g, 0, 0.2);
    }
  }
  function impact(t0, g = 1) {
    const s = S(t0), lp = BQ("lp", 900), hp = BQ("hp", 5200); let ph = 0;
    for (let i = 0; i < 2.0 * SR; i++) {
      const t = i / SR, f = 32 + 34 * Math.exp(-t * 4); ph += f / SR;
      const sub = Math.sin(TAU * ph) * Math.exp(-t * 2.6) * Math.min(1, t / 0.003);
      out(B.sfx, s + i, (Math.tanh(sub * 1.5) * 0.85 + lp.run(noise()) * Math.exp(-t * 12) * 1.3) * g, 0, 0.25);
      out(B.sfx, s + i, hp.run(noise()) * Math.exp(-t * 2.0) * 0.28 * g, (rand() - 0.5) * 0.6, 0.4);
    }
    kick(t0, 0.9 * g);
  }
  function slam(t0, g = 1) {
    kick(t0, g);
    const s = S(t0), lp = BQ("lp", 600), hp = BQ("hp", 3000);
    for (let i = 0; i < 0.5 * SR; i++) {
      const t = i / SR;
      out(B.sfx, s + i, (lp.run(noise()) * Math.exp(-t * 14) * 1.1 + hp.run(noise()) * Math.exp(-t * 45) * 0.45) * g, 0, 0.3);
    }
  }
  function pop(t0, g = 1, f0 = 260, f1 = 1160) {
    const s = S(t0); let ph = 0;
    for (let i = 0; i < 0.09 * SR; i++) {
      const t = i / SR, f = f0 + (f1 - f0) * (t / 0.09); ph += f / SR;
      out(B.sfx, s + i, Math.sin(TAU * ph) * Math.exp(-t * 40) * 0.5 * g, 0, 0.2);
    }
  }

  /* ---------- foley ---------- */
  function scratch(t0, dur, g = 1, center = 3600, rate = 17, pan = 0.1) { // pencil on paper
    const bp = BQ("bp", center, 0.9), hp = BQ("hp", 1500), s = S(t0);
    for (let i = 0; i < dur * SR; i++) {
      const t = i / SR;
      const am = Math.pow(Math.abs(Math.sin(Math.PI * rate * t + 2 * Math.sin(TAU * 3.1 * t))), 0.6);
      const edge = Math.min(1, t / 0.01, (dur - t) / 0.015);
      out(B.foley, s + i, hp.run(bp.run(noise())) * am * edge * 0.9 * g, pan);
    }
  }
  function markerSqueak(t0, dur, g = 1, pan = -0.1) { // felt marker: breathy rub + faint squeak
    scratch(t0, dur, 0.8 * g, 2400, 9, pan);
    const s = S(t0); let ph = 0; const f0 = 1900 + rand() * 600;
    for (let i = 0; i < Math.min(dur, 0.12) * SR; i++) {
      const t = i / SR, f = f0 * (1 + 0.04 * Math.sin(TAU * 23 * t)); ph += f / SR;
      out(B.foley, s + i, Math.sin(TAU * ph) * Math.exp(-t * 18) * 0.05 * g, pan);
    }
  }
  function mouseClick(t0, g = 1) {
    for (const [o, f, a] of [[0, 3200, 1], [0.075, 2600, 0.6]]) {
      const bp = BQ("bp", f, 2.5), s = S(t0 + o);
      for (let i = 0; i < 0.012 * SR; i++) { const t = i / SR; out(B.foley, s + i, bp.run(noise()) * Math.exp(-t * 600) * 2.2 * a * g, 0.15); }
    }
  }
  function keystroke(t0, g = 1, back = false) {
    const s = S(t0), bp = BQ("bp", back ? 1700 : 2300 + rand() * 900, 1.6), thock = (back ? 140 : 180) + rand() * 50;
    for (let i = 0; i < 0.03 * SR; i++) {
      const t = i / SR;
      out(B.foley, s + i, (bp.run(noise()) * Math.exp(-t * 420) * 1.6 + Math.sin(TAU * thock * t) * Math.exp(-t * 140) * 0.5) * g, (rand() - 0.5) * 0.4);
    }
  }
  function paperSlap(t0, g = 1) {
    const s = S(t0), lp = BQ("lp", 1800);
    for (let i = 0; i < 0.12 * SR; i++) { const t = i / SR; out(B.foley, s + i, (lp.run(noise()) * Math.exp(-t * 45) * 1.4 + Math.sin(TAU * 110 * t) * Math.exp(-t * 40) * 0.5) * g, -0.1, 0.15); }
  }
  function paperSlide(t0, dur, g = 1) {
    sweepNoise(t0, dur, 700, 2600, (p) => Math.sin(Math.PI * p) * 0.6, g, 0.8, -0.3, 0.2, 0.1, B.foley);
    scratch(t0, dur, 0.25 * g, 5200, 40, 0);
  }
  function buzz(t0, g = 1) { // phone vibration
    const s = S(t0), lp = BQ("lp", 400);
    for (let i = 0; i < 0.3 * SR; i++) {
      const t = i / SR, on = t < 0.12 || (t > 0.17 && t < 0.28) ? 1 : 0;
      out(B.foley, s + i, lp.run(Math.sign(Math.sin(TAU * 155 * t))) * on * 0.35 * g, 0);
    }
  }
  function vinyl(t0, dur, g = 1) { // crackle + hiss, the lo-fi warmth
    const s = S(t0), hp = BQ("hp", 2500), lp = BQ("lp", 7000);
    for (let i = 0; i < dur * SR; i++) {
      let v = lp.run(hp.run(noise())) * 0.03;
      if (rand() < 28 / SR) v += noise() * (0.4 + rand() * 0.6);
      out(B.foley, s + i, v * g, (rand() - 0.5) * 0.8);
    }
  }

  /* ---------- mix ---------- */
  function freeverb(inL, inR, room = 0.82, damp = 0.35) {
    const k = SR / 44100;
    const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], aps = [556, 441, 341, 225];
    const mk = (spread) => ({
      c: combs.map((n) => ({ b: new Float32Array(Math.round((n + spread) * k)), i: 0, s: 0 })),
      a: aps.map((n) => ({ b: new Float32Array(Math.round((n + spread) * k)), i: 0 })),
    });
    const run = (st, input, o) => {
      for (let n = 0; n < N; n++) {
        const x = input[n] * 0.015; let y = 0;
        for (const c of st.c) { const v = c.b[c.i]; c.s = v * (1 - damp) + c.s * damp; c.b[c.i] = x + c.s * room; c.i = (c.i + 1) % c.b.length; y += v; }
        for (const a of st.a) { const v = a.b[a.i]; a.b[a.i] = y + v * 0.5; a.i = (a.i + 1) % a.b.length; y = v - y; }
        o[n] = y;
      }
    };
    const L = new Float32Array(N), R = new Float32Array(N);
    run(mk(0), inL, L); run(mk(23), inR, R);
    return { L, R };
  }

  function mixdown(levels, fadeOut = 0.5) {
    const duck = new Float32Array(N).fill(1);
    for (const kt of kickTimes) {
      const s = S(kt);
      for (let i = 0; i < 0.3 * SR && s + i < N; i++) duck[s + i] = Math.min(duck[s + i], 1 - 0.55 * Math.exp(-(i / SR) / 0.08));
    }
    const wet = freeverb(B.send.L, B.send.R);
    const L = new Float32Array(N), R = new Float32Array(N), fs0 = DUR - fadeOut;
    for (let i = 0; i < N; i++) {
      const t = i / SR, d = duck[i];
      const mix = (c) => B.drums[c][i] * levels.drums + B.bass[c][i] * levels.bass * d + B.keys[c][i] * levels.keys * d + B.sfx[c][i] * levels.sfx + B.foley[c][i] * levels.foley + wet[c][i] * levels.wet;
      const fade = t > fs0 ? Math.max(0, 1 - (t - fs0) / fadeOut) : 1;
      L[i] = Math.tanh(mix("L") * 0.9) * fade; R[i] = Math.tanh(mix("R") * 0.9) * fade;
    }
    return { L, R };
  }

  function writeNormalized(file, L, R, tmp) {
    const data = Buffer.alloc(N * 8);
    for (let i = 0; i < N; i++) { data.writeFloatLE(L[i], i * 8); data.writeFloatLE(R[i], i * 8 + 4); }
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
    h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(2, 22);
    h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 8, 28); h.writeUInt16LE(8, 32); h.writeUInt16LE(32, 34);
    h.write("data", 36); h.writeUInt32LE(data.length, 40);
    fs.writeFileSync(tmp, Buffer.concat([h, data]));
    // two-pass loudness normalisation to Instagram's -14 LUFS / -1 dBTP
    const target = "I=-14:TP=-1.0:LRA=9";
    const p1 = spawnSync("ffmpeg", ["-hide_banner", "-i", tmp, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
    const m = p1.stderr.match(/\{[\s\S]*?\}/);
    if (!m) throw new Error(p1.stderr);
    const j = JSON.parse(m[0]);
    const af = `loudnorm=${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,alimiter=limit=0.89:level=false,aresample=48000`;
    const p2 = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", tmp, "-af", af, "-ar", "48000", "-c:a", "pcm_s16le", "-t", String(DUR), file], { stdio: "inherit" });
    fs.rmSync(tmp);
    if (p2.status !== 0) throw new Error("ffmpeg normalisation failed");
    return j.input_i;
  }

  return {
    N, SR, rand, noise, B, BQ, note, put,
    kick, clap, snare, rim, hat, epiano, chord, bassNote, bell,
    sweepNoise, whoosh, riser, impact, slam, pop,
    scratch, markerSqueak, mouseClick, keystroke, paperSlap, paperSlide, buzz, vinyl,
    mixdown, writeNormalized,
  };
}

module.exports = { createSynth, note };
