// Every threshold, limit, timeout and price in the app lives here (DESIGN §21).
// Values marked "measure" start as DESIGN gives them and are replaced with
// measured values, with the measurement noted beside them.

// --- The support agent --------------------------------------------------------
// Sonnet 5.5 is the default by Akin's decision (2026-09-29), for answer
// quality on a support line. The benchmark agreed (DESIGN §16, §20): three
// runs each, Sonnet passed 59 of 60 scenario runs and Haiku 39 of 60, and
// Sonnet was faster at p50 and cheaper per turn by the SDK's estimate.
export const DEFAULT_AGENT_MODEL = "claude-sonnet-5-5";
export const ALTERNATIVE_AGENT_MODEL = "claude-haiku-4-5-20251001";

/**
 * Thinking per model. Claude Code turns extended thinking on by default, and
 * Phase 0 measured (2026-09-29, local, Haiku 4.5, TXN-9001 turn) that the
 * second model call spent 6 to 7 s and about 700 output tokens thinking before
 * a two-sentence structured answer. Haiku runs without it. Sonnet 5.5 rejects
 * `disabled` with a 400 (Claude API reference, read 2026-09-29), so it runs
 * adaptive at low effort; the benchmark (DESIGN §16) measures it.
 */
export const AGENT_REASONING: Record<string, { thinking: { type: "disabled" } | { type: "adaptive" }; effort?: "low" | "medium" | "high" }> = {
  "claude-haiku-4-5-20251001": { thinking: { type: "disabled" } },
  "claude-sonnet-5-5": { thinking: { type: "adaptive" }, effort: "low" },
};

/** Under Vapi's 20 s custom-LLM first-token timeout. */
export const TURN_DEADLINE_MS = 14_000;
/** Measure in Phase 0. */
export const FILLER_AFTER_MS = 1_500;
/** Time left needed to try a repair (Phase 4). */
export const REPAIR_MIN_MS = 5_000;
/**
 * After an abort, how long to wait for a result already on its way before the
 * turn moves on. The benchmark measured the program taking 7.5 s to stop after
 * the deadline (2026-09-30), all of it silence for a caller.
 */
export const AGENT_ABORT_GRACE_MS = 1_000;
/** Per query(). */
export const AGENT_MAX_TURNS = 6;
/**
 * Three times the p95 turn estimate, as DESIGN §21 asks: the benchmark's p95
 * was $0.0161 per turn (Sonnet 5.5, three runs, 108 turns, 2026-09-29), so
 * 3 x p95 is $0.048 and the starting value of $0.05 stands.
 */
export const AGENT_MAX_BUDGET_USD_PER_TURN = 0.05;
/** Per MCP tool call, in the agent's MCP config. Below 1000 the SDK ignores it. */
export const MCP_TOOL_TIMEOUT_MS = 9_000;
/** A tool's own deadline, under the agent's, so the agent gets our sentence and not the SDK's timeout. */
export const TOOL_RUN_TIMEOUT_MS = 6_000;
/** create_escalation books inline (up to CAL_TIMEOUT_MS) before it answers. */
export const ESCALATION_TOOL_TIMEOUT_MS = 8_000;
/** Estimate-based circuit breaker. */
export const DAILY_AGENT_BUDGET_USD = 5;
export const MAX_TURNS_PER_CALL = 40;
export const MAX_USER_CHARS = 1_500;
/** About three short sentences. */
export const SPOKEN_TEXT_MAX_CHARS = 450;
export const MAX_CLARIFY_STREAK = 2;

// --- Typed messages on the web page (DESIGN §13) --------------------------------------
/**
 * No voice platform waits on a typed turn, so it may run longer than a call's
 * turn: the benchmark's p95 time to final text was 13.1 s against a 14 s
 * deadline (Sonnet 5.5, local, 2026-09-29), and a reader can watch a progress line.
 */
export const TEXT_TURN_DEADLINE_MS = 25_000;
/** A typed message longer than this is refused with the limit shown, not silently cut. */
export const TEXT_MESSAGE_MAX_CHARS = 1_000;
/** The page shows a character count from this length on, before the limit is reached. */
export const TEXT_COUNTER_FROM_CHARS = 800;
/** One visitor (keyed IP hash) may send this many messages per window, across conversations. */
export const TEXT_MESSAGES_PER_WINDOW = 20;
export const TEXT_RATE_WINDOW_MINUTES = 10;
/** A turn still marked in progress after this long is treated as abandoned, so a new message can start. */
export const TEXT_TURN_STALE_SECONDS = 60;
/**
 * A typed conversation idle this long is closed by the outbox worker: final
 * status, summary, and a follow-up ticket if the customer left mid-escalation.
 * A closed tab sends no end-of-call report.
 */
export const TEXT_IDLE_CLOSE_MINUTES = 30;
export const TEXT_IDLE_CLOSE_BATCH = 20;

