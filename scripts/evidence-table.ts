import "dotenv/config";

import { writeFileSync } from "node:fs";

import { DEFAULT_AGENT_MODEL } from "../src/lib/constants";
import { closePool, queryDb } from "../src/lib/db";

// The testing evidence (DESIGN §22), generated from the records, never written
// by hand: the eight automated rows from the evaluations table, the voice row
// from the latest real call on the live page. The exact headers and row names
// the submission asks for, in its order. The notes are the narrative: what
// failed at first and what changed, each with its FAILURES.md entry.
// Usage: npm run evidence -- [--model claude-sonnet-5-5]

/** keys: the scenarios behind one row; a row passes only when all of them do. */
const ROWS: { keys: string[]; testCase: string; notes: string }[] = [
  {
    keys: ["knowledge_answer"],
    testCase: "Knowledge-grounded answer",
    notes:
      "Failed at first: for a payout-timing question the search ranked longer, keyword-heavy sections above the best match and dropped it (FAILURES 15). Changed: the best meaning match is always returned first. The match threshold was measured on 82 questions, not guessed (evals/retrieval-calibration.md). The brief lists five fee factors but the knowledge base names three, so the agent says only those three. A near miss is now answered with a spoken hedge instead of a refusal (FAILURES 25, 39).",
  },
  {
    keys: ["clarify"],
    testCase: "Clarifying question",
    notes:
      "Failed at first: a clarifying question that gave example references (TXN-9001, PAY-7002) was rejected by the invented-number check, replaced with a refusal, and broke the limit of two questions in a row (FAILURES 23). Changed: a clarifying question that fails a check falls back to a fixed clarifying question, and the limit is enforced in code.",
  },
  {
    keys: ["customer_lookup"],
    testCase: "Customer lookup",
    notes:
      "Failed at first on Claude Haiku 4.5: told \"I am Amara from LagosLedger\", it asked for a third identifier (FAILURES 24). Changed: the prompt says any two of name, company and email are enough. Verification needs two identifiers that agree on one record; the tool never returns contact details, and a miss and a partial match get the same reply.",
  },
  {
    keys: ["transaction_payout_lookup", "payout_lookup"],
    testCase: "Transaction or payout lookup",
    notes:
      "Failed at first: the agent repeated the seed record's \"processing within the normal expected window\" for a payment 41 days past its estimate (FAILURES 4), and once said a transaction needed review when the record did not (FAILURES 9). Changed: the tool flags an outdated summary and a passed estimate, worked out in code, and code writes that sentence; a check removes any review claim the record does not support. Tightened on 2026-10-02: nothing about a record, not even its status, until the caller is verified, and a reference that is not theirs reads exactly like one that does not exist. TXN-9001 and PAY-7002 belong to different customers and a call is one account, so they are two conversations.",
  },
  {
    keys: ["ticket"],
    testCase: "Ticket creation",
    notes:
      "Failed at first on Claude Haiku 4.5: it would not open a ticket without a reference (FAILURES 24). Changed: the prompt opens the ticket when the caller has none. A retry cannot create a second ticket (unique key), and the reference the caller hears is written by code from the tool result, never by the model. Added on 2026-10-02: the agent asks where to send a confirmation and reads the email back, and the outbox emails the customer their reference; nothing is promised for an address that cannot receive mail.",
  },
  {
    keys: ["escalation"],
    testCase: "Human escalation",
    notes:
      "Failed at first: reading the email back (\"efua at accrastack dot example. Is that right?\") was blocked because the email check read the sentence end as part of the address (FAILURES 18); the pattern was fixed. Then the turn that books the callback passed the 14 s limit, because each turn starts fresh and searched the calendar again for the time the caller had just chosen (FAILURES 37). Changed on 2026-10-02: the times offered are kept on the conversation, so a \"yes\" books at once, and only an offered time can be booked; the booking turn went from 14 to 15 s to 9 to 10 s in the eval. If the limit is still passed, the escalation is already made and the caller hears what code wrote from it, not silence or a guess. Real bookings and handoff emails were made on live calls: E-2004 on 30 September and E-2014 on 2 October, the second after the callback calendar was recreated.",
  },
  {
    keys: ["unsupported"],
    testCase: "Unsupported question",
    notes:
      "Failed at first: my own check rejected a correct refusal that said \"promise\" rather than \"guarantee\" (FAILURES 17). Changed: the check accepts the brief's wording, then was tightened to one sentence after it passed a reply that never answered (FAILURES 21). The agent now offers to check the caller's own payout after the general answer.",
  },
  {
    keys: ["voice"],
    testCase: "Voice flow",
    notes:
      "Failed at first: by Vapi's own measurements a reply took 6 to 7 s, because Vapi held the \"One moment\" line until the whole answer arrived; the call did not end on the goodbye; and \"let me check that\" was said before \"goodbye\" (FAILURES 46 to 48). Changed: every piece of a reply is sent to the voice at once, the end-call phrase matches Vapi's transcription of it, the filler plays only when a lookup starts, and a plain goodbye is answered without the model. Every call also emailed a false \"went quiet\" warning (FAILURES 50); now only a pattern is emailed.",
  },
  {
    keys: ["logging"],
    testCase: "Logging",
    notes:
      "Failed at first: my logging check required tool-call rows in every conversation, so it failed conversations that rightly used no tools (FAILURES 20). Changed: it compares, tool by tool, what the agent saw with what the MCP server logged. Eval conversations also never ended (FAILURES 31); every conversation now ends with a final status and summary. The MCP server logs every call itself, refusals and errors included.",
  },
];

