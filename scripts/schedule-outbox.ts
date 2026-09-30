import "dotenv/config";

import { closePool, queryDb, selectSessionMode } from "../src/lib/db";

// Schedules the outbox worker (DESIGN §10.1): Supabase pg_cron calls
// /api/cron/outbox every minute through pg_net. The shared secret is stored in
// Supabase Vault and read at call time; it never appears in a migration file
// or in the cron job's text. Idempotent: re-running updates the secret and the job.
// Usage: npm run db:schedule-outbox -- --base-url https://your-deployment.example

const JOB_NAME = "relaypay-outbox";
const SECRET_NAME = "relaypay_cron_secret";

async function main(): Promise<void> {
  const index = process.argv.indexOf("--base-url");
  const baseUrl = (index >= 0 ? process.argv[index + 1] : process.env.APP_BASE_URL)?.trim().replace(/\/+$/, "");
  if (!baseUrl || !baseUrl.startsWith("https://")) throw new Error("Pass --base-url with the deployed https URL: pg_net calls it from Supabase, which cannot reach localhost.");
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new Error("CRON_SECRET is missing from .env");

  selectSessionMode();
  const existing = await queryDb<{ id: string }>(`select id from vault.secrets where name = $1`, [SECRET_NAME]);
  if (existing.rows[0]) await queryDb(`select vault.update_secret($1, $2)`, [existing.rows[0].id, secret]);
  else await queryDb(`select vault.create_secret($1, $2, 'Bearer token pg_cron sends to /api/cron/outbox')`, [secret, SECRET_NAME]);

  const command = `select net.http_post(
    url := '${baseUrl.replace(/'/g, "''")}/api/cron/outbox',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '${SECRET_NAME}')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )`;
  await queryDb(`select cron.schedule($1, '* * * * *', $2)`, [JOB_NAME, command]);
  const job = await queryDb<{ jobid: number; schedule: string; active: boolean }>(`select jobid, schedule, active from cron.job where jobname = $1`, [JOB_NAME]);
  console.log(`Scheduled ${JOB_NAME} (job ${job.rows[0]?.jobid}, "${job.rows[0]?.schedule}", active ${job.rows[0]?.active}) to POST ${baseUrl}/api/cron/outbox.`);
  console.log("Check the last runs with: select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;");
}

main()
  .catch((error: unknown) => {
    console.error("Scheduling failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
