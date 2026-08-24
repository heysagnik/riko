import { Router } from "express";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, outreach } from "@riko/db";

export const trackingRouter = Router();

const paramsSchema = z.object({ outreachId: z.string().uuid() });

const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

trackingRouter.get("/t/open/:outreachId", async (req, res) => {
  const parsed = paramsSchema.safeParse(req.params);
  if (parsed.success) {
    await db
      .update(outreach)
      .set({ openedAt: sql`coalesce(${outreach.openedAt}, now())` })
      .where(and(eq(outreach.id, parsed.data.outreachId), isNotNull(outreach.sentAt)));
  }

  res.status(200);
  res.set({
    "content-type": "image/gif",
    "cache-control": "no-store, no-cache, must-revalidate, private",
    pragma: "no-cache",
  });
  res.send(PIXEL);
});