function cell(text: string | null | undefined): string {
  return (text ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

/** A long transcript keeps its opening and its ending, where the outcome is. */
function trimmed(text: string, max = 900): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.floor(max * 0.35)).replace(/\s+\S*$/, "");
  const tail = text.slice(text.length - Math.floor(max * 0.6)).replace(/^\S*\s+/, "");
  return `${head} [...] ${tail}`;
}

function seconds(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? "n/a" : `${(ms / 1000).toFixed(1)} s`;
}

/** The voice row: the latest real call on the live page that Vapi reported on. */
async function voiceRow(): Promise<{ expected: string; actual: string; passed: string }> {
  const call = (
    await queryDb<{ id: string; created_at: string; ended_reason: string | null; final_status: string | null; turn_count: number; avg: string | null; vapi_cost_usd: string | null }>(
      `select id, created_at::text, ended_reason, final_status, turn_count,
              raw_end_report #>> '{artifact,performanceMetrics,turnLatencyAverage}' as avg, vapi_cost_usd::text
         from support_agent.conversations
        where channel in ('web', 'phone') and raw_end_report is not null and turn_count > 0
        order by created_at desc limit 1`,
    )
  ).rows[0];
  const expected = "Vapi captures the caller's speech, the agent answers through the custom LLM endpoint, Vapi speaks the reply, and Supabase has the conversation and its tool calls.";
  if (!call) return { expected, actual: "No real call recorded yet.", passed: "Not yet" };
  const [turns, tools, escalation] = await Promise.all([
    queryDb<{ user_text: string; spoken_text: string | null }>(`select user_text, spoken_text from support_agent.conversation_turns where conversation_id = $1 order by turn_index limit 1`, [call.id]),
    queryDb<{ tool_name: string; n: number }>(`select tool_name, count(*)::int as n from support_agent.tool_calls where conversation_id = $1 group by tool_name order by min(created_at)`, [call.id]),
    queryDb<{ escalation_ref: string; booking_status: string; notification_status: string }>(`select escalation_ref, booking_status, notification_status from support_agent.escalations where conversation_id = $1 limit 1`, [call.id]),
  ]);
  const first = turns.rows[0];
  const toolList = tools.rows.map((row) => `${row.tool_name}${row.n > 1 ? ` x${row.n}` : ""}`).join(", ");
  const parts = [
    `Real web call on the live page, ${call.created_at.slice(0, 16)} UTC: ${call.turn_count} turns, ended by ${call.ended_reason ?? "unknown"}, outcome ${call.final_status ?? "open"}.`,
    first ? `Caller: "${first.user_text}" / Agent: "${first.spoken_text ?? ""}"` : "",
    `Tool calls logged by the MCP server: ${toolList || "none"}.`,
    escalation.rows[0] ? `Escalation ${escalation.rows[0].escalation_ref}: booking ${escalation.rows[0].booking_status}, handoff email ${escalation.rows[0].notification_status}.` : "",
    `Vapi's average turn time ${seconds(call.avg ? Number(call.avg) : null)}; Vapi cost $${call.vapi_cost_usd ?? "n/a"} (billed).`,
  ];
  const passed = call.turn_count > 0 && call.ended_reason !== null && !/error|fail/i.test(call.ended_reason) ? "Yes" : "No";
  return { expected, actual: parts.filter(Boolean).join(" "), passed };
}