// --- Knowledge ---------------------------------------------------------------------
export const KB_SOURCE_PATH = "assets/relaypay-knowledge-base.md";
export const CHUNK_MAX_CHARS = 900;
export const RETRIEVAL_TOP_K = 4;
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export const EMBEDDING_TIMEOUT_MS = 4_000;
/**
 * Applied to the top hit's cosine similarity. Measured by `npm run
 * kb:calibrate` on 2026-09-29 (evals/retrieval-calibration.md): 45 labelled
 * questions, 36 in scope and 9 out. At 0.39, precision 0.889, recall 0.889,
 * no found question returned the wrong section. Four topic-adjacent
 * out-of-scope questions (support hours, a business loan, the chief
 * executive, buying stocks) still clear it at any threshold that keeps recall:
 * the prompt's "answer only what a chunk says" and the eval suite cover them.
 */
export const RETRIEVAL_MIN_SCORE: number | null = 0.39;
/** The BM25 floor for memory and degraded (full-text only) search. Same run: precision 0.950, recall 0.528. */
export const MEMORY_RETRIEVAL_MIN_SCORE: number = 4.5;
/**
 * Below the threshold, hits still this close are returned as "related": the
 * agent may infer from them, and code says it is not certain (DESIGN §8). From
 * the same calibration: at 0.30 the right section is in the top four for 0.971
 * of in-scope questions, and 6 of 9 out-of-scope questions also reach it, which
 * is why these answers are always hedged, never stated as fact.
 */
export const RELATED_MIN_SCORE = 0.3;
/** The BM25 equivalent for memory and degraded search (recall 0.774 at 2.5 in the same run). */
export const MEMORY_RELATED_MIN_SCORE = 2.5;
export const RELATED_TOP_K = 3;

// --- Tickets, escalations, callbacks ---------------------------------------------------
export const TICKET_CATEGORIES = ["payment", "payout", "invoice", "account", "compliance", "dispute", "refund", "cancellation", "other"] as const;
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const ESCALATION_CATEGORIES = ["compliance", "account", "dispute", "payment", "other"] as const;
/** Matches the Cal.com event type. */
export const CALLBACK_DURATION_MIN = 30;
export const SLOT_ALTERNATIVES = 2;
export const BOOKING_HORIZON_DAYS = 14;
export const CALLBACK_EVENT_TYPE_TITLE = "RelayPay support callback";
export const CALLBACK_EVENT_TYPE_SLUG = "relaypay-support-callback";

// --- Third parties --------------------------------------------------------------------
export const CAL_API_BASE = "https://api.cal.com";
/**
 * Cal.com pins a version per endpoint, and a wrong value silently falls back
 * to an older one. Read from cal.com/docs/api-reference/v2 on the date below.
 */
export const CAL_API_VERSIONS = {
  slots: "2024-09-04",
  createBooking: "2026-02-25",
  listBookings: "2026-05-01",
  createEventType: "2026-06-12",
  listEventTypes: "2024-06-14",
} as const;
export const CAL_API_VERSIONS_READ_ON = "2026-09-29";
export const CAL_TIMEOUT_MS = 6_000;
export const RESEND_API_URL = "https://api.resend.com/emails";
export const RESEND_TIMEOUT_MS = 5_000;
export const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

// --- Outbox and alerts --------------------------------------------------------------
export const JOB_MAX_ATTEMPTS = 6;
/** Minutes before each retry: 1, 2, 4, 8, 16, 32 (DESIGN §10.1). */
export const JOB_BACKOFF_MINUTES = [1, 2, 4, 8, 16, 32] as const;
export const OUTBOX_BATCH_SIZE = 10;
/** Off Vercel, the server runs the outbox worker itself this often; pg_cron cannot reach localhost. */
export const OUTBOX_LOCAL_INTERVAL_MS = 60_000;
export const ALERT_RENOTIFY_MINUTES = 30;

// --- The support console ------------------------------------------------------------
export const CONSOLE_SESSION_HOURS = 12;
export const CONSOLE_MAX_FAILED_LOGINS = 5;
export const CONSOLE_LOCKOUT_MINUTES = 15;
/** An alert still undelivered after this long turns on the console's red banner. */
export const ALERT_UNDELIVERED_BANNER_MINUTES = 5;
/** An eval run with no result this long after it started was stopped, not still running (a full run takes about 5 minutes). */
export const EVAL_RUN_STOPPED_AFTER_MINUTES = 60;

// --- Calls -----------------------------------------------------------------------
export const CALL_MAX_DURATION_S = 480;
export const CALL_SILENCE_TIMEOUT_S = 30;
/** Vapi's own wait for our first token (model.timeoutSeconds). */
export const VAPI_LLM_TIMEOUT_S = 20;

// --- Time ------------------------------------------------------------------------
/** Today's date and "has an ETA passed" are judged in RelayPay's home zone. */
export const BUSINESS_TIMEZONE = "Africa/Lagos";

// --- Database --------------------------------------------------------------------
export const DB_SCHEMA = "support_agent";
/** Migrations run at server start; a database that cannot be reached must not hold the start for long. */
export const MIGRATION_CONNECT_TIMEOUT_MS = 10_000;
/** A tool's own database work; the agent's MCP timeout is the outer bound. */
export const TOOL_QUERY_TIMEOUT_MS = 5_000;

// --- Prices ----------------------------------------------------------------------
// Per million tokens, from the Claude models overview, read on the date below.
// Used only to label and sanity-check the SDK's own estimate, which stays an
// estimate everywhere it appears.
export const PRICES_VERIFIED_ON = "2026-09-29";
export const MODEL_PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};
