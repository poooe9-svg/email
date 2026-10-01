# Voniweb Cold Email Orchestration Engine

A self-contained, local-only cold email engine and CRM dashboard for **Voniweb**
(Jalal Beqqal, Fes, Morocco). Runs entirely on your machine — SQLite for
storage, your own SMTP/IMAP inboxes for sending and receiving, and Claude for
site auditing, copywriting, and reply triage. No external SaaS involved.

Target workflow: audit prospect websites for conversion-killing flaws, write
a hyper-personalized Problem-Agitate-Solve email referencing those flaws,
send up to 500/day rotated across your SMTP accounts, and triage replies so
`INTERESTED` prospects surface instantly on the dashboard.

## Architecture

```
/backend/src
  config.ts              env + SMTP account loading
  types.ts                shared TypeScript types
  db/                      SQLite schema + query layer (better-sqlite3)
  services/
    claudeClient.ts        Claude calls: audit summarization, copywriting, reply classification
    smtpPool.ts             nodemailer transporter rotation + daily caps
    rateLimiter.ts          daily target check + pause/stop-aware sleep
    logger.ts               dispatch log -> DB + live listeners
    events.ts               structured events (metrics/lead updates/alerts) -> WS
  workers/
    discovery.ts             validates newly added leads
    webAuditor.ts             Playwright audit (SSL, mobile, load time, outdated UI)
    copywriter.ts             Claude-generated PAS email drafts
    dispatcher.ts             SMTP rotation + sending + pacing
    replyTriage.ts            IMAP polling + Claude reply classification
  controller/
    masterController.ts       start/pause/stop state machine, runs the 5 worker loops
  routes/api.ts               REST API
  websocket.ts                 WebSocket broadcast (log tail, metrics, alerts)
  server.ts / index.ts         boot

/frontend                   vanilla HTML/Tailwind(CDN)/JS dashboard, served statically
/scripts                    CLI helpers (bulk import, DB reset)
/db                          leads.db lives here (gitignored)
```

### Lead lifecycle (status machine)

```
DISCOVERED -> NEW -> AUDITING -> AUDITED -> DRAFTING -> READY_TO_SEND -> SENDING -> EMAILED
                 \-> AUDIT_FAILED                                            \-> SEND_FAILED
EMAILED -> (reply received) -> INTERESTED | NOT_INTERESTED | QUESTION
INTERESTED -> MEETING_BOOKED (manual, from the dashboard)
```

Five independent worker loops (the "5 sub-agents") walk this pipeline every
`WORKER_TICK_MS`, gated by the global campaign state:

1. **Discovery** — validates domains you add via the dashboard/API/CSV import.
2. **Web Auditor** (Playwright) — scrapes each site for SSL, mobile
   responsiveness, load time, and outdated-UI signals, then asks Claude to
   turn those raw signals into a short list of prospect-facing flaws.
3. **Copywriter** (Claude) — turns the flaws into a PAS cold email.
4. **Dispatcher** (Nodemailer) — rotates across your configured SMTP
   accounts, respecting each account's 40/day cap and a randomized human-like
   delay between sends, and halts immediately on pause/stop.
5. **Reply Triage** (IMAP + Claude) — polls each mailbox for unread replies,
   matches them to a lead, classifies them, and pushes an instant UI alert on
   `INTERESTED`.

## Setup

### Windows (one click)

1. Install **Node.js LTS** from https://nodejs.org (version 20 or newer).
2. Put this project folder anywhere on your PC (e.g. unzip it to your Desktop).
3. Double-click **`start.bat`**. On first run it installs dependencies and
   Chromium, opens `.env` in Notepad for your API key and SMTP accounts, then
   starts the engine and opens **http://localhost:3000**.
4. Keep the black window open while you use the dashboard; closing it stops
   the engine. "localhost refused to connect" in the browser means that
   window isn't running.

### Manual (any OS)

```bash
npm install
npx playwright install chromium   # browser used by the web auditor (required)
cp .env.example .env
# edit .env: ANTHROPIC_API_KEY, SENDER_NAME, and at least one SMTP_1_* block
npm run dev
```

Dashboard: **http://localhost:3000**

### Configuring SMTP/IMAP accounts

Each account slot in `.env` (`SMTP_1` .. `SMTP_15`) needs at minimum `HOST`,
`USER`, `PASS`. Add the matching `IMAP_HOST`/`IMAP_PORT` for that same mailbox
to enable reply triage on it. Unconfigured slots (missing host/user/pass) are
skipped automatically — you don't need all 15 filled in to start.

Gmail/Workspace accounts need an **App Password** (not your normal password)
with 2FA enabled, and IMAP enabled in Gmail settings.

### Daily volume math

500 emails/day across up to 15 inboxes at a 40/day-per-inbox cap means you
need at least **13 configured SMTP accounts** to hit the full target
(13 × 40 = 520 ≥ 500). With fewer accounts, the dispatcher simply sends less
and logs that all accounts are at capacity.

## Using the dashboard

1. Click **+ Add Leads** and paste `domain.com, niche` lines (or `POST
   /api/leads/bulk`, or `npm run import-leads -- leads.csv`).
2. Click **START CAMPAIGN**. Watch the live dispatch log as the engine
   audits, drafts, and sends.
3. **PAUSE** halts sending/auditing immediately (in-flight delays are
   interrupted within ~250ms); **STOP** fully exits the worker loops.
4. Replies land automatically once IMAP is configured; `INTERESTED` replies
   pop a toast and jump the lead to the top of the **Interested** tab.
5. Click any lead row to see its audit flaws, the exact email sent, and the
   reply — and to manually mark a meeting booked.
6. If setup is wrong (no Chromium, bad API key or model, rejected SMTP login)
   the campaign pauses with the fix in the log instead of failing every lead.
   After fixing it, click **Retry failed** to re-queue leads that failed
   earlier, then **START CAMPAIGN** again.

## Scripts

- `npm run dev` — start with hot reload (tsx watch)
- `npm start` — start without hot reload
- `npm run import-leads -- leads.csv` — bulk import from CSV
  (`domain,niche,contact_name,contact_email`)
- `npm run reset-db` — wipe all campaign data, keep schema

## Notes & responsible use

- This engine sends real emails to real inboxes. Respect CAN-SPAM/GDPR: use
  a real sender identity and address (already configured), and honor
  unsubscribe/opt-out requests you receive as replies.
- The web auditor's "outdated UI" and "mobile responsiveness" checks are
  fast heuristics (missing viewport meta, horizontal overflow, legacy
  markup, load time), not a full Lighthouse audit — good enough to seed a
  personalized pitch, not a guarantee of accuracy.
- `ANTHROPIC_MODEL` defaults to the latest Claude model; pin an older one in
  `.env` if you specifically need it.
