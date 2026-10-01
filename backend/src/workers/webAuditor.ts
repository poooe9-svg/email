import { chromium, type Browser } from "playwright";
import { config } from "../config";
import { findLeadsByStatus, insertAudit, updateLeadContact, updateLeadStatus } from "../db/db";
import { logger } from "../services/logger";
import { summarizeAuditFlaws } from "../services/claudeClient";
import { emitAppEvent } from "../services/events";
import type { Lead } from "../types";

const WORKER = "auditor";

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({
      headless: true,
      executablePath: config.playwrightExecutablePath,
    });
  }
  return sharedBrowser;
}

export async function closeAuditorBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}

function normalizeUrl(domain: string): string {
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

interface RawSignals {
  finalUrl: string;
  hasSSL: boolean;
  hasViewportMeta: boolean;
  loadTimeMs: number;
  pageTitle: string | null;
  outdatedUISignals: string[];
  contactEmails: string[];
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const JUNK_EMAIL_RE = /\.(png|jpe?g|gif|webp|svg)$|@(example|sentry|wixpress|domain)\./i;

/** Pulls contact addresses from mailto: links and page text, same-domain addresses first. */
function extractContactEmails(html: string, mailtos: string[], domain: string): string[] {
  const host = domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./i, "").toLowerCase();
  const found = [...mailtos, ...(html.match(EMAIL_RE) ?? [])]
    .map((e) => decodeURIComponent(e).replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !JUNK_EMAIL_RE.test(e));
  const unique = [...new Set(found)];
  return unique.sort((a, b) => Number(b.endsWith(`@${host}`)) - Number(a.endsWith(`@${host}`)));
}

async function scrapeSignals(browser: Browser, domain: string): Promise<RawSignals> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // mobile viewport, to judge responsiveness directly
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();

  try {
    const start = Date.now();
    const response = await page.goto(normalizeUrl(domain), {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    const loadTimeMs = Date.now() - start;

    const finalUrl = page.url();
    const hasSSL = finalUrl.startsWith("https://");

    const hasViewportMeta = await page
      .locator('meta[name="viewport"]')
      .count()
      .then((c) => c > 0)
      .catch(() => false);

    const pageTitle = await page.title().catch(() => null);

    // Cheap DOM-based signals that correlate with an outdated / neglected site.
    const outdatedUISignals: string[] = [];
    const bodyHtml = await page.content().catch(() => "");

    if (/<font\b/i.test(bodyHtml)) outdatedUISignals.push("Uses legacy <font> tags");
    if (/<marquee\b/i.test(bodyHtml)) outdatedUISignals.push("Uses <marquee> scrolling text");
    if (/jquery-1\.\d/i.test(bodyHtml)) outdatedUISignals.push("Loads jQuery 1.x (over a decade old)");
    if (!hasViewportMeta) outdatedUISignals.push("No mobile viewport meta tag");
    const copyrightYearMatch = bodyHtml.match(/(?:©|copyright)\s*(\d{4})/i);
    if (copyrightYearMatch) {
      const year = Number(copyrightYearMatch[1]);
      if (year > 0 && year < new Date().getFullYear() - 2) {
        outdatedUISignals.push(`Footer copyright year stuck at ${year}`);
      }
    }
    if (loadTimeMs > 4000) outdatedUISignals.push(`Slow initial load (${loadTimeMs}ms)`);
    if (response && response.status() >= 400) outdatedUISignals.push(`Page responded with HTTP ${response.status()}`);

    // Rough mobile-overflow check: does content exceed viewport width, forcing horizontal scroll?
    const hasHorizontalOverflow = await page
      .evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 20)
      .catch(() => false);
    if (hasHorizontalOverflow) outdatedUISignals.push("Content overflows horizontally on mobile viewport");

    const mailtos = await page
      .$$eval('a[href^="mailto:" i]', (links) => links.map((a) => a.getAttribute("href") || ""))
      .catch(() => [] as string[]);
    const contactEmails = extractContactEmails(bodyHtml, mailtos, domain);

    return { finalUrl, hasSSL, hasViewportMeta, loadTimeMs, pageTitle, outdatedUISignals, contactEmails };
  } finally {
    await context.close().catch(() => {});
  }
}

export async function auditLead(lead: Lead): Promise<void> {
  updateLeadStatus(lead.id, "AUDITING");
  emitAppEvent({ type: "lead_update", payload: { leadId: lead.id, status: "AUDITING" } });
  logger.info(WORKER, `Auditing ${lead.domain}...`);

  try {
    const browser = await getBrowser();
    const signals = await scrapeSignals(browser, lead.domain);
    if (!lead.contact_email && signals.contactEmails.length > 0) {
      updateLeadContact(lead.id, signals.contactEmails[0], null);
      logger.info(WORKER, `Found contact email ${signals.contactEmails[0]} on ${lead.domain}.`);
    }

    const mobileResponsive = signals.hasViewportMeta && signals.outdatedUISignals.indexOf(
      "Content overflows horizontally on mobile viewport"
    ) === -1;

    const flaws = await summarizeAuditFlaws({
      domain: lead.domain,
      hasSSL: signals.hasSSL,
      mobileResponsive,
      loadTimeMs: signals.loadTimeMs,
      outdatedUISignals: signals.outdatedUISignals,
      pageTitle: signals.pageTitle,
    });

    insertAudit({
      lead_id: lead.id,
      has_ssl: signals.hasSSL,
      mobile_responsive: mobileResponsive,
      load_time_ms: signals.loadTimeMs,
      outdated_ui: signals.outdatedUISignals.length > 0,
      flaws_json: JSON.stringify(flaws.flaws),
      raw_notes: flaws.notes,
    });

    updateLeadStatus(lead.id, "AUDITED");
    emitAppEvent({ type: "lead_update", payload: { leadId: lead.id, status: "AUDITED" } });
    logger.success(WORKER, `Audit complete for ${lead.domain}: ${flaws.flaws.length} flaw(s) found.`);
  } catch (err) {
    updateLeadStatus(lead.id, "AUDIT_FAILED");
    emitAppEvent({ type: "lead_update", payload: { leadId: lead.id, status: "AUDIT_FAILED" } });
    logger.error(WORKER, `Audit failed for ${lead.domain}: ${(err as Error).message}`);
  }
}

/** Picks up to `batchSize` NEW leads and audits them one at a time. */
export async function runAuditorTick(batchSize = 1): Promise<number> {
  const leads = findLeadsByStatus("NEW", batchSize);
  for (const lead of leads) {
    await auditLead(lead);
  }
  return leads.length;
}
