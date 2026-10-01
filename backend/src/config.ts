import path from "node:path";
import dotenv from "dotenv";
import type { SmtpAccountConfig } from "./types";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function loadSmtpAccounts(): SmtpAccountConfig[] {
  const accounts: SmtpAccountConfig[] = [];
  for (let i = 1; i <= 15; i++) {
    const prefix = `SMTP_${i}`;
    const host = process.env[`${prefix}_HOST`];
    const user = process.env[`${prefix}_USER`];
    const pass = process.env[`${prefix}_PASS`];
    if (!host || !user || !pass) continue; // slot not configured, skip

    accounts.push({
      key: prefix,
      host,
      port: envInt(`${prefix}_PORT`, 587),
      secure: process.env[`${prefix}_SECURE`] === "true",
      user,
      pass,
      fromName: process.env[`${prefix}_FROM_NAME`] || process.env.SENDER_NAME || "Voniweb",
      fromEmail: process.env[`${prefix}_FROM_EMAIL`] || user,
      imapHost: process.env[`${prefix}_IMAP_HOST`] || undefined,
      imapPort: process.env[`${prefix}_IMAP_PORT`]
        ? envInt(`${prefix}_IMAP_PORT`, 993)
        : undefined,
    });
  }
  return accounts;
}

export const config = {
  port: envInt("PORT", 3000),
  dbPath: path.resolve(__dirname, "../../db/leads.db"),

  // The .env.example placeholder counts as unset, so START explains what's missing.
  anthropicApiKey: /your-key-here/.test(process.env.ANTHROPIC_API_KEY ?? "") ? "" : process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",

  agencyName: process.env.AGENCY_NAME || "Voniweb",
  senderName: process.env.SENDER_NAME || "Jalal Beqqal",
  senderTitle: process.env.SENDER_TITLE || "Founder, Voniweb",
  agencyLocation: process.env.AGENCY_LOCATION || "Fes, Morocco",
  bookingLink: process.env.BOOKING_LINK || "",

  dailyEmailTarget: envInt("DAILY_EMAIL_TARGET", 500),
  maxEmailsPerSmtpPerDay: envInt("MAX_EMAILS_PER_SMTP_PER_DAY", 40),
  minSendDelayMs: envInt("MIN_SEND_DELAY_MS", 30000),
  maxSendDelayMs: envInt("MAX_SEND_DELAY_MS", 90000),
  workerTickMs: envInt("WORKER_TICK_MS", 5000),
  replyPollMs: envInt("REPLY_POLL_MS", 120000),

  // Optional: point at a system-installed Chromium instead of Playwright's
  // downloaded browser (useful in locked-down/offline environments).
  playwrightExecutablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,

  smtpAccounts: loadSmtpAccounts(),
};

export type Config = typeof config;
