import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";

import { MIGRATION_CONNECT_TIMEOUT_MS } from "@/lib/constants";

// Migrations run when the app starts (src/instrumentation.ts) and from
// `npm run db:migrate`. Each file runs once, in its own transaction, recorded
// with a checksum; a file changed after it ran stops everything, because the
// database no longer matches the repo. It uses one session-mode connection of
// its own: the advisory lock that keeps two starting servers from migrating
// at once lives for the session, which the app's transaction pooler would drop.

export const MIGRATION_DIRECTORY = path.join(process.cwd(), "supabase", "migrations");
const MIGRATION_LOCK_KEY = "support_agent:migrations:v1";
const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

// Postgres grants EXECUTE on new functions to PUBLIC by default. In Week 4 that
// let the anon key call a SECURITY DEFINER function, live. The default is
// revoked for the schema before any migration can create a function.
const BOOTSTRAP_SQL = `
  create schema if not exists support_agent;

  revoke all on schema support_agent from public, anon, authenticated;

  create table if not exists support_agent.schema_migrations (
    filename text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  );

  alter table support_agent.schema_migrations enable row level security;
  revoke all on support_agent.schema_migrations from public, anon, authenticated;

  alter default privileges in schema support_agent revoke execute on functions from public;
  alter default privileges in schema support_agent revoke execute on functions from anon, authenticated;
  alter default privileges in schema support_agent revoke all on tables from anon, authenticated;
`;

type Migration = { filename: string; sql: string; checksum: string };
export type MigrationReport = { applied: string[]; alreadyApplied: number };

export function checksum(contents: string): string {
  return createHash("sha256").update(contents.replace(/\r\n/g, "\n")).digest("hex");
}

async function readMigrations(directory: string): Promise<Migration[]> {
  const filenames = (await readdir(directory)).filter((filename) => MIGRATION_FILE.test(filename)).sort();
  return Promise.all(
    filenames.map(async (filename) => {
      const sql = await readFile(path.join(directory, filename), "utf8");
      return { filename, sql, checksum: checksum(sql) };
    }),
  );
}

/** What has run, or null before the very first migration created the table. */
async function appliedChecksums(client: Client): Promise<Map<string, string> | null> {
  try {
    const result = await client.query<{ filename: string; checksum: string }>("select filename, checksum from support_agent.schema_migrations");
    return new Map(result.rows.map((row) => [row.filename, row.checksum]));
  } catch (error) {
    if ((error as { code?: string }).code === "42P01" || (error as { code?: string }).code === "3F000") return null;
    throw error;
  }
}

function assertUnchanged(migrations: Migration[], applied: Map<string, string>): void {
  for (const migration of migrations) {
    const recorded = applied.get(migration.filename);
    if (recorded && recorded !== migration.checksum) throw new Error(`An applied migration changed on disk: ${migration.filename}. Write a new migration instead.`);
  }
}

export async function runMigrations(connectionString: string, options: { directory?: string; log?: (line: string) => void } = {}): Promise<MigrationReport> {
  const log = options.log ?? (() => undefined);
  const migrations = await readMigrations(options.directory ?? MIGRATION_DIRECTORY);
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: MIGRATION_CONNECT_TIMEOUT_MS });
  await client.connect();
  try {
    // Most starts have nothing to do: one query, no lock.
    const known = await appliedChecksums(client);
    if (known) {
      assertUnchanged(migrations, known);
      if (migrations.every((migration) => known.has(migration.filename))) return { applied: [], alreadyApplied: migrations.length };
    }

    await client.query("select pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_KEY]);
    try {
      await client.query("begin");
      await client.query(BOOTSTRAP_SQL);
      await client.query("commit");
      // Another server may have migrated while this one waited for the lock.
      const applied = (await appliedChecksums(client)) ?? new Map<string, string>();
      assertUnchanged(migrations, applied);
      const done: string[] = [];
      for (const migration of migrations) {
        if (applied.has(migration.filename)) continue;
        await client.query("begin");
        try {
          await client.query(migration.sql);
          await client.query("insert into support_agent.schema_migrations (filename, checksum) values ($1, $2)", [migration.filename, migration.checksum]);
          await client.query("commit");
        } catch (error) {
          await client.query("rollback").catch(() => undefined);
          throw new Error(`${migration.filename}: ${error instanceof Error ? error.message : String(error)}`);
        }
        done.push(migration.filename);
        log(`Applied: ${migration.filename}`);
      }
      return { applied: done, alreadyApplied: migrations.length - done.length };
    } finally {
      await client.query("select pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}
