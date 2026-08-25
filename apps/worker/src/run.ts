import { sql } from "drizzle-orm";
import { db } from "@riko/db";
import { processExposureSweep } from "./jobs/process-exposure-sweep.js";
import { processPromises } from "./jobs/process-promises.js";
import { processWaitingCases } from "./jobs/process-waiting-cases.js";
import { processCircuitBreaker } from "./jobs/process-circuit-breaker.js";
import { processNewCases } from "./jobs/process-new-cases.js";
import { processDraftingCases } from "./jobs/process-drafting-cases.js";
import { processSendingCases } from "./jobs/process-sending-cases.js";
import { processAgentReplies } from "./jobs/process-agent-replies.js";
import { processScheduledDrafts } from "./jobs/process-scheduled-drafts.js";
import { processRetention } from "./jobs/process-retention.js";
import { loadReplyContext } from "./loaders/load-reply-context.js";
import { loadGateInput } from "./loaders/load-gate-input.js";
import { loadRouteInput } from "./loaders/load-route-input.js";
import { loadReasonCaseInput } from "./loaders/load-reason-case-input.js";
import { loadCaseFacts } from "./loaders/load-case-facts.js";
import { loadPendingOutreach } from "./loaders/load-pending-outreach.js";
import { log } from "./lib/logger.js";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS ?? 15_000);

const AGENT_REPLY_INTERVAL_MS = 60_000;
let lastAgentReplyRunAt = 0;

const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
let lastRetentionRunAt = 0;

export async function tick(): Promise<void> {
  await processCircuitBreaker();
  await processExposureSweep();
  await processPromises();
  await processWaitingCases();
  await processNewCases({ loadGateInput, loadRouteInput, loadReasonCaseInput });
  await processScheduledDrafts(loadCaseFacts);
  await processDraftingCases(loadCaseFacts);
  await processSendingCases(loadPendingOutreach);

  const now = Date.now();
  if (now - lastAgentReplyRunAt >= AGENT_REPLY_INTERVAL_MS) {
    lastAgentReplyRunAt = now;
    await processAgentReplies({ loadPendingOutreach, loadReplyContext });
  }

  if (now - lastRetentionRunAt >= RETENTION_INTERVAL_MS) {
    lastRetentionRunAt = now;
    await processRetention();
  }
}

let startedAt: string | null = null;
let lastTickAt: string | null = null;
let lastError: string | null = null;
let tickCount = 0;

export function workerStatus(): {
  startedAt: string | null;
  lastTickAt: string | null;
  lastError: string | null;
  tickCount: number;
} {
  return { startedAt, lastTickAt, lastError, tickCount };
}

let inFlightTick: Promise<void> | null = null;
let stopping = false;

async function runGuardedTick(): Promise<void> {
  const client = await db.$client.connect();
  try {
    const locked = await client.query("select pg_try_advisory_lock(hashtext('riko-worker-tick')) as locked");
    if (!locked.rows[0]?.locked) return;

    try {
      await tick();
      lastError = null;
    } finally {
      await client.query("select pg_advisory_unlock(hashtext('riko-worker-tick'))");
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    log.error("worker_tick_failed", { error: lastError });
  } finally {
    client.release();
  }
}

export async function runWorker(): Promise<never> {
  startedAt = new Date().toISOString();
  log.info("worker_started", { pollIntervalMs: POLL_INTERVAL_MS });

  for (;;) {
    if (stopping) break;
    inFlightTick = runGuardedTick();
    await inFlightTick;
    inFlightTick = null;

    lastTickAt = new Date().toISOString();
    tickCount += 1;

    for (let waited = 0; waited < POLL_INTERVAL_MS && !stopping; waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  log.info("worker_stopped", { ticks: tickCount });
  return new Promise<never>(() => undefined);
}

export async function shutdownWorker(): Promise<void> {
  stopping = true;
  if (inFlightTick) await inFlightTick;
}
