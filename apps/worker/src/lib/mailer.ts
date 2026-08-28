import nodemailer, { type Transporter } from "nodemailer";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

const transporterCache = new Map<string, Transporter>();

function cacheKey(config: SmtpConfig): string {
  return `${config.host}:${config.port}:${config.secure ? "tls" : "starttls"}:${config.user}:${config.password.slice(0, 8)}`;
}

export function getTransporterForSmtpConfig(config: SmtpConfig): Transporter {
  const key = cacheKey(config);
  const cached = transporterCache.get(key);
  if (cached) {
    return cached;
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  transporterCache.set(key, transporter);
  return transporter;
}
