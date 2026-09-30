import "server-only";

import { ALERT_UNDELIVERED_BANNER_MINUTES, EVAL_RUN_STOPPED_AFTER_MINUTES } from "@/lib/constants";
import { queryDb } from "@/lib/db";

// What the console shows (DESIGN §14). Read-only, except the escalation status
// change. "Today" is midnight to now in Lagos.

const TODAY = `(date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos')`;

/** Customers reach support by a web call, a phone call or typing on the page. */
const CUSTOMER_CHANNELS = `('web', 'phone', 'text')`;

/**
 * Eval runs write real records, so the queue and today's numbers leave them
 * out: a test run must never look like work for the support team. The Evals
 * view and the conversation list's eval filter still show them.
 */
const NOT_EVAL_ESCALATION = `not exists (select 1 from support_agent.conversations ec where ec.id = e.conversation_id and ec.channel = 'eval')`;

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

export type TodayStats = {
  conversations: number;
  voice: number;
  typed: number;
  finished: number;
  resolvedWithoutHuman: number;
  openEscalations: number;
  callsBooked: number;
  alertsToday: number;
  criticalToday: number;
  firstTextP50: number | null;
  firstTextP95: number | null;
  vapiTurnP50: number | null;
  vapiTurnP95: number | null;
  agentSpendEstimateUsd: number;
  vapiCostUsd: number;
};

export async function todayStats(): Promise<TodayStats> {
  const [conversations, escalations, alerts, turns, reports] = await Promise.all([
    queryDb<{ total: number; voice: number; typed: number; finished: number; resolved: number; agent: string; vapi: string }>(
      `select count(*)::int as total,
              count(*) filter (where channel in ('web', 'phone'))::int as voice,
              count(*) filter (where channel = 'text')::int as typed,
              count(*) filter (where final_status is not null)::int as finished,
              count(*) filter (where final_status = 'resolved')::int as resolved,
              coalesce(sum(agent_cost_estimate_usd), 0)::text as agent,
              coalesce(sum(vapi_cost_usd), 0)::text as vapi
         from support_agent.conversations where channel in ${CUSTOMER_CHANNELS} and created_at >= ${TODAY}`,
    ),
    queryDb<{ open: number; booked: number }>(
      `select count(*) filter (where e.status <> 'closed')::int as open,
              count(*) filter (where e.status <> 'closed' and e.call_booked and e.appointment_time >= now())::int as booked
         from support_agent.escalations e where ${NOT_EVAL_ESCALATION}`,
    ),
    queryDb<{ n: number; critical: number }>(
      `select count(*)::int as n, count(*) filter (where severity = 'critical')::int as critical
         from support_agent.alerts where last_seen >= ${TODAY} and severity <> 'info'`,
    ),
    queryDb<{ ttft_ms: number }>(
      `select t.ttft_ms from support_agent.conversation_turns t join support_agent.conversations c on c.id = t.conversation_id
        where c.channel in ('web', 'phone') and t.created_at >= ${TODAY} and t.ttft_ms is not null`,
    ),
    queryDb<{ latency: number }>(
      `select (turn ->> 'turnLatency')::float as latency
         from support_agent.conversations c
         cross join lateral jsonb_array_elements(coalesce(c.raw_end_report #> '{artifact,performanceMetrics,turnLatencies}', '[]'::jsonb)) as turn
        where c.created_at >= ${TODAY} and turn ? 'turnLatency'`,
    ),
  ]);
  const c = conversations.rows[0]!;
  const firstText = turns.rows.map((row) => row.ttft_ms);
  const vapi = reports.rows.map((row) => row.latency);
  return {
    conversations: c.total,
    voice: c.voice,
    typed: c.typed,
    finished: c.finished,
    resolvedWithoutHuman: c.resolved,
    openEscalations: escalations.rows[0]!.open,
    callsBooked: escalations.rows[0]!.booked,
    alertsToday: alerts.rows[0]!.n,
    criticalToday: alerts.rows[0]!.critical,
    firstTextP50: percentile(firstText, 50),
    firstTextP95: percentile(firstText, 95),
    vapiTurnP50: percentile(vapi, 50),
    vapiTurnP95: percentile(vapi, 95),
    agentSpendEstimateUsd: Number(c.agent),
    vapiCostUsd: Number(c.vapi),
  };
}

export type DayActivity = { day: string; resolved: number; ticket_created: number; escalated: number; other: number };