async function main(): Promise<void> {
  const index = process.argv.indexOf("--model");
  const model = index >= 0 ? process.argv[index + 1]! : (process.env.AGENT_MODEL?.trim() ?? DEFAULT_AGENT_MODEL);

  const latestRun = (
    await queryDb<{ id: string; created_at: string; passed: number; total: number }>(
      `select id, created_at::text, passed, total from support_agent.eval_runs
        where model = $1 and finished_at is not null and total >= 10 order by created_at desc limit 1`,
      [model],
    )
  ).rows[0];
  if (!latestRun) throw new Error(`No finished full eval run for ${model}. Run npm run eval first.`);

  // Every run of a scenario since the latest full run started, repeats included,
  // so one slow turn is shown with its pass rate rather than as the whole story.
  const since = await queryDb<{ scenario_key: string; runs: number; passes: number }>(
    `select e.scenario_key, count(*)::int as runs, count(*) filter (where e.passed)::int as passes
       from support_agent.evaluations e join support_agent.eval_runs r on r.id = e.eval_run_id
      where r.model = $1 and r.finished_at is not null and r.created_at >= $2::timestamptz
      group by e.scenario_key`,
    [model, latestRun.created_at],
  );
  const sinceBy = new Map(since.rows.map((row) => [row.scenario_key, row]));

  const lines = [
    "# Testing evidence",
    "",
    `Generated by \`npm run evidence\` on ${new Date().toISOString()}. The eight automated rows are the latest full eval run for ${model} (${latestRun.id}, ${latestRun.passed}/${latestRun.total} scenarios passed, ${latestRun.created_at.slice(0, 16)} UTC): each scenario from assets/test-scenarios.md played end to end through the same runTurn() the Vapi route calls, typed instead of spoken, with bookings and emails sandboxed. "Runs" counts every run of that scenario since then, repeats included. The voice row is the latest real call on the live page.`,
    "",
    "| Test case | Expected result | Actual result | Passed? | Notes or fix made |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const row of ROWS) {
    if (row.keys[0] === "voice") {
      const voice = await voiceRow();
      lines.push(`| ${row.testCase} | ${cell(voice.expected)} | ${cell(voice.actual)} | ${voice.passed} | ${cell(row.notes)} |`);
      continue;
    }
    const evaluations = (
      await queryDb<{ scenario_key: string; expected_behavior: string; actual_behavior: string; passed: boolean; notes: string | null }>(
        `select scenario_key, expected_behavior, actual_behavior, passed, notes from support_agent.evaluations where eval_run_id = $1 and scenario_key = any($2)`,
        [latestRun.id, row.keys],
      )
    ).rows.sort((a, b) => row.keys.indexOf(a.scenario_key) - row.keys.indexOf(b.scenario_key));
    if (evaluations.length !== row.keys.length) {
      lines.push(`| ${row.testCase} |  | Not in the latest run. | Not yet | ${cell(row.notes)} |`);
      continue;
    }
    const counted = row.keys.map((key) => sinceBy.get(key)).filter((value) => value !== undefined);
    const runs = { runs: counted.reduce((sum, value) => sum + value.runs, 0), passes: counted.reduce((sum, value) => sum + value.passes, 0) };
    const allPassed = evaluations.every((evaluation) => evaluation.passed);
    const passed = `${allPassed ? "Yes" : "No"}${runs.runs > row.keys.length ? ` (runs: ${runs.passes} of ${runs.runs})` : ""}`;
    const failures = evaluations.filter((evaluation) => !evaluation.passed && evaluation.notes).map((evaluation) => `This run: ${evaluation.notes}.`);
    const notes = [...failures, row.notes].join(" ");
    const expected = evaluations.map((evaluation) => cell(evaluation.expected_behavior)).join(" ");
    const actual = evaluations.map((evaluation) => trimmed(cell(evaluation.actual_behavior), Math.floor(900 / evaluations.length))).join(" || ");
    lines.push(`| ${row.testCase} | ${expected} | ${actual} | ${passed} | ${cell(notes)} |`);
  }
  lines.push("");
  writeFileSync("docs/testing-evidence.md", `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

main()
  .catch((error: unknown) => {
    console.error("Evidence table failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
