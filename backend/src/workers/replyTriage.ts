import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { config } from "../config";
import {
  findLeadByDomainOrEmail,
  getLatestEmailForLead,
  insertReply,
  updateLeadStatus,
} from "../db/db";
import { classifyReply } from "../services/claudeClient";
import { logger } from "../services/logger";
import { emitAppEvent } from "../services/events";
import type { SmtpAccountConfig } from "../types";

const WORKER = "reply-triage";

function extractEmailAddress(from: string | undefined): string | null {
  if (!from) return null;
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

async function pollAccount(account: SmtpAccountConfig): Promise<number> {
  if (!account.imapHost) return 0;

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort ?? 993,
    secure: true,
    auth: { user: account.user, pass: account.pass },
    logger: false,
  });

  let repliesProcessed = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const uids = await client.search({ seen: false }, { uid: true });
      for (const uid of uids || []) {
        const message = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!message || !message.source) continue;

        const parsed = await simpleParser(message.source);
        const fromAddress = extractEmailAddress(parsed.from?.text);
        const bodyText = (parsed.text || parsed.html?.toString() || "").trim();

        await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true });

        if (!fromAddress) continue;

        const lead = findLeadByDomainOrEmail(fromAddress.split("@")[1] ?? "", fromAddress);
        if (!lead) {
          logger.info(WORKER, `Reply from unknown sender ${fromAddress} on ${account.key}, ignoring.`);
          continue;
        }

        const originalEmail = getLatestEmailForLead(lead.id);

        logger.info(WORKER, `Reply received from ${lead.domain} on ${account.key}. Classifying...`);

        let classification: "INTERESTED" | "NOT_INTERESTED" | "QUESTION" = "QUESTION";
        try {
          const result = await classifyReply({
            originalEmailBody: originalEmail?.body ?? "",
            replyBody: bodyText,
          });
          classification = result.classification;
        } catch (err) {
          logger.error(WORKER, `Reply classification failed for ${lead.domain}: ${(err as Error).message}`);
        }

        insertReply({
          lead_id: lead.id,
          email_id: originalEmail?.id ?? null,
          smtp_account: account.key,
          from_address: fromAddress,
          subject: parsed.subject ?? null,
          body: bodyText,
          classification,
        });

        updateLeadStatus(lead.id, classification);
        emitAppEvent({ type: "lead_update", payload: { leadId: lead.id, status: classification } });

        if (classification === "INTERESTED") {
          logger.success(WORKER, `INTERESTED reply from ${lead.domain}!`);
          emitAppEvent({
            type: "interested_alert",
            payload: { leadId: lead.id, domain: lead.domain, snippet: bodyText.slice(0, 200) },
          });
        } else {
          logger.info(WORKER, `Reply from ${lead.domain} classified as ${classification}.`);
        }

        repliesProcessed++;
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    logger.error(WORKER, `IMAP poll failed for ${account.key}: ${(err as Error).message}`);
    try {
      await client.logout();
    } catch {
      /* already disconnected */
    }
  }

  return repliesProcessed;
}

export async function runReplyTriageTick(): Promise<number> {
  const accountsWithImap = config.smtpAccounts.filter((a) => a.imapHost);
  if (accountsWithImap.length === 0) return 0;

  let total = 0;
  for (const account of accountsWithImap) {
    total += await pollAccount(account);
  }
  return total;
}
