import "server-only";

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import { TOOL_QUERY_TIMEOUT_MS } from "@/lib/constants";
import { requireEnv } from "@/lib/env";

let pool: Pool | undefined;
let sessionMode = false;

/**
 * The app talks to Supabase's pooler in transaction mode (port 6543): server
 * connections are shared between transactions, which is what serverless needs.
 * In session mode (5432) every client holds a pooler slot for its whole life;
 * in Week 5 each Vercel instance opened its own pool and the first deployment
 * returned "EMAXCONNSESSION max clients reached in session mode" on every page.
 * Nothing in the app needs a session: no SET outside a transaction, no session
 * advisory lock, no LISTEN. Other hosts are used as given.
 */
export function appConnectionString(raw: string): string {
  const url = new URL(raw);
  if (url.hostname.endsWith(".pooler.supabase.com") && (url.port === "" || url.port === "5432")) url.port = "6543";
  return url.toString();
}

/** For the migration script, whose lock (pg_advisory_lock) lives for the session. */
export function selectSessionMode(): void {
  if (pool) throw new Error("Choose the connection mode before the first query");
  sessionMode = true;
}

export function getPool(): Pool {
  if (!pool) {
    const raw = requireEnv("SUPABASE_DB_URL");
    pool = new Pool({
      connectionString: sessionMode ? raw : appConnectionString(raw),
      max: process.env.VERCEL ? 3 : 8,
      ssl: { rejectUnauthorized: false },
      // The pooler closes idle connections; handing one of those out surfaced
      // in Week 5 as "Connection terminated unexpectedly" on the next request.
      idleTimeoutMillis: 10_000,
      keepAlive: true,
      connectionTimeoutMillis: TOOL_QUERY_TIMEOUT_MS,
      // Client-side: a SET statement_timeout would not survive the pooler.
      query_timeout: sessionMode ? undefined : TOOL_QUERY_TIMEOUT_MS,
    });
    // An idle client dropped by the server emits here. Without a listener the
    // event is an uncaught error; with one, the pool discards the client.
    pool.on("error", (error) => {
      console.error("Postgres idle client error (discarded):", error.message);
    });
  }
  return pool;
}

export async function queryDb<T extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
  return getPool().query<T>(text, [...values]);
}

export async function withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
