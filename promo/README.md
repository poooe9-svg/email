# Voniweb — Instagram Reels

Two code-built Reels. Both are 1080×1920, 9:16, 30 fps, H.264 High (bt709) with AAC 48 kHz audio at -14 LUFS
(Instagram's target), and each file is under 27 MB.

| Reel | File | Cover | Source |
|---|---|---|---|
| **30s — "We build new ones. We rebuild old ones."** (brand film) | [`out/voniweb-reel-30s.mp4`](out/voniweb-reel-30s.mp4) | [`out/voniweb-reel-30s-cover.png`](out/voniweb-reel-30s-cover.png) | `reel-30.html`, `scripts/audio-30.js` |
| 15s — "Your website is losing you customers." (audit teaser) | [`out/voniweb-reel.mp4`](out/voniweb-reel.mp4) | [`out/voniweb-reel-cover.png`](out/voniweb-reel-cover.png) | `reel.html`, `scripts/audio.js` |

Each reel is a [GSAP](https://gsap.com) timeline rendered frame-by-frame in headless Chromium via
[Playwright](https://playwright.dev) and encoded with [FFmpeg](https://ffmpeg.org). The music and sound effects are
synthesised in code (no samples, so no licensing issues) on the same beat grid as the animation.

## 30s reel — storyboard (120 BPM, 15 bars)

| Time | Scene | What happens |
|---|---|---|
| 0–4s | Hook | **No website?** → **Old website?** → **We build new ones.** → **We *re*build old ones.** A browser card under the text shows each case: a dead page, a 2009-style site, a fresh site assembling, then an old→new wipe. The paper then pushes everything up. |
| 4–6s | 01 Sketch | A client brief on a sticky note, then a pencil sketches the wireframe on dotted paper with handwritten notes. |
| 6–8s | 02 Design | The sketch turns into the real site on a design canvas. A cursor labelled **Voniweb** drags a colour onto the button, and a cursor labelled **You** leaves a comment: "Love this! 😍". |
| 8–10s | 03 Code | The page code is typed live, typo and backspace included ("tabel" → "table"), then *Saved · live reload*. |
| 10–14s | 04 Live | Drop. The site launches on desktop and phone with a LIVE badge and confetti, then the **Fast Delivery · 1–3 Days Avg** card appears with a handwritten "live in days, not months!" |
| 14–20s | Rebuild | **Already have a website?** An old riad site gets red-marker notes (8 sec to load, no online booking, broken on phones, 2009 called…). A cursor then drags a before/after slider to reveal the rebuild, and green checkmarks appear. |
| 20–26s | Results | **Websites that actually get you clients.** A phone fills with bookings and messages (EN + FR), each notification a note in a rising melody, then the **5.0 / 5 Client Rating** card. |
| 26–30s | Brand | A giant V sweeps the screen and pulls back into the logo. **Voniweb · VIRTUAL WEB AGENCY · Premium Web Agency · Morocco · We Build Digital Experiences That Convert · Get Started → voniweb.com · EN/FR** |

**What's real vs. illustrative:**
- **Real (from voniweb.com):** the logo, the navy and sky-blue palette, the Syne headline font, the tagline, the 5.0/5 rating, "Fast Delivery 1–3 Days Avg", "Premium Web Agency · Morocco", "Get Started" and EN/FR.
- **Illustrative:** Café Zellige and Riad Noor are demo clients. Swap in real portfolio projects if you have them.
- **Logo:** recreated as a vector from a screenshot, because voniweb.com wasn't reachable from the build environment. To use the official file, replace `assets/voniweb-mark.svg` *and* the inline `<svg>` inside `#bigV` in `reel-30.html`. The inline copy keeps the logo sharp at 60× zoom.

## Edit and re-render

Requires Node 18+ and `ffmpeg` on your PATH (macOS: `brew install ffmpeg`; Windows: `winget install ffmpeg`).

```bash
cd promo
npm install
npx playwright install chromium            # once, if you don't already have a Chromium
npm run preview                            # http://localhost:5173/reel-30.html — live preview with sound
npm run render:30                          # 30s: audio + video -> out/voniweb-reel-30s.mp4 (~6 min)
npm run render                             # 15s: -> out/voniweb-reel.mp4 (~3 min)
npm run stills -- --reel reel-30 4.5 17.6  # PNG snapshots of specific seconds -> out/stills/
```

- **Copy:** every word is in the `COPY` object at the top of each reel's `<script>`. Headlines auto-fit their width.
- **Timing:** `B(n)` = beat *n* (30s: 0.5s per beat; 15s: 0.6s). The 30s soundtrack reads keystrokes, pencil and marker
  strokes, clicks, notifications and the slider drag straight from the page (`window.REEL.EVENTS`), so those sounds
  follow any retiming automatically. Music cues in `scripts/audio-30.js` are on the beat grid.
- **Preview controls:** Space plays/pauses, ←/→ step a frame (Shift = 1s), **G** shows Instagram's UI safe zones, and `?t=17.5` jumps to a time.
- **Motion blur:** `node scripts/render.js --reel reel-30 --blur 8` averages 8 subframes per frame (about 8× slower).

## Posting checklist

1. Upload the MP4 as a **Reel** (not a post) so it stays full-screen 9:16.
2. Cover: **Edit cover → Add from camera roll →** the matching `-cover.png`. It survives the 3:4 profile-grid crop.
3. Make sure the link in bio points to voniweb.com (or your booking page). Both reels end with a call to action.
4. Audio: the built-in track is synced to every cut. To use a trending sound instead, add it in Instagram's editor and
   drag **Original audio** to 0. Trending audio often gets more reach, but you lose the foley sync.
5. Turn on auto-captions. The on-screen text carries the message with the sound off.

Caption starter (30s):

> No website? Old website? We build new ones and rebuild old ones, designed, coded and live in 1–3 days. 🇲🇦
> Websites that actually bring you clients. 👉 voniweb.com
> #webdesign #webdevelopment #smallbusiness #morocco #maroc #agenceweb #siteweb

## Tools used (all free)

| Tool | Role |
|---|---|
| [GSAP](https://gsap.com) | animation timeline and easing |
| [Playwright](https://playwright.dev) | headless Chromium frame capture |
| [FFmpeg](https://ffmpeg.org) | H.264/AAC encoding, two-pass loudness normalisation |
| [Syne](https://fonts.google.com/specimen/Syne), [Outfit](https://fonts.google.com/specimen/Outfit), [Caveat](https://fonts.google.com/specimen/Caveat), [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif), [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono), [Inter Tight](https://fonts.google.com/specimen/Inter+Tight) | type, self-hosted via [Fontsource](https://fontsource.org) |

Optional, for further edits by hand: [CapCut](https://www.capcut.com) for captions and trending audio on your phone,
[Remotion](https://www.remotion.dev) if you want to template many videos in React, and
[Artlist](https://artlist.io) or [Epidemic Sound](https://www.epidemicsound.com) for licensed music.
