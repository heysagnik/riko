import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const e = await pool.query(
  `select seq, case_id, from_state, to_state, reason, created_at
   from case_events
   where case_id in ('94c71995-fa17-4243-9903-58a3c6f1995e','3a3aa90e-f4c0-4041-89a2-83eaa3a49443','3282e10d-32ea-41fe-8376-3d612e18f8e6')
   order by created_at desc limit 12`,
);
for (const r of e.rows) console.log(`${r.created_at.toISOString()} #${r.seq} ${r.to_state} (${r.reason})`);
await pool.end();
