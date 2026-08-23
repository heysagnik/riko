import { sql } from "drizzle-orm";
import { db } from "../src/index.js";
const ids = ["079fff24-9db5-40dc-84fd-85798c63f7ba","8a4112a9-c5ee-4dd0-b78d-e7b4f7b00483","3ed77d1c-2a97-41d1-b40f-e98b02ebe5f6"];
for (const id of ids) {
  const r = await db.execute(sql`update cases set state = 'SKIPPED', next_action_at = null where id = ${id} and state = 'SENDING' returning id, state`);
  console.log(id, "->", r.rows.length ? "SKIPPED" : "no change");
}
process.exit(0);
