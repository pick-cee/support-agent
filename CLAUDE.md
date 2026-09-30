# CLAUDE.md

Standing context for this repository. The reading order below is not optional.
`PRD.md` is the brief. `DESIGN.md` is the specification, and it wins over
convenience. The files in `assets/`, and the three Google Docs they link to, are
requirements rather than background.

## Read this first, it will save you confusion

Two different agents are involved here, and almost every sentence below depends
on telling them apart.

- **You** are Claude Code, the coding agent. Your instructions are this file and
  `DESIGN.md`.
- **The support agent** is the thing being built. It runs inside the Claude
  Agent SDK, one `query()` per caller turn. Its instructions are its system
  prompt in `src/agent/system-prompt.ts` and its MCP tools in `src/mcp/`.

When this file says "the agent", it means the support agent.

One more twist. The Agent SDK runs a Claude Code program under the hood, the
same kind of program you are. **This file must never reach the support agent.**
That is why its `settingSources` is `[]` and its working folder is an empty
directory under `/tmp`. If you ever see text from this file in the support
agent's context, that is a bug. Fix it before anything else.

## Start here, before writing any code

Read these in order and note what each one is for.

1. **`PRD.md`.** Vapi does the voice. The Agent SDK does the support logic. A
   custom MCP server holds the tools. Supabase holds the seed data and every
   runtime record. Nine test cases.
2. **`DESIGN.md`.** All of it. §5 (a turn, step by step) and §6.3 (the gates)
   are the heart. §18.1 is the build order. **Phase 0 comes first**, because the
   risky assumptions are all in the wiring.
3. **`assets/support-decision-rules.md`.** The four paths the system prompt
   encodes: answer, clarify, escalate, decline.
4. **`assets/escalation-rules.md`**, plus its Google Doc. The Google Doc has a
   section the repo copy leaves out, "Backend Escalation Requirements": the
   system must **book the appointment via a calendar** and **notify a support
   channel**. That is why Cal.com and Resend are in the build. Its categories
   are compliance / account / dispute / other; the repo copy adds payment. We
   accept all five.
5. **`assets/mcp-tool-requirements.md`.** The six required tools, with their
   exact input and output fields. You may add fields. You may not remove or
   rename any.
6. **`assets/relaypay-knowledge-base.md`.** The only source for product and
   policy answers.
7. **`assets/supabase-schema-and-seed-data.md`** and **`assets/seed-data/`.**
   Note the enum values with spaces (`pending verification`, `review
required`, `outgoing payout`), and the empty `estimated_arrival` fields.
8. **`assets/brand-direction.md`**, plus its Google Doc, which also holds the
   logo (`public/brand/relaypay-logo.png`).
9. **`assets/test-scenarios.md`.** The eval suite is built from it (DESIGN §18.3).
10. **Week 5's `src/lib/runner/agent-runtime.ts`**, in
    `github.com/pick-cee/aat-c3-week-5-lead-agent` at `1298747`. Port it; don't
    rediscover it. Change one thing: pass a minimal `env`, not `...process.env`.

## What this is

A RelayPay customer talks to an AI support agent on a web page. The agent
answers from approved knowledge, looks up accounts, transactions and payouts
when that is safe, opens tickets, and escalates to a human with a booked
callback and a handoff email. Every step is recorded in Supabase. A small
console shows the team what happened. The product is a first line that never
guesses, never leaks, and never drops a case.

## Stack

- **Next.js**, current version, App Router, on Vercel Hobby. Read
  `node_modules/next/dist/docs/` before using an API. It has breaking changes
  your training data doesn't know.
- **TypeScript** strict, **zod** (use the version the MCP SDK expects), **Vitest**.
- **Supabase Postgres**, schema `support_agent`, through `pg` on the
  transaction pooler (port 6543). Extensions: pgvector, pg_cron, pg_net.
- **`@anthropic-ai/claude-agent-sdk`** for the support agent. Default model
  `claude-sonnet-5-5` (Akin's decision, 2026-09-29, confirmed by the benchmark
  in DESIGN §16). The alternative is `claude-haiku-4-5-20251001`.
- **`@modelcontextprotocol/server`** v2, the stable line, for the MCP server.
- **Vapi:** `@vapi-ai/web` on the page, and `@vapi-ai/server-sdk` for
  `vapi:sync` and its types.
