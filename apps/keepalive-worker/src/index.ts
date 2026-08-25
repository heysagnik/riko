export interface Env {
  HEALTH_URL: string;
}

interface PingResult {
  ok: boolean;
  status: number;
  detail: string;
  ms: number;
}

interface ScheduledEvent {
  cron: string;
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

async function ping(url: string): Promise<PingResult> {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "riko-keepalive/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, detail: body.slice(0, 200), ms: Date.now() - started };
  } catch (error) {
    return { ok: false, status: 0, detail: error instanceof Error ? error.message : String(error), ms: Date.now() - started };
  }
}

function describe(result: PingResult): string {
  return JSON.stringify({ msg: "keepalive_ping", ok: result.ok, status: result.status, ms: result.ms, body: result.detail });
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: WorkerContext): Promise<void> {
    ctx.waitUntil(
      ping(env.HEALTH_URL).then((result) => {
        console.log(describe(result));
      }),
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/__scheduled") {
      const result = await ping(env.HEALTH_URL);
      return new Response(describe(result), { status: result.ok ? 200 : 502 });
    }
    return new Response("not found", { status: 404 });
  },
};
