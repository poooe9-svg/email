import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config";
import type {
  Audit,
  CampaignState,
  DispatchLogEntry,
  EmailSent,
  Lead,
  LeadStatus,
  Reply,
  ReplyClassification,
} from "../types";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(path.resolve(__dirname, "schema.sql"), "utf-8");
db.exec(schema);

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function rollDailyCountersIfNeeded(): void {
  const state = db.prepare("SELECT * FROM campaign_state WHERE id = 1").get() as CampaignState;
  const today = todayStr();
  if (state.usage_date !== today) {
    db.prepare(
      `UPDATE campaign_state
       SET usage_date = ?, emails_sent_today = 0, audits_completed_today = 0,
           replies_received_today = 0, meetings_booked_today = 0, updated_at = datetime('now')
       WHERE id = 1`
    ).run(today);
  }
}

// ---------- Leads ----------

export function insertLead(input: {
  domain: string;
  niche?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
}): Lead | null {
  try {
    const stmt = db.prepare(
      `INSERT INTO leads (domain, niche, contact_name, contact_email)
       VALUES (@domain, @niche, @contact_name, @contact_email)`
    );
    const info = stmt.run({
      domain: input.domain.trim().toLowerCase(),
      niche: input.niche ?? null,
      contact_name: input.contact_name ?? null,
      contact_email: input.contact_email?.trim().toLowerCase() || null,
    });
    return getLeadById(Number(info.lastInsertRowid));
  } catch {
    return null; // duplicate domain (UNIQUE constraint) or other insert failure
  }
}

export function getLeadById(id: number): Lead | null {
  return (db.prepare("SELECT * FROM leads WHERE id = ?").get(id) as Lead) ?? null;
}

export function listLeads(filter?: "all" | "interested" | "questions"): Lead[] {
  if (filter === "interested") {
    return db
      .prepare("SELECT * FROM leads WHERE status IN ('INTERESTED','MEETING_BOOKED') ORDER BY updated_at DESC")
      .all() as Lead[];
  }
  if (filter === "questions") {
    return db
      .prepare("SELECT * FROM leads WHERE status = 'QUESTION' ORDER BY updated_at DESC")
      .all() as Lead[];
  }
  return db.prepare("SELECT * FROM leads ORDER BY updated_at DESC").all() as Lead[];
}

export function findLeadsByStatus(status: LeadStatus, limit = 1): Lead[] {
  return db
    .prepare("SELECT * FROM leads WHERE status = ? ORDER BY created_at ASC LIMIT ?")
    .all(status, limit) as Lead[];
}

