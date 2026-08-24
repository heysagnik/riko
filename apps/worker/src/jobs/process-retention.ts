import { sql } from "drizzle-orm";
import { db, customers, cases, exposures } from "@riko/db";
import { log } from "../lib/logger.js";

/** DPDP/GDPR-style erasure window: PII older than this gets scrubbed. */
const RETENTION_DAYS = 365;
const BATCH_LIMIT = 200;

const REDACTED_EMAIL = Buffer.from("redacted@riko.local").toString("base64");

/**
 * Scrubs personal data for customers with no open cases whose last exposure is
 * past the retention window. Rows stay (aggregate metrics keep working);
 * identity fields go. The scrubbed email fails decryption-to-address checks
 * downstream and the gates treat them as undeliverable.
 */
export async function processRetention(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const stale = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      sql`not exists (select 1 from ${cases} k where k.customer_id = ${customers.id} and k.state in ('NEW', 'DRAFTING', 'SENDING', 'WAITING', 'PROMISED'))
          and not exists (select 1 from ${exposures} e where e.customer_id = ${customers.id} and e.occurred_at >= ${cutoff})`,
    )
    .limit(BATCH_LIMIT);

  let scrubbed = 0;

  for (const row of stale) {
    const updated = await db
      .update(customers)
      .set({ emailEncrypted: REDACTED_EMAIL, phoneEncrypted: null, name: null })
      .where(sql`${customers.id} = ${row.id}`)
      .returning({ id: customers.id });
    scrubbed += updated.length;
  }

  if (scrubbed > 0) {
    log.info("retention_scrubbed_customers", { count: scrubbed, retentionDays: RETENTION_DAYS });
  }

  return scrubbed;
}
