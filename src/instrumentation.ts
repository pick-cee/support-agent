// Runs once when a server starts: `next dev`, `next start`, and every new
// Vercel function instance. It applies any migration that has not run yet, so
// a deploy or a fresh clone never serves requests against an older schema.
// Most starts find nothing to do: one query, no lock (src/lib/migrations.ts).
// A failure is logged, not thrown: the app still answers, with its fallbacks,
// and the route that touches a missing table raises its own alert.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) return;
  const { runMigrations } = await import("./lib/migrations");
  try {
    const report = await runMigrations(url, { log: (line) => console.log(`[migrations] ${line}`) });
    if (report.applied.length) console.log(`[migrations] ${report.applied.length} applied at start: ${report.applied.join(", ")}`);
  } catch (error) {
    console.error(JSON.stringify({ event: "migrations_failed_at_start", error: error instanceof Error ? error.message : String(error) }));
  }
  await startLocalOutbox();
}

// pg_cron runs in Supabase and cannot reach localhost, so off Vercel nothing
// would retry a failed booking or email, send alert emails, or close an idle
// typed conversation. A long-running server does it itself, once a minute,
// through the same worker the cron route runs (DESIGN §10.1). Not on Vercel,
// where a function instance may be frozen between requests and pg_cron calls
// the route instead. Jobs are claimed with skip locked, so running beside
// pg_cron is safe.
const TIMER = Symbol.for("relaypay.localOutbox");

async function startLocalOutbox(): Promise<void> {
  if (process.env.VERCEL) return;
  const holder = globalThis as typeof globalThis & { [TIMER]?: ReturnType<typeof setInterval> };
  if (holder[TIMER]) return;
  const [{ OUTBOX_LOCAL_INTERVAL_MS }, { runOutbox }] = await Promise.all([import("./lib/constants"), import("./lib/outbox-worker")]);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runOutbox();
      if (result.ran || result.recovered || result.text_conversations_closed) console.log(`[outbox] ${JSON.stringify(result)}`);
    } catch (error) {
      console.error(JSON.stringify({ event: "local_outbox_failed", error: error instanceof Error ? error.message : String(error) }));
    } finally {
      running = false;
    }
  };
  holder[TIMER] = setInterval(() => void tick(), OUTBOX_LOCAL_INTERVAL_MS);
  // The server's exit is not held open by the timer.
  holder[TIMER].unref?.();
  console.log(`[outbox] running locally every ${OUTBOX_LOCAL_INTERVAL_MS / 1000} s`);
}
