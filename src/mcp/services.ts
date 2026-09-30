import "server-only";

import { calSlots } from "@/lib/cal";
import { calConfig, runJobsNow, type SideEffectsMode } from "@/lib/outbox";

import type { CalendarService, ToolServices } from "./types";

// What the tools may reach beyond the database. The app is always live: it
// books and emails for real, on localhost as on Vercel. Only the eval runner,
// a test harness, passes "sandbox" in its own code: it still reads real slots
// but books nothing and emails no one, and records that as skipped_eval, so a
// test run never fills the calendar or the inbox.

function calendar(): CalendarService | null {
  const config = calConfig();
  if (!config) return null;
  return { slots: async (input) => (await calSlots(config, input)).map((start) => ({ start })) };
}

export type Defer = (work: () => Promise<void>) => void;

/**
 * create_escalation waits for the booking, because the caller needs its
 * outcome this turn; the handoff email goes out after the response, through
 * `defer` (Next's after() in a route), and reports the booking's outcome.
 */
export function supabaseServices(mode: SideEffectsMode, defer: Defer): ToolServices {
  return {
    calendar: calendar(),
    sideEffects: mode,
    runJobs: async (ids) => {
      const { queryDb } = await import("@/lib/db");
      const kinds = await queryDb<{ id: string; kind: string }>(`select id, kind from support_agent.jobs where id = any($1::uuid[])`, [ids]);
      const booking = kinds.rows.filter((job) => job.kind === "book_callback").map((job) => job.id);
      const rest = kinds.rows.filter((job) => job.kind !== "book_callback").map((job) => job.id);
      if (booking.length) await runJobsNow(booking, mode);
      if (rest.length) defer(() => runJobsNow(rest, mode));
    },
  };
}
