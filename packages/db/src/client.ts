import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const pool = new Pool({
  connectionString: requireEnv("DATABASE_URL"),
  max: 10,
  idleTimeoutMillis: 300_000,
  connectionTimeoutMillis: 10_000,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;

export async function closePool(): Promise<void> {
  await pool.end();
}
