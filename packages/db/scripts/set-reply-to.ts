import { sql } from "drizzle-orm";
import { db } from "../src/index.js";
const r = await db.execute(sql`
  update sender_identities set reply_to = 'billing@reply.sagnik.fun', updated_at = now()
  where tenant_id = 'LQRl8oVd5PYUWIe6tUAYzKBH7x79JuDq'
  returning tenant_id, reply_to`);
console.table(r.rows);
process.exit(0);
