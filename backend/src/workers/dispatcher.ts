import { clearDraft, findLeadsByStatus, insertEmailSent, updateLeadStatus } from "../db/db";
import { config } from "../config";
import { getRemainingCapacityToday, pickAvailableAccount, sendMail } from "../services/smtpPool";
import { dailyTargetReached } from "../services/rateLimiter";
import { logger } from "../services/logger";
import { emitAppEvent } from "../services/events";
import { asSetupError } from "../services/setupError";
import type { Lead } from "../types";

const WORKER = "dispatcher";

export async function sendLeadEmail(lead: Lead): Promise<boolean> {
  if (!lead.contact_email) {
    logger.warn(WORKER, `${lead.domain} has no contact email on file, cannot send. Skipping.`);
    updateLeadStatus(lead.id, "SEND_FAILED");
    return false;
  }
  if (!lead.draft_subject || !lead.draft_body) {
    logger.warn(WORKER, `${lead.domain} has no draft email, cannot send. Skipping.`);
    return false;
  }

  if (dailyTargetReached()) {
    logger.info(WORKER, `Daily target of ${config.dailyEmailTarget} emails reached. Holding sends.`);
    return false;
  }

  const account = pickAvailableAccount();
  if (!account) {
    logger.warn(WORKER, "All SMTP accounts have hit their daily cap. Holding sends until tomorrow.");
    return false;
  }

  updateLeadStatus(lead.id, "SENDING");
  emitAppEvent({ type: "lead_update", payload: { leadId: lead.id, status: "SENDING" } });
  logger.info(WORKER, `Sending to ${lead.contact_email} via ${account.key}...`);

  try {
    const { messageId } = await sendMail(account, {
      to: lead.contact_email,
      subject: lead.draft_subject,
      text: lead.draft_body,
    });

    insertEmailSent({
      lead_id: lead.id,
      smtp_account: account.key,
      from_email: account.fromEmail,
      to_email: lead.contact_email,
      subject: lead.draft_subject,
      body: lead.draft_body,
      message_id: messageId,
    });

    clearDraft(lead.id);
    updateLeadStatus(lead.id, "EMAILED");
    emitAppEvent({ type: "lead_update", payload: { leadId: lead.id, status: "EMAILED" } });
    logger.success(WORKER, `Sent to ${lead.domain} via ${account.key}.`);
    return true;
  } catch (err) {
    const setupError = asSetupError(err);
    if (setupError) {
      updateLeadStatus(lead.id, "READY_TO_SEND"); // draft is intact, send it once the login is fixed
      emitAppEvent({ type: "lead_update", payload: { leadId: lead.id, status: "READY_TO_SEND" } });
      throw new Error(`${account.key}: ${setupError.message}`, { cause: setupError });
    }
    updateLeadStatus(lead.id, "SEND_FAILED");
    emitAppEvent({ type: "lead_update", payload: { leadId: lead.id, status: "SEND_FAILED" } });
    logger.error(WORKER, `Send failed for ${lead.domain} via ${account.key}: ${(err as Error).message}`);
    return false;
  }
}

/** Sends the single next READY_TO_SEND lead, if capacity allows. Returns true if a send was attempted. */
export async function runDispatcherTick(): Promise<boolean> {
  if (dailyTargetReached()) return false;
  if (getRemainingCapacityToday() <= 0) return false;

  const [lead] = findLeadsByStatus("READY_TO_SEND", 1);
  if (!lead) return false;

  await sendLeadEmail(lead);
  return true;
}
