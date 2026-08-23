import { sql } from "drizzle-orm";
import { db } from "../src/index.js";
const r = await db.execute(sql`
  select c.id, c.state, c.arm, c.closed_reason, o.subject, o.provider_message_id, o.sent_at
  from cases c left join outreach o on o.case_id = c.id
  order by c.opened_at desc limit 6`);
console.table(r.rows);
process.exit(0);
