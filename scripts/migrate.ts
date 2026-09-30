import "dotenv/config";

import { runMigrations } from "../src/lib/migrations";

// The app runs pending migrations itself when it starts (src/instrumentation.ts).
// This runs the same code by hand, for a first setup or a check.

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) {
  console.error("Migration failed: SUPABASE_DB_URL is not set.");
  process.exitCode = 1;
} else {
  runMigrations(url, { log: (line) => console.log(line) })
    .then((report) => console.log(report.applied.length ? `Done: ${report.applied.length} applied, ${report.alreadyApplied} already in place.` : `Nothing to do: all ${report.alreadyApplied} migrations are in place.`))
    .catch((error: unknown) => {
      console.error("Migration failed:", error instanceof Error ? error.message : "Unknown error");
      process.exitCode = 1;
    });
}
