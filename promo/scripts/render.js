// Renders reel.html to an Instagram-ready MP4.
//
//   node scripts/render.js              crisp 30fps render (default)
//   node scripts/render.js --blur 8     true motion blur from 8 subframes/frame (~8x slower)
//
// How it works: every frame is a pure function of time (window.seek(t)), so we
// capture frames in parallel headless Chromium instances, optionally average
// SUB subframes per output frame for motion blur (fewer than ~8 gives visible
// double images instead of blur), and encode H.264 + AAC to Instagram's spec.

const { chromium } = require("playwright-core");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { browserPath } = require("./browser");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "out");
const FRAMES = path.join(OUT, ".frames");
const args = process.argv.slice(2);
const FPS = 30;
const blurAt = args.indexOf("--blur");
const SUB = blurAt >= 0 ? Math.max(1, Number(args[blurAt + 1]) || 8) : 1;
const WORKERS = Number(process.env.WORKERS || 4);
const AUDIO = path.join(OUT, "voniweb-reel-audio.wav");

async function renderChunk(worker, frames, total, progress) {
  // one browser per worker: pages in a shared browser serialise their screenshots
  const browser = await chromium.launch({ executablePath: browserPath() });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error(`[w${worker}] PAGE ERROR: ${e.message}`));
  await page.goto("file://" + path.join(ROOT, "reel.html") + "?render");
  await page.waitForFunction(() => window.READY === true);
  for (const i of frames) {
    const t = i / (FPS * SUB);
    await page.evaluate((t) => window.seek(t), t);
    await page.screenshot({ path: path.join(FRAMES, `${String(i).padStart(5, "0")}.png`) });
    progress.done++;
    if (progress.done % 30 === 0 || progress.done === total) {
      process.stdout.write(`\r  captured ${progress.done}/${total} frames`);
    }
  }
  await browser.close();
}

function ffmpeg(argv) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...argv], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed: " + argv.join(" "));
}

(async () => {
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const durationSec = 15;
  const total = durationSec * FPS * SUB;
  console.log(`Rendering ${total} frames (${FPS}fps x${SUB} subframes) with ${WORKERS} workers...`);
  const t0 = Date.now();

  const progress = { done: 0 };
  const per = Math.ceil(total / WORKERS);
  await Promise.all(
    Array.from({ length: WORKERS }, (_, w) => {
      const frames = [];
      for (let i = w * per; i < Math.min(total, (w + 1) * per); i++) frames.push(i);
      return renderChunk(w, frames, total, progress);
    })
  );
  console.log(`\n  capture took ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // SUB subframes -> 1 frame (motion blur), then bt709 / yuv420p for Instagram
  const vf = [
    SUB > 1 ? `tmix=frames=${SUB}` : null,
    SUB > 1 ? `fps=${FPS}` : null,
    "scale=out_color_matrix=bt709:out_range=tv",
    "format=yuv420p",
  ].filter(Boolean).join(",");
  const video = [
    "-framerate", String(FPS * SUB), "-i", path.join(FRAMES, "%05d.png"),
  ];
  const enc = [
    "-vf", vf, "-r", String(FPS),
    "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-tune", "grain", "-profile:v", "high", "-level", "4.2",
    "-g", String(FPS), "-bf", "2",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-movflags", "+faststart", "-t", String(durationSec),
  ];

  const silent = path.join(OUT, "voniweb-reel-silent.mp4");
  console.log("Encoding silent master...");
  ffmpeg([...video, ...enc, "-an", silent]);

  if (fs.existsSync(AUDIO)) {
    const withAudio = path.join(OUT, "voniweb-reel.mp4");
    console.log("Muxing audio...");
    ffmpeg(["-i", silent, "-i", AUDIO, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
      "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-t", String(durationSec), "-movflags", "+faststart", withAudio]);
    console.log("  ->", path.relative(ROOT, withAudio));
  } else {
    console.log("  (no out/voniweb-reel-audio.wav — run `npm run audio` first to get the sound-designed version)");
  }
  console.log("  ->", path.relative(ROOT, silent));

  // Cover image for the Reel (the hook, fully on screen). Instagram's profile grid
  // crops covers to the centre 3:4, which this frame survives.
  {
    const coverFrame = Math.round(1.55 * FPS * SUB);
    fs.copyFileSync(path.join(FRAMES, `${String(coverFrame).padStart(5, "0")}.png`), path.join(OUT, "voniweb-reel-cover.png"));
    console.log("  -> out/voniweb-reel-cover.png");
  }
  if (!args.includes("--keep-frames")) fs.rmSync(FRAMES, { recursive: true, force: true });
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})().catch((e) => { console.error(e); process.exit(1); });
