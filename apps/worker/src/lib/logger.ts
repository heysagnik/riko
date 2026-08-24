type Level = "info" | "warn" | "error";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

function write(level: Level, msg: string, fields: LogFields = {}): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
  };
  const line = JSON.stringify(entry);
  if (level === "info") process.stdout.write(`${line}\n`);
  else process.stderr.write(`${line}\n`);
}

export const log = {
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};

export function alert(title: string, detail: LogFields = {}, webhookUrl?: string | null): void {
  log.warn(`alert: ${title}`, detail);
  if (!webhookUrl) return;
  const text = `${title}${Object.entries(detail).length > 0 ? ` — ${JSON.stringify(detail)}` : ""}`;
  void fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch(() => undefined);
}
