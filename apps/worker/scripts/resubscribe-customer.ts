import { db, customers } from "@riko/db";
import { eq } from "drizzle-orm";

// Undo an accidental unsubscribe so the flow can be retested.
const email = process.argv[2] || "sahoosagnik1@gmail.com";

const [row] = await db
  .update(customers)
  .set({ unsubscribedAt: null })
  .where(eq(customers.providerCustomerId, email))
  .returning({ id: customers.id, unsubscribedAt: customers.unsubscribedAt });

console.log("Reset unsubscribe flag:", row);
process.exit(0);