- **Cal.com** API v2 for booking. **Resend** for the support-inbox email.
- **OpenAI** `text-embedding-3-small` for embeddings.
- **`chrono-node`** for parsing callback times.

## Rules that are not negotiable

1. **Never run `git commit` or `git push`.** Akin commits and pushes. End each
   piece of work with what changed and a suggested commit message.
2. **`assets/` belongs to the client and is never edited.** That includes the
   seed CSVs, even where their dates are stale (DESIGN §2.6).
3. **Build in phase order.** Phase 0 (DESIGN §18.1) must pass, with its numbers
   recorded, before Phase 1 starts. Don't start a phase while the previous
   one's exit check fails.
4. **Nothing is spoken that the system cannot stand behind.** Every answer goes
   through the gates in DESIGN §6.3 before it reaches Vapi. The gates read the
   turn's own tool-call log, never the model's account of it.
5. **The model never writes these:**
   - reference numbers
   - booked times
   - dates computed from other dates
   - emails it read from a tool

   Code writes those sentences from the tool result (DESIGN §6.4).

6. **Date and time maths lives in code.** That covers ETAs, whether a date has
   passed, and parsing a callback time. "Now" is injectable, so tests can fix it.
7. **Every tool call is logged by the MCP server**, including refusals,
   validation failures and errors. Logging never depends on the model calling
   `log_conversation_event`.
8. **A missing record is `found: false` with a reason.** Never a crash. Never an
   empty object that looks like data.
9. **Unknown is not empty.** An empty CSV field is `NULL`, returned as `null`,
   and said as "there's no estimate on the record".
10. **Idempotency lives in unique constraints**, not in checks the code
    remembers to run. Vapi retries and caller interruptions will double-fire
    tools.
11. **Reserve, then act, then confirm.** Record the escalation before calling a
    third party. Record a success only when the third party returns one. Never
    say "booked" unless Cal.com returned a booking.
12. **Every failure is visible.** It gets a spoken fallback, a record and,
    where DESIGN §15 says so, an alert. No dead air. No raw error, stack trace
    or database message ever reaches the caller or the agent.
13. **No tool may exist that could break the privacy rules.** Nothing returns
    contact details, nothing lists customers, and nothing the agent can reach
    writes to `customers`, `transactions` or `payouts`.
14. **Identity takes two matching identifiers** on the same record. A miss and
    a partial match get the same reply.
15. **After an escalation, lookup tools refuse** for that conversation. The
    refusal is enforced in the MCP server, not requested in the prompt.
16. **Secrets stay on the server.** The support agent's subprocess gets a
    minimal `env` (DESIGN §6.1). The only `NEXT_PUBLIC_` variables are the Vapi
    public key and the assistant id.
17. **RLS on every table.** Every migration that creates a function revokes
    `EXECUTE` from `PUBLIC`, `anon` and `authenticated`. `npm run
db:check-grants` must pass. Postgres grants `EXECUTE` to `PUBLIC` by
    default, and that shipped live in Week 4.
18. **The SDK's `total_cost_usd` is an estimate.** Label it as one everywhere.
    Never add it to Vapi's cost, which is real billing.
19. **Never claim a measured improvement without a measurement.** Say what you
    didn't measure.
20. **No em dashes** in anything a person reads: spoken text, UI strings, docs,
    emails. `toSpeech()` strips them mechanically and counts what it stripped,
    because asking a model not to use them doesn't reliably work.
21. **`DESIGN.md` wins over your instinct for a cleaner approach.** If you think
    it's wrong, say so and stop. Don't quietly build the other thing. Record
    every agreed departure in DESIGN §20 in the same piece of work.

## Agent SDK notes that will bite

- **`tools: []`** disables every built-in tool. The support agent must never
  read a file or run a command. `allowedTools` lists the eight
  `mcp__relaypay__*` names and nothing else.
- **`alwaysLoad: true`** on the MCP server config. Without it, tools are
  deferred behind tool search and every turn pays an extra model round trip
  before the first tool call. On a phone line that is audible.
- **`strictMcpConfig: true`.** Without it the host's MCP servers and claude.ai
  connectors attach (measured in Week 5: Gmail, Drive, Calendar and 19
  unrelated skills).
- **`settingSources: []`** and an empty `cwd`. Otherwise this file, and anything
  else in the folder, becomes the support agent's context.
