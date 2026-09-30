import "dotenv/config";

import { execSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { SCENARIOS, type EvalRecord, type Scenario } from "../evals/scenarios";
import { FIRST_MESSAGE, TYPED } from "../src/app/copy";
import { checkBeforeModel } from "../src/agent/cheap-checks";
import { runAgent } from "../src/agent/run-agent";
import type { TranscriptLine } from "../src/agent/system-prompt";
import { beginTurn, finishCheapTurn, finishTurn, recordTurnOnConversation, upsertConversation } from "../src/agent/turn-store";
import { runTurn, type TurnOutcome } from "../src/agent/turn-runner";
import { DEFAULT_AGENT_MODEL, TEXT_TURN_DEADLINE_MS } from "../src/lib/constants";
import { finishConversation } from "../src/lib/conversation-end";
import { closePool, queryDb } from "../src/lib/db";
import { systemClock } from "../src/lib/time";
import { createMcpHttp } from "../src/mcp/http";
import { supabaseServices } from "../src/mcp/services";
import { supabaseRepository } from "../src/mcp/supabase-repository";

// npm run eval (DESIGN §18.2): every scenario through runTurn(), the function
// the Vapi route calls, in text mode, with the same cheap checks first. The
// MCP server runs in this process over real HTTP, so no dev server is needed.
// Side effects are sandboxed unless --live: Cal.com slots are read, nothing is
// booked and no email is sent. Results go to eval_runs and evaluations.
//
// Usage: npm run eval -- [--model claude-sonnet-5-5] [--runs 1] [--only key,key] [--phase4] [--label text] [--live]

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

type Deferred = Promise<void>[];

async function startMcpServer(deferred: Deferred, mode: "live" | "sandbox"): Promise<{ url: string; close: () => Promise<void> }> {
  const handle = createMcpHttp({
    repository: supabaseRepository,
    services: (defer) => supabaseServices(mode, defer),
    token: () => process.env.MCP_AGENT_TOKEN ?? "",
    allowedHostnames: () => ["127.0.0.1", "localhost"],
    clock: systemClock,
  });
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
      const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      const response = await handle(request, (work) => void deferred.push(work().catch((error: unknown) => console.error("deferred work failed:", String(error)))));
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
      res.end();
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

async function load(conversationId: string): Promise<EvalRecord> {
  const [turns, toolCalls, conversation, tickets, escalations, jobs, retrievals] = await Promise.all([
    queryDb<EvalRecord["turns"][number]>(
      `select turn_index, user_text, spoken_text, answer_type, reply_source, grounding, kb_chunk_ids, repaired, fallback_used, status, ttft_ms, total_ms,
              cost_estimate_usd::text, gate_results
         from support_agent.conversation_turns where conversation_id = $1 order by turn_index`,
      [conversationId],
    ),
    queryDb<EvalRecord["toolCalls"][number]>(
      `select c.tool_name, c.status, c.result_summary, t.turn_index
         from support_agent.tool_calls c left join support_agent.conversation_turns t on t.id = c.turn_id
        where c.conversation_id = $1 order by c.created_at`,
      [conversationId],
    ),
    queryDb<EvalRecord["conversation"]>(`select verified_customer_id, escalation_id from support_agent.conversations where id = $1`, [conversationId]),
    queryDb<EvalRecord["tickets"][number]>(`select ticket_ref, category, priority, transaction_id, reported_reference from support_agent.support_tickets where conversation_id = $1 order by created_at`, [conversationId]),
    queryDb<EvalRecord["escalations"][number]>(
      `select escalation_ref, user_name, user_email, category, booking_status, notification_status, call_booked from support_agent.escalations where conversation_id = $1 order by created_at`,
      [conversationId],
    ),
    queryDb<EvalRecord["jobs"][number]>(
      `select j.kind, j.status from support_agent.jobs j join support_agent.escalations e on e.id = j.ref_id where e.conversation_id = $1`,
      [conversationId],
    ),
    queryDb<EvalRecord["retrievals"][number]>(`select query, found, chunk_ids_returned, chunk_ids_used from support_agent.retrieval_logs where conversation_id = $1 order by created_at`, [conversationId]),
  ]);
  return { conversationId, turns: turns.rows, toolCalls: toolCalls.rows, conversation: conversation.rows[0]!, tickets: tickets.rows, escalations: escalations.rows, jobs: jobs.rows, retrievals: retrievals.rows };
}

async function runScenario(scenario: Scenario, runId: string, model: string, deferred: Deferred): Promise<{ record: EvalRecord; outcomes: TurnOutcome[] }> {
  const conversation = await upsertConversation({ vapiCallId: `eval-${runId}-${scenario.key}`, channel: "eval", callerIdentifier: null });
  const typed = scenario.channel === "text";
  const transcript: TranscriptLine[] = [{ role: "agent", text: typed ? TYPED.greeting : FIRST_MESSAGE }];
  const outcomes: TurnOutcome[] = [];
  for (const [turnIndex, line] of scenario.turns.entries()) {
    transcript.push({ role: "caller", text: line });
    const state = (await queryDb<{ verified_customer_id: string | null; escalation_id: string | null; clarify_streak: number }>(`select verified_customer_id, escalation_id, clarify_streak from support_agent.conversations where id = $1`, [conversation.id])).rows[0]!;
    const check = checkBeforeModel({ userText: line, turnIndex, spentTodayUsd: 0 });
    const userText = check.action === "run" ? check.userText : line;
    const turn = await beginTurn({ conversationId: conversation.id, turnIndex, userText, truncated: check.action === "run" && check.truncated });
    if (check.action === "reply") {
      await finishCheapTurn(turn.id, { spokenText: check.text, answerType: check.answerType, reason: check.reason, ttftMs: 0 });
      await recordTurnOnConversation(conversation.id, { turnIndex, clarifyStreak: state.clarify_streak, costEstimateUsd: 0 });
      transcript.push({ role: "agent", text: check.text });
      continue;
    }
    let spoken = "";
    const outcome = await runTurn({
      transcript,
      turnIndex,
      conversationId: conversation.id,
      turnId: turn.id,
      verified: state.verified_customer_id !== null,
      escalated: state.escalation_id !== null,
      clarifyStreak: state.clarify_streak,
      model,
      now: new Date(),
      signal: new AbortController().signal,
      emit: (text) => {
        spoken += text;
      },
      runAgent,
      ...(typed ? { channel: "text" as const, deadlineMs: TEXT_TURN_DEADLINE_MS } : {}),
    });
    outcomes.push(outcome);
    await finishTurn(turn.id, outcome);
    await recordTurnOnConversation(conversation.id, { turnIndex, clarifyStreak: outcome.nextClarifyStreak, costEstimateUsd: outcome.costEstimateUsd });
    transcript.push({ role: "agent", text: spoken || outcome.spokenText || "" });
  }
  await Promise.all(deferred.splice(0));
  // The conversation ends as a call would: final status, summary, end time. No follow-up
  // tickets, so a test run never puts work on the support team's queue.
  await finishConversation(conversation.id, { followUps: false, endedReason: "eval-finished" });
  return { record: await load(conversation.id), outcomes };
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

function describe(record: EvalRecord): string {
  const lines = record.turns.map((turn) => `Caller: "${turn.user_text}" / Agent (${turn.answer_type ?? "none"}${turn.repaired ? ", repaired" : ""}${turn.fallback_used ? ", fallback" : ""}): "${turn.spoken_text ?? ""}"`);
  const tools = record.toolCalls.map((call) => `${call.tool_name} ${call.status}`).join(", ");
  return `${lines.join(" | ")} || Tools: ${tools || "none"}`;
}

async function main(): Promise<void> {
  const model = arg("model") ?? process.env.AGENT_MODEL?.trim() ?? DEFAULT_AGENT_MODEL;
  const runs = Number(arg("runs") ?? 1);
  const only = arg("only")?.split(",").map((key) => key.trim());
  const mode = process.argv.includes("--live") ? "live" : "sandbox";
  const scenarios = SCENARIOS.filter((scenario) => (only ? only.includes(scenario.key) : true) && (process.argv.includes("--phase4") ? scenario.phase4 : true));
  const deferred: Deferred = [];
  const mcp = await startMcpServer(deferred, mode);
  process.env.APP_BASE_URL = mcp.url;

  let gitSha: string | null = null;
  try {
    gitSha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    gitSha = null;
  }
  const kbVersion = (await queryDb<{ kb_version: string }>(`select kb_version from support_agent.kb_chunks where active limit 1`)).rows[0]?.kb_version ?? null;

  for (let run = 1; run <= runs; run += 1) {
    const evalRun = (
      await queryDb<{ id: string }>(`insert into support_agent.eval_runs (label, model, git_sha, kb_version, side_effects_mode) values ($1, $2, $3, $4, $5) returning id`, [
        arg("label") ?? null,
        model,
        gitSha,
        kbVersion,
        mode,
      ])
    ).rows[0]!.id;
    console.log(`\nEval run ${run}/${runs} (${evalRun}), model ${model}, ${mode} side effects, ${scenarios.length} scenarios`);

    let passed = 0;
    let total = 0;
    let cost = 0;
    const firstText: number[] = [];
    const conversations: { scenario: Scenario; record: EvalRecord; outcomes: TurnOutcome[] }[] = [];

    for (const scenario of scenarios) {
      const started = performance.now();
      let record: EvalRecord;
      let outcomes: TurnOutcome[];
      try {
        ({ record, outcomes } = await runScenario(scenario, evalRun, model, deferred));
      } catch (error) {
        console.log(`FAIL ${scenario.key}: the scenario crashed: ${error instanceof Error ? error.message : String(error)}`);
        total += 1;
        continue;
      }
      conversations.push({ scenario, record, outcomes });
      const results = scenario.checks(record);
      const ok = results.every((result) => result.ok);
      const scenarioCost = outcomes.reduce((sum, outcome) => sum + outcome.costEstimateUsd, 0);
      cost += scenarioCost;
      firstText.push(...outcomes.map((outcome) => outcome.ttftMs).filter((value): value is number => value !== null));
      const notes = results.filter((result) => !result.ok).map((result) => `failed: ${result.says}`);
      const cleanups = record.turns.flatMap((turn) => turn.gate_results.filter((gate) => gate.cleanup).map((gate) => `turn ${turn.turn_index} ${gate.gate}: ${gate.detail}`));
      const alerts = outcomes.flatMap((outcome) => outcome.alerts.map((alert) => `alert ${alert.type}`));
      await queryDb(
        `insert into support_agent.evaluations (eval_run_id, scenario_key, test_case, user_input, expected_behavior, actual_behavior, passed, notes, conversation_id, channel, model, ttfa_ms, cost_estimate_usd)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'eval', $10, $11, $12)`,
        [evalRun, scenario.key, scenario.testCase, scenario.turns.map((line) => `"${line}"`).join(" then "), scenario.expected, describe(record), ok, [...notes, ...cleanups, ...alerts].join("; ") || null, record.conversationId, model, outcomes[0]?.ttftMs ?? null, scenarioCost],
      );
      total += 1;
      if (ok) passed += 1;
      console.log(`${ok ? "PASS" : "FAIL"} ${scenario.key} (${Math.round((performance.now() - started) / 1000)} s, est. $${scenarioCost.toFixed(4)})${notes.length ? `: ${notes.join("; ")}` : ""}`);
    }

    // The Logging row: the records match what happened. The SDK's own stream
    // says which tools ran; the MCP server logged them independently. They must agree.
    if (!only && !process.argv.includes("--phase4")) {
      const missing: string[] = [];
      for (const { scenario, record, outcomes } of conversations) {
        if (record.turns.length !== scenario.turns.length) missing.push(`${scenario.key}: ${record.turns.length} turn rows for ${scenario.turns.length} turns`);
        const seen = new Map<string, number>();
        for (const call of outcomes.flatMap((outcome) => outcome.toolCalls)) seen.set(call.name, (seen.get(call.name) ?? 0) + 1);
        const logged = new Map<string, number>();
        for (const call of record.toolCalls) logged.set(call.tool_name, (logged.get(call.tool_name) ?? 0) + 1);
        for (const name of new Set([...seen.keys(), ...logged.keys()])) {
          if ((seen.get(name) ?? 0) !== (logged.get(name) ?? 0)) missing.push(`${scenario.key}: the SDK saw ${seen.get(name) ?? 0} ${name} call(s), the server logged ${logged.get(name) ?? 0}`);
        }
        const searches = record.toolCalls.filter((call) => call.tool_name === "search_knowledge_base" && (call.status === "ok" || call.status === "not_found")).length;
        if (searches !== record.retrievals.length) missing.push(`${scenario.key}: ${searches} searches ran, ${record.retrievals.length} retrieval logs`);
      }
      const byKey = (key: string) => conversations.find((item) => item.scenario.key === key)?.record;
      if (!byKey("knowledge_answer")?.retrievals.length) missing.push("knowledge_answer: no retrieval log");
      if (!byKey("ticket")?.tickets.length) missing.push("ticket: no ticket row");
      if (!byKey("escalation")?.escalations.length) missing.push("escalation: no escalation row");
      const evaluationRows = (await queryDb<{ n: number }>(`select count(*)::int as n from support_agent.evaluations where eval_run_id = $1`, [evalRun])).rows[0]!.n;
      if (evaluationRows !== conversations.length) missing.push(`${evaluationRows} evaluation rows for ${conversations.length} scenarios`);
      const ok = missing.length === 0;
      await queryDb(
        `insert into support_agent.evaluations (eval_run_id, scenario_key, test_case, user_input, expected_behavior, actual_behavior, passed, notes, channel, model)
         values ($1, 'logging', 'Logging', 'Every scripted conversation in this run', $2, $3, $4, $5, 'eval', $6)`,
        [
          evalRun,
          "Rows exist in conversations, turns, retrieval logs, tool calls, tickets, escalations and evaluations, matching what happened.",
          `${conversations.length} conversations; ${conversations.reduce((sum, item) => sum + item.record.turns.length, 0)} turns; ${conversations.reduce((sum, item) => sum + item.record.toolCalls.length, 0)} tool calls; ${conversations.reduce((sum, item) => sum + item.record.retrievals.length, 0)} retrievals; ${conversations.reduce((sum, item) => sum + item.record.tickets.length, 0)} tickets; ${conversations.reduce((sum, item) => sum + item.record.escalations.length, 0)} escalations`,
          ok,
          missing.join("; ") || null,
          model,
        ],
      );
      total += 1;
      if (ok) passed += 1;
      console.log(`${ok ? "PASS" : "FAIL"} logging${missing.length ? `: ${missing.join("; ")}` : ""}`);
    }

    await queryDb(
      `update support_agent.eval_runs set finished_at = now(), passed = $2, total = $3, p50_ttfa_ms = $4, p95_ttfa_ms = $5, cost_estimate_usd = $6 where id = $1`,
      [evalRun, passed, total, percentile(firstText, 50), percentile(firstText, 95), cost],
    );
    console.log(`Run ${run}: ${passed}/${total} passed. First streamed text p50 ${percentile(firstText, 50)} ms, p95 ${percentile(firstText, 95)} ms. SDK cost estimate $${cost.toFixed(4)}.`);
  }
  await mcp.close();
}

main()
  .catch((error: unknown) => {
    console.error("Eval failed:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
