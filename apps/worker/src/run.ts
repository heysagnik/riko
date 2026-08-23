import { processExposureSweep } from "./jobs/process-exposure-sweep.js";
import { processPromises } from "./jobs/process-promises.js";
import { processCircuitBreaker } from "./jobs/process-circuit-breaker.js";
import { processNewCases } from "./jobs/process-new-cases.js";
import { processDraftingCases } from "./jobs/process-drafting-cases.js";
import { processSendingCases } from "./jobs/process-sending-cases.js";
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
}

export async function runWorker(): Promise<never> {
  process.stdout.write(`worker polling every ${POLL_INTERVAL_MS}ms\n`);
  for (;;) {
    try {
      await tick();
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
