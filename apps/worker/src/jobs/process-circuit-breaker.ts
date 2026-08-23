import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, customers, outreach, senderIdentities } from "@riko/db";

const WINDOW_HOURS = 24;

/** Enough sends for a rate to mean something. */
const MIN_SENDS = 20;

/** Opt-outs per send above which the campaign is doing harm, not recovery. */
const UNSUBSCRIBE_RATE_LIMIT = Number(process.env.UNSUBSCRIBE_RATE_LIMIT ?? 0.1);

export interface BreakerResult {
  tenantId: string;
  sends: number;
  unsubscribes: number;
  rate: number;
  tripped: boolean;
}

// Pauses outreach when opt-outs spike. A campaign costing customers is worse
// than one recovering nothing, and nobody is watching the dashboard at 3am.
export async function processCircuitBreaker(now: Date = new Date()): Promise<BreakerResult[]> {
  const since = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000);

  const senders = await db
    .select({ tenantId: senderIdentities.tenantId, paused: senderIdentities.outreachPaused })
    .from(senderIdentities);

  const results: BreakerResult[] = [];

  for (const sender of senders) {
    const [sends] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(outreach)
      .where(
        and(
          eq(outreach.tenantId, sender.tenantId),
          isNotNull(outreach.sentAt),
          gte(outreach.sentAt, since),
        ),
      );

    const [opts] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, sender.tenantId),
          isNotNull(customers.unsubscribedAt),
          gte(customers.unsubscribedAt, since),
        ),
      );

    const sendCount = sends?.n ?? 0;
    const unsubscribes = opts?.n ?? 0;
    const rate = sendCount > 0 ? unsubscribes / sendCount : 0;
    const tripped = sendCount >= MIN_SENDS && rate > UNSUBSCRIBE_RATE_LIMIT;

    if (tripped && !sender.paused) {
      await db
        .update(senderIdentities)
        .set({ outreachPaused: true, updatedAt: now })
        .where(eq(senderIdentities.tenantId, sender.tenantId));

      process.stderr.write(
        `circuit breaker: paused outreach for ${sender.tenantId} - ` +
          `${unsubscribes} opt-outs across ${sendCount} sends (${(rate * 100).toFixed(1)}%)\n`,
      );
    }

    results.push({ tenantId: sender.tenantId, sends: sendCount, unsubscribes, rate, tripped });
  }

  return results;
}
