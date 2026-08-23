import { sql } from "drizzle-orm";
import { db } from "../src/index.js";
const r = await db.execute(sql`select seq, to_state, reason, created_at from case_events order by seq desc limit 8`);
console.table(r.rows);
process.exit(0);
