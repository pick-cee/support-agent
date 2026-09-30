import "dotenv/config";

import { readFileSync } from "node:fs";
import path from "node:path";

import type { PoolClient } from "pg";

import { parseCsv, type CsvRow } from "../src/lib/csv";
import { closePool, queryDb, withTransaction } from "../src/lib/db";

// assets/ belongs to the client and is read, never edited. Its dates are stale
// on purpose (DESIGN §2.6); the lookup tools judge them against today in code.
const SEED_DIRECTORY = path.join(process.cwd(), "assets", "seed-data");

type TableSpec = { table: string; file: string; key: string; columns: string[]; expectedCount: number };

const TABLES: TableSpec[] = [
  {
    table: "customers",
    file: "customers.csv",
    key: "customer_id",
    columns: ["customer_id", "company_name", "contact_name", "contact_email", "plan", "account_status", "region", "kyc_status", "support_notes"],
    expectedCount: 5,
  },
  {
    table: "transactions",
    file: "transactions.csv",
    key: "transaction_id",
    columns: ["transaction_id", "customer_id", "transaction_type", "amount", "currency", "destination_country", "status", "created_at", "estimated_arrival", "support_summary"],
    expectedCount: 5,
  },
  {
    table: "payouts",
    file: "payouts.csv",
    key: "payout_id",
    columns: ["payout_id", "transaction_id", "customer_id", "recipient_name", "amount", "currency", "status", "scheduled_for", "failure_reason"],
    expectedCount: 3,
  },
];

function load(spec: TableSpec): CsvRow[] {
  const { header, rows } = parseCsv(readFileSync(path.join(SEED_DIRECTORY, spec.file), "utf8"));
  const missing = spec.columns.filter((column) => !header.includes(column));
  const extra = header.filter((column) => !spec.columns.includes(column));
  if (missing.length || extra.length) throw new Error(`${spec.file}: columns differ from the schema (missing ${missing.join(", ") || "none"}, unexpected ${extra.join(", ") || "none"})`);
  return rows;
}

async function upsert(client: PoolClient, spec: TableSpec, rows: CsvRow[]): Promise<void> {
  const columnList = spec.columns.join(", ");
  const placeholders = spec.columns.map((_, index) => `$${index + 1}`).join(", ");
  const updates = spec.columns.filter((column) => column !== spec.key).map((column) => `${column} = excluded.${column}`).join(", ");
  const sql = `insert into support_agent.${spec.table} (${columnList}) values (${placeholders}) on conflict (${spec.key}) do update set ${updates}`;
  for (const row of rows) await client.query(sql, spec.columns.map((column) => row[column] ?? null));
}

async function verify(spec: TableSpec, rows: CsvRow[]): Promise<string[]> {
  const problems: string[] = [];
  const count = await queryDb<{ count: string }>(`select count(*)::text as count from support_agent.${spec.table}`);
  if (Number(count.rows[0]?.count) !== spec.expectedCount) problems.push(`${spec.table}: expected ${spec.expectedCount} rows, found ${count.rows[0]?.count}`);

  // Every empty CSV field must be NULL in the database, not "" and not a default.
  for (const row of rows) {
    for (const column of spec.columns) {
      if (row[column] !== null) continue;
      const stored = await queryDb<{ is_null: boolean }>(`select ${column} is null as is_null from support_agent.${spec.table} where ${spec.key} = $1`, [row[spec.key]]);
      if (!stored.rows[0]?.is_null) problems.push(`${spec.table}.${column} for ${row[spec.key]} should be NULL`);
    }
  }
  return problems;
}

async function main(): Promise<void> {
  const loaded = TABLES.map((spec) => ({ spec, rows: load(spec) }));

  await withTransaction(async (client) => {
    for (const { spec, rows } of loaded) await upsert(client, spec, rows);
  });

  const problems = (await Promise.all(loaded.map(({ spec, rows }) => verify(spec, rows)))).flat();

  // The constraints already enforce these; the check proves the load, not the schema.
  const orphans = await queryDb<{ problem: string }>(`
    select 'transaction ' || t.transaction_id || ' has no customer' as problem
      from support_agent.transactions t left join support_agent.customers c using (customer_id) where c.customer_id is null
    union all
    select 'payout ' || p.payout_id || ' has no transaction' from support_agent.payouts p
      left join support_agent.transactions t using (transaction_id) where t.transaction_id is null
    union all
    select 'payout ' || p.payout_id || ' has no customer' from support_agent.payouts p
      left join support_agent.customers c using (customer_id) where c.customer_id is null
  `);
  problems.push(...orphans.rows.map((row) => row.problem));

  if (problems.length) {
    console.error("Seed verification failed:");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }
  const summary = loaded.map(({ spec, rows }) => `${rows.length} ${spec.table}`).join(", ");
  console.log(`Seeded ${summary}. Counts match, every foreign key resolves, every empty CSV field is NULL.`);
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  })
  .finally(closePool);