- **`env` replaces the subprocess environment entirely.** Pass only `PATH`,
  `HOME`, `CLAUDE_CONFIG_DIR`, the `XDG_*` dirs (all under `/tmp`) and
  `ANTHROPIC_API_KEY`. Week 5 spread `process.env`. This week we don't.
- **Claude Code ignores `ANTHROPIC_API_KEY`** until the key is approved in its
  config, and then falls back to "Not logged in". The ported runtime writes the
  approval.
- **The native program** (`@anthropic-ai/claude-agent-sdk-linux-x64`, about
  237 MB) is found by name at run time, so the build won't ship it unless told
  to:
  - Include it with `outputFileTracingIncludes` only in the routes that run the
    agent. Vercel's function limit is 250 MB.
  - Build the path at run time, so the tracer can't copy it everywhere.
  - Copy it to `/tmp` and `chmod` it if the executable bit is lost.
- **`permissionMode: 'dontAsk'`.** Nobody is there to approve anything.
- **Set `maxTurns` and `maxBudgetUsd` on every `query()`.**
- **The SDK yields the result message and then throws** on budget or turn
  limits. Keep the result before the throw, or the turn logs $0.00 and loses
  its usage.
- **`outputFormat: { type: 'json_schema', schema }`** puts the answer in
  `result.structured_output`. Handle the
  `error_max_structured_output_retries` subtype as a failure with a fallback.
- **`includePartialMessages: true`** yields `stream_event` messages. The first
  `content_block_start` with a `tool_use` block is the cue to stream the filler
  phrase.
- **Wire `abortController` to the request's abort signal and to the turn
  deadline.**
- **`persistSession: false`.** Nothing to resume, and only `/tmp` is writable.
- **Per-turn MCP headers** (`X-RelayPay-Conversation`, `X-RelayPay-Turn`) go in
  that turn's `mcpServers` config. The MCP server trusts the header over any
  `conversation_id` the model passes.
- **`prewarm()` exists (alpha)** and keeps a spare process ready. Use it only if
  the DESIGN §4 decision gate moves the turn runner to an always-on host.

## MCP server notes

- **v2 API:** `createMcpHandler(factory)` returns `{ fetch }`, a web-standard
  `(Request) => Promise<Response>`. The factory runs once per request, so the
  server is stateless. Next.js route handlers take a `Request` and return a
  `Response`, so call it from `src/app/api/mcp/route.ts` on the Node runtime.
- **Auth is yours:** verify the bearer token before the handler, and pass
  `authInfo` through. Validate `Host` and `Origin`.
- **Older clients** need v2's explicit legacy option. Phase 0 records which
  protocol version the Agent SDK negotiates. If it can't connect even with the
  legacy option, fall back to `@modelcontextprotocol/sdk` v1 and log why in
  DESIGN §20.
- **TypeScript 6 and up:** add `"types": ["node"]` to `tsconfig.json`.
- **Results:** return `structuredContent` plus the same JSON as a text block.
- **Refusals and bad input** return `isError: true` with a sentence that tells
  the agent what to do next. Never throw: a thrown error reaches the model as a
  raw string with no context.
- **`readOnlyHint: true`** only on `search_knowledge_base` and
  `find_callback_slots`. `lookup_customer` sets verification, and a
  transaction lookup running in parallel with it could check ownership before
  verification lands.
- **Three entry points, one tool core:** HTTP, stdio and memory mode (DESIGN
  §7.1). A fresh clone with no `.env` must be able to run
  `npm run mcp:inspect`.

## Vapi notes

- Read field names from `node_modules/@vapi-ai/server-sdk/dist/cjs/api/types/*.d.ts`.
  Don't guess them.
- **Custom LLM:**
  - `model.url` is used as the OpenAI client's base URL, and Vapi calls
    `/chat/completions` under it. Confirm the path in Phase 0 by logging a real
    request.
  - The body is OpenAI-shaped with `stream: true`. With
    `metadataSendMode: 'variable'` (the default) it also carries `call`,
    `customer` and `phoneNumber`.
  - Reply as SSE: `data: {"id":..., "object":"chat.completion.chunk", "choices":[{"index":0,"delta":{"content":"..."},"finish_reason":null}]}`,
    then a chunk with `finish_reason: "stop"`, then `data: [DONE]`.
  - `timeoutSeconds` (default 20) is how long Vapi waits for the first token.
  - Authorization comes from a custom-llm credential. The `headers` option
    cannot override `Authorization`.
