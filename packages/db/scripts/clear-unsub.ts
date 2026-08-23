import { sql } from "drizzle-orm";
import { db } from "../src/index.js";
const r = await db.execute(sql`
  update customers set unsubscribed_at = null
  where provider_customer_id = 'sahoosagnik1@gmail.com'
  returning id, unsubscribed_at`);
console.table(r.rows);
process.exit(0);