/** Customer conversations per Lagos day for the last `days` days, by how they ended; days with none are included. */
export async function dailyActivity(days: number): Promise<DayActivity[]> {
  const result = await queryDb<DayActivity>(
    `with days as (
       select generate_series((now() at time zone 'Africa/Lagos')::date - ($1::int - 1), (now() at time zone 'Africa/Lagos')::date, interval '1 day')::date as day
     )
     select to_char(d.day, 'YYYY-MM-DD') as day,
            count(c.id) filter (where c.final_status = 'resolved')::int as resolved,
            count(c.id) filter (where c.final_status = 'ticket_created')::int as ticket_created,
            count(c.id) filter (where c.final_status = 'escalated')::int as escalated,
            count(c.id) filter (where c.id is not null and (c.final_status is null or c.final_status in ('abandoned', 'failed')))::int as other
       from days d
       left join support_agent.conversations c
         on (c.created_at at time zone 'Africa/Lagos')::date = d.day and c.channel in ${CUSTOMER_CHANNELS}
      group by d.day order by d.day`,
    [days],
  );
  return result.rows;
}

export type RecentConversation = { id: string; created_at: string; channel: string; final_status: string | null; summary: string | null; turn_count: number; first_words: string | null };

export async function recentConversations(limit: number): Promise<RecentConversation[]> {
  const result = await queryDb<RecentConversation>(
    `select c.id, c.created_at::text, c.channel, c.final_status, c.summary, c.turn_count,
            (select t.user_text from support_agent.conversation_turns t where t.conversation_id = c.id order by t.turn_index limit 1) as first_words
       from support_agent.conversations c
      where c.channel in ${CUSTOMER_CHANNELS}
      order by c.created_at desc limit $1`,
    [limit],
  );
  return result.rows;
}

/** For the sidebar: work waiting on a person, and problems from the last day. */
export async function navCounts(): Promise<{ escalations: number; alerts: number }> {
  const [escalations, alerts] = await Promise.all([
    queryDb<{ n: number }>(`select count(*)::int as n from support_agent.escalations e where e.status <> 'closed' and ${NOT_EVAL_ESCALATION}`),
    queryDb<{ n: number }>(`select count(*)::int as n from support_agent.alerts where severity <> 'info' and last_seen > now() - interval '1 day'`),
  ]);
  return { escalations: escalations.rows[0]?.n ?? 0, alerts: alerts.rows[0]?.n ?? 0 };
}

export async function knowledgeCounts(): Promise<{ document: number; team: number }> {
  const result = await queryDb<{ document: number; team: number }>(
    `select count(*) filter (where origin = 'document')::int as document, count(*) filter (where origin = 'team')::int as team
       from support_agent.kb_chunks where active and (expires_at is null or expires_at > now())`,
  );
  return result.rows[0] ?? { document: 0, team: 0 };
}

export type AlertCounts = { critical: number; warning: number; info: number };

export async function alertCounts(): Promise<AlertCounts> {
  const result = await queryDb<AlertCounts>(
    `select count(*) filter (where severity = 'critical')::int as critical,
            count(*) filter (where severity = 'warning')::int as warning,
            count(*) filter (where severity = 'info')::int as info
       from support_agent.alerts where last_seen > now() - interval '7 days'`,
  );
  return result.rows[0] ?? { critical: 0, warning: 0, info: 0 };
}

export type EscalationRow = {
  id: string;
  escalation_ref: string;
  ticket_ref: string;
  category: string;
  reason: string;
  user_name: string;
  company_name: string | null;
  status: string;
  booking_status: string;
  notification_status: string;
  notification_error: string | null;
  appointment_time: string | null;
  timezone: string | null;
  created_at: string;
  conversation_id: string | null;
};

/** The queue, ordered by booked time, then oldest first. */
export async function escalationsQueue(includeClosed: boolean): Promise<EscalationRow[]> {
  const result = await queryDb<EscalationRow>(
    `select e.id, e.escalation_ref, t.ticket_ref, e.category, e.reason, e.user_name, c.company_name, e.status, e.booking_status,
            e.notification_status, e.notification_error, e.appointment_time::text, e.timezone, e.created_at::text, e.conversation_id
       from support_agent.escalations e
       join support_agent.support_tickets t on t.id = e.ticket_id
       left join support_agent.customers c on c.customer_id = e.customer_id
      where ($1 or e.status <> 'closed') and ${NOT_EVAL_ESCALATION}
      order by e.appointment_time asc nulls last, e.created_at asc
      limit 200`,
    [includeClosed],
  );
  return result.rows;
}

/** The console's only write. Every change is a row (DESIGN §14). */
export async function changeEscalationStatus(id: string, to: string): Promise<boolean> {
  if (!["open", "in progress", "closed"].includes(to)) return false;
  const result = await queryDb<{ from_status: string }>(
    `with before as (select status as from_status from support_agent.escalations where id = $1 for update),
          changed as (update support_agent.escalations set status = $2, updated_at = now() where id = $1 and status <> $2 returning id)
     insert into support_agent.escalation_status_changes (escalation_id, from_status, to_status, changed_by)
     select $1, before.from_status, $2, 'console' from before, changed
     returning from_status`,
    [id, to],
  );
  return (result.rowCount ?? 0) > 0;
}

