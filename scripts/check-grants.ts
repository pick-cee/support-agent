import "dotenv/config";

import { closePool, queryDb } from "../src/lib/db";
import { countSchemaTables, findGrantViolations } from "../src/lib/grants";

// Fails if any table in the schema lacks RLS, if any function is executable by
// PUBLIC, anon or authenticated, or if the browser roles hold any privilege.
async function main(): Promise<void> {
  const violations = await findGrantViolations(queryDb);
  if (violations.length) {
    console.error("Grant check failed:");
    for (const violation of violations) console.error(`  ${violation.violation}: ${violation.object_name} -> ${violation.grantee}`);
    process.exitCode = 1;
    return;
  }
  const tables = await countSchemaTables(queryDb);
  console.log(
    `Grant check passed: ${tables} tables in support_agent, all with RLS; no function executable by PUBLIC, anon or authenticated; the browser roles hold no table privilege and no schema usage.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("Grant check failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  })
  .finally(closePool);
