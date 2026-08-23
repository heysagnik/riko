import { sql } from "drizzle-orm";
import { db } from "../src/index.js";
await db.execute(sql`update customers set timezone = null where id = ${process.argv[2]}`);
const r = await db.execute(sql`select id, timezone from customers where id = ${process.argv[2]}`);
console.table(r.rows);
process.exit(0);
