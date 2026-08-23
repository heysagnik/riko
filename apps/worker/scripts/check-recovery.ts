import { db, cases, payments } from "@riko/db";
import { desc, eq } from "drizzle-orm";

const rows = await db
  .select({ c: cases, p: payments })
  .from(cases)
  .innerJoin(exposures, eq(exposures.id, cases.exposureId))
      .leftJoin(payments, eq(payments.id, exposures.paymentId))
  .orderBy(desc(cases.openedAt));

for (const { c, p } of rows) {
  console.log(
    `${c.id.slice(0, 8)}  ${c.state.padEnd(9)} amount=${p.amountMinor} recovered=${c.recoveredAmountMinor ?? "-"} corr=${p.providerCorrelationId ?? "-"} reason=${c.closedReason ?? "-"}`,
  );
}
process.exit(0);
