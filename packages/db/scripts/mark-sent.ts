import { sql } from "drizzle-orm";
import { db } from "../src/index.js";
const [id, mid] = [process.argv[2], process.argv[3]];
await db.execute(sql`update outreach set sent_at = now(), provider_message_id = ${mid} where case_id = ${id} and sent_at is null`);
await db.execute(sql`update cases set state = 'WAITING', attempt_count = attempt_count + 1, next_action_at = now() + interval '48 hours' where id = ${id} and state = 'SENDING'`);
const r = await db.execute(sql`select c.state, o.sent_at, o.provider_message_id from cases c join outreach o on o.case_id = c.id where c.id = ${id}`);
console.table(r.rows);
process.exit(0);
