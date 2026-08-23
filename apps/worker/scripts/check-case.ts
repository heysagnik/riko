import { db, cases, outreach } from "@riko/db";
import { eq } from "drizzle-orm";

const caseId = process.argv[2];
const [row] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
console.log("case:", row);
const [o] = await db.select().from(outreach).where(eq(outreach.caseId, caseId)).limit(1);
console.log("outreach:", o);
process.exit(0);