- **Server messages:** `status-update`, `end-of-call-report` and `hang`. The
  end-of-call report carries `endedReason`, `cost`, `costs`, `artifact`,
  `analysis`, `startedAt`, `endedAt` and `call`.
- **`maxDurationSeconds`** defaults to 600. We set 480.
- **Public key restrictions:** `allowedOrigins` and `allowedAssistantIds` (the
  `TokenRestrictions` type). Without them anyone can spend the account's
  balance.
- **The free phone number** is a US number and inbound only. Whether a Nigerian
  line can reach it is a Phase 6 test, not an assumption.

## Cal.com and Resend notes

- **Cal.com API v2.** The `cal-api-version` value can differ between endpoints. Read
  the current docs and pin each value with its date. Booking takes `start` in
  UTC and `attendee { name, email, timeZone }`. There is no documented
  idempotency key, so use the adopt-existing check in DESIGN §10.2. Cal.com
  emails the attendee and the host. We don't email customers.
- **Resend** without a verified domain delivers only to the account owner's
  address. That address is `SUPPORT_INBOX_EMAIL` for this build. Check the
  current docs for the allowed sender.

## Supabase and Vercel notes

- **The transaction pooler** means no `SET` outside a transaction, no
  `pg_advisory_lock` (use `pg_advisory_xact_lock`) and no `LISTEN`. Migrations
  use a session-mode connection.
- **The outbox is driven by `pg_cron` and `pg_net`**, not Vercel cron, because
  Vercel Hobby cron only runs daily. The shared secret lives in Supabase Vault,
  never in a migration file.
- **The agent and MCP routes** use the Node runtime, not Edge. Hobby functions
  cap at 300 s. Post-response work uses `after()`.

## Brand, for the page and the console

These come from the brand direction doc and its Google Doc.

- Professional, calm, minimal, trustworthy.
- Logo top left, not animated or restyled.
- Deep blue primary, teal-blue accent, off-white or light grey background.
  Sample the exact hex values from the logo file.
- Inter or the system stack, at most two weights.
- No gradients, neon, emoji, chat bubbles, monospace or experimental layouts.
- When unsure, simpler and more neutral.
- Every user-facing string lives in `src/app/copy.ts`.

## Conventions

- Layout:
  - `src/app/` for routes
  - `src/agent/` for the turn runner, system prompt, gates and speech
    formatting
  - `src/mcp/` for tools and repositories
  - `src/lib/` for db, constants, jobs, alerts, normalisers and time
  - `scripts/`, `supabase/migrations/`, `evals/`, `vapi/`
- Server-only modules import `server-only`. No client code touches a key.
- **Every threshold, limit, timeout and price is a named constant** in
  `src/lib/constants.ts`, with `PRICES_VERIFIED_ON`. No literals scattered
  through the code.
- **Every state change writes a row.**
- **Prefer explicit failure** over a plausible default.
- **Print the data before reasoning about it.** When a parse or a match
  behaves impossibly, dump the raw input. Speech-to-text output especially.
- **Comments explain why**, not what.
- **`FAILURES.md`**: every real failure you hit, as it happens. Symptom, root
  cause, fix. The testing evidence is written from it.
- **Every behaviour change** updates `DESIGN.md` in the same piece of work.

## Commands this repo should end up with

`dev`, `build`, `typecheck`, `lint`, `test`, `db:migrate`, `db:seed`,
`db:check-grants`, `kb:ingest`, `kb:calibrate`, `mcp:stdio`, `mcp:inspect`,
`vapi:sync`, `eval`.

## Before you hand back a change

- [ ] No `git commit` or `git push` was run.
- [ ] `npm run typecheck`, `npm test` and `npm run build` are clean.
- [ ] `npm run db:check-grants` passes, if the change touched the database.
- [ ] The eval scenarios this change affects were run. Paste the pass and fail
      lines.
- [ ] Any number you report (latency, cost, pass rate) was measured, and you
      say how.
- [ ] You searched the changed files for em dashes; you didn't assume.
- [ ] You say what you did not do or did not verify.
- [ ] `DESIGN.md` and `FAILURES.md` are updated if behaviour changed or
      something broke.
- [ ] A suggested commit message.
