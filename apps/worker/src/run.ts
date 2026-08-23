import { processExposureSweep } from "./jobs/process-exposure-sweep.js";
import { processPromises } from "./jobs/process-promises.js";
import { processCircuitBreaker } from "./jobs/process-circuit-breaker.js";
import { processNewCases } from "./jobs/process-new-cases.js";
import { processDraftingCases } from "./jobs/process-drafting-cases.js";
import { processSendingCases } from "./jobs/process-sending-cases.js";
import { processAgentReplies } from "./jobs/process-agent-replies.js";
import { loadReplyContext } from "./loaders/load-reply-context.js";
import { loadGateInput } from "./loaders/load-gate-input.js";
import { loadRouteInput } from "./loaders/load-route-input.js";
import { loadCaseFacts } from "./loaders/load-case-facts.js";
import { loadPendingOutreach } from "./loaders/load-pending-outreach.js";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS ?? 15_000);

export async function tick(): Promise<void> {
  await processCircuitBreaker();
  await processExposureSweep();
  await processPromises();
  await processNewCases({ loadGateInput, loadRouteInput });
  await processDraftingCases(loadCaseFacts);
  await processSendingCases(loadPendingOutreach);
  await processAgentReplies({ loadPendingOutreach, loadReplyContext });
}

// The worker runs inside the API process, where a stalled loop is invisible:
// HTTP keeps answering while nothing is processed. /health reports these so a
// stall is one request away from being diagnosed.
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

export async function runWorker(): Promise<never> {
  startedAt = new Date().toISOString();
  process.stdout.write(`worker polling every ${POLL_INTERVAL_MS}ms\n`);
  for (;;) {
    try {
      await tick();
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    }
    lastTickAt = new Date().toISOString();
    tickCount += 1;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
