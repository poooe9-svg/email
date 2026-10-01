import { findLeadsByStatus, getLatestAuditForLead, saveDraft, updateLeadStatus } from "../db/db";
import { writeColdEmail } from "../services/claudeClient";
import { logger } from "../services/logger";
import { emitAppEvent } from "../services/events";
import type { Lead } from "../types";

const WORKER = "copywriter";

export async function draftEmailForLead(lead: Lead): Promise<void> {
  const audit = getLatestAuditForLead(lead.id);
  if (!audit) {
    logger.warn(WORKER, `No audit found for ${lead.domain}, skipping draft.`);
    return;
  }

  if (!lead.contact_email) {
    updateLeadStatus(lead.id, "SEND_FAILED");
    emitAppEvent({ type: "lead_update", payload: { leadId: lead.id, status: "SEND_FAILED" } });
    logger.warn(WORKER, `No contact email for ${lead.domain} (none given, none found on site). Skipping draft.`);
    return;
  }

  const flaws: string[] = JSON.parse(audit.flaws_json || "[]");
  if (flaws.length === 0) {
    logger.warn(WORKER, `Audit for ${lead.domain} found no usable flaws, skipping.`);
    updateLeadStatus(lead.id, "AUDIT_FAILED");
    return;
  }

  updateLeadStatus(lead.id, "DRAFTING");
  emitAppEvent({ type: "lead_update", payload: { leadId: lead.id, status: "DRAFTING" } });
  logger.info(WORKER, `Drafting cold email for ${lead.domain}...`);

  try {
    const { subject, body } = await writeColdEmail({
      domain: lead.domain,
      niche: lead.niche,
      contactName: lead.contact_name,
      flaws,
    });

    saveDraft(lead.id, subject, body);
    updateLeadStatus(lead.id, "READY_TO_SEND");
    emitAppEvent({ type: "lead_update", payload: { leadId: lead.id, status: "READY_TO_SEND" } });
    logger.success(WORKER, `Draft ready for ${lead.domain}: "${subject}"`);
  } catch (err) {
    updateLeadStatus(lead.id, "AUDITED"); // retry-able: back to AUDITED so it can be re-picked
    logger.error(WORKER, `Copywriting failed for ${lead.domain}: ${(err as Error).message}`);
  }
}

export async function runCopywriterTick(batchSize = 1): Promise<number> {
  const leads = findLeadsByStatus("AUDITED", batchSize);
  for (const lead of leads) {
    await draftEmailForLead(lead);
  }
  return leads.length;
}
