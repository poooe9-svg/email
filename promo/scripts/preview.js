// Live preview with audio: node scripts/preview.js  ->  http://localhost:5173/reel.html
// Space = play/pause, ←/→ = step a frame (shift = 1s), G = Instagram safe-zone overlay, ?t=7.2 = jump.
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 5173);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".woff2": "font/woff2", ".wav": "audio/wav", ".png": "image/png", ".mp4": "video/mp4" };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = path.normalize(path.join(ROOT, url === "/" ? "/reel.html" : url));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Preview: http://localhost:${PORT}/reel.html`));
