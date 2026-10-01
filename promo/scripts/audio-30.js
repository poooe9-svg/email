// Soundtrack for reel-30.html: warm FM-piano groove + foley, 120 BPM (BEAT = 0.5s).
// Event times (keystrokes, pencil/marker strokes, clicks, notifications, slider drag)
// are read from the page itself, so the sound stays locked to the picture.
//
//   node scripts/audio-30.js   -> out/voniweb-reel-30s-audio.wav

const path = require("path");
const { chromium } = require("playwright-core");
const { browserPath } = require("./browser");
const { createSynth, note } = require("./synth");

const ROOT = path.join(__dirname, "..");
const B = (n) => n * 0.5;

async function readEvents() {
  const b = await chromium.launch({ executablePath: browserPath() });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto("file://" + path.join(ROOT, "reel-30.html") + "?render");
  await p.waitForFunction(() => window.READY === true);
  const r = await p.evaluate(() => window.REEL);
  await b.close();
  return r;
}

(async () => {
  const REEL = await readEvents();
  const E = REEL.EVENTS, DUR = REEL.DURATION;
  const s = createSynth(48000, DUR);
  const { kick, clap, snare, rim, hat, chord, bassNote, bell, whoosh, riser, impact, slam, pop, sweepNoise } = s;

  // chords (midi) — C major world: tension (Am) -> lift (F, G) -> home (C)
  const AM7 = [57, 60, 64, 67], FMAJ9 = [53, 57, 60, 64, 67], EM7 = [52, 55, 59, 62], DM7 = [50, 53, 57, 60];
  const G7 = [55, 59, 62, 65], CMAJ7 = [48, 55, 59, 64], BB = [46, 53, 58, 62], G = [55, 59, 62, 67], CMAJ9 = [48, 55, 59, 62, 64];
  // bass stays >= ~40 Hz so phone speakers still carry it (via harmonics)
  const A1 = 33, F1 = 29, E1 = 28, D1 = 38, G1 = 31, C2 = 36, BB1 = 34;
  const swing = (k) => (k % 2 ? 0.035 : 0); // late off-beats: the human pocket

  /* ---------- HOOK 0–4 ---------- */
  chord(0, 1.9, AM7, 0.8); chord(2.0, 0.95, FMAJ9, 0.9); chord(3.0, 0.6, G, 0.95);
  bassNote(0, 0.9, A1); bassNote(1.0, 0.9, A1); bassNote(2.0, 0.9, F1); bassNote(3.0, 0.55, G1);
  slam(0, 1.0); slam(1.0, 0.85); slam(2.0, 1.0); slam(3.0, 1.0);
  for (let k = 1; k < 14; k++) hat(B(k / 2) + swing(k), false, 0.35);
  clap(1.5, 0.7);
  pop(1.0, 0.5, 900, 300);                                   // old site glitches in
  [2.05, 2.11, 2.17].forEach((t, i) => pop(t, 0.35, 400 + i * 150, 1100 + i * 200)); // new site pops in
  pop(3.0, 0.7); bell(3.02, note(84), 0.5, 0.2, 0.8);       // "re"
  whoosh(3.1, 0.5, 0.6, 0.6, -0.5, 0.5, 1200, 6000); bell(3.55, note(91), 0.35, 0.3, 1);
  riser(3.0, 0.6, 0.5);
  s.paperSlide(3.55, 0.55, 1.0);
  s.paperSlap(4.05, 1.0);

  /* ---------- BUILD 4–10: lo-fi pocket, pencil, clicks, typing ---------- */
  s.vinyl(4.0, 6.2, 0.8);
  chord(4.0, 1.7, FMAJ9, 0.85); chord(5.75, 2.0, EM7, 0.85); chord(7.75, 1.2, DM7, 0.85); chord(9.0, 0.95, G7, 0.85);
  [[4, F1, F1 + 7], [6, E1, E1 + 7], [8, D1, D1 - 5]].forEach(([t, r, fifth]) => {
    bassNote(t, 0.6, r); bassNote(t + 0.75, 0.3, r); bassNote(t + 1.25, 0.5, fifth);
  });
  bassNote(9.0, 0.9, G1);
  for (const bar of [4, 6, 8]) {
    kick(bar, 0.8); kick(bar + 0.75 + 0.02, 0.55); kick(bar + 1.25, 0.7);
    rim(bar + 0.5, 0.8); rim(bar + 1.5, 0.8);
    for (let k = 0; k < 8; k++) hat(bar + k * 0.25 + swing(k), false, k % 2 ? 0.3 : 0.45);
    snare(bar + 1.875, 0.12, 200);                          // ghost note
  }
  snare(9.625, 0.25); snare(9.75, 0.35); snare(9.875, 0.45);
  riser(9.4, 0.6, 0.6);
  // pencil strokes and marker strokes, straight from the page
  for (const [t0, dur, tool] of E.draws) {
    if (tool === "pencil") s.scratch(t0, dur, 0.55);
    else s.markerSqueak(t0, dur, 0.6);
  }
  // design: elements pop into place, cursors click, colour drops, client comments
  for (let i = 0; i < 7; i++) pop(6.08 + i * 0.07, 0.22, 500 + i * 60, 900 + i * 80);
  for (const c of E.clicks) s.mouseClick(c, 0.9);
  pop(7.45, 0.6, 300, 900); bell(7.47, note(88), 0.4, -0.2, 0.7);
  pop(7.63, 0.5, 700, 1500);
  // code: every keystroke
  whoosh(7.95, 0.45, 0.4, 0.5, 0.2, -0.2, 400, 2500);
  E.keys.forEach(([t, op], i) => { if (op === "bs" || i % 2 === 0) s.keystroke(t, op === "bs" ? 0.55 : 0.4, op === "bs"); });
  bell(E.codeEnd + 0.05, note(88), 0.45, 0.2, 0.7); bell(E.codeEnd + 0.13, note(95), 0.4, 0.3, 0.9);

  /* ---------- LAUNCH 10–14: the drop ---------- */
  impact(10.0, 1.0);
  for (let t = 10.0; t < 13.5; t += 0.5) kick(t, 0.95);
  for (const t of [10.5, 11.5, 12.5]) clap(t, 0.8);
  for (let t = 10.25; t < 13.5; t += 0.5) hat(t, true, 0.45);
  for (let t = 10.0; t < 13.5; t += 0.125) hat(t + 0.0625, false, 0.22, -0.3);
  chord(10.0, 1.9, CMAJ7, 1.0); chord(12.0, 1.4, AM7, 0.9);
  for (let t = 10.25; t < 12; t += 0.5) bassNote(t, 0.2, C2);
  for (let t = 12.25; t < 13.5; t += 0.5) bassNote(t, 0.2, A1);
  whoosh(10.25, 0.6, 0.7, 0.6, 0.7, -0.2);                  // phone flies in
  pop(10.6, 0.7); bell(10.62, note(91), 0.45, 0.4, 0.8);   // LIVE
  pop(11.0, 0.8, 200, 700);
  for (let i = 0; i < 12; i++) bell(11.02 + s.rand() * 0.6, note(96 + Math.floor(s.rand() * 12)), 0.18, s.rand() * 1.6 - 0.8, 0.5, 0.6); // confetti sparkle
  whoosh(11.2, 0.5, 0.55, 0.6, -0.7, 0);                    // delivery card
  whoosh(13.5, 0.5, 0.8, 0.7, -0.4, 0.6, 300, 6000);        // everything flies out

  /* ---------- REBUILD 14–20 ---------- */
  slam(14.0, 1.0);
  chord(14.0, 1.9, DM7, 0.8); chord(16.0, 0.95, BB, 0.75); chord(17.0, 1.9, G7, 0.85); chord(19.0, 0.95, FMAJ9, 1.0);
  bassNote(14.0, 1.4, D1); bassNote(15.5, 0.45, D1 - 5); bassNote(16.0, 0.9, BB1); bassNote(17.0, 1.9, G1);
  s.vinyl(14.0, 3.0, 0.6);
  for (const t of [14.0, 15.25, 16.0, 16.75]) kick(t, 0.75);
  for (const t of [15.0, 17.0]) snare(t, 0.6);
  for (let k = 0; k < 24; k++) hat(14.0 + k * 0.25 + swing(k), false, k % 2 ? 0.25 : 0.38);
  whoosh(14.85, 0.35, 0.6, 0.7, 0.3, -0.3); s.paperSlap(15.15, 0.6);   // frame lands
  // slider drag: friction noise that follows the handle's real speed
  {
    const H = E.handle, bp = s.BQ("bp", 800, 1.2);
    for (let k = 0; k < H.length - 1; k++) {
      const [t0, h0] = H[k], [t1, h1] = H[k + 1];
      const v = Math.abs(h1 - h0) / (t1 - t0);
      const n0 = Math.round(t0 * s.SR), n1 = Math.round(t1 * s.SR);
      bp.set(500 + v * 1400);
      for (let n = n0; n < n1; n++) s.put(s.B.foley, n, bp.run(s.noise()) * Math.min(1, v / 1.8) * 0.9, (h0 - 0.5) * 1.2);
    }
  }
  for (let k = 0; k < 8; k++) snare(18.5 + k * 0.0625, 0.2 + k * 0.05, 200 + k * 12);
  impact(19.0, 0.7); bell(19.0, note(84), 0.5, -0.3, 1); bell(19.28, note(88), 0.5, 0, 1); bell(19.56, note(91), 0.5, 0.3, 1);
  kick(19.5, 0.9); clap(19.5, 0.8); hat(19.25, true, 0.4); hat(19.75, true, 0.4);
  bassNote(19.0, 0.4, F1); bassNote(19.5, 0.4, F1 + 12);
  riser(19.45, 0.55, 0.5);

  /* ---------- RESULTS 20–26: the phone fills up ---------- */
  slam(20.0, 1.0); slam(20.25, 0.8); slam(20.5, 1.0);
  chord(20.0, 1.9, CMAJ7, 1.0); chord(22.0, 1.9, AM7, 0.9); chord(24.0, 0.95, FMAJ9, 0.95); chord(25.0, 0.55, G, 1.0);
  for (let t = 21.0; t < 25.5; t += 0.5) kick(t, 0.9);
  for (let t = 21.5; t < 25.5; t += 1) clap(t, 0.75);
  for (let t = 21.25; t < 25.5; t += 0.5) hat(t, true, 0.4);
  for (let t = 21.0; t < 25.5; t += 0.125) hat(t + 0.0625, false, 0.2, -0.3);
  [[20.25, 22, C2], [22.25, 24, A1], [24.25, 25, F1], [25.25, 25.5, G1]].forEach(([a, b, r]) => { for (let t = a; t < b; t += 0.5) bassNote(t, 0.2, r); });
  whoosh(20.7, 0.6, 0.6, 0.5, 0, 0, 250, 2500);             // phone rises
  // each lead is a note: the notifications play a rising melody
  const MEL = [76, 79, 81, 84, 86, 88];
  E.notifs.forEach((t, i) => { bell(t, note(MEL[i]), 0.75, 0.3 - i * 0.12, 0.9); bell(t + 0.08, note(MEL[i] + 7), 0.4, 0.3 - i * 0.12, 0.8); s.buzz(t, 0.8); });
  whoosh(24.45, 0.4, 0.5, 0.6, 0.7, 0.2);                   // rating card
  [96, 98, 100, 103, 105].forEach((n, i) => bell(24.75 + i * 0.09, note(n), 0.35, -0.4 + i * 0.2, 0.7));
  riser(25.0, 1.0, 0.8);
  whoosh(25.55, 0.5, 1.0, 0.85, 0.8, -0.3, 200, 5000);      // giant V sweeps in

  /* ---------- END 26–30: logo ---------- */
  impact(26.0, 1.25);
  chord(26.0, 3.6, CMAJ9, 1.0); bassNote(26.0, 3.4, C2, 0.9);
  sweepNoise(26.0, 0.9, 6000, 250, (p) => Math.sin(Math.PI * Math.pow(p, 0.45)) * 0.5, 1, 1.0, 0.4, -0.4, 0.3); // dolly-out
  [84, 88, 91, 96, 100, 103].forEach((n, i) => bell(26.75 + i * 0.045, note(n), 0.35, -0.5 + i * 0.2, 1.2, 0.7));
  sweepNoise(27.0, 0.7, 3000, 9000, (p) => Math.sin(Math.PI * p) * 0.25, 1, 1.5, -0.4, 0.4);
  pop(27.35, 0.5); pop(27.5, 0.3, 300, 700); pop(27.62, 0.3, 350, 800); pop(27.74, 0.3, 400, 900);
  pop(28.3, 0.9); bell(28.32, note(84), 0.55, 0, 1.2);
  s.mouseClick(29.2, 0.6);
  for (let t = 27.0; t < 29.6; t += 0.5) kick(t, 0.5);
  for (let t = 27.25; t < 29.6; t += 0.5) hat(t, false, 0.4);
  rim(27.5, 0.6); rim(28.5, 0.6); rim(29.5, 0.5);

  /* ---------- mix + loudness ---------- */
  const { L, R } = s.mixdown({ drums: 0.8, bass: 0.75, keys: 1.0, sfx: 0.8, foley: 0.95, wet: 0.9 }, 0.6);
  const outFile = path.join(ROOT, "out", `${REEL.NAME}-audio.wav`);
  const measured = s.writeNormalized(outFile, L, R, path.join(ROOT, "out", ".audio30-raw.wav"));
  console.log(`Measured ${measured} LUFS -> normalised to -14 LUFS`);
  console.log("->", path.relative(ROOT, outFile));
})().catch((e) => { console.error(e); process.exit(1); });
