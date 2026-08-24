import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import { razorpayWebhookRouter } from "./webhooks/razorpay.js";
import { casesRouter } from "./routes/cases.js";
import { metricsRouter } from "./routes/metrics.js";
import { connectionsRouter } from "./routes/connections.js";
import { settingsRouter } from "./routes/settings.js";
import { escalationsRouter } from "./routes/escalations.js";
import { publicUnsubscribeRouter } from "./routes/public-unsubscribe.js";
import { publicPayRouter } from "./routes/public-pay.js";
import { inboundMailRouter } from "./routes/inbound-mail.js";
import { auditRouter } from "./routes/audit.js";
import { policyRouter } from "./routes/policy.js";
import { reviewsRouter } from "./routes/reviews.js";
import { trackingRouter } from "./routes/tracking.js";
import { reportRouter } from "./routes/report.js";
import { failureCodesRouter } from "./routes/failure-codes.js";
import { ipRateLimiter, requestLogger } from "./middleware/runtime.js";
import { closePool } from "@riko/db";
import { log } from "@riko/worker/logger";

const app = express();

let getWorkerStatus: (() => Record<string, unknown>) | null = null;
let workerBootError: string | null = null;
let workerShutdown: (() => Promise<void>) | null = null;

app.use(requestLogger);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    at: new Date().toISOString(),
    worker: {
      enabled: process.env.RUN_WORKER === "1",
      bootError: workerBootError,
      ...(getWorkerStatus ? getWorkerStatus() : {}),
    },
  });
});

// Providers post here directly, so this stays off the /api prefix.
app.use(razorpayWebhookRouter);

const loginLimiter = ipRateLimiter(10);
app.post("/api/auth/*", loginLimiter);
app.all("/api/auth/*", toNodeHandler(auth));

app.use(express.json({ limit: "1mb" }));
app.use(inboundMailRouter);

app.use("/api", casesRouter);
app.use("/api", metricsRouter);
app.use("/api", connectionsRouter);
app.use("/api", settingsRouter);
app.use("/api", escalationsRouter);
app.use("/api", publicUnsubscribeRouter);
app.use("/api", publicPayRouter);
app.use("/api", auditRouter);
app.use("/api", policyRouter);
app.use("/api", reviewsRouter);
app.use("/api", reportRouter);
app.use("/api", failureCodesRouter);

app.use(trackingRouter);

// In production the API also serves the built SPA, so the browser sees one
// origin and the session cookie needs no CORS or SameSite relaxation.
const webDist = path.resolve(fileURLToPath(new URL("../../web/dist", import.meta.url)));
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

const server = app.listen(process.env.PORT ?? 4000, () => {
  process.stdout.write(`api listening on ${process.env.PORT ?? 4000}\n`);
});

async function shutdown(): Promise<void> {
  log.info("shutdown_started");
  server.close();
  if (workerShutdown) await workerShutdown();
  await closePool();
  log.info("shutdown_complete");
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
  setTimeout(() => process.exit(1), 10_000).unref();
});

if (process.env.RUN_WORKER === "1") {
  try {
    const { runWorker, workerStatus, shutdownWorker } = await import("@riko/worker/run");
    getWorkerStatus = workerStatus;
    workerShutdown = shutdownWorker;
    void runWorker();
  } catch (error) {
    // A failed import must not take the API down with it, and must not be
    // silent either: /health carries the reason the worker never started.
    workerBootError = error instanceof Error ? error.message : String(error);
    process.stderr.write(`worker failed to start: ${workerBootError}\n`);
  }
}