export type ConversationRow = {
  id: string;
  created_at: string;
  channel: string;
  turn_count: number;
  final_status: string | null;
  summary: string | null;
  agent_cost_estimate_usd: string;
  vapi_cost_usd: string | null;
  verified_customer_id: string | null;
};

/** With no channel chosen, everything except eval runs. */
export async function conversationsList(channel: string | null): Promise<ConversationRow[]> {
  const result = await queryDb<ConversationRow>(
    `select id, created_at::text, channel, turn_count, final_status, summary, agent_cost_estimate_usd::text, vapi_cost_usd::text, verified_customer_id
       from support_agent.conversations
      where (($1::text is null and channel <> 'eval') or channel = $1)
      order by created_at desc limit 100`,
    [channel],
  );
  return result.rows;
}

export type TurnDetail = {
  id: string;
  turn_index: number;
  created_at: string;
  user_text: string;
  spoken_text: string | null;
  answer_type: string | null;
  reply_source: string | null;
  status: string;
  error: string | null;
  confidence_note: string | null;
  repaired: boolean;
  fallback_used: boolean;
  filler_used: boolean;
  ttft_ms: number | null;
  total_ms: number | null;
  cost_estimate_usd: string | null;
  model: string | null;
  grounding: string | null;
  gate_results: { gate: string; passed: boolean; cleanup?: boolean; detail?: string; rejected?: string }[];
  tools: { tool_name: string; status: string; purpose: string; result_summary: string | null; duration_ms: number; error_message: string | null }[];
  retrievals: { query: string; found: boolean; top_score: number | null; degraded: boolean; source_titles: string[]; chunk_ids_used: string[] }[];
};

export async function conversationDetail(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const conversation = (
    await queryDb<ConversationRow & { vapi_call_id: string | null; ended_reason: string | null; escalation_id: string | null; caller_identifier: string | null }>(
      `select id, created_at::text, channel, turn_count, final_status, summary, agent_cost_estimate_usd::text, vapi_cost_usd::text, verified_customer_id,
              vapi_call_id, ended_reason, escalation_id, caller_identifier
         from support_agent.conversations where id = $1`,
      [id],
    )
  ).rows[0];
  if (!conversation) return null;
  const [turns, tools, retrievals, events, tickets, escalations] = await Promise.all([
    queryDb<Omit<TurnDetail, "tools" | "retrievals">>(
      `select id, turn_index, created_at::text, user_text, spoken_text, answer_type, reply_source, status, error, confidence_note, repaired, fallback_used, filler_used,
              ttft_ms, total_ms, cost_estimate_usd::text, model, grounding, gate_results
         from support_agent.conversation_turns where conversation_id = $1 order by turn_index`,
      [id],
    ),
    queryDb<TurnDetail["tools"][number] & { turn_id: string | null }>(
      `select turn_id, tool_name, status, purpose, result_summary, duration_ms, error_message from support_agent.tool_calls where conversation_id = $1 order by created_at`,
      [id],
    ),
    queryDb<TurnDetail["retrievals"][number] & { turn_id: string | null }>(
      `select turn_id, query, found, top_score, degraded, source_titles, chunk_ids_used from support_agent.retrieval_logs where conversation_id = $1 order by created_at`,
      [id],
    ),
    queryDb<{ created_at: string; event_type: string; summary: string; source: string }>(
      `select created_at::text, event_type, summary, source from support_agent.conversation_events where conversation_id = $1 and event_type not in ('vapi_payload_sample', 'mcp_handshake') order by created_at`,
      [id],
    ),
    queryDb<{ ticket_ref: string; category: string; priority: string; status: string; summary: string }>(
      `select ticket_ref, category, priority, status, summary from support_agent.support_tickets where conversation_id = $1 order by created_at`,
      [id],
    ),
    queryDb<{ escalation_ref: string; category: string; status: string; booking_status: string; notification_status: string; appointment_time: string | null; reason: string }>(
      `select escalation_ref, category, status, booking_status, notification_status, appointment_time::text, reason from support_agent.escalations where conversation_id = $1 order by created_at`,
      [id],
    ),
  ]);
  const detailed: TurnDetail[] = turns.rows.map((turn) => ({
    ...turn,
    tools: tools.rows.filter((tool) => tool.turn_id === turn.id),
    retrievals: retrievals.rows.filter((retrieval) => retrieval.turn_id === turn.id),
  }));
  return { conversation, turns: detailed, events: events.rows, tickets: tickets.rows, escalations: escalations.rows };
}

