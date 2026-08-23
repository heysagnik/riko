import { sql } from "drizzle-orm";
import { db } from "../src/index.js";
const id = process.argv[2];
const ev = await db.execute(sql`select seq, from_state, to_state, reason from case_events where case_id = ${id} order by seq`);
console.table(ev.rows);
process.exit(0);
