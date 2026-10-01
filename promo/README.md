# Voniweb — 15s Instagram Reel

**Final file:** [`out/voniweb-reel.mp4`](out/voniweb-reel.mp4) · cover: [`out/voniweb-reel-cover.png`](out/voniweb-reel-cover.png)

1080×1920 · 9:16 · 30 fps · H.264 High (bt709) · AAC 48 kHz · exactly 15.0s · audio at -14 LUFS (Instagram's target)

The whole reel is code: a [GSAP](https://gsap.com) timeline in `reel.html`, rendered frame-by-frame in
headless Chromium via [Playwright](https://playwright.dev), and encoded with [FFmpeg](https://ffmpeg.org).
The music and sound effects are synthesised in `scripts/audio.js` (no samples, so no licensing issues)
on the same 100 BPM grid as the animation, so every hit lands on a cut.

## Storyboard

| Time | Beat | What happens |
|---|---|---|
| 0.0–2.4s | Hook | "BUSINESS OWNERS" → **Your website / is *losing* you / customers.** Each line slams on a beat, "losing" glitches, then the letters of "customers." fall off the screen. |
| 2.4–6.0s | Audit | An outdated site flies in and gets scanned. Four flaws pop on the beat: *Not secure*, *Loads in 8.4s*, *Broken on mobile*, *Looks like 2009*. Conversion score counts up to **23/100 — Losing leads**. |
| 6.0–7.2s | Turn | **Let's *fix that.*** Drums cut out and a riser builds. |
| 7.2–12.0s | Rebuild | Drop. A light wipe rebuilds the site. Each flaw flips green, the score climbs to **98**, and three lead notifications arrive. |
| 12.0–15.0s | Brand | The CTA button bursts into the Voniweb logo. **voniweb — Websites that *convert.*** · **Free website audit → LINK IN BIO** |

Key content stays inside Instagram's Reels safe zone, clear of the top bar, the caption area and the right-hand buttons
(press **G** in preview to see the zones).

## Edit and re-render

Requires Node 18+ and `ffmpeg` on your PATH (macOS: `brew install ffmpeg`; Windows: `winget install ffmpeg`).

```bash
cd promo
npm install
npx playwright install chromium    # once, if you don't already have a Chromium
npm run preview                    # http://localhost:5173 — live preview with sound
npm run render                     # audio + video -> out/voniweb-reel.mp4 (~3 min)
npm run stills -- 1.5 7.4 13.5     # PNG snapshots of specific seconds -> out/stills/
```

- **All copy** lives in the `COPY` object near the top of the `<script>` in `reel.html`: headline, the four flaws, CTA, location.
  Change it there and re-render. Keep lines about the same length, because the layout is sized for this copy.
- **Colours** are CSS variables in `:root` and match the indigo→fuchsia gradient on the dashboard.
- **Timing:** `BEAT = 0.6` (100 BPM). Timeline positions use `B(n)` = beat *n*. If you move a visual beat, move the
  matching sound in `scripts/audio.js`, which uses the same `B(n)`.
- **Motion blur:** `node scripts/render.js --blur 8` averages 8 subframes per frame for real motion blur (about 8× slower).
  Fewer than about 8 subframes gives double images rather than blur.

## Posting checklist

1. Upload `out/voniweb-reel.mp4` as a **Reel** (not a post) so it stays full-screen 9:16.
2. Cover: **Edit cover → Add from camera roll → `voniweb-reel-cover.png`**. It survives the 3:4 crop on your profile grid.
3. **Make sure the link in bio works.** The CTA sends people there, e.g. your `cal.com/voniweb/15min` booking page.
4. Audio: the built-in track works as-is. To use a trending sound instead, add it in Instagram's editor and drag
   **Camera audio / Original audio** to 0. Trending audio usually gets more reach than original audio.
5. Turn on Instagram's auto-captions. The on-screen text already carries the message with the sound off.

Caption starter:

> Most small-business websites are quietly losing customers: no SSL, slow load times, broken on mobile.
> We audit your site for free and show you exactly what's costing you leads. 👉 Link in bio.
> #webdesign #smallbusiness #websitedesign #leadgeneration #morocco #fes

## Tools used (all free)

| Tool | Role |
|---|---|
| [GSAP](https://gsap.com) | animation timeline and easing |
| [Playwright](https://playwright.dev) | headless Chromium frame capture |
| [FFmpeg](https://ffmpeg.org) | H.264/AAC encoding, two-pass loudness normalisation |
| [Inter Tight](https://fonts.google.com/specimen/Inter+Tight), [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif), [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) | type, self-hosted via [Fontsource](https://fontsource.org) |

Optional, for further edits by hand: [CapCut](https://www.capcut.com) for captions and trending audio on your phone,
[Remotion](https://www.remotion.dev) if you want to template many videos in React, and
[Artlist](https://artlist.io) or [Epidemic Sound](https://www.epidemicsound.com) for licensed music.