export type GapGroup = { section: string; count: number; examples: string[] };

/**
 * Declined and unsupported questions, grouped by the nearest knowledge-base
 * section the search found, or "no match" (DESIGN §1: the knowledge-base backlog).
 */
export async function knowledgeGaps(): Promise<GapGroup[]> {
  const result = await queryDb<{ user_text: string; section: string | null }>(
    `select t.user_text,
            (select k.section_path from support_agent.retrieval_logs r
               join support_agent.kb_chunks k on k.chunk_id = r.chunk_ids_returned[1] and k.kb_version = r.kb_version
              where r.turn_id = t.id order by r.created_at limit 1) as section
       from support_agent.conversation_turns t
       join support_agent.conversations c on c.id = t.conversation_id
      where c.channel in ('web', 'phone', 'text', 'eval')
        and (t.answer_type = 'decline'
             or exists (select 1 from support_agent.retrieval_logs r where r.turn_id = t.id and not r.found))
      order by t.created_at desc limit 500`,
  );
  const groups = new Map<string, string[]>();
  for (const row of result.rows) {
    const key = row.section ?? "No match";
    groups.set(key, [...(groups.get(key) ?? []), row.user_text]);
  }
  return [...groups.entries()]
    .map(([section, questions]) => ({ section, count: questions.length, examples: [...new Set(questions)].slice(0, 5) }))
    .sort((a, b) => b.count - a.count);
}

export type AlertRow = { id: string; type: string; severity: string; message: string; occurrences: number; first_seen: string; last_seen: string; notified_at: string | null };

export async function alertsList(): Promise<AlertRow[]> {
  const result = await queryDb<AlertRow>(
    `select id, type, severity, message, occurrences, first_seen::text, last_seen::text, notified_at::text
       from support_agent.alerts order by last_seen desc limit 200`,
  );
  return result.rows;
}

/** DESIGN §10.4: when the alert channel itself is broken, the console says so in red. */
export async function alertsUndelivered(): Promise<number> {
  const result = await queryDb<{ n: number }>(
    `select count(*)::int as n from support_agent.alerts a
      where a.severity <> 'info'
        and (a.notified_at is null or a.notified_at < a.first_seen)
        and a.first_seen < now() - make_interval(mins => $1)
        and a.last_seen > now() - interval '1 day'`,
    [ALERT_UNDELIVERED_BANNER_MINUTES],
  );
  const dead = await queryDb<{ n: number }>(`select count(*)::int as n from support_agent.jobs where kind = 'notify_alert' and status = 'dead' and updated_at > now() - interval '1 day'`);
  return (result.rows[0]?.n ?? 0) + (dead.rows[0]?.n ?? 0);
}

export type EvalRunRow = {
  id: string;
  created_at: string;
  label: string | null;
  model: string;
  side_effects_mode: string;
  passed: number | null;
  total: number | null;
  p50_ttfa_ms: number | null;
  p95_ttfa_ms: number | null;
  cost_estimate_usd: string | null;
  stopped: boolean;
};

/** A run with no result long after it started was stopped, not still running. */
export async function evalRuns(): Promise<EvalRunRow[]> {
  const result = await queryDb<EvalRunRow>(
    `select id, created_at::text, label, model, side_effects_mode, passed, total, p50_ttfa_ms, p95_ttfa_ms, cost_estimate_usd::text,
            (finished_at is null and created_at < now() - make_interval(mins => $1)) as stopped
       from support_agent.eval_runs order by created_at desc limit 50`,
    [EVAL_RUN_STOPPED_AFTER_MINUTES],
  );
  return result.rows;
}

export type EvalMatrixRow = { scenario_key: string; test_case: string; model: string; runs: number; passes: number };

/**
 * Pass rate per scenario and per model: the benchmark table (DESIGN §16). Only
 * the latest three benchmark runs per model, so runs on superseded code (kept
 * in the runs list as history) don't blur what the current code scores.
 */
export async function evalMatrix(): Promise<EvalMatrixRow[]> {
  const result = await queryDb<EvalMatrixRow>(
    `with latest as (
       select id from (
         select id, row_number() over (partition by model order by created_at desc) as recency
           from support_agent.eval_runs
          where label = 'benchmark' and finished_at is not null
       ) ranked where recency <= 3
     )
     select e.scenario_key, min(e.test_case) as test_case, e.model, count(*)::int as runs, count(*) filter (where e.passed)::int as passes
       from support_agent.evaluations e join latest on latest.id = e.eval_run_id
      group by e.scenario_key, e.model
      order by e.scenario_key, e.model`,
  );
  return result.rows;
}
