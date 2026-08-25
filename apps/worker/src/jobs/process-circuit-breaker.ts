import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, customers, outreach, senderIdentities } from "@riko/db";
import { alert, log } from "../lib/logger.js";

const WINDOW_HOURS = 24;

const MIN_SENDS = 20;

const UNSUBSCRIBE_RATE_LIMIT = Number(process.env.UNSUBSCRIBE_RATE_LIMIT ?? 0.1);

export interface BreakerResult {
  tenantId: string;
  sends: number;
  unsubscribes: number;
  rate: number;
  tripped: boolean;
}

export async function processCircuitBreaker(now: Date = new Date()): Promise<BreakerResult[]> {
  const since = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000);

  const senders = await db
    .select({
      tenantId: senderIdentities.tenantId,
      paused: senderIdentities.outreachPaused,
      alertWebhookUrl: senderIdentities.alertWebhookUrl,
    })
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

      alert(
        "circuit_breaker_paused",
        {
          tenantId: sender.tenantId,
          unsubscribes,
          sends: sendCount,
          rate: Number((rate * 100).toFixed(1)),
        },
        sender.alertWebhookUrl,
      );
    }

    if (!tripped && sender.paused) {
      await db
        .update(senderIdentities)
        .set({ outreachPaused: false, updatedAt: now })
        .where(eq(senderIdentities.tenantId, sender.tenantId));

      log.info("circuit_breaker_resumed", { tenantId: sender.tenantId, rate: Number((rate * 100).toFixed(1)) });
    }

    results.push({ tenantId: sender.tenantId, sends: sendCount, unsubscribes, rate, tripped });
  }

  return results;
}
