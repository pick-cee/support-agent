import "dotenv/config";

import type { QueryResultRow } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { closePool, getPool } from "./db";
import { findGrantViolations } from "./grants";

// Runs against the real database, inside a transaction that is always rolled
// back: it proves the check fails when it should, not just that it passes.
describe("grants check against the database", () => {
  afterAll(closePool);

  it("passes on the migrated schema and catches a planted function, a table grant and RLS turned off", async () => {
    const client = await getPool().connect();
    const query = <T extends QueryResultRow>(text: string) => client.query<T>(text);
    try {
      await client.query("begin");
      expect(await findGrantViolations(query)).toEqual([]);

      await client.query("create function support_agent.grants_check_probe() returns integer language sql as 'select 1'");
      await client.query("grant select on support_agent.customers to anon");
      await client.query("alter table support_agent.payouts disable row level security");

      const found = (await findGrantViolations(query)).map((violation) => `${violation.violation} ${violation.object_name} ${violation.grantee}`);
      expect(found).toEqual(
        expect.arrayContaining([
          "function_execute support_agent.grants_check_probe() PUBLIC",
          "table_select support_agent.customers anon",
          "rls_disabled support_agent.payouts n/a",
        ]),
      );
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
