import { config } from "../config";
import { getCampaignState, recoverInterruptedLeads, setCampaignStatus } from "../db/db";
import { logger } from "../services/logger";
import { emitAppEvent } from "../services/events";
import { randomSendDelayMs } from "../services/smtpPool";
import { interruptibleSleep, dailyTargetReached } from "../services/rateLimiter";
import { runDiscoveryTick } from "../workers/discovery";
import { runAuditorTick, closeAuditorBrowser } from "../workers/webAuditor";
import { runCopywriterTick } from "../workers/copywriter";
import { runDispatcherTick } from "../workers/dispatcher";
import { runReplyTriageTick } from "../workers/replyTriage";
import type { CampaignStatus } from "../types";

const WORKER = "controller";

function isRunning(): boolean {
  return getCampaignState().status === "RUNNING";
}
function isStopped(): boolean {
  return getCampaignState().status === "STOPPED";
}

let loopsActive = false;
// Bumped on every STOP so loops from a previous run exit even if START is
// clicked again before they noticed the STOPPED status.
let generation = 0;

/** Generic loop shell: waits while PAUSED, exits entirely when STOPPED. */
async function runLoop(name: string, tickIntervalMs: number, tick: () => Promise<void>): Promise<void> {
  const gen = generation;
  while (!isStopped() && gen === generation) {
    if (!isRunning()) {
      await interruptibleSleep(500, () => isRunning() || isStopped());
      continue;
    }
    try {
      await tick();
    } catch (err) {
      logger.error(name, `Unhandled error: ${(err as Error).message}`);
    }
    await interruptibleSleep(tickIntervalMs, () => !isRunning());
  }
}

async function discoveryLoop(): Promise<void> {
  await runLoop("discovery", config.workerTickMs, async () => {
    await runDiscoveryTick(5);
  });
}

async function auditorLoop(): Promise<void> {
  await runLoop("auditor", config.workerTickMs, async () => {
    await runAuditorTick(1);
  });
}

async function copywriterLoop(): Promise<void> {
  await runLoop("copywriter", config.workerTickMs, async () => {
    await runCopywriterTick(1);
  });
}

async function dispatcherLoop(): Promise<void> {
  const gen = generation;
  while (!isStopped() && gen === generation) {
    if (!isRunning()) {
      await interruptibleSleep(500, () => isRunning() || isStopped());
      continue;
    }
    if (dailyTargetReached()) {
      await interruptibleSleep(config.workerTickMs * 6, () => !isRunning());
      continue;
    }
    let sent = false;
    try {
      sent = await runDispatcherTick();
    } catch (err) {
      logger.error("dispatcher", `Unhandled error: ${(err as Error).message}`);
    }
    // Only burn a full randomized human-like delay after an actual send;
    // otherwise poll again quickly for the next ready draft.
    const delay = sent ? randomSendDelayMs() : config.workerTickMs;
    await interruptibleSleep(delay, () => !isRunning());
  }
}

async function replyTriageLoop(): Promise<void> {
  await runLoop("reply-triage", config.replyPollMs, async () => {
    await runReplyTriageTick();
  });
}

const loopRunners = [discoveryLoop, auditorLoop, copywriterLoop, dispatcherLoop, replyTriageLoop];

function ensureLoopsStarted(): void {
  if (loopsActive) return;
  loopsActive = true;
  for (const runner of loopRunners) {
    runner().catch((err) => {
      logger.error(WORKER, `Worker loop crashed: ${(err as Error).message}`);
    });
  }
}

export function startCampaign(): CampaignStatus {
  const state = setCampaignStatus("RUNNING");
  logger.success(WORKER, "Campaign started.");
  emitAppEvent({ type: "state_change", payload: { status: state.status } });
  ensureLoopsStarted();
  return state.status;
}

export function pauseCampaign(): CampaignStatus {
  const state = setCampaignStatus("PAUSED");
  logger.warn(WORKER, "Campaign paused.");
  emitAppEvent({ type: "state_change", payload: { status: state.status } });
  return state.status;
}

export function stopCampaign(): CampaignStatus {
  const state = setCampaignStatus("STOPPED");
  logger.warn(WORKER, "Campaign stopped. Worker loops will exit; restart to resume.");
  emitAppEvent({ type: "state_change", payload: { status: state.status } });
  loopsActive = false;
  generation++;
  closeAuditorBrowser().catch(() => {});
  return state.status;
}

export function getControllerState() {
  return getCampaignState();
}

/** Call once at process boot: if the DB says a campaign was RUNNING/PAUSED from a
 * previous run, restart the worker loops so the dashboard reflects reality. */
export function resumeLoopsIfNeeded(): void {
  const recovered = recoverInterruptedLeads();
  if (recovered.auditing + recovered.drafting > 0) {
    logger.warn(
      WORKER,
      `Re-queued ${recovered.auditing} lead(s) stuck in AUDITING and ${recovered.drafting} stuck in DRAFTING from the last run.`
    );
  }
  const state = getCampaignState();
  if (state.status === "RUNNING" || state.status === "PAUSED") {
    ensureLoopsStarted();
  }
}