export function updateLeadStatus(id: number, status: LeadStatus): void {
  db.prepare("UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

export function updateLeadContact(id: number, contact_email: string | null, contact_name: string | null): void {
  db.prepare(
    "UPDATE leads SET contact_email = COALESCE(?, contact_email), contact_name = COALESCE(?, contact_name), updated_at = datetime('now') WHERE id = ?"
  ).run(contact_email, contact_name, id);
}

export function saveDraft(leadId: number, subject: string, body: string): void {
  db.prepare(
    "UPDATE leads SET draft_subject = ?, draft_body = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(subject, body, leadId);
}

export function clearDraft(leadId: number): void {
  db.prepare(
    "UPDATE leads SET draft_subject = NULL, draft_body = NULL, updated_at = datetime('now') WHERE id = ?"
  ).run(leadId);
}

export function findLeadByDomainOrEmail(domain: string, email: string | null): Lead | null {
  if (email) {
    const byEmail = db
      .prepare("SELECT * FROM leads WHERE lower(contact_email) = lower(?)")
      .get(email) as Lead | undefined;
    if (byEmail) return byEmail;
  }
  if (!domain) return null;
  const host = domain.toLowerCase().replace(/^www\./, "");
  return (
    (db
      .prepare("SELECT * FROM leads WHERE domain IN (?, ?) ORDER BY updated_at DESC LIMIT 1")
      .get(host, `www.${host}`) as Lead) ?? null
  );
}

/** Leads left mid-step by a crash/restart would otherwise sit in a transient status forever. */
export function recoverInterruptedLeads(): { auditing: number; drafting: number } {
  const auditing = db
    .prepare("UPDATE leads SET status = 'NEW', updated_at = datetime('now') WHERE status = 'AUDITING'")
    .run().changes;
  const drafting = db
    .prepare("UPDATE leads SET status = 'AUDITED', updated_at = datetime('now') WHERE status = 'DRAFTING'")
    .run().changes;
  return { auditing, drafting };
}

// ---------- Audits ----------

export function insertAudit(audit: {
  lead_id: number;
  has_ssl: boolean;
  mobile_responsive: boolean;
  load_time_ms: number | null;
  outdated_ui: boolean;
  flaws_json: string;
  raw_notes: string;
  screenshot_path?: string | null;
}): Audit {
  const stmt = db.prepare(
    `INSERT INTO audits (lead_id, has_ssl, mobile_responsive, load_time_ms, outdated_ui, flaws_json, raw_notes, screenshot_path)
     VALUES (@lead_id, @has_ssl, @mobile_responsive, @load_time_ms, @outdated_ui, @flaws_json, @raw_notes, @screenshot_path)`
  );
  const info = stmt.run({
    lead_id: audit.lead_id,
    has_ssl: audit.has_ssl ? 1 : 0,
    mobile_responsive: audit.mobile_responsive ? 1 : 0,
    load_time_ms: audit.load_time_ms,
    outdated_ui: audit.outdated_ui ? 1 : 0,
    flaws_json: audit.flaws_json,
    raw_notes: audit.raw_notes,
    screenshot_path: audit.screenshot_path ?? null,
  });
  rollDailyCountersIfNeeded();
  db.prepare(
    "UPDATE campaign_state SET audits_completed_today = audits_completed_today + 1, updated_at = datetime('now') WHERE id = 1"
  ).run();
  return db.prepare("SELECT * FROM audits WHERE id = ?").get(info.lastInsertRowid) as Audit;
}

export function getLatestAuditForLead(leadId: number): Audit | null {
  return (
    (db
      .prepare("SELECT * FROM audits WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(leadId) as Audit) ?? null
  );
}

// ---------- Emails ----------

export function insertEmailSent(email: {
  lead_id: number;
  smtp_account: string;
  from_email: string;
  to_email: string;
  subject: string;
  body: string;
  message_id?: string | null;
}): EmailSent {
  const stmt = db.prepare(
    `INSERT INTO emails_sent (lead_id, smtp_account, from_email, to_email, subject, body, message_id)
     VALUES (@lead_id, @smtp_account, @from_email, @to_email, @subject, @body, @message_id)`
  );
  const info = stmt.run({
    lead_id: email.lead_id,
    smtp_account: email.smtp_account,
    from_email: email.from_email,
    to_email: email.to_email,
    subject: email.subject,
    body: email.body,
    message_id: email.message_id ?? null,
  });

  rollDailyCountersIfNeeded();
  const today = todayStr();
  db.prepare(
    `INSERT INTO smtp_usage (smtp_account, usage_date, sent_count)
     VALUES (?, ?, 1)
     ON CONFLICT(smtp_account, usage_date) DO UPDATE SET sent_count = sent_count + 1`
  ).run(email.smtp_account, today);
  db.prepare(
    "UPDATE campaign_state SET emails_sent_today = emails_sent_today + 1, updated_at = datetime('now') WHERE id = 1"
  ).run();

  return db.prepare("SELECT * FROM emails_sent WHERE id = ?").get(info.lastInsertRowid) as EmailSent;
}

export function getEmailsForLead(leadId: number): EmailSent[] {
  return db.prepare("SELECT * FROM emails_sent WHERE lead_id = ? ORDER BY sent_at ASC").all(leadId) as EmailSent[];
}

export function getLatestEmailForLead(leadId: number): EmailSent | null {
  return (
    (db
      .prepare("SELECT * FROM emails_sent WHERE lead_id = ? ORDER BY sent_at DESC LIMIT 1")
      .get(leadId) as EmailSent) ?? null
  );
}

export function getSmtpUsageToday(smtpAccount: string): number {
  rollDailyCountersIfNeeded();
  const row = db
    .prepare("SELECT sent_count FROM smtp_usage WHERE smtp_account = ? AND usage_date = ?")
    .get(smtpAccount, todayStr()) as { sent_count: number } | undefined;
  return row?.sent_count ?? 0;
}

// ---------- Replies ----------

export function insertReply(reply: {
  lead_id: number;
  email_id: number | null;
  smtp_account: string;
  from_address: string | null;
  subject: string | null;
  body: string | null;
  classification: ReplyClassification | null;
}): Reply {
  const stmt = db.prepare(
    `INSERT INTO replies (lead_id, email_id, smtp_account, from_address, subject, body, classification)
     VALUES (@lead_id, @email_id, @smtp_account, @from_address, @subject, @body, @classification)`
  );
  const info = stmt.run(reply);
  rollDailyCountersIfNeeded();
  db.prepare(
    "UPDATE campaign_state SET replies_received_today = replies_received_today + 1, updated_at = datetime('now') WHERE id = 1"
  ).run();
  return db.prepare("SELECT * FROM replies WHERE id = ?").get(info.lastInsertRowid) as Reply;
}

export function getRepliesForLead(leadId: number): Reply[] {
  return db.prepare("SELECT * FROM replies WHERE lead_id = ? ORDER BY received_at ASC").all(leadId) as Reply[];
}

export function incrementMeetingsBooked(): void {
  rollDailyCountersIfNeeded();
  db.prepare(
    "UPDATE campaign_state SET meetings_booked_today = meetings_booked_today + 1, updated_at = datetime('now') WHERE id = 1"
  ).run();
}

// ---------- Campaign state ----------

export function getCampaignState(): CampaignState {
  rollDailyCountersIfNeeded();
  return db.prepare("SELECT * FROM campaign_state WHERE id = 1").get() as CampaignState;
}

export function setCampaignStatus(status: CampaignState["status"]): CampaignState {
  db.prepare("UPDATE campaign_state SET status = ?, updated_at = datetime('now') WHERE id = 1").run(status);
  return getCampaignState();
}

// ---------- Dispatch log ----------

export function insertLogEntry(entry: {
  level: DispatchLogEntry["level"];
  worker: string;
  message: string;
}): DispatchLogEntry {
  const info = db
    .prepare("INSERT INTO dispatch_log (level, worker, message) VALUES (@level, @worker, @message)")
    .run(entry);
  return db.prepare("SELECT * FROM dispatch_log WHERE id = ?").get(info.lastInsertRowid) as DispatchLogEntry;
}

export function getRecentLogs(limit = 200): DispatchLogEntry[] {
  return db
    .prepare("SELECT * FROM dispatch_log ORDER BY id DESC LIMIT ?")
    .all(limit)
    .reverse() as DispatchLogEntry[];
}

// Trim log table so it doesn't grow unbounded across a long-running campaign.
export function trimDispatchLog(keep = 5000): void {
  db.prepare(
    `DELETE FROM dispatch_log WHERE id NOT IN (SELECT id FROM dispatch_log ORDER BY id DESC LIMIT ?)`
  ).run(keep);
}
