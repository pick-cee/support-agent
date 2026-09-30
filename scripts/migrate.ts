import "dotenv/config";

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { closePool, getPool, selectSessionMode } from "../src/lib/db";

const MIGRATION_DIRECTORY = path.join(process.cwd(), "supabase", "migrations");
const MIGRATION_LOCK_KEY = "support_agent:migrations:v1";

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

function checksum(contents: string): string {
  return createHash("sha256").update(contents.replace(/\r\n/g, "\n")).digest("hex");
}

async function main(): Promise<void> {
  // The migration lock is a session lock; transaction pooling would drop it.
  selectSessionMode();
  const client = await getPool().connect();

  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_KEY]);
    await client.query("begin");
    await client.query(BOOTSTRAP_SQL);
    await client.query("commit");

    const filenames = (await readdir(MIGRATION_DIRECTORY)).filter((filename) => /^\d{4}_[a-z0-9_]+\.sql$/.test(filename)).sort();

    for (const filename of filenames) {
      const sql = await readFile(path.join(MIGRATION_DIRECTORY, filename), "utf8");
      const digest = checksum(sql);
      const existing = await client.query<{ checksum: string }>("select checksum from support_agent.schema_migrations where filename = $1", [filename]);

      if (existing.rowCount === 1) {
        if (existing.rows[0]?.checksum !== digest) throw new Error(`An applied migration changed on disk: ${filename}. Write a new migration instead.`);
        console.log(`Already applied: ${filename}`);
        continue;
      }

      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into support_agent.schema_migrations (filename, checksum) values ($1, $2)", [filename, digest]);
        await client.query("commit");
        console.log(`Applied: ${filename}`);
      } catch (error) {
        await client.query("rollback");
        throw new Error(`${filename}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error("Migration failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  })
  .finally(closePool);
