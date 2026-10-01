import { Router, type Request, type Response } from "express";
import { config } from "../config";
import {
  getCampaignState,
  getEmailsForLead,
  getLatestAuditForLead,
  getLeadById,
  getRecentLogs,
  getRepliesForLead,
  incrementMeetingsBooked,
  insertLead,
  listLeads,
  retryFailedLeads,
  updateLeadStatus,
} from "../db/db";
import { getRemainingCapacityToday } from "../services/smtpPool";
import { pauseCampaign, startCampaign, stopCampaign, getControllerState } from "../controller/masterController";
import { emitAppEvent } from "../services/events";
import { logger } from "../services/logger";

export const apiRouter = Router();

// ---------- Campaign control ----------

apiRouter.get("/state", (_req: Request, res: Response) => {
  const state = getControllerState();
  res.json({
    ...state,
    dailyEmailTarget: config.dailyEmailTarget,
    remainingSmtpCapacityToday: getRemainingCapacityToday(),
    smtpAccountsConfigured: config.smtpAccounts.length,
  });
});

apiRouter.post("/start", (_req: Request, res: Response) => {
  try {
    res.json({ status: startCampaign() });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.post("/pause", (_req: Request, res: Response) => {
  const status = pauseCampaign();
  res.json({ status });
});

apiRouter.post("/stop", (_req: Request, res: Response) => {
  const status = stopCampaign();
  res.json({ status });
});

// ---------- Metrics ----------

apiRouter.get("/metrics", (_req: Request, res: Response) => {
  res.json(getCampaignState());
});

// ---------- Logs ----------

apiRouter.get("/logs", (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 200;
  res.json(getRecentLogs(limit));
});

// ---------- Leads ----------

apiRouter.get("/leads", (req: Request, res: Response) => {
  const filter = (req.query.filter as string) || "all";
  if (!["all", "interested", "questions"].includes(filter)) {
    res.status(400).json({ error: "filter must be one of: all, interested, questions" });
    return;
  }
  res.json(listLeads(filter as "all" | "interested" | "questions"));
});

apiRouter.get("/leads/:id", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const lead = getLeadById(id);
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.json({
    lead,
    audit: getLatestAuditForLead(id),
    emails: getEmailsForLead(id),
    replies: getRepliesForLead(id),
  });
});

apiRouter.post("/leads", (req: Request, res: Response) => {
  const { domain, niche, contact_name, contact_email } = req.body ?? {};
  if (!domain || typeof domain !== "string") {
    res.status(400).json({ error: "domain is required" });
    return;
  }
  const lead = insertLead({ domain, niche, contact_name, contact_email });
  if (!lead) {
    res.status(409).json({ error: "Lead already exists for that domain" });
    return;
  }
  res.status(201).json(lead);
});

interface BulkLeadInput {
  domain: string;
  niche?: string;
  contact_name?: string;
  contact_email?: string;
}

apiRouter.post("/leads/bulk", (req: Request, res: Response) => {
  const items = req.body?.leads as BulkLeadInput[] | undefined;
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "Body must be { leads: [{ domain, niche?, contact_name?, contact_email? }] }" });
    return;
  }

  const created: unknown[] = [];
  const skipped: string[] = [];
  for (const item of items) {
    if (!item?.domain) continue;
    const lead = insertLead(item);
    if (lead) created.push(lead);
    else skipped.push(item.domain);
  }
  res.status(201).json({ created: created.length, skipped });
});

apiRouter.post("/leads/retry-failed", (_req: Request, res: Response) => {
  const requeued = retryFailedLeads();
  logger.info("api", `Re-queued ${requeued} failed lead(s).`);
  res.json({ requeued });
});

apiRouter.post("/leads/:id/mark-meeting-booked", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const lead = getLeadById(id);
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  updateLeadStatus(id, "MEETING_BOOKED");
  incrementMeetingsBooked();
  emitAppEvent({ type: "lead_update", payload: { leadId: id, status: "MEETING_BOOKED" } });
  res.json(getLeadById(id));
});
