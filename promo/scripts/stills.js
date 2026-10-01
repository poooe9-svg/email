// Render individual frames to PNG for quick review: node scripts/stills.js 0.5 3 6.2 ...
const { chromium } = require("playwright-core");
const path = require("path");
const { browserPath } = require("./browser");

(async () => {
  const times = process.argv.slice(2).map(Number);
  const outDir = process.env.STILLS_DIR || path.join(__dirname, "..", "out", "stills");
  require("fs").mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: browserPath() });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
  page.on("console", (m) => m.type() === "error" && console.error("CONSOLE:", m.text()));
  await page.goto("file://" + path.join(__dirname, "..", "reel.html") + "?render");
  await page.waitForFunction(() => window.READY === true);
  for (const t of times) {
    await page.evaluate((t) => window.seek(t), t);
    const file = path.join(outDir, `t${t.toFixed(2)}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
  await browser.close();
})();
